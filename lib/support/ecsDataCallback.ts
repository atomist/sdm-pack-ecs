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
    Project,
} from "@atomist/automation-client";
import {
    RepoContext,
    SdmGoalEvent,
} from "@atomist/sdm";
import { ECS } from "aws-sdk";
import * as path from "path";
import { createEcsSession } from "../EcsSupport";
import {
    EcsDeploy,
    EcsDeployRegistration,
} from "../goals/EcsDeploy";
import { createValidServiceRequest } from "./ecsServiceRequest";
import {
    cmpSuppliedTaskDefinition,
    ecsGetTaskDefinition,
    ecsListTaskDefinitions,
    ecsRegisterTask,
} from "./taskDefs";

export function getImageString(sdmGoal: SdmGoalEvent): string {
    return sdmGoal.push.after.image.imageName.split("/").pop().split(":")[0];
}

export function ecsDataCallback(
    ecsDeploy: EcsDeploy,
    registration: EcsDeployRegistration,
): (goal: SdmGoalEvent, context: RepoContext) => Promise<SdmGoalEvent> {
    return (sdmGoal, ctx) => {
        return ecsDeploy.sdm.configuration.sdm.projectLoader.doWithProject({
            credentials: ctx.credentials, id: ctx.id, context: ctx.context, readOnly: true,
        }, async p => {
            // Merge task definition configurations together - SDM Goal registration and in project
            //   in-project wins
            const newTaskDef = await getFinalTaskDefinition(p, sdmGoal, registration);

            // Populate service request
            //   Load any in project config and merge with default generated; in project wins
            const tempServiceRequest = await createValidServiceRequest(
                registration.hasOwnProperty("serviceRequest")
                    && registration.serviceRequest ? registration.serviceRequest : {},
            );
            const inProjectSr = await readEcsServiceSpec(p, "service.json");
            const validServiceRequest = {...tempServiceRequest, ...inProjectSr};

            // Retrieve existing Task definitions, if we find a matching revision - use that
            //  otherwise create a new task definition
            const ecs = await createEcsSession(registration.region, registration.roleDetail, registration.credentialLookup);

            // Pull latest def info & compare it to the latest
            let goodTaskDefinition: ECS.Types.TaskDefinition;
            const taskDefs = await ecsListTaskDefinitions(ecs, newTaskDef.family);
            let latestRev;
            await ecsGetTaskDefinition(ecs, taskDefs.pop())
                .then(v => {
                    latestRev = v.taskDefinition;
                })
                .catch(() => {
                    logger.debug(`No task definitions found for ${newTaskDef.family}`);
                });

            // Compare latest def to new def
            // - if they differ create a new revision
            // - if they don't use the existing rev
            logger.debug(`Latest Task Def: ${JSON.stringify(latestRev)}`);
            logger.debug(`New Task Def: ${JSON.stringify(newTaskDef)}`);
            if (latestRev !== undefined && cmpSuppliedTaskDefinition(newTaskDef, latestRev)) {
                logger.debug(`Using existing task definition: ${latestRev}`);
                goodTaskDefinition = latestRev;
            } else {
                goodTaskDefinition = await ecsRegisterTask(ecs, newTaskDef);
                logger.debug(`Created new task definition: ${goodTaskDefinition}`);
            }

            // Update Service Request with up to date task definition
            let newServiceRequest: ECS.Types.CreateServiceRequest;
            newServiceRequest = {
                ...validServiceRequest,
                serviceName: validServiceRequest.serviceName ? validServiceRequest.serviceName : sdmGoal.repo.name,
                taskDefinition: `${goodTaskDefinition.family}:${goodTaskDefinition.revision}`,
            };

            logger.debug(`Log sdmGoal data: ${JSON.stringify({
                serviceRequest: newServiceRequest,
                taskDefinition: goodTaskDefinition,
                region: registration.region,
            })}`);

            return {
                ...sdmGoal,
                data: JSON.stringify({
                    serviceRequest: newServiceRequest,
                    taskDefinition: goodTaskDefinition,
                    region: registration.region,
                }),
            };
        });
    };
}

export async function getSpecFile(p: Project, name: string):
    Promise<JSON | undefined> {
        return new Promise<JSON | undefined>(async (resolve, reject) => {
            const specPath = path.join(".atomist", "ecs", name);
            try {
                const specFile = await p.getFile(specPath);
                if (specFile) {
                    const spec = await specFile.getContent();
                    resolve(JSON.parse(spec));
                } else {
                    resolve(undefined);
                }
            } catch (e) {
                logger.warn(`Failed to read spec file ${specPath}: ${e.message}`);
                reject(e.message);
            }
        });
    }

export async function readEcsServiceSpec(p: Project, name: string):
    Promise<Partial<ECS.Types.CreateServiceRequest>> {
    return new Promise<Partial<ECS.Types.CreateServiceRequest>>(async (resolve, reject) => {
        resolve(getSpecFile(p, name) as Partial<ECS.Types.CreateServiceRequest>);
    });
}

export async function readEcsTaskSpec(p: Project, name: string):
    Promise<Partial<ECS.Types.RegisterTaskDefinitionRequest>> {
    return new Promise<Partial<ECS.Types.RegisterTaskDefinitionRequest>>(async (resolve, reject) => {
        resolve(getSpecFile(p, name) as Partial<ECS.Types.RegisterTaskDefinitionRequest>);
    });
}

export async function getFinalTaskDefinition(
    p: Project,
    sdmGoal: SdmGoalEvent,
    registration: EcsDeployRegistration): Promise<ECS.Types.RegisterTaskDefinitionRequest> {
        return new Promise<ECS.Types.RegisterTaskDefinitionRequest>(async (resolve, reject) => {
            // Set image string, example source value:
            //  <registry>/<author>/<image>:<version>"
            const imageString = getImageString(sdmGoal);

            // Create or Update a task definition
            // Check for passed taskdefinition info, and update the container field
            let newTaskDef: ECS.Types.RegisterTaskDefinitionRequest = {
                family: "",
                containerDefinitions: [],
            };

            // Check if there is an in-project configuration
            // .atomist/task-definition.json
            const inProjectTaskDef = await readEcsTaskSpec(p, "task-definition.json");

            // If our registration doesn't include a task definition - generate a generic one
            if (!registration.taskDefinition && inProjectTaskDef === undefined) {
                let dockerFile;
                if (p.hasFile("Dockerfile")) {
                            const d = await p.getFile("Dockerfile");
                            dockerFile = await d.getContent();
                } else {
                    reject("No task definition present and no dockerfile found!");
                }

                // Get Docker commands out
                const parser = require("docker-file-parser");
                const options = { includeComments: false };
                const commands = parser.parse(dockerFile, options);
                const exposeCommands = commands.filter((c: any) => c.name === "EXPOSE");

                if (exposeCommands.length !== 1) {
                    reject(`Unable to determine port for default ingress. Dockerfile in project ` +
                        `'${sdmGoal.repo.owner}/${sdmGoal.repo.name}' has more then one EXPOSE instruction: ` +
                        exposeCommands.map((c: any) => c.args).join(", "));
                } else {
                    newTaskDef.family = imageString;
                    // TODO: Expose the defaults below in client.config.json
                    newTaskDef.requiresCompatibilities = [ "FARGATE"];
                    newTaskDef.networkMode = "awsvpc";
                    newTaskDef.cpu = "256",
                    newTaskDef.memory = "512",

                    newTaskDef.containerDefinitions = [
                        {
                            name: imageString,
                            healthCheck: {
                                command: [
                                    "CMD-SHELL",
                                    `wget -O /dev/null http://localhost:${exposeCommands[0].args[0]} || exit 1`,
                                ],
                                startPeriod: 30,
                            },
                            image: sdmGoal.push.after.image.imageName,
                            portMappings: [{
                                containerPort: parseInt(exposeCommands[0].args[0], 10),
                                hostPort: parseInt(exposeCommands[0].args[0], 10),
                            }],
                        },
                    ];
                }
                resolve(newTaskDef);
            } else {

                if (inProjectTaskDef !== undefined) {
                    // Merge in project config onto black definition
                    newTaskDef = {...newTaskDef, ...inProjectTaskDef};
                } else {
                    newTaskDef = registration.taskDefinition;
                }

                newTaskDef.containerDefinitions.forEach( k => {
                    if (imageString === k.name) {
                        k.image = sdmGoal.push.after.image.imageName;
                    }
                    // TODO: Expose the defaults below in client.config.json
                    k.memory = k.hasOwnProperty("memory") && k.memory ? k.memory : 512;
                    k.cpu = k.hasOwnProperty("cpu") && k.cpu ? k.cpu : 256;
                });
                resolve(newTaskDef);
            }
        });
    }
