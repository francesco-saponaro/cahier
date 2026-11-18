import { chunkText, costMicros, countTokens, hashPassword, priceInForce, splitSentences, type ModelPrice, type PriceKind } from "@cahier/domain";
import { eq, type InferSelectModel } from "drizzle-orm";
import type { Db } from "./db.js";
import { corpus } from "./corpus/index.js";
import * as schema from "./schema.js";

/*
 * The seed: six months of two workspaces using the assistant, generated from a fixed seed so every
 * run, every test and the browser demo see the same rows. Everything downstream is derived the way
 * the real use cases derive it: documents are chunked by the chunker, an answer quotes sentences
 * of chunks the member could read, usage is costed at the price in force when the answer was
 * given, and a shared library or agent has the approved request behind it.
 */

export type SeedData = {
  workspaces: InferSelectModel<typeof schema.workspaces>[];
  users: InferSelectModel<typeof schema.users>[];
  memberships: InferSelectModel<typeof schema.memberships>[];
  invitations: InferSelectModel<typeof schema.invitations>[];
  models: InferSelectModel<typeof schema.models>[];
  modelPrices: InferSelectModel<typeof schema.modelPrices>[];
  libraries: InferSelectModel<typeof schema.libraries>[];
  documents: InferSelectModel<typeof schema.documents>[];
  chunks: Omit<InferSelectModel<typeof schema.chunks>, "tsv">[];
  agents: InferSelectModel<typeof schema.agents>[];
  agentVersions: InferSelectModel<typeof schema.agentVersions>[];
  agentVersionLibraries: InferSelectModel<typeof schema.agentVersionLibraries>[];
  shareRequests: InferSelectModel<typeof schema.shareRequests>[];
  conversations: InferSelectModel<typeof schema.conversations>[];
  messages: InferSelectModel<typeof schema.messages>[];
  citations: InferSelectModel<typeof schema.citations>[];
  usageEvents: InferSelectModel<typeof schema.usageEvents>[];
  budgets: InferSelectModel<typeof schema.budgets>[];
  scheduledPrompts: InferSelectModel<typeof schema.scheduledPrompts>[];
  scheduledRuns: InferSelectModel<typeof schema.scheduledRuns>[];
  auditLog: InferSelectModel<typeof schema.auditLog>[];
};

type Row<K extends keyof SeedData> = SeedData[K][number];

export const DEMO_PASSWORD = "cahier-demo";
export const DEMO_ACCOUNTS = [
  { email: "lea@example.com", name: "Léa Marchetti", role: "member" as const },
  { email: "tom@example.com", name: "Tom Delaunay", role: "member" as const },
  { email: "noor@example.com", name: "Noor Haddad", role: "admin" as const },
];

export interface SeedOptions {
  seed?: number;
  now?: Date;
}

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** A small deterministic generator (mulberry32), enough for a seed that must be the same every run. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    chance: (p: number) => next() < p,
    shuffle: <T>(items: readonly T[]): T[] => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
  };
}

function ids() {
  const counters = new Map<string, number>();
  return (prefix: string) => {
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    return `${prefix}_${n.toString(36).padStart(5, "0")}`;
  };
}

const FIRST = ["Amina", "Bastien", "Chloé", "Dario", "Elise", "Farid", "Gaëlle", "Hugo", "Inès", "Jules", "Karim", "Lina", "Mathis", "Nadia", "Oscar", "Paula", "Quentin", "Rania", "Samir", "Thaïs", "Ugo", "Victoire", "Wassim", "Yasmine", "Zoé", "Adèle", "Benoît", "Camille", "Diane", "Elias", "Fatou", "Gabriel", "Hana", "Idris", "Jeanne", "Kenza", "Léo", "Maya", "Nils", "Ophélie"];
const LAST = ["Aubert", "Benali", "Carvalho", "Dupré", "Essaidi", "Fontaine", "Garnier", "Hamel", "Ibarra", "Joly", "Kaci", "Lemoine", "Mercier", "Nguyen", "Okafor", "Perrin", "Roux", "Sabri", "Toussaint", "Vidal"];

const slugify = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/* ---------- generated prose for volume: meeting notes and field notes ---------- */

const CITIES = ["Paris", "Lyon", "Bordeaux", "Lille", "Nantes", "Marseille"];
const HUB_WORDS = ["Bastille", "Part-Dieu", "Gare du Nord", "Confluence", "Chartrons", "Wazemmes", "Commerce", "Vieux-Port", "Nation", "Brotteaux"];
const TOPICS = [
  "the badge activation delay at the new hubs",
  "the charger firmware rollout to the canary group",
  "the support backlog after the price change",
  "the restore test of the first Wednesday",
  "the onboarding plan for the two new technicians",
  "the reserved slots for the Network customers",
  "the status page wording during incidents",
  "the home office allowance for the Lyon team",
  "the phishing test results for the quarter",
  "the deletion job report of Monday",
];
const DECISIONS = [
  "Keep the deployment window as it is and review it in January.",
  "Move the weekly planning to Monday at 09:30 from next week.",
  "Add the hub reference to every expense claim for a site visit.",
  "Run the next restore test with the secondary on call, as the runbook says.",
  "Turn the reserved-slot credit on for the two customers who asked.",
  "Write the incident review before Friday and read it at the company meeting.",
  "Order ten more badges for the trial customers in Lyon.",
  "Hold the firmware rollout until the canary group has a clean week.",
];
const ACTIONS = [
  "update the runbook with the new restart order",
  "send the credit note to the account owner",
  "book the train for the Lille site visit",
  "check the fridge sheet template with the Lyon depot",
  "ask IT for two 16-inch laptops for the firmware team",
  "draft the status page template for a hub outage",
  "review the quarterly access list with the team leads",
  "measure the badge activation delay on the Bordeaux hubs",
];

function meetingNote(r: ReturnType<typeof rng>, people: string[], on: Date, kind: "planning" | "safety" | "customer"): { title: string; body: string } {
  const date = on.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const attendees = r.shuffle(people).slice(0, r.int(3, 6));
  const city = r.pick(CITIES);
  const hub = r.pick(HUB_WORDS);
  const titles = { planning: `Weekly planning, ${date}`, safety: `Monthly safety review, ${date}`, customer: `Customer review ${city}, ${date}` };
  const notes = [
    `${r.pick(attendees)} reported on ${r.pick(TOPICS)}. The ${hub} hub in ${city} had ${r.int(0, 3)} offline minutes this week and ${r.int(40, 400)} badge events a day.`,
    `The team discussed ${r.pick(TOPICS)} and agreed that the ${city} depot would ${r.pick(ACTIONS)}.`,
    `${r.pick(attendees)} raised ${r.pick(TOPICS)}; nobody objected to trying it for two weeks.`,
  ];
  const body = [
    `# ${titles[kind]}`,
    "",
    `Attendees: ${attendees.join(", ")}. Notes taken by ${r.pick(attendees)}.`,
    "",
    "## Decisions",
    "",
    ...r.shuffle(DECISIONS).slice(0, r.int(1, 3)).map((d) => `- ${d}`),
    "",
    "## Actions",
    "",
    ...r.shuffle(ACTIONS).slice(0, r.int(2, 4)).map((a) => `- ${r.pick(attendees)} will ${a} by ${new Date(on.getTime() + r.int(3, 14) * DAY).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}.`),
    "",
    "## Notes",
    "",
    r.shuffle(notes).slice(0, 2).join(" "),
    "",
  ].join("\n");
  return { title: titles[kind], body };
}

function fieldNote(r: ReturnType<typeof rng>, on: Date): { title: string; body: string } {
  const city = r.pick(CITIES);
  const hub = r.pick(HUB_WORDS);
  const date = on.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const title = `Site visit ${hub}, ${city}, ${date}`;
  const body = [
    `# ${title}`,
    "",
    `Arrived at ${r.int(7, 10)}:${r.pick(["00", "15", "30", "45"])}. The ${hub} hub has ${r.int(6, 16)} slots and ${r.int(1, 4)} were reported as not charging.`,
    "",
    "## What I found",
    "",
    `Slot ${r.int(1, 16)} had a loose connector on the charger side; tightened and tested with a courier's bike. The modem showed ${r.int(1, 5)} reconnections overnight, which matches the fleet service log. The door sensor on the left side needed cleaning.`,
    "",
    "## Follow-up",
    "",
    `- Order a replacement connector for slot ${r.int(1, 16)}.`,
    `- Ask the city for the power cabinet key; the current one is bent.`,
    `- Next visit in ${r.int(2, 6)} weeks unless the hub pages again.`,
    "",
  ].join("\n");
  return { title, body };
}

/* ---------- the generator ---------- */

export async function generateSeed(options: SeedOptions = {}): Promise<SeedData> {
  const r = rng(options.seed ?? 1);
  const now = options.now ?? new Date("2026-11-18T18:00:00Z");
  const from = new Date(now.getTime() - 180 * DAY);
  const id = ids();
  const between = (a: Date, b: Date) => new Date(a.getTime() + Math.floor(r.next() * (b.getTime() - a.getTime())));
  const month = (d: Date) => d.toISOString().slice(0, 7);

  const data: SeedData = {
    workspaces: [], users: [], memberships: [], invitations: [], models: [], modelPrices: [], libraries: [], documents: [], chunks: [],
    agents: [], agentVersions: [], agentVersionLibraries: [], shareRequests: [], conversations: [], messages: [], citations: [],
    usageEvents: [], budgets: [], scheduledPrompts: [], scheduledRuns: [], auditLog: [],
  };
  const audit = (workspaceId: string, actorId: string | null, action: string, entityKind: string, entityId: string, at: Date, before: unknown = null, after: unknown = null, reason: string | null = null) => {
    data.auditLog.push({ id: id("aud"), workspaceId, actorId, action, entityKind, entityId, before, after, reason, at });
  };

  // Workspaces.
  const oriel: Row<"workspaces"> = { id: id("ws"), slug: "oriel", name: "Oriel", tools: { groundedAnswers: true, scheduledPrompts: true, uploads: true }, retentionDays: 90, createdAt: new Date(from.getTime() - 30 * DAY) };
  const brindille: Row<"workspaces"> = { id: id("ws"), slug: "brindille", name: "Brindille", tools: { groundedAnswers: true, scheduledPrompts: false, uploads: true }, retentionDays: 30, createdAt: new Date(from.getTime() - 10 * DAY) };
  data.workspaces.push(oriel, brindille);

  // Users: every seeded account signs in with the demo password; one hash, one fixed salt, so the seed stays deterministic.
  const demoHash = await hashPassword(DEMO_PASSWORD, new Uint8Array(16).fill(11));
  const usedEmails = new Set<string>();
  const newUser = (name: string, email: string, createdAt: Date): Row<"users"> => {
    const u = { id: id("usr"), email, name, passwordHash: demoHash, createdAt };
    usedEmails.add(email);
    data.users.push(u);
    return u;
  };
  const generatedUser = (createdAt: Date): Row<"users"> => {
    for (;;) {
      const first = r.pick(FIRST);
      const last = r.pick(LAST);
      const email = `${slugify(first)}.${slugify(last)}@example.com`;
      if (!usedEmails.has(email)) return newUser(`${first} ${last}`, email, createdAt);
    }
  };
  const member = (ws: Row<"workspaces">, user: Row<"users">, role: "member" | "admin", status: "active" | "suspended" = "active"): Row<"memberships"> => {
    const m = { id: id("mem"), workspaceId: ws.id, userId: user.id, role, status, createdAt: new Date(Math.max(user.createdAt.getTime(), ws.createdAt.getTime())) };
    data.memberships.push(m);
    return m;
  };

  const lea = newUser(DEMO_ACCOUNTS[0]!.name, DEMO_ACCOUNTS[0]!.email, oriel.createdAt);
  const tom = newUser(DEMO_ACCOUNTS[1]!.name, DEMO_ACCOUNTS[1]!.email, oriel.createdAt);
  const noor = newUser(DEMO_ACCOUNTS[2]!.name, DEMO_ACCOUNTS[2]!.email, oriel.createdAt);
  member(oriel, lea, "member");
  member(oriel, tom, "member");
  member(oriel, noor, "admin");
  const orielOthers = Array.from({ length: 31 }, () => generatedUser(between(oriel.createdAt, new Date(now.getTime() - 20 * DAY))));
  const yanis = orielOthers[0]!;
  const sales = orielOthers[1]!;
  const secOwner = orielOthers[2]!;
  const opsOwner = orielOthers[3]!;
  const secondAdmin = orielOthers[4]!;
  orielOthers.forEach((u, i) => member(oriel, u, i === 4 ? "admin" : "member", i >= 29 ? "suspended" : "active"));
  const brindilleUsers = Array.from({ length: 12 }, () => generatedUser(between(brindille.createdAt, new Date(now.getTime() - 20 * DAY))));
  const brindilleAdmin = brindilleUsers[0]!;
  brindilleUsers.forEach((u, i) => member(brindille, u, i === 0 ? "admin" : "member"));
  for (const m of data.memberships) {
    if (m.status === "suspended") audit(m.workspaceId, noor.id, "membership.suspended", "membership", m.id, between(m.createdAt, now), { status: "active" }, { status: "suspended" }, "Left the company");
  }

  // Invitations.
  const invitation = (ws: Row<"workspaces">, by: Row<"users">, status: Row<"invitations">["status"], createdAt: Date, accepted?: Row<"users">) => {
    const email = accepted?.email ?? `${slugify(r.pick(FIRST))}.${slugify(r.pick(LAST))}.${data.invitations.length}@example.com`;
    const inv: Row<"invitations"> = { id: id("inv"), workspaceId: ws.id, email, role: "member", tokenHash: `seed-${data.invitations.length.toString(36)}`, status, invitedBy: by.id, acceptedUserId: accepted?.id ?? null, createdAt, expiresAt: new Date(createdAt.getTime() + 7 * DAY) };
    data.invitations.push(inv);
    audit(ws.id, by.id, "invitation.sent", "invitation", inv.id, createdAt, null, { email, role: "member" });
    if (status === "accepted") audit(ws.id, accepted!.id, "invitation.accepted", "invitation", inv.id, new Date(createdAt.getTime() + DAY));
    if (status === "revoked") audit(ws.id, by.id, "invitation.revoked", "invitation", inv.id, new Date(createdAt.getTime() + 2 * DAY));
  };
  invitation(oriel, noor, "accepted", new Date(orielOthers[10]!.createdAt.getTime() - DAY), orielOthers[10]);
  invitation(oriel, noor, "accepted", new Date(orielOthers[11]!.createdAt.getTime() - DAY), orielOthers[11]);
  invitation(oriel, noor, "sent", new Date(now.getTime() - 2 * DAY));
  invitation(oriel, secondAdmin, "sent", new Date(now.getTime() - 1 * DAY));
  invitation(oriel, noor, "revoked", new Date(now.getTime() - 30 * DAY));
  invitation(oriel, noor, "expired", new Date(now.getTime() - 45 * DAY));
  invitation(brindille, brindilleAdmin, "sent", new Date(now.getTime() - 3 * DAY));

  // Models and their prices (micro-dollars per thousand tokens, from the public price list).
  const models: Row<"models">[] = [
    { id: "large-4", name: "Large 4", contextTokens: 128_000, enabled: true },
    { id: "small-4", name: "Small 4", contextTokens: 128_000, enabled: true },
    { id: "mini-14b", name: "Mini 14B", contextTokens: 32_000, enabled: true },
    { id: "mini-8b", name: "Mini 8B", contextTokens: 32_000, enabled: true },
    { id: "code-1", name: "Code 1", contextTokens: 32_000, enabled: true },
    { id: "mini-3b", name: "Mini 3B", contextTokens: 32_000, enabled: false },
  ];
  data.models.push(...models);
  const priceStart = new Date(from.getTime() - 60 * DAY);
  const priceChange = new Date("2026-09-01T00:00:00Z");
  const addPrice = (modelId: string, kind: PriceKind, microsPer1k: number, validFrom: Date, validTo: Date | null) => {
    data.modelPrices.push({ id: id("prc"), modelId, kind, microsPer1k, validFrom, validTo });
  };
  const table: Record<string, [number, number, number]> = { "large-4": [700, 70, 2100], "small-4": [150, 15, 600], "mini-14b": [200, 20, 200], "mini-8b": [150, 15, 150], "code-1": [300, 30, 900], "mini-3b": [100, 10, 100] };
  for (const [modelId, [input, cached, output]] of Object.entries(table)) {
    if (modelId === "large-4") {
      // The price changed on 1 September: the usage before it is costed at the old price.
      addPrice(modelId, "input", 500, priceStart, priceChange);
      addPrice(modelId, "input", input, priceChange, null);
      addPrice(modelId, "cached_input", 50, priceStart, priceChange);
      addPrice(modelId, "cached_input", cached, priceChange, null);
      addPrice(modelId, "output", 1500, priceStart, priceChange);
      addPrice(modelId, "output", output, priceChange, null);
    } else {
      addPrice(modelId, "input", input, priceStart, null);
      addPrice(modelId, "cached_input", cached, priceStart, null);
      addPrice(modelId, "output", output, priceStart, null);
    }
  }
  const prices: ModelPrice[] = data.modelPrices;

  // Libraries.
  const library = (ws: Row<"workspaces">, owner: Row<"users">, name: string, description: string, visibility: "private" | "workspace", createdAt: Date): Row<"libraries"> => {
    const lib: Row<"libraries"> = { id: id("lib"), workspaceId: ws.id, ownerId: owner.id, slug: slugify(name), name, description, visibility, createdAt, updatedAt: createdAt };
    data.libraries.push(lib);
    audit(ws.id, owner.id, "library.created", "library", lib.id, createdAt, null, { name, visibility: "private" });
    return lib;
  };
  const early = (days: number) => new Date(from.getTime() + days * DAY);
  const handbook = library(oriel, noor, "Handbook", "The rules of working at Oriel: leave, expenses, remote work, onboarding, security, privacy.", "workspace", early(1));
  const runbooks = library(oriel, yanis, "Runbooks", "How the platform is run: on-call, deploying, backups.", "workspace", early(3));
  const product = library(oriel, sales, "Product and pricing", "The public price list and the support promises.", "workspace", early(5));
  const meetings = library(oriel, noor, "Meeting notes", "Weekly planning, safety reviews and customer reviews, one note per meeting.", "workspace", early(2));
  const fieldNotes = library(oriel, tom, "Field notes", "Tom's notes from hub site visits.", "private", early(20));
  const leaDrafts = library(oriel, lea, "Drafts", "Léa's working documents.", "private", early(40));
  const opsScratch = library(oriel, opsOwner, "Ops scratchpad", "Notes from the operations desk, not yet reviewed.", "private", early(60));
  const security = library(oriel, secOwner, "Security notes", "Working notes of the security review.", "private", early(70));
  const manual = library(brindille, brindilleAdmin, "Shop manual", "Opening, hygiene and the rota, for every Brindille bakery.", "workspace", early(8));
  const rota = library(brindille, brindilleUsers[1]!, "Rota notes", "Notes on the weekly rota.", "private", early(50));

  // Share requests and their audit rows.
  const share = (subjectKind: "library" | "agent", subjectId: string, workspaceId: string, by: Row<"users">, status: Row<"shareRequests">["status"], createdAt: Date, admin: Row<"users"> | null, reason: string | null = null) => {
    const req: Row<"shareRequests"> = { id: id("shr"), workspaceId, subjectKind, subjectId, requestedBy: by.id, status, reason, decidedBy: status === "approved" || status === "declined" ? admin!.id : null, createdAt, decidedAt: status === "requested" ? null : new Date(createdAt.getTime() + r.int(2, 48) * HOUR) };
    data.shareRequests.push(req);
    audit(workspaceId, by.id, "share.requested", "share_request", req.id, createdAt, null, { subjectKind, subjectId });
    if (status !== "requested") audit(workspaceId, status === "withdrawn" ? by.id : admin!.id, `share.${status}`, "share_request", req.id, req.decidedAt!, { status: "requested" }, { status }, reason);
    return req;
  };
  share("library", runbooks.id, oriel.id, yanis, "approved", early(4), noor);
  share("library", product.id, oriel.id, sales, "approved", early(6), noor);
  share("library", opsScratch.id, oriel.id, opsOwner, "requested", new Date(now.getTime() - 3 * DAY), null);
  share("library", security.id, oriel.id, secOwner, "declined", early(75), noor, "Working notes of a review are not for everyone; publish the outcome in the handbook instead.");
  share("library", leaDrafts.id, oriel.id, lea, "withdrawn", early(45), null);
  share("library", rota.id, brindille.id, brindilleUsers[1]!, "requested", new Date(now.getTime() - 5 * DAY), null);

  // Documents: the hand-written corpus, then generated notes for volume.
  const libraryFor: Record<string, Row<"libraries">> = {
    "leave-and-time-off": handbook, "expenses-and-travel": handbook, "remote-work-and-equipment": handbook, "onboarding-first-week": handbook, "security-and-passwords": handbook, "data-retention-and-privacy": handbook,
    "on-call-and-incidents": runbooks, "deploying-the-platform": runbooks, "backups-and-restore": runbooks,
    "pricing-and-plans": product, "support-slas": product,
    "hygiene-rules": manual, "opening-checklist": manual, "staffing-rota": manual,
  };
  const document = (lib: Row<"libraries">, by: Row<"users">, title: string, sourceName: string, body: string, createdAt: Date, status: Row<"documents">["status"] = "indexed", version = 1): Row<"documents"> => {
    const doc: Row<"documents"> = {
      id: id("doc"), libraryId: lib.id, title, sourceName, mime: "text/markdown", byteSize: new TextEncoder().encode(body).length, charCount: body.length, body, status,
      error: status === "failed" ? "The file is empty after trimming." : null, version, uploadedBy: by.id, createdAt, indexedAt: status === "indexed" ? new Date(createdAt.getTime() + r.int(1, 30) * 1000) : null,
    };
    data.documents.push(doc);
    audit(lib.workspaceId, by.id, "document.uploaded", "document", doc.id, createdAt, null, { title, libraryId: lib.id });
    if (status === "indexed") {
      for (const c of chunkText(body)) {
        data.chunks.push({ id: id("chk"), documentId: doc.id, ordinal: c.ordinal, headingPath: c.headingPath, headingText: c.headingPath.join(" > "), startChar: c.start, endChar: c.end, tokenCount: c.tokens, body: c.body });
      }
      audit(lib.workspaceId, null, "document.indexed", "document", doc.id, doc.indexedAt!, { status: "processing" }, { status: "indexed" });
    }
    return doc;
  };
  for (const c of corpus) {
    const lib = libraryFor[c.slug]!;
    document(lib, lib.ownerId === noor.id ? noor : data.users.find((u) => u.id === lib.ownerId)!, c.title, `${c.slug}.md`, c.body, between(lib.createdAt, new Date(lib.createdAt.getTime() + 10 * DAY)), "indexed", c.slug === "expenses-and-travel" ? 2 : 1);
  }
  const orielNames = [lea, tom, noor, ...orielOthers].map((u) => u.name.split(" ")[0]!);
  for (let i = 0; i < 48; i++) {
    const on = new Date(from.getTime() + Math.floor((i / 48) * 170) * DAY);
    const kind = i % 4 === 3 ? "safety" : i % 7 === 5 ? "customer" : "planning";
    const note = meetingNote(r, orielNames, on, kind);
    document(meetings, noor, note.title, `${slugify(note.title)}.md`, note.body, new Date(on.getTime() + 3 * HOUR));
  }
  for (let i = 0; i < 5; i++) {
    const on = new Date(fieldNotes.createdAt.getTime() + i * 25 * DAY);
    const note = fieldNote(r, on);
    document(fieldNotes, tom, note.title, `${slugify(note.title)}.md`, note.body, new Date(on.getTime() + 6 * HOUR));
  }
  document(leaDrafts, lea, "Draft: a one-page guide to expenses", "expenses-one-pager.md", "# Draft: a one-page guide to expenses\n\nA shorter version of the expenses page for new starters.\n\n## The three rules\n\nKeep the receipt. Claim within 30 days. Ask before a client meal.\n\n## Travel\n\nTrain in second class through the travel tool; taxis only early, late or with equipment. Meals up to 25 euros at lunch and 35 at dinner.\n", early(41));
  document(leaDrafts, lea, "Draft: questions for the onboarding survey", "onboarding-survey.md", "# Draft: questions for the onboarding survey\n\nTen questions to ask every new starter at the end of the first month.\n\n- Did the laptop arrive set up before day one?\n- Was the first project clear by Monday evening?\n- Did you meet your buddy in the first week?\n- Which runbook was hardest to follow?\n- What would you remove from the first week?\n", early(55));
  document(leaDrafts, lea, "Empty upload", "empty.md", "", early(58), "failed");
  for (let i = 0; i < 3; i++) {
    const note = meetingNote(r, orielNames, early(62 + i * 20), "planning");
    document(opsScratch, opsOwner, `Ops desk: ${note.title}`, `ops-${i}.md`, note.body.replace(/^# .*$/m, `# Ops desk: ${note.title}`), early(62 + i * 20));
  }
  document(security, secOwner, "Access review, third quarter", "access-review-q3.md", "# Access review, third quarter\n\nThe quarterly review of who can reach what, done with the team leads in the first week of October.\n\n## Findings\n\nTwo service accounts had no owner in the inventory and were assigned to the fleet team. Four people kept production access after moving teams; access was removed the same day. The bastion session recordings are complete for the quarter.\n\n## Next quarter\n\nAutomate the comparison between the HR system and the access list so a team move removes access on the day.\n", early(72));
  document(security, secOwner, "Phishing test, October", "phishing-october.md", "# Phishing test, October\n\nThe quarterly test went to every mailbox on a Tuesday morning as a fake expense-tool reminder.\n\n## Results\n\nThe report button was used by 61 % of people within an hour. 9 % clicked the link; 2 % entered credentials on the fake page, and those credentials were rotated the same day. Results are shared by team, never by name.\n", early(100));
  document(opsScratch, opsOwner, "Checklist for the Lille opening", "lille-opening.md", "# Checklist for the Lille opening\n\nStill being written; not for the handbook yet.\n", new Date(now.getTime() - HOUR), "uploaded");
  for (let i = 0; i < 3; i++) {
    const note = meetingNote(r, brindilleUsers.map((u) => u.name.split(" ")[0]!), early(52 + i * 30), "planning");
    document(rota, brindilleUsers[1]!, `Rota: ${note.title}`, `rota-${i}.md`, note.body.replace(/^# .*$/m, `# Rota: ${note.title}`), early(52 + i * 30));
  }
  for (const d of data.documents) {
    if (d.version > 1) audit(data.libraries.find((l) => l.id === d.libraryId)!.workspaceId, d.uploadedBy, "document.replaced", "document", d.id, new Date(d.createdAt.getTime() + 20 * DAY), { version: 1 }, { version: d.version });
  }

  // Agents and their versions.
  const canRead = (userId: string, lib: Row<"libraries">) => lib.ownerId === userId || lib.visibility === "workspace";
  const agent = (ws: Row<"workspaces">, owner: Row<"users">, name: string, description: string, instructions: string, visibility: "private" | "workspace", libs: Row<"libraries">[], createdAt: Date, versions: number, status: "active" | "archived" = "active", draftOnTop = false): Row<"agents"> => {
    const a: Row<"agents"> = { id: id("agt"), workspaceId: ws.id, ownerId: owner.id, slug: slugify(name), name, visibility, status, currentVersionId: null, createdAt, archivedAt: status === "archived" ? new Date(now.getTime() - 15 * DAY) : null };
    data.agents.push(a);
    audit(ws.id, owner.id, "agent.created", "agent", a.id, createdAt, null, { name });
    for (let v = 1; v <= versions; v++) {
      const at = new Date(createdAt.getTime() + (v - 1) * 25 * DAY);
      const isDraft = draftOnTop && v === versions;
      const isCurrent = !isDraft && (draftOnTop ? v === versions - 1 : v === versions);
      const ver: Row<"agentVersions"> = {
        id: id("agv"), agentId: a.id, version: v, name, description, instructions: v === 1 ? instructions : `${instructions} Keep answers short and always cite the page.`,
        modelId: r.pick(models.filter((m) => m.enabled)).id, maxContextTokens: r.pick([4000, 6000, 8000]),
        status: isDraft ? "draft" : isCurrent ? "published" : "retired", createdBy: owner.id, createdAt: at, publishedAt: isDraft ? null : new Date(at.getTime() + HOUR),
      };
      data.agentVersions.push(ver);
      for (const lib of libs) if (canRead(owner.id, lib)) data.agentVersionLibraries.push({ agentVersionId: ver.id, libraryId: lib.id });
      if (!isDraft) audit(ws.id, owner.id, "agent.published", "agent_version", ver.id, ver.publishedAt!, { status: "draft" }, { status: "published", version: v });
      if (isCurrent) a.currentVersionId = ver.id;
    }
    if (status === "archived") audit(ws.id, owner.id, "agent.archived", "agent", a.id, a.archivedAt!, { status: "active" }, { status: "archived" });
    return a;
  };
  const handbookHelper = agent(oriel, noor, "Handbook helper", "Answers questions about leave, expenses, remote work and the first week.", "You answer questions about working at Oriel using the handbook only. Say which page the answer comes from.", "workspace", [handbook], early(2), 2);
  const opsAssistant = agent(oriel, yanis, "Ops assistant", "The runbooks and the handbook, for the on-call engineer.", "You help the on-call engineer. Quote the runbook step by step and never guess a command.", "workspace", [runbooks, handbook], early(5), 3, "active", true);
  const salesAnswers = agent(oriel, sales, "Sales answers", "Prices, plans and support promises for customer calls.", "You answer questions a customer might ask about plans, prices and support. Use the price list only.", "workspace", [product], early(7), 1);
  const meetingRecap = agent(oriel, noor, "Meeting recap", "What was decided in the planning and safety meetings.", "You summarise decisions and actions from the meeting notes with the date of the meeting.", "workspace", [meetings, handbook], early(10), 2);
  const tomAgent = agent(oriel, tom, "Field agent", "Tom's site visits and the runbooks.", "You answer from the field notes and the runbooks, for one technician.", "private", [fieldNotes, runbooks], early(22), 1);
  const leaAgent = agent(oriel, lea, "Drafts helper", "Léa's drafts next to the handbook.", "You help compare a draft with the handbook page it shortens.", "private", [leaDrafts, handbook], early(42), 2);
  const secAgent = agent(oriel, secOwner, "Security review", "The security review notes.", "You answer from the security review notes only.", "private", [security, handbook], early(74), 1);
  agent(oriel, noor, "Old onboarding bot", "The first onboarding assistant, replaced by Handbook helper.", "You answer questions about the first week.", "workspace", [handbook], early(0), 1, "archived");
  const shopHelper = agent(brindille, brindilleAdmin, "Shop helper", "Opening, hygiene and rota questions for every shop.", "You answer from the shop manual, in plain words, for people on their feet.", "workspace", [manual], early(9), 1);
  const rotaHelper = agent(brindille, brindilleUsers[1]!, "Rota helper", "Notes on the rota.", "You answer from the rota notes.", "private", [rota, manual], early(51), 1);
  share("agent", opsAssistant.id, oriel.id, yanis, "approved", early(6), noor);
  share("agent", salesAnswers.id, oriel.id, sales, "approved", early(8), noor);
  share("agent", secAgent.id, oriel.id, secOwner, "requested", new Date(now.getTime() - 2 * DAY), null);

  // Conversations: every active member asks the agents they may use; answers quote chunks they may read.
  const chunksByDoc = new Map<string, Row<"chunks">[]>();
  for (const c of data.chunks) chunksByDoc.set(c.documentId, [...(chunksByDoc.get(c.documentId) ?? []), c]);
  const docsByLib = new Map<string, Row<"documents">[]>();
  for (const d of data.documents) if (d.status === "indexed") docsByLib.set(d.libraryId, [...(docsByLib.get(d.libraryId) ?? []), d]);
  const libsOfVersion = (versionId: string) => data.agentVersionLibraries.filter((l) => l.agentVersionId === versionId).map((l) => data.libraries.find((x) => x.id === l.libraryId)!);
  const versionAt = (a: Row<"agents">, at: Date): Row<"agentVersions"> => {
    const published = data.agentVersions.filter((v) => v.agentId === a.id && v.publishedAt !== null && v.publishedAt.getTime() <= at.getTime()).sort((x, y) => y.version - x.version);
    return published[0] ?? data.agentVersions.find((v) => v.id === a.currentVersionId)!;
  };
  const QUESTIONS = [
    (title: string, word: string) => `What does "${title}" say about ${word}?`,
    (_title: string, word: string) => `Can you remind me how ${word} works here?`,
    (_title: string, word: string) => `What is the rule on ${word}?`,
    (title: string) => `Summarise ${title} in a few lines.`,
    (_title: string, word: string) => `Where do I find the details on ${word}?`,
  ];
  const keyword = (text: string) => {
    const words = text.toLowerCase().match(/[a-zéèêàçùï]{5,}/g) ?? ["this"];
    return words.sort((a, b) => b.length - a.length)[0]!;
  };
  const REFUSALS: Record<string, string> = {
    budget_exhausted: "The workspace has used its token budget for the month. An admin can raise it in Settings.",
    rate_limited: "You have sent many questions in the last minute. Wait a moment and try again.",
    no_sources: "I could not find anything in the libraries this agent reads about that. Try other words, or add the document to a library.",
  };
  const usedTitles = new Set<string>();
  const conversation = (ws: Row<"workspaces">, user: Row<"users">, a: Row<"agents">, createdAt: Date, turns: number, status: Row<"conversations">["status"], scheduled = false) => {
    const version = versionAt(a, createdAt);
    const readable = libsOfVersion(version.id).filter((l) => canRead(user.id, l));
    const docs = readable.flatMap((l) => docsByLib.get(l.id) ?? []);
    if (docs.length === 0) return null;
    const conv: Row<"conversations"> = { id: id("cnv"), workspaceId: ws.id, userId: user.id, agentId: a.id, agentVersionId: version.id, title: "", status, messageCount: 0, tokenTotal: 0, createdAt, lastMessageAt: createdAt, archivedAt: null };
    let at = createdAt;
    for (let t = 0; t < turns; t++) {
      const doc = r.pick(docs);
      const chunks = chunksByDoc.get(doc.id)!;
      const first = r.pick(chunks);
      const second = r.chance(0.5) ? r.pick(chunksByDoc.get(r.pick(docs).id)!) : null;
      const picked = second && second.id !== first.id ? [first, second] : [first];
      // A quotable sentence is a real sentence, not a heading or a list marker; two in a row may be quoted together.
      const quotable = (c: Row<"chunks">, s: { start: number; end: number }) => s.end - s.start > 25 && !/^#/.test(c.body.slice(s.start, s.end));
      const lines: string[] = [];
      const cits: { chunk: Row<"chunks">; start: number; end: number }[] = [];
      picked.forEach((c, i) => {
        const ss = splitSentences(c.body);
        const starts = ss.map((s, k) => k).filter((k) => quotable(c, ss[k]!));
        if (starts.length === 0) return;
        const startIdx = r.pick(starts);
        const two = r.chance(0.5) && startIdx + 1 < ss.length && quotable(c, ss[startIdx + 1]!);
        const take = ss.slice(startIdx, startIdx + (two ? 2 : 1));
        const quoteStart = c.startChar + take[0]!.start;
        const quoteEnd = c.startChar + take[take.length - 1]!.end;
        const owner = data.documents.find((x) => x.id === c.documentId)!;
        lines.push(`${owner.body.slice(quoteStart, quoteEnd)} [${i + 1}]`);
        cits.push({ chunk: c, start: quoteStart, end: quoteEnd });
      });
      if (lines.length === 0) continue;
      const firstDoc = data.documents.find((d) => d.id === first.documentId)!;
      const question = scheduled ? `Run: ${a.name}, ${at.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}` : r.pick(QUESTIONS)(firstDoc.title, keyword(doc.body.slice(cits[0]!.start, cits[0]!.end)));
      if (t === 0) conv.title = question.length > 60 ? `${question.slice(0, 57)}...` : question;
      const userMessage: Row<"messages"> = { id: id("msg"), conversationId: conv.id, ordinal: t * 2, role: "user", body: question, status: "complete", refusedReason: null, modelId: null, agentVersionId: null, promptTokens: 0, contextTokens: 0, completionTokens: 0, createdAt: at, completedAt: at };
      at = new Date(at.getTime() + r.int(2, 9) * 1000);
      const outcome = t === turns - 1 && r.chance(0.06) ? r.pick(["budget_exhausted", "rate_limited", "no_sources", "failed"] as const) : "complete";
      const answer = outcome === "complete" || outcome === "failed" ? lines.join("\n") : REFUSALS[outcome]!;
      const promptTokens = outcome === "complete" || outcome === "failed" ? countTokens(`${version.instructions}\n${question}`) : 0;
      const contextTokens = outcome === "complete" || outcome === "failed" ? picked.reduce((n, c) => n + c.tokenCount, 0) : 0;
      const completionTokens = outcome === "complete" ? countTokens(answer) : 0;
      const assistant: Row<"messages"> = {
        id: id("msg"), conversationId: conv.id, ordinal: t * 2 + 1, role: "assistant", body: outcome === "failed" ? "" : answer,
        status: outcome === "complete" ? "complete" : outcome === "failed" ? "failed" : "refused", refusedReason: outcome === "complete" || outcome === "failed" ? null : outcome,
        modelId: version.modelId, agentVersionId: version.id, promptTokens, contextTokens, completionTokens, createdAt: at, completedAt: new Date(at.getTime() + r.int(1, 6) * 1000),
      };
      const messageRows = status === "deleted" ? [] : [userMessage, assistant];
      if (status !== "deleted") data.messages.push(...messageRows);
      if (outcome === "complete" && status !== "deleted") {
        cits.forEach((c, i) => {
          const d = data.documents.find((x) => x.id === c.chunk.documentId)!;
          data.citations.push({ id: id("cit"), messageId: assistant.id, index: i + 1, chunkId: c.chunk.id, documentId: d.id, documentTitle: d.title, documentVersion: d.version, startChar: c.start, endChar: c.end, quote: d.body.slice(c.start, c.end) });
        });
      }
      if (outcome === "complete" || outcome === "failed") {
        const kinds: [PriceKind, number][] = [["input", promptTokens], ["cached_input", contextTokens], ["output", completionTokens]];
        for (const [kind, tokens] of kinds) {
          const price = priceInForce(prices, version.modelId, kind, at)!;
          data.usageEvents.push({ id: id("use"), workspaceId: ws.id, userId: user.id, agentId: a.id, messageId: status === "deleted" ? null : assistant.id, modelId: version.modelId, kind, tokens, microsPer1k: price.microsPer1k, costMicros: costMicros(tokens, price.microsPer1k), occurredAt: at });
        }
      }
      conv.messageCount += 2;
      conv.tokenTotal += promptTokens + contextTokens + completionTokens;
      conv.lastMessageAt = at;
      at = new Date(at.getTime() + r.int(30, 600) * 1000);
    }
    if (conv.messageCount === 0) return null;
    if (status !== "active") conv.archivedAt = new Date(conv.lastMessageAt.getTime() + r.int(1, 20) * DAY);
    usedTitles.add(conv.title);
    data.conversations.push(conv);
    return conv;
  };
  const usable = (ws: Row<"workspaces">, userId: string) => data.agents.filter((a) => a.workspaceId === ws.id && a.status === "active" && a.currentVersionId && (a.ownerId === userId || a.visibility === "workspace"));
  for (const m of data.memberships.filter((x) => x.status === "active")) {
    const ws = data.workspaces.find((w) => w.id === m.workspaceId)!;
    const user = data.users.find((u) => u.id === m.userId)!;
    const agents = usable(ws, user.id);
    const n = ws === oriel ? r.int(14, 26) : r.int(3, 6);
    for (let i = 0; i < n; i++) {
      const createdAt = between(new Date(Math.max(m.createdAt.getTime(), from.getTime())), now);
      const roll = r.next();
      const status = roll < 0.84 ? "active" : roll < 0.96 ? "archived" : "deleted";
      conversation(ws, user, r.pick(agents), createdAt, r.int(1, 4), status);
    }
  }
  void handbookHelper;
  void meetingRecap;
  void tomAgent;
  void leaAgent;
  void shopHelper;
  void rotaHelper;

  // Scheduled prompts and their runs (Oriel only; the tool is off in Brindille).
  const schedule = (user: Row<"users">, a: Row<"agents">, name: string, prompt: string, cadence: Row<"scheduledPrompts">["cadence"], atMinute: number, weekday: number | null, dayOfMonth: number | null, status: Row<"scheduledPrompts">["status"], createdAt: Date) => {
    const s: Row<"scheduledPrompts"> = { id: id("sch"), workspaceId: oriel.id, userId: user.id, agentId: a.id, name, prompt, cadence, atMinute, weekday, dayOfMonth, timezone: "Europe/Paris", nextRunAt: null, status, createdAt, lastRunAt: null };
    data.scheduledPrompts.push(s);
    audit(oriel.id, user.id, "schedule.created", "scheduled_prompt", s.id, createdAt, null, { name, cadence });
    // Runs: one a week since creation for weekly and daily (sampled), one a month for monthly.
    const step = cadence === "monthly" ? 30 * DAY : cadence === "once" ? 0 : 7 * DAY;
    let when = new Date(createdAt.getTime() + DAY);
    let count = 0;
    while (when.getTime() < now.getTime() && count < 12) {
      const roll = r.next();
      const runStatus: Row<"scheduledRuns">["status"] = roll < 0.85 ? "succeeded" : roll < 0.93 ? "failed" : "skipped";
      const conv = runStatus === "succeeded" ? conversation(oriel, user, a, when, 1, "active", true) : null;
      data.scheduledRuns.push({ id: id("run"), scheduledPromptId: s.id, scheduledFor: when, startedAt: runStatus === "skipped" ? null : when, finishedAt: runStatus === "skipped" ? null : new Date(when.getTime() + r.int(3, 20) * 1000), status: conv ? "succeeded" : runStatus === "succeeded" ? "failed" : runStatus, conversationId: conv?.id ?? null, error: conv || runStatus === "skipped" ? null : "The agent's library had no indexed document." });
      s.lastRunAt = when;
      count++;
      if (step === 0) break;
      when = new Date(when.getTime() + step);
    }
    if (status === "active" && cadence !== "once") s.nextRunAt = when;
    if (status === "active" && cadence === "once") s.nextRunAt = new Date(now.getTime() + 2 * DAY);
  };
  schedule(noor, meetingRecap, "Monday recap", "What was decided in last week's planning meeting, and which actions are due this week?", "weekly", 8 * 60 + 30, 1, null, "active", early(30));
  schedule(yanis, opsAssistant, "Restore test reminder", "Remind me of the restore test steps and what to write in the operations channel.", "monthly", 9 * 60, null, 1, "active", early(35));
  schedule(lea, handbookHelper, "Leave rules refresher", "What are the notice periods for requesting leave?", "weekly", 10 * 60, 5, null, "paused", early(50));
  schedule(sales, salesAnswers, "Daily price check", "List the three plans with their badge price and charging rate.", "daily", 7 * 60 + 45, null, null, "active", early(120));
  schedule(tom, tomAgent, "Site visit follow-ups", "Which follow-ups from my site visits are still open?", "weekly", 17 * 60, 4, null, "ended", early(60));
  schedule(noor, handbookHelper, "One-off: year-end leave", "What are the rules for leave between 20 December and 2 January?", "once", 9 * 60, null, null, "active", new Date(now.getTime() - 2 * DAY));

  // Budgets: one per workspace and month in the window, comfortably above what was spent; past months closed.
  const spent = new Map<string, number>();
  for (const u of data.usageEvents) spent.set(`${u.workspaceId}:${month(u.occurredAt)}`, (spent.get(`${u.workspaceId}:${month(u.occurredAt)}`) ?? 0) + u.costMicros);
  for (const ws of data.workspaces) {
    const admin = data.users.find((u) => u.id === data.memberships.find((m) => m.workspaceId === ws.id && m.role === "admin")!.userId)!;
    for (let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)); d.getTime() <= now.getTime(); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
      const key = month(d);
      const used = spent.get(`${ws.id}:${key}`) ?? 0;
      const limit = Math.max(2_000_000, Math.ceil((used * 1.5) / 1_000_000) * 1_000_000);
      const b: Row<"budgets"> = { id: id("bud"), workspaceId: ws.id, month: key, limitMicros: limit, status: key < month(now) ? "closed" : "open", setBy: admin.id, createdAt: new Date(Math.max(d.getTime() - 2 * DAY, ws.createdAt.getTime())) };
      data.budgets.push(b);
      audit(ws.id, admin.id, "budget.set", "budget", b.id, b.createdAt, null, { month: key, limitMicros: limit });
      if (b.status === "closed") audit(ws.id, null, "budget.closed", "budget", b.id, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)), { status: "open" }, { status: "closed" });
    }
  }

  // Stable order: by id within each table, so two runs compare equal row by row.
  for (const key of Object.keys(data) as (keyof SeedData)[]) {
    const rows = data[key] as { id?: string; agentVersionId?: string; libraryId?: string }[];
    rows.sort((a, b) => (a.id ?? `${a.agentVersionId}:${a.libraryId}`).localeCompare(b.id ?? `${b.agentVersionId}:${b.libraryId}`));
  }
  return data;
}

/** Loads the seed into an empty database in dependency order. A database that already has the workspaces is left alone. */
export async function seedDatabase(db: Db, data: SeedData): Promise<void> {
  const existing = await db.select({ id: schema.workspaces.id }).from(schema.workspaces).limit(1);
  if (existing.length > 0) return;
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const insert = async <T extends object>(table: Parameters<Db["insert"]>[0], rows: T[], size = 200) => {
      for (let i = 0; i < rows.length; i += size) await t.insert(table).values(rows.slice(i, i + size) as never);
    };
    await insert(schema.workspaces, data.workspaces);
    await insert(schema.users, data.users);
    await insert(schema.memberships, data.memberships);
    await insert(schema.invitations, data.invitations);
    await insert(schema.models, data.models);
    await insert(schema.modelPrices, data.modelPrices);
    await insert(schema.libraries, data.libraries);
    await insert(schema.documents, data.documents, 50);
    await insert(schema.chunks, data.chunks, 100);
    await insert(schema.agents, data.agents.map((a) => ({ ...a, currentVersionId: null })));
    await insert(schema.agentVersions, data.agentVersions);
    for (const a of data.agents) if (a.currentVersionId) await t.update(schema.agents).set({ currentVersionId: a.currentVersionId }).where(eq(schema.agents.id, a.id));
    await insert(schema.agentVersionLibraries, data.agentVersionLibraries);
    await insert(schema.shareRequests, data.shareRequests);
    await insert(schema.conversations, data.conversations);
    await insert(schema.messages, data.messages);
    await insert(schema.citations, data.citations);
    await insert(schema.usageEvents, data.usageEvents);
    await insert(schema.budgets, data.budgets);
    await insert(schema.scheduledPrompts, data.scheduledPrompts);
    await insert(schema.scheduledRuns, data.scheduledRuns);
    await insert(schema.auditLog, data.auditLog);
  });
}
