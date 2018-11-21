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
            // TODO: raise appropriate return code
            // tslint:disable-next-line:no-object-literal-type-assertion
            return {
                code: 0,
                targetUrl: deployment.endpoint,
            } as ExecuteGoalResult;
        }));

        return _.head(results);
    };
}

export interface EcsDeploymentInfo extends TargetInfo, ECS.Types.CreateServiceRequest {}

export interface EcsDeployment extends Deployment {
    clusterName: string;
    projectName: string;
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

            await ecs.listServices({cluster: params.cluster}).promise()
            .then( async data => {
                let updateOrCreate = 0;
                data.serviceArns.forEach(s => {
                    // arn:aws:ecs:us-east-1:247672886355:service/ecs-test-1-production
                    const service = s.split(":").pop().split("/").pop();
                    if (service === params.serviceName) {
                        updateOrCreate += 1;
                    }
                });
                if (updateOrCreate !== 0) {
                    // If we are updating, we need to build an UpdateServiceRequest from the data
                    //  we got in params (which is a CreateServiceRequest, not update)
                    const updateService = await createUpdateServiceRequest(params);

                    // Update service with new definition
                    await ecs.updateService(updateService).promise()
                    .then( async d => {
                        // Wait for service to come-up/converge
                        await ecs.waitFor("servicesStable",
                            { services: [updateService.service], cluster: updateService.cluster }).promise()
                                .then( async () => {
                                    await this.getEndpointData(params, d)
                                        .then( res => {
                                            resolve({
                                                endpoint: res.join(","),
                                                clusterName: d.service.clusterArn,
                                                projectName: esi.name,
                                            });
                                        });
                                });
                    });
                } else {
                    // New Service, just create
                    await ecs.createService(params).promise()
                    .then( async d1 => {
                            await ecs.waitFor("servicesStable",
                                { cluster: params.cluster, services: [ params.serviceName] }).promise()
                                    .then( async () => {
                                        await this.getEndpointData(params, d1)
                                            .then( res => {
                                                resolve({
                                                    endpoint: res.join(","),
                                                    clusterName: d1.service.clusterArn,
                                                    projectName: esi.name,
                                                });
                                            });
                                    });

                    });

                }
            })
            .catch( reason => {
                reject(reason);
            });
        })];
    }

    public async getEndpointData(
        definition: ECS.Types.UpdateServiceRequest | ECS.Types.CreateServiceRequest,
        data: ECS.Types.UpdateServiceResponse | ECS.Types.CreateServiceResponse,
        ): Promise<string[]> {
        return new Promise<string[]>( async (resolve, reject) => {
            const ecs = new ECS();
            const ec2 = new EC2();

            // List all tasks in this cluster that match our servicename
            await ecs.listTasks(
                { serviceName: data.service.serviceName, cluster: definition.cluster }).promise()
                .then( async arns => {
                    let taskDef: ECS.Types.TaskDefinition;

                    // Get all task definitions
                    await ecs.describeTaskDefinition(
                        { taskDefinition: data.service.taskDefinition }).promise()
                        .then( async tdata => {

                            // Get all the tasks that we found above
                            taskDef = tdata.taskDefinition;
                            await ecs.describeTasks(
                                { tasks: arns.taskArns, cluster: definition.cluster }).promise()
                                .then( async d => {

                                    // For each tasks, pull out the network interface EIN
                                    d.tasks.forEach( async t => {
                                        // Get the EIN for this interface
                                        const ein = d.tasks[0].attachments[0].details[1].value;

                                        // Lookup the network interface by EIN
                                        await ec2.describeNetworkInterfaces(
                                            { NetworkInterfaceIds: [ ein ]}).promise()
                                            .then( idata => {

                                                // If there is a public IP assigned, pull out the data
                                                if (idata.NetworkInterfaces[0].Association.PublicIp) {
                                                    const publicIp = idata.NetworkInterfaces[0].Association.PublicIp;
                                                    // For each container, build the endpoint URL
                                                    // Return the resulting map of urls
                                                    resolve(
                                                        taskDef.containerDefinitions.map( c => {
                                                            const proto = c.portMappings[0].protocol;
                                                            const port = c.portMappings[0].hostPort;
                                                            return `${proto}://${publicIp}:${port}`;
                                                        }),
                                                    );
                                                } else {
                                                    // If there are no public IPs set, just return a null list since
                                                    // we can't build the URLs
                                                    // TODO: Check for LB info
                                                    resolve([]);
                                                }
                                            });
                                    });
                                });
                            });
                        })
                // If it fails, return the reason
                .catch( reason => {
                    reject(reason);
                });
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
