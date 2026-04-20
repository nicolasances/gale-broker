import { APIOptions, SecretsManager, TotoControllerConfig } from "totoms";

const dbName = 'galebroker';
const collections = {
    agents: 'agents',
    tasks: 'tasks',
    flows: 'flows',
    branches: 'branches',
    conversations: 'conversations',
    conversationMessages: 'conversationMessages',
    conversationReasoning: 'conversationReasoning'
};

export class GaleConfig extends TotoControllerConfig {

    constructor(secretsManager: SecretsManager) {
        super(secretsManager);
    }

    getMongoSecretNames(): { userSecretName: string; pwdSecretName: string; } | null {
        return {
            userSecretName: 'gale-broker-mongo-user',
            pwdSecretName: 'gale-broker-mongo-pswd'
        };
    }

    getProps(): APIOptions {
        return {
            customAuthProvider: "toto",
        };
    }

    getDBName() { return dbName }
    getCollections() { return collections }

}