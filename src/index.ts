import { TotoAPIController } from "toto-api-controller";
import { GaleConfig } from "./Config";
import { RegisterAgent } from "./dlg/catalog/PostAgent";
import { PostTask } from "./dlg/PostTask";
import { UpdateAgent } from "./dlg/catalog/PutAgent";
import { PubSubMessageBus } from "./bus/impl/google/PubSub";
import { OnAgentEvent } from "./evt/dlg/OnAgentEvent";
import { DevQMessageBus } from "./bus/impl/google/DevQ";

// const galeConfig = new GaleConfig({messageBusImpl: new DevQMessageBus("http://localhost:8000/msg")});
const galeConfig = new GaleConfig({messageBusImpl: new PubSubMessageBus()});

const api = new TotoAPIController("gale-broker", galeConfig, { basePath: '/galebroker', port: 8080 });

// Endpoints related to Agent Catalog
api.path('POST', '/catalog/agents', new RegisterAgent(), { contentType: 'application/json', noAuth: true, ignoreBasePath: false }); // Temporary, until API-key based auth is implemented.
api.path('PUT', '/catalog/agents', new UpdateAgent(), { contentType: 'application/json', noAuth: true, ignoreBasePath: false });    // Temporary, until API-key based auth is implemented.

// Endpoints related to Agent Executions
api.path('POST', '/tasks', new PostTask());

// Endpoints for async events
api.path('POST', '/events/agent', new OnAgentEvent()); 


api.init().then(() => {
    api.listen();
});

const shutdown = async () => {

    console.log('Shutting down gracefully...');
    
    await GaleConfig.closeMongoClient();
    
    process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);