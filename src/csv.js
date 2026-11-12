// Reading and writing CSV.
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { once } from "node:events";

// One CSV line into fields (quotes, "" inside quotes).
export function fields(line) {
  const f = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { f.push(cur); cur = ""; }
    else cur += c;
  }
  f.push(cur);
  return f;
}

// Lines into records, joining lines inside a quoted field: first { header }, then { row }s.
export async function* parseLines(lines) {
  let header = null, pending = "";
  for await (const raw of lines) {
    const line = pending ? `${pending}\n${raw}` : raw;
    if ((line.match(/"/g) ?? []).length % 2) { pending = line; continue; }
    pending = "";
    const f = fields(line);
    if (!header) { header = f.map((h) => h.trim().replace(/^﻿/, "")); yield { header }; continue; }
    yield { row: f };
  }
}

const cell = (v) => {
  if (v == null) return "";
  const s = Array.isArray(v) ? v.join("; ") : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// A CSV file written a row at a time: w = csvWriter(path, columns); await w.write(obj); await w.close().
export function csvWriter(path, columns) {
  mkdirSync(dirname(path), { recursive: true });
  const out = createWriteStream(path);
  out.write(columns.join(",") + "\n");
  let rows = 0;
  return {
    get rows() { return rows; },
    async write(obj) {
      rows++;
      if (!out.write(columns.map((c) => cell(obj[c])).join(",") + "\n")) await once(out, "drain");
    },
    close: () => new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve()))),
  };
}
