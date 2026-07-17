import { createHash } from 'crypto';

/**
 * The Cryptographic Kripke Standard (Canonical Marshal)
 * 
 * Enforces absolute byte-level deterministic serialization of a multi-variable node state.
 * This ensures that mathematically identical constraints hash to the exact same SHA-256 
 * signature, regardless of object insertion order, OS-level floating-point representations, 
 * or JSON engine specifics. It serves as the bedrock for O(1) stateless refutability.
 */
export function canonicalizeKripkeState(nodeState: any): Buffer {
    if (nodeState === null) {
        return Buffer.from('null', 'utf8');
    }

    if (typeof nodeState === 'number') {
        // Enforce strict determinism to prevent OS floating-point drift.
        if (Number.isInteger(nodeState)) {
            return Buffer.from(nodeState.toString(), 'utf8');
        } else {
            // Strip hardware-specific floating noise by strictly bounding to precision 14
            return Buffer.from(parseFloat(nodeState.toPrecision(14)).toString(), 'utf8');
        }
    }

    if (typeof nodeState === 'boolean' || typeof nodeState === 'string') {
        return Buffer.from(JSON.stringify(nodeState), 'utf8');
    }

    if (Array.isArray(nodeState)) {
        const buffers = nodeState.map(canonicalizeKripkeState);
        const joined: Buffer[] = [Buffer.from('[', 'utf8')];
        for (let i = 0; i < buffers.length; i++) {
            joined.push(buffers[i]);
            if (i < buffers.length - 1) {
                joined.push(Buffer.from(',', 'utf8'));
            }
        }
        joined.push(Buffer.from(']', 'utf8'));
        return Buffer.concat(joined);
    }

    if (typeof nodeState === 'object') {
        const keys = Object.keys(nodeState).sort(); // Exact alphabetical byte-sort
        
        const buffers: Buffer[] = [];
        buffers.push(Buffer.from('{', 'utf8'));
        
        let first = true;
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            const v = nodeState[k];
            
            if (v === undefined) continue; // Epistemically strip undefined bounds

            if (!first) {
                buffers.push(Buffer.from(',', 'utf8'));
            }
            
            buffers.push(Buffer.from(JSON.stringify(k), 'utf8'));
            buffers.push(Buffer.from(':', 'utf8'));
            buffers.push(canonicalizeKripkeState(v));
            first = false;
        }
        
        buffers.push(Buffer.from('}', 'utf8'));
        return Buffer.concat(buffers);
    }

    return Buffer.from('null', 'utf8');
}

export function generateKripkeSignature(nodeState: any): { hashHex: string, canonicalBytes: number } {
    const canonicalBuffer = canonicalizeKripkeState(nodeState);
    const hash = createHash('sha256').update(canonicalBuffer).digest('hex');
    
    return {
        hashHex: hash,
        canonicalBytes: canonicalBuffer.length
    };
}
