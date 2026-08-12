import { createContext } from "react";
import type { DatingService, MatchCriteria, MatchProfile, MatchView, PoolSummary } from "./domain";

export interface V2ContextValue {
  loading: boolean;
  profile: MatchProfile | null;
  criteria: MatchCriteria | null;
  pools: PoolSummary[];
  matches: MatchView[];
  service: DatingService;
  reload: () => Promise<void>;
}

export const V2Context = createContext<V2ContextValue | null>(null);
