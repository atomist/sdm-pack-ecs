/*
 * Copyright © 2019 Atomist, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
    FulfillableGoalDetails,
    FulfillableGoalWithRegistrations,
    getGoalDefinitionFrom,
    Goal,
    GoalDefinition,
    Implementation,
    ImplementationRegistration,
    IndependentOfEnvironment,
    ProgressLog,
    ProjectLoader,
    TargetInfo,
} from "@atomist/sdm";
import { EC2, ECS, STS } from "aws-sdk";
import { executeEcsDeploy } from "../deploy/ecsApi";
import {AWSCredentialLookup, createEc2Session, createEcsSession} from "../EcsSupport";
import { ecsDataCallback } from "../support/ecsDataCallback";
import { createUpdateServiceRequest } from "../support/ecsServiceRequest";

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

export interface ECSTaskDefaults {
   cpu: number;
   memory: number;
   requiredCompatibilities: ECS.Compatibility[];
   networkMode: ECS.NetworkMode;
}

export interface EcsDeployRegistration extends Partial<ImplementationRegistration> {
    serviceRequest?: Partial<ECS.Types.CreateServiceRequest>;
    taskDefinition?: ECS.Types.RegisterTaskDefinitionRequest;
    externalUrls?: string[];
    region: string;
    roleDetail?: STS.AssumeRoleRequest;
    credentialLookup?: AWSCredentialLookup;
    taskDefaults?: ECSTaskDefaults;
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
            goalExecutor: executeEcsDeploy(registration),
        } as Implementation);

        this.addFulfillmentCallback({
            goal: this,
            callback: ecsDataCallback(this, registration),
        });

        return this;
    }
}

export interface EcsDeploymentInfo extends TargetInfo, ECS.Types.CreateServiceRequest {
    region: string;
    credentialLookup?: AWSCredentialLookup;
    roleDetail?: STS.AssumeRoleRequest;
}

export interface EcsDeployment extends Deployment {
    clusterName: string;
    projectName: string;
    externalUrls?: string[];
}

// tslint:disable-next-line:max-classes-per-file
export class EcsDeployer implements Deployer<EcsDeploymentInfo & EcsDeployRegistration, EcsDeployment> {
    constructor(private readonly projectLoader: ProjectLoader) {
    }

    public async deploy(da: DeployableArtifact,
                        esi: EcsDeploymentInfo,
                        log: ProgressLog,
                        credentials: ProjectOperationCredentials): Promise<EcsDeployment[]> {
        log.write(`Deploying service ${da.name} to ECS cluster ${esi.cluster}`);

        // Setup ECS/EC2 session
        const awsRegion = esi.region;
        const ecs = await createEcsSession(awsRegion, esi.roleDetail, esi.credentialLookup);
        const ec2 = await createEc2Session(awsRegion, esi.roleDetail, esi.credentialLookup);

        // Cleanup extra target info
        const params = esi;
        delete params.name;
        delete params.description;
        delete params.region;
        delete params.credentialLookup;
        delete params.roleDetail;

        // Run Deployment
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
                    log.write(`Service already exists, attempting to apply update...`);
                    serviceChange = {
                        response: await ecs.updateService(updateService).promise(),
                        service: params.serviceName,
                    };

                } else {
                    // New Service, just create
                    log.write(`Creating new service ${da.name}...`);
                    serviceChange = {
                        response: await ecs.createService(params).promise(),
                        service: params.serviceName,
                    };
                }

                log.write(`Service deployed, awaiting "serviceStable" state...`);
                await ecs.waitFor("servicesStable", { services: [serviceChange.service], cluster: params.cluster }).promise()
                    .then( async () => {
                        const res = await this.getEndpointData(params, serviceChange.response, awsRegion, ecs, ec2);
                        log.write(`Service ${da.name} successfully deployed.`);
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
                        try {
                            const publicIp = interfaceData.NetworkInterfaces[0].Association.PublicIp;
                            // For each task, build the endpoint URL
                            //   This is only valuable for single container tasks - any more then that the data becomes
                            //   useless b/c there is too many endpoints; you have to use service discovery
                            const proto = taskDef.containerDefinitions[0].portMappings[0].protocol;
                            const port = taskDef.containerDefinitions[0].portMappings[0].hostPort;
                            return(`${proto}://${publicIp}:${port}`);
                        } catch (error) {
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
        region: string,
        ecs: ECS,
        ec2: EC2,
        ): Promise<string[]> {
        return new Promise<string[]>( async (resolve, reject) => {
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
                try {
                    const result = await this.getTaskEndpoint(ec2, taskDef, matchingTasks.tasks);
                    logger.debug(`Endpoint data ${JSON.stringify(result)}`);
                    resolve(result);
                } catch (error) {
                    logger.debug(error);
                    resolve([]);
                }
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

        return this.projectLoader.doWithProject({credentials, id, readOnly: true}, async () => {
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
