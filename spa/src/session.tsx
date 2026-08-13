import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from "react";
import { sb, rpc, configured } from "./supabase";

export type Profile = {
  signedIn: boolean;
  id?: string;
  email?: string;
  fullName?: string;
  department?: string | null;
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
};

const SessionCtx = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!configured) {
      setProfile({ signedIn: false });
      setLoading(false);
      return;
    }
    const { data } = await sb().auth.getSession();
    if (!data.session) {
      setProfile({ signedIn: false });
      setLoading(false);
      return;
    }
    // Role and permissions come from the database, never from the JWT, so a
    // tampered token cannot grant access that was not actually assigned.
    const p = await rpc<Profile>("rpc_my_profile");
    setProfile(p ?? { signedIn: false });
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    if (!configured) return;
    const { data: sub } = sb().auth.onAuthStateChange(() => void load());
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const signIn = useCallback<Ctx["signIn"]>(async (email, password) => {
    const { error } = await sb().auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) return { ok: false, error: "Invalid email or password." };
    await rpc("rpc_touch_login");
    await load();
    return { ok: true };
  }, [load]);

  const signOut = useCallback(async () => {
    await sb().auth.signOut();
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
    () => ({ profile, loading, configured, signIn, signOut, can }),
    [profile, loading, signIn, signOut, can]
  );

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession(): Ctx {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("useSession must be used inside <SessionProvider>");
  return c;
}
