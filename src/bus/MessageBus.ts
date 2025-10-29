import { GaleConfig } from "../Config";
import { AgentTaskRequest } from "../model/AgentTask";

/**
 * This module provides asynchronous messaging capabilities. 
 * It represents an INTERFACE to a message broker (e.g. GCP Pub/Sub, AWS SQS, RabbitMQ, etc.)
 * 
 * It is compatible with different message brokers via adapters.
 */
export class GaleMessageBus {

    private messageBus: IMessageBus;

    constructor(messageBusImpl: IMessageBus) { 
        this.messageBus = messageBusImpl;
    }

    /**
     * Publishes a task to the message bus for asynchronous processing.
     * @param task the task to publish
     * @param cid a correlation id for tracking
     */
    async publishTask(task: AgentTaskRequest, cid: string): Promise<void> {

        // Create the Message 
        const msg = new GaleMessage("task", cid, task);

        // Call the underlying message bus implementation
        return this.messageBus.publishMessage("galeagents", msg);
    }
}

export interface IMessageBus {

    publishMessage(topicOrQueue: string, msgPayload: any): Promise<void>;
    
}

/**
 * Represents a message to be sent via the Message Bus.
 */
export class GaleMessage {

    type: GaleMessageType;      // The type of message
    cid: string;                // A Correlation Id
    timestamp: number;          // A timestamp in milliseconds
    payload: any;               // The message payload

    constructor(type: GaleMessageType, cid: string, payload: any) {
        this.type = type;
        this.cid = cid;
        this.timestamp = Date.now();
        this.payload = payload;
    }
}

export type GaleMessageType = "task";