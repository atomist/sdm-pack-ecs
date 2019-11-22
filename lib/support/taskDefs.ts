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
        logger.debug(`ecsRegisterTask => Registering new task for ${ecsParams.family}`);
        try {
          const result = await ecsService.registerTaskDefinition(ecsParams).promise();
          logger.debug(`ecsRegisterTask => Success creating new task for ${ecsParams.family}`);
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
      }
    });
    return notEqualCount > 0 ? false : true;
}
