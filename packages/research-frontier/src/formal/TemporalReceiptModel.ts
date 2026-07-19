export interface TemporalEvent {
  eventId: string;
  timestamp: string;
  eventType: "issued" | "superseded" | "revoked";
}

export function checkTemporalOrdering(events: TemporalEvent[]): boolean {
  for (let i = 1; i < events.length; i++) {
    if (events[i].timestamp < events[i - 1].timestamp) {
      return false;
    }
  }
  return true;
}
