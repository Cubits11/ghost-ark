/**
 * Ghost-Ark DAB Tier-0
 *
 * Declarative Action Binding
 *
 * Agent Runtime Commitment Layer
 *
 * SECURITY MODEL:
 *
 * THIS MODULE IS UNTRUSTED.
 *
 * It creates a declaration commitment only.
 *
 * It does NOT prove:
 *  - semantic correctness
 *  - policy correctness
 *  - model alignment
 *
 * The trusted Gateway independently derives C_E
 * from physical execution bytes.
 *
 *
 * Pipeline:
 *
 * D_raw
 *   |
 *   v
 * Declared Action Normal Form (DANF)
 *   |
 *   v
 * Canonical Bytes
 *   |
 *   v
 * SHA-256
 *   |
 *   v
 * C_I
 *
 */


import { createHash } from "node:crypto";



/**
 * Protocol domain separation.
 *
 * Any future canonicalization change
 * MUST increment this version.
 */
export const DAB_PROTOCOL_VERSION =
    "DAB-TIER0-V1";



/**
 * Hash namespace separation.
 *
 * Prevents cross-protocol hash reuse.
 */
const HASH_DOMAIN =
    "GHOST-ARK-DAB-DECLARATION-COMMITMENT";



/**
 * Maximum safety limits.
 *
 * Prevent commitment-layer denial of service.
 */
const MAX_DEPTH = 64;

const MAX_KEYS = 10000;



/**
 * Ambiguous artifact exception.
 */
export class IntegrityCollisionError
    extends Error {

    constructor(message:string){

        super(message);

        this.name =
            "IntegrityCollisionError";
    }
}



/**
 * Canonical values accepted by DAB.
 */
type CanonicalValue =
    | null
    | boolean
    | number
    | string
    | CanonicalValue[]
    | {
        [key:string]:CanonicalValue
    };



/**
 * Keys forbidden due to prototype pollution risk.
 */
const FORBIDDEN_KEYS =
    new Set([
        "__proto__",
        "prototype",
        "constructor"
    ]);



/**
 * Validate Unicode representation.
 *
 * NFC prevents multiple byte
 * representations of equivalent strings.
 *
 * The gateway verifier should additionally
 * implement full UTS #39 checking.
 */
function normalizeString(
    value:string
):string{


    const normalized =
        value.normalize("NFC");


    if(normalized !== value){

        throw new IntegrityCollisionError(
            "Non canonical Unicode representation"
        );
    }


    return normalized;
}



/**
 * Detect unsafe primitive objects.
 */
function isPlainObject(
    value:unknown
):boolean{


    if(
        typeof value !== "object"
        ||
        value === null
    ){

        return false;
    }


    const proto =
        Object.getPrototypeOf(value);


    return (
        proto === Object.prototype
        ||
        proto === null
    );
}



/**
 * Canonical transformation.
 */
function canonicalize(
    value:unknown,
    path="$",
    depth=0
):CanonicalValue{


    if(depth > MAX_DEPTH){

        throw new IntegrityCollisionError(
            `Maximum depth exceeded at ${path}`
        );
    }



    if(value === null){

        return null;
    }



    if(typeof value === "boolean"){

        return value;
    }



    if(typeof value === "number"){


        if(
            !Number.isSafeInteger(value)
        ){

            throw new IntegrityCollisionError(
                `Unsafe integer at ${path}`
            );
        }


        return value;
    }



    if(typeof value === "string"){

        return normalizeString(value);

    }



    if(Array.isArray(value)){


        return value.map(
            (entry,index)=>
                canonicalize(
                    entry,
                    `${path}[${index}]`,
                    depth+1
                )
        );

    }




    if(isPlainObject(value)){


        const obj =
            value as Record<string,unknown>;


        const keys =
            Object.keys(obj);



        if(keys.length > MAX_KEYS){

            throw new IntegrityCollisionError(
                `Object exceeds key limit at ${path}`
            );
        }



        for(const key of keys){

            if(FORBIDDEN_KEYS.has(key)){

                throw new IntegrityCollisionError(
                    `Forbidden key ${key} at ${path}`
                );
            }
        }



        const sortedKeys =
            keys.sort(
                (a,b)=>
                    a < b ? -1 :
                    a > b ? 1 :
                    0
            );



        const result:
            Record<string,CanonicalValue>
            =
            Object.create(null);



        for(const key of sortedKeys){


            result[key] =
                canonicalize(
                    obj[key],
                    `${path}.${key}`,
                    depth+1
                );

        }


        return result;

    }




    throw new IntegrityCollisionError(
        `Unsupported value type at ${path}`
    );

}



/**
 * Deterministic serialization.
 *
 * Produces canonical byte representation.
 *
 * No whitespace.
 * Sorted keys.
 * Stable recursion.
 */
function canonicalSerialize(
    value:CanonicalValue
):string{


    if(Array.isArray(value)){

        return `[${value
            .map(canonicalSerialize)
            .join(",")}]`;

    }



    if(
        typeof value === "object"
        &&
        value !== null
    ){

        const obj =
            value as Record<string,CanonicalValue>;


        return `{${Object.keys(obj)
            .map(
                key =>
                    `${JSON.stringify(key)}:${canonicalSerialize(obj[key])}`
            )
            .join(",")}}`;

    }



    return JSON.stringify(value);

}



/**
 * Deep immutable snapshot.
 *
 * Honest runtime protection only.
 *
 * NOT a TCB boundary.
 */
function deepFreeze<T>(
    value:T,
    seen=new WeakSet<object>()
):Readonly<T>{


    if(
        typeof value !== "object"
        ||
        value === null
    ){

        return value as Readonly<T>;

    }



    if(seen.has(value as object)){

        throw new IntegrityCollisionError(
            "Circular reference detected"
        );
    }



    seen.add(value as object);



    Object.freeze(value);



    for(
        const child of Object.values(
            value as object
        )
    ){

        deepFreeze(
            child,
            seen
        );

    }



    return value as Readonly<T>;

}



/**
 * Creates isolated execution snapshot.
 */
function createSnapshot<T>(
    value:T
):Readonly<T>{


    const clone =
        structuredClone(value);


    return deepFreeze(clone);

}



/**
 * Commitment artifact.
 */
export interface DeclarationCommitment {


    protocol:string;


    ci:string;


    canonicalPayload:string;


    snapshot:Readonly<unknown>;


    createdAt:number;

}



/**
 * Generate Declaration Commitment.
 *
 * Produces:
 *
 * C_I = H(protocol || canonical(D_raw))
 *
 */
export function createDeclarationCommitment(
    rawAction:unknown
):DeclarationCommitment{


    const snapshot =
        createSnapshot(rawAction);



    const normalized =
        canonicalize(snapshot);



    const canonicalPayload =
        canonicalSerialize(normalized);



    const material =
        [
            HASH_DOMAIN,
            DAB_PROTOCOL_VERSION,
            canonicalPayload
        ].join(":");



    const digest =
        createHash("sha256")
            .update(
                material,
                "utf8"
            )
            .digest("hex");



    return {

        protocol:
            DAB_PROTOCOL_VERSION,


        ci:
            `sha256:${digest}`,


        canonicalPayload,


        snapshot,


        createdAt:
            Date.now()
    };

}



/**
 * Local reproducibility helper.
 *
 * TEST ONLY.
 *
 * Gateway MUST independently
 * derive C_E.
 */
export function recomputeDeclarationHash(
    canonicalPayload:string
):string{


    const material =
        [
            HASH_DOMAIN,
            DAB_PROTOCOL_VERSION,
            canonicalPayload
        ].join(":");



    return (
        "sha256:" +
        createHash("sha256")
            .update(
                material,
                "utf8"
            )
            .digest("hex")
    );

}