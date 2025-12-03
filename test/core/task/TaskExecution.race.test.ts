import { expect } from "chai";
import { TaskExecution } from "../../../src/core/task/TaskExecution";
import { AgentTaskRequest, AgentTaskResponse } from "../../../src/model/AgentTask";
import { AgentDefinition } from "../../../src/model/AgentDefinition";
import { AgenticFlowTracker } from "../../../src/core/tracking/AgenticFlowTracker";
import { AgentStatusTracker } from "../../../src/core/tracking/AgentStatusTracker";
import {
    MockDb,
    MockExecContext,
    MockAgentCallFactory,
    MockAgentsCatalog,
    MockAgentStatusTracker,
} from "../tracking/Mocks";
import { AgenticFlow, AgentNode, GroupNode } from "../../../src/core/tracking/AgenticFlow";

/**
 * Race Condition Tests for TaskExecution
 * 
 * These tests simulate concurrent execution scenarios to verify that:
 * - Locks prevent race conditions when multiple tasks complete simultaneously
 * - Parent tasks are resumed only once even if multiple children complete at the same time
 * - Branch completion is handled correctly under concurrent conditions
 * - Flow structure modifications don't result in lost updates
 * 
 * Test Cases:
 * 
 * 1. CRITICAL: Concurrent task completion in same group
 *    - Tests: resumeParentTask() locking mechanism
 *    - Validates: Parent resumed exactly once when multiple tasks complete simultaneously
 *    - Race prevented: Multiple tasks checking if group is done and all trying to resume parent
 * 
 * 2. HIGH PRIORITY: Concurrent branch completion
 *    - Tests: Branch completion tracking and parent notification
 *    - Validates: Each branch marked complete once, no duplicate branch records
 *    - Race prevented: Multiple branches completing and all trying to mark themselves/parent complete
 * 
 * 3. CRITICAL: Concurrent flow modifications
 *    - Tests: Flow locking during branch/append operations
 *    - Validates: All spawned subtasks are tracked in flow structure
 *    - Race prevented: Lost updates when multiple agents modify flow simultaneously
 * 
 * 4. HIGH PRIORITY: Last two tasks completing simultaneously
 *    - Tests: Group completion check timing
 *    - Validates: Parent resumed once even when final tasks complete at same time
 *    - Race prevented: Both tasks see group as "not done" and both try to resume parent
 */
describe("TaskExecution - Race Conditions", () => {

    let mockDb: MockDb;
    let mockExecContext: MockExecContext;
    let mockAgentCallFactory: MockAgentCallFactory;
    let mockAgentsCatalog: MockAgentsCatalog;
    let mockAgentStatusTracker: MockAgentStatusTracker;
    let agenticFlowTracker: AgenticFlowTracker;
    let taskExecution: TaskExecution;

    beforeEach(() => {
        // Initialize mocks
        mockDb = new MockDb();
        mockExecContext = new MockExecContext();
        mockAgentCallFactory = new MockAgentCallFactory();
        mockAgentsCatalog = new MockAgentsCatalog();
        mockAgentStatusTracker = new MockAgentStatusTracker();

        // Create AgentStatusTracker with mock db
        const agentStatusTracker = new AgentStatusTracker(mockDb as any, mockExecContext as any);

        // Replace the real methods with mock methods
        Object.setPrototypeOf(agentStatusTracker, mockAgentStatusTracker);
        Object.assign(agentStatusTracker, mockAgentStatusTracker);

        // Create AgenticFlowTracker with real implementation but mock dependencies
        agenticFlowTracker = new AgenticFlowTracker(mockDb as any, mockExecContext as any, agentStatusTracker);

        // Create TaskExecution
        taskExecution = new TaskExecution({
            execContext: mockExecContext as any,
            agentCallFactory: mockAgentCallFactory as any,
            agenticFlowTracker: agenticFlowTracker,
            agentsCatalog: mockAgentsCatalog as any,
        });
    });

    afterEach(() => {
        // Clean up
        mockAgentCallFactory.clear();
        mockAgentsCatalog.clear();
        mockAgentStatusTracker.clear();
        mockExecContext.config.messageBus.clear();
    });

    it("concurrent task completion in same group should resume parent only once", async () => {
        /**
         * Test scenario:
         * 1. Orchestrator spawns a group of 3 tasks
         * 2. All 3 tasks complete simultaneously (in parallel)
         * 3. Verify that the parent is resumed only once, not three times
         * 
         * This tests the locking mechanism in resumeParentTask()
         */

        const cid = 'race-condition-test';
        const msgBus = mockExecContext.config.messageBus;

        // Setup agents
        const orchestrator = new AgentDefinition();
        const worker = new AgentDefinition();

        orchestrator.taskId = "orchestrator";
        worker.taskId = "worker";

        mockAgentsCatalog.registerAgent(orchestrator);
        mockAgentsCatalog.registerAgent(worker);

        // Step 1: Orchestrator spawns a group of 3 tasks
        let response = new AgentTaskResponse({
            correlationId: cid,
            stopReason: "subtasks",
            subtasks: [
                {
                    groupId: "worker-group", tasks: [
                        { taskId: worker.taskId, taskInputData: { id: 1 } },
                        { taskId: worker.taskId, taskInputData: { id: 2 } },
                        { taskId: worker.taskId, taskInputData: { id: 3 } }]
                }
            ]
        })
        mockAgentCallFactory.setAgentResponse(orchestrator.taskId, response);

        const rootTask = new AgentTaskRequest({ command: { command: "start" }, taskId: orchestrator.taskId, correlationId: cid, taskInputData: { input: "root" } });

        await taskExecution.do(rootTask);

        // Verify 3 tasks were published
        expect(msgBus.publishedTasks).to.have.length(3);

        const task1 = msgBus.publishedTasks[0];
        const task2 = msgBus.publishedTasks[1];
        const task3 = msgBus.publishedTasks[2];

        // Step 2: Configure all workers to complete
        mockAgentCallFactory.setAgentResponse(worker.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "done" } }));

        // Execute all 3 tasks in parallel
        const results = await Promise.all([
            taskExecution.do(task1),
            taskExecution.do(task2),
            taskExecution.do(task3)
        ]);

        // Verify all completed
        expect(results[0].stopReason).to.equal("completed");
        expect(results[1].stopReason).to.equal("completed");
        expect(results[2].stopReason).to.equal("completed");

        // Step 3: Check how many resume tasks were published
        const resumeTasks = msgBus.publishedTasks.filter(t => t.command.command === "resume");

        console.log(`Total tasks published: ${msgBus.publishedTasks.length}`);
        console.log(`Resume tasks published: ${resumeTasks.length}`);

        // EXPECTED: Parent should be resumed only once due to locking
        // We should have 3 worker tasks + 1 resume task = 4 total
        expect(msgBus.publishedTasks).to.have.length(4,
            `Expected 4 tasks (3 workers + 1 resume) but got ${msgBus.publishedTasks.length}. This indicates the parent was resumed ${resumeTasks.length} times instead of once.`);

        expect(resumeTasks).to.have.length(1,
            `Parent should be resumed only once, but was resumed ${resumeTasks.length} times. The locking mechanism should prevent duplicate resumes.`);

        expect(resumeTasks[0].command.completedTaskGroupId).to.equal("worker-group");

        // Verify the parent task was marked as resumed only once
        const parentTaskRecord = mockAgentStatusTracker.getAllTasks().find(
            t => t.taskInstanceId === rootTask.taskInstanceId
        );
        expect(parentTaskRecord?.completedSubtaskGroups).to.deep.equal(["worker-group"],
            "Parent task should have the completed group marked only once");

        // Complete the resume task
        mockAgentCallFactory.setAgentResponse(orchestrator.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { finalResult: "all done" } }));

        await taskExecution.do(resumeTasks[0]);

        // Verify no additional resume tasks were published after completing the resume
        const finalResumeCount = msgBus.publishedTasks.filter(t => t.command.command === "resume").length;
        expect(finalResumeCount).to.equal(1, "No duplicate resume tasks should be created");
    });

    it("concurrent branch completion should mark parent branch only once", async () => {
        /**
         * Test scenario:
         * 1. Orchestrator spawns 2 branches, each with 2 tasks
         * 2. Both branches complete simultaneously
         * 3. Verify that each branch is marked complete only once
         * 4. Verify that parent resumes are handled correctly
         * 
         * This tests branch completion race conditions
         */

        const cid = 'branch-race-test';
        const msgBus = mockExecContext.config.messageBus;

        const orchestrator = new AgentDefinition();
        const worker = new AgentDefinition();

        orchestrator.taskId = "orchestrator";
        worker.taskId = "worker";

        mockAgentsCatalog.registerAgent(orchestrator);
        mockAgentsCatalog.registerAgent(worker);

        // Step 1: Orchestrator spawns 2 branches
        mockAgentCallFactory.setAgentResponse(orchestrator.taskId, new AgentTaskResponse({
            correlationId: cid,
            stopReason: "subtasks",
            subtasks: [
                { groupId: "branch1-group", tasks: [{ taskId: worker.taskId, taskInputData: { branch: 1, task: 1 } }, { taskId: worker.taskId, taskInputData: { branch: 1, task: 2 } }] },
                { groupId: "branch2-group", tasks: [{ taskId: worker.taskId, taskInputData: { branch: 2, task: 1 } }, { taskId: worker.taskId, taskInputData: { branch: 2, task: 2 } }] }
            ]
        }));

        const rootTask = new AgentTaskRequest({ command: { command: "start" }, taskId: orchestrator.taskId, correlationId: cid, taskInputData: { input: "root" } });
        await taskExecution.do(rootTask);

        expect(msgBus.publishedTasks).to.have.length(4); // 2 branches x 2 tasks

        const b1t1 = msgBus.publishedTasks[0];
        const b1t2 = msgBus.publishedTasks[1];
        const b2t1 = msgBus.publishedTasks[2];
        const b2t2 = msgBus.publishedTasks[3];

        const branch1Id = b1t1.branchId!;
        const branch2Id = b2t1.branchId!;

        expect(branch1Id).to.exist;
        expect(branch2Id).to.exist;
        expect(branch1Id).to.not.equal(branch2Id);

        // Step 2: Complete all tasks in both branches simultaneously
        mockAgentCallFactory.setAgentResponse(worker.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "done" } }));

        // First complete task 1 in each branch in parallel
        await Promise.all([taskExecution.do(b1t1), taskExecution.do(b2t1)]);

        // Then complete task 2 in each branch in parallel
        await Promise.all([taskExecution.do(b1t2), taskExecution.do(b2t2)]);

        // Each branch should have triggered exactly one resume
        const resumeTasks = msgBus.publishedTasks.filter(t => t.command.command === "resume");
        expect(resumeTasks).to.have.length(2, `Expected 2 resume tasks (one per branch), got ${resumeTasks.length}`);

        // Verify each branch has unique resume task
        const branch1Resumes = resumeTasks.filter(t => t.command.branchId === branch1Id);
        const branch2Resumes = resumeTasks.filter(t => t.command.branchId === branch2Id);

        expect(branch1Resumes).to.have.length(1, "Branch 1 should trigger exactly one resume");
        expect(branch2Resumes).to.have.length(1, "Branch 2 should trigger exactly one resume");

        // Step 3: Complete both branch resumes saying "I'm done"
        mockAgentCallFactory.setAgentResponse(orchestrator.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "branch done" } }));

        await Promise.all([
            taskExecution.do(branch1Resumes[0]),
            taskExecution.do(branch2Resumes[0])
        ]);

        // Verify both branches are marked complete
        expect(await mockAgentStatusTracker.areBranchesCompleted([branch1Id, branch2Id])).to.be.true;

        // Verify no duplicate branch completion
        const allBranches = mockAgentStatusTracker.getAllBranches();
        const branch1Records = allBranches.filter(b => b.branchId === branch1Id);
        const branch2Records = allBranches.filter(b => b.branchId === branch2Id);

        expect(branch1Records).to.have.length(1, "Branch 1 should only have one record");
        expect(branch2Records).to.have.length(1, "Branch 2 should only have one record");
        expect(branch1Records[0].status).to.equal("completed");
        expect(branch2Records[0].status).to.equal("completed");
    });

    it("concurrent flow modifications should not lose updates", async () => {
        /**
         * Test scenario:
         * 1. Root task spawns a group of 2 agents
         * 2. Both agents spawn subtasks simultaneously
         * 3. Verify that the flow structure contains all spawned tasks
         * 
         * This tests the flow locking mechanism during concurrent modifications
         */

        const cid = 'flow-modification-race-test';
        const msgBus = mockExecContext.config.messageBus;

        const orchestrator = new AgentDefinition();
        const spawner = new AgentDefinition();
        const worker = new AgentDefinition();

        orchestrator.taskId = "orchestrator";
        spawner.taskId = "spawner";
        worker.taskId = "worker";

        mockAgentsCatalog.registerAgent(orchestrator);
        mockAgentsCatalog.registerAgent(spawner);
        mockAgentsCatalog.registerAgent(worker);

        // Step 1: Orchestrator spawns 2 spawners
        mockAgentCallFactory.setAgentResponse(orchestrator.taskId, new AgentTaskResponse({
            correlationId: cid,
            stopReason: "subtasks",
            subtasks: [
                {
                    groupId: "spawners",
                    tasks: [
                        { taskId: spawner.taskId, taskInputData: { id: 1 } },
                        { taskId: spawner.taskId, taskInputData: { id: 2 } }
                    ]
                }
            ]
        }));

        const rootTask = new AgentTaskRequest({ command: { command: "start" }, taskId: orchestrator.taskId, correlationId: cid, taskInputData: { input: "root" } });
        await taskExecution.do(rootTask);

        expect(msgBus.publishedTasks).to.have.length(2);

        const spawner1 = msgBus.publishedTasks[0];
        const spawner2 = msgBus.publishedTasks[1];

        // Step 2: Both spawners spawn subtasks simultaneously
        mockAgentCallFactory.setAgentResponse(spawner.taskId, new AgentTaskResponse({
            correlationId: cid,
            stopReason: "subtasks",
            subtasks: [
                {
                    groupId: "workers", tasks: [
                        { taskId: worker.taskId, taskInputData: { worker: 1 } },
                        { taskId: worker.taskId, taskInputData: { worker: 2 } }
                    ]
                }
            ]
        }));

        // Execute both spawners in parallel - this triggers concurrent flow modifications
        await Promise.all([
            taskExecution.do(spawner1),
            taskExecution.do(spawner2)
        ]);

        // Step 3: Verify all tasks were tracked
        // Should have: 2 spawners + (2 workers from spawner1) + (2 workers from spawner2) = 6 tasks published
        expect(msgBus.publishedTasks.length).to.be.at.least(6, "All spawned tasks should be published");

        // Verify the flow structure is intact
        const flow = await agenticFlowTracker.getFlow(cid);
        expect(flow).to.exist;
        expect(flow!.root).to.exist;

        // All tasks should be tracked
        const allTasks = mockAgentStatusTracker.getAllTasks();
        expect(allTasks.length).to.be.at.least(7, "Should have root + 2 spawners + 4 workers (at least)"); // Root + 2 spawners + workers
    });

    it("last two tasks in group completing simultaneously should resume parent once", async () => {
        /**
         * Test scenario:
         * 1. Orchestrator spawns a group of 5 tasks
         * 2. Complete first 3 tasks normally
         * 3. Complete last 2 tasks simultaneously
         * 4. Verify parent is resumed exactly once
         * 
         * This tests the group completion check race condition
         */

        const cid = 'group-completion-race-test';
        const msgBus = mockExecContext.config.messageBus;

        const orchestrator = new AgentDefinition();
        const worker = new AgentDefinition();

        orchestrator.taskId = "orchestrator";
        worker.taskId = "worker";

        mockAgentsCatalog.registerAgent(orchestrator);
        mockAgentsCatalog.registerAgent(worker);

        // Step 1: Spawn 5 tasks
        mockAgentCallFactory.setAgentResponse(orchestrator.taskId, new AgentTaskResponse({
            correlationId: cid,
            stopReason: "subtasks",
            subtasks: [{
                groupId: "big-group",
                tasks: [
                    { taskId: worker.taskId, taskInputData: { id: 1 } },
                    { taskId: worker.taskId, taskInputData: { id: 2 } },
                    { taskId: worker.taskId, taskInputData: { id: 3 } },
                    { taskId: worker.taskId, taskInputData: { id: 4 } },
                    { taskId: worker.taskId, taskInputData: { id: 5 } }
                ]
            }]
        }));

        const rootTask = new AgentTaskRequest({ command: { command: "start" }, taskId: orchestrator.taskId, correlationId: cid, taskInputData: { input: "root" } });
        await taskExecution.do(rootTask);

        expect(msgBus.publishedTasks).to.have.length(5);

        const tasks = msgBus.publishedTasks.slice(0, 5);

        // Step 2: Complete first 3 tasks sequentially
        mockAgentCallFactory.setAgentResponse(worker.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "done" } }));

        await taskExecution.do(tasks[0]);
        await taskExecution.do(tasks[1]);
        await taskExecution.do(tasks[2]);

        // No resume yet
        expect(msgBus.publishedTasks).to.have.length(5);

        // Step 3: Complete last 2 tasks simultaneously
        await Promise.all([
            taskExecution.do(tasks[3]),
            taskExecution.do(tasks[4])
        ]);

        // Step 4: Verify exactly one resume
        const resumeTasks = msgBus.publishedTasks.filter(t => t.command.command === "resume");
        expect(resumeTasks).to.have.length(1, `Expected exactly 1 resume when group completes, got ${resumeTasks.length}`);

        // Verify the group is correctly marked as completed in the parent
        const parentTaskRecord = mockAgentStatusTracker.getAllTasks().find(t => t.taskInstanceId === rootTask.taskInstanceId);
        expect(parentTaskRecord?.completedSubtaskGroups).to.deep.equal(["big-group"]);
    });

    it("complex branching with nested spawns should maintain correct flow structure", async () => {
        /**
         * Test scenario:
         * 1. Orchestrator spawns 2 branches:
         *    - Branch 1: Single agent that spawns 2 more branches (each with single agent)
         *    - Branch 2: Group of 3 agents that complete
         * 2. Execute all tasks (some in parallel)
         * 3. Verify flow structure contains all expected elements regardless of execution order
         * 
         * This tests flow structure integrity under complex parallel branching
         */

        const cid = 'complex-branching-test';
        const msgBus = mockExecContext.config.messageBus;

        const orchestrator = new AgentDefinition();
        const spawner = new AgentDefinition();
        const worker = new AgentDefinition();

        orchestrator.taskId = "orchestrator";
        spawner.taskId = "spawner";
        worker.taskId = "worker";

        mockAgentsCatalog.registerAgent(orchestrator);
        mockAgentsCatalog.registerAgent(spawner);
        mockAgentsCatalog.registerAgent(worker);

        // Step 1: Orchestrator spawns 2 branches
        mockAgentCallFactory.setAgentResponse(orchestrator.taskId, new AgentTaskResponse({
            correlationId: cid,
            stopReason: "subtasks",
            subtasks: [
                { groupId: "branch1-group", tasks: [{ taskId: spawner.taskId, taskInputData: { branch: 1 } }] },
                { groupId: "branch2-group", tasks: [{ taskId: worker.taskId, taskInputData: { branch: 2, id: 1 } }, { taskId: worker.taskId, taskInputData: { branch: 2, id: 2 } }, { taskId: worker.taskId, taskInputData: { branch: 2, id: 3 } }] }
            ]
        }));

        const rootTask = new AgentTaskRequest({ command: { command: "start" }, taskId: orchestrator.taskId, correlationId: cid, taskInputData: { input: "root" } });
        await taskExecution.do(rootTask);

        expect(msgBus.publishedTasks).to.have.length(4); // 1 spawner + 3 workers

        const branch1Spawner = msgBus.publishedTasks[0];
        const branch2Workers = msgBus.publishedTasks.slice(1, 4);

        const branch1Id = branch1Spawner.branchId!;
        const branch2Id = branch2Workers[0].branchId!;

        expect(branch1Id).to.exist;
        expect(branch2Id).to.exist;
        expect(branch1Id).to.not.equal(branch2Id);

        // Step 2: Branch 1 spawner spawns 2 nested branches
        mockAgentCallFactory.setAgentResponse(spawner.taskId, new AgentTaskResponse({
            correlationId: cid,
            stopReason: "subtasks",
            subtasks: [
                { groupId: "nested-branch1", tasks: [{ taskId: worker.taskId, taskInputData: { nested: 1 } }] },
                { groupId: "nested-branch2", tasks: [{ taskId: worker.taskId, taskInputData: { nested: 2 } }] }
            ]
        }));

        await taskExecution.do(branch1Spawner);

        expect(msgBus.publishedTasks).to.have.length(6); // Previous 4 + 2 nested workers

        const nestedWorker1 = msgBus.publishedTasks[4];
        const nestedWorker2 = msgBus.publishedTasks[5];

        const nestedBranch1Id = nestedWorker1.branchId!;
        const nestedBranch2Id = nestedWorker2.branchId!;

        expect(nestedBranch1Id).to.exist;
        expect(nestedBranch2Id).to.exist;
        expect(nestedBranch1Id).to.not.equal(nestedBranch2Id);
        expect(nestedBranch1Id).to.not.equal(branch1Id);
        expect(nestedBranch1Id).to.not.equal(branch2Id);

        // Step 3: Complete all tasks (some in parallel to test order-independence)
        mockAgentCallFactory.setAgentResponse(worker.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "done" } }));

        // Complete branch 2 workers in parallel
        await Promise.all(branch2Workers.map(w => taskExecution.do(w)));

        // Complete nested workers in parallel
        await Promise.all([taskExecution.do(nestedWorker1), taskExecution.do(nestedWorker2)]);

        // Step 4: Complete branch 2 resume (saying "done")
        const branch2Resume = msgBus.publishedTasks.find(t => t.command.command === "resume" && t.command.branchId === branch2Id);
        expect(branch2Resume).to.exist;

        mockAgentCallFactory.setAgentResponse(orchestrator.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "branch done" } }));
        await taskExecution.do(branch2Resume!);

        // Step 5: Complete nested branch resumes
        const nestedResumes = msgBus.publishedTasks.filter(t => t.command.command === "resume" && (t.command.branchId === nestedBranch1Id || t.command.branchId === nestedBranch2Id));
        expect(nestedResumes).to.have.length(2);

        mockAgentCallFactory.setAgentResponse(spawner.taskId, new AgentTaskResponse({ correlationId: cid, stopReason: "completed", taskOutput: { result: "nested done" } }));
        await Promise.all(nestedResumes.map(r => taskExecution.do(r)));

        // Step 6: Verify flow structure
        const flow = await agenticFlowTracker.getFlow(cid);
        expect(flow).to.exist;
        expect(flow!.root).to.exist;

        // Verify root is an AgentNode (orchestrator)
        expect(flow!.root.getType()).to.equal("agent");
        const rootNode = flow!.root as AgentNode;
        expect(rootNode.taskId).to.equal(orchestrator.taskId);
        expect(rootNode.taskInstanceId).to.equal(rootTask.taskInstanceId);

        // Verify root has a BranchNode as next
        const rootNext = rootNode.getNext();
        expect(rootNext).to.exist;
        expect(rootNext!.getType()).to.equal("branch");

        const topBranchNode = rootNext as import("../../../src/core/tracking/AgenticFlow").BranchNode;
        expect(topBranchNode.branches).to.have.length(2);

        // Find branch1 and branch2 in the flow structure
        const flowBranch1 = topBranchNode.branches.find(b => b.branchId === branch1Id);
        const flowBranch2 = topBranchNode.branches.find(b => b.branchId === branch2Id);

        expect(flowBranch1).to.exist;
        expect(flowBranch2).to.exist;

        // Verify Branch 1 structure: AgentNode (spawner) -> BranchNode (2 nested branches)
        expect(flowBranch1!.branch.getType()).to.equal("agent");
        const branch1SpawnerNode = flowBranch1!.branch as AgentNode;
        expect(branch1SpawnerNode.taskId).to.equal(spawner.taskId);
        expect(branch1SpawnerNode.taskInstanceId).to.equal(branch1Spawner.taskInstanceId);

        const spawnerNext = branch1SpawnerNode.getNext();
        expect(spawnerNext).to.exist;
        expect(spawnerNext!.getType()).to.equal("branch");

        const nestedBranchNode = spawnerNext as import("../../../src/core/tracking/AgenticFlow").BranchNode;
        expect(nestedBranchNode.branches).to.have.length(2);

        // Verify nested branches exist
        const flowNestedBranch1 = nestedBranchNode.branches.find(b => b.branchId === nestedBranch1Id);
        const flowNestedBranch2 = nestedBranchNode.branches.find(b => b.branchId === nestedBranch2Id);

        expect(flowNestedBranch1).to.exist;
        expect(flowNestedBranch2).to.exist;

        // Each nested branch should be a single AgentNode
        expect(flowNestedBranch1!.branch.getType()).to.equal("agent");
        expect(flowNestedBranch2!.branch.getType()).to.equal("agent");

        const nested1Agent = flowNestedBranch1!.branch as AgentNode;
        const nested2Agent = flowNestedBranch2!.branch as AgentNode;

        expect(nested1Agent.taskId).to.equal(worker.taskId);
        expect(nested2Agent.taskId).to.equal(worker.taskId);

        // Verify Branch 2 structure: GroupNode with 3 workers
        expect(flowBranch2!.branch.getType()).to.equal("group");
        const branch2GroupNode = flowBranch2!.branch as GroupNode;
        expect(branch2GroupNode.groupId).to.equal("branch2-group");
        expect(branch2GroupNode.agents).to.have.length(3);

        // Verify all agents in branch2 group are workers
        branch2GroupNode.agents.forEach(agent => {
            expect(agent.taskId).to.equal(worker.taskId);
            expect(agent.getType()).to.equal("agent");
        });

        // Verify the 3 branch2 workers are the ones we spawned (order-independent)
        const branch2AgentInstanceIds = branch2GroupNode.agents.map(a => a.taskInstanceId);
        const expectedBranch2InstanceIds = branch2Workers.map(w => w.taskInstanceId);
        expect(branch2AgentInstanceIds).to.have.members(expectedBranch2InstanceIds);

        // Verify all tasks are tracked
        const allTasks = mockAgentStatusTracker.getAllTasks();
        expect(allTasks).to.have.length.at.least(7); // 1 root + 1 spawner + 3 branch2 workers + 2 nested workers

        // Verify branch structure (order-independent)
        const allBranches = mockAgentStatusTracker.getAllBranches();
        
        // Should have 4 branches: branch1, branch2, nestedBranch1, nestedBranch2
        expect(allBranches).to.have.length(4);

        // Verify branch1 and branch2 are siblings (same parent)
        const topLevelBranches = allBranches.filter(b => b.parentTaskInstanceId === rootTask.taskInstanceId);
        expect(topLevelBranches).to.have.length(2);
        expect(topLevelBranches.map(b => b.branchId)).to.include.members([branch1Id, branch2Id]);

        // Verify nested branches are children of branch1Spawner
        const nestedBranches = allBranches.filter(b => b.parentTaskInstanceId === branch1Spawner.taskInstanceId);
        expect(nestedBranches).to.have.length(2);
        expect(nestedBranches.map(b => b.branchId)).to.include.members([nestedBranch1Id, nestedBranch2Id]);

        // Verify group sizes (order-independent)
        const branch1SpawnerTask = allTasks.find(t => t.taskInstanceId === branch1Spawner.taskInstanceId);
        expect(branch1SpawnerTask).to.exist;

        const branch2GroupTasks = allTasks.filter(t => t.groupId === "branch2-group" && t.taskId === worker.taskId);
        expect(branch2GroupTasks).to.have.length(3, "Branch 2 should have 3 workers");

        const nestedBranch1Tasks = allTasks.filter(t => t.groupId === "nested-branch1");
        const nestedBranch2Tasks = allTasks.filter(t => t.groupId === "nested-branch2");
        expect(nestedBranch1Tasks).to.have.length(1, "Nested branch 1 should have 1 worker");
        expect(nestedBranch2Tasks).to.have.length(1, "Nested branch 2 should have 1 worker");

        // Verify all branches completed
        expect(await mockAgentStatusTracker.areBranchesCompleted([branch1Id, branch2Id, nestedBranch1Id, nestedBranch2Id])).to.be.true;
    });

});