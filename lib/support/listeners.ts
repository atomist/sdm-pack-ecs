import {PushListenerInvocation, SdmListener} from "@atomist/sdm";
import {EcsDeployRegistration} from "../goals/EcsDeploy";

export interface EcsDeploymentListenerInvocation extends PushListenerInvocation {
    registration: EcsDeployRegistration;
}

export interface EcsDeploymentListenerResponse {
    /**
     * 0 for success, any non-zero is failing
     * Required.
     */
    code: number;

    /**
     * Message to add to the progressLog of the goal
     * Optional.
     */
    message?: string;

    /**
     * If you want to update the deployment registration, return an updated
     * version of the supplied EcsDeployRegistration.
     * Optional.
     */
    registration?: EcsDeployRegistration;
}

export type EcsDeploymentListener = SdmListener<EcsDeploymentListenerInvocation, EcsDeploymentListenerResponse>;

export interface EcsDeploymentListenerRegistration {
    name: string;
    listener: EcsDeploymentListener;
}
