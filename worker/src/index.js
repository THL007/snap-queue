// Snap Queue API — Cloudflare Worker bound to an R2 bucket (strongly consistent, one JSON doc).
// The app reads every chat and its contact status. Snapchat has no chat API, so the link to Snapchat
// is an agent: "Sync" and "Get drafts" fire a signed webhook to an OpenBot routine, Snap Boy reads
// Snapchat Web (read-only) and writes the result back through /api/agent/*. Nothing here sends a Snap.
// Auth: `Authorization: Bearer <app token>` (the user) or `Bearer <agent token>` (Snap Boy, claimed once via /api/agent/claim).

const JSON_HEADERS = { "content-type": "application/json" };
const STAGES = ["new", "opened", "replied", "rapport", "number", "date-planned", "date-done", "paused", "stopped"];
const CHAT_KINDS = ["chat", "snap", "call", "story", ""];
const CHAT_STATES = ["new", "received", "opened", "delivered", "sent", "screenshot", "replayed", "typing", ""];
const FRIEND = ["mutual", "pending", "added-me", ""];
const DOC = "data/contacts.json";

function cors(env, res) {
  const h = new Headers(res.headers);
  h.set("access-control-allow-origin", env.ALLOWED_ORIGIN || "*");
  h.set("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  h.set("access-control-allow-headers", "authorization,content-type");
  h.set("vary", "origin");
  return new Response(res.body, { status: res.status, headers: h });
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
const err = (message, status = 400) => json({ error: message }, status);
const str = (v, n) => (v == null ? "" : String(v)).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const pick = (v, list, d) => (list.includes(v) ? v : d);
const nowIso = () => new Date().toISOString();

// ---- config: the app token and the webhook secret live in the bucket (set once from the app)
let CONFIG = null;
async function loadConfig(env) {
  if (CONFIG && CONFIG.at > Date.now() - 30000) return CONFIG;
  const obj = await env.BUCKET.get("config/secrets.json");
  const stored = obj ? await obj.json() : {};
  CONFIG = { appToken: stored.appToken || "", agentToken: stored.agentToken || env.AGENT_TOKEN || "", webhookSecret: stored.webhookSecret || env.WEBHOOK_SECRET || "", at: Date.now() };
  return CONFIG;
}
async function saveConfig(env, cfg) {
  await env.BUCKET.put("config/secrets.json", JSON.stringify({ appToken: cfg.appToken, agentToken: cfg.agentToken, webhookSecret: cfg.webhookSecret }), { httpMetadata: { contentType: "application/json" } });
  CONFIG = null;
}
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function who(auth, env, cfg) {
  if (cfg.appToken && safeEqual(auth, `Bearer ${cfg.appToken}`)) return "user";
  if (cfg.agentToken && safeEqual(auth, `Bearer ${cfg.agentToken}`)) return "agent";
  return null;
}
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- the document
async function readDoc(env) {
  const obj = await env.BUCKET.get(DOC);
  const d = obj ? await obj.json() : {};
  return { contacts: Array.isArray(d.contacts) ? d.contacts : [], sync: d.sync || { state: "never" } };
}
async function writeDoc(env, doc) {
  await env.BUCKET.put(DOC, JSON.stringify(doc), { httpMetadata: { contentType: "application/json" } });
  return doc;
}
const norm = (s) => str(s, 80).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
function newContact(name, source) {
  const t = nowIso();
  return {
    id: crypto.randomUUID().slice(0, 12), name: str(name, 80), username: "", stage: "new", source,
    chat: { who: "", kind: "", state: "", label: "", ago: "" }, unread: false, streak: null, lastAt: null,
    note: "", nextStep: "", pinned: false, friend: "", addedBackAt: null, friendCheckedAt: null, messages: [], msgs: { state: "none", at: null, error: "" }, drafts: { state: "none", items: [], read: "", at: null, goal: "" },
    history: [{ at: t, text: source === "sync" ? "Found in Snapchat" : "Added by hand" }], createdAt: t, updatedAt: t,
  };
}
function addHistory(c, text) {
  c.history = [{ at: nowIso(), text: str(text, 200) }, ...(c.history || [])].slice(0, 40);
}

// ---- webhook to the OpenBot routine
async function fireEvent(env, type, data, id) {
  const cfg = await loadConfig(env);
  if (!env.WEBHOOK_URL || !cfg.webhookSecret) return { sent: false, reason: "webhook not configured" };
  const body = JSON.stringify({ type, occurredAt: nowIso(), data });
  const ts = Math.floor(Date.now() / 1000).toString();
  const delivery = `${id}-${ts}`;
  const sig = await hmacHex(cfg.webhookSecret, `${ts}.${delivery}.${body}`);
  const res = await fetch(env.WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-openbot-timestamp": ts, "x-openbot-delivery-id": delivery, "x-openbot-signature": `sha256=${sig}` },
    body,
  });
  return { sent: res.status === 202 || res.status === 200, status: res.status };
}

// ---- merging what Snap Boy read from the Snapchat Web chat list
function cleanChat(c) {
  c = c && typeof c === "object" ? c : {};
  return {
    who: pick(c.who, ["them", "me", ""], ""),
    kind: pick(c.kind, CHAT_KINDS, ""),
    state: pick(c.state, CHAT_STATES, ""),
    label: str(c.label, 60),
    ago: str(c.ago, 20),
  };
}
// friend status: mutual = you're friends both ways, pending = you added them and they haven't added you back,
// added-me = they added you and you haven't added them back. pending -> mutual stamps addedBackAt.
function setFriend(c, next, source) {
  if (!FRIEND.includes(next) || next === "" || next === (c.friend || "")) return false;
  const prev = c.friend || "";
  c.friend = next;
  if (next === "mutual" && prev === "pending") { c.addedBackAt = nowIso(); addHistory(c, "Added you back"); }
  else if (next === "mutual") addHistory(c, source === "user" ? "Friend status: friends" : "Friends both ways");
  else if (next === "pending") addHistory(c, "Pending: hasn't added you back");
  else if (next === "added-me") addHistory(c, "Added you");
  return true;
}
// messages Snap Boy read in Snapchat Web: oldest first, the last 40 kept. Snaps are never opened, so a snap has no text.
const MSG_KINDS = ["chat", "snap", "call", "media", "sticker", "voice", ""];
function cleanMessages(list) {
  return (Array.isArray(list) ? list : []).slice(-40).map((x) => {
    x = x && typeof x === "object" ? x : {};
    const at = x.at && !Number.isNaN(Date.parse(x.at)) ? new Date(x.at).toISOString() : null;
    return { from: pick(x.from, ["them", "me"], "them"), kind: pick(x.kind, MSG_KINDS, "chat"), text: str(x.text, 1000), at, atText: str(x.atText, 30) };
  }).filter((x) => x.text || x.kind !== "chat");
}
function setMessages(c, list) {
  const msgs = cleanMessages(list);
  if (!msgs.length) return false;
  c.messages = msgs;
  c.msgs = { state: "ready", at: nowIso(), error: "" };
  return true;
}
function mergeSync(doc, rows) {
  const byName = new Map(doc.contacts.map((c) => [norm(c.name), c]));
  let added = 0, changed = 0;
  const addedBack = [];
  let read = 0;
  for (const r of rows.slice(0, 300)) {
    const name = str(r && r.name, 80);
    if (!name) continue;
    let c = byName.get(norm(name));
    if (!c) { c = newContact(name, "sync"); doc.contacts.push(c); byName.set(norm(name), c); added++; }
    const chat = cleanChat(r.chat);
    const before = `${c.chat.who}|${c.chat.kind}|${c.chat.state}|${c.chat.label}`;
    const after = `${chat.who}|${chat.kind}|${chat.state}|${chat.label}`;
    if (before !== after) {
      changed++;
      if (chat.label) addHistory(c, `${chat.label}${chat.ago ? ` (${chat.ago})` : ""}`);
      // a reply from them moves an opener forward
      if (chat.who === "them" && c.stage === "opened") { c.stage = "replied"; addHistory(c, "Stage: replied"); }
    }
    c.chat = chat;
    c.unread = Boolean(r.unread);
    c.streak = Number.isFinite(Number(r.streak)) && r.streak !== null && r.streak !== "" ? Math.max(0, Math.min(9999, Math.round(Number(r.streak)))) : null;
    if (r.lastAt && !Number.isNaN(Date.parse(r.lastAt))) c.lastAt = new Date(r.lastAt).toISOString();
    if (r.username) c.username = str(r.username, 40);
    if (r.messages && setMessages(c, r.messages)) read++;
    if (r.friend !== undefined) {
      const was = c.friend || "";
      if (setFriend(c, r.friend, "sync")) { changed++; if (was === "pending" && c.friend === "mutual") addedBack.push(c.name); }
      if (FRIEND.includes(r.friend) && r.friend) c.friendCheckedAt = nowIso();
    }
    c.updatedAt = nowIso();
  }
  return { added, changed, addedBack, read };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return cors(env, new Response(null, { status: 204 }));
    try {
      return cors(env, await route(request, env));
    } catch (e) {
      return cors(env, err(e && e.message ? e.message : "server error", 500));
    }
  },
};

async function route(request, env) {
  const url = new URL(request.url);
  const p = url.pathname.replace(/\/+$/, "") || "/";
  const m = request.method;
  const cfg = await loadConfig(env);

  if (p === "/" ) return json({ name: "snap-queue-api", ok: true });
  if (p === "/api/status" && m === "GET") {
    return json({ ready: true, appTokenSet: Boolean(cfg.appToken), webhook: Boolean(env.WEBHOOK_URL && cfg.webhookSecret), agent: Boolean(cfg.agentToken) });
  }

  const auth = request.headers.get("authorization") || "";

  // one-time claim of the agent token, right after the first deploy; closed once set
  if (p === "/api/agent/claim" && m === "POST") {
    if (cfg.agentToken) return err("agent token already set", 409);
    const t = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (t.length < 32 || t.length > 200) return err("token needs 32+ characters");
    await saveConfig(env, { ...cfg, agentToken: t });
    return json({ ok: true });
  }
  const role = who(auth, env, cfg);

  if (p === "/api/setup" && m === "POST") {
    const body = await request.json().catch(() => ({}));
    if (cfg.appToken && role !== "user") return err("unauthorized", 401);
    const next = { ...cfg };
    if (body.appToken !== undefined) {
      const t = String(body.appToken);
      if (t.length < 12 || t.length > 200) return err("token needs 12 to 200 characters");
      next.appToken = t;
    }
    if (body.webhookSecret !== undefined) next.webhookSecret = String(body.webhookSecret).slice(0, 400);
    if (!next.appToken) return err("choose an access token first");
    await saveConfig(env, next);
    return json({ ok: true, webhook: Boolean(env.WEBHOOK_URL && next.webhookSecret) });
  }

  if (!role) return err("unauthorized", 401);

  // ---- user + agent: read everything
  if (p === "/api/contacts" && m === "GET") return json(await readDoc(env));

  // ---- agent endpoints
  if (p === "/api/agent/sync" && (m === "PUT" || m === "POST")) {
    if (role !== "agent") return err("agent only", 403);
    const body = await request.json().catch(() => ({}));
    const doc = await readDoc(env);
    if (body.ok === false) {
      doc.sync = { ...doc.sync, state: "failed", error: str(body.error, 300), finishedAt: nowIso() };
      await writeDoc(env, doc);
      return json({ ok: true, sync: doc.sync });
    }
    if (!Array.isArray(body.contacts)) return err("contacts array required");
    const r = mergeSync(doc, body.contacts);
    doc.sync = { state: "done", requestedAt: doc.sync.requestedAt || null, finishedAt: nowIso(), seen: body.contacts.length, added: r.added, changed: r.changed, addedBack: r.addedBack, read: r.read, readNew: Boolean(doc.sync.readNew), error: "" };
    await writeDoc(env, doc);
    return json({ ok: true, sync: doc.sync });
  }
  const ad = p.match(/^\/api\/agent\/drafts\/([A-Za-z0-9-]{4,40})$/);
  if (ad && (m === "PUT" || m === "POST")) {
    if (role !== "agent") return err("agent only", 403);
    const body = await request.json().catch(() => ({}));
    const doc = await readDoc(env);
    const c = doc.contacts.find((x) => x.id === ad[1]);
    if (!c) return err("not found", 404);
    if (body.ok === false) {
      c.drafts = { ...c.drafts, state: "failed", read: str(body.error, 300), at: nowIso() };
    } else {
      const items = (Array.isArray(body.drafts) ? body.drafts : []).slice(0, 3).map((d) => ({ text: str(d && d.text, 400), angle: str(d && d.angle, 30), pick: Boolean(d && d.pick) })).filter((d) => d.text);
      if (!items.length) return err("drafts array with text required");
      c.drafts = { ...c.drafts, state: "ready", items, read: str(body.read, 300), at: nowIso() };
      addHistory(c, "Snap Boy drafted replies");
      if (body.chat) c.chat = cleanChat(body.chat);
      if (body.messages) setMessages(c, body.messages);
    }
    c.updatedAt = nowIso();
    await writeDoc(env, doc);
    return json({ ok: true, contact: c });
  }
  const am = p.match(/^\/api\/agent\/messages\/([A-Za-z0-9-]{4,40})$/);
  if (am && (m === "PUT" || m === "POST")) {
    if (role !== "agent") return err("agent only", 403);
    const body = await request.json().catch(() => ({}));
    const doc = await readDoc(env);
    const c = doc.contacts.find((x) => x.id === am[1]);
    if (!c) return err("not found", 404);
    if (body.ok === false) c.msgs = { state: "failed", at: nowIso(), error: str(body.error, 300) };
    else {
      if (!setMessages(c, body.messages)) return err("messages array required");
      if (body.chat) c.chat = cleanChat(body.chat);
      if (body.unread !== undefined) c.unread = Boolean(body.unread);
    }
    c.updatedAt = nowIso();
    await writeDoc(env, doc);
    return json({ ok: true, contact: c });
  }

  // ---- user endpoints
  if (role !== "user") return err("user only", 403);

  if (p === "/api/sync" && m === "POST") {
    const doc = await readDoc(env);
    const body = await request.json().catch(() => ({}));
    const readNew = body.readNew !== false;
    const id = crypto.randomUUID().slice(0, 8);
    const r = await fireEvent(env, "snap.sync.requested", { syncId: id, readNew, known: doc.contacts.map((c) => c.name) }, `sync-${id}`);
    doc.sync = { ...doc.sync, readNew, state: r.sent ? "requested" : "failed", requestedAt: nowIso(), error: r.sent ? "" : `webhook ${r.reason || r.status}` };
    await writeDoc(env, doc);
    return json({ ok: r.sent, sync: doc.sync }, r.sent ? 200 : 502);
  }

  if (p === "/api/contacts" && m === "POST") {
    const body = await request.json().catch(() => ({}));
    const name = str(body.name, 80);
    if (!name) return err("name required");
    const doc = await readDoc(env);
    if (doc.contacts.some((c) => norm(c.name) === norm(name))) return err("that name is already in the queue", 409);
    const c = newContact(name, "manual");
    c.stage = pick(body.stage, STAGES, "opened");
    doc.contacts.push(c);
    await writeDoc(env, doc);
    return json({ contact: c }, 201);
  }

  if (p === "/api/contacts/restore" && m === "POST") {
    const body = await request.json().catch(() => ({}));
    const c = body && body.contact;
    if (!c || typeof c.id !== "string" || !str(c.name, 80)) return err("contact required");
    const doc = await readDoc(env);
    if (!doc.contacts.some((x) => x.id === c.id)) doc.contacts.push(c);
    await writeDoc(env, doc);
    return json({ ok: true });
  }
  const cm = p.match(/^\/api\/contacts\/([A-Za-z0-9-]{4,40})(\/drafts|\/messages)?$/);
  if (cm) {
    const doc = await readDoc(env);
    const i = doc.contacts.findIndex((x) => x.id === cm[1]);
    if (i < 0) return err("not found", 404);
    const c = doc.contacts[i];
    if (cm[2] === "/messages" && m === "POST") {
      const r = await fireEvent(env, "snap.messages.requested", { contactId: c.id, name: c.name }, `messages-${c.id}`);
      c.msgs = { state: r.sent ? "requested" : "failed", at: nowIso(), error: r.sent ? "" : `webhook ${r.reason || r.status}` };
      c.updatedAt = nowIso();
      await writeDoc(env, doc);
      return json({ ok: r.sent, contact: c }, r.sent ? 200 : 502);
    }
    if (cm[2] === "/drafts" && m === "POST") {
      if (c.stage === "stopped") return err("stopped: no drafts after clear disinterest", 409);
      const body = await request.json().catch(() => ({}));
      const goal = str(body.goal, 200);
      const r = await fireEvent(env, "snap.drafts.requested", { contactId: c.id, name: c.name, stage: c.stage, goal, note: c.note, nextStep: c.nextStep }, `drafts-${c.id}`);
      c.drafts = { state: r.sent ? "requested" : "failed", items: c.drafts?.items || [], read: r.sent ? "" : `webhook ${r.reason || r.status}`, at: nowIso(), goal };
      c.updatedAt = nowIso();
      await writeDoc(env, doc);
      return json({ ok: r.sent, contact: c }, r.sent ? 200 : 502);
    }
    if (!cm[2] && m === "PATCH") {
      const body = await request.json().catch(() => ({}));
      if (body.stage !== undefined && STAGES.includes(body.stage) && body.stage !== c.stage) { c.stage = body.stage; addHistory(c, `Stage: ${body.stage}`); }
      if (body.note !== undefined) c.note = str(body.note, 1000);
      if (body.nextStep !== undefined) c.nextStep = str(body.nextStep, 200);
      if (body.pinned !== undefined) c.pinned = Boolean(body.pinned);
      if (body.friend !== undefined) setFriend(c, body.friend, "user");
      if (body.name !== undefined && str(body.name, 80)) c.name = str(body.name, 80);
      c.updatedAt = nowIso();
      await writeDoc(env, doc);
      return json({ contact: c });
    }
    if (!cm[2] && m === "DELETE") {
      doc.contacts.splice(i, 1);
      await writeDoc(env, doc);
      return json({ ok: true, removed: c });
    }
  }
  return err("not found", 404);
}
