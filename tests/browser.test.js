'use strict';
// The books page in a real browser (Chromium through Playwright), against the dev server.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { startDevServer } = require('./dev-server');

let browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { await browser.close(); });

async function open(t, opts) {
  opts = opts || {};
  const dev = await startDevServer({ mode: opts.mode || 'seeded' });
  const ctx = await browser.newContext({
    viewport: { width: opts.width || 390, height: 844 },
    isMobile: true, hasTouch: true, colorScheme: opts.scheme || 'light', acceptDownloads: true
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  t.after(async () => {
    await ctx.close();
    await dev.close();
    assert.deepEqual(errors, [], 'no errors in the page');
  });
  if (opts.goto !== false) {
    await page.goto(dev.booksUrl());
    await page.waitForSelector('#panel-add:not([hidden])');
  }
  return { dev, page };
}

const tab = (page, name) => page.click('.tab[data-tab="' + name + '"]');
const press = (page, group, value) => page.click('[data-choice="' + group + '"] [data-value="' + value + '"]');
const text = async (page, sel) => (await page.locator(sel).first().innerText()).trim();

async function fillExpense(page, over) {
  const v = Object.assign({ amount: '249.90', category: 'Packaging', what: 'Sachets x 200', supplier: 'PackRite', paidBy: 'Business' }, over);
  await page.fill('[data-field="amount"] input', v.amount);
  if (v.category) await press(page, 'Category', v.category);
  await page.fill('[data-field="what"] input', v.what);
  await page.fill('[data-field="supplier"] input', v.supplier);
  await press(page, 'Paid by', v.paidBy);
}

test('a link with the key opens the books and keeps the key out of the address bar', async (t) => {
  const { page } = await open(t);
  assert.equal(new URL(page.url()).hash, '');
  assert.equal(await page.locator('.tab[aria-current="page"]').getAttribute('data-tab'), 'add');
  await page.click('#lock');
  await page.waitForSelector('#login:not([hidden])');
  assert.equal(await page.locator('#topbar').isHidden(), true);
});

test('a wrong key is refused, and the right one opens the books', async (t) => {
  const { dev, page } = await open(t, { goto: false });
  await page.goto(dev.booksUrl('wrong'));
  await page.waitForSelector('#login-error:not([hidden])');
  assert.match(await text(page, '#login-error'), /not right/);
  await page.fill('#key', dev.key);
  await page.click('#login-form button[type="submit"]');
  await page.waitForSelector('#panel-add:not([hidden])');
  await page.reload();
  await page.waitForSelector('#panel-add:not([hidden])'); // the key was remembered
});

test('add an expense with a receipt photo: it is uploaded, saved and listed', async (t) => {
  const { dev, page } = await open(t, { mode: 'ready' });
  await fillExpense(page);
  // A small PNG made in the page, so no file is needed on disk.
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 3000; c.height = 1000;
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.setInputFiles('[data-field="receipt"] input', { name: 'till slip.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.click('#add-save');
  await page.waitForSelector('#toast:not([hidden])');
  assert.match(await text(page, '#toast'), /Saved E-0001, R249\.90/);
  const file = dev.gas.drive.files[0];
  assert.equal(file.type, 'image/jpeg', 'photos are sent as JPEG');
  assert.match(file.name, /^2026-11-03 PackRite\.jpg$/);
  const row = dev.gas.rows('Expenses')[0];
  assert.equal(row.Amount, 249.9);
  assert.equal(row.Receipt, 'https://drive.google.com/file/d/file-1/view');
  // The form is empty again, ready for the next one.
  assert.equal(await page.inputValue('[data-field="amount"] input'), '');
  await tab(page, 'ledger');
  const entry = page.locator('.entry[data-id="E-0001"]');
  assert.match(await entry.innerText(), /Sachets x 200/);
  assert.match(await entry.innerText(), /−R249\.90/);
  assert.equal(await entry.locator('a', { hasText: 'Receipt' }).getAttribute('href'), 'https://drive.google.com/file/d/file-1/view');
});

test('a mistake is shown under its field, and nothing is saved', async (t) => {
  const { dev, page } = await open(t, { mode: 'ready' });
  await fillExpense(page, { category: null, amount: '12.345' });
  await page.click('#add-save');
  await page.waitForSelector('[data-error="amount"]:not([hidden])');
  assert.match(await text(page, '[data-error="amount"]'), /amount in rand/);
  assert.equal(await page.locator('[data-field="amount"] input').getAttribute('aria-invalid'), 'true');
  await page.fill('[data-field="amount"] input', '12.35');
  await page.click('#add-save');
  await page.waitForSelector('[data-error="category"]:not([hidden])');
  assert.equal(await page.locator('[data-error="amount"]').isHidden(), true, 'the old message goes');
  assert.equal(dev.gas.rows('Expenses').length, 0);
});

test('money in: an owner loan, and a cash sale without an owner', async (t) => {
  const { dev, page } = await open(t, { mode: 'ready' });
  await page.click('[data-role="add-money"]');
  assert.equal(await page.locator('[data-field="sachets"]').isHidden(), true);
    await page.fill('[data-field="amount"] input', '2000');
  await page.click('#add-save');
  await page.waitForSelector('#toast:not([hidden])');
  await press(page, 'Kind', 'Other sale');
  assert.equal(await page.locator('[data-field="who"]').isHidden(), true);
  assert.match(await text(page, '[data-role="kind-help"]'), /race stall/);
  await page.fill('[data-field="amount"] input', '400');
  await page.fill('[data-field="sachets"] input', '10');
  await page.click('#add-save');
  await page.waitForFunction(() => /M-0002/.test((document.getElementById('toast') || {}).textContent));
  const rows = dev.gas.rows('Money in');
  assert.deepEqual(rows.map((r) => [r.Kind, r.Who, r.Amount, r.Sachets]), [['Loan', 'Greg', 2000, 0], ['Other sale', '', 400, 10]]);
});

test('a date before the books start gets a note, and the entry still saves', async (t) => {
  const { dev, page } = await open(t); // the sample books start on 1 Sep 2026
  const note = page.locator('[data-role="before-start"]');
  assert.equal(await note.isHidden(), true, 'no note for today');
  await page.fill('[data-field="date"] input', '2026-08-20');
  await note.waitFor();
  assert.match(await note.innerText(), /before the books start on 1 Sep 2026[\s\S]*not cash on hand/);
  await page.fill('[data-field="date"] input', '2026-09-01');
  assert.equal(await note.isHidden(), true, 'the start day itself counts');
  await page.fill('[data-field="date"] input', '2026-08-20');
  await fillExpense(page, { amount: '75', what: 'Test sachets', paidBy: 'Greg' });
  await page.click('#add-save');
  await page.waitForFunction(() => /Saved E-0008/.test((document.getElementById('toast') || {}).textContent));
  assert.equal(dev.gas.rows('Expenses').find((r) => r.ID === 'E-0008').Date, '2026-08-20');

  // Editing it later shows the note straight away. A batch never gets one: it moves no money.
  await tab(page, 'ledger');
  const entry = page.locator('.entry[data-id="E-0008"]');
  await entry.getByRole('button', { name: 'Edit' }).click();
  assert.equal(await entry.locator('[data-role="before-start"]').isVisible(), true);
  await tab(page, 'add');
  await page.click('[data-role="add-batch"]');
  await page.fill('[data-field="date"] input', '2026-08-20');
  assert.equal(await page.locator('#panel-add [data-role="before-start"]').count(), 0);

  // Moving the start day earlier in Settings makes the note go.
  await tab(page, 'settings');
  await page.fill('#s-books_start', '2026-08-01');
  await page.click('#settings-save');
  await page.waitForFunction(() => /Settings saved/.test((document.getElementById('toast') || {}).textContent));
  await tab(page, 'add');
  await page.click('[data-role="add-expense"]');
  await page.fill('[data-field="date"] input', '2026-08-20');
  assert.equal(await page.locator('#panel-add [data-role="before-start"]').isHidden(), true);
});

test('a batch gives the cost per sachet in the ledger', async (t) => {
  const { page } = await open(t, { mode: 'ready' });
  await page.click('[data-role="add-batch"]');
  await page.fill('[data-field="flavour"] input', 'Orange');
  await page.fill('[data-field="sachets"] input', '80');
  await page.fill('[data-field="cost"] input', '1000');
  await page.click('#add-save');
  await page.waitForSelector('#toast:not([hidden])');
  await tab(page, 'ledger');
  assert.match(await text(page, '.entry[data-id="B-0001"]'), /80 Orange sachets made[\s\S]*R12\.50 a sachet/);
});

test('the ledger filters by kind, month and search, and flags missing receipts', async (t) => {
  const { page } = await open(t);
  await tab(page, 'ledger');
  assert.match(await text(page, '#ledger-total'), /^12 entries/);
  await page.click('[data-role="type-expense"]');
  assert.match(await text(page, '#ledger-total'), /^7 entries · in R0\.00 · out R4,017\.00/);
  assert.equal(await page.locator('.entry .flag', { hasText: 'No receipt' }).count(), 5);
  await page.selectOption('#ledger-month', '2026-10');
  assert.match(await text(page, '#ledger-total'), /^3 entries/);
  await page.fill('#ledger-search', 'claude');
  assert.match(await text(page, '#ledger-total'), /^1 entry/);
  await page.fill('#ledger-search', 'nothing like this');
  assert.equal(await text(page, '#ledger-list .empty'), 'Nothing matches.');
});

test('edit an entry and add its receipt later, then remove another', async (t) => {
  const { dev, page } = await open(t);
  await tab(page, 'ledger');
  const entry = page.locator('.entry[data-id="E-0005"]');
  await entry.getByRole('button', { name: 'Edit' }).click();
  await entry.locator('[data-field="amount"] input').fill('380');
  await entry.locator('[data-field="receipt"] input').setInputFiles({ name: 'invoice.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
  await entry.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForFunction(() => /Saved E-0005/.test((document.getElementById('toast') || {}).textContent));
  const saved = dev.gas.rows('Expenses').find((r) => r.ID === 'E-0005');
  assert.equal(saved.Amount, 380);
  assert.equal(saved.Receipt, 'https://drive.google.com/file/d/file-1/view');
  assert.equal(saved['Edited on'], '2026-11-03 10:00');
  assert.equal(dev.gas.drive.files[0].type, 'application/pdf');

  const other = page.locator('.entry[data-id="E-0007"]');
  await other.getByRole('button', { name: 'Edit' }).click();
  await other.getByRole('button', { name: 'Remove' }).click();
  assert.equal(dev.gas.rows('Expenses').find((r) => r.ID === 'E-0007')['Removed on'], '', 'the first tap only asks');
  await other.getByRole('button', { name: /Tap again/ }).click();
  await page.waitForFunction(() => /Removed E-0007/.test((document.getElementById('toast') || {}).textContent));
  assert.equal(await page.locator('.entry[data-id="E-0007"]').count(), 0);
  assert.equal(dev.gas.rows('Expenses').find((r) => r.ID === 'E-0007')['Removed on'], '2026-11-03 10:00');
});

test('the report for last month adds up, and changes after a new expense', async (t) => {
  const { page } = await open(t);
  await tab(page, 'report');
  await page.click('[data-role="period-last-month"]');
  await page.waitForSelector('#report-profit');
  // October 2026: sales SJ-0003 R259, SJ-0004 R360, SJ-0006 R320 (card), stall R600.
  // Costs: R850 + R360 + R238 + card fee R10.28.
  const income = await text(page, '[data-role="income"]');
  assert.match(income, /Website sales: 3 orders, 22 sachets\s+R840\.00/);
  assert.match(income, /after discount codes of\s+R40\.00/);
  assert.match(income, /Delivery and collection fees charged\s+R99\.00/);
  assert.match(income, /Income\s+R1,539\.00/);
  const costs = await text(page, '[data-role="costs"]');
  assert.match(costs, /Card fees \(estimated from 1 card payment\)\s+R10\.28/);
  assert.match(costs, /Costs\s+R1,458\.28/);
  assert.equal(await text(page, '#report-profit'), 'R80.72');
  assert.match(await text(page, '[data-role="owners"] [data-owner="Sam"]'), /The business owes Sam\s+R360\.00/);

  // A new October expense: the report is worked out again.
  await tab(page, 'add');
  await page.fill('[data-field="date"] input', '2026-10-20');
  await fillExpense(page, { amount: '100.72' });
  await page.click('#add-save');
  await page.waitForSelector('#toast:not([hidden])');
  await tab(page, 'report');
  await page.waitForSelector('#report-profit');
  assert.equal(await text(page, '#report-profit'), '−R20.00');
  assert.match(await text(page, '[data-role="headline"]'), /^Loss/);
});

test('the tax year and custom dates', async (t) => {
  const { page } = await open(t);
  await tab(page, 'report');
  await page.click('[data-role="period-tax-year"]');
  await page.waitForSelector('#report-profit');
  assert.match(await text(page, '[data-role="tax-year"]'), /Tax year 2026\/27[\s\S]*1 Mar 2026 to 28 Feb 2027[\s\S]*Turnover\s+R2,597\.00[\s\S]*0\.3% of R1,000,000/);
  assert.match(await text(page, '[data-role="per-sachet"]'), /Should be in the freezer\s+160/);
  await page.click('[data-role="period-custom"]');
  assert.equal(await page.locator('#report-body').count(), 0, 'nothing until the dates are picked');
  await page.fill('#report-from', '2026-09-01');
  await page.fill('#report-to', '2026-09-30');
  await page.getByRole('button', { name: 'Show' }).click();
  await page.waitForSelector('#report-profit');
  assert.match(await text(page, '#report-body'), /1 Sep 2026 to 30 Sep 2026/);
  assert.match(await text(page, '[data-role="income"]'), /2 orders, 18 sachets/);
});

test('the download is a CSV of the period', async (t) => {
  const { page } = await open(t);
  await tab(page, 'report');
  await page.waitForSelector('#report-profit');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#report-download')]);
  assert.equal(download.suggestedFilename(), 'supa-juice-books-2026-11-01-to-2026-11-03.csv');
  const csv = fs.readFileSync(await download.path(), 'utf8');
  assert.ok(csv.startsWith('﻿Date,Type,Reference'));
  assert.match(csv, /2026-11-01,Website sale,SJ-0007/);
  assert.match(csv, /2026-11-02,Expense,E-0007,Ingredients/);
});

test('without website sales connected, the report says so', async (t) => {
  const { page } = await open(t, { mode: 'unconnected' });
  await tab(page, 'report');
  await page.waitForSelector('#report-profit');
  assert.match(await text(page, '#report-body .alert'), /not connected yet/);
  await tab(page, 'settings');
  assert.match(await text(page, '#panel-settings .alert'), /ORDER_SHEET_ID/);
});

test('owners: add a name and it is saved straight away, then remove it', async (t) => {
  const { dev, page } = await open(t, { mode: 'ready' });
  await tab(page, 'settings');
  const names = () => page.locator('#owner-list .owner-row-name').allInnerTexts();
  assert.deepEqual(await names(), ['Greg']);
  assert.match(await text(page, '#owner-list [data-owner="Greg"]'), /At least one owner/);
  await page.fill('#s-owner-new', '  Sam   Jones ');
  await page.press('#s-owner-new', 'Enter');
  await page.waitForFunction(() => /Added Sam Jones/.test((document.getElementById('toast') || {}).textContent));
  assert.deepEqual(await names(), ['Greg', 'Sam Jones']);
  assert.equal(await page.inputValue('#s-owner-new'), '', 'the box is empty for the next name');
  assert.equal(dev.gas.rows('Settings').find((r) => r.Key === 'owners').Value, 'Greg, Sam Jones');
  await tab(page, 'add');
  assert.equal(await page.locator('[data-choice="Paid by"] [data-value="Sam Jones"]').count(), 1);

  await tab(page, 'settings');
  for (const [typed, message] of [['', /Type a name/], ['greg', /already an owner/], ['A, B', /without commas/], ['Business', /Who paid/]]) {
    await page.fill('#s-owner-new', typed);
    await page.click('#owner-add');
    assert.match(await text(page, '#owner-error'), message);
  }
  await page.getByRole('button', { name: 'Remove Sam Jones' }).click();
  await page.waitForFunction(() => /Removed Sam Jones/.test((document.getElementById('toast') || {}).textContent));
  assert.deepEqual(await names(), ['Greg']);
  assert.equal(await page.locator('#owner-error').isHidden(), true);
});

test('owners: removing someone with entries asks first, and keeps their history', async (t) => {
  const { dev, page } = await open(t);
  await tab(page, 'settings');
  // In the sample books Greg lent money and Sam paid for Claude Code.
  assert.match(await text(page, '#owner-list [data-owner="Greg"]'), /Has entries/);
  assert.match(await text(page, '#owner-list [data-owner="Sam"]'), /Has entries/);
  await page.getByRole('button', { name: 'Remove Sam' }).click();
  assert.match(await text(page, '#owner-error'), /Sam has entries[\s\S]*Tap again/);
  assert.equal(dev.gas.rows('Settings').find((r) => r.Key === 'owners').Value, 'Greg, Sam', 'the first tap only asks');
  await page.getByRole('button', { name: 'Tap again to remove Sam' }).click();
  await page.waitForFunction(() => /Removed Sam\. Their entries stay/.test((document.getElementById('toast') || {}).textContent));
  assert.deepEqual(await page.locator('#owner-list .owner-row-name').allInnerTexts(), ['Greg']);
  assert.match(await text(page, '#owner-list [data-owner="Greg"]'), /At least one owner/);

  // New entries no longer offer Sam, but Sam's old entry still names Sam and can be edited.
  await tab(page, 'add');
  assert.equal(await page.locator('#panel-add [data-choice="Paid by"] [data-value="Sam"]').count(), 0);
  await tab(page, 'ledger');
  const entry = page.locator('.entry[data-id="E-0005"]');
  await entry.getByRole('button', { name: 'Edit' }).click();
  assert.equal(await entry.locator('[data-choice="Paid by"] [data-value="Sam"]').getAttribute('aria-pressed'), 'true');
  await entry.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForFunction(() => /Saved E-0005/.test((document.getElementById('toast') || {}).textContent));

  // The report still shows what the business owes Sam.
  await tab(page, 'report');
  await page.click('[data-role="period-tax-year"]');
  await page.waitForSelector('#report-profit');
  assert.match(await text(page, '[data-role="owners"] [data-owner="Sam"]'), /Sam \(former owner\)[\s\S]*The business owes Sam\s+R360\.00/);
});

test('settings: card fees explain themselves, with a live example', async (t) => {
  const { dev, page } = await open(t, { mode: 'ready' });
  await tab(page, 'settings');
  const box = page.locator('[data-role="card-fees"]');
  const example = box.locator('[data-role="fee-example"]');
  assert.match(await box.innerText(), /Paystack keeps a small fee/);
  assert.equal(await box.locator('[data-value="Estimate for me"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await example.innerText(), 'Example: on a R200 card payment, Paystack keeps about R6.80, so R193.20 reaches the bank.');
  await page.fill('#s-card_fee_percent', '3.5');
  await page.fill('#s-card_fee_fixed', '0');
  assert.match(await example.innerText(), /keeps about R7\.00, so R193\.00/);
  await page.fill('#s-card_fee_fixed', '');
  assert.match(await example.innerText(), /Enter the percent and the fixed amount/);
  await page.fill('#s-card_fee_fixed', '1');

  // Adding them yourself hides the rate, which is then not used.
  await press(page, 'How should the books count them?', 'I’ll add them');
  assert.equal(await box.locator('[data-role="fee-rates"]').isHidden(), true);
  assert.match(await box.locator('[data-role="fee-help"]').innerText(), /Payment fees[\s\S]*never counted twice/);
  await page.click('#settings-save');
  await page.waitForFunction(() => /Settings saved/.test((document.getElementById('toast') || {}).textContent));
  const saved = Object.fromEntries(dev.gas.rows('Settings').map((r) => [r.Key, r.Value]));
  assert.deepEqual([saved.card_fees, saved.card_fee_percent, saved.card_fee_fixed], ['recorded', '3.5', '1']);
  // After saving, the page shows the choice that was saved.
  assert.equal(await page.locator('[data-role="fee-rates"]').isHidden(), true);
});

test('settings: VAT adds a field, and a bad value is shown under its field', async (t) => {
  const { page } = await open(t, { mode: 'ready' });
  await tab(page, 'settings');
  await press(page, 'Registered for VAT', 'Yes');
  await page.click('#settings-save');
  await page.waitForFunction(() => /Settings saved/.test((document.getElementById('toast') || {}).textContent));
  await tab(page, 'add');
  assert.equal(await page.locator('[data-field="vat"]').count(), 1);
  await tab(page, 'settings');
  await page.fill('#s-card_fee_percent', '40');
  await page.click('#settings-save');
  await page.waitForSelector('[data-error="card_fee_percent"]:not([hidden])');
});

test('every tab fits a 320px phone in dark mode', async (t) => {
  const { page } = await open(t, { width: 320, scheme: 'dark' });
  for (const name of ['add', 'ledger', 'report', 'settings']) {
    await tab(page, name);
    if (name === 'report') await page.waitForSelector('#report-profit');
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(wide <= 320, name + ' is ' + wide + 'px wide');
  }
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(bg, 'rgb(17, 17, 17)');
});

test('the page only sends simple requests with the key', async (t) => {
  const { dev, page } = await open(t);
  await tab(page, 'report');
  await page.waitForSelector('#report-profit');
  assert.ok(dev.calls.length >= 2);
  dev.calls.forEach((c) => {
    assert.equal(c.method, 'POST');
    assert.match(c.contentType, /^text\/plain/);
  });
});
