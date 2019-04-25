import {logger} from "@atomist/automation-client";
import AWS = require("aws-sdk");
import {AWSCredentialLookup} from "../EcsSupport";

export const metadataAwsCreds: AWSCredentialLookup = params => {
    AWS.config.getCredentials(err => {
        if (err) {
            logger.error(err.stack);
            throw new Error(err.stack);
        }
    });
    return new AWS.ChainableTemporaryCredentials({
        masterCredentials: new AWS.Credentials({
            accessKeyId: AWS.config.credentials.accessKeyId,
            secretAccessKey: AWS.config.credentials.secretAccessKey,
            sessionToken: AWS.config.credentials.sessionToken,
        }),
    });
};
