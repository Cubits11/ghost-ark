import { createHash } from 'crypto';

/**
 * Canonical state marshal.
 *
 * Deterministic byte serialization of a node state: object keys are sorted,
 * non-integer numbers are bounded to 14 significant digits, and `undefined`
 * object members are stripped. Two structurally identical states therefore
 * serialize to identical bytes regardless of insertion order or host
 * float formatting, so their SHA-256 digests match.
 *
 * NOTE: `canonicalStateDigest` returns an UNSIGNED content digest, not a
 * signature and not a KMS/HMAC anchor. It witnesses "these exact bytes were
 * hashed"; it proves nothing about signing authority. Binding a digest to a
 * signing key is a separate step (see packages/enforcement-runtime signer).
 * This is not claimed to be RFC 8785 / JCS canonicalization.
 */
export function canonicalizeState(nodeState: any): Buffer {
    if (nodeState === null) {
        return Buffer.from('null', 'utf8');
    }

    if (typeof nodeState === 'number') {
        // Bound non-integer formatting so host float representation cannot drift the digest.
        if (Number.isInteger(nodeState)) {
            return Buffer.from(nodeState.toString(), 'utf8');
        } else {
            return Buffer.from(parseFloat(nodeState.toPrecision(14)).toString(), 'utf8');
        }
    }

    if (typeof nodeState === 'boolean' || typeof nodeState === 'string') {
        return Buffer.from(JSON.stringify(nodeState), 'utf8');
    }

    if (Array.isArray(nodeState)) {
        const buffers = nodeState.map(canonicalizeState);
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
        const keys = Object.keys(nodeState).sort(); // alphabetical byte order

        const buffers: Buffer[] = [];
        buffers.push(Buffer.from('{', 'utf8'));

        let first = true;
        for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            const v = nodeState[k];

            if (v === undefined) continue; // strip undefined members

            if (!first) {
                buffers.push(Buffer.from(',', 'utf8'));
            }

            buffers.push(Buffer.from(JSON.stringify(k), 'utf8'));
            buffers.push(Buffer.from(':', 'utf8'));
            buffers.push(canonicalizeState(v));
            first = false;
        }

        buffers.push(Buffer.from('}', 'utf8'));
        return Buffer.concat(buffers);
    }

    return Buffer.from('null', 'utf8');
}

/**
 * SHA-256 content digest over the canonical serialization of `nodeState`.
 * Unsigned; see the file header on what this does and does not prove.
 */
export function canonicalStateDigest(nodeState: any): { hashHex: string, canonicalBytes: number } {
    const canonicalBuffer = canonicalizeState(nodeState);
    const hash = createHash('sha256').update(canonicalBuffer).digest('hex');

    return {
        hashHex: hash,
        canonicalBytes: canonicalBuffer.length
    };
}
