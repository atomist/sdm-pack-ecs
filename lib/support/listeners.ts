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

import {GitProject} from "@atomist/automation-client";
import {
    GoalInvocation,
    GoalProjectListenerEvent,
    PushListenerInvocation,
    PushTest,
    SdmListener,
} from "@atomist/sdm";
import { EcsDeployRegistration } from "../goals/EcsDeploy";

export interface EcsDeploymentListenerResponse {
    /**
     * 0 for success, any non-zero is failing
     * Required.
     */
    code: number;

    /**
     * Message to add to the progressLog of the goal
     * Optional.
     */
    message?: string;

    /**
     * If you want to update the deployment registration, return an updated
     * version of the supplied EcsDeployRegistration.
     * Optional.
     */
    registration?: EcsDeployRegistration;
}

export type EcsDeploymentListener = (p: GitProject, r: GoalInvocation, event: GoalProjectListenerEvent, registration: EcsDeployRegistration) => Promise<EcsDeploymentListenerResponse>;

export interface EcsDeploymentListenerRegistration {
    name: string;
    pushTest?: PushTest;
    events?: GoalProjectListenerEvent[];
    listener: EcsDeploymentListener;
}
