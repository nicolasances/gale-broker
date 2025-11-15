import { ValidationError } from "toto-api-controller";
import { TaskStatusRecord } from "../core/tracking/TaskTracker";

/**
 * This class provides methods to build a 
 */
export class TaskExecutionGraph {

    rootNode: TaskExecutionGraphNode;

    constructor(rootNode: TaskExecutionGraphNode) {
        this.rootNode = rootNode;
    }

    static buildGraphFromRecords(records: TaskStatusRecord[]): TaskExecutionGraph | null {

        if (records.length === 0) return null;

        // Find the root record (the one without a parentTaskId)
        const rootRecords = records.filter(r => !r.parentTaskId);

        // If there are multiple root records, throw an error
        if (rootRecords.length > 1) throw new ValidationError(400, "Multiple root records found.");
        if (rootRecords.length === 0) throw new ValidationError(400, "No root record found.");

        const rootRecord = rootRecords[0];
        
        const rootNode = { record: rootRecord, children: buildSubtree(rootRecord, records) };

        const graph = new TaskExecutionGraph(rootNode);

        return graph;
    }
}

/**
 * Builds a subtree of the task execution graph.
 * 
 * @param currentNode the current node of the tree
 * @param records the complete set of task execution records to build the graph from 
 * @returns the list of children of the current node
 */
function buildSubtree(currentNode: TaskStatusRecord, records: TaskStatusRecord[]): TaskExecutionGraphNode[] | null {

    const childRecords = records.filter(r => r.parentTaskId === currentNode.taskId);

    if (childRecords.length === 0) return null;

    const children: TaskExecutionGraphNode[] = childRecords.map((record) => {

        const child = {
            record: record,
            children: buildSubtree(record, records)
        };

        return child;
    });

    return children;

}

interface TaskExecutionGraphNode {

    record: TaskStatusRecord
    children: TaskExecutionGraphNode[] | null

}