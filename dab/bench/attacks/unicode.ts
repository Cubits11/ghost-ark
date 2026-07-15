/**
 * Ghost-Ark DAB Tier-0
 *
 * Unicode Confusion Attack Laboratory
 *
 *
 * Objective:
 *
 * Detect visually identical
 * but byte-different identifiers.
 *
 */



export interface UnicodeAttackResult {


    attack:string;

    detected:boolean;

    original:string;

    malicious:string;

}








export function unicodeNormalizationAttack(){


    const original =
        "café";



    const decomposed =
        "cafe\u0301";



    return {


        attack:
            "unicode_normalization_collision",


        detected:
            original !== decomposed
            &&
            original.normalize("NFC")
            ===
            decomposed.normalize("NFC"),


        original,


        malicious:
            decomposed


    };

}









export function homoglyphAttack(){


    const trusted =
        "paypal.com";



    const attacker =
        "paypaⅼ.com";



    return {


        attack:
            "unicode_homoglyph_spoof",


        detected:
            trusted !== attacker,


        original:
            trusted,


        malicious:
            attacker


    };


}









export function runUnicodeSuite(){


    return [

        unicodeNormalizationAttack(),

        homoglyphAttack()

    ];

}