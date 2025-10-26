import { TotoAPIController } from "toto-api-controller";
import { ControllerConfig } from "./Config";
import { RegisterAgent } from "./dlg/catalog/PostAgent";
import { PostTask } from "./dlg/PostTask";
import { UpdateAgent } from "./dlg/catalog/PutAgent";

const api = new TotoAPIController("gale-broker", new ControllerConfig(), { basePath: '/galebroker' });

// Endpoints related to Agent Catalog
api.path('POST', '/catalog/agents', new RegisterAgent());
api.path('PUT', '/catalog/agents', new UpdateAgent());

// Endpoints related to Agent Executions
api.path('POST', '/tasks', new PostTask());


api.init().then(() => {
    api.listen();
});