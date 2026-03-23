import { expect } from "chai";
import { AgentDefinition } from "../../src/model/AgentDefinition";

describe("AgentDefinition.fromJSON", () => {

    const baseEndpoint = { baseURL: "https://example.com" };

    it("should throw a validation error when a conversational agent has no agentId", () => {
        expect(() => AgentDefinition.fromJSON({
            agentType: "conversational",
            name: "My Agent",
            endpoint: baseEndpoint,
        })).to.throw(/agentId is required/);
    });

    it("should throw a validation error when a conversational agent has an empty agentId", () => {
        expect(() => AgentDefinition.fromJSON({
            agentType: "conversational",
            agentId: "",
            name: "My Agent",
            endpoint: baseEndpoint,
        })).to.throw(/agentId is required/);
    });

    it("should throw a validation error when a conversational agent has a whitespace-only agentId", () => {
        expect(() => AgentDefinition.fromJSON({
            agentType: "conversational",
            agentId: "   ",
            name: "My Agent",
            endpoint: baseEndpoint,
        })).to.throw(/agentId is required/);
    });

    it("should succeed when a conversational agent has a valid agentId", () => {
        const def = AgentDefinition.fromJSON({
            agentType: "conversational",
            agentId: "my-agent",
            name: "My Agent",
            endpoint: baseEndpoint,
        });
        expect(def.agentId).to.equal("my-agent");
        expect(def.agentType).to.equal("conversational");
    });

    it("should throw a validation error when a taskExecutor agent has no taskId", () => {
        expect(() => AgentDefinition.fromJSON({
            agentType: "taskExecutor",
            name: "My Agent",
            endpoint: baseEndpoint,
            inputSchema: {},
            outputSchema: {},
        })).to.throw(/taskId is required/);
    });

    it("should succeed when a taskExecutor agent has all required fields", () => {
        const def = AgentDefinition.fromJSON({
            agentType: "taskExecutor",
            taskId: "my-task",
            name: "My Agent",
            endpoint: baseEndpoint,
            inputSchema: {},
            outputSchema: {},
        });
        expect(def.taskId).to.equal("my-task");
        expect(def.agentType).to.equal("taskExecutor");
    });

});
