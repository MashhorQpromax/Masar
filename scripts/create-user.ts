// Adds a person who can sign in. The first admin is made this way; after that, admins add people in the app.
//
//   MASAR_DATABASE_URL=... npm run user:create -- --name "الاسم" --email someone@example.com --role admin
//
// The password is asked for on the terminal and is not echoed. Where there is no terminal, it is read
// from MASAR_NEW_PASSWORD. It is never printed, logged or stored as typed.
import { parseArgs } from "node:util";
import { ROLES } from "../src/domain/auth";
import { createUser } from "../src/server/auth/users";
import { connect, databaseUrl } from "../src/server/db/client";
import { SYSTEM } from "../src/server/shared/actor";
import { DomainError } from "../src/server/shared/errors";

function askHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) throw new Error("There is no terminal to ask on. Set MASAR_NEW_PASSWORD instead.");
  stdout.write(question);
  return new Promise((resolve) => {
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const typed = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", typed);
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") process.exit(130);
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", typed);
  });
}

const { values } = parseArgs({
  options: { name: { type: "string" }, email: { type: "string" }, role: { type: "string", default: "admin" }, phone: { type: "string" } },
});
if (!values.name || !values.email) {
  console.error(`Usage: npm run user:create -- --name "..." --email ... [--role ${ROLES.join("|")}] [--phone 05xxxxxxxx]`);
  process.exit(2);
}

async function readPassword(): Promise<string> {
  if (process.env.MASAR_NEW_PASSWORD) return process.env.MASAR_NEW_PASSWORD;
  const password = await askHidden("Password: ");
  if (password !== (await askHidden("Again: "))) throw new Error("The two passwords differ.");
  return password;
}

async function main(): Promise<number> {
  let password: string;
  try {
    password = await readPassword();
  } catch (error) {
    console.error(`${(error as Error).message} Nothing was created.`);
    return 1;
  }
  const connection = await connect(databaseUrl());
  try {
    const { id } = await createUser(connection.db, { name: values.name!, email: values.email!, role: values.role!, phone: values.phone, password, actor: SYSTEM });
    console.log(`created user #${id} (${values.role})`);
    return 0;
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    console.error(`Refused: ${error.code}${error.message !== error.code ? ` (${error.message})` : ""}`);
    return 1;
  } finally {
    await connection.close();
  }
}

process.exit(await main());
