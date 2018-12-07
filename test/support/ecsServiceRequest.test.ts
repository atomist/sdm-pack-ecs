import { configurationValue } from "@atomist/automation-client";
import * as assert from "assert";
import { ECS } from "aws-sdk";
import { createUpdateServiceRequest, createValidServiceRequest } from "../../lib/support/ecsServiceRequest";

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
