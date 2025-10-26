import { TotoRuntimeError, ValidationError } from "toto-api-controller";
import { TaskId } from "./TaskId";

/**
 * This class represents the response returned when an Agent is successfully triggered to execute a task.
 * 
 * WHAT IT IS NOT
 * - It is NOT the response from the Agent after executing the task. It is just an acknowledgment that the Agent has been triggered.
 */
export class AgentTriggerReponse {

    taskId: TaskId; // The ID of the task that was triggered.
    agentName: string; // The name of the Agent that was triggered.
    taskExecutionId: string; // The unique identifier for this task execution.

    constructor(taskId: TaskId, agentName: string, taskExecutionId: string) {
        this.taskId = taskId;
        this.agentName = agentName;
        this.taskExecutionId = taskExecutionId;
    }

    /**
     * Creates an instance of AgentTriggerReponse from the HTTP response body.
     * @param responseBody the body of the HTTP response.
     * @returns an instance of AgentTriggerReponse.
     */
    static fromHTTPResponse(responseBody: any): AgentTriggerReponse {

        let response;
        
        // 1. Validate: make sure response body is valid JSON
        try {
            response = JSON.parse(responseBody);
        } catch (error) {

            if (error instanceof SyntaxError) {

                console.error(`Failed to parse Agent trigger response JSON. Received ${responseBody}.`, error);

                throw new TotoRuntimeError(500, "Invalid response from Agent trigger response: unable to parse JSON.");
            }
            // Re-throw non-JSON parsing errors
            throw error;
        }

        // 2. Validate the fields presence
        if (!response.taskId || !response.agentName || !response.taskExecutionId) throw new ValidationError(400, `Invalid Agent response: missing required fields in the response received by the Agent. Received ${JSON.stringify(response)}.`);

        return new AgentTriggerReponse(
            response.taskId,
            response.agentName,
            response.taskExecutionId
        );
    }
}