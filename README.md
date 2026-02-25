# Gale Broker

This service is part of [Gale](https://github.com/nicolasances/gale), a framework to run AI Agents. 

## What it does

Gale Broker is composed of two main services: 

1. **Agents Catalog** - a catalog of agents that can be used in an agentic flow. <br>
Will eventually be *split into its own service** if needed.

2. **Agents Execution** - Tasks for agents registered in Gale can be sent to Gale Broker. The Broker will 
    * find the right agent and send the task to the agent
    * monitor the execution of the agent
    * provide endpoints for external monitoring, if needed (e.g. dashboard)


## How to run it locally
It is possible to run Gale Broker locally, usually to test agents when developing them locally. 

To do that you need the following: 

### Prerequisites

1. **MongoDB** — Gale Broker stores agent definitions, conversations, and task records in MongoDB. Make sure a MongoDB instance is reachable and set the following environment variables with credentials for the `galebroker` database:
   - `MONGO_USER` (or the secret `gale-broker-mongo-user` in your secrets manager)
   - `MONGO_PWD` (or the secret `gale-broker-mongo-pswd` in your secrets manager)

2. **Message Bus** — For local testing, use [DevQ](https://github.com/nicolasances/devq):
   - Start DevQ and set `LOCAL_DEVQ_ENDPOINT` to its endpoint (e.g. `http://localhost:8000/msg`).
   - If that variable is set, Gale Broker will automatically use DevQ instead of a cloud message bus.
   - Check the [DevQ documentation](https://github.com/nicolasances/devq) for how to run DevQ.

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GALE_BROKER_PORT` | No | `8080` | Port on which Gale Broker listens |
| `LOCAL_DEVQ_ENDPOINT` | No | — | DevQ endpoint (e.g. `http://localhost:8000/msg`). Required for local development when not using a cloud message bus. |
| `USE_DEVQ` | No | — | Set to any truthy value to force DevQ usage (alternative to `LOCAL_DEVQ_ENDPOINT`) |

### Starting the server

```bash
npm install
npm run dev
```

`npm run dev` uses `nodemon` and will automatically reload when source files change, making it ideal for development.


## How to use GaleBroker for Conversational Agents

Conversational Agents are agents that engage in back-and-forth dialogue with a user. Gale Broker acts as the message router between clients (e.g. a frontend) and the agent.

### Conversation flow

```
Client                    Gale Broker              Agent
  │                           │                      │
  │── POST /messages ────────>│                      │
  │   (actor: "user")         │                      │
  │<─ { conversationId } ─────│                      │
  │                           │── (message bus) ────>│
  │                           │                      │── processes message
  │                           │<─ POST /messages ────│
  │   (SSE stream)            │   (actor: "agent")   │
  │<══ GET /conversations/    │                      │
       :conversationId/stream │                      │
```

1. **Client posts a user message** — `POST /galebroker/messages` with `actor: "user"`. Gale Broker stores the message and publishes an event to the message bus.
2. **Gale Broker delivers the message to the agent** — The message bus event triggers Gale Broker to forward the message to the agent's registered endpoint (see `messagesPath` in the agent definition).
3. **Agent processes the message and posts a response** — The agent calls `POST /galebroker/messages` with `actor: "agent"`.
4. **Client receives the response** — The client subscribes to the SSE stream and receives the agent's message(s) in real time.

### Step 1 — Register a conversational agent

Before sending messages, register the agent in the Gale Broker catalog:

```http
POST /galebroker/catalog/agents
Content-Type: application/json

{
  "agentDefinition": {
    "agentType": "conversational",
    "agentId": "suppie",
    "name": "Suppie",
    "description": "A supermarket shopping list assistant",
    "endpoint": {
      "baseURL": "http://localhost:8081",
      "messagesPath": "/messages"
    }
  }
}
```

| Field | Required | Description |
|---|---|---|
| `agentType` | Yes | Must be `"conversational"` for conversational agents |
| `agentId` | Yes | Unique, human-readable identifier for the agent |
| `name` | Yes | Display name of the agent |
| `endpoint.baseURL` | Yes | Base URL where the agent is running |
| `endpoint.messagesPath` | No | Path for receiving messages (default: `/messages`) |

### Step 2 — Subscribe to the conversation stream (SSE)

Open a Server-Sent Events (SSE) connection to receive agent responses in real time:

```http
GET /galebroker/conversations/:conversationId/stream
Accept: text/event-stream
```

The stream emits two event types:
- **`message`** — A new message from the agent: `{ message: "<text>" }`
- **`done`** — The conversation stream is complete (agent sent its last message, or a timeout occurred)

The stream automatically closes after 10 minutes if no `done` event is received earlier.

### Step 3 — Post a user message

```http
POST /galebroker/messages
Content-Type: application/json

{
  "agentId": "suppie",
  "message": "Add milk, eggs, and bread to the shopping list",
  "actor": "user",
  "conversationId": "existing-conversation-id"
}
```

| Field | Required | Description |
|---|---|---|
| `agentId` | Yes | ID of the agent to send the message to |
| `message` | Yes | The text of the message |
| `actor` | Yes | `"user"` when the client sends a message |
| `conversationId` | No | Omit to create a new conversation; include to continue an existing one |
| `extras.subjectEmail` | No | Email of the user (useful for personalization) |

**Response:**
```json
{
  "conversationId": "abc-123",
  "messageId": "msg-456"
}
```

Use the returned `conversationId` to open (or reuse) the SSE stream.

### Step 4 — Agent posts its response

When the agent is ready to respond, it calls Gale Broker with `actor: "agent"`. Agents can send responses as a **stream of messages**, declaring the last message with `stream.last: true`:

```http
POST /galebroker/messages
Content-Type: application/json

{
  "agentId": "suppie",
  "conversationId": "abc-123",
  "messageId": "msg-789",
  "message": "I've added 3 items to your shopping list!",
  "actor": "agent",
  "stream": {
    "streamId": "stream-001",
    "sequenceNumber": 1,
    "last": true
  }
}
```

| Field | Required | Description |
|---|---|---|
| `stream.streamId` | No | Unique ID grouping all messages of the same streamed response |
| `stream.sequenceNumber` | No | Position of this message in the stream (starting at 1) |
| `stream.last` | No | Set to `true` on the final message — triggers the SSE stream to close |

### Building a conversational agent

A conversational agent must expose a `POST /messages` endpoint (by default) that Gale Broker will call with the user's message. The agent is expected to:
1. Receive the message from Gale Broker.
2. Process the message (e.g. call an LLM).
3. Post one or more response messages back to Gale Broker via `POST /galebroker/messages` with `actor: "agent"`, marking the last message with `stream.last: true`.

An example of a conversational agent is **SuppieAgent** from [toto-ms-supermarket (feature/1.4.0-agent)](https://github.com/nicolasances/toto-ms-supermarket/tree/feature/1.4.0-agent). It extends the `GaleConversationalAgent` base class from the `totoms` package, which handles the endpoint wiring automatically:

```typescript
import { AgentConversationMessage, GaleConversationalAgent, AgentManifest } from "totoms";
import { v4 as uuid } from "uuid";

export class SuppieAgent extends GaleConversationalAgent {

    getManifest(): AgentManifest {
        return {
            agentType: "conversational",
            agentId: "suppie",
            humanFriendlyName: "Suppie",
        }
    }

    async onMessage(message: AgentConversationMessage): Promise<AgentConversationMessage> {
        // 1. Optionally publish an immediate acknowledgement
        this.publishMessage({
            conversationId: message.conversationId,
            messageId: uuid(),
            agentId: message.agentId,
            message: "I'm on it!",
            actor: "agent",
            stream: { streamId: "stream-001", sequenceNumber: 1, last: false }
        });

        // 2. Process the message (call an LLM, run business logic, etc.)
        const response = await processWithLLM(message.message);

        // 3. Publish the final response, marking it as last
        this.publishMessage({
            conversationId: message.conversationId,
            messageId: uuid(),
            agentId: message.agentId,
            message: response,
            actor: "agent",
            stream: { streamId: "stream-001", sequenceNumber: 2, last: true }
        });

        return { ...message, message: response, actor: "agent" };
    }
}
```

Register the agent in the service's `index.ts`:

```typescript
const config: TotoMicroserviceConfiguration = {
    // ...
    agentsConfiguration: {
        agents: [ SuppieAgent ]
    }
};
```

The `totoms` framework will automatically expose the `/messages` endpoint and route incoming messages to `onMessage()`. The `this.publishMessage()` helper posts responses back to Gale Broker on your behalf.
