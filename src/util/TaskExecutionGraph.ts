import { ValidationError } from "toto-api-controller";
import { TaskStatusRecord } from "../core/tracking/TaskTracker";

/**
 * This class provides methods to build an in-memory representation of a task execution graph
 * from a set of TaskStatusRecords.
 */
export class TaskExecutionGraph {

    rootNode: TaskExecutionGraphNode;

    constructor(rootNode: TaskExecutionGraphNode) {
        this.rootNode = rootNode;
    }

    static buildGraphFromRecords(records: TaskStatusRecord[]): TaskExecutionGraph | null {

        if (records.length === 0) return null;

        // Find the root record (the one without a parentTaskId)
        const rootRecords = records.filter(r => !r.parentTaskInstanceId && !r.resumedAfterSubtasksGroupId);

        // If there are multiple root records, throw an error
        if (rootRecords.length > 1) throw new ValidationError(400, "Multiple root records found.");
        if (rootRecords.length === 0) throw new ValidationError(400, "No root record found.");

        const rootRecord = rootRecords[0];

        const rootNode = { record: rootRecord, next: buildNext(rootRecord, records) };

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
function buildNext(currentNode: TaskStatusRecord, records: TaskStatusRecord[]): SubtaskGroupNode[] | TaskExecutionGraphNode | null {

    const childRecords = records.filter(r => r.parentTaskInstanceId === currentNode.taskInstanceId);

    if (childRecords && childRecords.length > 0) {

        // Check if there are multiple subtask groups
        const subtaskGroups = Array.from(new Set(childRecords.map(r => r.subtaskGroupId).filter(gid => gid !== undefined)));

        const groups: SubtaskGroupNode[] = [];

        // Create a group for each subtask group
        for (const groupId of subtaskGroups) {

            // Create the group 
            const group: SubtaskGroupNode = {
                groupId: groupId!,
                nodes: childRecords.filter(r => r.subtaskGroupId === groupId).map((record) => {
                    const childNode: TaskExecutionGraphNode = {
                        record: record,
                        next: buildNext(record, records)
                    };
                    return childNode;
                }),
                next: buildNextFromGroup(groupId!, records)
            }

            groups.push(group);
        }

        return groups;
    }

    // There are no children
    return null;
}

function buildNextFromGroup(groupId: string, records: TaskStatusRecord[]): SubtaskGroupNode[] | TaskExecutionGraphNode | null {

    const resumedRecord = records.find(r => r.resumedAfterSubtasksGroupId === groupId);

    if (!resumedRecord) return null;

    return {
        record: resumedRecord,
        next: buildNext(resumedRecord, records)
    }
}

export interface TaskExecutionGraphNode {

    record: TaskStatusRecord
    next: SubtaskGroupNode[] | TaskExecutionGraphNode | null

}

export interface SubtaskGroupNode {
    groupId: string;
    nodes: TaskExecutionGraphNode[];
    next: SubtaskGroupNode[] | TaskExecutionGraphNode | null;
}