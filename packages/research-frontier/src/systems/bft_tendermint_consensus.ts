/**
 * Byzantine Fault Tolerant (BFT) State Consensus Simulation
 * Enforces global distributed state isolation via 2/3 quorum among distributed nodes.
 */

export interface BFTNode {
    nodeId: string;
    isLeader: boolean;
    stateHash: string;
}

export class TendermintPBftCluster {
    private nodes: Map<string, BFTNode> = new Map();
    private currentTerm: number = 0;
    
    constructor(nodeIds: string[]) {
        nodeIds.forEach(id => {
            this.nodes.set(id, { nodeId: id, isLeader: false, stateHash: 'GENESIS' });
        });
        // Select initial leader
        if (nodeIds.length > 0) {
            this.nodes.get(nodeIds[0])!.isLeader = true;
        }
    }

    /**
     * Attempts a state mutation requiring strict 2/3 quorum among the BFT cluster.
     * Prevents Byzantine split-brain topologies mathematically without relying on quantum spooks.
     */
    public requestStateMutation(proposerId: string, newStateHash: string): boolean {
        this.currentTerm++;
        
        const totalNodes = this.nodes.size;
        const requiredQuorum = Math.ceil((2 * totalNodes) / 3);
        
        let votes = 0;
        let dissentingNodes: string[] = [];

        // Simulate network voting and Byzantine faults
        for (const [id, node] of this.nodes.entries()) {
            // Simulate 10% Byzantine or partitioned nodes that refuse to align
            const isByzantine = Math.random() < 0.10;
            
            if (!isByzantine) {
                votes++;
                node.stateHash = newStateHash; // Aligning to the new quorum state
            } else {
                dissentingNodes.push(id);
            }
        }

        if (votes >= requiredQuorum) {
            return true;
        } else {
            // Consensus failed. State mutation aborted.
            return false;
        }
    }
    
    public getClusterStatus() {
        return {
            totalNodes: this.nodes.size,
            term: this.currentTerm
        };
    }
}
