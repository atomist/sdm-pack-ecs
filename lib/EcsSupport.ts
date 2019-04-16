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
import {
    ConfigurationValueType,
    ExtensionPack,
    metadata,
} from "@atomist/sdm";
import AWS = require("aws-sdk");

export function ecsSupport(): ExtensionPack {
    return {
        ...metadata(),
        requiredConfigurationValues: [
            "sdm.aws.ecs.launch_type",
            "sdm.aws.ecs.cluster",
            "sdm.aws.accessKey",
            "sdm.aws.secretKey",
            {path: "sdm.aws.ecs.desiredCount", type: ConfigurationValueType.Number},

            /** -> Add these once supported (https://github.com/atomist/sdm/issues/580)
             * {path: "sdm.aws.ecs.networkConfiguration", type: ConfigurationValueType.Object},
             * {path: "sdm.aws.ecs.roleDetail", type: ConfigurationVaule.Object},
             */
        ],
        configure: sdm => {
            // TODO: Create service/task def files transform
            // TODO: First push offer to create ^^ files
            return sdm;
        },
    };
}

export type AWSCredentialLookup = (params?: AWS.STS.AssumeRoleRequest) => AWS.ChainableTemporaryCredentials;

export function getAwsCredentials(params?: AWS.STS.AssumeRoleRequest): AWS.ChainableTemporaryCredentials {
    const requestDetails = params ?
        params : configurationValue<AWS.STS.AssumeRoleRequest>("sdm.aws.ecs.roleDetail", {} as any); // As any to allow undefined
    return new AWS.ChainableTemporaryCredentials({
        params: requestDetails,
        masterCredentials: new AWS.Credentials({
            accessKeyId: configurationValue<string>("sdm.aws.accessKey"),
            secretAccessKey: configurationValue<string>("sdm.aws.secretKey"),
        }),
    });
}

export function createEcsSession(
    region: string,
    roleDetail?: AWS.STS.AssumeRoleRequest,
    credentialLookup: AWSCredentialLookup = getAwsCredentials,
): AWS.ECS {
    return new AWS.ECS({
        region,
        credentials: credentialLookup(roleDetail),
    });
}

export function createEc2Session(
    region: string,
    roleDetail?: AWS.STS.AssumeRoleRequest,
    credentialLookup: AWSCredentialLookup = getAwsCredentials,
): AWS.EC2 {
    return new AWS.EC2({
        region,
        credentials: credentialLookup(roleDetail),
    });
}
