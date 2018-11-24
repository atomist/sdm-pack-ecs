import { EC2, ECS } from "aws-sdk";

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
