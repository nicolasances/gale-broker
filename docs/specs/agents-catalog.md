# Agents Catalog Spec

## Overview

This document describes the Agents Catalog of the Gale Broker service: how agents are registered, updated, and managed.

---

## What Is an Agent?

An agent is an LLM-powered microservice that can receive messages from the broker, process them, and return a response. Agents are registered in the catalog before they can be used in conversations or tasks.

---

## Agent Definition

Agents are stored in the `agents` MongoDB collection. Each agent document has the following fields:

| Field          | Type   | Description                                               |
|----------------|--------|-----------------------------------------------------------|
| `taskId`       | string | Unique identifier for the agent                           |
| `name`         | string | Human-readable name                                       |
| `messagesPath` | string | URL the broker uses to POST conversation messages to the agent |

---

## Agent Lifecycle

1. **Register**: `POST /catalog/agents` — creates a new agent entry in the catalog.
2. **Update**: `PUT /catalog/agents` — updates an existing agent's definition (e.g. `messagesPath`).
3. **Retrieve**: `GET /catalog/agents/:taskId` — fetches a single agent by its `taskId`.
4. **List**: `GET /catalog/agents` — returns all registered agents.
5. **Delete**: `DELETE /catalog/agents/:taskId` — removes an agent from the catalog.

---

## MongoDB Collection: `agents`

One document per agent.

| Field          | Type     | Description                                      |
|----------------|----------|--------------------------------------------------|
| `_id`          | ObjectId | MongoDB-generated ID                             |
| `taskId`       | string   | Unique agent identifier                          |
| `name`         | string   | Human-readable name                              |
| `messagesPath` | string   | URL for sending conversation messages            |
