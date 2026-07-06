import React from "react";

export interface LineageTraceNode {
  id: string;
  label: string;
  kind: string;
}

export interface LineageTraceEdge {
  from: string;
  to: string;
  eventId: string;
}

export function LineageTrace({ nodes, edges }: { nodes: LineageTraceNode[]; edges: LineageTraceEdge[] }): React.ReactElement {
  return (
    <section aria-label="Lineage trace">
      <h2>Lineage</h2>
      <ol>
        {edges.map((edge) => {
          const from = nodes.find((node) => node.id === edge.from);
          const to = nodes.find((node) => node.id === edge.to);
          return (
            <li key={`${edge.eventId}-${edge.from}-${edge.to}`}>
              <span>{from?.label ?? edge.from}</span>
              <span> to </span>
              <span>{to?.label ?? edge.to}</span>
              <code>{edge.eventId}</code>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
