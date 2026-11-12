#!/usr/bin/env node
// form-adv: SEC investment adviser data as clean CSVs. Run `form-adv help`.
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  ADVISOR_COLUMNS, FIRM_COLUMNS, HISTORY_COLUMNS, MOVE_COLUMNS, OWNER_COLUMNS,
  bulkZips, csvWriter, entries, fetchZips, history, openFeed, owners, parseAdvisor, parseFirm, parseMoves, records,
} from "../src/index.js";

const HELP = `form-adv <command> [options]

Commands
  firms      Every registered investment adviser today (SEC and state), from the SEC's daily feeds
             → firms.csv
  advisors   Every investment adviser representative, and who moved between firms
             → advisors.csv, moves.csv
  history    Each adviser's AUM, accounts, staff and clients at every Form ADV filing since 2011
             → history.csv
  owners     Each adviser's direct and indirect owners (Schedules A and B), first and last seen
             → owners.csv

Options
  --out DIR        where CSVs go (default ./data)
  --cache DIR      where SEC downloads are kept between runs (default ./.cache)
  --file PATH      use a feed file you already have (.xml, .gz or .zip); repeat for both firm feeds
  --zips A,B       history/owners: use bulk Form ADV zips you already have
  --since DATE     history/owners: skip bulk zips that end before DATE (YYYY-MM-DD)
                   advisors: only moves that joined on or after DATE (default: two years ago)
  --crd 1,2,3      history/owners: only these advisers (by CRD number)

Set SEC_USER_AGENT to "Your Name your@email.com": the SEC asks automated clients to identify themselves.
`;

const { positionals, values: o } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string", default: "data" }, cache: { type: "string", default: ".cache" },
    file: { type: "string", multiple: true }, zips: { type: "string" }, since: { type: "string" }, crd: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});
const cmd = positionals[0];
const log = (m) => console.error(m);
const crds = o.crd ? new Set(o.crd.split(",").map((s) => Number(s.trim())).filter(Boolean)) : undefined;
if (o.since && !/^\d{4}-\d{2}-\d{2}$/.test(o.since)) { log("--since should be YYYY-MM-DD"); process.exit(2); }

async function firms() {
  const seen = new Map();   // a firm in both feeds counts once; SEC registration wins
  const given = o.file ?? [];
  const feeds = given.length ? given.map((f) => ({ kind: /STATE/i.test(f) ? "state" : "sec", file: f })) : [{ kind: "sec" }, { kind: "state" }];
  for (const { kind, file } of feeds) {
    const { stream, source } = await openFeed(kind, { file, cacheDir: o.cache, log });
    let n = 0;
    for await (const xml of records(stream, "Firm")) {
      const f = parseFirm(xml, kind === "state" ? "IA_FIRM_STATE_Feed" : "IA_FIRM_SEC_Feed");
      if (!f) continue;
      n++;
      const prev = seen.get(f.crd);
      if (!prev || (prev.registration !== "sec" && f.registration === "sec")) seen.set(f.crd, f);
    }
    log(`${source}: ${n.toLocaleString()} firms`);
  }
  const w = csvWriter(join(o.out, "firms.csv"), FIRM_COLUMNS);
  for (const f of [...seen.values()].sort((a, b) => a.crd - b.crd)) await w.write(f);
  await w.close();
  log(`firms.csv: ${w.rows.toLocaleString()} firms`);
}

async function advisors() {
  const since = o.since ?? new Date(Date.now() - 2 * 365 * 864e5).toISOString().slice(0, 10);
  const { stream, source } = await openFeed("advisors", { file: o.file?.[0], cacheDir: o.cache, log });
  const a = csvWriter(join(o.out, "advisors.csv"), ADVISOR_COLUMNS);
  const m = csvWriter(join(o.out, "moves.csv"), MOVE_COLUMNS);
  const moved = new Set();
  for await (const xml of records(stream, "Indvl")) {
    const adv = parseAdvisor(xml);
    if (!adv) continue;
    await a.write(adv);
    for (const mv of parseMoves(xml, adv.crd, since)) {
      const k = `${mv.crd}:${mv.to_firm_crd}:${mv.joined_on}`;
      if (!moved.has(k)) { moved.add(k); await m.write(mv); }
    }
  }
  await a.close(); await m.close();
  log(`${source}: advisors.csv ${a.rows.toLocaleString()} advisors · moves.csv ${m.rows.toLocaleString()} moves since ${since}`);
}

async function zips() {
  const urls = o.zips ? o.zips.split(",").filter(Boolean) : await bulkZips({ since: o.since, log });
  if (o.zips) {
    return urls.map((path) => ({ url: path, path, names: entries(path) }));
  }
  return fetchZips(urls, { cacheDir: o.cache, log });
}

async function historyCmd() {
  const w = csvWriter(join(o.out, "history.csv"), HISTORY_COLUMNS);
  for await (const r of history(await zips(), { crds, log })) await w.write(r);
  await w.close();
  log(`history.csv: ${w.rows.toLocaleString()} readings`);
}

async function ownersCmd() {
  const rows = await owners(await zips(), { crds, log });
  const w = csvWriter(join(o.out, "owners.csv"), OWNER_COLUMNS);
  for (const r of rows) await w.write(r);
  await w.close();
  log(`owners.csv: ${w.rows.toLocaleString()} owners of ${new Set(rows.map((r) => r.crd)).size.toLocaleString()} advisers`);
}

const run = { firms, advisors, history: historyCmd, owners: ownersCmd }[cmd];
if (!run || o.help) { console.log(HELP); process.exit(run || cmd === "help" || o.help ? 0 : 2); }
run().catch((e) => { log(`form-adv ${cmd}: ${e.message}`); process.exit(1); });
