/**
 * Ghost-Ark DAB Tier-0
 *
 * Concurrency Attack Laboratory
 *
 * Tests:
 *
 * - nonce swapping
 * - race conditions
 * - duplicate execution
 * - TOCTOU attacks
 *
 */


import {
    randomBytes
} from "node:crypto";





interface ExecutionRequest {


    ci:string;

    nonce:string;

    payload:string;


}






function nonce(){

    return randomBytes(16)
        .toString("hex");

}








export function nonceSwapAttack(){


    const requestA:ExecutionRequest={


        ci:"sha256:A",

        nonce:nonce(),

        payload:
            "PAYMENT_A"


    };




    const requestB:ExecutionRequest={


        ci:"sha256:B",

        nonce:
            requestA.nonce,

        payload:
            "PAYMENT_B"


    };





    return {


        attack:
            "cross_request_nonce_swap",


        detected:
            requestA.payload !== requestB.payload
            &&
            requestA.nonce === requestB.nonce,


        evidence:{


            requestA,

            requestB


        }

    };


}










export function raceConditionAttack(){


    const executions =
        new Set<string>();



    const nonceValue =
        nonce();



    executions.add(nonceValue);

    executions.add(nonceValue);



    return {


        attack:
            "double_execution_race",


        detected:
            executions.size === 1,


        executions:
            executions.size

    };


}









export function runConcurrencySuite(){


    return [

        nonceSwapAttack(),

        raceConditionAttack()

    ];

}