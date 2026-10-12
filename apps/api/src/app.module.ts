import { Module, type DynamicModule, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { AdminController } from "./admin/admin.controller.js";
import { GovernanceController } from "./admin/governance.controller.js";
import { OpsController } from "./admin/ops.controller.js";
import { AuthController } from "./auth/auth.controller.js";
import { InvestorGuard, RoleGuard } from "./auth/guards.js";
import { IdempotencyInterceptor } from "./common/idempotency.js";
import { PrismaService } from "./common/prisma.service.js";
import { RateLimitMiddleware } from "./common/rate-limit.js";
import { createRedis, REDIS } from "./common/redis.js";
import { APP_CONFIG, type AppConfig } from "./config.js";
import { MeController } from "./me/me.controller.js";
import { TxController } from "./me/tx.controller.js";
import { PublicController } from "./public/public.controller.js";
import { AdminReferralController, MeReferralController } from "./referral/referral.controller.js";
import { KycWebhookController } from "./webhooks/kyc.controller.js";

@Module({})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RateLimitMiddleware)
      .forRoutes(AuthController, PublicController, MeController, TxController, AdminController, GovernanceController, OpsController, KycWebhookController, MeReferralController, AdminReferralController);
  }

  static forRoot(cfg: AppConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [AuthController, PublicController, MeController, TxController, AdminController, GovernanceController, OpsController, KycWebhookController, MeReferralController, AdminReferralController],
      providers: [
        { provide: APP_CONFIG, useValue: cfg },
        { provide: REDIS, useFactory: () => createRedis(cfg.redisUrl) },
        PrismaService,
        InvestorGuard,
        RoleGuard,
        IdempotencyInterceptor,
      ],
    };
  }
}
