import React from "react";

export interface ClaimRow {
  claimId: string;
  statement: string;
  state: string;
  receiptCount: number;
  updatedAt: string;
}

export function ClaimsTable({ claims }: { claims: ClaimRow[] }): React.ReactElement {
  return (
    <table aria-label="Claims">
      <thead>
        <tr>
          <th>Claim</th>
          <th>State</th>
          <th>Receipts</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        {claims.map((claim) => (
          <tr key={claim.claimId}>
            <td>
              <strong>{claim.claimId}</strong>
              <p>{claim.statement}</p>
            </td>
            <td>{claim.state}</td>
            <td>{claim.receiptCount}</td>
            <td>{claim.updatedAt}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
