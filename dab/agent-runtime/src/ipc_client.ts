/**
 * Ghost-Ark DAB Tier-0
 *
 * Agent Runtime IPC Transport
 *
 * Security role:
 *
 * UNTRUSTED TRANSPORT ONLY
 *
 * Responsibilities:
 *
 * - move DANF declaration to gateway
 * - attach replay nonce
 * - maintain IPC framing
 *
 *
 * Does NOT:
 *
 * - verify execution
 * - authorize actions
 * - generate CE
 * - sign receipts
 *
 */


import {
    Socket
} from "node:net";

import {
    randomBytes
} from "node:crypto";


import type {
    DeclaredActionArtifact
} from "./danf.js";




const IPC_SOCKET =
    "/ipc/dab.sock";


const MAX_MESSAGE_SIZE =
    1024 * 1024;


const IPC_TIMEOUT_MS =
    5000;




export interface GatewayReceipt {

    status:
        | "CERTIFIED"
        | "MUTATION_DETECTED_HALT"
        | "REPLAY_REJECTED"
        | "INVALID";


    ci?: string;

    ce?: string;

    nonce:string;

    timestamp:string;

    signature?:string;
}





export class IPCIntegrityError
extends Error {

    constructor(message:string){

        super(message);

        this.name =
            "IPCIntegrityError";
    }
}




function generateNonce():string {

    return (
        "dab-" +
        randomBytes(32)
        .toString("hex")
    );

}




function encodePayload(
    value:string
):string {

    return Buffer
        .from(value,"utf8")
        .toString("base64");

}




function createEnvelope(
    artifact:DeclaredActionArtifact,
    target:string
){


    const nonce =
        generateNonce();


    return {

        protocol:
            "DAB-TIER0",


        version:
            artifact.version,


        c_i:
            artifact.ci,


        nonce,


        target,


        issued_at:
            new Date()
            .toISOString(),


        payload_encoding:
            "base64",


        payload:
            encodePayload(
                artifact.canonical
            )

    };

}




function validateReceipt(
    receipt:any
):GatewayReceipt {


    if(
        typeof receipt.status !== "string"
    ){

        throw new IPCIntegrityError(
            "Malformed gateway receipt"
        );
    }


    if(
        typeof receipt.nonce !== "string"
    ){

        throw new IPCIntegrityError(
            "Missing nonce"
        );
    }


    return receipt;
}





export function dispatchToGateway(
    artifact:DeclaredActionArtifact,
    target:string
):Promise<GatewayReceipt>{


    return new Promise(
    (
        resolve,
        reject
    )=>{


        const socket =
            new Socket();


        let buffer =
            Buffer.alloc(0);



        const envelope =
            createEnvelope(
                artifact,
                target
            );



        const message =
            Buffer.from(
                JSON.stringify(envelope),
                "utf8"
            );



        if(
            message.length >
            MAX_MESSAGE_SIZE
        ){

            reject(
                new IPCIntegrityError(
                    "IPC message too large"
                )
            );

            return;
        }





        socket.setTimeout(
            IPC_TIMEOUT_MS
        );



        socket.on(
            "timeout",
            ()=>{

                socket.destroy();

                reject(
                    new IPCIntegrityError(
                        "Gateway timeout"
                    )
                );

            }
        );



        socket.on(
            "data",
            chunk=>{


                buffer =
                    Buffer.concat(
                    [
                        buffer,
                        chunk
                    ]);



                if(
                    buffer.length >
                    MAX_MESSAGE_SIZE
                ){

                    socket.destroy();

                    reject(
                        new IPCIntegrityError(
                            "Response overflow"
                        )
                    );

                }

            }
        );




        socket.on(
            "end",
            ()=>{


                try{

                    const receipt =
                        JSON.parse(
                            buffer.toString("utf8")
                        );


                    resolve(
                        validateReceipt(receipt)
                    );


                }
                catch(error){

                    reject(
                        new IPCIntegrityError(
                            "Invalid gateway response"
                        )
                    );

                }


            }
        );




        socket.on(
            "error",
            error=>{

                reject(
                    new IPCIntegrityError(
                        error.message
                    )
                );

            }
        );




        socket.connect(
            IPC_SOCKET,
            ()=>{

                socket.write(
                    message
                );

                socket.end();

            }
        );


    });

}





export async function executeDABAction(
    artifact:DeclaredActionArtifact,
    target:string
){


    const receipt =
        await dispatchToGateway(
            artifact,
            target
        );


    if(
        receipt.status !==
        "CERTIFIED"
    ){

        throw new IPCIntegrityError(
            `Execution blocked: ${receipt.status}`
        );

    }


    return receipt;

}