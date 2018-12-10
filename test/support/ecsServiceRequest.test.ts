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

import { configurationValue } from "@atomist/automation-client";
import * as assert from "assert";
import { ECS } from "aws-sdk";
import {
    createUpdateServiceRequest,
    createValidServiceRequest,
} from "../../lib/support/ecsServiceRequest";

describe("createUpdateServiceRequest", () => {
    describe("convert valid ecs createservicerequest to updateservicerequest", () => {
        it("should succeed", async () => {
            const request: ECS.Types.CreateServiceRequest = {
                serviceName: "testservice",
                taskDefinition: "testservice-task:1",
                cluster: "cluster",
                desiredCount: 3,
                deploymentConfiguration: undefined,
                networkConfiguration: {
                    awsvpcConfiguration: {
                        subnets: ["subnet-02ddf34bfe7f6c19a", "subnet-0c5bfb43a631bee45"],
                        securityGroups: ["sg-0959d9866b23698f2"],
                        assignPublicIp: "ENABLED",
                    },
                },
                platformVersion: undefined,
                healthCheckGracePeriodSeconds: undefined,
            };
            const result = await createUpdateServiceRequest(request);
            const expectedResult = {
                service: "testservice",
                taskDefinition: "testservice-task:1",
                forceNewDeployment: true,
                cluster: "cluster",
                desiredCount: 3,
                networkConfiguration: {
                  awsvpcConfiguration: {
                    subnets: [
                      "subnet-02ddf34bfe7f6c19a",
                      "subnet-0c5bfb43a631bee45",
                    ],
                    securityGroups: [
                      "sg-0959d9866b23698f2",
                    ],
                    assignPublicIp: "ENABLED",
                  },
                },
              };
            assert(JSON.stringify(result) === JSON.stringify(expectedResult));
        });
    });
});

describe("createValidServiceRequest", () => {
    describe("convert invalid ecs servicerequest to valid", () => {
        before(() => {
            (global as any).__runningAutomationClient = {
                configuration: {
                    sdm: {
                        aws: {
                            ecs: {
                                launch_type: "FARGATE",
                                cluster: "tutorial",
                                desiredCount: 3,
                                networkConfiguration: {
                                    awsvpcConfiguration: {
                                        subnets: ["subnet-02ddf34bfe7f6c19a", "subnet-0c5bfb43a631bee45"],
                                        securityGroups: ["sg-0959d9866b23698f2"],
                                        assignPublicIp: "ENABLED",
                                    },
                                },
                            },
                        },
                    },
                },
            };
        });

        after(() => {
            delete (global as any).__runningAutomationClient;
        });

        it("should create valid partial service request", async () => {
            const sr = { serviceName: "testservice" };
            const result = await createValidServiceRequest(sr);
            const expectedResult: Partial<ECS.Types.CreateServiceRequest> = {
                serviceName: "testservice",
                launchType: "FARGATE",
                cluster: "tutorial",
                desiredCount: 3,
                networkConfiguration: {
                    awsvpcConfiguration: {
                    subnets: ["subnet-02ddf34bfe7f6c19a", "subnet-0c5bfb43a631bee45"],
                    securityGroups: ["sg-0959d9866b23698f2"],
                    assignPublicIp: "ENABLED",
                    },
                },
            };

            assert(JSON.stringify(result) === JSON.stringify(expectedResult));
        });
    });
});
