<p align="center">
  <img src="https://images.atomist.com/sdm/SDM-Logo-Dark.png">
</p>

# @atomist/sdk-pack-ecs

Atomist software delivery machine (SDM) extension pack providing the ability to deploy applications to AWS ECS environments.

See the [Atomist documentation][atomist-doc] for more information on
what SDMs are and what they can do for you using the Atomist API for
software.

# Purpose
This pack adds ECS deployment functionality to an Atomist SDM.  

# Usage
Install the dependency in your SDM project.

```
$ npm install @ipcrmdemo/sdm-pack-ecs
```

Then use its exporeted method to add the functionality to your SDM in your machine definition.

```
import { EcsDeploy, ecsSupport } from "@ipcrmdemo/sdm-pack-ecs";

export function machine(
    configuration: SoftwareDeliveryMachineConfiguration,
): SoftwareDeliveryMachine {

    const sdm: SoftwareDeliveryMachine = createSoftwareDeliveryMachine(
        { name: "My Software Delivery Machine", configuration },
    );

    sdm.addExtensionPacks(
        ecsSupport(),
    );
    return sdm;
};
```

# Usage
See [docs](docs/index.md)

