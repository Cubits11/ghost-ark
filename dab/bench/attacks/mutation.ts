/**
 * Ghost-Ark DAB Tier-0
 *
 * Mutation Attack Laboratory
 *
 * Objective:
 *
 * Validate:
 *
 *     C_I != C_E
 *
 * is always detected.
 *
 *
 * Attack classes:
 *
 * 1. Payload byte mutation
 * 2. Field substitution
 * 3. AST mutation
 * 4. Prototype mutation
 * 5. Delayed mutation
 *
 */


import {
    createHash
} from "node:crypto";



export interface MutationResult {

    attack:string;

    detected:boolean;

    expected:string;

    observed:string;

}





function sha256(
    data:string
):string {


    return (
        "sha256:"+
        createHash("sha256")
        .update(data)
        .digest("hex")
    );

}





export function attackPayloadMutation(){


    const original =
        JSON.stringify({
            action:"transfer",
            amount:"50",
            destination:"alice"
        });



    const declared =
        sha256(original);



    const mutated =
        JSON.stringify({
            action:"transfer",
            amount:"5000",
            destination:"alice"
        });



    const execution =
        sha256(mutated);



    return {


        attack:
            "payload_field_mutation",


        detected:
            declared !== execution,


        expected:
            declared,


        observed:
            execution

    };

}









export function attackByteFlip(){


    const payload =
        Buffer.from(
            "TRANSFER:50"
        );



    const ci =
        sha256(
            payload.toString()
        );



    payload[5]^=0xff;



    const ce =
        sha256(
            payload.toString()
        );



    return {


        attack:
            "single_byte_flip",


        detected:
            ci !== ce,


        expected:
            ci,


        observed:
            ce

    };


}









export function attackPrototypePollution(){


    const payload:any = {


        amount:
            "100"



    };



    Object.setPrototypeOf(
        payload,
        {
            amount:
                "999999"
        }
    );



    const own =
        payload.amount;



    const safe =
        Object.hasOwn(
            payload,
            "amount"
        );



    return {


        attack:
            "prototype_pollution",


        detected:
            safe === false,


        expected:
            "own_property",


        observed:
            String(own)

    };

}









export function runMutationSuite(){


    return [

        attackPayloadMutation(),

        attackByteFlip(),

        attackPrototypePollution()

    ];

}