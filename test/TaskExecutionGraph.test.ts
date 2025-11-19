import { expect } from "chai";
import { TaskExecutionGraph, SubtaskGroupNode, TaskExecutionGraphNode } from "../src/util/TaskExecutionGraph";
import { TaskStatusRecord } from "../src/core/tracking/TaskTracker";

describe("TaskExecutionGraph", () => {

    it("should build a graph with a single root task", () => {
        // Create a simple task record
        const rootTask: TaskStatusRecord = { correlationId: "1", taskId: "root", taskInstanceId: "1", startedAt: new Date(), status: "completed", taskInput: "a" };

        // Build the graph
        const graph = TaskExecutionGraph.buildGraphFromRecords([rootTask]);

        // Verify the graph structure
        expect(graph).to.not.be.null;
        expect(graph?.rootNode).to.not.be.undefined;
        expect(graph?.rootNode.record).to.deep.equal(rootTask);
        expect(graph?.rootNode.next).to.be.null;
    });

    it("should build a graph with root and 2 children", () => {

        const t1: TaskStatusRecord = { correlationId: "1", taskId: "root", taskInstanceId: "1", startedAt: new Date(), status: "completed", taskInput: "a" };
        const t2: TaskStatusRecord = { correlationId: "1", taskId: "a", taskInstanceId: "2", parentTaskInstanceId: "1", subtaskGroupId: "g1", startedAt: new Date(), status: "completed", taskInput: "a" };
        const t3: TaskStatusRecord = { correlationId: "1", taskId: "a", taskInstanceId: "3", parentTaskInstanceId: "1", subtaskGroupId: "g1", startedAt: new Date(), status: "completed", taskInput: "a" };

        // Build the graph
        const graph = TaskExecutionGraph.buildGraphFromRecords([t1, t2, t3]);

        // Verify the graph structure
        expect(graph?.rootNode.record).to.deep.equal(t1);
        expect(graph?.rootNode.next).to.not.be.null;
        expect((graph?.rootNode.next as SubtaskGroupNode).groupId).to.equal("g1");
        expect((graph?.rootNode.next as SubtaskGroupNode).nodes.map(c => c.record)).to.deep.include.members([t2, t3]);
    });

    it("should build a graph with root and 2 children that resume (consolidate into) the root", () => {

        const t1: TaskStatusRecord = { correlationId: "1", taskId: "root", taskInstanceId: "1", startedAt: new Date(), status: "completed", taskInput: "a" };
        const t2: TaskStatusRecord = { correlationId: "1", taskId: "a", taskInstanceId: "2", parentTaskInstanceId: "1", startedAt: new Date(), status: "completed", taskInput: "a", subtaskGroupId: "g1" };
        const t3: TaskStatusRecord = { correlationId: "1", taskId: "a", taskInstanceId: "3", parentTaskInstanceId: "1", startedAt: new Date(), status: "completed", taskInput: "a", subtaskGroupId: "g1" };
        const t2resumed: TaskStatusRecord = { correlationId: "1", taskId: "root", taskInstanceId: "4", resumedAfterSubtasksGroupId: "g1", startedAt: new Date(), status: "completed", taskInput: "a" };

        // Build the graph
        const graph = TaskExecutionGraph.buildGraphFromRecords([t1, t2, t3, t2resumed]);

        // Verify the graph structure
        expect(graph?.rootNode.record).to.deep.equal(t1);
        expect((graph?.rootNode.next as SubtaskGroupNode).groupId).to.equal("g1");
        expect((graph?.rootNode.next as SubtaskGroupNode).nodes.map(c => c.record)).to.deep.include.members([t2, t3]);
        expect(((graph?.rootNode.next as SubtaskGroupNode).next as TaskExecutionGraphNode).record).to.deep.equal(t2resumed);
    });

});
