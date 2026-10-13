import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { existsSync } from "node:fs";
import path from "node:path";

const envFile = path.resolve(process.cwd(), ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

async function bootstrap() {
  const { AppModule } = await import("./app.module.js");
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(Number(process.env.BACKEND_PORT || 3001), process.env.BACKEND_HOST || "127.0.0.1");
  console.log(`Backend http://localhost:${process.env.BACKEND_PORT || 3001}`);
}

bootstrap();
