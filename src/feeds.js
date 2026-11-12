// The SEC's daily compilation feeds from adviserinfo.sec.gov: every registered investment adviser
// firm (IA_FIRM_SEC_Feed, IA_FIRM_STATE_Feed) and every investment adviser representative
// (IA_INDVL_Feed), as XML. Each record is parsed on its own, so a whole feed is never in memory.
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { createGunzip } from "node:zlib";
import { download, get } from "./http.js";
import { NOT_A_WEBSITE } from "./not-a-website.js";

export const FEED_BASE = "https://reports.adviserinfo.sec.gov/reports/CompilationReports";
export const FEEDS = {
  sec: { name: "IA_FIRM_SEC_Feed", patterns: ["IA_FIRM_SEC_Feed_{date}.xml.gz"] },
  state: { name: "IA_FIRM_STATE_Feed", patterns: ["IA_FIRM_STATE_Feed_{date}.xml.gz"] },
  advisors: { name: "IA_INDVL_Feed", patterns: ["IA_INDVL_Feed_{date}.xml.zip", "IA_INDVL_Feed_{date}.xml.gz", "IA_INDVL_Feed_{date}.zip"] },
};

// ── XML helpers ─────────────────────────────────────────────────────────────

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");
export const attrOf = (el, name) => {
  const m = el?.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? decode(m[1]).trim() || null : null;
};
export const attr = (xml, tag, name) => attrOf(xml.match(new RegExp(`<${tag}\\b[^>]*>`))?.[0], name);
const tags = (xml, tag) => xml.match(new RegExp(`<${tag}\\b[^>]*>`, "g")) ?? [];
const int = (v) => (v != null && /^\d+$/.test(v) ? Number(v) : null);
const yn = (v) => (v === "Y" ? true : v === "N" ? false : null);
const isDate = (d) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);

// Each <tag>…</tag> in a stream of XML (the feeds are ISO-8859-1).
export async function* records(stream, tag) {
  const close = `</${tag}>`, open = `<${tag}>`;
  let buf = "";
  for await (const chunk of stream) {
    buf += typeof chunk === "string" ? chunk : chunk.toString("latin1");
    let end;
    while ((end = buf.indexOf(close)) !== -1) {
      yield buf.slice(buf.lastIndexOf(open, end), end);
      buf = buf.slice(end + close.length);
    }
  }
}

// ── Firms ───────────────────────────────────────────────────────────────────

// "https://wisdom.EdwardJones.com/x" → "edwardjones.com" (the registrable domain).
export function domainOf(url) {
  const host = url.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").split(/[/?#:]/)[0].replace(/\.$/, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return null;
  const parts = host.split(".");
  const two = /^((co|com|org|net|gov|ac)\.[a-z]{2}|us\.com)$/.test(parts.slice(-2).join(".")) ? 3 : 2;   // firm.co.uk, firm.us.com
  return parts.slice(-two).join(".");
}
const squash = (s) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

// A firm lists many web addresses (its own, product sites, social pages). Keeps all its own domains,
// and picks as its website the one that best matches its name, then the most listed, then the shortest.
export function firmSites(xml, name) {
  const urls = [...xml.matchAll(/<WebAddr>([^<]*)<\/WebAddr>/g)].map((m) => decode(m[1]).trim());
  const counts = new Map(), firstUrl = new Map();
  for (const u of urls) {
    const d = domainOf(u);
    // A directory's or social site's domain, unless it is the firm's own (Zoe Financial: zoefin.com).
    const label = d?.split(".")[0].replace(/[^a-z0-9]/g, "") ?? "";
    if (!d || (NOT_A_WEBSITE.test(d) && !(label.length >= 6 && squash(name).startsWith(label)))) continue;
    counts.set(d, (counts.get(d) ?? 0) + 1);
    if (!firstUrl.has(d) || u.toLowerCase().replace(/^[a-z]+:\/\/(www\.)?/, "").split("/")[0] === d) firstUrl.set(d, u);
  }
  const key = squash(name);
  const prefix = (label) => { let i = 0; while (i < label.length && label[i] === key[i]) i++; return i; };
  const ranked = [...counts.keys()].sort((a, b) =>
    prefix(b.split(".")[0]) - prefix(a.split(".")[0]) || counts.get(b) - counts.get(a) || a.length - b.length);
  const best = ranked[0] ?? null;
  const host = best ? firstUrl.get(best).toLowerCase().replace(/^[a-z]+:\/\//, "").split(/[/?#:]/)[0] : null;
  return { website: host ? `https://${host}` : null, domain: best, domains: ranked };
}

const sumOf = (xml, a, b) => {
  const x = int(attr(xml, "Item5D", a)), y = int(attr(xml, "Item5D", b));
  return x == null && y == null ? null : (x ?? 0) + (y ?? 0);
};

// Wealth managers and planners: at least half their regulatory AUM is for individuals and
// high-net-worth individuals (Item 5.D), which leaves out fund and institutional managers. Firms
// without AUM count if they have individual clients or manage portfolios for individuals (5.G).
export function servesIndividuals(xml) {
  const aum = int(attr(xml, "Item5F", "Q5F2C")) ?? 0;
  if (aum > 0) return (sumOf(xml, "Q5DA3", "Q5DB3") ?? 0) >= aum / 2;
  return (sumOf(xml, "Q5DA1", "Q5DB1") ?? 0) > 0 || !!attr(xml, "Item5D", "Q5DA2") || !!attr(xml, "Item5D", "Q5DB2") || attr(xml, "Item5G", "Q5G2") === "Y";
}

export const FIRM_COLUMNS = [
  "crd", "sec_number", "name", "legal_name", "registration", "status", "filed_on", "website", "domain", "domains",
  "street", "street2", "city", "state", "zip", "country", "phone",
  "aum", "accounts", "employees", "advisory_staff", "individual_clients", "individual_aum", "serves_individuals", "financial_planning", "private_funds",
  "fee_aum", "fee_hourly", "fee_subscription", "fee_fixed", "fee_commissions", "fee_performance",
  "mkt_performance", "mkt_specific_advice", "mkt_testimonials", "mkt_endorsements", "mkt_ratings", "mkt_paid", "mkt_hypothetical", "mkt_predecessor",
];

// One <Firm> record: who it is, where, its size (Item 5), how it's paid (5.E) and how it markets itself (5.L).
export function parseFirm(xml, feed = "IA_FIRM_SEC_Feed") {
  const crd = int(attr(xml, "Info", "FirmCrdNb"));
  const name = attr(xml, "Info", "BusNm") ?? attr(xml, "Info", "LegalNm");
  if (!crd || !name) return null;
  const type = attr(xml, "Rgstn", "FirmType");
  const q5l = (k) => yn(attr(xml, "Item5L", k));
  return {
    crd,
    sec_number: attr(xml, "Info", "SECNb"),
    name,
    legal_name: attr(xml, "Info", "LegalNm"),
    registration: feed === "IA_FIRM_STATE_Feed" ? "state" : type === "ERA" ? "era" : "sec",
    status: attr(xml, "Rgstn", "St") ?? attr(xml, "Rgltr", "St"),
    filed_on: attr(xml, "Filing", "Dt"),
    ...firmSites(xml, name),
    street: attr(xml, "MainAddr", "Strt1"),
    street2: attr(xml, "MainAddr", "Strt2"),
    city: attr(xml, "MainAddr", "City"),
    state: attr(xml, "MainAddr", "State"),
    zip: attr(xml, "MainAddr", "PostlCd"),
    country: attr(xml, "MainAddr", "Cntry"),
    phone: attr(xml, "MainAddr", "PhNb"),
    aum: int(attr(xml, "Item5F", "Q5F2C")),
    accounts: int(attr(xml, "Item5F", "Q5F2F")),
    employees: int(attr(xml, "Item5A", "TtlEmp")),
    advisory_staff: int(attr(xml, "Item5B", "Q5B1")),
    individual_clients: sumOf(xml, "Q5DA1", "Q5DB1"),
    individual_aum: sumOf(xml, "Q5DA3", "Q5DB3"),
    serves_individuals: servesIndividuals(xml),
    financial_planning: attr(xml, "Item5G", "Q5G1") === "Y",
    private_funds: yn(attr(xml, "Item7B", "Q7B")),
    fee_aum: yn(attr(xml, "Item5E", "Q5E1")),
    fee_hourly: yn(attr(xml, "Item5E", "Q5E2")),
    fee_subscription: yn(attr(xml, "Item5E", "Q5E3")),
    fee_fixed: yn(attr(xml, "Item5E", "Q5E4")),
    fee_commissions: yn(attr(xml, "Item5E", "Q5E5")),
    fee_performance: yn(attr(xml, "Item5E", "Q5E6")),
    mkt_performance: q5l("Q5L1A"),
    mkt_specific_advice: q5l("Q5L1B"),
    mkt_testimonials: q5l("Q5L1C"),
    mkt_endorsements: q5l("Q5L1D"),
    mkt_ratings: q5l("Q5L1E"),
    mkt_paid: q5l("Q5L2"),
    mkt_hypothetical: q5l("Q5L3"),
    mkt_predecessor: q5l("Q5L4"),
  };
}

// ── Advisors (investment adviser representatives) ───────────────────────────

export const ADVISOR_COLUMNS = ["crd", "first_name", "middle_name", "last_name", "other_names", "active", "firm_crds", "firm_names", "designations", "city", "state"];

export function parseAdvisor(xml) {
  const crd = int(attr(xml, "Info", "indvlPK"));
  const last = attr(xml, "Info", "lastNm");
  if (!crd || !last) return null;
  const emps = tags(xml, "CrntEmp");
  const current = xml.match(/<CrntEmps>[\s\S]*?<\/CrntEmps>/)?.[0] ?? "";
  // Where they work: their first branch office, else their firm's address.
  const loc = tags(current, "BrnchOfLoc").find((b) => attrOf(b, "city")) ?? emps[0];
  return {
    crd,
    first_name: attr(xml, "Info", "firstNm"),
    middle_name: attr(xml, "Info", "midNm"),
    last_name: last,
    other_names: tags(xml, "OthrNm").map((o) => [attrOf(o, "firstNm"), attrOf(o, "lastNm")].filter(Boolean).join(" ")).filter(Boolean),
    active: attr(xml, "Info", "actvAGReg") === "Y" || tags(xml, "CrntRgstn").some((r) => attrOf(r, "st") === "APPROVED"),
    firm_crds: [...new Set(emps.map((e) => int(attrOf(e, "orgPK"))).filter(Boolean))],
    firm_names: emps.map((e) => attrOf(e, "orgNm")).filter(Boolean),
    designations: [...new Set(tags(xml, "Dsgntn").map((d) => attrOf(d, "dsgntnNm")).filter(Boolean))],
    city: (loc && attrOf(loc, "city")) || null,
    state: (loc && attrOf(loc, "state")) || null,
  };
}

export const MOVE_COLUMNS = ["crd", "to_firm_crd", "to_firm_name", "joined_on", "from_firm_crd", "from_firm_name", "left_on"];

const addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);

// Moves: for each current firm, when the advisor registered there (the earliest approved registration),
// and the previous firm whose registration ended closest before that (up to a year before, or a month
// after, for overlaps). No previous firm means new to the industry, not a move. Joins before `since`
// (YYYY-MM-DD) are left out.
export function parseMoves(xml, crd, since = "0000-00-00") {
  const current = xml.match(/<CrntEmps>[\s\S]*?<\/CrntEmps>/)?.[0] ?? "";
  const emps = [...current.matchAll(/<CrntEmp\b[\s\S]*?<\/CrntEmp>/g)].map((m) => m[0]);
  const prev = tags(xml, "PrevRgstn")
    .map((p) => ({ crd: int(attrOf(p, "orgPK")), name: attrOf(p, "orgNm"), end: attrOf(p, "regEndDt") }))
    .filter((p) => p.crd && isDate(p.end));
  const moves = [];
  for (const emp of emps) {
    const toCrd = int(attr(emp, "CrntEmp", "orgPK"));
    const joined = tags(emp, "CrntRgstn").filter((r) => attrOf(r, "st") === "APPROVED").map((r) => attrOf(r, "stDt")).filter(isDate).sort()[0];
    if (!toCrd || !joined || joined < since) continue;
    const from = prev.filter((p) => p.crd !== toCrd && p.end <= addDays(joined, 31) && p.end >= addDays(joined, -365))
      .sort((a, b) => (a.end < b.end ? 1 : -1))[0];
    if (!from) continue;
    moves.push({ crd, to_firm_crd: toCrd, to_firm_name: attr(emp, "CrntEmp", "orgNm"), joined_on: joined, from_firm_crd: from.crd, from_firm_name: from.name, left_on: from.end });
  }
  return moves;
}

// ── Getting a feed ──────────────────────────────────────────────────────────

function unpack(path) {
  if (/\.gz$/i.test(path)) return createReadStream(path).pipe(createGunzip());
  if (/\.zip$/i.test(path)) return spawn("unzip", ["-p", path]).stdout;   // a .zip holds one XML file
  return createReadStream(path);
}

// A feed as a stream of XML: a local file if one is given (.xml, .gz or .zip), else the most recent of
// the last 7 days' files from the SEC, saved in cacheDir.
export async function openFeed(kind, { file, cacheDir = ".cache", log = () => {} } = {}) {
  const { name, patterns } = FEEDS[kind];
  if (file) return { stream: unpack(file), source: file };
  const tried = [];
  for (let back = 0; back < 7; back++) {
    const d = new Date(Date.now() - back * 864e5);
    const date = `${String(d.getUTCMonth() + 1).padStart(2, "0")}_${String(d.getUTCDate()).padStart(2, "0")}_${d.getUTCFullYear()}`;
    for (const pattern of patterns) {
      const file = pattern.replace("{date}", date);
      const res = await get(`${FEED_BASE}/${file}`, { timeout: 30_000 }).then((r) => { r.body?.cancel(); return r; }, (e) => ({ ok: false, status: e.message }));
      if (!res.ok) { tried.push(`${file} ${res.status}`); continue; }
      const path = await download(`${FEED_BASE}/${file}`, join(cacheDir, file), { log });
      return { stream: unpack(path), source: file };
    }
  }
  throw new Error(`Couldn't find ${name} on the SEC site in the last 7 days (${tried.slice(0, 3).join("; ")}…)`);
}
