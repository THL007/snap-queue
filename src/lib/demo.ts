import type { Contact, Doc } from "./api";

// Example data for ?demo=1 only. Invented names and states, never sent to the API.
const t = (min: number) => new Date(Date.now() - min * 60000).toISOString();
function c(id: string, name: string, p: Partial<Contact>): Contact {
  return {
    id, name, username: "", stage: "replied", source: "sync",
    chat: { who: "", kind: "chat", state: "", label: "", ago: "" }, unread: false, streak: null, lastAt: t(60),
    note: "", nextStep: "", pinned: false, drafts: { state: "none", items: [], read: "", at: null, goal: "" },
    history: [{ at: t(60 * 24 * 3), text: "Found in Snapchat" }], createdAt: t(60 * 24 * 3), updatedAt: t(30), ...p,
  };
}
export function demoDoc(): Doc {
  return {
    sync: { state: "done", finishedAt: t(4), seen: 7, added: 1, changed: 3, addedBack: ["Example Jo"] },
    contacts: [
      c("ex-1", "Example Sam", { friend: "mutual", msgs: { state: "ready", at: t(4), error: "" },
        messages: [
          { from: "me", kind: "chat", text: "how was the concert", at: t(60 * 20), atText: "Yesterday" },
          { from: "them", kind: "snap", text: "", at: t(60 * 19), atText: "Yesterday" },
          { from: "them", kind: "chat", text: "honestly the best night this month", at: t(12), atText: "12m" },
          { from: "them", kind: "chat", text: "you should've come", at: t(9), atText: "9m" },
        ], stage: "rapport", unread: true, streak: 12, lastAt: t(9), chat: { who: "them", kind: "chat", state: "new", label: "New Chat", ago: "9m" }, nextStep: "Ask about the concert",
        drafts: { state: "ready", read: "Warm: quick replies and a question back.", at: t(3), goal: "keep it going",
          items: [{ text: "okay but which song made the night", angle: "curious", pick: true }, { text: "you're making me regret skipping it", angle: "playful", pick: false }, { text: "next one, i'm coming. you pick the spot", angle: "bold", pick: false }] },
        history: [{ at: t(9), text: "New Chat (9m)" }, { at: t(60 * 26), text: "Stage: rapport" }, { at: t(60 * 24 * 3), text: "Found in Snapchat" }] }),
      c("ex-2", "Example Alex", { friend: "added-me", msgs: { state: "ready", at: t(40), error: "" },
        messages: [{ from: "me", kind: "chat", text: "that view is unreal", at: t(90), atText: "1h" }, { from: "them", kind: "snap", text: "", at: t(42), atText: "42m" }], stage: "replied", lastAt: t(42), chat: { who: "them", kind: "snap", state: "received", label: "Received", ago: "42m" }, streak: 3 }),
      c("ex-3", "Example Jo", { friend: "mutual", addedBackAt: t(30), history: [{ at: t(30), text: "Added you back" }, { at: t(60 * 24 * 2), text: "Pending: hasn't added you back" }], stage: "opened", unread: true, lastAt: t(130), chat: { who: "them", kind: "snap", state: "new", label: "New Snap", ago: "2h" } }),
      c("ex-4", "Example Kim", { friend: "mutual", stage: "date-planned", lastAt: t(60 * 5), chat: { who: "me", kind: "chat", state: "opened", label: "Opened", ago: "5h" }, nextStep: "Saturday, coffee at 3", pinned: true }),
      c("ex-5", "Example Ray", { friend: "mutual", stage: "rapport", lastAt: t(60 * 20), chat: { who: "me", kind: "chat", state: "delivered", label: "Delivered", ago: "20h" } }),
      c("ex-6", "Example Lee", { friend: "pending", stage: "opened", lastAt: t(60 * 50), chat: { who: "me", kind: "snap", state: "opened", label: "Opened", ago: "2d" } }),
      c("ex-7", "Example Max", { friend: "pending", stage: "stopped", lastAt: t(60 * 24 * 6), chat: { who: "me", kind: "chat", state: "delivered", label: "Delivered", ago: "6d" }, note: "Short replies twice, let it go." }),
    ],
  };
}
