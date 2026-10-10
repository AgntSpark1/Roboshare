import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { InvestorGuard, type AuthedRequest } from "../auth/guards.js";
import { PrismaService } from "../common/prisma.service.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { APP_CONFIG, type AppConfig } from "../config.js";

const body = z.object({
  hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  purpose: z.enum(["APPROVE", "SUBSCRIBE", "REFUND", "CLAIM", "TRANSFER", "REVOKE_APPROVAL", "REFERRAL_CLAIM"]),
});

/** The UI registers a hash it just submitted so it can show "pending" until the indexer confirms it. */
@Controller("tx")
@UseGuards(InvestorGuard)
export class TxController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Post("pending")
  @HttpCode(202)
  async pending(@Req() req: AuthedRequest, @Body(new ZodPipe(body)) b: z.infer<typeof body>) {
    await this.prisma.pendingTx.upsert({
      where: { chainId_hash: { chainId: this.cfg.chainId, hash: b.hash.toLowerCase() } },
      create: { userId: req.session!.userId, chainId: this.cfg.chainId, hash: b.hash.toLowerCase(), purpose: b.purpose },
      update: {},
    });
    return { accepted: true };
  }
}
