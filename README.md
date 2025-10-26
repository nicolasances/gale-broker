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
