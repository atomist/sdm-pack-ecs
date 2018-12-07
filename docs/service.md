# sdm-pack-ecs: service configuration

When deploying to AWS ECS we must define a service definition that will be used to deploy our application to an ECS cluster.  Atomist automatically creates services (and their definitions) as part of an ECS deployment goal.

## Default behavior

There is a bare minimum of configuration you must supply to an ECS deployment goal.  Namely: the region, VPC info (although you can leverage the defaults in your configuration, see [configuration](configuration.md)), and the cluster name (again if it differs from the default).

Given the following definition of a goal:
```javascript
    const ecsDeployProduction = new EcsDeploy({
        displayName: "Deploy to ECS",
        uniqueName: "ecsDeployProduction",
        environment: "production",
        descriptions: {
            inProcess: "Deploying to ECS `prod`",
            completed: "Deploy to ECS `prod`",
        },
    })
        .with({
            pushTest: HasDockerfile,
            region: "us-east-1",
            serviceRequest: {
                cluster: "foo",
                networkConfiguration: {
                    awsvpcConfiguration: {
                        subnets: ["subnet-<id>", "subnet-<id>"],
                        securityGroups: ["sg-<id>"],
                        assignPublicIp: "ENABLED",
                    },
                },
            },
        });
```

Assuming a project (repo) name of `testing`, the resulting service definition will look like:

```json
{
    "service": "testing",
    "taskDefinition": "testing-task:1",
    "forceNewDeployment": true,
    "cluster": "foo",
    "desiredCount": 1,
    "networkConfiguration": {
        "awsvpcConfiguration": {
        "subnets": [
            "subnet-<id>",
            "subnet-<id>",
        ],
        "securityGroups": [
            "sg-<id>",
        ],
        "assignPublicIp": "ENABLED",
        },
    },
    };
}
```

## Customizing

To customize your service definition you can override any parameter found in the AWS parameter documentation, [here](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service_definition_parameters.html).  These customizations can be applied in two places - the `EcsDeploy` goal itself or from within the project.

### Customizing the `EcsDeploy` goal

If you desire to change the behavior for all projects that schedule a particular `EcsDeploy` goal, you should make your customizations on the goal (as opposed to per project).  To override any parameter simply include it in the `EcsDeploymentInfo` data within the `with` block:

```javascript
    const ecsDeployProduction = new EcsDeploy({
        displayName: "Deploy to ECS",
        uniqueName: "ecsDeployProduction",
        environment: "production",
        descriptions: {
            inProcess: "Deploying to ECS `prod`",
            completed: "Deploy to ECS `prod`",
        },
    })
        .with({
            pushTest: HasDockerfile,
            region: "us-east-1",
            serviceRequest: {
                <YOUR CUSTOM VALUE(S) HERE>: <value>,
                ...
                },
            },
        });
```

These values will be merged with the default service defintion displayed above.


### Customization from within the project

If you need to make unique modifications to individual projects, the best way to accomplish this is via in project configuration.  To customize the service definition in project, start by creating a `.atomist/ecs` folder in your project.  Create a `service.json` file.  To supply the configuration values to be merged with the default, simply popluate the JSON file with the required parameters.

Example:

`.atomist/ecs/service.json`:
```json
{
  "serviceName": "ufort",
  "desiredCount": 1,
  "launchType": "EC2",
  "cluster": "default",
  "networkConfiguration": {
    "awsvpcConfiguration": {
      "subnets": ["subnet-<id>", "subnet-<id>"],
      "securityGroups": ["sg-<id>"]
    }
  }
}
```