import { AgenticFlowTracker } from "../../../src/core/tracking/AgenticFlowTracker";
import { AgentStatusTracker, TaskStatusRecord } from "../../../src/core/tracking/AgentStatusTracker";
import { AgentTaskRequest, AgentTaskResponse } from "../../../src/model/AgentTask";
import { AgentDefinition } from "../../../src/model/AgentDefinition";
import { AgenticFlow, AgentNode, BranchNode, GroupNode } from "../../../src/core/tracking/AgenticFlow";
import { Db } from "mongodb";
import { ExecutionContext } from "toto-api-controller";
import { v4 as uuidv4 } from 'uuid';
import { expect } from 'chai';
import { MockDb, MockExecContext, MockAgentStatusTracker } from "./Mocks";

// ------------------------------------------------------------------------------------------------------------
// TESTS
// ------------------------------------------------------------------------------------------------------------

describe('AgenticFlowTracker', () => {

    let mockDb: Db;
    let mockExecContext: ExecutionContext;
    let mockStatusTracker: MockAgentStatusTracker;
    let tracker: AgenticFlowTracker;

    beforeEach(() => {
        mockDb = new MockDb() as any as Db;
        mockExecContext = new MockExecContext() as any as ExecutionContext;
        mockStatusTracker = new MockAgentStatusTracker();
        tracker = new AgenticFlowTracker(mockDb, mockExecContext, mockStatusTracker as any as AgentStatusTracker);
    });

    const removePrev = (obj: any, seen = new Set()) => {
        if (!obj || typeof obj !== 'object') return;
        if (seen.has(obj)) return;
        seen.add(obj);
        
        if ('prev' in obj) delete obj.prev;
        if ('locked' in obj) delete obj.locked;
        
        for (const key in obj) {
            removePrev(obj[key], seen);
        }
    };

    it('should start and complete a root agent successfully', async () => {
        const correlationId = uuidv4();
        const taskInstanceId = uuidv4();
        
        const task = new AgentTaskRequest({
            command: { command: "start" },
            taskId: "test.task",
            correlationId: correlationId,
            taskInstanceId: taskInstanceId,
            taskInputData: {}
        });

        const agent = new AgentDefinition();
        agent.name = "root-agent";

        // 1. Start Root Agent
        await tracker.rootAgentStarted(agent, task);

        // Verify
        expect(mockStatusTracker.startedCalls.length).to.equal(1);
        expect(mockStatusTracker.startedCalls[0].task.taskInstanceId).to.equal(taskInstanceId);

        // Verify Flow created in DB
        const flow = await mockDb.collection('flows').findOne({ correlationId });
        expect(flow).to.not.be.null;
        
        const expectedFlow = new AgenticFlow(correlationId, new AgentNode({
            taskId: "test.task",
            taskInstanceId: taskInstanceId,
            name: "root-agent"
        }));

        removePrev(flow);
        removePrev(expectedFlow);

        expect(flow).to.deep.equal(expectedFlow);

        // 2. Complete Root Agent
        const response = new AgentTaskResponse({
            correlationId: correlationId,
            stopReason: "completed",
            taskOutput: { result: "success" }
        });

        await tracker.agentCompleted(task, response);

        // Verify
        expect(mockStatusTracker.completedCalls.length).to.equal(1);
        expect(mockStatusTracker.completedCalls[0].taskInstanceId).to.equal(taskInstanceId);
    });

    /**
     * Tests handling of root agent spinning off subtasks
     * - Subtasks are grouped into a single group 
     * - under a single branch
     */
    it('should handle root agent spinning off subtasks', async () => {
        const correlationId = uuidv4();
        const rootTaskInstanceId = uuidv4();
        
        const rootTask = new AgentTaskRequest({
            command: { command: "start" },
            taskId: "root.task",
            correlationId: correlationId,
            taskInstanceId: rootTaskInstanceId,
            taskInputData: {}
        });

        const rootAgent = new AgentDefinition();
        rootAgent.name = "root-agent";

        // 1. Start Root Agent
        await tracker.rootAgentStarted(rootAgent, rootTask);

        // 2. Spin off subtasks (using branch with 1 branch containing 3 tasks)
        const branchId = uuidv4();
        const subtasks = [1, 2, 3].map(i => new AgentTaskRequest({
            command: { command: "start" },
            taskId: "sub.task",
            correlationId: correlationId,
            taskInstanceId: uuidv4(),
            taskInputData: { index: i },
            parentTask: { taskId: "root.task", taskInstanceId: rootTaskInstanceId },
            branchId: branchId,
            taskGroupId: "group-1"
        }));

        await tracker.branch([{ branchId: branchId, tasks: subtasks }]);

        // Verify calls
        expect(mockStatusTracker.publishedCalls.length).to.equal(1);
        expect(mockStatusTracker.publishedCalls[0].length).to.equal(3);
        expect(mockStatusTracker.createBranchesCalls.length).to.equal(1);

        // Verify Flow created in DB
        const flow = await mockDb.collection('flows').findOne({ correlationId });
        expect(flow).to.not.be.null;

        const expectedFlow = new AgenticFlow(correlationId, new AgentNode({
            taskId: "root.task",
            taskInstanceId: rootTaskInstanceId,
            name: "root-agent",
            next: new BranchNode({
                branches: [{
                    branchId: branchId,
                    branch: new GroupNode({
                        agents: subtasks.map(t => new AgentNode({ taskId: t.taskId, taskInstanceId: t.taskInstanceId! })),
                        name: "group-1"
                    })
                }]
            })
        }));

        removePrev(flow);
        removePrev(expectedFlow);

        expect(flow).to.deep.equal(expectedFlow);

        // 3. Check if group is done (should be false initially if we mock it)
        // Mocking findGroupTasks to return incomplete tasks
        mockStatusTracker.groupTasks = subtasks.map(t => ({
            correlationId: t.correlationId!,
            taskId: t.taskId,
            taskInstanceId: t.taskInstanceId!,
            startedAt: new Date(),
            status: "started",
            taskInput: t.taskInputData
        } as TaskStatusRecord));

        let isDone = await tracker.isGroupDone("group-1");
        expect(isDone).to.be.false;

        // 4. Complete tasks (update mock)
        mockStatusTracker.groupTasks.forEach(t => t.status = "completed");

        isDone = await tracker.isGroupDone("group-1");
        expect(isDone).to.be.true;
    });

    /**
     * Tests handling of root agent creating branches and completing them
     * - 2 branches created under the root agent
     * - Completing branches should mark parent branches as completed if all siblings are completed
     */
    it('should handle root agent creating branches', async () => {
        const correlationId = uuidv4();
        const rootTaskInstanceId = uuidv4();
        
        const rootTask = new AgentTaskRequest({
            command: { command: "start" },
            taskId: "root.task",
            correlationId: correlationId,
            taskInstanceId: rootTaskInstanceId,
            taskInputData: {}
        });

        const rootAgent = new AgentDefinition();
        rootAgent.name = "root-agent";

        // 1. Start Root Agent
        await tracker.rootAgentStarted(rootAgent, rootTask);

        // 2. Create 2 branches
        const branch1Id = uuidv4();
        const branch2Id = uuidv4();
        
        const task1 = new AgentTaskRequest({
            command: { command: "start" },
            taskId: "branch1.task",
            correlationId: correlationId,
            taskInstanceId: uuidv4(),
            parentTask: { taskId: "root.task", taskInstanceId: rootTaskInstanceId },
            branchId: branch1Id
        });

        const task2 = new AgentTaskRequest({
            command: { command: "start" },
            taskId: "branch2.task",
            correlationId: correlationId,
            taskInstanceId: uuidv4(),
            parentTask: { taskId: "root.task", taskInstanceId: rootTaskInstanceId },
            branchId: branch2Id
        });

        await tracker.branch([
            { branchId: branch1Id, tasks: [task1] },
            { branchId: branch2Id, tasks: [task2] }
        ]);

        // Verify Flow created in DB
        const flow = await mockDb.collection('flows').findOne({ correlationId });
        expect(flow).to.not.be.null;

        const expectedFlow = new AgenticFlow(correlationId, new AgentNode({
            taskId: "root.task",
            taskInstanceId: rootTaskInstanceId,
            name: "root-agent",
            next: new BranchNode({
                branches: [
                    { branchId: branch1Id, branch: new AgentNode({ taskId: task1.taskId, taskInstanceId: task1.taskInstanceId! }) },
                    { branchId: branch2Id, branch: new AgentNode({ taskId: task2.taskId, taskInstanceId: task2.taskInstanceId! }) }
                ]
            })
        }));

        removePrev(flow);
        removePrev(expectedFlow);

        expect(flow).to.deep.equal(expectedFlow);

        // 3. Complete Branch 1
        // Mock that branches are NOT all completed yet
        mockStatusTracker.branchesCompleted = false;

        await tracker.markBranchCompleted(correlationId, branch1Id);

        // Verify markBranchCompleted called for branch1
        expect(mockStatusTracker.markBranchCompletedCalls).to.include(branch1Id);
        
        // 4. Complete Branch 2
        // Now mock that all branches are completed
        mockStatusTracker.branchesCompleted = true;

        await tracker.markBranchCompleted(correlationId, branch2Id);

        // Verify branch 2 marked completed
        expect(mockStatusTracker.markBranchCompletedCalls).to.include(branch2Id);
    });
});
