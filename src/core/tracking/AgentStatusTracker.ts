import { Db } from "mongodb";
import { ExecutionContext, TotoRuntimeError } from "toto-api-controller";
import { AgentTaskRequest, ParentTaskInfo, TaskInfo, TaskId, AgentTaskResponse } from "../../model/AgentTask";
import { GaleConfig } from "../../Config";
import { StopReason } from "../../model/AgentTask";
import { AgentDefinition } from "../../model/AgentDefinition";
import { v4 as uuidv4 } from 'uuid';

const MAX_LOCK_ATTEMPTS = 10;

export class AgentStatusTracker {

    config: GaleConfig;
    tasksCollection: any;
    branchesCollection: any;

    constructor(private db: Db, private execContext: ExecutionContext) {
        this.config = execContext.config as GaleConfig;
        this.tasksCollection = this.db.collection(this.config.getCollections().tasks);
        this.branchesCollection = this.db.collection(this.config.getCollections().branches);
    }

    /**
     * Locks the specific task for update
     * @param taskInstanceId
     */
    async acquireTaskLock(taskInstanceId: string, attempt: number = 1): Promise<void> {

        if (attempt > MAX_LOCK_ATTEMPTS) {
            throw new TotoRuntimeError(500, `Failed to lock task ${taskInstanceId} after ${MAX_LOCK_ATTEMPTS} attempts`);
        }

        const updateResult = await this.tasksCollection.updateOne({ taskInstanceId: taskInstanceId, locked: { $ne: true } }, { $set: { locked: true } });

        if (updateResult.matchedCount === 0) {
            // Means it's already locked: wait and retry
            await new Promise(resolve => setTimeout(resolve, 50));
            return this.acquireTaskLock(taskInstanceId, attempt + 1);
        }
    }

    /**
     * Releases the lock on the flow after update.
     * @param correlationId 
     */
    async releaseTaskLock(taskInstanceId: string): Promise<void> {
        await this.tasksCollection.updateOne({ taskInstanceId: taskInstanceId }, { $set: { locked: false } });
    }


    /**
     * Tracks the fact that an agent has started executing a task.
     * 
     * @param task 
     * @param agentDefinition 
     */
    async agentStatusStarted(task: AgentTaskRequest, agentDefinition: AgentDefinition): Promise<void> {

        const record: TaskStatusRecord = {
            correlationId: task.correlationId!,
            agentName: agentDefinition.name,
            taskId: task.taskId,
            taskInstanceId: task.taskInstanceId!,
            startedAt: new Date(Date.now()),
            status: "started",
            taskInput: task.taskInputData,
            groupId: task.taskGroupId,
            parentTaskId: task.parentTask?.taskId,
            parentTaskInstanceId: task.parentTask?.taskInstanceId,
            branchId: task.branchId,
        }

        await this.tasksCollection.updateOne({ taskInstanceId: task.taskInstanceId }, { $set: record }, { upsert: true });
    }

    /**
     * Tracks the fact that an agent has completed executing a task.
     * 
     * @param taskInstanceId 
     * @param agentTaskResponse 
     */
    async agentStatusCompleted(taskInstanceId: string, agentTaskResponse: AgentTaskResponse): Promise<void> {

        await this.tasksCollection.updateOne({ taskInstanceId }, {
            $set: {
                status: "completed",
                stoppedAt: new Date(Date.now()),
                taskOutput: agentTaskResponse.taskOutput
            }
        });

    }

    /**
     * Tracks the fact that an agent has failed executing a task.
     * 
     * @param taskInstanceId 
     * @param agentTaskResponse 
     */
    async agentStatusFailed(taskInstanceId: string, agentTaskResponse: AgentTaskResponse): Promise<void> {

        await this.tasksCollection.updateOne({ taskInstanceId }, {
            $set: {
                status: "failed",
                stoppedAt: new Date(Date.now()),
                taskOutput: agentTaskResponse.taskOutput
            }
        });

    }

    /**
     * Tracks the publication of a set of agent tasks.
     * 
     * @param tasks the list of tasks being published
     */
    async agentTasksPublished(tasks: AgentTaskRequest[]): Promise<void> {

        const records: TaskStatusRecord[] = tasks.map(task => ({
            correlationId: task.correlationId!,
            taskId: task.taskId,
            taskInstanceId: task.taskInstanceId!,
            startedAt: new Date(Date.now()),
            status: "published",
            taskInput: task.taskInputData,
            groupId: task.taskGroupId,
            parentTaskId: task.parentTask?.taskId,
            parentTaskInstanceId: task.parentTask?.taskInstanceId,
            branchId: task.branchId,
        }));

        await this.tasksCollection.insertMany(records);

    }


    /**
     * Finds all tasks that belong to a specific subtask group.
     * 
     * @param groupId the group id of the subtasks
     * @returns 
     */
    async findGroupTasks(correlationId: string, groupId: string): Promise<TaskStatusRecord[]> {

        const children = await this.db.collection(this.config.getCollections().tasks).find({ correlationId: correlationId, groupId: groupId }).toArray();

        return children.map(doc => doc as any as TaskStatusRecord);
    }

    /**
     * Marks a parent task as resumed after its subtasks have completed.
     * 
     * @param parentTaskInstanceId the instance ID of the parent task
     * @param completedSubtaskGroupId the ID of the completed subtask group
     */
    async markTaskResumedAfterGroupCompletion(parentTaskInstanceId: string, completedSubtaskGroupId: string): Promise<void> {

        await this.tasksCollection.updateOne(
            { taskInstanceId: parentTaskInstanceId },
            { $addToSet: { completedSubtaskGroups: completedSubtaskGroupId } }
        );

    }

    /**
     * Creates the branches records in the tracking system.
     * @param branches the branches to create
     */
    async createBranches(parentTaskInstanceId: string, branches: { branchId: string, tasks: AgentTaskRequest[] }[]): Promise<void> {
        await this.branchesCollection.insertMany(branches.map(branch => ({ branchId: branch.branchId, parentTaskInstanceId: parentTaskInstanceId, createdAt: new Date(Date.now()), status: 'active' })));
    }

    /**
     * Marks a branch as completed.
     * @param branchId the branchId to mark as completed
     */
    async markBranchCompleted(branchId: string): Promise<void> {
        await this.branchesCollection.updateOne(
            { branchId },
            { $set: { status: 'completed', completedAt: new Date(Date.now()) } }
        );
    }

    /**
     * Checks if the specified branches are all completed.
     * 
     * @param branchIds the branches
     * @returns 
     */
    async areBranchesCompleted(branchIds: string[]): Promise<boolean> {

        const branches = await this.branchesCollection.find({ branchId: { $in: branchIds } }).toArray() as any[];

        if (branches.length === 0) return true;

        return branches.every(branch => branch.status === 'completed');
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
     * This method finds all root tasks (tasks without a parent).
     * This would typically be used to get a list of all tasks that were started independently (e.g. by a user or a process). 
     * 
     * @returns the list of root task status records
     */
    async findAllRoots(): Promise<TaskStatusRecord[]> {

        const collection = this.db.collection(this.config.getCollections().tasks).find({
            $and: [
                { $or: [{ parentTaskInstanceId: { $exists: false } }, { parentTaskInstanceId: null }] },
                { $or: [{ resumedAfterSubtasksGroupId: { $exists: false } }, { resumedAfterSubtasksGroupId: null }] }
            ]
        }).sort({ startedAt: -1 });

        return (await collection.toArray()).map(doc => doc as any as TaskStatusRecord);
    }

}

export interface TaskStatusRecord {
    correlationId: string;                          // Correlation ID for tracing. All task instances with the same correlation ID are related to the same original root task. 
    taskId: TaskId;                                 // The type of task being executed
    taskInstanceId: string;                         // The task execution ID assigned by the Agent
    agentName?: string;                             // The name of the Agent executing the task
    startedAt: Date;                                // Timestamp when the task execution started
    stoppedAt?: Date;                               // Timestamp when the task execution stopped
    status: Status;                                 // Current status of the task execution

    parentTaskId?: string;                          // If this is a subtask, the parent task ID
    parentTaskInstanceId?: string;                  // If this is a subtask, the parent task instance ID

    completedSubtaskGroups?: string[];              // List of completed subtasks groups IDs

    groupId?: string;                               // If this is a subtask, the group ID of the subtask batch
    branchId?: string;                              // The branch on which the task is located

    taskInput: any;                                 // The input data provided to the task execution
    taskOutput?: any;                               // The output produced by the task execution
}

export type Status = "published" | "started" | "completed" | "failed"; 