"use client";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, useSession } from "@roboshare/ui";

export type StaffRole = "OPERATOR" | "REVIEWER" | "COMPLIANCE" | "GOV_VIEW";

export interface AdminMe {
  wallet: `0x${string}`;
  roles: StaffRole[];
  stepUpUntil: string | null;
}

export const ROLE_LABEL: Record<StaffRole, string> = { OPERATOR: "运营", REVIEWER: "审核", COMPLIANCE: "合规", GOV_VIEW: "治理（只读，经 Safe 执行）" };

/** null = signed in but needs the authenticator step-up; ApiError 403 = not staff. */
export function useAdminMe() {
  const { me } = useSession();
  return useQuery({
    queryKey: ["admin", "me", me?.wallet],
    enabled: !!me,
    retry: false,
    queryFn: async () => {
      try {
        return await api.get<AdminMe>("/admin/me");
      } catch (e) {
        if (e instanceof ApiError && e.code === "STEP_UP_REQUIRED") return null;
        throw e;
      }
    },
  });
}

export function useRoles() {
  const me = useAdminMe();
  const roles = me.data?.roles ?? [];
  return { roles, can: (...r: StaffRole[]) => r.some((x) => roles.includes(x)) };
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return `${e.message}${e.code ? `（${e.code}）` : ""}`;
  return e instanceof Error ? e.message.split("\n")[0]! : String(e);
}
