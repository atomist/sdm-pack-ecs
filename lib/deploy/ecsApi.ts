import { logger } from "@atomist/automation-client";
import { DeployableArtifact, ExecuteGoal, ExecuteGoalResult, GoalDetails, GoalInvocation } from "@atomist/sdm";
import _ = require("lodash");
import { EcsDeployer, EcsDeploymentInfo } from "../goals/EcsDeploy";

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

        const deployInfo: EcsDeploymentInfo = {
            name: sdmGoal.repo.name,
            description: sdmGoal.name,
            region: _.get(sdmGoal.data, "region"),
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
