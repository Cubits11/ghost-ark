import { RetrievedContextCandidate, RetrievalProvider } from "./types";

export class StaticRetrievalProvider implements RetrievalProvider {
  private readonly candidates: RetrievedContextCandidate[];

  constructor(candidates: RetrievedContextCandidate[]) {
    this.candidates = candidates.map((candidate) => ({
      ...candidate,
      taint: [...candidate.taint]
    }));
  }

  async retrieve(_input: Parameters<RetrievalProvider["retrieve"]>[0]): Promise<RetrievedContextCandidate[]> {
    return this.candidates.map((candidate) => ({
      ...candidate,
      taint: [...candidate.taint]
    }));
  }
}
