import { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand, GetQueueUrlCommand } from '@aws-sdk/client-sqs';
import { GaleMessage, IMessageBus, IQueue } from '../../MessageBus';
import { Logger, ValidationError } from 'toto-api-controller';

export class SQSMessageBus extends IQueue {

    private client: SQSClient;
    private queueUrl: string | undefined;
    private isPolling: boolean = false;
    private logger = new Logger("gale-broker");
    private messageHandler: (msgPayload: any) => Promise<void>;

    constructor(private readonly queueName: string, private readonly region: string) {
        super(); 

        this.client = new SQSClient({ region: this.region });
        this.messageHandler = (msgPayload: any) => {throw new Error("Message handler not set"); };

        this.startPolling();
    }

    /**
     * Sets the message handler for the SQS messages.
     * 
     * @param handler the handler for the SQS messages
     */
    setMessageHandler(handler: (msgPayload: any) => Promise<void>): void {
        this.messageHandler = handler;
    }

    /**
     * Decodes the message received from SQS.
     * @param msgPayload the msg received by SQS. Messages received by SQS have the following structure: 
     * {
     *   "MessageId": "string",
     *   "ReceiptHandle": "string",
     *   "Body": "string"
     * }
     */
    decodeMessage(msgPayload: any): GaleMessage {

        const body = JSON.parse(msgPayload.Body || '{}');

        if (!GaleMessage.validate(body)) throw new ValidationError(400, "Invalid GaleMessage received from SQS. Received: " + JSON.stringify(body));

        return body as GaleMessage;

    }

    async initialize(): Promise<void> {

        const command = new GetQueueUrlCommand({ QueueName: this.queueName });

        const response = await this.client.send(command);

        this.queueUrl = response.QueueUrl;
    }

    async publishMessage(topic: string, message: any): Promise<void> {

        if (!this.queueUrl) {
            await this.initialize();
        }

        const command = new SendMessageCommand({
            QueueUrl: this.queueUrl,
            MessageBody: JSON.stringify(message),
        });

        await this.client.send(command);
    }

    async pollQueue(): Promise<any[]> {

        const command = new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 20,
        });

        const response = await this.client.send(command);

        return response.Messages || [];
    }

    /**
     * Starts polling the SQS queue for messages.
     */
    async startPolling(): Promise<void> {

        if (!this.queueUrl) {
            await this.initialize();
        }

        if (this.isPolling) {
            this.logger.compute("", 'Polling already started');
            return;
        }

        this.isPolling = true;
        this.logger.compute("", `Started polling SQS queue: ${this.queueName}`);

        while (this.isPolling) {

            try {
            
                const messages = await this.pollQueue();

                if (messages.length > 0) {

                    this.logger.compute("", `Received ${messages.length} message(s)`);

                    for (const msg of messages) {

                        // Call the handler
                        await this.messageHandler(msg);

                        // Delete message after logging
                        if (msg.ReceiptHandle) {

                            await this.client.send(
                                new DeleteMessageCommand({
                                    QueueUrl: this.queueUrl,
                                    ReceiptHandle: msg.ReceiptHandle,
                                })
                            );
                            this.logger.compute("", 'Message deleted from queue');
                        }
                    }
                }
            } catch (error) {
                
                this.logger.compute("", `Error polling SQS: ${error}`);

                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    }

    stopPolling(): void {
        
        this.logger.compute("", 'Stopping SQS polling');
        
        this.isPolling = false;
    }

    async close(): Promise<void> {
        
        this.stopPolling();
        
        this.client.destroy();
    }

}