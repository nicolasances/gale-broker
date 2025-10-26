import { Db } from "mongodb";
import { ExecutionContext } from "toto-api-controller";
import { TaskId } from "../../model/TaskId";

export class AgentTracker {

    constructor(private db: Db, private execContext: ExecutionContext) { }

    /**
     * Tracks the status of an Agent executing a task.
     * 
     * @param agentStatus the status to record
     */
    async trackAgentStatus(agentStatus: AgentStatusRecord): Promise<void> {

        const collection = this.db.collection('executions');

        await collection.updateOne(
            { taskExecutionId: agentStatus.taskExecutionId },
            { $set: agentStatus },
            { upsert: true }
        );

    }

}

export interface AgentStatusRecord {
    taskId: TaskId; // The type of task being executed
    agentName: string; // The name of the Agent executing the task
    taskExecutionId: string; // The task execution ID assigned by the Agent
    status: "running" | "completed" | "failed";
    executionTimeS: number; // Execution time, in seconds
}