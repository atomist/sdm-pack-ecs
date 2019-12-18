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

import { InMemoryProject } from "@atomist/automation-client";
import {
    SdmGoalEvent,
    SdmGoalState,
} from "@atomist/sdm";
import * as assert from "assert";
import { ECS } from "aws-sdk";
import { EcsDeployRegistration } from "../../lib/goals/EcsDeploy";
import {getFinalServiceDefinition, getFinalTaskDefinition} from "../../lib/support/ecsDataCallback";
import {createValidServiceRequest} from "../../lib/support/ecsServiceRequest";

// Note this dockerfile wouldn't actually work - its just for test purposes
const dummyDockerFile = `
FROM openjdk:8-alpine
MAINTAINER Atomist <docker@atomist.com>
RUN mkdir -p /opt/app
WORKDIR /opt/app
EXPOSE 8080
CMD ["-jar", "uuu001.jar"]
ENTRYPOINT ["/usr/local/bin/dumb-init"]
COPY target/dummy.jar dummy.jar
`;

const dummyDockerFileNoExpose = `
FROM openjdk:8-alpine
MAINTAINER Atomist <docker@atomist.com>
RUN mkdir -p /opt/app
WORKDIR /opt/app
CMD ["-jar", "uuu001.jar"]
ENTRYPOINT ["/usr/local/bin/dumb-init"]
COPY target/dummy.jar dummy.jar
`;

const dummyTaskDef: ECS.Types.RegisterTaskDefinitionRequest = {
    family: "foo",
    containerDefinitions: [
      {
        name: "dummy",
        healthCheck: {
          command: [
            "CMD-SHELL",
            "wget -O /dev/null http://localhost:8080 || exit 1",
          ],
          startPeriod: 30,
        },
        image: "registry.hub.docker.com/fakeowner/fakerepo:0.0.1-SNAPSHOT-master.20181130104224",
        portMappings: [
          {
            containerPort: 9000,
            hostPort: 9000,
          },
        ],
      },
    ],
    requiresCompatibilities: [
      "FARGATE",
    ],
    networkMode: "awsvpc",
    cpu: "512",
    memory: "512",
  };

const getDummySdmEvent = (): SdmGoalEvent => {
    return {
        name: "dummy",
        uniqueName: "dummy",
        environment: "dummy",
        sha: "1b2b37a0269a5501e4800ad6d6dfe9eaaf9b030c",
        ts: Date.now(),
        provenance: [],
        preConditions: [],
        branch: "master",
        goalSet: "dummy",
        goalSetId: "dummy",
        state: SdmGoalState.requested,
        fulfillment: {
            method: "dummy",
            name: "dummy",
        },
        repo: {
            owner: "fakeowner",
            name: "fakerepo",
            providerId: "empty",
        },
        push: {
            after: {
                image: {
                    imageName: "registry.hub.docker.com/fakeowner/fakerepo:0.0.1-SNAPSHOT-master.20181130104224",
                },
            },
        },
    };
};

describe("getFinalTaskDefinition", () => {
    before(fakeConfig);
    after(() => {
        delete (global as any).__runningAutomationClient;
    });

    describe("create final task definition from local project and default config", () => {
        it("should succeed", async () => {
            const dummySdmEvent: SdmGoalEvent = getDummySdmEvent();
            const p = InMemoryProject.of({ path: "Dockerfile", content: dummyDockerFile });
            const registration: EcsDeployRegistration = { region: "us-east-1"};
            const result = await getFinalTaskDefinition(p, dummySdmEvent, registration);
            const expectedResult = `
            {
                "family": "fakerepo",
                "containerDefinitions": [
                  {
                    "name": "fakerepo",
                    "image": "registry.hub.docker.com/fakeowner/fakerepo:0.0.1-SNAPSHOT-master.20181130104224",
                    "portMappings": [
                      {
                        "containerPort": 8080,
                        "hostPort": 8080
                      }
                    ],
                    "cpu": 256,
                    "memory": 512
                  }
                ],
                "requiresCompatibilities": [
                  "FARGATE"
                ],
                "networkMode": "awsvpc",
                "cpu": "256",
                "memory": "512"
              }
              `;

            assert.strictEqual(JSON.stringify(result), JSON.stringify(JSON.parse(expectedResult)));
        });

        it("should succeed with dockerfile in non-base", async () => {
            const dummySdmEvent: SdmGoalEvent = getDummySdmEvent();
            const p = InMemoryProject.of({ path: "test/Dockerfile", content: dummyDockerFile });
            const registration: EcsDeployRegistration = { region: "us-east-1"};
            const result = await getFinalTaskDefinition(p, dummySdmEvent, registration);
            const expectedResult = `
            {
                "family": "fakerepo",
                "containerDefinitions": [
                  {
                    "name": "fakerepo",
                    "image": "registry.hub.docker.com/fakeowner/fakerepo:0.0.1-SNAPSHOT-master.20181130104224",
                    "portMappings": [
                      {
                        "containerPort": 8080,
                        "hostPort": 8080
                      }
                    ],
                    "cpu":256,
                    "memory":512
                  }
                ],
                "requiresCompatibilities": [
                  "FARGATE"
                ],
                "networkMode": "awsvpc",
                "cpu": "256",
                "memory": "512"
              }
              `;

            assert.strictEqual(JSON.stringify(result), JSON.stringify(JSON.parse(expectedResult)));
        });

        it("should fail if the dockerfile has no expose ports", async () => {
            const dummySdmEvent: SdmGoalEvent = getDummySdmEvent();
            const p = InMemoryProject.of({ path: "Dockerfile", content: dummyDockerFileNoExpose });
            const registration: EcsDeployRegistration = { region: "us-east-1"};
            await getFinalTaskDefinition(p, dummySdmEvent, registration)
            .then()
            .catch(e => {
                /* tslint:disable:max-line-length */
                assert(e.message === "Unable to determine port for container. Dockerfile in project 'fakeowner/fakerepo' is missing an EXPOSE instruction or has more then 1.");
            });
        });
        it("should fail if the dockerfile does not exist", async () => {
            const dummySdmEvent: SdmGoalEvent = getDummySdmEvent();
            const p = InMemoryProject.of();
            const registration: EcsDeployRegistration = { region: "us-east-1"};
            await getFinalTaskDefinition(p, dummySdmEvent, registration)
                .then()
                .catch(e => {
                    /* tslint:disable:max-line-length */
                    assert.strictEqual(e.message, "No task definition present and no dockerfile found!");
                });
        });
    });

    describe("create final task definition from local project with invalid dockerfile", () => {
        it("should fail", async () => {
            const dummySdmEvent: SdmGoalEvent = getDummySdmEvent();
            const p = InMemoryProject.of({ path: "Dockerfile", content: "Dummy Dockefile" });
            const registration: EcsDeployRegistration = { region: "us-east-1" };
            await getFinalTaskDefinition(p, dummySdmEvent, registration)
                .then(result => {
                    assert.fail(
                        `Invalid Dockerfile was supplied, this shouldn't succeed.

                        Resulting task def: ${result}`,
                     );
                })
                .catch(error => {
                    assert.ok(error);
                });
        });
    });

    describe("create final task definition from local project and customized config", () => {
        it("should succeed", async () => {
            const dummySdmEvent: SdmGoalEvent = getDummySdmEvent();
            const p = InMemoryProject.of({ path: "Dockerfile", content: dummyDockerFile });
            const registration: EcsDeployRegistration = {
                region: "us-east-1",
                taskDefinition: dummyTaskDef,
            };
            const result = await getFinalTaskDefinition(p, dummySdmEvent, registration);
            const expectedResult = `
            {
                "family": "foo",
                "containerDefinitions": [
                  {
                    "name": "dummy",
                    "healthCheck":{"command":["CMD-SHELL","wget -O /dev/null http://localhost:8080 || exit 1"],"startPeriod":30},
                    "image": "registry.hub.docker.com/fakeowner/fakerepo:0.0.1-SNAPSHOT-master.20181130104224",
                    "portMappings": [
                      {
                        "containerPort": 9000,
                        "hostPort": 9000
                      }
                    ]
                  }
                ],
                "requiresCompatibilities": [
                  "FARGATE"
                ],
                "networkMode": "awsvpc",
                "cpu": "512",
                "memory": "512"
              }
              `;

            assert.strictEqual(JSON.stringify(result), JSON.stringify(JSON.parse(expectedResult)));
        });
    });
    describe("create final task definition from local project and customized in project config", () => {
        it("should fail on malformed JSON", async () => {
            const dummySdmEvent: SdmGoalEvent = getDummySdmEvent();
            const p = InMemoryProject.of(
                {path: "Dockerfile", content: dummyDockerFile },
                {path: ".atomist/ecs/task-definition.json", content: "{" },
            );
            const registration: EcsDeployRegistration = { region: "us-east-1"};
            return getFinalTaskDefinition(p, dummySdmEvent, registration)
                .catch(e => {
                    assert.strictEqual(e.message, "getFinalTaskDefinition: Failed to parse task-definition.json, error => \"Unexpected end of JSON input\"");
                });
        });
        it("should succeed", async () => {
            const dummySdmEvent: SdmGoalEvent = getDummySdmEvent();
            const p = InMemoryProject.of(
                {path: "Dockerfile", content: dummyDockerFile },
                {path: ".atomist/ecs/task-definition.json",
                    content: JSON.stringify(
                        { taskRoleArn: "arn:aws:iam::247672886355:role/ecsTaskECRRead", family: "foo", cpu: "1024", memory: "1024"})},
            );
            const registration: EcsDeployRegistration = { region: "us-east-1"};
            const result = await getFinalTaskDefinition(p, dummySdmEvent, registration);
            const expectedResult = `
            {
                "family": "foo",
                "containerDefinitions": [
                  {
                    "name": "fakerepo",
                    "image": "registry.hub.docker.com/fakeowner/fakerepo:0.0.1-SNAPSHOT-master.20181130104224",
                    "portMappings": [
                      {
                        "containerPort": 8080,
                        "hostPort": 8080
                      }
                    ],
                    "cpu":1024,
                    "memory":1024
                  }
                ],
                "requiresCompatibilities": [
                  "FARGATE"
                ],
                "networkMode": "awsvpc",
                "cpu": "1024",
                "memory": "1024",
                "taskRoleArn": "arn:aws:iam::247672886355:role/ecsTaskECRRead"
              }
              `;

            assert.strictEqual(JSON.stringify(result), JSON.stringify(JSON.parse(expectedResult)));
        });

        it("should succeed even with missing expose in the dockerfile", async () => {
            const dummySdmEvent: SdmGoalEvent = getDummySdmEvent();
            const p = InMemoryProject.of(
                {path: "Dockerfile", content: dummyDockerFileNoExpose },
                {path: ".atomist/ecs/task-definition.json",
                    content: JSON.stringify(
                        { taskRoleArn: "arn:aws:iam::247672886355:role/ecsTaskECRRead", family: "foo", cpu: "1024", memory: "1024"})},
            );
            const registration: EcsDeployRegistration = { region: "us-east-1"};
            const result = await getFinalTaskDefinition(p, dummySdmEvent, registration);
            const expectedResult = `
            {
                "family": "foo",
                "containerDefinitions": [
                  {
                    "name": "fakerepo",
                    "image": "registry.hub.docker.com/fakeowner/fakerepo:0.0.1-SNAPSHOT-master.20181130104224",
                    "portMappings": [],
                    "cpu":1024,
                    "memory":1024
                  }
                ],
                "requiresCompatibilities": [
                  "FARGATE"
                ],
                "networkMode": "awsvpc",
                "cpu": "1024",
                "memory": "1024",
                "taskRoleArn": "arn:aws:iam::247672886355:role/ecsTaskECRRead"
              }
              `;

            assert.strictEqual(JSON.stringify(result), JSON.stringify(JSON.parse(expectedResult)));
        });

        it("should patch nested objects", async () => {
            const dummySdmEvent: SdmGoalEvent = getDummySdmEvent();
            const p = InMemoryProject.of(
                {path: "Dockerfile", content: dummyDockerFileNoExpose },
                {path: ".atomist/ecs/task-definition.json",
                    content: JSON.stringify({
                        taskRoleArn: "arn:aws:iam::247672886355:role/ecsTaskECRRead",
                        family: "foo",
                        cpu: "1024",
                        memory: "1024",
                        containerDefinitions: [{
                            healthCheck: {
                                command: [
                                    "CMD-SHELL",
                                    "wget -O /dev/null http://fakehost1:8080 || exit 1",
                                ],
                            },
                        }],
                    },
                )},
            );
            const registration: EcsDeployRegistration = { region: "us-east-1"};
            const result = await getFinalTaskDefinition(p, dummySdmEvent, registration);
            const expectedResult = `
            {
                "family": "foo",
                "containerDefinitions": [
                  {
                    "name": "fakerepo",
                    "image": "registry.hub.docker.com/fakeowner/fakerepo:0.0.1-SNAPSHOT-master.20181130104224",
                    "portMappings": [],
                    "cpu":1024,
                    "memory":1024,
                    "healthCheck": {
                      "command": [
                        "CMD-SHELL",
                        "wget -O /dev/null http://fakehost1:8080 || exit 1"
                      ]
                    }
                  }
                ],
                "requiresCompatibilities": [
                  "FARGATE"
                ],
                "networkMode": "awsvpc",
                "cpu": "1024",
                "memory": "1024",
                "taskRoleArn": "arn:aws:iam::247672886355:role/ecsTaskECRRead"
              }
              `;

            assert.strictEqual(JSON.stringify(result), JSON.stringify(JSON.parse(expectedResult)));
        });
    });
});

describe("create final service definition from local project and customized in project config", () => {
    before(fakeConfig);
    after(() => {
        delete (global as any).__runningAutomationClient;
    });
    it("should load in-project configuration merged with the defaults", async () => {
        const registration: EcsDeployRegistration = { region: "us-east-1"};
        const p = InMemoryProject.of(
            {path: "Dockerfile", content: dummyDockerFileNoExpose },
            {path: ".atomist/ecs/service.json",
                content: JSON.stringify({
                        serviceName: "testservice",
                        networkConfiguration: {
                                awsvpcConfiguration: {
                                    securityGroups: ["sg-0959d9866b236ffff"],
                                    assignPublicIp: "DISABLED",
                                },
                            },
                        },
                )},
        );
        const result = await getFinalServiceDefinition(p, getDummySdmEvent(), registration);
        const expectedResult = {
            serviceName: "testservice",
            launchType: "FARGATE",
            cluster: "tutorial",
            desiredCount: 3,
            networkConfiguration: {
                awsvpcConfiguration: {
                    subnets: [
                        "subnet-02ddf34bfe7f6c19a",
                        "subnet-0c5bfb43a631bee45",
                    ],
                    securityGroups: [
                        "sg-0959d9866b236ffff",
                    ],
                    assignPublicIp: "DISABLED",
                },
            },
        };
        assert.strictEqual(JSON.stringify(result, undefined, 2), JSON.stringify(expectedResult, undefined, 2));
    });
    it("should create valid service request using the defaults", async () => {
        const registration: EcsDeployRegistration = { region: "us-east-1"};
        const p = InMemoryProject.of( {path: "Dockerfile", content: dummyDockerFileNoExpose });
        const result = await getFinalServiceDefinition(p, getDummySdmEvent(), registration);
        const expectedResult = {
            serviceName: "fakerepo",
            launchType: "FARGATE",
            cluster: "tutorial",
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
        assert.strictEqual(JSON.stringify(result, undefined, 2), JSON.stringify(expectedResult, undefined, 2));
    });
});

function fakeConfig(): void {
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
                            taskDefaults: {
                                cpu: 256,
                                memory: 512,
                                requiredCompatibilities: ["FARGATE"],
                                networkMode: "awsvpc",
                            },
                        },
                    },
                },
            },
        };
    }
