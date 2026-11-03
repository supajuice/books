# Supa Juice books

The books for Supa Juice: what the business spends, what the owners put in, and what it makes.
- **Expenses**: every receipt, with a photo, its category and who paid.
- **Money in**: owners' loans and capital, paying an owner back, and sales outside the website.
- **Batches**: sachets made and what they cost, for the cost per sachet and stock.
- **Report**:
  - profit and loss for any month or SARS tax year;
  - cash on hand;
  - what each owner is owed;
  - turnover against the R1 million VAT line;
  - a CSV download for an accountant.

Website sales come straight from the order site's Google Sheet. The books **read** it and never write to it.

To set it up, see **[SETUP-GUIDE.md](SETUP-GUIDE.md)**. To keep it right week to week and year to year, see **[MAINTAINING.md](MAINTAINING.md)**.

## Separate from the order site

| | Order site | Books |
|---|---|---|
| Repo | `supajuice/supajuice.github.io` | `supajuice/books` |
| Page | https://supajuice.github.io/ | https://supajuice.github.io/books/ |
| Google Sheet | the order Sheet | **Supa Juice Books** |
| Apps Script | its own web app and admin key | its own web app and books key |

A push or deploy here never touches the order page. If the order Sheet moves or renames its columns, only the books' sales figures stop, and the report says so.

## How the numbers are worked out

- **Profit** is on a cash basis.
  - **Income**: paid and delivered website orders (by the day they were paid), plus other sales.
  - **Costs**: expenses, plus estimated card fees (see below).
  - Discounts are already taken off the website totals.
- **Card fees** are worked out as Paystack percent × total + fixed fee for each order paid by card, which the order site marks "Paid by card (Paystack …)". Choose **Settings > Card payment fees > I’ll add them** to record the real fees as expenses instead.
- **Cost per sachet** = what every batch so far cost ÷ sachets made. **Stock** = made − sold, counting website sales and other sales.
- **Cash on hand** counts from **Books start on**:

  opening balance + owners' loans and capital + sales − expenses paid by the business − card fees − paid back to owners.

  Expenses an owner paid from their own pocket are not business cash.
- **Owed to an owner** = their loans + expenses they paid themselves − what was paid back. **Capital** is listed separately: it is their share, not a debt.
- **Tax year**: 1 March to the end of February (SARS).

Money is worked in cents throughout. Entries are never deleted: Remove stamps **Removed on**, Edit stamps **Edited on**.

## Files

```
apps-script/Code.gs    the backend: paste into the books Sheet's Apps Script
docs/                  the page, served by GitHub Pages
  index.html           login, and the Add / Ledger / Report / Settings tabs
  books.js             the page logic
  app.css              styles copied from the order site (same look)
  books.css            the few styles only the books need
  config.js            the books web app address
tests/
  gas-mock.js          an in-memory Apps Script, including a pretend order Sheet and Drive
  server.test.js       backend tests
  browser.test.js      the page in Chromium, against the dev server
  dev-server.js        run the page locally with sample books
```

## Working on it

```
npm ci
npx playwright install chromium
npm run dev       # http://127.0.0.1:5183/#<key printed in the terminal>
npm test
```

GitHub Actions runs `npm test` on every pull request and every push to main.

## Rules

- Every field is explicit: settings use choices such as *Estimate for me / I’ll add them* and *Yes / No*, never "leave blank to turn off".
- No secrets in the repo. The books key, `ORDER_SHEET_ID` and the receipts folder live in Script properties.
- Phones first: 44px tap targets, works at 320px wide, light and dark.
