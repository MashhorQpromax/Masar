// على Vercel: إن لم تُربط قاعدة PostgreSQL، تُجهّز قاعدة SQLite مؤقتة نظيفة (بلا عملاء) حتى لا يفشل البناء.
// مفتاح توقيع الجلسات: MASAR_SECRET من متغيرات البيئة، وإلا يُولّد عشوائياً لكل نشر (لا يُحفظ في المستودع).
import { execSync } from "node:child_process";
import fs from "node:fs";
import crypto from "node:crypto";

if (process.env.VERCEL) {
  const hasPg = !!(process.env.DATABASE_URL || process.env.POSTGRES_URL);
  if (!hasPg) execSync("node --experimental-strip-types scripts/seed.ts", { stdio: "inherit", env: { ...process.env, MASAR_DATA_DIR: "seed" } });
  else fs.mkdirSync("seed", { recursive: true });
  if (!process.env.MASAR_SECRET) fs.writeFileSync("seed/.secret", crypto.randomBytes(48).toString("base64url"), { mode: 0o600 });
}
