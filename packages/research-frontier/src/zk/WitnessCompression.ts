export function compressWitnessPath(siblings: string[]): string {
  return Buffer.from(JSON.stringify(siblings)).toString("base64");
}

export function decompressWitnessPath(compressed: string): string[] {
  return JSON.parse(Buffer.from(compressed, "base64").toString("utf-8"));
}
