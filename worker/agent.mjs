// Snap Boy's side of the link: write what it read in Snapchat Web back to the Snap Queue API.
// Usage: node worker/agent.mjs sync <file.json> | drafts <contactId> <file.json>
//        | fail-sync "<reason>" | fail-drafts <contactId> "<reason>" | list
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const env = Object.fromEntries(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), ".env"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const API = env.SQ_API, TOKEN = env.SQ_AGENT_TOKEN;
if (!API || !TOKEN) { console.error("worker/.env needs SQ_API and SQ_AGENT_TOKEN"); process.exit(2); }

async function call(method, path, body) {
  const res = await fetch(API + path, { method, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) { console.error(`${res.status} ${text}`); process.exit(1); }
  return JSON.parse(text);
}
const [cmd, a, b] = process.argv.slice(2);
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));
let out;
if (cmd === "sync") out = await call("PUT", "/api/agent/sync", readJson(a));
else if (cmd === "drafts") out = await call("PUT", `/api/agent/drafts/${a}`, readJson(b));
else if (cmd === "fail-sync") out = await call("PUT", "/api/agent/sync", { ok: false, error: a || "failed" });
else if (cmd === "fail-drafts") out = await call("PUT", `/api/agent/drafts/${a}`, { ok: false, error: b || "failed" });
else if (cmd === "list") { const d = await call("GET", "/api/contacts"); out = { sync: d.sync, contacts: d.contacts.map((c) => ({ id: c.id, name: c.name, stage: c.stage, friend: c.friend || "", chat: c.chat.label })) }; }
else { console.error("usage: sync <file> | drafts <id> <file> | fail-sync <reason> | fail-drafts <id> <reason> | list"); process.exit(2); }
console.log(JSON.stringify(out, null, 2));
