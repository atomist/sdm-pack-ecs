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

import { GitProject } from "@atomist/automation-client";
import {
    GoalDetails,
    GoalInvocation,
    GoalProjectListenerEvent,
    PushTest,
} from "@atomist/sdm";
import {EcsDeployment, EcsDeployRegistration} from "../goals/EcsDeploy";

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

    /**
     * Given ECS provides many ways to handle ingress application traffic, you may reply with a custom
     * externalUrls array to provide the correct way to access the app.  By default, the ECS pack searches the
     * deployment result to see if public IP(s) have been assigned and returns that as the url.
     * Optional.
     */
    externalUrls?: GoalDetails["externalUrls"];
}

/**
 * ECS Deployment Listener(s) can be used to augment the built-in functionality of the ECS pack. Listeners can be scheduled both before and after
 * the actual deployment process (controllable with `events` in the ECSDeploymentListenerRegistration).  These listeners can be used for anything,
 * but are particularly useful for provisioning additional resources, updating the task and service definitions programmatically, updating the URL to
 * access the application from, or any other general logic that should be run before or after an ECS deployment.
 *
 * Depending on when you schedule the listener you have different opportunities to modify behavior. When scheduled for a `before` event you will
 * be able to return an updated registration from the listener; which includes both the task and service definition.  By
 * updating this object you can modify the deployment specification using custom logic outside the pack. When you schedule a listener for an `after`
 * event, you can supply an updated `externalUrls` that will override the externalUrls the pack supplies by default.  Reasons for doing this would
 * typically be to represent your ingress machinery - ie the load balancer address and path you are putting in front of your ECS services.  In
 * addition, the `after` listener will also receive the `deployResult` object, which contains all the details of the created or
 * updated service.
 *
 * @param p {GitProject}
 * @param r {GoalInvocation}
 * @param event {GoalProjectListenerEvent}
 * @param registration {EcsDeployRegistration}
 * @param deployResult {EcsDeployment}
 */
export type EcsDeploymentListener = (p: GitProject, r: GoalInvocation, event: GoalProjectListenerEvent, registration: EcsDeployRegistration, deployResult?: EcsDeployment) => Promise<EcsDeploymentListenerResponse>;

export interface EcsDeploymentListenerRegistration {
    name: string;
    pushTest?: PushTest;
    events?: GoalProjectListenerEvent[];
    listener: EcsDeploymentListener;
}
