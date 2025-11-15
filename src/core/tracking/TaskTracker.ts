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
     * Finds a task by its instance ID.
     * 
     * @param taskInstanceId the task instance ID
     */
    async findTaskByInstanceId(taskInstanceId: string): Promise<TaskStatusRecord | null> {

        const collection = this.db.collection(this.config.getCollections().tasks);

        return await collection.findOne({ taskInstanceId }) as any as TaskStatusRecord | null;
    }

    /**
     * Flags the speified parent task (by its task instance Id) as 'childrenCompleted'. 
     * 
     * IMPORTANT: this method helps avoiding RACE CONDITIONS by using an upsert and returning the count of modified documents.
     * IF the count is 0, it means the task was already marked as 'childrenCompleted' by another concurrent process.
     * 
     * @param parentTaskInstanceId 
     * 
     * @returns true if the parent task was successfully marked as 'childrenCompleted', false if it was already marked.
     */
    async flagParentAsChildrenCompleted(parentTaskInstanceId: string): Promise<boolean> {
        
        const collection = this.db.collection(this.config.getCollections().tasks);

        const result = await collection.updateOne(
            { taskInstanceId: parentTaskInstanceId },
            { $set: { status: 'childrenCompleted' } },
            { upsert: true }
        );

        return result.modifiedCount > 0;
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

    /**
     * Checks if all sibling tasks of the given parent task are completed.
     * 
     * @param parentTaskInstanceId the task instance id of the parent of the task to check
     */
    async areSiblingsCompleted(parentTaskInstanceId: string): Promise<boolean> {

        const siblingTasks = await this.db.collection(this.config.getCollections().tasks).find({ parentTaskInstanceId }).toArray() as any as TaskStatusRecord[];

        if (siblingTasks.length === 0) return true;

        return siblingTasks.every(task => task.status === 'completed');
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
    subtaskGroupId?: string; // If this is a subtask, the group ID of the subtask batch
}

export type Status = "published" | "started" | "waiting" | "completed" | "failed" | "childrenCompleted"; 