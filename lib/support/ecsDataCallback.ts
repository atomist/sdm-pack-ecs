import { logger } from "@atomist/automation-client";
import { RepoContext, SdmGoalEvent} from "@atomist/sdm";
import { ECS } from "aws-sdk";
import { createEcsSession } from "../EcsSupport";
import { EcsDeploy, EcsDeployRegistration } from "../goals/EcsDeploy";
import { cmpSuppliedTaskDefinition, ecsGetTaskDefinition, ecsListTaskDefinitions, ecsRegisterTask } from "./taskDefs";

export function ecsDataCallback(
    ecsDeploy: EcsDeploy,
    registration: EcsDeployRegistration,
): (goal: SdmGoalEvent, context: RepoContext) => Promise<SdmGoalEvent> {
    return async (sdmGoal, ctx) => {
        return ecsDeploy.sdm.configuration.sdm.projectLoader.doWithProject({
            credentials: ctx.credentials, id: ctx.id, context: ctx.context, readOnly: true,
        }, async p => {

            // Set image string, example source value:
            //  <registry>/<author>/<image>:<version>"
            const imageString = sdmGoal.push.after.image.imageName.split("/").pop().split(":")[0];

            // Create or Update a task definition
            // Check for passed taskdefinition info, and update the container field
            let newTaskDef: ECS.Types.RegisterTaskDefinitionRequest = {
                family: "",
                containerDefinitions: [],
            };

            // If our registration doesn't include a task definition - generate a generic one
            if (!registration.taskDefinition) {
                // TODO: Check if there is an in-project configuration
                let dockerFile;
                if (p.hasFile("Dockerfile")) {
                            const d = await p.getFile("Dockerfile");
                            dockerFile = await d.getContent();
                } else {
                    throw Error("No task definition present and no dockerfile found!");
                }

                // Get Docker commands out
                const parser = require("docker-file-parser");
                const options = { includeComments: false };
                const commands = parser.parse(dockerFile, options);
                const exposeCommands = commands.filter((c: any) => c.name === "EXPOSE");

                if (exposeCommands.length > 1) {
                    throw new Error(`Unable to determine port for default ingress. Dockerfile in project ` +
                        `'${sdmGoal.repo.owner}/${sdmGoal.repo.name}' has more then one EXPOSE instruction: ` +
                        exposeCommands.map((c: any) => c.args).join(", "));
                } else if (exposeCommands.length === 1) {
                    newTaskDef.family = imageString;
                    // TODO: Expose the defaults below in client.config.json
                    newTaskDef.requiresCompatibilities = [ "FARGATE"];
                    newTaskDef.networkMode = "awsvpc";
                    newTaskDef.cpu = "256",
                    newTaskDef.memory = "0.5GB",

                    newTaskDef.containerDefinitions = [
                        {
                            name: imageString,
                            healthCheck: {
                                command: [
                                    "CMD-SHELL",
                                    `wget -O /dev/null http://localhost:${exposeCommands[0].args[0]} || exit 1`,
                                ],
                                startPeriod: 30,
                            },
                            image: sdmGoal.push.after.image.imageName,
                            portMappings: [{
                                containerPort: exposeCommands[0].args[0],
                                hostPort: exposeCommands[0].args[0],
                            }],
                        },
                    ];
                }
            } else {
                newTaskDef = registration.taskDefinition;
                newTaskDef.containerDefinitions.forEach( k => {
                    if (imageString === k.name) {
                        k.image = sdmGoal.push.after.image.imageName;
                    }
                    // TODO: Expose the defaults below in client.config.json
                    k.memory = k.hasOwnProperty("memory") && k.memory ? k.memory : 1024;
                    k.cpu = k.hasOwnProperty("cpu") && k.cpu ? k.cpu : 256;
                });
            }

            // Retrieve existing Task definitions, if we find a matching revision - use that
            //  otherwise create a new task definition
            const ecs = createEcsSession();

            // Pull latest def info & compare it to the latest
            let goodTaskDefinition: ECS.Types.TaskDefinition;
            const taskDefs = await ecsListTaskDefinitions(ecs, newTaskDef.family);
            let latestRev;
            await ecsGetTaskDefinition(ecs, taskDefs.pop())
                .then(v => {
                    latestRev = v;
                })
                .catch(() => {
                    logger.debug(`No task definitions found for ${newTaskDef.family}`);
                });

            // Compare latest def to new def
            // - if they differ create a new revision
            // - if they don't use the existing rev
            if (latestRev && !cmpSuppliedTaskDefinition(latestRev, newTaskDef)) {
                goodTaskDefinition = await ecsRegisterTask(ecs, newTaskDef);
            } else if (!latestRev) {
                goodTaskDefinition = await ecsRegisterTask(ecs, newTaskDef);
            } else {
                goodTaskDefinition = latestRev;
            }

            // IF there is a local definition (ie in-project configuration) override the values found here
            // TODO

            // Update Service Request with up to date task definition
            let newServiceRequest: ECS.Types.CreateServiceRequest;
            newServiceRequest = {
                ...registration.serviceRequest,
                serviceName: registration.serviceRequest ? registration.serviceRequest.serviceName : sdmGoal.repo.name,
                taskDefinition: `${goodTaskDefinition.family}:${goodTaskDefinition.revision}`,
            };

            return {
                ...sdmGoal,
                data: JSON.stringify({
                    serviceRequest: newServiceRequest,
                    taskDefinition: goodTaskDefinition,
                }),
            };
        });

    };
}
