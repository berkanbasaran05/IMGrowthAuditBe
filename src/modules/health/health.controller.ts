import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";

// Canlılık (/api/health): süreç ayakta mı ve veritabanı erişilebilir mi.
// Hazırlık (/api/health/ready): veritabanı bağlı ve migration'lar uygulanmış mı (yük dengeleyici / dağıtım kontrolü için).
@Controller("api/health")
export class HealthController {
  constructor(private readonly database: PrismaService) {}

  @Get()
  async health() {
    const database = await this.database.health();
    return { ok: database === "up", service: "im-growth-audit-be", database, uptimeSec: Math.round(process.uptime()) };
  }

  @Get("ready")
  async ready(@Res() res: Response) {
    try {
      const pending = await this.database.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
      const ok = (pending[0]?.n ?? 0) === 0;
      return res.status(ok ? 200 : 503).json({ ok, pendingMigrations: pending[0]?.n ?? 0 });
    } catch {
      return res.status(503).json({ ok: false, database: "down" });
    }
  }
}
