"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { supabase, rpc, isConfigured } from "./supabase";

export type Profile = {
  signedIn: boolean;
  id?: string;
  email?: string;
  fullName?: string;
  employeeNo?: string | null;
  department?: string | null;
  plantId?: number | null;
  roleCode?: string;
  roleName?: string;
  permissions?: string[];
  lastLoginAt?: string | null;
};

type Ctx = {
  profile: Profile | null;
  loading: boolean;
  configured: boolean;
  signIn: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
  can: (permission: string) => boolean;
  refresh: () => Promise<void>;
};

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const configured = isConfigured();

  const load = useCallback(async () => {
    if (!configured) {
      setProfile({ signedIn: false });
      setLoading(false);
      return;
    }
    const { data } = await supabase().auth.getSession();
    if (!data.session) {
      setProfile({ signedIn: false });
      setLoading(false);
      return;
    }
    // The profile (role + permissions) comes from the database, never from the
    // JWT, so a tampered token cannot grant access it wasn't given.
    const p = await rpc<Profile>("rpc_my_profile");
    setProfile(p ?? { signedIn: false });
    setLoading(false);
  }, [configured]);

  useEffect(() => {
    void load();
    if (!configured) return;
    const { data: sub } = supabase().auth.onAuthStateChange(() => {
      void load();
    });
    return () => sub.subscription.unsubscribe();
  }, [load, configured]);

  const signIn = useCallback<Ctx["signIn"]>(async (email, password) => {
    const { error } = await supabase().auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) {
      // Supabase already rate-limits sign-in attempts per IP at the edge.
      return { ok: false, error: "Invalid email or password." };
    }
    await rpc("rpc_touch_login");
    await load();
    return { ok: true };
  }, [load]);

  const signOut = useCallback(async () => {
    await supabase().auth.signOut();
    setProfile({ signedIn: false });
  }, []);

  const can = useCallback(
    (permission: string) => {
      if (!profile?.signedIn) return false;
      if (profile.roleCode === "admin") return true;
      return (profile.permissions ?? []).includes(permission);
    },
    [profile]
  );

  const value = useMemo(
    () => ({ profile, loading, configured, signIn, signOut, can, refresh: load }),
    [profile, loading, configured, signIn, signOut, can, load]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Ctx {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}
