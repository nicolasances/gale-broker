import { Db } from "mongodb";
import { correlationId, ExecutionContext, TotoRuntimeError, ValidationError } from "toto-api-controller";
import { AgentStatusTracker } from "./AgentStatusTracker";
import { AgentTaskRequest, AgentTaskResponse } from "../../model/AgentTask";
import { AgenticFlow, AgentNode } from "./AgenticFlow";
import { GaleConfig } from "../../Config";
import { AgentDefinition } from "../../model/AgentDefinition";

const MAX_LOCK_ATTEMPTS = 10;

/**
 * Facade for tracking both: 
 * - Agent status (using AgentStatusTracker)
 * - Agentic Flow structure (AgenticFlow) - to track the graph of tasks and subtasks.
 */
export class AgenticFlowTracker {

    agentStatusTracker: AgentStatusTracker;
    flowsCollection: any;

    constructor(private db: Db, private execContext: ExecutionContext) {
        this.agentStatusTracker = new AgentStatusTracker(db, execContext);
        this.flowsCollection = this.db.collection((this.execContext.config as GaleConfig).getCollections().flows);
    }

    /**
     * Locks the flow for update to prevent race conditions.
     * @param correlationId the unique identifier of the flow
     * @param attempt the current attempt number (for internal use)
     */
    private async lockFlow(correlationId: string, attempt: number = 1): Promise<void> {

        if (attempt > MAX_LOCK_ATTEMPTS) {
            throw new TotoRuntimeError(500, `Failed to lock flow ${correlationId} after ${MAX_LOCK_ATTEMPTS} attempts`);
        }

        const updateResult = await this.flowsCollection.updateOne({ correlationId: correlationId, locked: { $ne: true } }, { $set: { locked: true } });

        if (updateResult.matchedCount === 0) {
            // Means it's already locked: wait and retry
            await new Promise(resolve => setTimeout(resolve, 50));
            return this.lockFlow(correlationId, attempt + 1);
        }
    }

    /**
     * Releases the lock on the flow after update.
     * @param correlationId 
     */
    private async releaseFlowLock(correlationId: string): Promise<void> {
        await this.flowsCollection.updateOne({ correlationId: correlationId }, { $set: { locked: false } });
    }

    /**
     * Tracks the fact that the root agent has started executing.
     * 
     * This is the beginning of a new Agentic Flow.
     * 
     * @param task the root task
     * @param agentDefinition the agent definition
     */
    async rootAgentStarted(agent: AgentDefinition, task: AgentTaskRequest): Promise<void> {

        if (!task.correlationId) throw new ValidationError(400, "[Agentic Flow Tracker]: Missing correlationId when tracking a root agent start.");
        if (!task.taskInstanceId) throw new ValidationError(400, "[Agentic Flow Tracker]: Missing taskInstanceId when tracking a root agent start.");

        // 1. Update the agent status
        await this.agentStatusTracker.agentStatusStarted(task, agent);

        // 2. Create a new Agentic Flow
        const flow = new AgenticFlow(task.correlationId,
            new AgentNode({
                taskId: task.taskId,
                taskInstanceId: task.taskInstanceId,
                name: agent.name,
            })
        )

        // 3. Save the Agentic Flow structure to the database
        await this.flowsCollection.insertOne(flow);

    }

    /**
     * Tracks the fact that an agent (not root) has started executing.
     * 
     * @param agent 
     * @param task 
     */
    async agentStarted(agent: AgentDefinition, task: AgentTaskRequest): Promise<void> {

        if (!task.correlationId) throw new ValidationError(400, "[Agentic Flow Tracker]: Missing correlationId when tracking a root agent start.");
        if (!task.taskInstanceId) throw new ValidationError(400, "[Agentic Flow Tracker]: Missing taskInstanceId when tracking a root agent start.");

        // 1. Update the agent status
        await this.agentStatusTracker.agentStatusStarted(task, agent);

        // No need to update the flow structure as if this is necessarily a subtask, so it is already represented in the flow.

    }

    /**
     * Marks the agent as completed in the tracking system.
     * 
     * @param agent 
     * @param task 
     * @param agentTaskResponse 
     */
    async agentCompleted(task: AgentTaskRequest, agentTaskResponse: AgentTaskResponse): Promise<void> {

        // 1. Update the agent status
        await this.agentStatusTracker.agentStatusCompleted(task.taskInstanceId!, agentTaskResponse);

    }

    /**
     * Marks the root agent as failed in the tracking system.
     * 
     * @param agent 
     * @param task 
     * @param agentTaskResponse 
     */
    async agentFailed(task: AgentTaskRequest, agentTaskResponse: AgentTaskResponse): Promise<void> {

        // 1. Update the agent status
        await this.agentStatusTracker.agentStatusFailed(task.taskInstanceId!, agentTaskResponse);

    }

    /**
     * Creates a branch in the Agentic Flow structure and all the tracking records needed to track the status of the tasks in the branch.
     * 
     * @param branchId 
     * @param tasks 
     */
    async branch(branches: { branchId: string, tasks: AgentTaskRequest[] }[]): Promise<void> {

        const correlationId = branches[0].tasks[0].correlationId;
        const parentTaskInstanceId = branches[0].tasks[0].parentTask?.taskInstanceId;

        if (!correlationId) throw new ValidationError(400, "[Agentic Flow Tracker]: Missing correlationId when tracking a branch creation.");
        if (!parentTaskInstanceId) throw new ValidationError(400, "[Agentic Flow Tracker]: Missing parentTaskInstanceId when tracking a branch creation.");

        // 1. Track the publishing of the agents' tasks and the creation of the branch
        await this.agentStatusTracker.agentTasksPublished(branches.map(b => b.tasks).flat());
        await this.agentStatusTracker.createBranches(parentTaskInstanceId, branches);

        // 2. Update the Agentic Flow structure in the database
        // 2.1. Lock the flow for update
        await this.lockFlow(correlationId);

        try {

            // 2.2. Load the flow, update it, and save it back
            const flow = await this.flowsCollection.findOne({ correlationId: correlationId }) as AgenticFlow;

            flow.branch(parentTaskInstanceId!, branches);

            await this.flowsCollection.updateOne(
                { correlationId: correlationId },
                { $set: { root: flow.root } }
            );

        } catch (error) {
            throw error;
        }
        finally {
            // Release the lock
            await this.releaseFlowLock(correlationId);
        }
    }

    /**
     * Checks if all agents in a task group have completed.
     * 
     * @param taskGroupId The ID of the task group to check.
     */
    async isGroupDone(taskGroupId: string): Promise<boolean> {

        // Find the tasks in the group 
        const tasks = await this.agentStatusTracker.findGroupTasks(taskGroupId);

        // Check if all tasks have status "completed"
        return tasks.every(task => task.status === "completed");
    }

    /**
     * Marks a branch as completed in the tracking system.
     * 
     * @param branchId the branchId
     */
    async markBranchCompleted(correlationId: string, branchId: string): Promise<void> {

        // 1. Mark the branch as completed
        await this.agentStatusTracker.markBranchCompleted(branchId);

        // 2. Mark the parent branch as completed if all its branches are completed
        // 2.1. Load the flow
        const flow = await this.flowsCollection.findOne({ correlationId }) as AgenticFlow;

        // 2.2. Check if all branches are completed
        const siblingBranches = flow.siblingBranches(branchId);
        const parentBranchId = flow.parentBranchId(branchId);

        if (!siblingBranches || siblingBranches.length === 0) {
            if (parentBranchId) {
                await this.markBranchCompleted(correlationId, parentBranchId);
            }
        }
        else {
            // Check if all sibling branches are completed
            const allSiblingsCompleted = await this.agentStatusTracker.areBranchesCompleted(siblingBranches);

            if (allSiblingsCompleted && parentBranchId) {
                await this.markBranchCompleted(correlationId, parentBranchId);
            }
        }
    }

    async areSiblingBranchesCompleted(correlationId: string, branchId: string): Promise<boolean> {

        // 1. Load the flow
        const flow = await this.flowsCollection.findOne({ correlationId }) as AgenticFlow;

        // 2. Get sibling branches
        const siblingBranches = flow.siblingBranches(branchId);

        if (!siblingBranches || siblingBranches.length === 0) {
            return true;
        }

        // 3. Check if all sibling branches are completed
        return this.agentStatusTracker.areBranchesCompleted(siblingBranches);
    }
}