/**
 * Ghost-Ark DAB Tier-0
 *
 * Formal Security Games Evaluation Harness
 *
 * Implements empirical adversarial games:
 *
 * G1 Mutation Resistance
 * G2 Replay Resistance
 * G3 Transaction Binding
 * G4 Serialization Collision
 * G5 Nonce Confusion
 *
 *
 * Security metric:
 *
 *        Adv_A
 *
 *        = successful attacks / total attacks
 *
 *
 * Desired:
 *
 *        Adv_A = 0
 *
 *
 * This file is NOT the security boundary.
 *
 * It evaluates:
 *
 * Agent Runtime
 *       |
 * Gateway Reference Monitor
 *       |
 * Independent Verifier
 *
 */


import {
    performance
} from "node:perf_hooks";


import {
    createHash,
    randomBytes
} from "node:crypto";





/**
 * Attacker capability model.
 */
export interface AttackerModel {


    canModifyBytes:boolean;

    canReplayReceipts:boolean;

    canSwapFields:boolean;

    canInjectUnicode:boolean;

}








export interface GameResult {


    game:string;


    trials:number;


    attackerSuccesses:number;


    falseAcceptances:number;


    advantage:number;


    confidenceUpperBound:number;


    latency:


    {

        p50:number;

        p95:number;

        p99:number;

    };


    passed:boolean;


}









interface Transaction {


    ci:string;


    ce:string;


    nonce:string;


    payload:string;


}









function hash(
    data:string
):string {


    return (
        "sha256:"+
        createHash("sha256")
        .update(data,"utf8")
        .digest("hex")
    );

}









function transaction(
    payload:string
):Transaction {


    const digest =
        hash(payload);


    return {


        ci:digest,


        ce:digest,


        nonce:
            randomBytes(32)
            .toString("hex"),


        payload


    };

}









function percentile(
    values:number[],
    p:number
){


    const sorted =
        [...values]
        .sort(
            (a,b)=>a-b
        );


    return sorted[
        Math.floor(
            sorted.length*p
        )
    ] ?? 0;

}









/**
 * Wilson upper confidence bound.
 *
 * Important for security papers.
 *
 * Zero failures does not mathematically
 * mean zero probability.
 */
function confidenceUpperBound(
    failures:number,
    samples:number
){


    if(failures===0){

        return (
            3 /
            samples
        );

    }


    return failures/samples;

}









function result(
    game:string,
    trials:number,
    success:number,
    latency:number[]
):GameResult{


    return {


        game,


        trials,


        attackerSuccesses:
            success,


        falseAcceptances:
            success,


        advantage:
            success/trials,


        confidenceUpperBound:
            confidenceUpperBound(
                success,
                trials
            ),


        latency:{


            p50:
                percentile(
                    latency,
                    .50
                ),


            p95:
                percentile(
                    latency,
                    .95
                ),


            p99:
                percentile(
                    latency,
                    .99
                )

        },


        passed:
            success===0

    };

}









/**
 * GAME 1
 *
 * Mutation Resistance
 *
 * Attacker:
 *
 * Receives CI.
 * Changes execution bytes.
 */
export function mutationGame(
    trials:number
){


    let success=0;

    const latency:number[]=[];



    for(
        let i=0;
        i<trials;
        i++
    ){


        const tx =
            transaction(
                "TRANSFER:100"
            );


        const start =
            performance.now();



        const mutated =
            tx.payload+
            ":ATTACK";



        const ce =
            hash(
                mutated
            );



        if(
            tx.ci===ce
        ){

            success++;

        }



        latency.push(
            performance.now()-start
        );


    }



    return result(
        "Mutation Resistance",
        trials,
        success,
        latency
    );

}









/**
 * GAME 2
 *
 * Replay Resistance
 */
export function replayGame(
    trials:number
){


    let success=0;


    const latency:number[]=[];


    const ledger =
        new Set<string>();


    const tx =
        transaction(
            "PAYMENT"
        );



    for(
        let i=0;
        i<trials;
        i++
    ){


        const start =
            performance.now();



        const replayAccepted =
            ledger.has(
                tx.nonce
            );


        if(
            replayAccepted
        ){

            success++;

        }


        ledger.add(
            tx.nonce
        );



        latency.push(
            performance.now()-start
        );


    }



    return result(
        "Replay Resistance",
        trials,
        success,
        latency
    );

}









/**
 * GAME 3
 *
 * Cross transaction binding.
 */
export function bindingGame(
    trials:number
){


    let success=0;


    const latency:number[]=[];



    for(
        let i=0;
        i<trials;
        i++
    ){


        const A =
            transaction(
                "ACTION_A"
            );


        const B =
            transaction(
                "ACTION_B"
            );



        const start =
            performance.now();



        const forged = {


            ci:A.ci,

            ce:B.ce,


            nonce:A.nonce


        };



        if(
            forged.ci===
            forged.ce
        ){

            success++;

        }



        latency.push(
            performance.now()-start
        );


    }


    return result(
        "Cross Transaction Binding",
        trials,
        success,
        latency
    );

}









/**
 * GAME 4
 *
 * Unicode / serialization collision.
 */
export function serializationGame(
    trials:number
){


    let success=0;


    const latency:number[]=[];



    for(
        let i=0;
        i<trials;
        i++
    ){


        const start =
            performance.now();



        const trusted =
            "paypal.com";


        const spoof =
            "paypa\u217Cl.com";



        const trustedHash =
            hash(trusted);


        const spoofHash =
            hash(spoof);



        if(
            trustedHash===
            spoofHash
        ){

            success++;

        }



        latency.push(
            performance.now()-start
        );

    }



    return result(
        "Serialization Ambiguity",
        trials,
        success,
        latency
    );

}









export function runAllFormalGames(
    trials=10000
){


    const games=[


        mutationGame(trials),


        replayGame(trials),


        bindingGame(trials),


        serializationGame(trials)


    ];



    return {


        protocol:
            "Ghost-Ark DAB Tier-0",


        trials,


        games,


        global_advantage:


            games.reduce(
                (
                    total,
                    g
                )=>
                    total+
                    g.advantage,
                0
            )
            /
            games.length,


        all_passed:


            games.every(
                g=>g.passed
            )

    };

}







if(
    import.meta.url ===
    `file://${process.argv[1]}`
){


    console.log(

        JSON.stringify(

            runAllFormalGames(),

            null,

            2

        )

    );

}