import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../lib/api";

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (updater: T | null | ((prev: T | null) => T | null)) => void;
}

/** Carrega dados da API com estados de carregamento/erro e descarta respostas obsoletas. */
export function useApi<T>(loader: () => Promise<T>, deps: unknown[] = []): ApiState<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(loader, deps);

  const reload = useCallback(async () => {
    const id = ++seq.current;
    setLoading(true);
    try {
      const result = await load();
      if (id === seq.current) {
        setDataState(result);
        setError(null);
      }
    } catch (err) {
      if (id === seq.current) setError(err instanceof ApiError || err instanceof Error ? err.message : "Erro inesperado.");
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setData = useCallback((updater: T | null | ((prev: T | null) => T | null)) => {
    setDataState((prev) => (typeof updater === "function" ? (updater as (p: T | null) => T | null)(prev) : updater));
  }, []);

  return { data, error, loading, reload, setData };
}

/** Executa uma ação assíncrona impedindo cliques repetidos enquanto está em andamento. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const run = useCallback(async <R,>(fn: () => Promise<R>): Promise<R | undefined> => {
    if (running.current) return undefined;
    running.current = true;
    setBusy(true);
    try {
      return await fn();
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, run };
}
