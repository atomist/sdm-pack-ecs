import { configureLogging, MinimalLogging } from "@atomist/automation-client";
import * as assert from "assert";
import { cmpSuppliedTaskDefinition } from "../../lib/support/taskDefs";

configureLogging(MinimalLogging);

describe("cmpSuppliedTaskDefinition", () => {
    describe("compare two identical objects", () => {
        it("should return true", () => {
            const obj1 = { a: 1, b: 2, c: "string"};
            const obj2 = { a: 1, b: 2, c: "string"};
            const result = cmpSuppliedTaskDefinition(obj1, obj2);
            assert.strictEqual(result, true);
        });
    });

    describe("compare two tasks, first matching subset of second", () => {
        it("should return true", () => {
            // tslint:disable-next-line:max-line-length
            const newTask = JSON.parse(`
            {
                "family": "uuu001",
                "containerDefinitions": [
                  {
                    "name": "uuu001",
                    "healthCheck": {
                      "command": [
                        "CMD-SHELL",
                        "wget -O /dev/null http://localhost:8080 || exit 1"
                      ],
                      "startPeriod": 30
                    },
                    "image": "registry.hub.docker.com/ipcrm/uuu001:0.1.0-SNAPSHOT-master.20181129172431",
                    "portMappings": [
                      {
                        "containerPort": 8080,
                        "hostPort": 8080
                      }
                    ]
                  }
                ],
                "requiresCompatibilities": [
                  "FARGATE"
                ],
                "networkMode": "awsvpc",
                "cpu": "256",
                "memory": "512"
              }
            `);
            // tslint:disable-next-line:max-line-length
            const existingTask = JSON.parse(`
            {
                "taskDefinitionArn": "arn:aws:ecs:us-east-1:247672886355:task-definition/uuu001:78",
                "containerDefinitions": [
                  {
                    "name": "uuu001",
                    "image": "registry.hub.docker.com/ipcrm/uuu001:0.1.0-SNAPSHOT-master.20181129172431",
                    "cpu": 0,
                    "portMappings": [
                      {
                        "containerPort": 8080,
                        "hostPort": 8080,
                        "protocol": "tcp"
                      }
                    ],
                    "essential": true,
                    "environment": [],
                    "mountPoints": [],
                    "volumesFrom": [],
                    "healthCheck": {
                      "command": [
                        "CMD-SHELL",
                        "wget -O /dev/null http://localhost:8080 || exit 1"
                      ],
                      "interval": 30,
                      "timeout": 5,
                      "retries": 3,
                      "startPeriod": 30
                    }
                  }
                ],
                "family": "uuu001",
                "networkMode": "awsvpc",
                "revision": 78,
                "volumes": [],
                "status": "ACTIVE",
                "requiresAttributes": [
                  {
                    "name": "com.amazonaws.ecs.capability.docker-remote-api.1.18"
                  },
                  {
                    "name": "ecs.capability.task-eni"
                  },
                  {
                    "name": "com.amazonaws.ecs.capability.docker-remote-api.1.29"
                  },
                  {
                    "name": "ecs.capability.container-health-check"
                  }
                ],
                "placementConstraints": [],
                "compatibilities": [
                  "EC2",
                  "FARGATE"
                ],
                "requiresCompatibilities": [
                  "FARGATE"
                ],
                "cpu": "256",
                "memory": "512"
              }
            `);
            const result = cmpSuppliedTaskDefinition(newTask, existingTask);
            assert.strictEqual(result, true);
        });
    });

    describe("compare two objects, first non-matching subset of second", () => {
        it("should return false", () => {
            const obj1 = { a: 3};
            const obj2 = { a: 1, b: 2, c: "string"};
            const result = cmpSuppliedTaskDefinition(obj1, obj2);
            assert.strictEqual(result, false);
        });
    });

    describe("compare two objects, with no matching or conflicting keys", () => {
        it("should return true", () => {
            const obj1 = { y: 3};
            const obj2 = { a: 1, b: 2, c: "string"};
            const result = cmpSuppliedTaskDefinition(obj1, obj2);
            assert.strictEqual(result, true);
        });
    });
});
