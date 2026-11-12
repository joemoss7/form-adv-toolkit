// Each adviser's size over time, one reading per filing day, from every Form ADV filing since 2011
// (IA_ADV_Base_A in the bulk zips).
import { baseColumns, count, csvRows, isoDate, num } from "./bulk.js";

export const HISTORY_COLUMNS = ["crd", "filed_on", "filing_id", "aum", "accounts", "employees", "advisory_staff", "individual_clients", "individual_aum"];

// Yields one reading per adviser and filing day (the last filing that day). crds: a Set to keep only those.
// Client counts (5.D(1)) are exact numbers from late 2017 on; earlier filings gave ranges, left blank.
export async function* history(zips, { crds, log = () => {} } = {}) {
  for (const z of zips) {
    for (const name of z.names.filter((n) => /IA_ADV_Base_A_.*\.csv$/i.test(n))) {
      let c = null, seen = 0;
      const latest = new Map();
      for await (const r of csvRows(z.path, name)) {
        if (r.header) { c = baseColumns(r.header); continue; }
        seen++;
        const f = r.row, crd = num(f[c.crd]);
        if (!crd || (crds && !crds.has(crd))) continue;
        const day = isoDate(f[c.date]);
        if (!day) continue;
        const id = c.id >= 0 ? num(f[c.id]) : null;
        const prev = latest.get(`${crd}|${day}`);
        if (prev && id != null && prev.filing_id != null && prev.filing_id > id) continue;
        const pair = (a, b) => { const x = a >= 0 ? count(f[a]) : null, y = b >= 0 ? count(f[b]) : null; return x == null && y == null ? null : (x ?? 0) + (y ?? 0); };
        latest.set(`${crd}|${day}`, {
          crd, filed_on: day, filing_id: id,
          aum: c.aum >= 0 ? num(f[c.aum]) : null,
          accounts: c.accounts >= 0 ? count(f[c.accounts]) : null,
          employees: c.employees >= 0 ? count(f[c.employees]) : null,
          advisory_staff: c.advisory_staff >= 0 ? count(f[c.advisory_staff]) : null,
          individual_clients: day >= "2017-10-01" ? pair(c.ind_clients, c.hnw_clients) : null,
          individual_aum: pair(c.ind_aum, c.hnw_aum),
        });
      }
      log(`${name.split("/").pop()}: ${seen.toLocaleString()} filings, ${latest.size.toLocaleString()} readings`);
      yield* [...latest.values()].sort((a, b) => a.crd - b.crd || a.filed_on.localeCompare(b.filed_on));
    }
  }
}
