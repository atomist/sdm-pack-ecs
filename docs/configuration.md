# sdm-pack-ecs: Configuration

In order to make use of sdm-pack-ecs you will need a few things:

* A valid AWS Access key and Secret key with access to create/update/delete tasks and deployments (if not using credentials from metadata service with an IAM role)
* An existing ECS Cluster (EC2 or Fargate)

## SDM Configuration

Within your [Atomist client config](https://docs.atomist.com/developer/prerequisites/#user-configuration), we'll need to create some new entries for AWS.

**Required entries**:
* `secretKey`: String. The AWS Secret key associated with your account.
* `accessKey`: String. The AWS Access key associated with your account
  > Note: `secretKey` and `accessKey` are NOT required if you have assigned an IAM Role to the entity you are running the SDM on.  Those credentials will be automatically loaded.
  
* `ecs` (object)
  * `launch_type`: String.  The default ECS launch type for a service.  Valid values: `FARGATE` or `EC2`
  * `desiredCount`: String.  The number of tasks that should be created for a given service (if not defined elsewhere)

  > All of the entries listed below are defaults and can (and likely should) be overriden in your individual [task](task.md) and [service](service.md) definitions.

  * `cluster`: String.  The default cluster to use. If no other configuration was provided for the service, this value will be used.  See [service configuration](service.md) for details.
  * `networkConfiguration` (object)
    * `awsvpcConfiguration` (object)
        * `subnets`: Array.  Supply a default list of subnets to place your tasks in.  These subnets should be available in the VPC your cluster was created in.
        * `securityGroups`: Array.  Supply a default list of subnets to place your tasks into.  These security groups should be in the same VPC you created your cluster in.
        * `assignPublicIp`: String.  Valid `ENABLED` or `DISABLED`.  Should this task be given a public IP?  Only valid for Fargate launch type (ignored if launch type is EC2).
  * `taskDefaults` (object)
    * `cpu`: Number.  Supply a default value that will be given to ECS Task definitions that are either automatically generated or missing cpu configuration (which is required for Fargate)
    * `memory`: Number.  Supply a default value that will be given to ECS Task definitions that are either automatically generated or missing memory configuration (which is required for Fargate)
    * `requiredCompatibilities`: Array.  Provide the required compatibility for a given task.  Current ECS supports values of `EC2` or `FARGATE`.
    * `networkMode`: String. Provide the default docker network mode for a given task. The valid values are none, bridge, awsvpc, and host.  Fargate tasks require the use of `awsvpc`, however EC2 ECS clusters can use any mode.


Example:
```json
{
    [...]
    "sdm": {
        "aws": {
            "secretKey": "secret",
            "accessKey": "accesskey",
            "ecs": {
                "launch_type": "FARGATE",
                "cluster": "example",
                "desiredCount": 3,
                "networkConfiguration": {
                    "awsvpcConfiguration": {
                        "subnets": ["subnet-<id>", "subnet-<id>"],
                        "securityGroups": ["sg-<id>"],
                        "assignPublicIp": "ENABLED"
                    }
                }
                "taskDefaults": {
                    "cpu": 256,
                    "memory": 1024,
                    "requiredCompatibilities": ["FARGATE"],
                    "networkMode": "awsvpc"
                }
            }
        }
    }
}
```

## Deployment Goal
An example ECS deployment goal.  To learn more about goals, see the [docs](https://docs.atomist.com/developer/goal/).

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

## Relationship with Dockerbuild goal (or external builds)
In order to use the ECS deployment pack, you **must** have an image build process that executes prior to the deployment goal executing.  Specifically, there must be an `image-link` event submitted prior to the ECS deployment goal executed so that the required data is present for this pack to determine what image should be deployed.  If you're using the [sdm-pack-docker](https://github.com/atomist/sdm-pack-docker) this is done automatically on your behalf.  If you are using an external build system or your own image build process, you must implement the `image-link` event (see [postLinkImageWebhook](https://atomist.github.io/sdm-core/modules/_util_webhook_imagelink_.html#postlinkimagewebhook)).

## Assume Role support
Many organizations, if not all, utilize IAM roles to control access to specific functionality/features.  In order to utilize these roles, this extension pack supports assuming IAM roles.

There are two places you may configure the role information.  First, in the goal registration itself, example:

```typescript
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
        roleDetail: {
          RoleArn: "arn:aws:iam::222222222222:role/test_ecs_role",
          RoleSessionName: "ecs_example",
        },
      });
```

Alternatively, if you'd like to configure your IAM role globally (that is for all ECS deployment goals), you may do so in your configuration file:

```json
{
    [...]
    "sdm": {
        "aws": {
            "secretKey": "secret",
            "accessKey": "accesskey",
            "ecs": {
                "roleDetail": {
                  "RoleArn": "arn:aws:iam::222222222222:role/test_ecs_role",
                  "RoleSessionName": "ecs_example",
                },
                "launch_type": "FARGATE",
                "cluster": "example",
                "desiredCount": 3,
                "networkConfiguration": {
                    "awsvpcConfiguration": {
                        "subnets": ["subnet-<id>", "subnet-<id>"],
                        "securityGroups": ["sg-<id>"],
                        "assignPublicIp": "ENABLED"
                    }
                },
                "taskDefaults": {
                    "cpu": 256,
                    "memory": 1024,
                    "requiredCompatibilities": ["FARGATE"],
                    "networkMode": "awsvpc"
                }
            }
        }
    }
}
```
