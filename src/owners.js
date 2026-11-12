// Who owns each adviser: Form ADV Schedule A (direct owners and executive officers) and Schedule B
// (indirect owners: the owners of the owners), from every filing since 2011, with when each owner
// first and last appeared and whether they are on the adviser's latest filing.
import { baseColumns, csvRows, isoDate, num } from "./bulk.js";

export const OWNER_COLUMNS = [
  "crd", "schedule", "name", "entity_type", "title", "ownership_code", "control_person", "public_company",
  "owner_id", "acquired", "via", "first_filed", "last_filed", "current",
];

const keyOf = (s) => s.toLowerCase().replace(/[.,'"()]/g, "").replace(/\s+/g, " ").trim();
const clean = (v) => { const s = (v ?? "").trim(); return s === "" ? null : s; };
const yes = (v) => /^(y|yes|true|1)$/i.test((v ?? "").trim());

// Every filing: id → [crd, date], and each adviser's latest filing id.
export async function filingIndex(zips, { crds, log = () => {} } = {}) {
  const filings = new Map(), latest = new Map();
  for (const z of zips) for (const name of z.names.filter((n) => /IA_ADV_Base_A_.*\.csv$/i.test(n))) {
    let c = null;
    for await (const r of csvRows(z.path, name)) {
      if (r.header) { c = baseColumns(r.header); if (c.id < 0) throw new Error(`${name}: no filing id column`); continue; }
      const id = num(r.row[c.id]), crd = num(r.row[c.crd]), d = isoDate(r.row[c.date]);
      if (!id || !crd || (crds && !crds.has(crd))) continue;
      filings.set(id, [crd, d]);
      const prev = latest.get(crd);
      if (!prev || d > prev.date || (d === prev.date && id > prev.id)) latest.set(crd, { id, date: d });
    }
    log(`indexed ${name.split("/").pop()}`);
  }
  return { filings, latest };
}

// The column positions in a Schedule A/B file (names vary between years).
function scheduleColumns(h) {
  const find = (re, not) => h.findIndex((x) => re.test(x) && !(not && not.test(x)));
  return {
    id: find(/^filing ?id$/i), sched: find(/^schedule$|^sched/i), name: find(/full legal name|^name$|legal name/i),
    type: find(/de\/fe\/i|entity type|^type$/i), title: find(/title|status/i, /acquired|date/i), acquired: find(/acquired|date/i),
    code: find(/ownership ?code|^code$/i), control: find(/control/i), pr: find(/^pr$|public/i),
    ownerId: find(/crd|ein|tax|id ?no|owner ?id/i, /filing/i), via: find(/entity in which|interest is owned|owned entity/i),
  };
}

// Every owner of every adviser (or just crds), one row per adviser, schedule and owner name.
export async function owners(zips, { crds, log = () => {} } = {}) {
  const { filings, latest } = await filingIndex(zips, { crds, log });
  const found = new Map();
  const files = zips.flatMap((z) => z.names.filter((n) => /schedule_?a|schedule_?b/i.test(n) && /\.csv$/i.test(n)).map((n) => ({ z, n })));
  if (!files.length) throw new Error("No Schedule A/B files in the zips.");
  for (const { z, n } of files) {
    let c = null;
    const fileSched = /schedule_?a_?b/i.test(n) ? null : /schedule_?b/i.test(n) ? "B" : "A";
    for await (const r of csvRows(z.path, n)) {
      if (r.header) { c = scheduleColumns(r.header); if (c.id < 0 || c.name < 0) throw new Error(`${n}: no filing id or name column`); continue; }
      const filingId = num(r.row[c.id]);
      const f = filings.get(filingId), name = clean(r.row[c.name]);
      if (!f || !name) continue;
      const [crd, date] = f;
      const sched = (c.sched >= 0 ? clean(r.row[c.sched])?.toUpperCase().replace(/^SCHEDULE\s*/, "")[0] : null) ?? fileSched ?? "A";
      if (sched !== "A" && sched !== "B") continue;
      const attrs = {
        name,
        entity_type: c.type >= 0 ? clean(r.row[c.type])?.toUpperCase() ?? null : null,
        title: c.title >= 0 ? clean(r.row[c.title]) : null,
        via: c.via >= 0 ? clean(r.row[c.via]) : null,
        ownership_code: c.code >= 0 ? clean(r.row[c.code])?.toUpperCase() ?? null : null,
        control_person: c.control >= 0 ? yes(r.row[c.control]) : null,
        public_company: c.pr >= 0 ? yes(r.row[c.pr]) : null,
        owner_id: c.ownerId >= 0 ? clean(r.row[c.ownerId]) : null,
        acquired: c.acquired >= 0 ? clean(r.row[c.acquired]) : null,
      };
      const k = `${crd}|${sched}|${keyOf(name)}`;
      const o = found.get(k);
      if (!o) { found.set(k, { crd, schedule: sched, ...attrs, first_filed: date, last_filed: date, filing_id: filingId }); continue; }
      if (date < o.first_filed) o.first_filed = date;
      if (date > o.last_filed || (date === o.last_filed && filingId > o.filing_id)) Object.assign(o, attrs, { last_filed: date, filing_id: filingId });
    }
    log(`read ${n.split("/").pop()}`);
  }
  const rows = [...found.values()].map(({ filing_id, ...o }) => ({ ...o, current: latest.get(o.crd)?.id === filing_id }));
  return rows.sort((a, b) => a.crd - b.crd || a.schedule.localeCompare(b.schedule) || a.name.localeCompare(b.name));
}
