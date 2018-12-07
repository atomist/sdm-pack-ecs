# sdm-pack-ecs: Task configuration

When deploying a service to ECS it is first neccessary to create a task definition that can be used by your service definition.  These task definitions are created (or updated) by Atomist as a ECS deployment goal is executed.


## Default behavior

This pack allows the automatic generation of task definitions based on the source Dockerfile.  Given no configuration, this pack will parse the Dockerfile and generate a task definition using the `EXPOSE` information.  For example, if your `EXPOSE` port is `8080`, your repo name is `foo`, and the docker build the pack will auto-generate a task that looks like this:

> Note: The docker image name is supplied from a previously executed build goal or external image link event

> Note: This example assumes your default launch type is set to Fargate

```json
 {
    "family": "foo",
    "containerDefinitions": [
      {
        "name": "foo",
        "healthCheck": {
          "command": [
            "CMD-SHELL",
            "wget -O /dev/null http://localhost:8080 || exit 1",
          ],
          "startPeriod": 30,
        },
        "image": "registry.hub.docker.com/foo/foo:foo",
        "portMappings": [
          {
            "containerPort": 8080,
            "hostPort": 8080,
          },
        ],
      },
    ],
    "requiresCompatibilities": [
      "FARGATE",
    ],
    "networkMode": "awsvpc",
    "cpu": "512",
    "memory": "512",
  };
```

## Customization
Task customization can be accomplished in the project itself.  For details on available configuration options review the AWS documentation for task definitions, [here](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html).  To customize the task definition, create a new folder in your project called `.atomist/ecs`.  Within the `ecs` directory create a file called `task-definition.json` and populate it with a JSON structure with the desired configuraiton values.

> **Important**: You may supply the entire task definition or only supply the customized portions required.  
> **Notice**: Special behavior is present for the `image` value within a `containerDefinition`.  The label (version) of the image that is used is managed by Atomist.  Whenever a new image is generated and a deployment goal is scheduled this value with be automatically updated.

Example customization:

`.atomist/ecs/task-definition.json`:

```json
{
    "family": "testing",
    "memory": "1024",
    "cpu": "256"
}
```

Would result in the following definition(same assumption on project name, etc as the default example):

```json
 {
    "family": "testing",
    "containerDefinitions": [
      {
        "name": "foo",
        "healthCheck": {
          "command": [
            "CMD-SHELL",
            "wget -O /dev/null http://localhost:8080 || exit 1",
          ],
          "startPeriod": 30,
        },
        "image": "registry.hub.docker.com/foo/foo:foo",
        "portMappings": [
          {
            "containerPort": 8080,
            "hostPort": 8080,
          },
        ],
      },
    ],
    "requiresCompatibilities": [
      "FARGATE",
    ],
    "networkMode": "awsvpc",
    "cpu": "256",
    "memory": "1024",
  };
```