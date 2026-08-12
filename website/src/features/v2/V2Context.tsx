import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { DatingBootstrap } from "./domain";
import { datingService } from "./service";
import { V2Context, type V2ContextValue } from "./v2-context";

export function V2Provider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<DatingBootstrap | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setData(await datingService.bootstrap());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "演示数据加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    return datingService.subscribe(() => {
      void reload();
    });
  }, [reload]);

  const value = useMemo<V2ContextValue>(() => ({
    loading,
    profile: data?.currentUser ?? null,
    criteria: data?.criteria ?? null,
    pools: data?.pools ?? [],
    matches: data?.matches ?? [],
    service: datingService,
    reload,
  }), [data, loading, reload]);

  return <V2Context.Provider value={value}>{children}</V2Context.Provider>;
}
