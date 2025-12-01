import { AgenticFlow } from "../../../../src/core/tracking/AgenticFlow";


/**
 * Utility function to remove prev and locked properties from flow for comparison
 */
export function removePrev(flow: AgenticFlow): any {
    const visited = new WeakSet();
    
    function cloneWithoutPrev(obj: any): any {
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }
        
        if (visited.has(obj)) {
            return undefined; // Skip circular references
        }
        
        visited.add(obj);
        
        if (Array.isArray(obj)) {
            return obj.map(item => cloneWithoutPrev(item));
        }
        
        const cloned: any = {};
        
        for (const key in obj) {
            if (key === 'prev' || key === 'locked') {
                continue; // Skip prev and locked properties
            }
            
            if (obj.hasOwnProperty(key)) {
                cloned[key] = cloneWithoutPrev(obj[key]);
            }
        }
        
        return cloned;
    }
    
    return cloneWithoutPrev(flow);
}
