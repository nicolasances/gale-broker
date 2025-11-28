
export class AgenticFlow {

    // Root node of the flow
    root: AbstractNode;

    constructor(root: AbstractNode) {
        this.root = root;
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
    protected next: AbstractNode | null = null;
    protected name: string | null = null;
}

export class AgentNode extends AbstractNode {
    taskId: string; 

    constructor({taskId, name, next}: {taskId: string, name?: string, next?: AbstractNode}) {
        super(); 

        this.taskId = taskId;
        this.type = "agent";
        if (name) this.name = name;
        if (next) this.next = next;
    }
}

export class GroupNode extends AbstractNode {
    agents: AgentNode[];

    constructor({agents, name, next}: {agents: AgentNode[], name?: string, next?: AbstractNode}) {
        super();

        this.type = "group";
        this.agents = agents;
        if (name) this.name = name;
        if (next) this.next = next;
    }
}

export class BranchNode extends AbstractNode {
    branches: AbstractNode[]; 

    constructor({branches, name, next}: {branches: AbstractNode[], name?: string, next?: AbstractNode}) {
        super();

        this.type = "branch";
        this.branches = branches;
        if (name) this.name = name;
        if (next) this.next = next;
    }
}
