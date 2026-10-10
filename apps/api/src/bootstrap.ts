import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module.js";
import { ErrorFilter } from "./common/errors.js";
import type { AppConfig } from "./config.js";

export async function createApp(cfg: AppConfig) {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(cfg), {
    rawBody: true, // webhook HMAC is computed over the exact bytes received
    logger: cfg.nodeEnv === "test" ? false : ["error", "warn", "log"],
  });
  app.setGlobalPrefix("api/v1");
  app.use(cookieParser());
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  return app;
}
