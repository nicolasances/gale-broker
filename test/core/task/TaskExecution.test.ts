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
import { AgenticFlow, AgentNode, BranchNode, GroupNode } from "../../../src/core/tracking/AgenticFlow";
import { removePrev } from "./util/FlowUtils";

describe("TaskExecution", () => {

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

    it("simple agent completion", async () => {
        // Setup: Register an agent
        const agentDef = new AgentDefinition();
        agentDef.taskId = "simple-task";

        mockAgentsCatalog.registerAgent(agentDef);

        // Configure the agent to return a completed response
        mockAgentCallFactory.setAgentResponse("simple-task", new AgentTaskResponse({ correlationId: "test-correlation", stopReason: "completed", taskOutput: { result: "success" } }));

        // Create a root task request
        const taskRequest = new AgentTaskRequest({
            command: { command: "start" },
            taskId: "simple-task",
            taskInputData: { input: "test" }
        });

        // Execute the task
        const response = await taskExecution.do(taskRequest);

        // Verify the response
        expect(response.stopReason).to.equal("completed");
        expect(response.taskOutput).to.deep.equal({ result: "success" });

        // Verify that the task was tracked
        const allTasks = mockAgentStatusTracker.getAllTasks();
        expect(allTasks).to.have.length(1);
        expect(allTasks[0].status).to.equal("completed");
        expect(allTasks[0].taskId).to.equal("simple-task");

        // Verify that correlationId and taskInstanceId were assigned
        expect(taskRequest.correlationId).to.exist;
        expect(taskRequest.taskInstanceId).to.exist;

        // Verify no subtasks were published
        expect(mockExecContext.config.messageBus.publishedTasks).to.have.length(0);

        // Verify the flow
        const expectedFlow = new AgenticFlow(taskRequest.correlationId!, new AgentNode({
            taskId: "simple-task",
            taskInstanceId: taskRequest.taskInstanceId!,
        }));

        const actualFlow = await agenticFlowTracker.getFlow(taskRequest.correlationId!);

        expect(actualFlow).to.deep.equal(expectedFlow);
    });

    it("group execution", async () => {
        // Setup: Register parent agent
        const parentAgentDef = new AgentDefinition();
        const childAgent1Def = new AgentDefinition();
        const childAgent2Def = new AgentDefinition();

        parentAgentDef.taskId = "orchestrator-task";
        childAgent1Def.taskId = "child-task-1";
        childAgent2Def.taskId = "child-task-2";

        mockAgentsCatalog.registerAgent(parentAgentDef);
        mockAgentsCatalog.registerAgent(childAgent1Def);
        mockAgentsCatalog.registerAgent(childAgent2Def);

        // Step 1: Configure parent agent to return subtasks
        const subtasksResponse = new AgentTaskResponse({
            correlationId: "test-correlation",
            stopReason: "subtasks",
            subtasks: [
                {
                    groupId: "group-1",
                    tasks: [
                        { taskId: "child-task-1", taskInputData: { childInput: "data1" } },
                        { taskId: "child-task-2", taskInputData: { childInput: "data2" } }
                    ]
                }
            ]
        });
        mockAgentCallFactory.setAgentResponse("orchestrator-task", subtasksResponse);

        // Execute the root task
        const rootTaskRequest = new AgentTaskRequest({
            command: { command: "start" },
            taskId: "orchestrator-task",
            correlationId: "test-correlation",
            taskInputData: { input: "root-data" }
        });

        const rootResponse = await taskExecution.do(rootTaskRequest);

        // Verify root response indicates subtasks were spawned
        expect(rootResponse.stopReason).to.equal("subtasks");
        expect(rootResponse.subtasks).to.have.length(1);

        // Verify subtasks were published to message bus
        expect(mockExecContext.config.messageBus.publishedTasks).to.have.length(2);

        // Verify subtasks have correct structure
        const publishedTask1 = mockExecContext.config.messageBus.publishedTasks[0];
        const publishedTask2 = mockExecContext.config.messageBus.publishedTasks[1];

        expect(publishedTask1.taskId).to.equal("child-task-1");
        expect(publishedTask1.correlationId).to.equal(rootTaskRequest.correlationId);
        expect(publishedTask1.parentTask?.taskInstanceId).to.equal(rootTaskRequest.taskInstanceId);
        expect(publishedTask1.taskGroupId).to.equal("group-1");

        expect(publishedTask2.taskId).to.equal("child-task-2");
        expect(publishedTask2.correlationId).to.equal(rootTaskRequest.correlationId);
        expect(publishedTask2.parentTask?.taskInstanceId).to.equal(rootTaskRequest.taskInstanceId);
        expect(publishedTask2.taskGroupId).to.equal("group-1");

        // Step 2: Execute first child task
        mockAgentCallFactory.setAgentResponse("child-task-1", new AgentTaskResponse({
            correlationId: "test-correlation",
            stopReason: "completed",
            taskOutput: { childResult: "result1" }
        }));

        const child1Response = await taskExecution.do(publishedTask1);
        expect(child1Response.stopReason).to.equal("completed");

        // Verify first child is marked completed but parent not resumed yet
        const child1Task = mockAgentStatusTracker.getAllTasks().find(t => t.taskId === "child-task-1");
        expect(child1Task?.status).to.equal("completed");

        // Parent should not be resumed yet (group not complete)
        expect(mockExecContext.config.messageBus.publishedTasks).to.have.length(2);

        // Step 3: Execute second child task
        mockAgentCallFactory.setAgentResponse("child-task-2", new AgentTaskResponse({
            correlationId: "test-correlation",
            stopReason: "completed",
            taskOutput: { childResult: "result2" }
        }));

        const child2Response = await taskExecution.do(publishedTask2);
        expect(child2Response.stopReason).to.equal("completed");

        // Verify second child is marked completed
        const child2Task = mockAgentStatusTracker.getAllTasks().find(t => t.taskId === "child-task-2");
        expect(child2Task?.status).to.equal("completed");

        // Now parent should be resumed (published as new task)
        expect(mockExecContext.config.messageBus.publishedTasks).to.have.length(3);
        const resumeTask = mockExecContext.config.messageBus.publishedTasks[2];
        expect(resumeTask.command.command).to.equal("resume");
        expect(resumeTask.command.completedTaskGroupId).to.equal("group-1");
        expect(resumeTask.taskId).to.equal("orchestrator-task");

        // Step 4: Configure parent agent to complete on resume
        mockAgentCallFactory.setAgentResponse("orchestrator-task", new AgentTaskResponse({
            correlationId: "test-correlation",
            stopReason: "completed",
            taskOutput: { finalResult: "all done" }
        }));

        // Execute the resume task
        const resumeResponse = await taskExecution.do(resumeTask);
        expect(resumeResponse.stopReason).to.equal("completed");
        expect(resumeResponse.taskOutput).to.deep.equal({ finalResult: "all done" });

        // Verify the original root task instance status
        const parentTask = mockAgentStatusTracker.getAllTasks().find(
            t => t.taskId === "orchestrator-task" && t.taskInstanceId === rootTaskRequest.taskInstanceId
        );
        // The original root instance should be completed after the branch is marked completed
        expect(parentTask?.status).to.equal("completed");

        // Verify the flow
        // Get the actual branchId from the published tasks
        const actualBranchId = publishedTask1.branchId!;

        const expectedFlow = new AgenticFlow(rootTaskRequest.correlationId!, new AgentNode({
            taskId: "orchestrator-task",
            taskInstanceId: rootTaskRequest.taskInstanceId!,
            next: new BranchNode({
                branches: [{
                    branchId: actualBranchId,
                    branch: new GroupNode({
                        groupId: "group-1",
                        agents: [
                            new AgentNode({ taskId: "child-task-1", taskInstanceId: publishedTask1.taskInstanceId! }),
                            new AgentNode({ taskId: "child-task-2", taskInstanceId: publishedTask2.taskInstanceId! })
                        ]
                    })
                }]
            })
        }));

        const actualFlow = await agenticFlowTracker.getFlow(rootTaskRequest.correlationId!);

        expect(removePrev(actualFlow!)).to.deep.equal(removePrev(expectedFlow));
    });

});
