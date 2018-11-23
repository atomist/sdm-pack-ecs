import { logger } from "@atomist/automation-client";
import { ECS } from "aws-sdk";

// Get a listing of active ARNs for the supplied task def family
export function ecsListTaskDefinitions(
  ecsService: ECS,
  ecsFamily: string,
): Promise<string[]> {
    return new Promise<string[]> ( async (resolve, reject) => {
        try {
          const data = await ecsService.listTaskDefinitionFamilies({status: "ACTIVE"}).promise();
          if (data.families.includes(ecsFamily)) {
            const result = await ecsService.listTaskDefinitions({familyPrefix: ecsFamily}).promise();
            resolve(result.taskDefinitionArns);
          } else {
            resolve([]);
          }
        } catch (error) {
            logger.debug(error);
            reject(error);
        }
    });
}

// Supply one of the entries from ecsListTaskDefinitions and get returned the json definition
export async function ecsGetTaskDefinition(
  ecsService: ECS,
  ecsTaskDef: string,
  ): Promise<ECS.Types.DescribeTaskDefinitionResponse> {
    return new Promise<ECS.Types.DescribeTaskDefinitionResponse>(async (resolve, reject) => {
      try {
          // If there was definitions, lets get the last one to compare with
          const tdfVersion = ecsTaskDef.split(":")[6];
          const tdfFamily = ecsTaskDef.split(":")[5].split("/")[1];
          const result = await ecsService.describeTaskDefinition({ taskDefinition: `${tdfFamily}:${tdfVersion}` }).promise();
          resolve(result);
      } catch (error) {
          logger.error(error);
          reject(error);
      }
    });
}

// Create a new service definition
export async function ecsRegisterTask(
  ecsService: ECS,
  ecsParams: ECS.Types.RegisterTaskDefinitionRequest): Promise<ECS.Types.TaskDefinition> {
    return new Promise<ECS.Types.TaskDefinition>(async (resolve, reject) => {
      try {
          const result = await ecsService.registerTaskDefinition(ecsParams).promise();
          resolve(result.taskDefinition);
      } catch (error) {
          logger.debug(error);
          reject(error);
      }
    });
}

// Compare two task definitions from left to right
//  ie; iterate keys of obj1 and see if they match in obj2
//  used to determine if a user supplied definition (which contains a subset of available keys)
//  matches an existing task definion revision
export function cmpSuppliedTaskDefinition(obj1: any, obj2: any): boolean {
    let notEqualCount = 0;
    Object.keys(obj1).forEach( k => {
      if ( obj2.hasOwnProperty(k)) {
        if (typeof(obj1[k]) === "object") {
            // If this is an object, iterate keys
            if (!cmpSuppliedTaskDefinition(obj1[k], obj2[k])) {
              notEqualCount += 1;
            }
        } else {
            // If its just a string do a straight comparision
            if (!(obj1[k] === obj2[k])) {
              notEqualCount += 1;
            }
        }
      } else {
          notEqualCount += 1;
      }
    });
    return notEqualCount > 0 ? false : true;
}
