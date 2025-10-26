import { TotoAPIController } from "toto-api-controller";
import { ControllerConfig } from "./Config";

const api = new TotoAPIController("gale-broker", new ControllerConfig(), { basePath: '/galebroker' });

// api.path('POST', '/something', new PostSomething())

api.init().then(() => {
    api.listen()
});