# sdm-pack-ecs: Using Deployment Listeners

ECS Deployment Listener(s) can be used to augment the built-in functionality of the ECS pack. Listeners can be scheduled both before and after
the actual deployment process (controllable with `events` in the ECSDeploymentListenerRegistration).  These listeners can be used for anything,
but are particularly useful for provisioning additional resources, updating the task and service definitions programmatically, updating the URL to
access the application from, or any other general logic that should be run before or after an ECS deployment.

Depending on when you schedule the listener you have different opportunities to modify behavior. When scheduled for a `before` event you will
be able to return an updated registration from the listener; which includes both the task and service definition.  By
updating this object you can modify the deployment specification using custom logic outside the pack. When you schedule a listener for an `after`
event, you can supply an updated `externalUrls` that will override the externalUrls the pack supplies by default.  Reasons for doing this would
typically be to represent your ingress machinery - ie the load balancer address and path you are putting in front of your ECS services.  In
addition, the `after` listener will also receive the `deployResult` object, which contains all the details of the created or
updated service.

### Example

Example listener definitions
```typescript
export const beforeListener: EcsDeploymentListenerRegistration = {
  name: "Example Before Listener",
  events: [GoalProjectListenerEvent.before],
  listener: async (p, r, event1, registration) => {
    // logic
    return {code: 0};
  },
};

export const afterListener: EcsDeploymentListenerRegistration = {
  name: "Example after Listener",
  events: [GoalProjectListenerEvent.after],
  listener: async (p, r, event1, registration, deployResult) => {
    // logic
    return {code: 0};
  },
};
```

Example assignment to goal
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
      })
        .withListener(beforeListener)
        .withListener(afterListener);
```

