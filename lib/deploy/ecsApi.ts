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
    RemoteRepoRef,
} from "@atomist/automation-client";
import {
    doWithProject,
    ExecuteGoal,
    ExecuteGoalResult,
    GoalDetails,
} from "@atomist/sdm";
import { ECS } from "aws-sdk";
import {
    EcsDeployer,
    EcsDeployRegistration,
} from "../goals/EcsDeploy";
import { ecsDataCallback } from "../support/ecsDataCallback";

// Execute an ECS deploy
//  *IF there is a task partion task definition, inject
export function executeEcsDeploy(registration: EcsDeployRegistration): ExecuteGoal {
    return doWithProject(async goalInvocation => {
        const {goalEvent, id, progressLog} = goalInvocation;
        const computedRegistration = await ecsDataCallback(registration, goalEvent, goalInvocation.project);

        // Need to run listeners here

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
        try {
            const result = await new EcsDeployer().deploy(
                image,
                {
                    name: goalEvent.repo.name,
                    region: computedRegistration.region,
                    roleDetail: registration.roleDetail,
                    credentialLookup: registration.credentialLookup,
                },
                computedRegistration.serviceRequest as ECS.CreateServiceRequest,
                progressLog,
            );

            progressLog.write(`Endpoint details: ${JSON.stringify(result.externalUrls)}`);
            const endpoints: GoalDetails["externalUrls"] = [];
            result.externalUrls.map( e => {
                endpoints.push({url: e});
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

        return response;
    });
}

export interface EcsDeployableArtifact {
    name: string;
    version: string;
    filename: string;
    id: RemoteRepoRef;
}
