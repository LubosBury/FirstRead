import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, type Me } from "@/lib/api";

type MeState = {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setBalance: (balance: number) => void;
};

const MeContext = createContext<MeState | null>(null);

export function MeProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(
    () =>
      api.me().then(
        (m) => setMe(m),
        (e) => {
          if (!(e instanceof ApiError && e.status === 401)) console.error(e);
          setMe(null);
        },
      ).finally(() => setLoading(false)),
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setBalance = useCallback((balance: number) => setMe((m) => (m ? { ...m, balance } : m)), []);

  return <MeContext.Provider value={{ me, loading, refresh, setBalance }}>{children}</MeContext.Provider>;
}

export function useMe(): MeState {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error("useMe outside MeProvider");
  return ctx;
}
