import React from "react";

export interface ReceiptPanelProps {
  receiptId: string;
  digestSha256: string;
  keyId: string;
  status: "issued" | "superseded" | "revoked" | "disputed";
  issuedAt: string;
}

export function ReceiptPanel(props: ReceiptPanelProps): React.ReactElement {
  return (
    <section aria-label="Receipt">
      <header>
        <h2>Receipt</h2>
        <span>{props.status}</span>
      </header>
      <dl>
        <dt>ID</dt>
        <dd>{props.receiptId}</dd>
        <dt>Digest</dt>
        <dd>{props.digestSha256}</dd>
        <dt>KMS key</dt>
        <dd>{props.keyId}</dd>
        <dt>Issued</dt>
        <dd>{props.issuedAt}</dd>
      </dl>
    </section>
  );
}
