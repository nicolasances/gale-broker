import { MongoClient } from 'mongodb';
import { TotoControllerConfig, ValidatorProps, Logger, SecretsManager } from "toto-api-controller";
import { GaleMessageBus, IMessageBus, MessageBusFactory } from './bus/MessageBus';

const dbName = 'galebroker';
const collections = {
    agents: 'agents',
    tasks: 'tasks',
};

export class GaleConfig implements TotoControllerConfig {

    messageBus: GaleMessageBus;
    logger: Logger | undefined;
    
    private static mongoClient: MongoClient | null = null;
    private static mongoClientPromise: Promise<MongoClient> | null = null;

    private env: string;
    private hyperscaler: "aws" | "gcp" | "local";

    private mongoUser: string | undefined;
    private mongoPwd: string | undefined;
    private mongoHost: string | undefined;

    expectedAudience: string | undefined;
    totoAuthEndpoint: string | undefined;
    jwtSigningKey: string | undefined;

    constructor(options: GaleConfigOptions) {

        this.hyperscaler = process.env.HYPERSCALER == 'aws' ? 'aws' : (process.env.HYPERSCALER == 'gcp' ? 'gcp' : 'local');

        let env = process.env.HYPERSCALER == 'aws' ? (process.env.ENVIRONMENT ?? 'dev') : process.env.GCP_PID;
        if (!env) env = 'dev';
        this.env = env;

        // Initialize the message bus
        this.messageBus = new GaleMessageBus(options.messageBusFactory, this);

    }

    async load(): Promise<any> {

        if (!process.env.ENVIRONMENT) this.logger?.compute("", `No environment provided, loading default configuration`);
        if (!process.env.HYPERSCALER) this.logger?.compute("", `No hyperscaler provided, loading default configuration`);

        this.logger?.compute("", `Loading configuration for environment [${this.env}] on hyperscaler [${this.hyperscaler}]`);

        const secretsManager = new SecretsManager(this.hyperscaler == 'local' ? 'gcp' : this.hyperscaler, this.env, this.logger!);  // Use GCP Secrets Manager when local

        let promises = [];

        promises.push(secretsManager.getSecret('toto-expected-audience').then((value) => {
            this.expectedAudience = value;
        }));
        promises.push(secretsManager.getSecret('jwt-signing-key').then((value) => {
            this.jwtSigningKey = value;
        }));
        promises.push(secretsManager.getSecret('gale-broker-mongo-user').then((value) => {
            this.mongoUser = value;
        }));
        promises.push(secretsManager.getSecret('gale-broker-mongo-pswd').then((value) => {
            this.mongoPwd = value;
        }));
        promises.push(secretsManager.getSecret('mongo-host').then((value) => {
            this.mongoHost = value;
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
}