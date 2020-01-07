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

import { configurationValue } from "@atomist/automation-client";
import { ECS } from "aws-sdk";

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

// This function takes a partial serviceRequest and populates enough to make it valid
// using the defaults supplied in client config
// tslint:disable-next-line:cyclomatic-complexity
export async function createValidServiceRequest(request: Partial<ECS.Types.CreateServiceRequest>): Promise<ECS.Types.CreateServiceRequest> {
    return {
        serviceName: request.hasOwnProperty("serviceName") && request.serviceName ? request.serviceName : undefined,
        launchType: request.hasOwnProperty("launchType") && request.launchType
            ? request.launchType : configurationValue<string>("sdm.aws.ecs.launch_type"),
        cluster: request.hasOwnProperty("cluster") && request.cluster
            ? request.cluster : configurationValue<string>("sdm.aws.ecs.cluster"),
        desiredCount: request.hasOwnProperty("desiredCount") && request.desiredCount
            ? request.desiredCount : configurationValue<number>("sdm.aws.ecs.desiredCount"),
        networkConfiguration: request.hasOwnProperty("networkConfiguration") && request.networkConfiguration
            ? request.networkConfiguration : configurationValue<any>("sdm.aws.ecs.networkConfiguration"),
    };
}
