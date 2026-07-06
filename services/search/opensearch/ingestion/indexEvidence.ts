export interface EvidenceSearchDocument {
  id: string;
  tenantSlug: string;
  title: string;
  body: string;
  objectUri: string;
  observedAt: string;
  receiptIds?: string[];
  lineageEventIds?: string[];
  classification?: string;
  metadata?: Record<string, unknown>;
}

export function buildBulkIndexPayload(indexAlias: string, documents: EvidenceSearchDocument[]): string {
  return documents
    .flatMap((document) => [
      JSON.stringify({ index: { _index: indexAlias, _id: document.id } }),
      JSON.stringify({
        ...document,
        indexedAt: new Date().toISOString()
      })
    ])
    .join("\n")
    .concat("\n");
}

export async function indexEvidenceDocuments(endpoint: string, indexAlias: string, documents: EvidenceSearchDocument[]): Promise<unknown> {
  const response = await fetch(`${endpoint.replace(/\/$/u, "")}/_bulk`, {
    method: "POST",
    headers: { "content-type": "application/x-ndjson" },
    body: buildBulkIndexPayload(indexAlias, documents)
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`OpenSearch bulk index failed with ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}
