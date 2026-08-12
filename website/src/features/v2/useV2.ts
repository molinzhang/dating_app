import { useContext } from "react";
import { V2Context } from "./v2-context";

export function useV2() {
  const context = useContext(V2Context);
  if (!context) throw new Error("useV2 must be used inside V2Provider");
  return context;
}
