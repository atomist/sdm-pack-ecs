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
import AWS = require("aws-sdk");
// @ts-ignore
import axios from "axios";
import { AWSCredentialLookup } from "../EcsSupport";

interface AwsMetaDataIamRole {
    AccessKeyId: string;
    SecretAccessKey: string;
    Token: string;
}

export const metadataAwsCreds: AWSCredentialLookup = async params => {
    const baseMetaUrlhttp = "http://169.254.169.254/latest/meta-data/iam/security-credentials/";
    const iamrole = configurationValue<string>("sdm.ecs.iamrole");
    const response = await axios.get<AwsMetaDataIamRole>(`${baseMetaUrlhttp}/${iamrole}`);
    return new AWS.ChainableTemporaryCredentials({
        masterCredentials: new AWS.Credentials({
            accessKeyId: response.data.AccessKeyId,
            secretAccessKey: response.data.SecretAccessKey,
            sessionToken: response.data.Token,
        }),
    });
};
