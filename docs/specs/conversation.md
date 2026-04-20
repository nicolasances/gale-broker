# Conversation Spec

## Overview

This document describes the conversation capabilities of the Gale Broker service: how user messages are routed to agents, how agent responses flow back, and how the SSE streaming endpoint operates.

---

## Conversation Flow

```
User  →  POST /messages  →  ConversationStore (storeMessage)
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
```

1. **User posts a message** via `POST /messages`. The broker stores it in MongoDB (`conversationMessages` collection) and publishes an `agentMessagePosted` event to the message bus.
2. **`AgentMessageMsgHandler`** receives the bus event and calls `Conversation.sendMessageToAgent()`.
3. **`sendMessageToAgent()`** looks up the agent definition from the catalog and calls `AgentCall.sendMessage()`, which performs an HTTP POST to the agent's `messagesPath` endpoint.
4. **Intermediate messages**: while processing, the agent may call `publish_message()` (a POST back to the broker's `/messages` endpoint). These messages are stored by the broker immediately.
5. **Final response**: the agent returns its final message (with `stream.last: true`) as the HTTP response body. `sendMessageToAgent()` captures this response and persists it via `ConversationStore.storeMessage()`.

---

## Streaming Model

Agent messages that are part of a response stream carry a `stream` object:

```typescript
stream?: {
    streamId: string;       // Unique ID for the stream (assigned by the agent)
    sequenceNumber: number; // 1-based position of this message in the stream
    last: boolean;          // true on the final message of the stream
}
```

- Messages without a `stream` field are standalone (non-streaming) replies.
- When `stream.last` is `true`, the SSE conversation stream will detect this, send a `done` event to the client, and close.

---

## SSE Endpoint

**`GET /conversations/:conversationId/messages/stream`**

The client subscribes to this endpoint to receive agent messages in real-time.

### Behaviour

- The endpoint opens a Server-Sent Events (SSE) stream (a `Readable` returned to the HTTP layer).
- Every **2 seconds** the broker polls MongoDB for agent messages in the conversation (actor = `"agent"`), ordered by timestamp.
- When a new message is available (beyond what has already been sent), the broker emits a `message` event:
  ```
  event: message
  data: {"message": "<agent message text>"}
  ```
- If the latest message has `stream.last === true`, the broker emits a `done` event and closes the stream:
  ```
  event: done
  data: {"message": "Stream complete", "totalMessages": <n>}
  ```
- If the stream is still open after **10 minutes** (hard timeout), a `done` event is sent and the stream is closed:
  ```
  event: done
  data: {"message": "Stream timeout reached (10 minutes)"}
  ```
- On any error during polling, a `done` event is sent and the stream closes.

### Why the stream closes on `stream.last`

The final agent response (with `stream.last: true`) is persisted by `Conversation.sendMessageToAgent()` after it receives the HTTP response from the agent. This ensures the polling loop in `ConversationMessagesStream` will always find the final message in MongoDB and trigger the `done` event.

---

## Message Storage Model

MongoDB collections (names configured via `GaleConfig.getCollections()`):

### `conversations`

Stores one document per conversation.

| Field       | Type   | Description                                      |
|-------------|--------|--------------------------------------------------|
| `_id`       | ObjectId | MongoDB-generated conversation ID              |
| `agentId`   | string | ID of the agent this conversation targets        |
| `userEmail` | string | Email of the user (from `extras.subjectEmail`)   |
| `createdAt` | ISO string | When the conversation was created            |
| `updatedAt` | ISO string | When the conversation was last updated       |

### `conversationMessages`

Stores every message in every conversation.

| Field              | Type   | Description                                                |
|--------------------|--------|------------------------------------------------------------|
| `_id`              | ObjectId | MongoDB-generated message ID                             |
| `conversationId`   | string | ID of the parent conversation                              |
| `messageId`        | string | Client- or server-assigned message ID                      |
| `actor`            | string | `"user"` or `"agent"`                                      |
| `agentId`          | string | ID of the agent involved                                   |
| `message`          | string | Message content                                            |
| `stream`           | object | Optional. Contains `streamId`, `sequenceNumber`, `last`    |
| `extras`           | object | Optional. May contain `subjectEmail`                       |
| `timestamp`        | ISO string | When the message was stored by the broker              |
