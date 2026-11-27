import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { areaOf, AUDIT_ACTIONS, AUDIT_AREA_NAMES, AUDIT_AREAS, isAuditArea, isWatched, WATCHED_ACTIONS } from "@/domain/audit";

describe("the kinds of event the audit log holds", () => {
  it("puts every event in one part of the office", () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
    for (const action of AUDIT_ACTIONS) {
      const area = areaOf(action);
      expect(area, action).not.toBeNull();
      expect(AUDIT_AREAS[area!] as readonly string[]).toContain(action);
    }
    expect(AUDIT_AREA_NAMES).toEqual(["signin", "users", "clients", "deals", "papers", "messages", "lenders"]);
  });

  it("knows a part of the office from any other text", () => {
    expect(isAuditArea("papers")).toBe(true);
    expect(isAuditArea("toString")).toBe(false);
    expect(isAuditArea("")).toBe(false);
    expect(isAuditArea(undefined)).toBe(false);
    expect(areaOf("deal.stage")).toBe("deals");
    expect(areaOf("login_failed")).toBe("signin");
    expect(areaOf("something.new")).toBeNull();
  });

  it("marks what is worth a second look", () => {
    // A way in that failed, a private file that was opened, and every change to who may enter.
    expect(isWatched("login_failed")).toBe(true);
    expect(isWatched("doc.open")).toBe(true);
    for (const action of ["user.create", "user.update", "user.password_reset", "user.signin_reset", "user.unlock"]) expect(isWatched(action), action).toBe(true);
    // The everyday work of the office is not.
    for (const action of ["login", "logout", "deal.save", "deal.stage", "doc.upload", "wa.send", "client.note", "user.password"]) expect(isWatched(action), action).toBe(false);
    for (const action of WATCHED_ACTIONS) expect(AUDIT_ACTIONS).toContain(action);
  });
});

/** Every TypeScript file under a folder. */
function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("what the server writes to the audit log", () => {
  // The two ways an event is written: `audit(tx, actor, "x.y", …)` by a service, and `note(tx, origin, now, "x", …)` at the door.
  const written = sources(join(process.cwd(), "src/server"))
    .filter((path) => !path.includes("/demo/"))
    .flatMap((path) => {
      const text = readFileSync(path, "utf8");
      const byService = [...text.matchAll(/\baudit\(\s*\w+,\s*[\w.]+,\s*"([^"]+)"/g)];
      const atTheDoor = [...text.matchAll(/\bnote\(\s*\w+,\s*[\w.]+,\s*\w+,\s*"([^"]+)"/g)];
      return [...byService, ...atTheDoor].map((match) => ({ action: match[1]!, path: path.slice(process.cwd().length + 1) }));
    });

  it("finds the events in the source", () => {
    expect(written.length).toBeGreaterThan(35);
  });

  it("writes no event the list does not know", () => {
    const unknown = written.filter((event) => !(AUDIT_ACTIONS as readonly string[]).includes(event.action));
    expect(unknown).toEqual([]);
  });

  it("lists no event that nothing writes", () => {
    const actions = new Set(written.map((event) => event.action));
    expect(AUDIT_ACTIONS.filter((action) => !actions.has(action))).toEqual([]);
  });
});
