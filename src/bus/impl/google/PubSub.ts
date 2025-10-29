
import { PubSub, Topic } from "@google-cloud/pubsub";
import { IMessageBus } from "../../MessageBus";

let pubsubClient: PubSub | null = null;
const topics = new Map<string, TopicWrapper>();

function getPubSubClient(): PubSub {
    if (!pubsubClient) {
        pubsubClient = new PubSub({ projectId: process.env.GCP_PID });
    }
    return pubsubClient;
}

/**
 * Manages the publishing of an event
 */
export class PubSubMessageBus implements IMessageBus {

    topic: TopicWrapper | null | undefined = null;

    /**
     * Publishes an event to the topic passed in the constructor
     * @param id id of the object for which an event is published
     * @param eventType name of the event
     * @param msg message that describe the event
     * @param data optional additional JSON data to attach to the event
     * @returns Promise with the publishing result
     */
    async publishMessage(topicOrQueue: string, msgPayload: any): Promise<void> {

        this.topic = topics.get(topicOrQueue);

        if (!this.topic) {
            const pubsub = getPubSubClient();
            this.topic = new TopicWrapper(topicOrQueue, pubsub.topic(topicOrQueue));
            topics.set(topicOrQueue, this.topic);
        }

        // Push message to PubSub
        let message = JSON.stringify(msgPayload);

        await this.topic!.topic.publishMessage({ data: new Uint8Array(Buffer.from(message)) });

    }
}

class TopicWrapper {

    topicName: string;
    topic: Topic;

    constructor(topicName: string, topic: Topic) {
        this.topicName = topicName;
        this.topic = topic;
    }
}

