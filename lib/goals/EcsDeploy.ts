import {
    logger,
    ProjectOperationCredentials,
    RemoteRepoRef,
} from "@atomist/automation-client";
import {
    DefaultGoalNameGenerator,
    DeployableArtifact,
    Deployer,
    Deployment,
    ExecuteGoal,
    ExecuteGoalResult,
    FulfillableGoalDetails,
    FulfillableGoalWithRegistrations,
    FulfillmentRegistration,
    getGoalDefinitionFrom,
    Goal,
    GoalDefinition,
    GoalDetails,
    GoalInvocation,
    Implementation,
    IndependentOfEnvironment,
    ProgressLog,
    ProjectLoader,
    TargetInfo,
} from "@atomist/sdm";
import { EC2, ECS } from "aws-sdk";
import _ = require("lodash");
import { ecsDataCallback } from "../support/ecsDataCallback";

const EcsGoalDefinition: GoalDefinition = {
    displayName: "deploying to ECS",
    uniqueName: "cloudfoundry-deploy",
    environment: IndependentOfEnvironment,
    workingDescription: "Deploying to ECS",
    completedDescription: "Deployed to ECS",
    failedDescription: "Deployment to ECS failed",
    waitingForApprovalDescription: "Waiting for ECS deployment approval",
    waitingForPreApprovalDescription: "Waiting to start ECS deployment",
    stoppedDescription: "Deployment to ECS stopped",
    canceledDescription: "Deployment to ECS cancelled",
};

export interface EcsDeployRegistration extends FulfillmentRegistration {
    serviceRequest: Partial<ECS.Types.CreateServiceRequest>;
    taskDefinition?: ECS.Types.RegisterTaskDefinitionRequest;
    externalUrls?: string[];
}

// tslint:disable-next-line:max-line-length
export class EcsDeploy extends FulfillableGoalWithRegistrations<EcsDeployRegistration> {
    // tslint:disable-next-line
    constructor(protected details: FulfillableGoalDetails | string = DefaultGoalNameGenerator.generateName("ecs-deploy-push"), 
                ...dependsOn: Goal[]) {

        super({
            ...EcsGoalDefinition,
            ...getGoalDefinitionFrom(details, DefaultGoalNameGenerator.generateName("ecs-deploy-push")),
        }, ...dependsOn);
    }

    public with(
        registration: EcsDeployRegistration,
        ): this {

        // tslint:disable-next-line:no-object-literal-type-assertion
        this.addFulfillment({
            name: DefaultGoalNameGenerator.generateName("ecs-deployer"),
            goalExecutor: executeEcsDeploy(),
        } as Implementation);

        this.addFulfillmentCallback({
            goal: this,
            callback: ecsDataCallback(this, registration),
        });

        return this;
    }
}

// Execute an ECS deploy
//  *IF there is a task partion task definition, inject
export function executeEcsDeploy(): ExecuteGoal {
    return async (goalInvocation: GoalInvocation): Promise<ExecuteGoalResult> => {
        const {sdmGoal, credentials, id, progressLog, configuration} = goalInvocation;

        const goalData = JSON.parse(sdmGoal.data);

        logger.info("Deploying project %s:%s to ECS in %s]", id.owner, id.repo, goalData.serviceRequest.cluster);

        const image: DeployableArtifact = {
            name: sdmGoal.repo.name,
            version: sdmGoal.push.after.sha,
            filename: sdmGoal.push.after.image.imageName,
            id,
        };

        const deployInfo = {
            name: sdmGoal.repo.name,
            description: sdmGoal.name,
            ...goalData.serviceRequest,
        };

        const deployments = await new EcsDeployer(configuration.sdm.projectLoader).deploy(
            image,
            deployInfo,
            progressLog,
            credentials,
        );

        const results = await Promise.all(deployments.map(deployment => {
            logger.debug(`Endpoint details: ${JSON.stringify(deployment.externalUrls)}`);
            const endpoints: GoalDetails["externalUrls"] = [];
            deployment.externalUrls.map( e => {
                endpoints.push({url: e});
            });

            logger.debug(`Endpoint details for ${deployment.projectName}: ${JSON.stringify(endpoints)}`);

            // tslint:disable-next-line:no-object-literal-type-assertion
            return {
                code: 0,
                externalUrls: endpoints,
            } as ExecuteGoalResult;
        }));

        return _.head(results);
    };
}

export interface EcsDeploymentInfo extends TargetInfo, ECS.Types.CreateServiceRequest {}

export interface EcsDeployment extends Deployment {
    clusterName: string;
    projectName: string;
    externalUrls?: string[];
}

// This function converts a CreateServiceRequest to an UpdateServiceRequest
// tslint:disable-next-line:cyclomatic-complexity
export async function createUpdateServiceRequest(params: ECS.Types.CreateServiceRequest): Promise<ECS.Types.UpdateServiceRequest> {
    return {
        service: params.serviceName,                // Required
        taskDefinition: params.taskDefinition,      // Required
        forceNewDeployment: true,                   // Required
        cluster: params.hasOwnProperty("cluster") && params.cluster ? params.cluster : undefined,
        desiredCount: params.hasOwnProperty("desiredCount")
            && params.desiredCount ? params.desiredCount : undefined,
        deploymentConfiguration: params.hasOwnProperty("deploymentConfiguration")
            && params.deploymentConfiguration ? params.deploymentConfiguration : undefined,
        networkConfiguration: params.hasOwnProperty("networkConfiguration")
            && params.networkConfiguration ? params.networkConfiguration : undefined,
        platformVersion: params.hasOwnProperty("platformVersion")
            && params.platformVersion ? params.platformVersion : undefined,
        healthCheckGracePeriodSeconds: params.hasOwnProperty("healthCheckGracePeriodSeconds")
            && params.healthCheckGracePeriodSeconds
                ? params.healthCheckGracePeriodSeconds : undefined,
    };
}

// tslint:disable-next-line:max-classes-per-file
export class EcsDeployer implements Deployer<EcsDeploymentInfo, EcsDeployment> {
    constructor(private readonly projectLoader: ProjectLoader) {
    }

    public async deploy(da: DeployableArtifact,
                        esi: EcsDeploymentInfo,
                        log: ProgressLog,
                        credentials: ProjectOperationCredentials): Promise<EcsDeployment[]> {
        logger.info("Deploying app [%j] to ECS [%s]", da, esi.description);

        // Cleanup extra target info
        const params = esi;
        delete params.name;
        delete params.description;

        // Run Deployment
        const ecs = new ECS();
        return [await new Promise<EcsDeployment>(async (resolve, reject) => {

            try {
                const data = await ecs.listServices({cluster: params.cluster}).promise();
                let updateOrCreate = 0;
                data.serviceArns.forEach(s => {
                    // arn:aws:ecs:us-east-1:247672886355:service/ecs-test-1-production
                    const service = s.split(":").pop().split("/").pop();
                    if (service === params.serviceName) {
                        updateOrCreate += 1;
                    }
                });

                let serviceChange: any;
                if (updateOrCreate !== 0) {
                    // If we are updating, we need to build an UpdateServiceRequest from the data
                    //  we got in params (which is a CreateServiceRequest, not update)
                    const updateService = await createUpdateServiceRequest(params);

                    // Update service with new definition
                    serviceChange = {
                        response: await ecs.updateService(updateService).promise(),
                        service: params.serviceName,
                    };

                } else {
                    // New Service, just create
                    serviceChange = {
                        response: await ecs.createService(params).promise(),
                        service: params.serviceName,
                    };
                }

                await ecs.waitFor("servicesStable", { services: [serviceChange.service], cluster: params.cluster }).promise()
                    .then( async () => {
                        const res = await this.getEndpointData(params, serviceChange.response);

                        resolve({
                            externalUrls: res,
                            clusterName: serviceChange.response.service.clusterArn,
                            projectName: esi.name,
                        });
                    });

            } catch (error) {
                logger.error(error);
                reject(error);
            }

        })];
    }

    public async getTaskEndpoint(ec2: EC2, taskDef: ECS.TaskDefinition, tasks: ECS.Task[]): Promise<string[]> {
        return new Promise<string[]>((resolve, reject) => {
            try {
                const q = tasks.map( async t => {
                        // Get the EIN for this interface
                        const ein = t.attachments[0].details[1].value;

                        // Lookup the network interface by EIN
                        const interfaceData = await ec2.describeNetworkInterfaces({ NetworkInterfaceIds: [ ein ]}).promise();

                        // If there is a public IP assigned, pull out the data
                        if (interfaceData.NetworkInterfaces[0].Association.PublicIp) {
                                const publicIp = interfaceData.NetworkInterfaces[0].Association.PublicIp;
                                // For each container, build the endpoint URL
                                // Return the resulting map of urls
                                taskDef.containerDefinitions.map( c => {
                                        const proto = c.portMappings[0].protocol;
                                        const port = c.portMappings[0].hostPort;
                                        return(`${proto}://${publicIp}:${port}`);
                                });
                        } else {
                            return undefined;
                        }
                });

                Promise.all(q).then( values => {
                    resolve(values);
                }).catch( error => {
                    logger.error(error);
                    reject(error);
                });
            } catch (error) {
                logger.error(error);
                reject(error);
            }
        });
    }

    public async getEndpointData(
        definition: ECS.Types.UpdateServiceRequest | ECS.Types.CreateServiceRequest,
        data: ECS.Types.UpdateServiceResponse | ECS.Types.CreateServiceResponse,
        ): Promise<string[]> {
        return new Promise<string[]>( async (resolve, reject) => {
            const ecs = new ECS();
            const ec2 = new EC2();

            // List all tasks in this cluster that match our servicename
            try {
                const arns = await ecs.listTasks({ serviceName: data.service.serviceName, cluster: definition.cluster }).promise();
                let taskDef: ECS.Types.TaskDefinition;

                // Get all task definitions
                const tdata =  await ecs.describeTaskDefinition({ taskDefinition: data.service.taskDefinition }).promise();

                // Get all the tasks that we found above
                taskDef = tdata.taskDefinition;

                // Describe all tasks (for our machine service)
                const matchingTasks = await ecs.describeTasks({ tasks: arns.taskArns, cluster: definition.cluster }).promise();

                // For each tasks, pull out the network interface EIN
                const result = await this.getTaskEndpoint(ec2, taskDef, matchingTasks.tasks);
                logger.debug(`Endpoint data ${JSON.stringify(result)}`);
                resolve(result);
            } catch (error) {
                logger.error(error);
                reject(error);
            }
        });
    }

    public async undeploy(): Promise<void> {
        return;
    }

    public findDeployments(id: RemoteRepoRef,
                           ti: EcsDeploymentInfo,
                           credentials: ProjectOperationCredentials): Promise<EcsDeployment[]> {

        return this.projectLoader.doWithProject({credentials, id, readOnly: true}, async project => {
            logger.warn("Find Deployments is not implemented in ecsDeployer");
            return [];
        });
    }

    // tslint:disable-next-line:typedef
    public logInterpreter(log: string) {
        return {
            relevantPart: "",
            message: "Deploy failed",
        };
    }

}
