import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.js";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL tanımlı değil");
    // Oturum saat dilimi UTC'ye sabitlenir: pg adaptörü zaman damgalarını saat dilimi eki olmadan gönderir;
    // sunucu saat dilimi (ör. Europe/Istanbul) farklıysa tüm yazılan zamanlar o kadar kayardı.
    super({ adapter: new PrismaPg({ connectionString, options: "-c TimeZone=UTC" }) });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async health(): Promise<"up" | "down"> {
    try {
      await this.$queryRaw`SELECT 1`;
      return "up";
    } catch {
      return "down";
    }
  }
}
