import { ValidationError } from "../../shared/src/errors";
import { LineageEvent, validateLineageEvent } from "./events";

export interface LineageEdge {
  from: string;
  to: string;
  eventId: string;
}

export class LineageGraph {
  private readonly events = new Map<string, LineageEvent>();
  private readonly outgoing = new Map<string, LineageEdge[]>();
  private readonly incoming = new Map<string, LineageEdge[]>();

  addEvent(event: LineageEvent): void {
    const validated = validateLineageEvent(event);
    if (this.events.has(validated.eventId)) {
      return;
    }
    this.events.set(validated.eventId, validated);
    for (const input of validated.inputs) {
      for (const output of validated.outputs) {
        const edge = { from: input, to: output, eventId: validated.eventId };
        this.outgoing.set(input, [...(this.outgoing.get(input) ?? []), edge]);
        this.incoming.set(output, [...(this.incoming.get(output) ?? []), edge]);
      }
    }
  }

  ancestors(nodeId: string): string[] {
    return this.walk(nodeId, "incoming");
  }

  descendants(nodeId: string): string[] {
    return this.walk(nodeId, "outgoing");
  }

  event(eventId: string): LineageEvent | undefined {
    return this.events.get(eventId);
  }

  edges(): LineageEdge[] {
    return [...this.outgoing.values()].flat();
  }

  assertAcyclic(): void {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (node: string): void => {
      if (visiting.has(node)) {
        throw new ValidationError("Lineage graph contains a cycle", { node });
      }
      if (visited.has(node)) {
        return;
      }
      visiting.add(node);
      for (const edge of this.outgoing.get(node) ?? []) {
        visit(edge.to);
      }
      visiting.delete(node);
      visited.add(node);
    };

    for (const edge of this.edges()) {
      visit(edge.from);
    }
  }

  private walk(nodeId: string, direction: "incoming" | "outgoing"): string[] {
    const seen = new Set<string>();
    const stack = [nodeId];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }
      const edges = direction === "incoming" ? this.incoming.get(current) ?? [] : this.outgoing.get(current) ?? [];
      for (const edge of edges) {
        const next = direction === "incoming" ? edge.from : edge.to;
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    return [...seen].sort();
  }
}
