// Offline tests against small sample files in test/fixtures (made-up firms and people).
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createReadStream } from "node:fs";
import { domainOf, entries, fields, history, owners, parseAdvisor, parseFirm, parseMoves, records } from "../src/index.js";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const FIX = here("./fixtures/");
const all = async (gen) => { const out = []; for await (const x of gen) out.push(x); return out; };
const xmlRecords = (file, tag) => all(records(createReadStream(join(FIX, file)), tag));
const zip = () => { const path = join(FIX, "adv-sample.zip"); return [{ url: path, path, names: entries(path) }]; };

test("domainOf keeps the registrable domain", () => {
  assert.equal(domainOf("https://wisdom.EdwardJones.com/x"), "edwardjones.com");
  assert.equal(domainOf("www.firm.co.uk/about"), "firm.co.uk");
  assert.equal(domainOf("not a url"), null);
});

test("fields handles quotes and commas", () => {
  assert.deepEqual(fields('1,"a, b","say ""hi"""'), ["1", "a, b", 'say "hi"']);
});

test("parseFirm reads size, fees, marketing and picks the firm's own website", async () => {
  const [wealth, inst] = (await xmlRecords("IA_FIRM_SEC_Feed_sample.xml", "Firm")).map((x) => parseFirm(x));
  assert.equal(wealth.crd, 900001);
  assert.equal(wealth.registration, "sec");
  assert.equal(wealth.website, "https://examplewealth.com");   // the bare domain, as the firm also lists it
  assert.deepEqual(wealth.domains, ["examplewealth.com"]);
  assert.equal(wealth.aum, 400000000);
  assert.equal(wealth.individual_clients, 240);
  assert.equal(wealth.individual_aum, 360000000);
  assert.equal(wealth.serves_individuals, true);
  assert.equal(wealth.fee_aum, true);
  assert.equal(wealth.fee_hourly, false);
  assert.equal(wealth.mkt_testimonials, true);
  assert.equal(wealth.phone, "512-555-0100");
  assert.equal(inst.name, "EXAMPLE INSTITUTIONAL & CO");
  assert.equal(inst.website, null);   // only a social page listed
  assert.equal(inst.serves_individuals, false);
  assert.equal(inst.private_funds, true);
});

test("parseAdvisor and parseMoves find the move from the wirehouse", async () => {
  const [jane, richard] = await xmlRecords("IA_INDVL_Feed_sample.xml", "Indvl");
  const a = parseAdvisor(jane);
  assert.equal(a.crd, 7000001);
  assert.deepEqual(a.firm_crds, [900001]);
  assert.deepEqual(a.other_names, ["JANE SMITH"]);
  assert.deepEqual(a.designations, ["Certified Financial Planner"]);
  assert.equal(a.city, "ROUND ROCK");
  const moves = parseMoves(jane, a.crd);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].from_firm_crd, 800001);
  assert.equal(moves[0].joined_on, "2025-06-10");
  assert.equal(parseMoves(jane, a.crd, "2025-07-01").length, 0);
  assert.equal(parseMoves(richard, 7000002).length, 0);   // no previous firm: new to the industry
});

test("history keeps the last filing each day and sums individual clients", async () => {
  const rows = await all(history(zip()));
  const ex = rows.filter((r) => r.crd === 900001);
  assert.deepEqual(ex.map((r) => r.filed_on), ["2025-01-15", "2026-03-15"]);
  assert.equal(ex[0].aum, 300000000);
  assert.equal(ex[0].individual_aum, 270000000);
  assert.equal(ex[1].filing_id, 1004);
  assert.equal(ex[1].individual_clients, 241);
  const only = await all(history(zip(), { crds: new Set([900002]) }));
  assert.deepEqual(only.map((r) => r.crd), [900002]);
});

test("owners tracks first and last seen, and who is on the latest filing", async () => {
  const rows = await owners(zip());
  const by = (n) => rows.find((r) => r.name.startsWith(n));
  assert.equal(by("DOE").first_filed, "2025-01-15");
  assert.equal(by("DOE").last_filed, "2026-03-15");
  assert.equal(by("DOE").title, "CEO, MANAGING MEMBER");
  assert.equal(by("DOE").owner_id, "7000001");
  assert.equal(by("DOE").current, true);
  assert.equal(by("EARLY").current, false);
  assert.equal(by("EXAMPLE CAPITAL").schedule, "B");
  assert.equal(by("EXAMPLE CAPITAL").via, "EXAMPLE HOLDINGS LLC");
});

test("the CLI writes CSVs from local files", () => {
  const out = mkdtempSync(join(tmpdir(), "form-adv-"));
  const cli = here("../bin/form-adv.js");
  execFileSync("node", [cli, "firms", "--out", out, "--file", join(FIX, "IA_FIRM_SEC_Feed_sample.xml"), "--file", join(FIX, "IA_FIRM_STATE_Feed_sample.xml")], { stdio: "pipe" });
  const firms = readFileSync(join(out, "firms.csv"), "utf8").trim().split("\n");
  assert.equal(firms.length, 4);   // header + 3 firms; the one in both feeds once, as SEC-registered
  assert.match(firms[1], /^900001,801-99991,"EXAMPLE WEALTH PARTNERS, LLC",.*,sec,/);
  execFileSync("node", [cli, "advisors", "--out", out, "--since", "2020-01-01", "--file", join(FIX, "IA_INDVL_Feed_sample.xml")], { stdio: "pipe" });
  assert.equal(readFileSync(join(out, "moves.csv"), "utf8").trim().split("\n").length, 2);
  execFileSync("node", [cli, "owners", "--out", out, "--zips", join(FIX, "adv-sample.zip")], { stdio: "pipe" });
  assert.equal(readFileSync(join(out, "owners.csv"), "utf8").trim().split("\n").length, 5);
});
