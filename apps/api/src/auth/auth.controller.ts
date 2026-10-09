import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { randomBytes } from "node:crypto";
import { getAddress, isAddress, verifyMessage } from "viem";
import { parseSiweMessage, validateSiweMessage } from "viem/siwe";
import { z } from "zod";
import { ApiError } from "../common/errors.js";
import { PrismaService } from "../common/prisma.service.js";
import { REDIS, type RedisClient } from "../common/redis.js";
import { plain } from "../common/serialize.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { InvestorGuard, type AuthedRequest } from "./guards.js";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession } from "./session.js";

const NONCE_TTL_SECONDS = 300;
const verifyBody = z.object({ message: z.string().min(1).max(4000), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) });

@Controller("auth")
export class AuthController {
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(REDIS) private readonly redis: RedisClient,
    private readonly prisma: PrismaService,
  ) {}

  @Get("nonce")
  async nonce(@Query("address") address: string) {
    if (!address || !isAddress(address)) throw new ApiError(400, "VALIDATION_FAILED", "address is required");
    const nonce = randomBytes(16).toString("hex");
    await this.redis.set(`siwe:nonce:${nonce}`, address.toLowerCase(), "EX", NONCE_TTL_SECONDS);
    return { nonce, domain: this.cfg.siweDomain, chainId: this.cfg.chainId, expiresIn: NONCE_TTL_SECONDS };
  }

  @Post("verify")
  @HttpCode(200)
  async verify(@Body(new ZodPipe(verifyBody)) body: z.infer<typeof verifyBody>, @Res({ passthrough: true }) res: Response) {
    const msg = parseSiweMessage(body.message);
    if (!msg.address || !msg.nonce) throw new ApiError(401, "UNAUTHENTICATED", "malformed SIWE message");
    // Single use: delete the nonce whatever happens next.
    const owner = await this.redis.getdel(`siwe:nonce:${msg.nonce}`);
    if (!owner || owner !== msg.address.toLowerCase()) throw new ApiError(401, "UNAUTHENTICATED", "unknown or expired nonce");
    const valid =
      msg.chainId === this.cfg.chainId &&
      validateSiweMessage({ message: msg, domain: this.cfg.siweDomain, nonce: msg.nonce, time: new Date() }) &&
      (await verifyMessage({ address: msg.address, message: body.message, signature: body.signature as `0x${string}` }));
    if (!valid) throw new ApiError(401, "UNAUTHENTICATED", "signature, domain or chain does not match");

    const address = msg.address.toLowerCase();
    const wallet =
      (await this.prisma.wallet.findUnique({ where: { address } })) ??
      (await this.prisma.wallet.create({ data: { address, user: { create: {} } } }));
    const token = await signSession({ userId: wallet.userId, wallet: address }, this.cfg.sessionSecret);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: this.cfg.nodeEnv === "production",
      maxAge: SESSION_TTL_SECONDS * 1000,
      path: "/",
    });
    return { address: getAddress(address), userId: wallet.userId };
  }

  @Post("logout")
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE, { path: "/" });
  }

  @Get("me")
  @UseGuards(InvestorGuard)
  async me(@Req() req: AuthedRequest) {
    const { userId, wallet } = req.session!;
    const [wallets, eligibility, staff] = await Promise.all([
      this.prisma.wallet.findMany({ where: { userId } }),
      this.prisma.eligibility.findUnique({ where: { wallet } }),
      this.prisma.staffAccount.findUnique({ where: { userId } }),
    ]);
    return plain({
      userId,
      wallet: getAddress(wallet),
      wallets: wallets.map((w) => getAddress(w.address)),
      eligibility: eligibility ? { status: eligibility.status, expiresAt: eligibility.expiresAt } : { status: "NONE", expiresAt: null },
      isStaff: !!staff && !staff.disabledAt,
    });
  }
}
