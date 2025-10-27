import { TotoAPIController } from "toto-api-controller";
import { ControllerConfig } from "./Config";
import { RegisterAgent } from "./dlg/catalog/PostAgent";
import { PostTask } from "./dlg/PostTask";
import { UpdateAgent } from "./dlg/catalog/PutAgent";

const api = new TotoAPIController("gale-broker", new ControllerConfig(), { basePath: '/galebroker', port: 8081 });

// Endpoints related to Agent Catalog
api.path('POST', '/catalog/agents', new RegisterAgent(), { contentType: 'application/json', noAuth: true, ignoreBasePath: false }); // Temporary, until API-key based auth is implemented.
api.path('PUT', '/catalog/agents', new UpdateAgent(), { contentType: 'application/json', noAuth: true, ignoreBasePath: false });    // Temporary, until API-key based auth is implemented.

// Endpoints related to Agent Executions
api.path('POST', '/tasks', new PostTask());


api.init().then(() => {
    api.listen();
});