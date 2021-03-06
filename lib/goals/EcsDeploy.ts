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
} from "@atomist/automation-client";
import {
    DefaultGoalNameGenerator,
    FulfillableGoalDetails,
    FulfillableGoalWithRegistrationsAndListeners,
    getGoalDefinitionFrom,
    Goal,
    GoalDefinition,
    Implementation,
    ImplementationRegistration,
    IndependentOfEnvironment,
    ProgressLog,
} from "@atomist/sdm";
import {AWSError, EC2, ECS, STS} from "aws-sdk";
import { PromiseResult } from "aws-sdk/lib/request";
import {
    EcsDeployableArtifact,
    executeEcsDeploy,
} from "../deploy/ecsApi";
import {AWSCredentialLookup, createEc2Session, createEcsSession} from "../EcsSupport";
import { createUpdateServiceRequest } from "../support/ecsServiceRequest";
import { EcsDeploymentListenerRegistration } from "../support/listeners";

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
    retryFeasible: true,
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
export class EcsDeploy extends FulfillableGoalWithRegistrationsAndListeners<EcsDeployRegistration, EcsDeploymentListenerRegistration> {
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
            goalExecutor: executeEcsDeploy(registration, this.listeners),
        } as Implementation);

        return this;
    }
}

export interface EcsDeploymentInfo {
    name: string;
    region: string;
    credentialLookup?: AWSCredentialLookup;
    roleDetail?: STS.AssumeRoleRequest;
}

export enum EcsDeploymentExecutionType {
    created = "created",
    updated = "updated",
}

export interface EcsDeployment {
    clusterName: string;
    projectName: string;
    externalUrls?: string[];
    deploymentType: EcsDeploymentExecutionType;

    /**
     * The result of the service update or creation
     * Can check deploymentType to determine if the service was updated or created, however the provided details are the same
     */
    serviceDetails?: ECS.CreateServiceResponse;
}

// tslint:disable-next-line:max-classes-per-file
export class EcsDeployer {
    public async deploy(da: EcsDeployableArtifact,
                        esi: EcsDeploymentInfo,
                        serviceRequest: ECS.CreateServiceRequest,
                        log: ProgressLog): Promise<EcsDeployment> {
        log.write(`Deploying service ${da.name} to ECS cluster ${serviceRequest.cluster}`);

        // Setup ECS/EC2 session
        const awsRegion = esi.region;
        const ecs = await createEcsSession(awsRegion, esi.roleDetail, esi.credentialLookup);
        const ec2 = await createEc2Session(awsRegion, esi.roleDetail, esi.credentialLookup);

        // Run Deployment
        const data = await ecs.listServices({cluster: serviceRequest.cluster}).promise();
        let updateOrCreate = 0;
        data.serviceArns.forEach(s => {
            // arn:aws:ecs:us-east-1:247672886355:service/ecs-test-1-production
            const service = s.split(":").pop().split("/").pop();
            if (service === serviceRequest.serviceName) {
                updateOrCreate += 1;
            }
        });

        let serviceChange: PromiseResult<ECS.CreateServiceResponse, AWSError>;
        if (updateOrCreate !== 0) {
            // If we are updating, we need to build an UpdateServiceRequest from the data
            //  we got in params (which is a CreateServiceRequest, not update)
            const updateService = await createUpdateServiceRequest(serviceRequest);

            // Update service with new definition
            log.write(`Service already exists, attempting to apply update...`);
            serviceChange = await ecs.updateService(updateService).promise();
        } else {
            // New Service, just create
            log.write(`Creating new service ${da.name}...`);
            serviceChange = await ecs.createService(serviceRequest).promise();
        }

        let response: EcsDeployment;
        log.write(`Service deployed, awaiting "serviceStable" state...`);
        await ecs.waitFor("servicesStable", { services: [serviceChange.service.serviceName], cluster: serviceRequest.cluster }).promise()
            .then( async () => {
                const res = await this.getEndpointData(serviceRequest, serviceChange, awsRegion, ecs, ec2);
                log.write(`Service ${da.name} successfully deployed.`);
                response = {
                    externalUrls: res,
                    clusterName: serviceChange.service.clusterArn,
                    projectName: esi.name,
                    deploymentType: updateOrCreate !== 0 ? EcsDeploymentExecutionType.updated : EcsDeploymentExecutionType.created,
                    serviceDetails: serviceChange,
                };
            });

        return response;
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
}
