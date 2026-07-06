import React from "react";

export interface GovernanceSummaryProps {
  tenantSlug: string;
  lfTags: Record<string, string>;
  rowFilter?: string;
  columnRestrictions: string[];
}

export function GovernanceSummary(props: GovernanceSummaryProps): React.ReactElement {
  return (
    <section aria-label="Governance summary">
      <h2>Governance</h2>
      <dl>
        <dt>Tenant</dt>
        <dd>{props.tenantSlug}</dd>
        <dt>Row filter</dt>
        <dd>{props.rowFilter ?? "none"}</dd>
        <dt>Column restrictions</dt>
        <dd>{props.columnRestrictions.length === 0 ? "none" : props.columnRestrictions.join(", ")}</dd>
      </dl>
      <ul>
        {Object.entries(props.lfTags).map(([key, value]) => (
          <li key={key}>
            <strong>{key}</strong>: {value}
          </li>
        ))}
      </ul>
    </section>
  );
}
