import { AgentTaskRequest } from "../../model/AgentTask";
import { v4 as uuidv4 } from "uuid";

export async function startRootAgent(task: AgentTaskRequest, agent: any, execContext: any, bearerToken: string): Promise<AgentTaskResponse> {

    // Assign task instance id and correlation id
    task.taskInstanceId = uuidv4();
    task.correlationId = uuidv4();

    // Trigger the agent (orchestrator, most likely)
    const agentTaskResponse: AgentTaskResponse = await new AgentCall(agent, this.execContext, this.bearerToken).execute(task, task.correlationId);


}