import { Db } from "mongodb";
import { ExecutionContext } from "toto-api-controller";
import { TaskId } from "../../model/AgentTask";
import { GaleConfig } from "../../Config";
import { StopReason } from "../../model/AgentTask";

export class TaskTracker {

    config: GaleConfig;

    constructor(private db: Db, private execContext: ExecutionContext) {
        this.config = execContext.config as GaleConfig;
    }

    /**
     * Tracks the status of a task.
     * 
     * @param taskStatus the status to record
     */
    async trackTaskStatus(taskStatus: TaskStatusRecord): Promise<void> {

        const collection = this.db.collection(this.config.getCollections().tasks);

        await collection.updateOne(
            { taskInstanceId: taskStatus.taskInstanceId },
            { $set: taskStatus },
            { upsert: true }
        );

    }

    /**
     * Finds all tasks that are associated with the given correlation Id. 
     * Those are all the tasks that were spawned as part of the same root task.
     * 
     * @param correlationId the correlation Id 
     * @returns the list of task status records 
     */
    async findTasksByCorrelationId(correlationId: string): Promise<TaskStatusRecord[]> {

        const collection = this.db.collection(this.config.getCollections().tasks).find({ correlationId });

        return (await collection.toArray()).map(doc => doc as any as TaskStatusRecord);
    }

}

export interface TaskStatusRecord {
    correlationId: string; // Correlation ID for tracing. All task instances with the same correlation ID are related to the same original root task. 
    taskId: TaskId; // The type of task being executed
    taskInstanceId: string; // The task execution ID assigned by the Agent
    agentName?: string; // The name of the Agent executing the task
    startedAt: Date; // Timestamp when the task execution started
    status: Status; // Current status of the task execution
    stopReason?: StopReason; // The reason why the task execution stopped
    executionTimeMs?: number; // Execution time, in milliseconds
    parentTaskId?: string; // If this is a subtask, the parent task ID
    parentTaskInstanceId?: string; // If this is a subtask, the parent task instance ID
}

export type Status = "published" | "started" | "stopped"; 