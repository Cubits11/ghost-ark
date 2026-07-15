/**
 * Ghost-Ark DAB Tier-0
 *
 * Performance Evaluation Harness
 *
 * Location:
 *
 *      dab/bench/performance.ts
 *
 *
 * Measures:
 *
 * 1. Baseline execution latency
 * 2. DANF commitment cost
 * 3. SHA256 hashing overhead
 * 4. Gateway verification overhead
 * 5. End-to-end DAB cost
 * 6. Throughput
 *
 *
 * Publication metric:
 *
 *      Overhead %
 *
 *              DAB_time - Baseline_time
 *      -------------------------------
 *                Baseline_time
 *
 *
 * Goal:
 *
 * Maintain <15% execution overhead.
 *
 */



import {
    performance
} from "node:perf_hooks";


import {
    createHash,
    randomBytes
} from "node:crypto";





interface BenchmarkConfig {


    iterations:number;


    payloadSize:number;


}






interface TimingResult {


    operation:string;


    iterations:number;


    throughput_ops_sec:number;


    p50_ms:number;


    p95_ms:number;


    p99_ms:number;


    average_ms:number;


}






interface FullPerformanceReport {


    protocol:string;


    configuration:BenchmarkConfig;


    baseline:TimingResult;


    commitment:TimingResult;


    verification:TimingResult;


    end_to_end:TimingResult;


    overhead_percent:number;


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









function summarize(
    name:string,
    times:number[]
):TimingResult{


    const total =
        times.reduce(
            (a,b)=>a+b,
            0
        );


    const seconds =
        total/1000;



    return {


        operation:
            name,


        iterations:
            times.length,


        throughput_ops_sec:
            times.length /
            seconds,


        p50_ms:
            percentile(
                times,
                .50
            ),


        p95_ms:
            percentile(
                times,
                .95
            ),


        p99_ms:
            percentile(
                times,
                .99
            ),


        average_ms:
            total /
            times.length

    };

}









function generatePayload(
    size:number
):string{


    return (
        "A".repeat(
            size
        )
    );

}









/**
 * Baseline:
 *
 * Execute action without DAB.
 *
 */
function benchmarkBaseline(
    config:BenchmarkConfig
){


    const times:number[]=[];



    for(
        let i=0;
        i<config.iterations;
        i++
    ){


        const start =
            performance.now();



        JSON.parse(
            JSON.stringify({
                action:"transfer",
                payload:"hello"
            })
        );



        times.push(
            performance.now()-start
        );


    }


    return summarize(
        "baseline_execution",
        times
    );

}









/**
 * DANF commitment cost.
 *
 * Simulates:
 *
 * object
 * ->
 * canonical bytes
 * ->
 * SHA256
 */
function benchmarkCommitment(
    config:BenchmarkConfig
){


    const times:number[]=[];


    const payload =
        generatePayload(
            config.payloadSize
        );



    for(
        let i=0;
        i<config.iterations;
        i++
    ){


        const start =
            performance.now();



        const canonical =
            JSON.stringify({
                action:"transfer",
                payload
            });



        createHash(
            "sha256"
        )
        .update(
            canonical
        )
        .digest(
            "hex"
        );



        times.push(
            performance.now()-start
        );

    }


    return summarize(
        "danf_commitment",
        times
    );

}









/**
 * Gateway verification.
 *
 * Simulates:
 *
 * CI
 * |
 * CE derivation
 * |
 * comparison
 */
function benchmarkVerification(
    config:BenchmarkConfig
){


    const times:number[]=[];


    const payload =
        generatePayload(
            config.payloadSize
        );



    const ci =
        createHash(
            "sha256"
        )
        .update(payload)
        .digest("hex");




    for(
        let i=0;
        i<config.iterations;
        i++
    ){


        const start =
            performance.now();



        const ce =
            createHash(
                "sha256"
            )
            .update(payload)
            .digest("hex");



        const valid =
            ci===ce;



        if(!valid){

            throw new Error(
                "Verifier failure"
            );

        }



        times.push(
            performance.now()-start
        );

    }



    return summarize(
        "gateway_verification",
        times
    );

}









/**
 * Complete DAB execution path.
 */
function benchmarkEndToEnd(
    config:BenchmarkConfig
){


    const times:number[]=[];


    const payload =
        generatePayload(
            config.payloadSize
        );



    for(
        let i=0;
        i<config.iterations;
        i++
    ){


        const start =
            performance.now();



        const canonical =
            JSON.stringify({
                payload,
                nonce:
                    randomBytes(
                        16
                    )
                    .toString(
                        "hex"
                    )
            });



        const ci =
            createHash(
                "sha256"
            )
            .update(
                canonical
            )
            .digest(
                "hex"
            );



        const ce =
            createHash(
                "sha256"
            )
            .update(
                canonical
            )
            .digest(
                "hex"
            );



        if(ci!==ce){

            throw new Error(
                "DAB divergence"
            );

        }



        times.push(
            performance.now()-start
        );

    }



    return summarize(
        "dab_end_to_end",
        times
    );

}









export function runPerformanceBenchmark(
    config:BenchmarkConfig={


        iterations:10000,


        payloadSize:1024


    }

):FullPerformanceReport{



    const baseline =
        benchmarkBaseline(
            config
        );



    const commitment =
        benchmarkCommitment(
            config
        );



    const verification =
        benchmarkVerification(
            config
        );



    const end_to_end =
        benchmarkEndToEnd(
            config
        );



    const overhead =

        (
            end_to_end.average_ms -
            baseline.average_ms
        )
        /
        baseline.average_ms
        *
        100;



    return {


        protocol:
            "Ghost-Ark DAB Tier-0",


        configuration:
            config,


        baseline,


        commitment,


        verification,


        end_to_end,


        overhead_percent:
            overhead

    };

}








if(
    import.meta.url ===
    `file://${process.argv[1]}`
){

    console.log(

        JSON.stringify(

            runPerformanceBenchmark(),

            null,

            2

        )

    );

}