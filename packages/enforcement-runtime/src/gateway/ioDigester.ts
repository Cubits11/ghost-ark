import { Transform, TransformCallback } from "stream";
import { createHash, Hash } from "crypto";
import { ValidationError } from "../../../shared/src/errors";

/**
 * Pass-through stream that continuously digests the exact bytes in transit.
 * The digest is available only after the stream has fully flushed; asking
 * earlier fails closed rather than returning a partial hash.
 */
export class IODigester extends Transform {
  private readonly hash: Hash = createHash("sha256");
  private digestHex: string | null = null;

  _transform(chunk: any, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.hash.update(chunk);
    this.push(chunk);
    callback();
  }

  _flush(callback: TransformCallback): void {
    this.digestHex = `sha256:${this.hash.digest("hex")}`;
    callback();
  }

  public getDigest(): string {
    if (!this.digestHex) {
      throw new ValidationError("Stream digest requested before stream completion.", {
        domain: "ghost_ark.gateway_transit.v1"
      });
    }
    return this.digestHex;
  }
}
