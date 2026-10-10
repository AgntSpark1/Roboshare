import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { keccak256, stringToHex } from "viem";
import { ApiError } from "../common/errors.js";
import { PrismaService } from "../common/prisma.service.js";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { SESSION_COOKIE, verifySession, type Session } from "./session.js";

export type StaffRole = "OPERATOR" | "REVIEWER" | "COMPLIANCE" | "GOV_VIEW";

/** On-chain role each staff role must also hold (GOV_VIEW is read-only; governance acts via the Safe). */
const ONCHAIN_ROLE: Record<StaffRole, `0x${string}` | null> = {
  OPERATOR: keccak256(stringToHex("OPERATOR_ROLE")),
  REVIEWER: keccak256(stringToHex("REVIEWER_ROLE")),
  COMPLIANCE: keccak256(stringToHex("COMPLIANCE_AGENT_ROLE")),
  GOV_VIEW: null,
};

export const ROLES_KEY = "roboshare:roles";
export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES_KEY, roles);

export type AuthedRequest = Request & { session?: Session; staffRoles?: StaffRole[] };

@Injectable()
export class InvestorGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = req.cookies?.[SESSION_COOKIE];
    const session = token ? await verifySession(token, this.cfg.sessionSecret) : null;
    if (!session) throw new ApiError(401, "UNAUTHENTICATED", "sign in with your wallet first");
    req.session = session;
    return true;
  }
}

/**
 * Admin routes: a valid session, a staff account holding one of the listed roles, and the wallet
 * must currently hold the matching role on-chain (from indexed RoleGranted/RoleRevoked).
 */
@Injectable()
export class RoleGuard implements CanActivate {
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    await new InvestorGuard(this.cfg).canActivate(ctx);
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const required = this.reflector.getAllAndOverride<StaffRole[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]) ?? [];
    const staff = await this.prisma.staffAccount.findUnique({ where: { userId: req.session!.userId } });
    if (!staff || staff.disabledAt) throw new ApiError(403, "FORBIDDEN", "not a staff account");
    const held: StaffRole[] = [];
    for (const role of staff.roles as StaffRole[]) {
      const onchain = ONCHAIN_ROLE[role];
      if (onchain === undefined) continue;
      if (onchain === null) {
        held.push(role);
        continue;
      }
      const grant = await this.prisma.roleGrant.findFirst({
        where: { chainId: this.cfg.chainId, role: onchain, account: req.session!.wallet, active: true },
      });
      if (grant) held.push(role);
    }
    if (required.length > 0 && !required.some((r) => held.includes(r))) {
      throw new ApiError(403, "FORBIDDEN", `requires one of ${required.join(", ")} (off-chain and on-chain)`);
    }
    req.staffRoles = held;
    return true;
  }
}
