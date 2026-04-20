# Chain-of-Thought Tracking Spec

## Overview

This document describes the full capabilities of the Gale Broker service, including:

- The **Agents Catalog**: how agents are registered and managed
- The **Conversation system**: how messages flow between users and agents, including the streaming model
- The **Chain-of-Thought Tracking system**: what data is captured, how it's stored, and how to retrieve it
- The **SSE stream**: how clients subscribe to real-time agent messages
- **API endpoints**: all available endpoints with request/response formats

---

## Agents Catalog

Agents are registered in the catalog with a unique `taskId`. The catalog stores agent definitions in the `agents` MongoDB collection.

### Agent Definition fields

| Field         | Type   | Description                                      |
|---------------|--------|--------------------------------------------------|
| `taskId`      | string | Unique identifier for the agent                  |
| `name`        | string | Human-readable name                              |
| `messagesPath`| string | URL the broker uses to POST messages to the agent|

---

## Conversation System

### Conversation Flow

```
User  →  POST /messages  →  ConversationStore.storeMessage()
                          →  MessageBus (topic: galeagents, type: agentMessagePosted)
                                   ↓
                       AgentMessageMsgHandler.onMessage()
                                   ↓
                       Conversation.sendMessageToAgent()
                                   ↓
                       AgentCall.sendMessage()  →  HTTP POST → Agent
                                   ↓
                       (agent may POST intermediate messages to broker's POST /messages)
                                   ↓
                       Agent returns final response (stream.last: true) as HTTP response body
                                   ↓
                       ConversationStore.storeMessage(agentResponse)
                         - Strips chainOfThought from the message
                         - Stores chainOfThought in conversationReasoning collection (if present)
```

1. **User posts a message** via `POST /messages`. The broker stores it in the `conversationMessages` collection and publishes an `agentMessagePosted` event to the message bus.
2. **`AgentMessageMsgHandler`** receives the bus event and calls `Conversation.sendMessageToAgent()`.
3. **`sendMessageToAgent()`** looks up the agent definition from the catalog and calls `AgentCall.sendMessage()`, performing an HTTP POST to the agent's `messagesPath` endpoint.
4. **Intermediate messages**: while processing, the agent may POST back to the broker's `/messages` endpoint. These messages are stored immediately.
5. **Final response**: the agent returns its final message (with `stream.last: true`) as the HTTP response body. `sendMessageToAgent()` captures this response and persists it via `ConversationStore.storeMessage()`.

### Message fields

| Field             | Type   | Description                                                |
|-------------------|--------|------------------------------------------------------------|
| `conversationId`  | string | ID of the conversation (generated if not provided)         |
| `messageId`       | string | Message ID (client- or server-assigned)                    |
| `actor`           | string | `"user"` or `"agent"`                                      |
| `agentId`         | string | ID of the agent involved                                   |
| `message`         | string | Message content                                            |
| `stream`          | object | Optional. Contains `streamId`, `sequenceNumber`, `last`    |
| `extras`          | object | Optional. May contain `subjectEmail`                       |
| `chainOfThought`  | array  | Optional (agent only). Raw LLM content blocks              |

---

## Chain-of-Thought Tracking System

Agents powered by LLMs with reasoning capabilities (Claude, Gemini, etc.) produce rich internal reasoning alongside their user-facing answers. Gale Broker captures and stores this data for debugging, auditing, and future UI features.

### How it works

When an agent message includes a `chainOfThought` field (a list of raw LLM content blocks) and `actor` is `"agent"`:

1. The `chainOfThought` data is extracted **before** storing the message in `conversationMessages` — keeping that collection lean.
2. The chain-of-thought data is stored in a dedicated `conversationReasoning` collection, linked to the `conversationId` and `messageId`.

A conversation may have multiple agent turns, each with its own chain-of-thought entry. Data is keyed by `conversationId` + `messageId`.

### `conversationReasoning` collection document structure

```json
{
    "conversationId": "abc-123",
    "messageId": "msg-789",
    "agentId": "suppie",
    "chainOfThought": [
        { "type": "thinking", "thinking": "The user wants their list..." },
        { "type": "text", "text": "Your list contains: ..." }
    ],
    "timestamp": "2026-04-19T15:00:00Z"
}
```

### Retrieving conversation data

Use the `GET /conversations/:conversationId/data` endpoint (see below) to retrieve the complete conversation including all messages and associated reasoning.

---

## SSE Stream

**`GET /conversations/:conversationId/stream`**

The client subscribes to this endpoint to receive agent messages in real-time.

### Behaviour

- The endpoint opens a Server-Sent Events (SSE) stream (a `Readable` returned to the HTTP layer).
- Every **2 seconds** the broker polls MongoDB for agent messages in the conversation (actor = `"agent"`), ordered by timestamp.
- When a new message is available, the broker emits a `message` event:
  ```
  event: message
  data: {"message": "<agent message text>"}
  ```
- If the latest message has `stream.last === true`, the broker emits a `done` event and closes the stream:
  ```
  event: done
  data: {"message": "Stream complete", "totalMessages": <n>}
  ```
- If the stream remains open after **10 minutes** (hard timeout), a `done` event is sent and the stream is closed:
  ```
  event: done
  data: {"message": "Stream timeout reached (10 minutes)"}
  ```
- On any error during polling, a `done` event is sent and the stream closes.

---

## API Endpoints

### Agent Catalog

| Method | Path                        | Description                        |
|--------|-----------------------------|------------------------------------|
| POST   | `/catalog/agents`           | Register a new agent               |
| PUT    | `/catalog/agents`           | Update an existing agent           |
| GET    | `/catalog/agents`           | List all agents                    |
| GET    | `/catalog/agents/:taskId`   | Get a specific agent by task ID    |
| DELETE | `/catalog/agents/:taskId`   | Delete an agent                    |

### Agent Executions

| Method | Path                               | Description                                |
|--------|------------------------------------|--------------------------------------------|
| POST   | `/tasks`                           | Start a new agent task                     |
| GET    | `/tasks`                           | List root-level tasks                      |
| GET    | `/tasks/:taskInstanceId`           | Get execution record for a task instance   |

### Conversations

| Method | Path                                     | Description                                                 |
|--------|------------------------------------------|-------------------------------------------------------------|
| POST   | `/messages`                              | Post a message to a conversation (user or agent)            |
| GET    | `/conversations/:conversationId/data`    | Get full conversation data: messages + chain-of-thought     |

#### `POST /messages` — request body

```json
{
    "agentId": "suppie",
    "conversationId": "abc-123",
    "message": "Show my list",
    "actor": "user",
    "messageId": "msg-1",
    "stream": { "streamId": "s1", "sequenceNumber": 1, "last": false },
    "extras": { "subjectEmail": "user@example.com" },
    "chainOfThought": [ ... ]
}
```

`chainOfThought` is optional; only relevant when `actor` is `"agent"`.

#### `POST /messages` — response

```json
{
    "conversationId": "abc-123",
    "messageId": "msg-1"
}
```

#### `GET /conversations/:conversationId/data` — response

```json
{
    "conversationId": "abc-123",
    "messages": [
        {
            "messageId": "msg-1",
            "actor": "user",
            "message": "Show my list",
            "timestamp": "2026-04-19T15:00:00Z"
        },
        {
            "messageId": "msg-2",
            "actor": "agent",
            "message": "Your list contains: ...",
            "timestamp": "2026-04-19T15:00:05Z"
        }
    ],
    "reasoning": [
        {
            "messageId": "msg-2",
            "agentId": "suppie",
            "chainOfThought": [
                { "type": "thinking", "thinking": "The user wants their list..." },
                { "type": "text", "text": "Your list contains: ..." }
            ],
            "timestamp": "2026-04-19T15:00:05Z"
        }
    ]
}
```

The `messages` array contains the user-facing conversation (no chain-of-thought data). The `reasoning` array contains the LLM's internal thinking, linked to specific messages via `messageId`.

### Agentic Flows

| Method | Path                            | Description                                   |
|--------|---------------------------------|-----------------------------------------------|
| GET    | `/flows/:correlationId`         | Get the agentic flow for a correlation ID     |

### SSE Streams

| Method | Path                                         | Description                                    |
|--------|----------------------------------------------|------------------------------------------------|
| GET    | `/conversations/:conversationId/stream`      | Subscribe to real-time agent messages via SSE  |

---

## MongoDB Collections

| Collection              | Description                                                  |
|-------------------------|--------------------------------------------------------------|
| `agents`                | Agent definitions (catalog)                                  |
| `tasks`                 | Agent task execution records                                 |
| `flows`                 | Agentic flow trees (keyed by correlationId)                  |
| `branches`              | Branch tracking for parallel agentic flows                   |
| `conversations`         | One document per conversation                                |
| `conversationMessages`  | All user and agent messages (without chain-of-thought)       |
| `conversationReasoning` | Agent chain-of-thought data, keyed by conversationId+messageId |
