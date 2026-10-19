import { onIdTokenChanged, signOut, type User } from "firebase/auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { MeResponse } from "@estudos/shared";
import { api, ApiError } from "../lib/api";
import { auth } from "../lib/firebase";

interface AuthState {
  user: User | null;
  me: MeResponse | null;
  /** true enquanto o Firebase restaura a sessão salva. */
  loading: boolean;
  error: string | null;
  refreshMe: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshMe = useCallback(async () => {
    try {
      setMe(await api.me());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível carregar seu perfil.");
      if (err instanceof ApiError && err.status === 401) await signOut(auth);
    }
  }, []);

  useEffect(
    () =>
      onIdTokenChanged(auth, async (u) => {
        setUser(u);
        if (u) await refreshMe();
        else setMe(null);
        setLoading(false);
      }),
    [refreshMe],
  );

  const logout = useCallback(async () => {
    await signOut(auth);
    setMe(null);
  }, []);

  const value = useMemo(() => ({ user, me, loading, error, refreshMe, logout }), [user, me, loading, error, refreshMe, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth fora do AuthProvider");
  return ctx;
}
