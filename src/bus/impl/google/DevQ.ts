import http from "request";
import { GaleMessage, IMessageBus } from "../../MessageBus";

/**
 * Implementation of MessageBus to use DevQ (local queue for local testing purposes only).
 * 
 * See https://github.com/nicolasances/devq.git
 */
export class DevQMessageBus implements IMessageBus {

    constructor(private queueEndpoint: string, private authToken: string) { }

    /**
     * This methods decodes the message received from DevQ. 
     * It assumes messages are sent as JSON, hence doens't do any decoding.
     * 
     * @param msgBody the message body. No encoding, provided as JSON.
     */
    decodeMessage(msgBody: any): GaleMessage {

        return msgBody as GaleMessage;
    }

    /**
     * Publishes an event to the topic passed in the constructor
     * @param id id of the object for which an event is published
     * @param eventType name of the event
     * @param msg message that describe the event
     * @param data optional additional JSON data to attach to the event
     * @returns Promise with the publishing result
     */
    async publishMessage(topicOrQueue: string, msgPayload: any): Promise<void> {

        return new Promise<void>((success, failure) => {

            http({
                uri: `${this.queueEndpoint}`,
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(msgPayload)
            }, (err: any, resp: any, body: any) => {


                if (err) {
                    console.log(err)
                    failure(err);
                    return;
                }

                success();
            })
        })

    }
}

