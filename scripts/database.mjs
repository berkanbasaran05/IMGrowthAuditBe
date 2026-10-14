import { existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const action = process.argv[2];
const data = path.resolve(".postgres/data");
const log = path.resolve(".postgres/postgres.log");
const bin = execFileSync("pg_config", ["--bindir"], { encoding: "utf8" }).trim();
const pgCtl = path.join(bin, "pg_ctl");

if (!existsSync(path.join(data, "PG_VERSION"))) throw new Error("Yerel PostgreSQL kümesi bulunamadı. README içindeki kurulum adımlarını uygulayın.");
mkdirSync(path.dirname(log), { recursive: true });

if (action === "start") execFileSync(pgCtl, ["-D", data, "-l", log, "-o", "-p 55432 -h 127.0.0.1", "start"], { stdio: "inherit" });
else if (action === "stop") execFileSync(pgCtl, ["-D", data, "stop"], { stdio: "inherit" });
else if (action === "status") execFileSync(pgCtl, ["-D", data, "status"], { stdio: "inherit" });
else throw new Error("Kullanım: npm run db:start | db:stop | db:status");
