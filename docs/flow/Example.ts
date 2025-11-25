

function example() {

    const computationTree = {
        branch: {
            name: "B1",
            nodes: [
                {
                    name: "group-section-classification",
                    parallelize: [{agent: {}, next: null}, {agent: {}, next: null}, {agent: {}, next: null}], 
                    next: {
                        branch: {
                            name: "B1.1",
                            nodes: [
                                {
                                    name: "group-section-genealogy",
                                    parallelize: [{agent: {}, next: null}, {agent: {}, next: null}, {agent: {}, next: null}], 
                                    next: null
                                }, 
                                {
                                    name: "group-section-personalities",
                                    parallelize: [{agent: {}, next: null}, {agent: {}, next: null}, {agent: {}, next: null}],
                                    next: { 
                                        agent: {}, 
                                        next: null 
                                    }
                                }
                            ], 
                            next: null
                        }
                    }
                }, 
                {
                    name: "group-section-timeline",
                    parallelize: [{agent: {}, next: null}, {agent: {}, next: null}, {agent: {}, next: null}], 
                    next: null
                }
            ],
            next: {}
        }
    }

    return computationTree;

}

function buildingComputationTree() {

    const start = (): any => {};
    const parallelize = (name: string, agents: any[]): any => {};
    const agent = () => {};
    const end = () => {};
    const branch = (name: string, nodes: any[]) => {};
    const next = () => {};

    start().branch("B1", [
        parallelize("group-section-classification", [
            agent(), agent(), agent()
        ]).next().branch("B1.1", [
            parallelize("group-section-genealogy", [
                agent(), agent(), agent()
            ]),
            parallelize("group-section-personalities", [
                agent(), agent(), agent()
            ]).next().agent()
        ]), 
        parallelize("group-section-timeline", [
            agent(), agent(), agent()
        ])
    ]).end()

}