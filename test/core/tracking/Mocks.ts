import { TaskStatusRecord } from "../../../src/core/tracking/AgentStatusTracker";
import { AgentTaskRequest, AgentTaskResponse } from "../../../src/model/AgentTask";
import { AgentDefinition } from "../../../src/model/AgentDefinition";
import { AgentCallFactory } from "../../../src/api/AgentCall";
import { TaskId } from "../../../src/model/AgentTask";

export class MockConfig {
    messageBus: MockMessageBus = new MockMessageBus();
    
    getCollections() {
        return {
            tasks: "tasks",
            branches: "branches",
            flows: "flows",
            agents: "agents"
        }
    }
}

export class MockExecContext {
    config = new MockConfig();
    correlationId = "test-correlation-id";
    cid = "test-cid";
    logger = {
        compute: (cid: string, message: string, level?: string) => {
            // Mock logger - no-op
        }
    };
}

export class MockCollection {
    data: Map<string, any> = new Map();
    name: string;

    constructor(name: string) {
        this.name = name;
    }

    async updateOne(filter: any, update: any, options?: any) {
        // Simple mock implementation for specific cases
        // For flows, we usually filter by correlationId
        if (this.name === 'flows' && filter.correlationId) {
            let doc = this.data.get(filter.correlationId);
            
            // Handle lock
            if (update.$set && update.$set.locked !== undefined) {
                if (doc) doc.locked = update.$set.locked;
                return { matchedCount: doc ? 1 : 0 };
            }

            // Handle update
            if (doc) {
                if (update.$set) {
                    Object.assign(doc, update.$set);
                }
                this.data.set(filter.correlationId, doc);
                return { matchedCount: 1 };
            }
        }
        
        return { matchedCount: 0 };
    }

    async insertOne(doc: any) {
        if (this.name === 'flows') {
            this.data.set(doc.correlationId, doc);
        }
        return { insertedId: "123" };
    }

    async findOne(filter: any) {
        if (this.name === 'flows' && filter.correlationId) {
            return this.data.get(filter.correlationId);
        }
        return null;
    }
}

export class MockDb {
    collections: Map<string, MockCollection> = new Map();

    collection(name: string) {
        if (!this.collections.has(name)) {
            this.collections.set(name, new MockCollection(name));
        }
        return this.collections.get(name);
    }
}

export class MockAgentStatusTracker {
    
    // In-memory database of task status records
    private tasks: Map<string, TaskStatusRecord> = new Map();
    private branches: Map<string, { branchId: string, parentTaskInstanceId: string, status: 'active' | 'completed', createdAt: Date, completedAt?: Date }> = new Map();
    private locks: Map<string, Promise<void>> = new Map(); // Track active locks for preventing race conditions
    private lockReleasers: Map<string, () => void> = new Map(); // Store release functions for locks

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
        };

        this.tasks.set(task.taskInstanceId!, record);
    }

    async agentStatusCompleted(taskInstanceId: string, agentTaskResponse: AgentTaskResponse): Promise<void> {
        const record = this.tasks.get(taskInstanceId);
        if (record) {
            record.status = "completed";
            record.stoppedAt = new Date(Date.now());
            record.taskOutput = agentTaskResponse.taskOutput;
            this.tasks.set(taskInstanceId, record);
        }
    }

    async agentStatusFailed(taskInstanceId: string, agentTaskResponse: AgentTaskResponse): Promise<void> {
        const record = this.tasks.get(taskInstanceId);
        if (record) {
            record.status = "failed";
            record.stoppedAt = new Date(Date.now());
            record.taskOutput = agentTaskResponse.taskOutput;
            this.tasks.set(taskInstanceId, record);
        }
    }

    async agentTasksPublished(tasks: AgentTaskRequest[]): Promise<void> {
        for (const task of tasks) {
            const record: TaskStatusRecord = {
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
            };

            this.tasks.set(task.taskInstanceId!, record);
        }
    }

    async createBranches(parentTaskInstanceId: string, branches: { branchId: string, tasks: AgentTaskRequest[] }[]): Promise<void> {
        for (const branch of branches) {
            this.branches.set(branch.branchId, {
                branchId: branch.branchId,
                parentTaskInstanceId: parentTaskInstanceId,
                createdAt: new Date(Date.now()),
                status: 'active'
            });
        }
    }

    async findGroupTasks(correlationId: string, groupId: string): Promise<TaskStatusRecord[]> {
        const results: TaskStatusRecord[] = [];
        for (const record of this.tasks.values()) {
            if (record.correlationId === correlationId && record.groupId === groupId) {
                results.push(record);
            }
        }
        return results;
    }

    async markBranchCompleted(branchId: string): Promise<void> {
        const branch = this.branches.get(branchId);
        if (branch) {
            branch.status = 'completed';
            branch.completedAt = new Date(Date.now());
            this.branches.set(branchId, branch);
        }
    }

    async areBranchesCompleted(branchIds: string[]): Promise<boolean> {
        for (const branchId of branchIds) {
            const branch = this.branches.get(branchId);
            if (!branch || branch.status !== 'completed') {
                return false;
            }
        }
        return true;
    }

    // Helper method to manually set task status for testing
    setTaskStatus(taskInstanceId: string, status: "published" | "started" | "completed" | "failed"): void {
        const record = this.tasks.get(taskInstanceId);
        if (record) {
            record.status = status;
            if (status === "completed" || status === "failed") {
                record.stoppedAt = new Date(Date.now());
            }
            this.tasks.set(taskInstanceId, record);
        }
    }

    // Helper method to get all tasks for debugging
    getAllTasks(): TaskStatusRecord[] {
        return Array.from(this.tasks.values());
    }

    // Helper method to get all branches for debugging
    getAllBranches(): Array<{ branchId: string, parentTaskInstanceId: string, status: 'active' | 'completed', createdAt: Date, completedAt?: Date }> {
        return Array.from(this.branches.values());
    }

    // Helper method to clear all data
    clear(): void {
        this.tasks.clear();
        this.branches.clear();
        this.locks.clear();
        this.lockReleasers.clear();
    }

    // Additional methods needed for TaskExecution tests
    async acquireTaskLock(taskInstanceId: string): Promise<void> {
        // Wait for any existing lock to be released
        while (this.locks.has(taskInstanceId)) {
            await this.locks.get(taskInstanceId);
        }
        
        // Create a new lock (a promise that will be resolved when releaseTaskLock is called)
        let releaseLock: () => void;
        const lockPromise = new Promise<void>((resolve) => {
            releaseLock = resolve;
        });
        
        // Store both the promise and the release function
        this.locks.set(taskInstanceId, lockPromise);
        this.lockReleasers.set(taskInstanceId, releaseLock!);
    }

    async releaseTaskLock(taskInstanceId: string): Promise<void> {
        // Release the lock by resolving the promise
        const releaseFn = this.lockReleasers.get(taskInstanceId);
        if (releaseFn) {
            releaseFn();
            this.lockReleasers.delete(taskInstanceId);
        }
        this.locks.delete(taskInstanceId);
    }

    async findTaskByInstanceId(taskInstanceId: string): Promise<TaskStatusRecord | null> {
        return this.tasks.get(taskInstanceId) || null;
    }

    async markTaskResumedAfterGroupCompletion(taskInstanceId: string, groupId: string): Promise<void> {
        const record = this.tasks.get(taskInstanceId);
        if (record) {
            if (!record.completedSubtaskGroups) {
                record.completedSubtaskGroups = [];
            }
            record.completedSubtaskGroups.push(groupId);
            this.tasks.set(taskInstanceId, record);
        }
    }

}

/**
 * Mock Message Bus for testing
 * Stores published tasks in memory for verification
 */
export class MockMessageBus {
    publishedTasks: AgentTaskRequest[] = [];

    async publishTask(task: AgentTaskRequest, cid: string): Promise<void> {
        this.publishedTasks.push(task);
    }

    clear(): void {
        this.publishedTasks = [];
    }
}

/**
 * Mock Agent Call that returns predefined responses
 */
export class MockAgentCall {
    execContext: any;
    agentDefinition: AgentDefinition;
    
    constructor(agentDefinition: AgentDefinition, private response: AgentTaskResponse) {
        this.agentDefinition = agentDefinition;
    }

    async execute(task: AgentTaskRequest, correlationId: string): Promise<AgentTaskResponse> {
        return this.response;
    }
}

/**
 * Mock Agent Call Factory
 * Allows configuring agent responses per agent name
 */
export class MockAgentCallFactory implements AgentCallFactory {
    private responses: Map<string, AgentTaskResponse> = new Map();

    /**
     * Configure the response for a specific agent
     */
    setAgentResponse(agentTaskId: string, response: AgentTaskResponse): void {
        this.responses.set(agentTaskId, response);
    }

    createAgentCall(agentDefinition: AgentDefinition): MockAgentCall {
        const response = this.responses.get(agentDefinition.taskId);
        if (!response) {
            throw new Error(`No response configured for agent ${agentDefinition.taskId}`);
        }
        return new MockAgentCall(agentDefinition, response);
    }

    clear(): void {
        this.responses.clear();
    }
}

/**
 * Mock Agents Catalog with in-memory storage
 */
export class MockAgentsCatalog {
    private agents: Map<TaskId, AgentDefinition> = new Map();

    /**
     * Register an agent in the catalog
     */
    registerAgent(agent: AgentDefinition): void {
        this.agents.set(agent.taskId, agent);
    }

    async findAgentByTaskId(taskId: TaskId): Promise<AgentDefinition | null> {
        return this.agents.get(taskId) || null;
    }

    async getAgents(): Promise<AgentDefinition[]> {
        return Array.from(this.agents.values());
    }

    clear(): void {
        this.agents.clear();
    }
}

