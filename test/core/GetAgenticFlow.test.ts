import { expect } from "chai";
import { GetAgenticFlow } from "../../src/dlg/tracking/GetAgenticFlow";
import { MockDb, MockExecContext } from "./tracking/Mocks";

describe("GetAgenticFlow", () => {

    let mockDb: MockDb;
    let mockExecContext: MockExecContext;
    let mockConfig: any;
    let delegate: GetAgenticFlow;

    beforeEach(() => {
        mockDb = new MockDb();
        mockExecContext = new MockExecContext();
        delegate = new GetAgenticFlow();

        // Setup mock config with getMongoClient
        const originalConfig = mockExecContext.config;
        mockConfig = {
            messageBus: originalConfig.messageBus,
            getCollections: () => originalConfig.getCollections(),
            getMongoClient: async () => ({
                db: () => mockDb
            }),
            getDBName: () => "test-db"
        };

        mockExecContext.config = mockConfig;
    });

    afterEach(() => {
        // Clean up
    });

    it("should retrieve an agentic flow by correlation ID", async () => {
        // Setup: Create a flow in the mock collection
        const correlationId = "test-correlation-id";
        const flowData = {
            correlationId,
            root: {
                type: "agent",
                taskId: "test-task",
                taskInstanceId: "test-instance-id",
                name: "Test Agent",
                next: null
            }
        };

        // Insert the flow into the mock collection
        const flowsCollection = mockDb.collection("flows")!;
        await flowsCollection.insertOne(flowData);

        // Create mock request
        const mockRequest = {
            params: { correlationId }
        } as any;

        // Execute the delegate
        const response = await delegate.do(mockRequest, {} as any, mockExecContext as any);

        // Verify the response
        expect(response.flow).to.exist;
        expect(response.flow.correlationId).to.equal(correlationId);
        expect(response.flow.root.taskId).to.equal("test-task");
        expect(response.flow.root.taskInstanceId).to.equal("test-instance-id");
    });

    it("should return null when flow is not found", async () => {
        // Create mock request with non-existent correlation ID
        const mockRequest = {
            params: { correlationId: "non-existent-correlation-id" }
        } as any;

        // Execute the delegate
        const response = await delegate.do(mockRequest, {} as any, mockExecContext as any);

        // Verify the response (mock returns undefined when not found)
        expect(response.flow).to.be.undefined;
    });

    it("should not include prev properties in the response", async () => {
        // Setup: Create a flow with complex structure
        const correlationId = "complex-flow-id";
        const flowData = {
            correlationId,
            root: {
                type: "agent",
                taskId: "root-task",
                taskInstanceId: "root-instance",
                name: "Root Agent",
                next: {
                    type: "group",
                    groupId: "group-1",
                    agents: [
                        { type: "agent", taskId: "child-task-1", taskInstanceId: "child-instance-1", next: null },
                        { type: "agent", taskId: "child-task-2", taskInstanceId: "child-instance-2", next: null }
                    ],
                    next: null
                }
            }
        };

        // Insert the flow into the mock collection
        const flowsCollection = mockDb.collection("flows")!;
        await flowsCollection.insertOne(flowData);

        // Create mock request
        const mockRequest = {
            params: { correlationId }
        } as any;

        // Execute the delegate
        const response = await delegate.do(mockRequest, {} as any, mockExecContext as any);

        // Verify the response
        expect(response.flow).to.exist;
        expect(response.flow.correlationId).to.equal(correlationId);

        // Check that prev is not present (since it's not stored in DB)
        expect(response.flow.root.prev).to.be.undefined;
        expect(response.flow.root.next.prev).to.be.undefined;

        // Verify structure is intact
        expect(response.flow.root.next.agents).to.have.length(2);
    });
});
