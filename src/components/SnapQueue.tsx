"use dom";

import "../styles/app.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ago, api, ApiError, chatTone, Contact, Doc, getSettings, Lane, LANES, laneOf, saveSettings, Settings, sortQueue, Stage, STAGES, stageLabel, Status,
} from "../lib/api";
import { FRIENDS, Friend, FriendFilter, friendMatch, isNewAddBack, lastMessage, Message, messageText } from "../lib/api";
import { demoDoc } from "../lib/demo";
import { Icon, IconName } from "./Icon";

const LANE_ICON: Record<Lane, IconName> = { yours: "reply", waiting: "hourglass", plans: "calendar", parked: "pause", all: "list" };

type Props = { dom?: import("expo/dom").DOMProps };

// ---- URL state (lane, open contact, demo)
function readUrl() {
  if (typeof window === "undefined") return { lane: "yours" as Lane, open: "", demo: false, friend: "any" as FriendFilter };
  const q = new URLSearchParams(window.location.search);
  const lane = (LANES.find((l) => l.id === q.get("lane"))?.id || "yours") as Lane;
  const f = q.get("f");
  const friend = (f === "back" || f === "mutual" || f === "pending" || f === "added-me" ? f : "any") as FriendFilter;
  return { lane, open: q.get("c") || "", demo: q.get("demo") === "1", friend };
}
function writeUrl(lane: Lane, open: string, demo: boolean, friend: FriendFilter) {
  if (typeof window === "undefined") return;
  const q = new URLSearchParams();
  if (demo) q.set("demo", "1");
  if (lane !== "yours") q.set("lane", lane);
  if (friend !== "any") q.set("f", friend);
  if (open) q.set("c", open);
  const s = q.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${s ? `?${s}` : ""}`);
}

export default function SnapQueue(_: Props) {
  const initial = useMemo(readUrl, []);
  const demo = initial.demo;
  const [settings, setSettings] = useState<Settings>(() => (typeof window === "undefined" ? { api: "", token: "" } : getSettings()));
  const [status, setStatus] = useState<Status | null>(null);
  const [doc, setDoc] = useState<Doc | null>(demo ? demoDoc() : null);
  const [loadError, setLoadError] = useState("");
  const [lane, setLane] = useState<Lane>(initial.lane);
  const [open, setOpen] = useState(initial.open);
  const [query, setQuery] = useState("");
  const [friendFilter, setFriendFilter] = useState<FriendFilter>(initial.friend);
  const [sheet, setSheet] = useState<"" | "settings" | "add">("");
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  const [busy, setBusy] = useState("");

  useEffect(() => writeUrl(lane, open, demo, friendFilter), [lane, open, demo, friendFilter]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 7000 : 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const signedIn = demo || Boolean(settings.token);

  const load = useCallback(async () => {
    if (demo || !settings.token) return;
    try {
      const d = await api.list(settings);
      setDoc(d);
      setLoadError("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setSettings((s) => ({ ...s, token: "" }));
        saveSettings({ ...settings, token: "" });
        setLoadError("");
        return;
      }
      setLoadError(e instanceof Error ? e.message : "Something broke.");
    }
  }, [demo, settings]);

  useEffect(() => {
    if (demo) return;
    api.status(settings).then(setStatus).catch(() => setStatus(null));
  }, [demo, settings.api, settings.token]);
  useEffect(() => { load(); }, [load]);

  // poll faster while Snap Boy is working, slowly otherwise
  const working = doc?.sync.state === "requested" || doc?.contacts.some((c) => c.drafts.state === "requested");
  useEffect(() => {
    if (demo || !settings.token) return;
    const t = setInterval(load, working ? 5000 : 30000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [demo, settings.token, working, load]);

  // ---- mutations (local in demo mode)
  const replace = (c: Contact) => setDoc((d) => (d ? { ...d, contacts: d.contacts.map((x) => (x.id === c.id ? c : x)) } : d));
  async function patch(c: Contact, body: Partial<Pick<Contact, "stage" | "note" | "nextStep" | "pinned" | "friend">>) {
    const local = { ...c, ...body, updatedAt: new Date().toISOString() };
    if (body.friend && body.friend !== c.friend) {
      if (body.friend === "mutual" && c.friend === "pending") local.addedBackAt = local.updatedAt;
      local.history = [{ at: local.updatedAt, text: friendHistory(body.friend, c.friend || "") }, ...c.history];
    }
    if (body.stage && body.stage !== c.stage) local.history = [{ at: local.updatedAt, text: `Stage: ${body.stage}` }, ...c.history];
    replace(local);
    if (demo) return true;
    try {
      const r = await api.patch(settings, c.id, body);
      replace(r.contact);
      return true;
    } catch (e) {
      replace(c);
      setToast({ text: e instanceof Error ? e.message : "Not saved." });
      return false;
    }
  }
  async function sync() {
    if (demo) { setToast({ text: "Example mode: sync is off." }); return; }
    setBusy("sync");
    try {
      const r = await api.sync(settings);
      setDoc((d) => (d ? { ...d, sync: r.sync } : d));
      if (!r.ok) setToast({ text: `Snap Boy wasn't reached: ${r.sync.error || "webhook failed"}.` });
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : "Sync failed." });
    } finally { setBusy(""); }
  }
  async function requestMessages(c: Contact) {
    if (demo) { setToast({ text: "Example mode: loading messages is off." }); return; }
    setBusy(`msgs-${c.id}`);
    try {
      const r = await api.messages(settings, c.id);
      replace(r.contact);
      if (!r.ok) setToast({ text: "Snap Boy wasn't reached. Try again." });
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : "Couldn't ask for messages." });
    } finally { setBusy(""); }
  }
  async function requestDrafts(c: Contact, goal: string) {
    if (demo) { setToast({ text: "Example mode: drafts are off." }); return; }
    setBusy(`drafts-${c.id}`);
    try {
      const r = await api.drafts(settings, c.id, goal);
      replace(r.contact);
      if (!r.ok) setToast({ text: "Snap Boy wasn't reached. Try again." });
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : "Couldn't ask for drafts." });
    } finally { setBusy(""); }
  }
  async function remove(c: Contact) {
    setDoc((d) => (d ? { ...d, contacts: d.contacts.filter((x) => x.id !== c.id) } : d));
    setOpen("");
    const undo = async () => {
      setDoc((d) => (d ? { ...d, contacts: [...d.contacts, c] } : d));
      if (!demo) await api.restore(settings, c).catch(() => setToast({ text: "Undo failed." }));
    };
    setToast({ text: `${c.name} removed from the queue.`, undo });
    if (!demo) api.remove(settings, c.id).catch((e) => { setToast({ text: e.message }); load(); });
  }
  async function add(name: string, stage: Stage) {
    if (demo) {
      const now = new Date().toISOString();
      const c: Contact = { ...demoDoc().contacts[1], id: `ex-${Date.now()}`, name, stage, unread: false, chat: { who: "", kind: "", state: "", label: "", ago: "" }, streak: null, source: "manual", history: [{ at: now, text: "Added by hand" }], createdAt: now, updatedAt: now, lastAt: null };
      setDoc((d) => (d ? { ...d, contacts: [...d.contacts, c] } : d));
      return c;
    }
    const r = await api.add(settings, name, stage);
    setDoc((d) => (d ? { ...d, contacts: [...d.contacts, r.contact] } : d));
    return r.contact;
  }

  // ---- derived
  const contacts = doc?.contacts || [];
  const counts = useMemo(() => {
    const n: Record<Lane, number> = { yours: 0, waiting: 0, plans: 0, parked: 0, all: contacts.length };
    for (const c of contacts) n[laneOf(c)]++;
    return n;
  }, [contacts]);
  const friendCounts = useMemo(() => {
    const n: Record<FriendFilter, number> = { any: contacts.length, back: 0, mutual: 0, pending: 0, "added-me": 0 };
    for (const c of contacts) for (const f of ["back", "mutual", "pending", "added-me"] as FriendFilter[]) if (friendMatch(c, f)) n[f]++;
    return n;
  }, [contacts]);
  const newBacks = useMemo(() => sortQueue(contacts.filter(isNewAddBack)), [contacts]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = contacts.filter((c) => (lane === "all" || laneOf(c) === lane) && friendMatch(c, friendFilter) && (!q || c.name.toLowerCase().includes(q) || c.nextStep.toLowerCase().includes(q)));
    return sortQueue(list);
  }, [contacts, lane, query, friendFilter]);
  const current = contacts.find((c) => c.id === open) || null;

  if (!signedIn) {
    return (
      <div className="app">
        <main className="gate">
          <SettingsForm settings={settings} status={status} first onSaved={(s) => { setSettings(s); saveSettings(s); }} />
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="bar">
        <div className="container bar-in">
          <p className="wordmark">Snap Queue</p>
          {demo ? <span className="demo-flag">Example data</span> : null}
          <SyncLine doc={doc} />
          <div className="bar-actions">
            <button className="btn btn--quiet" type="button" onClick={() => setSheet("add")}><Icon name="plus" /><span className="wide">Add by hand</span><span className="narrow">Add</span></button>
            <button className="btn btn--quiet" type="button" onClick={() => setSheet("settings")} aria-label="Settings"><Icon name="sliders" /><span className="wide">Settings</span></button>
            <button className="btn btn--primary" type="button" onClick={sync} aria-busy={busy === "sync" || doc?.sync.state === "requested"} disabled={busy === "sync"}>
              <span className="spin" data-on={doc?.sync.state === "requested" || busy === "sync"}><Icon name="sync" /></span>
              {doc?.sync.state === "requested" ? "Syncing" : <><span className="wide">Sync from Snapchat</span><span className="narrow">Sync</span></>}
            </button>
          </div>
        </div>
      </header>

      <main className="main container">
        <div className="toolbar">
          <div className="lanes" role="tablist" aria-label="Queue lanes">
            {LANES.map((l) => (
              <button key={l.id} role="tab" type="button" className="lane" aria-selected={lane === l.id} onClick={() => setLane(l.id)}>
                <Icon name={LANE_ICON[l.id]} />{l.label} <span className="count">{doc ? counts[l.id] : ""}</span>
              </button>
            ))}
          </div>
          <label className="search">
            <Icon name="search" />
            <input className="input" type="search" placeholder="Find a name or next step" aria-label="Find a name or next step" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        </div>
        <div className="friends" role="group" aria-label="Friend status">
          {([["any", "Anyone", "user"], ["back", "Added you back", "userCheck"], ["pending", "Pending", "userClock"], ["added-me", "Added you", "userPlus"]] as [FriendFilter, string, IconName][]).map(([id, label, icon]) => (
            <button key={id} type="button" className="pill" aria-pressed={friendFilter === id} onClick={() => { setFriendFilter(id); if (id !== "any") setLane("all"); }}>
              <Icon name={icon} />{label}{doc && id !== "any" ? <span className="count">{friendCounts[id]}</span> : null}
            </button>
          ))}
        </div>
        {newBacks.length ? (
          <div className="addback" role="status">
            <Icon name="userCheck" />
            <span className="addback-text">Added you back:</span>
            {newBacks.map((c) => (
              <button key={c.id} type="button" className="addback-name" onClick={() => { setOpen(c.id); setLane("all"); }}>{c.name}<span className="ago">{ago(c.addedBackAt)}</span></button>
            ))}
          </div>
        ) : null}

        <div className="layout" data-open={Boolean(current)}>
          <section aria-label="Chats">
            {loadError && !doc ? (
              <div className="notice" data-kind="error" role="alert">
                <h2><Icon name="alert" />The queue didn't load</h2>
                <p>{loadError}</p>
                <button className="btn" type="button" onClick={load}><Icon name="sync" />Try again</button>
              </div>
            ) : !doc ? (
              <Skeleton />
            ) : contacts.length === 0 ? (
              <div className="notice">
                <h2><Icon name="inbox" />No chats yet</h2>
                <p>Sync and Snap Boy reads your Snapchat chat list: names, who sent last and when. It never opens a chat or sends anything.</p>
                <div className="row-actions">
                  <button className="btn btn--primary" type="button" onClick={sync} disabled={busy === "sync"}><Icon name="sync" />Sync from Snapchat</button>
                  <button className="btn" type="button" onClick={() => setSheet("add")}><Icon name="plus" />Add by hand</button>
                </div>
              </div>
            ) : visible.length === 0 ? (
              <div className="notice">
                <h2>{query ? "No match" : lane === "yours" ? "Nothing waits on you" : "Nobody here"}</h2>
                <p>{query ? `No name or next step has "${query}".` : lane === "yours" ? "Every chat is answered. Check Waiting on them, or sync for news." : "Contacts land here when their status fits this lane."}</p>
              </div>
            ) : (
              <ol className="queue">
                {visible.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="row" aria-current={open === c.id} data-unread={c.unread} onClick={() => setOpen(open === c.id ? "" : c.id)}>
                      <span className="who">
                        <span className="name">{c.pinned ? <Icon name="pin" label="Pinned" /> : null}<span className="txt">{c.name}</span><FriendMark f={c.friend || ""} isNew={isNewAddBack(c)} /></span>
                        <RowLine c={c} />
                      </span>
                      <span className="chatstate">
                        <span className="chip" data-tone={chatTone(c)}><ChatIcon c={c} />{chatText(c)}</span>
                        <span className="stage">{c.nextStep ? stageLabel(c.stage) : ""}</span>
                      </span>
                      <span className="ago ago-cell"><Icon name="clock" />{c.chat.ago ? `${c.chat.ago} ago` : ago(c.lastAt || c.updatedAt)}</span>
                      <span className="streak" aria-label={c.streak ? `Streak ${c.streak} days` : undefined}>{c.streak ? <><Icon name="flame" />{c.streak}d</> : ""}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {current ? (
            <Detail key={current.id} c={current} busy={busy === `drafts-${current.id}`} onClose={() => setOpen("")} onPatch={(b) => patch(current, b)} onDrafts={(g) => requestDrafts(current, g)} onMessages={() => requestMessages(current)} msgBusy={busy === `msgs-${current.id}`} onRemove={() => remove(current)} onCopied={() => setToast({ text: "Copied. Paste it in Snapchat." })} />
          ) : null}
        </div>
      </main>

      {sheet === "settings" ? (
        <Sheet title="Settings" onClose={() => setSheet("")}>
          <SettingsForm settings={settings} status={status} demo={demo} onSaved={(s) => { setSettings(s); saveSettings(s); setSheet(""); setToast({ text: "Saved." }); }} onSignOut={() => { const s = { ...settings, token: "" }; setSettings(s); saveSettings(s); setSheet(""); setDoc(null); }} />
        </Sheet>
      ) : null}
      {sheet === "add" ? (
        <Sheet title="Add someone by hand" onClose={() => setSheet("")}>
          <AddForm onAdd={async (n, s) => { const c = await add(n, s); setSheet(""); setOpen(c.id); setLane(laneOf(c)); }} onCancel={() => setSheet("")} />
        </Sheet>
      ) : null}

      {toast ? (
        <div className="toast" role="status">
          <span className="toast-text"><Icon name={toast.undo ? "trash" : "check"} />{toast.text}</span>
          {toast.undo ? <button className="btn" type="button" onClick={() => { toast.undo?.(); setToast(null); }}><Icon name="undo" />Undo</button> : <button className="btn btn--quiet" style={{ color: "inherit" }} type="button" onClick={() => setToast(null)} aria-label="Close"><Icon name="x" /></button>}
        </div>
      ) : null}
    </div>
  );
}

function ChatIcon({ c }: { c: Contact }) {
  if (c.stage === "stopped" || c.stage === "paused") return <Icon name="pause" />;
  if (c.chat.who === "me") return <Icon name="send" />;
  const name: IconName = c.chat.kind === "snap" ? "snap" : c.chat.kind === "call" ? "call" : "chat";
  return <Icon name={name} filled={c.chat.who === "them" && (c.unread || c.chat.state === "new" || c.chat.state === "received")} />;
}

function RowLine({ c }: { c: Contact }) {
  const m = lastMessage(c);
  if (m) {
    return (
      <span className="next" data-from={m.from}>
        {m.from === "me" ? <Icon name="send" /> : <Icon name={m.kind === "snap" ? "snap" : "chat"} />}
        <span className="txt">{m.from === "me" ? "You: " : ""}{messageText(m)}</span>
      </span>
    );
  }
  return <span className="next">{c.nextStep ? <Icon name="arrow" /> : <Icon name="flag" />}<span className="txt">{c.nextStep || stageLabel(c.stage)}</span></span>;
}

function Messages({ c, busy, onLoad }: { c: Contact; busy: boolean; onLoad: () => void }) {
  const list = c.messages || [];
  const st = c.msgs?.state || "none";
  const threadRef = useRef<HTMLOListElement>(null);
  useEffect(() => { const el = threadRef.current; if (el) el.scrollTop = el.scrollHeight; }, [list.length]);
  const working = busy || st === "requested";
  return (
    <div className="section">
      <h3><Icon name="chat" />Messages</h3>
      {list.length ? (
        <ol ref={threadRef} className="thread" aria-label={`Messages with ${c.name}`}>
          {list.map((m: Message, i) => (
            <li key={i} className="bubble" data-from={m.from} data-kind={m.kind}>
              {m.kind !== "chat" && m.kind !== "" ? <Icon name={m.kind === "snap" ? "snap" : m.kind === "call" ? "call" : "chat"} filled={m.kind === "snap"} /> : null}
              <span className="bubble-text">{messageText(m)}</span>
              {m.atText || m.at ? <time className="bubble-time" dateTime={m.at || undefined}>{m.atText || ago(m.at)}</time> : null}
            </li>
          ))}
        </ol>
      ) : st === "requested" ? (
        <p className="hint"><Icon name="sync" />Snap Boy is opening the chat.</p>
      ) : (
        <p className="hint">No messages loaded yet. Sync loads new chats, or load this one now.</p>
      )}
      {st === "failed" ? <p className="hint hint--error" role="alert"><Icon name="alert" />Couldn't load: {c.msgs?.error || "no reason given"}</p> : null}
      <div className="row-actions">
        <button className="btn" type="button" onClick={onLoad} disabled={working} aria-busy={working}>
          <span className="spin" data-on={working}><Icon name="sync" /></span>{working ? "Loading messages" : list.length ? "Refresh messages" : "Load messages"}
        </button>
        {c.msgs?.at && st === "ready" ? <span className="hint">Read {ago(c.msgs.at)}</span> : null}
      </div>
      <p className="hint">Opening a chat in Snapchat Web marks it as Opened for them. Snaps are never opened.</p>
    </div>
  );
}

function FriendMark({ f, isNew }: { f: Friend; isNew: boolean }) {
  if (!f) return null;
  if (f === "mutual") return isNew ? <span className="fmark" data-f="new"><Icon name="userCheck" /><span className="fm-txt">Added you back</span></span> : <span className="fmark" data-f="mutual"><Icon name="userCheck" label="Friends both ways" /></span>;
  if (f === "pending") return <span className="fmark" data-f="pending"><Icon name="userClock" /><span className="fm-txt">Pending</span></span>;
  return <span className="fmark" data-f="added-me"><Icon name="userPlus" /><span className="fm-txt">Added you</span></span>;
}

function friendHistory(next: Friend, prev: Friend) {
  if (next === "mutual" && prev === "pending") return "Added you back";
  if (next === "mutual") return "Friend status: friends";
  if (next === "pending") return "Pending: hasn't added you back";
  return "Added you";
}

function historyIcon(text: string): IconName {
  if (text.startsWith("Added you back") || text.startsWith("Friend")) return "userCheck";
  if (text.startsWith("Pending")) return "userClock";
  if (text.startsWith("Added you")) return "userPlus";
  if (text.startsWith("Stage:")) return "flag";
  if (text.startsWith("Snap Boy")) return "sparkle";
  if (text.startsWith("Found")) return "search";
  if (text.startsWith("Added")) return "plus";
  return /snap/i.test(text) ? "snap" : "chat";
}

function chatText(c: Contact) {
  if (c.stage === "stopped") return "Stopped";
  if (c.stage === "paused") return "Paused";
  if (c.chat.label) return c.chat.label;
  return c.source === "manual" ? "Not synced" : "No status";
}

function SyncLine({ doc }: { doc: Doc | null }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t); }, []);
  if (!doc) return <span className="syncline">Loading</span>;
  const s = doc.sync;
  let text = "Not synced yet";
  if (s.state === "requested") text = "Snap Boy is reading your chat list";
  else if (s.state === "failed") text = `Sync failed: ${s.error || "unknown"}`;
  else if (s.state === "done") text = `Synced ${ago(s.finishedAt)}, ${s.seen ?? 0} chats${s.read ? `, ${s.read} read` : ""}`;
  return <span className="syncline" data-state={s.state} role="status">{text}</span>;
}

function Skeleton() {
  return (
    <ol className="queue" aria-busy="true" aria-label="Loading chats">
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i}>
          <div className="row row--ghost">
            <span className="who"><span className="ghost" style={{ width: `${55 + ((i * 13) % 30)}%` }} /></span>
            <span className="chatstate"><span className="ghost" style={{ width: "40%" }} /></span>
            <span className="ghost" style={{ width: 48 }} />
            <span className="ghost" style={{ width: 32 }} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function Detail({ c, busy, msgBusy, onClose, onPatch, onDrafts, onMessages, onRemove, onCopied }: {
  c: Contact; busy: boolean; onClose: () => void; onPatch: (b: Partial<Pick<Contact, "stage" | "note" | "nextStep" | "pinned" | "friend">>) => Promise<boolean>;
  onDrafts: (goal: string) => void; onMessages: () => void; msgBusy: boolean; onRemove: () => void; onCopied: () => void;
}) {
  const [note, setNote] = useState(c.note);
  const [nextStep, setNextStep] = useState(c.nextStep);
  const [goal, setGoal] = useState(c.drafts.goal || "");
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headRef.current?.focus(); }, []);
  useEffect(() => {
    if (note === c.note && nextStep === c.nextStep) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (await onPatch({ note, nextStep })) { setSaved(true); setTimeout(() => setSaved(false), 1500); }
    }, 700);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [note, nextStep]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); onCopied(); } catch { window.prompt("Copy this:", text); }
  };
  const stopped = c.stage === "stopped";

  return (
    <aside className="panel" aria-label={`${c.name} details`}>
      <div className="panel-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 ref={headRef} tabIndex={-1}>{c.name}</h2>
          <p className="panel-sub"><ChatIcon c={c} />{chatText(c)}{c.chat.ago ? `, ${c.chat.ago} ago` : ""}{c.streak ? `, ${c.streak} day streak` : ""}</p>
        </div>
        <button className="btn btn--quiet btn--icon" type="button" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
      </div>

      <Messages c={c} busy={msgBusy} onLoad={onMessages} />

      <div className="section">
        <h3><Icon name="flag" />Status</h3>
        <div className="ladder" role="group" aria-label="Stage">
          {STAGES.map((s) => (
            <button key={s.id} type="button" className="pill" data-stop={s.id === "stopped"} aria-pressed={c.stage === s.id} onClick={() => onPatch({ stage: s.id })}>{s.label}</button>
          ))}
        </div>
        {stopped ? <p className="hint">Stopped means clear disinterest: no drafts, no follow-ups.</p> : null}
      </div>

      <div className="section">
        <h3><Icon name="user" />Friends on Snapchat</h3>
        <div className="ladder" role="group" aria-label="Friend status">
          {FRIENDS.map((f) => (
            <button key={f.id} type="button" className="pill" aria-pressed={c.friend === f.id} onClick={() => onPatch({ friend: f.id })}>
              <Icon name={f.id === "mutual" ? "userCheck" : f.id === "pending" ? "userClock" : "userPlus"} />{f.id === "mutual" ? "Friends both ways" : f.id === "pending" ? "Pending, not added back" : "Added you"}
            </button>
          ))}
        </div>
        <p className="hint">
          {c.addedBackAt && c.friend === "mutual" ? `Added you back ${ago(c.addedBackAt)}.` : c.friend === "pending" ? "You added them. Sync shows it here when they add you back." : c.friend === "added-me" ? "They added you. Add them back in Snapchat if you want to." : c.friend === "mutual" ? "You're friends both ways." : "Not checked yet. Sync fills this in, or set it."}
          {c.friendCheckedAt ? ` Checked ${ago(c.friendCheckedAt)}.` : ""}
        </p>
      </div>

      <div className="section">
        <div className="field">
          <label htmlFor="next"><Icon name="arrow" />Next step</label>
          <input id="next" className="input" value={nextStep} maxLength={200} placeholder="What you'll do next" onChange={(e) => setNextStep(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="note"><Icon name="pencil" />Notes</label>
          <textarea id="note" className="textarea" value={note} maxLength={1000} placeholder="Interests, plans, things to remember" onChange={(e) => setNote(e.target.value)} />
        </div>
        <span className="saved" data-on={saved} aria-live="polite">{saved ? <><Icon name="check" />Saved</> : ""}</span>
      </div>

      <div className="section">
        <h3><Icon name="sparkle" />Reply drafts</h3>
        {stopped ? (
          <p className="hint">Off for stopped contacts.</p>
        ) : (
          <>
            <div className="field">
              <label htmlFor="goal">What you want from the next message</label>
              <input id="goal" className="input" value={goal} maxLength={200} placeholder="Keep it going, tease, ask for a date" onChange={(e) => setGoal(e.target.value)} />
            </div>
            <div className="row-actions">
              <button className="btn btn--primary" type="button" onClick={() => onDrafts(goal)} disabled={busy || c.drafts.state === "requested"} aria-busy={busy || c.drafts.state === "requested"}>
                <Icon name="sparkle" />
                {c.drafts.state === "requested" ? "Snap Boy is reading the chat" : c.drafts.items.length ? "New drafts" : "Get drafts"}
              </button>
            </div>
            <p className="hint">Snap Boy opens only this chat in Snapchat Web, reads it, closes it and drafts. You send.</p>
            {c.drafts.state === "failed" ? <p className="hint hint--error" role="alert"><Icon name="alert" />Drafts failed: {c.drafts.read || "no reason given"}</p> : null}
            {c.drafts.state !== "failed" && c.drafts.read ? <p><span className="read">{c.drafts.read}</span></p> : null}
            {c.drafts.items.length ? (
              <ul className="drafts">
                {c.drafts.items.map((d, i) => (
                  <li key={i} className="draft" data-pick={d.pick}>
                    <p>{d.text}<span className="angle">{d.pick ? `${d.angle || "draft"}, Snap Boy's pick` : d.angle}</span></p>
                    <button className="btn" type="button" onClick={() => copy(d.text)}><Icon name="copy" />Copy</button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>

      <div className="section">
        <h3><Icon name="clock" />History</h3>
        <ol className="history">
          {c.history.slice(0, 12).map((h, i) => (
            <li key={i}><time dateTime={h.at}>{ago(h.at)}</time><span><Icon name={historyIcon(h.text)} />{h.text}</span></li>
          ))}
        </ol>
      </div>

      <div className="row-actions">
        <button className="btn" type="button" onClick={() => onPatch({ pinned: !c.pinned })}><Icon name="pin" />{c.pinned ? "Unpin" : "Pin to top"}</button>
        <button className="btn btn--quiet btn--danger" type="button" onClick={onRemove}><Icon name="trash" />Remove from queue</button>
      </div>
    </aside>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("input, button")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function AddForm({ onAdd, onCancel }: { onAdd: (name: string, stage: Stage) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [stage, setStage] = useState<Stage>("opened");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form className="section" onSubmit={async (e) => {
      e.preventDefault();
      if (!name.trim()) { setError("Type the name as it shows in Snapchat."); return; }
      setBusy(true);
      try { await onAdd(name.trim(), stage); } catch (err) { setError(err instanceof Error ? err.message : "Not added."); } finally { setBusy(false); }
    }}>
      <div className="field">
        <label htmlFor="add-name"><Icon name="chat" />Name as it shows in Snapchat</label>
        <input id="add-name" className="input" value={name} maxLength={80} aria-invalid={Boolean(error)} onChange={(e) => { setName(e.target.value); setError(""); }} />
        {error ? <span className="hint hint--error" role="alert">{error}</span> : null}
      </div>
      <div className="field">
        <span className="hint">Stage</span>
        <div className="ladder" role="group" aria-label="Stage">
          {STAGES.filter((s) => s.id !== "stopped" && s.id !== "date-done").map((s) => (
            <button key={s.id} type="button" className="pill" aria-pressed={stage === s.id} onClick={() => setStage(s.id)}>{s.label}</button>
          ))}
        </div>
      </div>
      <div className="row-actions">
        <button className="btn btn--quiet" type="button" onClick={onCancel}>Cancel</button>
        <button className="btn btn--primary" type="submit" disabled={busy} aria-busy={busy}><Icon name="plus" />Add to queue</button>
      </div>
    </form>
  );
}

function SettingsForm({ settings, status, first, demo, onSaved, onSignOut }: {
  settings: Settings; status: Status | null; first?: boolean; demo?: boolean; onSaved: (s: Settings) => void; onSignOut?: () => void;
}) {
  const [apiUrl, setApiUrl] = useState(settings.api);
  const [token, setToken] = useState(settings.token);
  const [secret, setSecret] = useState("");
  const [readNew, setReadNew] = useState(settings.readNew !== false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const firstRun = status ? !status.appTokenSet : false;
  const needsSecret = status ? !status.webhook : false;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const t = token.trim();
    const s = { api: apiUrl.trim() || settings.api, token: t, readNew };
    setBusy(true);
    try {
      if (firstRun) {
        if (t.length < 12) throw new Error("Use at least 12 characters for the token.");
        await api.setup(s, { appToken: t, webhookSecret: secret.trim() || undefined }, "");
      } else {
        await api.list(s); // checks the token
        if (secret.trim()) await api.setup(s, { webhookSecret: secret.trim() });
      }
      onSaved(s);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "That token doesn't match." : err instanceof Error ? err.message : "Not saved.");
    } finally { setBusy(false); }
  }

  const Wrap = first ? "div" : "div";
  return (
    <Wrap className={first ? "sheet" : "section"}>
      {first ? <h1>Snap Queue</h1> : null}
      {first ? (
        <p>Every Snapchat chat in one queue, sorted by whose move it is. {firstRun ? "First run: choose an access token. It stays on this device and in your API." : "Sign in with your access token."}</p>
      ) : null}
      {demo ? <p className="hint">You're looking at example data. Remove ?demo=1 from the address to use your own.</p> : null}
      <form className="section" onSubmit={submit}>
        <div className="field">
          <label htmlFor="token"><Icon name="key" />{firstRun ? "New access token, 12 or more characters" : "Access token"}</label>
          <input id="token" className="input" name="password" type="password" autoComplete={firstRun ? "new-password" : "current-password"} value={token} aria-invalid={Boolean(error)} onChange={(e) => setToken(e.target.value)} />
        </div>
        {firstRun || needsSecret || !first ? (
          <div className="field">
            <label htmlFor="secret"><Icon name="sync" />Webhook signing secret{status?.webhook ? " (set, paste only to change it)" : ""}</label>
            <input id="secret" className="input" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} />
            <span className="hint">From OpenBot, Routines, "Snap Queue: sync chats and draft replies". It links Sync to Snap Boy.</span>
          </div>
        ) : null}
        {!first ? (
          <label className="check">
            <input type="checkbox" checked={readNew} onChange={(e) => setReadNew(e.target.checked)} />
            <span><Icon name="chat" />Read new chats during Sync<span className="hint">Snap Boy opens chats with new messages so you see them here. They'll show as Opened. Snaps stay unopened.</span></span>
          </label>
        ) : null}
        <details>
          <summary className="hint">API address</summary>
          <div className="field" style={{ marginTop: 8 }}>
            <label htmlFor="api">API</label>
            <input id="api" className="input" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} />
          </div>
        </details>
        {error ? <p className="hint hint--error" role="alert">{error}</p> : null}
        {status ? <p className="hint"><Icon name={status.webhook ? "check" : "alert"} />Snap Boy link: {status.webhook ? "connected" : "needs the signing secret"}.</p> : null}
        <div className="row-actions">
          {onSignOut && settings.token ? <button className="btn btn--quiet" type="button" onClick={onSignOut}>Sign out</button> : null}
          <button className="btn btn--primary" type="submit" disabled={busy} aria-busy={busy}>{first ? (firstRun ? "Create and open" : "Open the queue") : "Save"}</button>
        </div>
        {first ? <p className="hint"><a href="?demo=1">See it with example data</a></p> : null}
      </form>
    </Wrap>
  );
}
