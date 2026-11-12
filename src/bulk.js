// The SEC's bulk Form ADV data: every filing since November 2011, as zips of CSVs (IA_ADV_Base_A for
// Part 1A, plus Schedules A and B for owners). Through 2024 it is on sec.gov's Form ADV data page; from
// January 2025 the SEC posts each month's filings on adviserinfo.sec.gov, a few weeks after the month ends.
import { execFileSync, spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { parseLines } from "./csv.js";
import { download, get } from "./http.js";

const KNOWN = [
  "https://www.sec.gov/files/adv-filing-data-20111105-20241231-part1.zip",
  "https://www.sec.gov/files/adv-filing-data-20111105-20241231-part2.zip",
];
const PAGES = [
  "https://www.sec.gov/foia-services/frequently-requested-documents/form-adv-data",
  "https://www.sec.gov/foia/docs/form-adv-archive-data.htm",
];

// Each month's zip from January 2025 through the last month that has ended.
export function monthlyZips(today = new Date()) {
  const out = [];
  const ymd = (x) => x.toISOString().slice(0, 10).replace(/-/g, "");
  for (let d = new Date(Date.UTC(2025, 0, 1)); ; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    if (end.getTime() >= today.getTime()) break;
    out.push(`https://reports.adviserinfo.sec.gov/reports/foia/advFilingData/${d.getUTCFullYear()}/ADV_Filing_Data_${ymd(d)}_${ymd(end)}.zip`);
  }
  return out;
}

// The last date a zip covers, as YYYYMMDD.
export const zipEnd = (url) => url.match(/-(\d{8})-part|[-_](\d{8})\.zip/i)?.slice(1).find(Boolean) ?? "99999999";

// Every bulk zip (from the SEC's pages, or the known names if they can't be read), then the monthly ones.
// since: "YYYY-MM-DD" leaves out zips that end before it.
export async function bulkZips({ since, log = () => {} } = {}) {
  const found = new Set();
  for (const page of PAGES) {
    try {
      const res = await get(page, { timeout: 30_000 });
      if (!res.ok) { log(`${page}: HTTP ${res.status}`); continue; }
      for (const m of (await res.text()).matchAll(/(?:https:\/\/www\.sec\.gov)?(\/files\/[^"'\s>]*adv-filing-data-(\d{8})-(\d{8})[^"'\s>]*\.zip)/gi)) {
        if (m[2] >= "20111105") found.add(`https://www.sec.gov${m[1]}`);
      }
    } catch (e) { log(`${page}: ${e.message}`); }
  }
  if (!found.size) log("Couldn't read the SEC's list of files; using the known ones.");
  const all = [...(found.size ? [...found].sort() : KNOWN), ...monthlyZips()];
  const from = (since ?? "").replace(/-/g, "");
  return all.filter((u) => !from || zipEnd(u) >= from);
}

// Downloads each zip into cacheDir (a month the SEC hasn't posted yet is skipped) and lists its files.
export async function fetchZips(urls, { cacheDir = ".cache", log = () => {} } = {}) {
  const out = [];
  for (const url of urls) {
    const path = join(cacheDir, url.split("/").pop());
    try { await download(url, path, { log }); }
    catch (e) { log(`${url.split("/").pop()}: ${e.message}, skipped`); continue; }
    out.push({ url, path, names: entries(path) });
  }
  return out;
}

export const entries = (zip) => execFileSync("unzip", ["-Z1", zip], { maxBuffer: 1e8 }).toString().split("\n").filter(Boolean);

// The rows of one CSV inside a zip: first { header }, then { row }s.
export function csvRows(zip, name) {
  const p = spawn("unzip", ["-p", zip, name]);
  return parseLines(createInterface({ input: p.stdout.setEncoding("latin1"), crlfDelay: Infinity }));
}

// "2024-03-31…" or "3/31/2024…" → "2024-03-31" ("" if neither).
export const isoDate = (raw = "") => {
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : "";
};

// A number from a bulk CSV cell ("$1,234" → 1234). Counts past 2 billion are typos in the filing.
export const num = (v) => {
  const s = String(v ?? "").trim();
  const n = Number(s.replace(/[$,\s]/g, ""));
  return s !== "" && Number.isFinite(n) ? Math.round(n) : null;
};
export const count = (v) => { const n = num(v); return n != null && n >= 0 && n < 2_000_000_000 ? n : null; };

// The columns of an IA_ADV_Base_A file this toolkit reads (names vary a little between years).
export function baseColumns(header) {
  const h = header.map((x) => x.trim());
  const sq = h.map((x) => x.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const at = (...keys) => { for (const k of keys) { const i = sq.indexOf(k); if (i >= 0) return i; } return -1; };
  const col = {
    id: at("filingid"),
    crd: at("1e1") >= 0 ? at("1e1") : h.findIndex((x) => /crd/i.test(x)),
    date: at("datesubmitted") >= 0 ? at("datesubmitted") : h.findIndex((x) => /date ?submitted|filing ?date/i.test(x)),
    aum: at("5f2c"), accounts: at("5f2f"), employees: at("5a"), advisory_staff: at("5b1"),
    ind_clients: at("5d1a"), hnw_clients: at("5d1b"), ind_aum: at("5d3a"), hnw_aum: at("5d3b"),
  };
  if (col.crd < 0 || col.date < 0) throw new Error(`No CRD / date column in: ${h.slice(0, 20).join(" | ")}…`);
  return col;
}
