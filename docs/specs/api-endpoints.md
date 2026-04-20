# API Endpoints Spec

## Overview

This document lists all API endpoints exposed by the Gale Broker service, with request and response formats.

The base path for all endpoints is `/galebroker`.

---

## Agent Catalog

| Method | Path                        | Description                        |
|--------|-----------------------------|------------------------------------|
| POST   | `/catalog/agents`           | Register a new agent               |
| PUT    | `/catalog/agents`           | Update an existing agent           |
| GET    | `/catalog/agents`           | List all agents                    |
| GET    | `/catalog/agents/:taskId`   | Get a specific agent by task ID    |
| DELETE | `/catalog/agents/:taskId`   | Delete an agent                    |

---

## Agent Executions

| Method | Path                               | Description                                |
|--------|------------------------------------|--------------------------------------------|
| POST   | `/tasks`                           | Start a new agent task                     |
| GET    | `/tasks`                           | List root-level tasks                      |
| GET    | `/tasks/:taskInstanceId`           | Get execution record for a task instance   |

---

## Conversations

| Method | Path                                     | Description                                                 |
|--------|------------------------------------------|-------------------------------------------------------------|
| POST   | `/messages`                              | Post a message to a conversation (user or agent)            |
| GET    | `/conversations/:conversationId/data`    | Get full conversation data: messages + chain-of-thought     |

### `POST /messages` — request body

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

- `conversationId` is optional. If omitted, a new conversation is created and its ID is returned.
- `chainOfThought` is optional; only relevant when `actor` is `"agent"`.

### `POST /messages` — response

```json
{
    "conversationId": "abc-123",
    "messageId": "msg-1"
}
```

### `GET /conversations/:conversationId/data` — response

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

---

## Agentic Flows

| Method | Path                    | Description                               |
|--------|-------------------------|-------------------------------------------|
| GET    | `/flows/:correlationId` | Get the agentic flow for a correlation ID |

---

## SSE Streams

| Method | Path                                    | Description                                   |
|--------|-----------------------------------------|-----------------------------------------------|
| GET    | `/conversations/:conversationId/stream` | Subscribe to real-time agent messages via SSE |

See the [Conversation spec](conversation.md) for full details on the SSE stream behaviour.
