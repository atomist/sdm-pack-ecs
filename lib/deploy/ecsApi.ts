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
    GitProject,
    logger,
    RemoteRepoRef,
} from "@atomist/automation-client";
import {
    AnyPush,
    doWithProject,
    ExecuteGoal,
    ExecuteGoalResult,
    GoalDetails,
    GoalInvocation,
    GoalProjectListenerEvent,
    PushListenerInvocation,
    serializeResult,
    updateGoal,
} from "@atomist/sdm";
import { ECS } from "aws-sdk";
import { createEcsSession } from "../EcsSupport";
import {
    EcsDeployer,
    EcsDeployment,
    EcsDeployRegistration,
} from "../goals/EcsDeploy";
import { ecsDataCallback } from "../support/ecsDataCallback";
import {
    EcsDeploymentListenerRegistration,
    EcsDeploymentListenerResponse,
} from "../support/listeners";
import { ecsRegisterTask } from "../support/taskDefs";

// Execute an ECS deploy
export function executeEcsDeploy(registration: EcsDeployRegistration, listeners: EcsDeploymentListenerRegistration[]): ExecuteGoal {
    return doWithProject(async goalInvocation => {
        const {goalEvent, id, progressLog} = goalInvocation;
        let computedRegistration = await ecsDataCallback(registration, goalEvent, goalInvocation.project);
        const newExternalUrls: GoalDetails["externalUrls"] = [];

        // Run before listeners
        const lrBeforeResult = await invokeEcsDeploymentListeners(
            listeners,
            goalInvocation,
            GoalProjectListenerEvent.before,
            goalInvocation.project,
            computedRegistration,
        );
        computedRegistration = lrBeforeResult.registration;
        if (lrBeforeResult.externalUrls) {
            newExternalUrls.push(...lrBeforeResult.externalUrls);
        }

        // Create new task def based on updated registration so long as we didn't find a match task definition
        // We can validate if we did by check if the taskDef has an ARN
        if (!computedRegistration.taskDefinition.hasOwnProperty("taskDefinitionArn")) {
            const ecs = await createEcsSession(registration.region, registration.roleDetail, registration.credentialLookup);
            const newTaskDefinition = await ecsRegisterTask(ecs, computedRegistration.taskDefinition);
            computedRegistration.serviceRequest = {
                ...computedRegistration.serviceRequest,
                taskDefinition: newTaskDefinition.taskDefinitionArn,
            };
        }

        // Update phase
        await updateGoal(
            goalInvocation.context,
            goalInvocation.goalEvent,
            {
                state: goalInvocation.goalEvent.state,
                description: goalInvocation.goalEvent.description,
                phase: "Executing",
            },
        );

        // Validate image goal is present
        if (!goalEvent.push.after.images ||
            goalEvent.push.after.images.length < 1) {
            const msg = `ECS deploy requested but that commit has no Docker image: ${JSON.stringify(goalEvent)}`;
            progressLog.write(msg);
            return { code: 1, message: msg };
        }

        progressLog.write(`Deploying project ${id.owner}:${id.repo} to ECS in ${computedRegistration.serviceRequest.cluster}`);

        const image: EcsDeployableArtifact = {
            name: goalEvent.repo.name,
            version: goalEvent.push.after.sha,
            filename: goalEvent.push.after.image.imageName,
            id,
        };

        let response: ExecuteGoalResult;
        let deployResult: EcsDeployment;
        try {
            deployResult = await new EcsDeployer().deploy(
                image,
                {
                    name: goalEvent.repo.name,
                    region: computedRegistration.region,
                    roleDetail: computedRegistration.roleDetail,
                    credentialLookup: computedRegistration.credentialLookup,
                },
                computedRegistration.serviceRequest as ECS.CreateServiceRequest,
                progressLog,
            );

            progressLog.write(`Endpoint details: ${JSON.stringify(deployResult.externalUrls)}`);
            const endpoints: GoalDetails["externalUrls"] = [];
            deployResult.externalUrls.map( e => {
                if (e) {
                    endpoints.push({url: e});
                }
            });

            response = {
                code: 0,
                externalUrls: endpoints,
            };
        } catch (e) {
            progressLog.write(`Deployment failed with error => ${e.message}`);
            response = {
                code: 1,
                message: e.message,
            };
        }

        // Run after listeners (if deploy succeeded)
        if (response.code === 0) {
            const lrAfterResult = await invokeEcsDeploymentListeners(
                listeners,
                goalInvocation,
                GoalProjectListenerEvent.after,
                goalInvocation.project,
                computedRegistration,
                deployResult,
            );

            // Merge listener results of external URLs
            if (lrAfterResult.externalUrls) {
                newExternalUrls.push(...lrAfterResult.externalUrls);
            }

            // If the listeners set externalUrls, override the default logic that builds them
            if (newExternalUrls && newExternalUrls.length > 0) {
                response = {
                    ...response,
                    externalUrls: newExternalUrls,
                };
            }
        }

        return response;
    });
}

export interface EcsDeployableArtifact {
    name: string;
    version: string;
    filename: string;
    id: RemoteRepoRef;
}

export async function invokeEcsDeploymentListeners(
    listeners: EcsDeploymentListenerRegistration[],
    gi: GoalInvocation,
    event: GoalProjectListenerEvent,
    p: GitProject,
    registration: EcsDeployRegistration,
    deployResult?: EcsDeployment,
): Promise<EcsDeploymentListenerResponse> {

    const pli: PushListenerInvocation = {
        addressChannels: gi.addressChannels,
        preferences: gi.preferences,
        configuration: gi.configuration,
        context: gi.context,
        credentials: gi.credentials,
        id: gi.id,
        project: p,
        push: gi.goalEvent.push,
    };

    let newRegistration = registration;
    let newExternalUrls: GoalDetails["externalUrls"];
    for (const l of listeners) {
        const pushTest = l.pushTest || AnyPush;
        const events = l.events || [GoalProjectListenerEvent.before, GoalProjectListenerEvent.after];
        if (events.includes(event) && await pushTest.mapping(pli)) {
            gi.progressLog.write("/--");
            gi.progressLog.write(`Invoking ${event} ECS Deployment Listener: ${l.name}`);

            await updateGoal(
                gi.context,
                gi.goalEvent,
                {
                    state: gi.goalEvent.state,
                    phase: l.name,
                    description: gi.goalEvent.description,
                });

            const result = await l.listener(p, gi, event, newRegistration, deployResult);

            gi.progressLog.write(`Result: ${serializeResult(result)}`);
            gi.progressLog.write("\\--");

            if (result.code !== 0) {
                return {
                    code: result.code,
                    message: result.message,
                };
            }

            // If this listener returned a registration update, replace registration - in it's entirety
            if (result.registration) {
                logger.debug(`invokeEcsDeploymentListeners: Registration was updated!`);
                newRegistration = result.registration;
            }

            if (result.externalUrls) {
                newExternalUrls ? newExternalUrls.push(...result.externalUrls) : newExternalUrls = result.externalUrls;
            }
        }
    }

    return {
        code: 0,
        registration: newRegistration,
        externalUrls: newExternalUrls,
    };
}
