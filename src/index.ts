import { TotoAPIController, TotoControllerConfig } from "toto-api-controller";
import { GaleConfig } from "./Config";
import { RegisterAgent } from "./dlg/catalog/PostAgent";
import { PostTask } from "./dlg/PostTask";
import { UpdateAgent } from "./dlg/catalog/PutAgent";
import { PubSubMessageBus } from "./bus/impl/google/PubSub";
import { OnAgentEvent } from "./evt/dlg/OnAgentEvent";
import { DevQMessageBus } from "./bus/impl/google/DevQ";
import { GetTaskExecutionGraph } from "./dlg/tracking/GetTasksTracking";
import { SQSMessageBus } from "./bus/impl/aws/SQS";
import { IMessageBus, MessageBusFactory } from "./bus/MessageBus";
import { GetAgents } from "./dlg/catalog/GetAgents";
import { DeleteAgent } from "./dlg/catalog/DeleteAgent";
import { GetRootTasks } from "./dlg/tracking/GetRootTasks";

export const APINAME = "gale-broker";

class GaleMessageBusFactory extends MessageBusFactory {

    createMessageBus(config: TotoControllerConfig): IMessageBus {
        switch (config.hyperscaler) {
            case "aws":
                return new SQSMessageBus(process.env['SQS_QUEUE_URL']!, "eu-north-1")
            case "gcp":
                return new PubSubMessageBus();
            case "local":
                return new DevQMessageBus("http://localhost:8000/msg", config);
            default:
                throw new Error(`Unsupported hyperscaler: ${config.hyperscaler}`);
        }
    }
}

export const galeConfig = new GaleConfig({
    messageBusFactory: new GaleMessageBusFactory(), 
    apiName: APINAME
}, {
    defaultHyperscaler: "aws", 
    defaultSecretsManagerLocation: "aws"
});

const api = new TotoAPIController(galeConfig, { basePath: '/galebroker', port: process.env.HYPERSCALER == 'local' ? 8081 : 8080 });

// Endpoints related to Agent Catalog
api.path('POST', '/catalog/agents', new RegisterAgent(), { contentType: 'application/json', noAuth: true, ignoreBasePath: false }); // Temporary, until API-key based auth is implemented.
api.path('PUT', '/catalog/agents', new UpdateAgent(), { contentType: 'application/json', noAuth: true, ignoreBasePath: false });    // Temporary, until API-key based auth is implemented.
api.path('GET', '/catalog/agents', new GetAgents());
api.path('DELETE', '/catalog/agents/:taskId', new DeleteAgent());

// Endpoints related to Agent Executions
api.path('POST', '/tasks', new PostTask());
api.path('GET', '/tasks', new GetRootTasks())

api.path('GET', '/tasks/:correlationId/graph', new GetTaskExecutionGraph());

// Endpoints for async events (push pubsub-like brokers)
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