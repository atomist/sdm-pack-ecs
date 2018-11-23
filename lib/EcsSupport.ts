/*
 * Copyright © 2018 Atomist, Inc.
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
    ConfigurationValueType,
    ExtensionPack,
    metadata,
} from "@atomist/sdm";

export function ecsSupport(): ExtensionPack {
    return {
        ...metadata(),
        requiredConfigurationValues: [
            "sdm.aws.ecs.default.launch_type",
            "sdm.aws.ecs.default.cluster",
            {path: "sdm.aws.ecs.default.desiredCount", type: ConfigurationValueType.Number},
        ],
        configure: sdm => {
            // TODO: Create service/task def files transform
            // TODO: First push offer to create ^^ files
            return sdm;
        },
    };
}
