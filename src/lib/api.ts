export const DEFAULT_API = "https://snap-queue-api.thl007.workers.dev";

export type Stage = "new" | "opened" | "replied" | "rapport" | "number" | "date-planned" | "date-done" | "paused" | "stopped";
export const STAGES: { id: Stage; label: string }[] = [
  { id: "new", label: "New" },
  { id: "opened", label: "Opened" },
  { id: "replied", label: "Replied" },
  { id: "rapport", label: "Rapport" },
  { id: "number", label: "Number" },
  { id: "date-planned", label: "Date planned" },
  { id: "date-done", label: "Date done" },
  { id: "paused", label: "Paused" },
  { id: "stopped", label: "Stopped" },
];
export const stageLabel = (s: Stage) => STAGES.find((x) => x.id === s)?.label ?? s;

/** Snapchat friendship: mutual = friends both ways, pending = you added them and they haven't added you back, added-me = they added you. */
export type Friend = "mutual" | "pending" | "added-me" | "";
export const FRIENDS: { id: Exclude<Friend, "">; label: string; filter: string }[] = [
  { id: "mutual", label: "Friends", filter: "Added back" },
  { id: "pending", label: "Pending", filter: "Pending" },
  { id: "added-me", label: "Added you", filter: "Added you" },
];
export type FriendFilter = "any" | Exclude<Friend, ""> | "back";
/** Added back = went from pending to friends; "new" while that's under 7 days old. */
export const isNewAddBack = (c: { addedBackAt?: string | null }) => Boolean(c.addedBackAt && Date.now() - Date.parse(c.addedBackAt) < 7 * 86400000);
export function friendMatch(c: { friend?: Friend; addedBackAt?: string | null }, f: FriendFilter) {
  if (f === "any") return true;
  if (f === "back") return Boolean(c.addedBackAt) && c.friend === "mutual";
  return (c.friend || "") === f;
}

export type Chat = { who: "them" | "me" | ""; kind: "chat" | "snap" | "call" | "story" | ""; state: string; label: string; ago: string };
export type Draft = { text: string; angle: string; pick: boolean };
export type Contact = {
  id: string; name: string; username: string; stage: Stage; source: "sync" | "manual";
  chat: Chat; unread: boolean; streak: number | null; lastAt: string | null;
  note: string; nextStep: string; pinned: boolean;
  friend?: Friend; addedBackAt?: string | null; friendCheckedAt?: string | null;
  drafts: { state: "none" | "requested" | "ready" | "failed"; items: Draft[]; read: string; at: string | null; goal: string };
  history: { at: string; text: string }[]; createdAt: string; updatedAt: string;
};
export type Sync = { state: "never" | "requested" | "done" | "failed"; requestedAt?: string | null; finishedAt?: string; seen?: number; added?: number; changed?: number; addedBack?: string[]; error?: string };
export type Doc = { contacts: Contact[]; sync: Sync };
export type Status = { ready: boolean; appTokenSet: boolean; webhook: boolean; agent: boolean };

export type Settings = { api: string; token: string };
const KEY = "snap-queue-settings";
export function getSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { api: s.api || DEFAULT_API, token: s.token || "" };
  } catch {
    return { api: DEFAULT_API, token: "" };
  }
}
export function saveSettings(s: Settings) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
async function req<T>(s: Settings, method: string, path: string, body?: unknown, token = s.token): Promise<T> {
  let res: Response;
  try {
    res = await fetch(s.api.replace(/\/+$/, "") + path, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Can't reach the Snap Queue API. Check your connection.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !(res.status === 502 && data && (data.sync || data.contact))) throw new ApiError(data.error || `Error ${res.status}`, res.status);
  return data as T;
}

export const api = {
  status: (s: Settings) => req<Status>(s, "GET", "/api/status"),
  setup: (s: Settings, body: { appToken?: string; webhookSecret?: string }, token?: string) => req<{ ok: boolean; webhook: boolean }>(s, "POST", "/api/setup", body, token ?? s.token),
  list: (s: Settings) => req<Doc>(s, "GET", "/api/contacts"),
  sync: (s: Settings) => req<{ ok: boolean; sync: Sync }>(s, "POST", "/api/sync"),
  add: (s: Settings, name: string, stage: Stage) => req<{ contact: Contact }>(s, "POST", "/api/contacts", { name, stage }),
  patch: (s: Settings, id: string, body: Partial<Pick<Contact, "stage" | "note" | "nextStep" | "pinned" | "name" | "friend">>) => req<{ contact: Contact }>(s, "PATCH", `/api/contacts/${id}`, body),
  remove: (s: Settings, id: string) => req<{ ok: boolean; removed: Contact }>(s, "DELETE", `/api/contacts/${id}`),
  restore: (s: Settings, contact: Contact) => req<{ ok: boolean }>(s, "POST", "/api/contacts/restore", { contact }),
  drafts: (s: Settings, id: string, goal: string) => req<{ ok: boolean; contact: Contact }>(s, "POST", `/api/contacts/${id}/drafts`, { goal }),
};

// ---- the queue: which lane a contact sits in
export type Lane = "yours" | "waiting" | "plans" | "parked" | "all";
export const LANES: { id: Lane; label: string }[] = [
  { id: "yours", label: "Your move" },
  { id: "waiting", label: "Waiting on them" },
  { id: "plans", label: "Plans" },
  { id: "parked", label: "Parked" },
  { id: "all", label: "All" },
];
export function laneOf(c: Contact): Exclude<Lane, "all"> {
  if (c.stage === "paused" || c.stage === "stopped") return "parked";
  if (c.unread || c.chat.who === "them") return "yours";
  if (c.stage === "number" || c.stage === "date-planned" || c.stage === "date-done") return "plans";
  if (c.chat.who === "me") return "waiting";
  return "yours";
}
const when = (c: Contact) => Date.parse(c.lastAt || c.updatedAt) || 0;
export function sortQueue(list: Contact[]) {
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || Number(b.unread) - Number(a.unread) || when(b) - when(a));
}

/** Chip tone for the last chat state, in the theme's accents. */
export function chatTone(c: Contact): "loud" | "action" | "calm" | "growth" | "faded" {
  if (c.stage === "stopped" || c.stage === "paused") return "faded";
  if (c.unread || c.chat.state === "new") return "loud";
  if (c.chat.who === "them") return "action";
  if (c.chat.state === "opened" && c.chat.who === "me") return "growth";
  if (c.chat.who === "me") return "calm";
  return "faded";
}

export function ago(iso?: string | null) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
