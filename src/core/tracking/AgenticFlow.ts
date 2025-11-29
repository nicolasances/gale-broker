import { TotoRuntimeError } from "toto-api-controller";
import { AgentTaskRequest } from "../../model/AgentTask";

export class AgenticFlow {

    // Root node of the flow
    root: AbstractNode;
    correlationId: string;

    constructor(correlationId: string, root: AbstractNode) {
        this.root = root;
        this.correlationId = correlationId;
    }

    /**
     * Parses an Agentic Flow from its BSON representation.
     * 
     * @param bson 
     * @returns 
     */
    static fromBSON(bson: any): AgenticFlow {

        const cid = bson.correlationId;
        const root = AgenticFlow.parseNodeFromBSON(bson.root, null);

        return new AgenticFlow(cid, root);
    }

    /**
     * Parses a node from its BSON representation.
     * 
     * IMPORTANT: reconstructs the prev links as well.
     * 
     * @param bson 
     * @returns 
     */
    static parseNodeFromBSON(bson: any, prev: AbstractNode | null): AbstractNode {

        if (bson.type === "agent") {
            
            const node = new AgentNode({
                taskId: bson.taskId,
                taskInstanceId: bson.taskInstanceId,
                name: bson.name || undefined,
            });

            node.setNext(bson.next ? AgenticFlow.parseNodeFromBSON(bson.next, node) : null);

            return node;

        } else if (bson.type === "group") {
            
            const node =  new GroupNode({
                agents: bson.agents.map((agentBson: any) => AgenticFlow.parseNodeFromBSON(agentBson, null) as AgentNode),
                name: bson.name || undefined,
            });

            node.agents.forEach(agent => agent.setPrev(node));
            node.setNext(bson.next ? AgenticFlow.parseNodeFromBSON(bson.next, node) : null);
            
            return node;

        } else if (bson.type === "branch") {
            
            const node = new BranchNode({
                branches: bson.branches.map((branchBson: any) => ({
                    branchId: branchBson.branchId,
                    branch: AgenticFlow.parseNodeFromBSON(branchBson.branch, null)
                })),
                name: bson.name || undefined,
            });

            node.branches.forEach(branch => branch.branch.setPrev(node));
            node.setNext(bson.next ? AgenticFlow.parseNodeFromBSON(bson.next, node) : null);

            return node;

        } else {
            throw new TotoRuntimeError(500, `[Agentic Flow]: Unknown node type ${bson.type} in BSON.`);
        }
    }

    /**
     * Serializes the Agentic Flow to BSON for storage in MongoDB.
     * 
     * IMPORTANT: 
     * Makes sure that the prev of the nodes are not included to avoid circular references.
     */
    toBSON(): any {

        return {
            correlationId: this.correlationId,
            root: this.root.toBSON()
        }
    }

    /**
     * Finds the task node by its taskInstanceId and creates branches as its next node.
     * 
     * @param taskInstanceId the parent task that has requested the branch creation
     * @param branches the different branches
     */
    branch(taskInstanceId: string, branches: { branchId: string, tasks: AgentTaskRequest[] }[]): void {

        const parentNode = this.root.findAgentNode(taskInstanceId) as AgentNode;

        if (!parentNode) throw new TotoRuntimeError(500, `[Agentic Flow]: Could not find parent node with taskInstanceId ${taskInstanceId} to create branches.`);

        parentNode.setNext(new BranchNode({
            branches: branches.map(branch => {

                if (branch.tasks.length === 1) return { branchId: branch.branchId, branch: new AgentNode({ taskId: branch.tasks[0].taskId, taskInstanceId: branch.tasks[0].taskInstanceId! }) };

                return {
                    branchId: branch.branchId, branch: new GroupNode({
                        agents: branch.tasks.map(task => new AgentNode({ taskId: task.taskId, taskInstanceId: task.taskInstanceId! })),
                        name: branch.tasks[0].taskGroupId
                    })
                };
            }),
        }));
    }

    siblingBranches(branchId: string): string[] {

        // 1. Find the branch node
        const branchNode = this.root.findBranchNode(branchId) as BranchNode;

        if (!branchNode) throw new TotoRuntimeError(500, `[Agentic Flow]: Could not find branch node with branchId ${branchId} to get sibling branches.`);

        return branchNode.branches.map(branch => branch.branchId).filter(id => id !== branchId);
    }

    /**
     * Finds the direct parent branch of the given branch, if any.
     * @param branchId 
     */
    parentBranchId(branchId: string): string | null {

        const branchNode = this.root.findBranchNode(branchId) as BranchNode;

        if (!branchNode) throw new TotoRuntimeError(500, `[Agentic Flow]: Could not find branch node with branchId ${branchId} to get parent branch.`);

        let prev = branchNode.getPrev();
        let parentBranchNode: BranchNode | null = null;
        while (prev) {
            if (prev.getType() === "branch") parentBranchNode = prev as BranchNode;
            prev = prev.getPrev();
        }

        if (parentBranchNode) {
            // Find the branchId of the parent branch that contains the current branch
            for (const branch of parentBranchNode.branches) {
                const found = branch.branch.findBranchNode(branchId);
                if (found) return branch.branchId;
            }
        }

        return null;

    }
}

/**
 * There are three types of nodes: 
 * - Agent Node: represents a single agent 
 * - Group Node: represents a group of agents to be executed in parallel. The flow is interrupted until all agents in the group have completed.
 * - Branch Node: represents a set of parallel paths in the flow. All branches are executed in parallel, and the flow continues until all branches have completed.
 */
export abstract class AbstractNode {
    protected type: "agent" | "group" | "branch" = "agent";
    protected name: string | null = null;
    protected next: AbstractNode | null = null;
    protected prev: AbstractNode | null = null;

    /**
     * Finds an Agent Node with the given taskInstanceId in the flow structure.
     * @param taskInstanceId the task instance id of the agent to be found
     */
    abstract findAgentNode(taskInstanceId: string): AgentNode | null;

    abstract findBranchNode(branchId: string): BranchNode | null;

    /**
     * Serializes the node to BSON for storage in MongoDB.
     * 
     * IMPORTANT: 
     * Makes sure that the prev of the nodes are not included to avoid circular references.
     */
    abstract toBSON(): any; 

    setNext(node: AbstractNode | null): void {
        this.next = node;
        if (node) node.prev = this;
    }

    setPrev(node: AbstractNode | null): void {
        this.prev = node;
    }
    getPrev(): AbstractNode | null {
        return this.prev;
    }
    getType(): "agent" | "group" | "branch" {
        return this.type;
    }
}

export class AgentNode extends AbstractNode {

    taskId: string;
    taskInstanceId: string;

    constructor({ taskId, taskInstanceId, name, next }: { taskId: string, taskInstanceId: string, name?: string, next?: AbstractNode }) {
        super();

        this.taskId = taskId;
        this.taskInstanceId = taskInstanceId;
        this.type = "agent";
        if (name) this.name = name;
        if (next) this.next = next;
    }

    findAgentNode(taskInstanceId: string): AgentNode | null {
        if (this.taskInstanceId === taskInstanceId) return this;
        if (this.next) return this.next.findAgentNode(taskInstanceId);
        return null;
    }

    findBranchNode(branchId: string): BranchNode | null {
        if (this.next) return this.next.findBranchNode(branchId);
        return null;
    }

    toBSON() {
        return {
            taskId: this.taskId,
            taskInstanceId: this.taskInstanceId,
            type: this.type,
            name: this.name,
            next: this.next ? this.next.toBSON() : null
        }
    }
}

export class GroupNode extends AbstractNode {
    agents: AgentNode[];

    constructor({ agents, name, next }: { agents: AgentNode[], name?: string, next?: AbstractNode }) {
        super();

        this.type = "group";
        this.agents = agents;
        if (name) this.name = name;
        if (next) this.next = next;
    }

    findAgentNode(taskInstanceId: string): AgentNode | null {
        for (const agent of this.agents) {
            const found = agent.findAgentNode(taskInstanceId);
            if (found) return found;
        }
        if (this.next) return this.next.findAgentNode(taskInstanceId);
        return null;
    }

    findBranchNode(branchId: string): BranchNode | null {
        if (this.next) return this.next.findBranchNode(branchId);
        return null;
    }

    toBSON() {
        return {
            agents: this.agents.map(agent => agent.toBSON()),
            type: this.type,
            name: this.name,
            next: this.next ? this.next.toBSON() : null
        }
    }

}

export class BranchNode extends AbstractNode {
    branches: {
        branchId: string,
        branch: AbstractNode
    }[];

    constructor({ branches, name, next }: { branches: { branchId: string, branch: AbstractNode }[], name?: string, next?: AbstractNode }) {
        super();

        this.type = "branch";
        this.branches = branches;
        if (name) this.name = name;
        if (next) this.next = next;
    }

    findAgentNode(taskInstanceId: string): AgentNode | null {
        for (const branch of this.branches) {
            const found = branch.branch.findAgentNode(taskInstanceId);
            if (found) return found;
        }
        if (this.next) return this.next.findAgentNode(taskInstanceId);
        return null;
    }

    findBranchNode(branchId: string): BranchNode | null {
        for (const branch of this.branches) {
            if (branch.branchId === branchId) return this;
            const found = branch.branch.findBranchNode(branchId);
            if (found) return found;
        }
        if (this.next) return this.next.findBranchNode(branchId);
        return null;
    }

    toBSON() {
        return {
            branches: this.branches.map(branch => ({
                branchId: branch.branchId,
                branch: branch.branch.toBSON()
            })),
            type: this.type,
            name: this.name,
            next: this.next ? this.next.toBSON() : null
        }
    }
}
