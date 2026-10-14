import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool, QueryResult, QueryResultRow } from "pg";

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool | null;

  constructor() {
    this.pool = process.env.DATABASE_URL
      ? new Pool({ connectionString: process.env.DATABASE_URL, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 })
      : null;
  }

  query<T extends QueryResultRow = any>(text: string, values: unknown[] = []): Promise<QueryResult<T>> {
    if (!this.pool) throw new Error("DATABASE_URL tanımlı değil");
    return this.pool.query<T>(text, values);
  }

  async health(): Promise<"up" | "down" | "not_configured"> {
    if (!this.pool) return "not_configured";
    try { await this.pool.query("SELECT 1"); return "up"; }
    catch { return "down"; }
  }

  async onModuleDestroy() { await this.pool?.end(); }
}
