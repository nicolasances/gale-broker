import { Logger } from "toto-api-controller";
import { GaleConfig } from "../Config";
import { AgentTaskRequest } from "../model/AgentTask";
import { GaleMessageHandler } from "../evt/handlers/GaleMessageHandler";

/**
 * This module provides asynchronous messaging capabilities. 
 * It represents an INTERFACE to a message broker (e.g. GCP Pub/Sub, AWS SQS, RabbitMQ, etc.)
 * 
 * It is compatible with different message brokers via adapters.
 */
export class GaleMessageBus {

    private messageBus: IMessageBus;

    constructor(factory: MessageBusFactory, config: GaleConfig) { 
        
        this.messageBus = factory.createMessageBus(config.getHyperscaler());

        if (this.messageBus instanceof IQueue) {
            
            // If the message bus is a queue, set up a message handler
            (this.messageBus as IQueue).setMessageHandler(this.handleMessage.bind(this));
        }
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

    /**
     * Handles the incoming message from the message bus. 
     * This is used for queue-like message buses (e.g., SQS, RabbitMQ).
     * 
     * @param msgPayload the payload of the message
     */
    async handleMessage(msgPayload: any): Promise<void> {

        // 1. Decode the Gale Message
        const galeMessage: GaleMessage = this.decodeMessage(msgPayload);

        // 2. Call the Gale Message Handler
        await new GaleMessageHandler().onMessage(galeMessage);

    }
}

/**
 * Factory for creating Message Bus instances based on the hyperscaler.
 */
export abstract class MessageBusFactory {

    abstract createMessageBus(hyperscaler: "aws" | "gcp" | "local"): IMessageBus; 
}

/**
 * Interface for Message Bus implementations (e.g., Pub/Sub, SQS, RabbitMQ). 
 * Use this interface for publish-subscribe style message buses (e.g., Pub/Sub).
 */
export abstract class IMessageBus {

    abstract publishMessage(topicOrQueue: string, msgPayload: any): Promise<void>;
    abstract decodeMessage(msgPayload: any): GaleMessage;
    
}

/**
 * Interface for Queue-like Message Buses (e.g., SQS, RabbitMQ)
 */
export abstract class IQueue extends IMessageBus {

    abstract setMessageHandler(handler: (msgPayload: any) => Promise<void>): void;

    /**
     * Used for cleanup during application shutdown.
     */
    abstract close(): Promise<void>;

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