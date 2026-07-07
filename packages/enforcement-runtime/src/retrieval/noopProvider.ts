import { RetrievedContextCandidate, RetrievalProvider } from "./types";

export class NoopRetrievalProvider implements RetrievalProvider {
  async retrieve(_input: Parameters<RetrievalProvider["retrieve"]>[0]): Promise<RetrievedContextCandidate[]> {
    return [];
  }
}
