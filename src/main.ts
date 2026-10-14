import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { existsSync } from "node:fs";
import path from "node:path";

const envFile = path.resolve(process.cwd(), ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

async function bootstrap() {
  const { validateConfig } = await import("./infrastructure/config.js");
  const { AllExceptionsFilter, log, requestContext, sameOriginGuard, securityHeaders } = await import("./infrastructure/http/http-hardening.js");
  const config = validateConfig();
  for (const w of config.warnings) log("warn", "config", { message: w });
  if (config.errors.length) {
    for (const e of config.errors) log("error", "config", { message: e });
    if (process.env.NODE_ENV === "production") { log("error", "Zorunlu ayarlar eksik; uygulama başlatılmadı"); process.exit(1); }
  }

  const { AppModule } = await import("./app.module.js");
  const app = await NestFactory.create(AppModule, { logger: ["error", "warn", "log"], rawBody: true });
  // Ters vekil arkasında gerçek istemci IP'si: TRUST_PROXY_HOPS (varsayılan 1 = Next.js vekili). Hız sınırları req.ip kullanır.
  app.getHttpAdapter().getInstance().set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? 1));
  app.getHttpAdapter().getInstance().disable("x-powered-by");
  app.use(requestContext, securityHeaders, sameOriginGuard);
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  await app.listen(Number(process.env.BACKEND_PORT || 3001), process.env.BACKEND_HOST || "127.0.0.1");
  log("info", "started", { port: Number(process.env.BACKEND_PORT || 3001), env: process.env.NODE_ENV || "development", features: config.features });
}

bootstrap();
