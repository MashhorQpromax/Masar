// على Vercel: يجهّز قاعدة بيانات العرض ومفتاح توقيع جلسات عشوائي لكل نشر (لا يُحفظ في المستودع).
import { execSync } from "node:child_process";
import fs from "node:fs";
import crypto from "node:crypto";

if (process.env.VERCEL) {
  execSync("node --experimental-strip-types scripts/seed.ts", { stdio: "inherit", env: { ...process.env, MASAR_DATA_DIR: "seed" } });
  if (!process.env.MASAR_SECRET) fs.writeFileSync("seed/.secret", crypto.randomBytes(48).toString("base64url"), { mode: 0o600 });
}
