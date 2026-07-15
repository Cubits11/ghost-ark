import { ValidationError } from "../../../shared/src/errors";
import { TransitRecord } from "../gateway/sidecarProxy";

/**
 * Per-invocation custody ledger for gateway transit records.
 *
 * One ledger instance covers one governed invocation. Sequence numbers are
 * allocated here before a transit is attempted, so a severed transit burns
 * its sequence number: the resulting gap is itself evidence that an egress
 * attempt started and did not complete under custody.
 *
 * Recording discipline is fail-closed:
 * - only allocated sequence numbers may be recorded (no forged tail entries),
 * - recorded sequence numbers must be strictly increasing,
 * - digests must be well-formed sha256 values.
 *
 * The ledger records what the gateway observed. It does not prove that no
 * egress happened outside gateway custody; that boundary is enforced by
 * governedInvoke refusing to emit a v2 receipt when model egress completed
 * with zero recorded transits.
 */

const sha256DigestPattern = /^sha256:[a-f0-9]{64}$/u;

function ledgerError(message: string, context: Record<string, unknown> = {}): ValidationError {
  return new ValidationError(message, { domain: "ghost_ark.transit_ledger.v1", ...context });
}

export class TransitLedger {
  private allocatedSequenceCount = 0;
  private lastRecordedSequenceNum = -1;
  private readonly transits: TransitRecord[] = [];

  /** Allocate the next transit sequence number before attempting egress. */
  nextSequenceNum(): number {
    const sequenceNum = this.allocatedSequenceCount;
    this.allocatedSequenceCount += 1;
    return sequenceNum;
  }

  record(record: TransitRecord): void {
    if (!record || typeof record !== "object") {
      throw ledgerError("Transit record must be an object.");
    }
    if (record.schemaVersion !== "ghost.gateway_transit.v1") {
      throw ledgerError("Transit record schema version is not ghost.gateway_transit.v1.", {
        observed: record.schemaVersion
      });
    }
    if (!Number.isSafeInteger(record.sequenceNum) || record.sequenceNum < 0) {
      throw ledgerError("Transit record sequenceNum must be a non-negative safe integer.", {
        observed: record.sequenceNum
      });
    }
    if (record.sequenceNum >= this.allocatedSequenceCount) {
      throw ledgerError("Transit record sequenceNum was never allocated by this ledger.", {
        observed: record.sequenceNum,
        allocated: this.allocatedSequenceCount
      });
    }
    if (record.sequenceNum <= this.lastRecordedSequenceNum) {
      throw ledgerError("Transit record sequenceNum must be strictly increasing.", {
        observed: record.sequenceNum,
        lastRecorded: this.lastRecordedSequenceNum
      });
    }
    if (!sha256DigestPattern.test(record.requestDigest)) {
      throw ledgerError("Transit record requestDigest has an invalid digest shape.");
    }
    if (!sha256DigestPattern.test(record.responseDigest)) {
      throw ledgerError("Transit record responseDigest has an invalid digest shape.");
    }

    this.lastRecordedSequenceNum = record.sequenceNum;
    this.transits.push(record);
  }

  /** Records in recording order, which the discipline above keeps sequence-ordered. */
  records(): TransitRecord[] {
    return [...this.transits];
  }

  count(): number {
    return this.transits.length;
  }
}
