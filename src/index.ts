import { TotoMicroservice, TotoMicroserviceConfiguration, SupportedHyperscalers, getHyperscalerConfiguration } from "totoms";
import { GaleConfig } from "./Config";
import { RegisterAgent } from "./dlg/catalog/PostAgent";
import { PostTask } from "./dlg/PostTask";
import { UpdateAgent } from "./dlg/catalog/PutAgent";
import { GetAgents } from "./dlg/catalog/GetAgents";
import { DeleteAgent } from "./dlg/catalog/DeleteAgent";
import { GetRootTasks } from "./dlg/tracking/GetRootTasks";
import { GetAgent } from "./dlg/catalog/GetAgent";
import { GetAgenticFlow } from "./dlg/tracking/GetAgenticFlow";
import { GetAgentExecutionRecord } from "./dlg/tracking/GetAgentExecutionRecord";
import { GaleMessageHandler } from "./evt/handlers/GaleMessageHandler";
import { PostConversationMessage } from "./dlg/PostConversationMessage";

const config: TotoMicroserviceConfiguration = {
    serviceName: "gale-broker",
    basePath: '/galebroker',
    port: process.env.GALE_BROKER_PORT ? parseInt(process.env.GALE_BROKER_PORT) : 8080,
    environment: {
        hyperscaler: (process.env.HYPERSCALER as SupportedHyperscalers) || "aws",
        hyperscalerConfiguration: getHyperscalerConfiguration()
    },
    customConfiguration: GaleConfig,
    apiConfiguration: {
        apiEndpoints: [
            // Agent Catalog
            { method: 'POST', path: '/catalog/agents', delegate: RegisterAgent },
            { method: 'PUT', path: '/catalog/agents', delegate: UpdateAgent },
            { method: 'GET', path: '/catalog/agents', delegate: GetAgents },
            { method: 'DELETE', path: '/catalog/agents/:taskId', delegate: DeleteAgent },
            { method: 'GET', path: '/catalog/agents/:taskId', delegate: GetAgent },

            // Agent Executions
            { method: 'POST', path: '/tasks', delegate: PostTask },
            { method: 'GET', path: '/tasks', delegate: GetRootTasks },
            { method: 'GET', path: '/tasks/:taskInstanceId', delegate: GetAgentExecutionRecord },

            // Conversations 
            { method: 'POST', path: '/messages', delegate: PostConversationMessage },

            // Agentic Flows
            { method: 'GET', path: '/flows/:correlationId', delegate: GetAgenticFlow },
        ]
    },
    messageBusConfiguration: {
        topics: [
            { logicalName: "galeagents", secret: "topic-name-gale-agents" }
        ],
        messageHandlers: [
            GaleMessageHandler
        ]
    }
};

TotoMicroservice.init(config).then((microservice: TotoMicroservice) => {
    microservice.start();
});