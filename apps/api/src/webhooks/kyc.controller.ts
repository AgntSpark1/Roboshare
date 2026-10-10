import { Controller, Headers, HttpCode, Inject, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { isAddress, keccak256, toHex } from "viem";
import { z } from "zod";
import { ApiError } from "../common/errors.js";
import { PrismaService } from "../common/prisma.service.js";
import { REDIS, type RedisClient } from "../common/redis.js";
import { APP_CONFIG, type AppConfig } from "../config.js";

const TOLERANCE_SECONDS = 300;

/**
 * KYC provider webhook. The provider is not chosen yet (PHASE1_ANALYSIS D-11), so only the
 * TEST-ONLY "mock" provider is accepted, and never in production.
 */
const mockPayload = z.object({
  eventId: z.string().min(1).max(128),
  caseRef: z.string().min(1).max(128),
  wallet: z.string().refine((v) => isAddress(v)),
  status: z.enum(["APPROVED", "REJECTED", "PENDING"]),
});

@Controller("webhooks/kyc")
export class KycWebhookController {
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(REDIS) private readonly redis: RedisClient,
    private readonly prisma: PrismaService,
  ) {}

  @Post(":provider")
  @HttpCode(202)
  async receive(
    @Param("provider") provider: string,
    @Headers("x-signature") signature: string | undefined,
    @Headers("x-timestamp") timestamp: string | undefined,
    @Req() req: Request & { rawBody?: Buffer },
  ) {
    if (provider !== "mock" || this.cfg.nodeEnv === "production") throw new ApiError(404, "NOT_FOUND", "unknown provider");
    const secret = this.cfg.kycWebhookSecret;
    if (!secret) throw new ApiError(503, "CHAIN_UNAVAILABLE", "webhook secret not configured");
    const raw = req.rawBody;
    if (!raw || !signature || !timestamp) throw new ApiError(401, "UNAUTHENTICATED", "missing signature");

    const ts = Number(timestamp);
    if (!Number.isInteger(ts) || Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) {
      throw new ApiError(401, "UNAUTHENTICATED", "timestamp outside tolerance");
    }
    const expected = createHmac("sha256", secret).update(`${timestamp}.`).update(raw).digest();
    const given = Buffer.from(signature.replace(/^sha256=/, ""), "hex");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new ApiError(401, "UNAUTHENTICATED", "bad signature");
    }

    const body = mockPayload.parse(JSON.parse(raw.toString("utf8")));
    const fresh = await this.redis.set(`kyc:replay:${provider}:${body.eventId}`, "1", "EX", TOLERANCE_SECONDS * 2, "NX");
    if (fresh !== "OK") throw new ApiError(409, "CONFLICT", "duplicate event");

    // Store codes and a payload hash only; personal data stays with the provider.
    await this.prisma.complianceCase.upsert({
      where: { provider_providerRef: { provider, providerRef: body.caseRef } },
      create: { provider, providerRef: body.caseRef, wallet: body.wallet.toLowerCase(), status: body.status, payloadHash: keccak256(toHex(raw)), decidedAt: body.status === "PENDING" ? null : new Date() },
      update: { status: body.status, payloadHash: keccak256(toHex(raw)), decidedAt: body.status === "PENDING" ? null : new Date() },
    });
    return { accepted: true };
  }
}
