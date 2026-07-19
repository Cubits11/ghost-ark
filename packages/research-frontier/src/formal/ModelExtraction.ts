export interface ExtractedTLASpec {
  moduleName: string;
  variables: string[];
  invariants: string[];
}

export function extractTLASpecFromState(moduleName: string, stateVars: string[]): ExtractedTLASpec {
  return {
    moduleName,
    variables: stateVars,
    invariants: [`${moduleName}Invariant`]
  };
}
