/**
 * Ghost-Ark DAB Tier-0
 *
 * Declared Action Normal Form (DANF)
 *
 * Converts an untrusted runtime artifact into
 * deterministic canonical bytes.
 *
 * SECURITY MODEL:
 *
 * This module does NOT establish trust.
 *
 * It creates a declaration artifact.
 *
 * The trusted Gateway independently derives:
 *
 *      C_E = H(execution bytes)
 *
 * Security exists only when:
 *
 *      C_I == C_E
 *
 */


export const DANF_VERSION =
    "DANF-1.0";



export class IntegrityCollisionError
    extends Error {

    constructor(message:string){

        super(message);

        this.name =
            "IntegrityCollisionError";
    }
}





export type DANFValue =
    | null
    | boolean
    | number
    | string
    | DANFValue[]
    | {
        [key:string]:DANFValue
    };





const FORBIDDEN_KEYS =
    new Set([
        "__proto__",
        "prototype",
        "constructor"
    ]);



const MAX_DEPTH = 64;

const MAX_KEYS = 10000;





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





function normalizeUnicode(
    value:string,
    path:string
):string{


    const normalized =
        value.normalize("NFC");


    if(normalized !== value){

        throw new IntegrityCollisionError(
            `Unicode ambiguity detected at ${path}`
        );
    }


    return normalized;

}








function normalizeValue(
    value:unknown,
    path="$",
    depth=0,
    seen=new WeakSet<object>()
):DANFValue{


    if(depth > MAX_DEPTH){

        throw new IntegrityCollisionError(
            `Maximum nesting depth exceeded: ${path}`
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
                `Unsafe numeric value: ${path}`
            );
        }


        return value;

    }




    if(typeof value === "string"){

        return normalizeUnicode(
            value,
            path
        );

    }





    if(Array.isArray(value)){


        return value.map(
            (item,index)=>

                normalizeValue(
                    item,
                    `${path}[${index}]`,
                    depth+1,
                    seen
                )
        );

    }





    if(isPlainObject(value)){


        if(seen.has(value as object)){

            throw new IntegrityCollisionError(
                `Circular reference detected: ${path}`
            );

        }


        seen.add(value as object);



        const object =
            value as Record<string,unknown>;



        const keys =
            Object.keys(object);



        if(keys.length > MAX_KEYS){

            throw new IntegrityCollisionError(
                `Object exceeds key limit: ${path}`
            );

        }





        for(const key of keys){

            if(FORBIDDEN_KEYS.has(key)){


                throw new IntegrityCollisionError(
                    `Forbidden property: ${key}`
                );

            }

        }






        keys.sort();



        const output:
            Record<string,DANFValue>
            =
            Object.create(null);




        for(const key of keys){


            output[key] =
                normalizeValue(
                    object[key],
                    `${path}.${key}`,
                    depth+1,
                    seen
                );

        }



        return output;

    }






    throw new IntegrityCollisionError(
        `Unsupported runtime type at ${path}`
    );

}










/**
 * Canonical byte serialization.
 *
 * Deterministic:
 *
 * - sorted keys
 * - no whitespace
 * - stable recursion
 */
export function serializeDANF(
    value:DANFValue
):string{


    if(Array.isArray(value)){


        return "[" +
            value
            .map(
                serializeDANF
            )
            .join(",")
            +
            "]";

    }




    if(
        typeof value === "object"
        &&
        value !== null
    ){


        const object =
            value as Record<string,DANFValue>;



        return "{" +

            Object.keys(object)
            .map(
                key =>
                    JSON.stringify(key)
                    +
                    ":"
                    +
                    serializeDANF(object[key])
            )
            .join(",")
            +

            "}";

    }




    return JSON.stringify(value);

}







/**
 * Public DANF compiler.
 *
 * D_raw -> DANF
 */
export function createDANF(
    raw:unknown
):{

    normalized:DANFValue;

    canonical:string;

}{


    const normalized =
        normalizeValue(
            structuredClone(raw)
        );



    const canonical =
        serializeDANF(
            normalized
        );



    return {

        normalized,

        canonical

    };

}