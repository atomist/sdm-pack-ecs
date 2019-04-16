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

import { logger } from "@atomist/automation-client";
import {
    DeployableArtifact,
    ExecuteGoal,
    ExecuteGoalResult,
    GoalDetails,
    GoalInvocation,
} from "@atomist/sdm";
import _ = require("lodash");
import {
    EcsDeployer,
    EcsDeploymentInfo, EcsDeployRegistration,
} from "../goals/EcsDeploy";

// Execute an ECS deploy
//  *IF there is a task partion task definition, inject
export function executeEcsDeploy(registration: EcsDeployRegistration): ExecuteGoal {
    return async (goalInvocation: GoalInvocation): Promise<ExecuteGoalResult> => {
        const {sdmGoal, credentials, id, progressLog, configuration} = goalInvocation;

        // Validate image goal is present
        if (!sdmGoal.push.after.images ||
            sdmGoal.push.after.images.length < 1) {
            const msg = `ECS deploy requested but that commit has no Docker image: ${JSON.stringify(sdmGoal)}`;
            logger.error(msg);
            return { code: 1, message: msg };
        }

        const goalData = JSON.parse(sdmGoal.data);

        logger.info("Deploying project %s:%s to ECS in %s]", id.owner, id.repo, goalData.serviceRequest.cluster);

        const image: DeployableArtifact = {
            name: sdmGoal.repo.name,
            version: sdmGoal.push.after.sha,
            filename: sdmGoal.push.after.image.imageName,
            id,
        };

        const deployInfo: EcsDeploymentInfo = {
            name: sdmGoal.repo.name,
            description: sdmGoal.name,
            region: goalData.region,
            ...goalData.serviceRequest,
        };

        const deployments = await new EcsDeployer(configuration.sdm.projectLoader).deploy(
            image,
            {
                ...deployInfo,
                roleDetail: registration.roleDetail,
                credentialLookup: registration.credentialLookup,
            },
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
