import { MongoClient } from 'mongodb';
import { TotoControllerConfig, ValidatorProps, Logger, SecretsManager } from "toto-api-controller";
import { GaleMessageBus, IMessageBus, MessageBusFactory } from './bus/MessageBus';
import { TotoControllerConfigOptions } from 'toto-api-controller/dist/model/TotoControllerConfig';

const dbName = 'galebroker';
const collections = {
    agents: 'agents',
    tasks: 'tasks',
    agentExecutionStatus: 'agentExecutionStatus',
    subgroupTracking: 'subgroupTracking',
    flows: 'flows',
};

export class GaleConfig extends TotoControllerConfig {

    messageBus: GaleMessageBus;
    logger: Logger | undefined;

    private static mongoClient: MongoClient | null = null;
    private static mongoClientPromise: Promise<MongoClient> | null = null;

    private mongoUser: string | undefined;
    private mongoPwd: string | undefined;

    expectedAudience: string | undefined;
    totoAuthEndpoint: string | undefined;
    jwtSigningKey: string | undefined;

    constructor(options: GaleConfigOptions, totoControllerOptions: TotoControllerConfigOptions) {

        super({ apiName: options.apiName }, totoControllerOptions);

        // Initialize the message bus
        this.messageBus = new GaleMessageBus(options.messageBusFactory, this);

    }

    async load(): Promise<any> {

        const secretsManager = new SecretsManager(this.hyperscaler == 'local' ? 'aws' : this.hyperscaler, this.env, this.logger!);  // Use GCP Secrets Manager when local

        let promises = [];

        promises.push(super.load());

        promises.push(secretsManager.getSecret('gale-broker-mongo-user').then((value) => {
            this.mongoUser = value;
        }));
        promises.push(secretsManager.getSecret('gale-broker-mongo-pswd').then((value) => {
            this.mongoPwd = value;
        }));

        await Promise.all(promises);

    }

    getHyperscaler(): "aws" | "gcp" | "local" {
        return this.hyperscaler;
    }

    getSigningKey(): string {
        return String(this.jwtSigningKey);
    }

    getProps(): ValidatorProps {

        return {
            customAuthProvider: "toto",
        }
    }

    async getMongoClient() {

        if (GaleConfig.mongoClient) return GaleConfig.mongoClient;

        // If connection is in progress, wait for it
        if (GaleConfig.mongoClientPromise) return GaleConfig.mongoClientPromise;

        const mongoUrl = `mongodb://${this.mongoUser}:${this.mongoPwd}@${this.mongoHost}:27017/${dbName}`;

        GaleConfig.mongoClientPromise = new MongoClient(mongoUrl, {
            serverSelectionTimeoutMS: 5000,    // Fail fast on network issues
            socketTimeoutMS: 30000,            // Kill hung queries
            maxPoolSize: 80,                   // Up to 80 connections in the pool
        }).connect().then(client => {

            GaleConfig.mongoClient = client;
            GaleConfig.mongoClientPromise = null;

            return client;

        }).catch(error => {

            GaleConfig.mongoClientPromise = null;

            throw error;
        });

        return GaleConfig.mongoClientPromise;
    }

    /**
     * Closes the MongoDB connection pool.
     * Call this during application shutdown.
     */
    static async closeMongoClient(): Promise<void> {

        if (GaleConfig.mongoClient) {

            await GaleConfig.mongoClient.close();

            GaleConfig.mongoClient = null;
        }
    }

    getExpectedAudience(): string {

        return String(this.expectedAudience)

    }

    getDBName() { return dbName }
    getCollections() { return collections }

}


export interface GaleConfigOptions {

    messageBusFactory: MessageBusFactory;
    apiName: string;
}