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
     * Decodes a message received from the message bus, based on the underlying implementation.
     * 
     * @param msgPayload the payload received from the message bus
     */
    decodeMessage(msgPayload: any): GaleMessage {

        try {
            
            return this.messageBus.decodeMessage(msgPayload);

        } catch (error) {

            // If there's a decoding error log and throw
            console.log(`Error decoding message ${JSON.stringify(msgPayload)}: ${error}`);
            throw error;

        }

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

    decodeMessage(msgPayload: any): GaleMessage;
    
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

    /**
     * Validates the message structure, to make sure that it is compliant with the interface of Gale Message.
     * @param message the message to validate
     */
    static validate(message: any): boolean {

        if (!message) {
            return false;
        }

        const { type, cid, timestamp, payload } = message;

        if (typeof type !== "string") return false;
        if (typeof cid !== "string") return false;
        if (typeof timestamp !== "number") return false;
        if (typeof payload !== "object") return false;

        return true;
    }
}

export type GaleMessageType = "task";