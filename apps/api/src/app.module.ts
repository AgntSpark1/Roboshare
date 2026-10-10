import { Module, type DynamicModule } from "@nestjs/common";
import { AdminController } from "./admin/admin.controller.js";
import { AuthController } from "./auth/auth.controller.js";
import { InvestorGuard, RoleGuard } from "./auth/guards.js";
import { PrismaService } from "./common/prisma.service.js";
import { createRedis, REDIS } from "./common/redis.js";
import { APP_CONFIG, type AppConfig } from "./config.js";
import { MeController } from "./me/me.controller.js";
import { PublicController } from "./public/public.controller.js";
import { KycWebhookController } from "./webhooks/kyc.controller.js";

@Module({})
export class AppModule {
  static forRoot(cfg: AppConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [AuthController, PublicController, MeController, AdminController, KycWebhookController],
      providers: [
        { provide: APP_CONFIG, useValue: cfg },
        { provide: REDIS, useFactory: () => createRedis(cfg.redisUrl) },
        PrismaService,
        InvestorGuard,
        RoleGuard,
      ],
    };
  }
}
