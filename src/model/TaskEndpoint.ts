
export class TaskEndpoint {

    baseURL: string; // The base URL of the Task Endpoint. E.g., "https://myagents.example.com/agentA"
    executionPath: string; // The path to execute tasks. E.g., "/tasks" that will be used with a POST request. 
    infoPath: string; // The path to get info about the Agent. E.g., "/info" that will be used with a GET request to retrieve Agent metadata (e.g. the manifesto).

    constructor(baseURL: string, executionPath: string = "/tasks", infoPath: string = "/info") {
        this.baseURL = baseURL;
        this.executionPath = executionPath;
        this.infoPath = infoPath;
    }

    static fromJSON(data: any): TaskEndpoint {
        return new TaskEndpoint(
            data.baseURL,
            data.executionPath,
            data.infoPath
        );
    }

    static fromBSON(data: any): TaskEndpoint {
        return new TaskEndpoint(
            data.baseURL,
            data.executionPath,
            data.infoPath
        );
    }

}