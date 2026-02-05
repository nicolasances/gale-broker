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
- Make sure you have the `GALE_BROKER_PORT` environment variable set to a port you want to run the broker on (default is 8080)
- Make sure you have a local supported Queue (Message Broker) running. For local testing, I use [DevQ](https://github.com/nicolasances/devq)
    * To use DevQ, set the `LOCAL_DEVQ_ENDPOINT` environment variable to the DevQ endpoint (e.g. `http://localhost:8000/msg`). <br> If that variable is set, Gale Broker will use a locally running DevQ as message bus (note that you have to have DevQ running already - check the [DevQ documentation](https://github.com/nicolasances/devq)).
