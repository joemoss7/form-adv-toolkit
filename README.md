# form-adv-toolkit

SEC investment adviser data as clean CSVs: every registered investment adviser (RIA), every adviser
representative, who moved between firms, who owns each firm, and each firm's size at every Form ADV
filing since 2011.

Form ADV is the main public record of the US advice industry. The SEC publishes it as daily XML feeds
and bulk zips of CSVs whose layout changes between years, which takes real work to read. This toolkit
does that work and leaves you with CSVs you can open in a spreadsheet, load into a database or query
with DuckDB.

It comes from the data pipeline behind [Advicer.bio](https://advicer.bio), a free directory of financial
advisors and RIAs, where it runs every week.

## What you get

| Command | Output | From |
|---|---|---|
| `firms` | `firms.csv`: each SEC- and state-registered adviser with its CRD, website, address, AUM, accounts, staff, individual clients, fee types (5.E), marketing practices (5.L) and whether it mainly serves individuals | daily firm feeds |
| `advisors` | `advisors.csv`: each investment adviser representative with current firms, designations and location | daily individual feed |
| | `moves.csv`: advisors who joined a firm from another one, with both firms and dates | same |
| `history` | `history.csv`: each adviser's AUM, accounts, employees, advisory staff, individual clients and their assets, one row per filing day | bulk Form ADV, Nov 2011 → |
| `owners` | `owners.csv`: direct owners and officers (Schedule A) and indirect owners (Schedule B), with ownership range, control person, first and last filing seen, and whether they're on the latest filing | bulk Form ADV, Nov 2011 → |

## Use

Node 20+ and `unzip` (preinstalled on macOS and most Linux). No dependencies.

```sh
git clone https://github.com/joemoss7/form-adv-toolkit && cd form-adv-toolkit
export SEC_USER_AGENT="Your Name you@example.com"   # the SEC asks automated clients to identify themselves

node bin/form-adv.js firms                          # → data/firms.csv
node bin/form-adv.js advisors --since 2024-01-01    # → data/advisors.csv, data/moves.csv
node bin/form-adv.js history --since 2023-01-01     # → data/history.csv (large downloads: start recent)
node bin/form-adv.js owners --crd 123456,654321     # → data/owners.csv for two firms
```

Downloads are kept in `.cache/`, so a rerun doesn't fetch them again. If you already have the files,
pass `--file` (daily feeds) or `--zips` (bulk zips). `node bin/form-adv.js help` lists every option.

Don't want to run it? **Actions → Live SEC data → Run workflow** on your own fork runs it on GitHub and
gives you the CSVs as a download.

As a library (`npm install github:joemoss7/form-adv-toolkit`):

```js
import { records, parseFirm, openFeed } from "form-adv-toolkit";

const { stream } = await openFeed("sec");
for await (const xml of records(stream, "Firm")) {
  const firm = parseFirm(xml);
  if (firm.serves_individuals && firm.state === "TX") console.log(firm.name, firm.aum);
}
```

## Questions it answers

With [DuckDB](https://duckdb.org) (`duckdb` then paste):

```sql
-- Who owns a firm today, and since when?
select name, title, ownership_code, first_filed
from 'data/owners.csv' where crd = 123456 and current order by schedule, ownership_code desc;

-- How a firm's assets, staff and clients changed, filing by filing
select filed_on, aum, advisory_staff, individual_clients from 'data/history.csv' where crd = 123456 order by filed_on;

-- Where a firm's recent hires came from
select from_firm_name, count(*) n from 'data/moves.csv' where to_firm_crd = 123456 group by 1 order by n desc;

-- Firms whose growth came with hires: advisors joining, next to assets added
select m.to_firm_crd, f.name, count(*) hires
from 'data/moves.csv' m join 'data/firms.csv' f on f.crd = m.to_firm_crd
group by 1, 2 order by hires desc limit 25;
```

## Notes on the data

- **Moves**: a move is a current firm whose first approved registration falls within a year after (or a
  month before) the end of a registration at another firm. People with no earlier firm are new to the
  industry, not moves. By default only joins in the last two years are kept; change it with `--since`.
- **Owners**: `owner_id` is the owner's CRD number for people and firms that have one. Ownership codes:
  NA under 5%, A 5–10%, B 10–25%, C 25–50%, D 50–75%, E 75% or more (Schedule A); Schedule B uses the
  same codes plus F for "other". `via` is the entity a Schedule B owner owns.
- **Individual clients** (Item 5.D(1)(a) + (b)) are exact counts only from late 2017; earlier filings
  gave ranges, so `history.csv` leaves them blank before October 2017.
- **Website**: Form ADV lists every web address a firm uses. The toolkit skips directories, social pages
  and site builders (`src/not-a-website.js`) and picks the domain closest to the firm's name.
- **Serves individuals**: at least half of the firm's regulatory AUM is for individuals and high-net-worth
  individuals (Item 5.D). This separates wealth managers and planners from fund and institutional managers.
- This is public SEC data, read as published. Filings contain mistakes; counts over 2 billion are treated
  as typos and left blank.

## Contributing

Issues and pull requests are welcome, especially when the SEC changes a file layout. `npm test` runs the
parsers against the small made-up samples in `test/fixtures`.

## License

MIT
