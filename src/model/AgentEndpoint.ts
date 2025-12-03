import { ValidationError } from "toto-api-controller/dist/validation/Validator";

export class AgentEndpoint {

    baseURL: string; // The base URL of the Task Endpoint. E.g., "https://myagents.example.com/agentA"
    executionPath: string; // The path to execute tasks. E.g., "/tasks" that will be used with a POST request. 
    infoPath: string; // The path to get info about the Agent. E.g., "/info" that will be used with a GET request to retrieve Agent metadata (e.g. the manifesto).

    constructor(baseURL: string, executionPath: string = "/tasks", infoPath: string = "/info") {
        this.baseURL = baseURL;
        this.executionPath = executionPath;
        this.infoPath = infoPath;
    }

    static fromJSON(data: any): AgentEndpoint {

        if (!data.baseURL) throw new ValidationError(400, `Invalid TaskEndpoint JSON: missing required fields. Received ${JSON.stringify(data)}.`);

        return new AgentEndpoint(
            data.baseURL,
            data.executionPath,
            data.infoPath
        );
    }

    static fromBSON(data: any): AgentEndpoint {
        return new AgentEndpoint(
            data.baseURL,
            data.executionPath,
            data.infoPath
        );
    }

}