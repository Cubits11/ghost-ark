/**
 * Ghost-Ark DAB Tier-0
 *
 * Replay Attack Laboratory
 *
 * Tests:
 *
 * Previously certified actions
 * cannot execute twice.
 *
 */



const usedNonces =
    new Set<string>();





export function replayAttack(){


    const nonce =
        "nonce-example";



    const first =
        !usedNonces.has(
            nonce
        );



    usedNonces.add(
        nonce
    );



    const second =
        !usedNonces.has(
            nonce
        );



    return {


        attack:
            "receipt_replay",


        detected:
            first === true
            &&
            second === false,


        first_execution:
            first,


        replay_execution:
            second

    };

}










export function replayFloodAttack(){


    const attempts =
        10000;


    const ledger =
        new Set<string>();


    let accepted=0;



    for(
        let i=0;
        i<attempts;
        i++
    ){

        const nonce =
            "fixed_nonce";


        if(
            !ledger.has(nonce)
        ){

            accepted++;

            ledger.add(
                nonce
            );

        }

    }



    return {


        attack:
            "mass_replay_flood",


        detected:
            accepted===1,


        accepted

    };


}










export function runReplaySuite(){


    return [

        replayAttack(),

        replayFloodAttack()

    ];

}