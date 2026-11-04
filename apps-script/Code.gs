/**
 * Supa Juice books: Google Apps Script backend.
 *
 * Lives in its own Google Sheet ("Supa Juice Books", Extensions > Apps Script) and is
 * deployed as its own web app (Execute as: Me, Who has access: Anyone). It is separate
 * from the order site: deploying this never changes the order page or its backend.
 *
 *   Expenses   one row per receipt: what the business spent, and who paid
 *   Money in   owners putting money in (a loan or capital), paying an owner back, other sales
 *   Batches    sachets made, and what the batch cost, for the cost per sachet
 *   Settings   key / value / note, editable here or from the books page
 *
 * Website sales are READ from the order Sheet (its ID is kept in Script properties as
 * ORDER_SHEET_ID). This script never writes to the order Sheet.
 *
 * Nothing is ever deleted. "Remove" stamps the row's "Removed on" column, so the books
 * keep a trail of every change, which an accountant or SARS may ask for.
 *
 * The page calls this with POST requests. The body is JSON sent as text/plain, which
 * avoids a CORS preflight request (Apps Script cannot answer one). Every action needs the
 * admin key kept in Script properties.
 *
 * Actions   list, add, edit, remove, report, export, uploadReceipt, saveSettings
 *
 * Run setup() once after pasting this in. See SETUP-GUIDE.md.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SETTINGS_TAB = 'Settings';

const CATEGORIES = ['Ingredients', 'Packaging', 'Shipping & boxes', 'Payment fees', 'Tech & software', 'Marketing', 'Other'];

// Money in: an owner's loan (paid back later), an owner's capital (their share in the
// business), the business paying an owner back, and sales that did not go through the website.
const KINDS = ['Loan', 'Capital', 'Paid back', 'Other sale'];
const OWNER_KINDS = ['Loan', 'Capital', 'Paid back'];

// Who paid for an expense: the business account, or one of the owners from their own pocket.
const BUSINESS = 'Business';

// Turnover above this in a tax year means VAT registration is compulsory, and it is also the
// ceiling for SARS turnover tax for micro businesses.
const TURNOVER_LIMIT = 1000000;

const MAX_AMOUNT_CENTS = 100000000; // R1,000,000 for one entry
const FIRST_DATE = '2020-01-01';

// One table per kind of entry. New columns go at the end, so older rows still line up.
const TABLES = {
  expense: {
    tab: 'Expenses', prefix: 'E',
    fields: ['id', 'date', 'amount', 'category', 'supplier', 'what', 'paidBy', 'vat', 'receipt', 'notes', 'added', 'edited', 'removed'],
    headers: ['ID', 'Date', 'Amount', 'Category', 'Supplier', 'What', 'Paid by', 'VAT', 'Receipt', 'Notes', 'Added on', 'Edited on', 'Removed on'],
    formats: ['@', '@', '0.00', '@', '@', '@', '@', '0.00', '@', '@', '@', '@', '@'],
    widths: [80, 100, 90, 140, 160, 220, 100, 80, 260, 220, 130, 130, 130]
  },
  money: {
    tab: 'Money in', prefix: 'M',
    fields: ['id', 'date', 'amount', 'kind', 'who', 'sachets', 'notes', 'added', 'edited', 'removed'],
    headers: ['ID', 'Date', 'Amount', 'Kind', 'Who', 'Sachets', 'Notes', 'Added on', 'Edited on', 'Removed on'],
    formats: ['@', '@', '0.00', '@', '@', '0', '@', '@', '@', '@'],
    widths: [80, 100, 90, 110, 120, 80, 260, 130, 130, 130]
  },
  batch: {
    tab: 'Batches', prefix: 'B',
    fields: ['id', 'date', 'flavour', 'sachets', 'cost', 'notes', 'added', 'edited', 'removed'],
    headers: ['ID', 'Date', 'Flavour', 'Sachets', 'Cost', 'Notes', 'Added on', 'Edited on', 'Removed on'],
    formats: ['@', '@', '@', '0', '0.00', '@', '@', '@', '@'],
    widths: [80, 100, 140, 80, 90, 260, 130, 130, 130]
  }
};
// Which fields hold rand amounts (kept in the sheet as rand, worked with in cents).
const MONEY_FIELDS = { amount: true, vat: true, cost: true };
const NUMBER_FIELDS = { sachets: true };

const SETTING_DEFS = [
  { key: 'brand_name', value: 'Supa Juice', note: 'Shown at the top of the books page and in the download.' },
  { key: 'owners', value: 'Greg', note: 'The people who put money in or pay for things themselves, separated by commas.' },
  { key: 'books_start', value: '2026-03-01', note: 'The day these books start (YYYY-MM-DD). Cash on hand counts from this day.' },
  { key: 'opening_balance', value: '0', note: 'What was in the business account on the start day, in rand.' },
  { key: 'card_fees', value: 'estimate', note: 'estimate: card fees are worked out from the rate below for each card-paid order. recorded: you enter them as Payment fees expenses from the Paystack statement.' },
  { key: 'card_fee_percent', value: '2.9', note: 'Paystack percent per card payment (South African cards). Check your Paystack dashboard.' },
  { key: 'card_fee_fixed', value: '1', note: 'Paystack fixed fee per card payment, in rand.' },
  { key: 'vat_registered', value: 'no', note: 'yes: expenses get a VAT field. Registration is compulsory above R1 million turnover in 12 months.' }
];

// Website orders that count as sales.
const SOLD = ['Paid', 'Delivered'];
const CARD_TAG = /Paid by card \(Paystack/;

// ---------------------------------------------------------------------------
// Web app entry points
// ---------------------------------------------------------------------------

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e && e.postData && e.postData.contents ? e.postData.contents : '');
  } catch (err) {
    return json_({ ok: false, error: 'bad_request', message: 'Could not read the request.' });
  }
  return json_(handle_(body));
}

// Opening the web app address in a browser shows that it is alive.
function doGet() {
  return json_({ ok: true, service: 'books' });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(body) {
  try {
    if (!body || typeof body !== 'object') throw fail_('bad_request', 'Could not read the request.');
    requireAdmin_(body.key);
    switch (body.action) {
      case 'list': return list_();
      case 'add': return withLock_(function () { return addEntry_(body); });
      case 'edit': return withLock_(function () { return editEntry_(body); });
      case 'remove': return withLock_(function () { return removeEntry_(body); });
      case 'report': return { ok: true, report: report_(body.from, body.to) };
      case 'export': return exportCsv_(body);
      case 'uploadReceipt': return uploadReceipt_(body);
      case 'saveSettings': return withLock_(function () { return saveSettings_(body); });
      default: throw fail_('bad_request', 'Unknown action.');
    }
  } catch (err) {
    if (err && err.code) {
      const out = { ok: false, error: err.code, message: err.publicMessage || '' };
      if (err.data) Object.keys(err.data).forEach(function (k) { out[k] = err.data[k]; });
      return out;
    }
    console.error(err && err.stack ? err.stack : String(err));
    return { ok: false, error: 'server_error', message: 'Something went wrong. Please try again.' };
  }
}

// An error with a code the page understands and a message safe to show.
function fail_(code, message, data) {
  const e = new Error(message || code);
  e.code = code;
  e.publicMessage = message || '';
  if (data) e.data = data;
  return e;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    throw fail_('busy', 'The books are busy. Please try again in a moment.');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

function list_() {
  const s = readSettings_();
  const entries = {};
  Object.keys(TABLES).forEach(function (kind) {
    entries[kind] = readTable_(kind).filter(function (e) { return !e.removed; }).map(publicEntry_);
  });
  // Paid website orders, for the ledger. They are only read: they change on the order site.
  const web = websiteSales_();
  const sales = web.orders.map(function (o) {
    return { id: o.invoice, date: o.date, qty: o.qty, total: o.total / 100, fee: o.fee / 100, discount: o.discount / 100, card: o.card };
  });
  return {
    ok: true,
    entries: entries,
    sales: sales,
    settings: s.raw,
    owners: s.owners,
    categories: CATEGORIES,
    kinds: KINDS,
    vatRegistered: s.vatRegistered,
    salesConnected: web.connected,
    salesMessage: web.message || '',
    today: today_()
  };
}

// Amounts go out in rand.
function publicEntry_(e) {
  const out = {};
  Object.keys(e).forEach(function (k) {
    if (k === 'row' || k === 'removed') return;
    out[k] = MONEY_FIELDS[k] ? e[k] / 100 : e[k];
  });
  return out;
}

function addEntry_(body) {
  const kind = tableKind_(body.kind);
  const t = TABLES[kind];
  const entry = cleanEntry_(kind, body.entry, readSettings_());
  const props = PropertiesService.getScriptProperties();
  const next = (Number(props.getProperty('LAST_' + t.prefix)) || 0) + 1;
  entry.id = t.prefix + '-' + pad_(next, 4);
  entry.added = nowString_();
  entry.edited = '';
  entry.removed = '';
  const sheet = tableSheet_(kind);
  const row = Math.max(sheet.getLastRow(), 1) + 1;
  if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 500);
  sheet.getRange(row, 1, 1, t.fields.length).setValues([toRow_(kind, entry)]);
  props.setProperty('LAST_' + t.prefix, String(next));
  return { ok: true, entry: publicEntry_(entry) };
}

function editEntry_(body) {
  const kind = tableKind_(body.kind);
  const t = TABLES[kind];
  const found = findEntry_(kind, body.id);
  const entry = cleanEntry_(kind, body.entry, readSettings_(), found);
  entry.id = found.id;
  entry.added = found.added;
  entry.edited = nowString_();
  entry.removed = '';
  tableSheet_(kind).getRange(found.row, 1, 1, t.fields.length).setValues([toRow_(kind, entry)]);
  return { ok: true, entry: publicEntry_(entry) };
}

function removeEntry_(body) {
  const kind = tableKind_(body.kind);
  const found = findEntry_(kind, body.id);
  const col = TABLES[kind].fields.indexOf('removed') + 1;
  tableSheet_(kind).getRange(found.row, col).setValue(nowString_());
  return { ok: true, id: found.id };
}

function tableKind_(kind) {
  if (!Object.prototype.hasOwnProperty.call(TABLES, kind)) throw fail_('bad_request', 'Unknown kind of entry.');
  return kind;
}

function findEntry_(kind, id) {
  const wanted = str_(id);
  const hit = readTable_(kind).filter(function (e) { return e.id === wanted && !e.removed; })[0];
  if (!hit) throw fail_('not_found', 'Entry ' + wanted + ' was not found. It may have been removed. Refresh to see the latest.');
  return hit;
}

// Checks one entry from the page and returns it ready for the sheet (amounts in cents).
// existing: the entry being edited. It may keep naming someone who is no longer an owner,
// but a new entry can only name a current owner.
function cleanEntry_(kind, raw, s, existing) {
  if (!raw || typeof raw !== 'object') throw fail_('invalid', 'Fill in the entry.');
  const people = s.owners.slice();
  if (existing && existing.paidBy && existing.paidBy !== BUSINESS) people.push(existing.paidBy);
  if (existing && existing.who) people.push(existing.who);
  const e = {};
  e.date = checkDate_(raw.date);
  e.notes = clean_(raw.notes, 300);

  if (kind === 'expense') {
    e.amount = checkMoney_(raw.amount, 'amount', true);
    if (CATEGORIES.indexOf(raw.category) === -1) throw invalid_('category', 'Pick a category.');
    e.category = raw.category;
    e.supplier = clean_(raw.supplier, 80);
    e.what = clean_(raw.what, 120);
    if (!e.what) throw invalid_('what', 'Say what it was for, for example "Maltodextrin 5 kg".');
    const payers = [BUSINESS].concat(people);
    if (payers.indexOf(raw.paidBy) === -1) throw invalid_('paidBy', 'Pick who paid.');
    e.paidBy = raw.paidBy;
    e.vat = s.vatRegistered ? checkMoney_(raw.vat || 0, 'vat', false) : 0;
    if (e.vat > e.amount) throw invalid_('vat', 'The VAT cannot be more than the amount.');
    e.receipt = str_(raw.receipt);
    if (e.receipt && !/^https:\/\/[^\s]{4,500}$/.test(e.receipt)) throw invalid_('receipt', 'The receipt link is not right.');
  } else if (kind === 'money') {
    e.amount = checkMoney_(raw.amount, 'amount', true);
    if (KINDS.indexOf(raw.kind) === -1) throw invalid_('kind', 'Pick what kind of money this is.');
    e.kind = raw.kind;
    if (OWNER_KINDS.indexOf(e.kind) !== -1) {
      if (people.indexOf(raw.who) === -1) throw invalid_('who', 'Pick which owner.');
      e.who = raw.who;
      e.sachets = 0;
    } else {
      e.who = '';
      e.sachets = checkWhole_(raw.sachets || 0, 'sachets', 0, 100000, 'Sachets sold must be a whole number.');
    }
  } else {
    e.flavour = clean_(raw.flavour, 40);
    if (!e.flavour) throw invalid_('flavour', 'Say which flavour, for example Orange.');
    e.sachets = checkWhole_(raw.sachets, 'sachets', 1, 100000, 'Sachets made must be a whole number of 1 or more.');
    e.cost = checkMoney_(raw.cost, 'cost', false);
  }
  return e;
}

function invalid_(field, message) {
  return fail_('invalid', message, { field: field });
}

// "YYYY-MM-DD", a real day, not in the future.
function checkDate_(v) {
  const d = str_(v);
  if (!isDay_(d)) throw invalid_('date', 'Enter the date.');
  if (d < FIRST_DATE) throw invalid_('date', 'That date is too far back.');
  if (d > today_()) throw invalid_('date', 'The date cannot be in the future.');
  return d;
}

function isDay_(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return false;
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return t.getUTCFullYear() === +m[1] && t.getUTCMonth() === +m[2] - 1 && t.getUTCDate() === +m[3];
}

// Rand to cents. Reads "40", "R40", "R 1 234,50". mustBePositive: more than R0.
function checkMoney_(v, field, mustBePositive) {
  const cents = parseCents_(v);
  if (cents === null) throw invalid_(field, 'Enter the amount in rand, for example 249.90.');
  if (cents < 0) throw invalid_(field, 'The amount cannot be negative.');
  if (mustBePositive && cents === 0) throw invalid_(field, 'The amount must be more than R0.');
  if (cents > MAX_AMOUNT_CENTS) throw invalid_(field, 'That amount is too large for one entry.');
  return cents;
}

function parseCents_(v) {
  if (typeof v === 'number') return isFinite(v) ? Math.round(v * 100) : null;
  let t = str_(v).replace(/^R\s*/i, '').replace(/[\s ]/g, '');
  if (/^-?\d+,\d{1,2}$/.test(t)) t = t.replace(',', '.');
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}

function checkWhole_(v, field, min, max, message) {
  const n = Number(str_(v));
  if (!/^\d+$/.test(str_(v)) || n < min || n > max) throw invalid_(field, message);
  return n;
}

// ---------------------------------------------------------------------------
// Reading and writing the tabs
// ---------------------------------------------------------------------------

function tableSheet_(kind) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABLES[kind].tab);
  if (!sheet) throw fail_('not_ready', 'The books are not set up yet. Run setup in Apps Script.');
  return sheet;
}

// Every row of a tab as an entry, amounts in cents. Includes removed rows.
function readTable_(kind) {
  const t = TABLES[kind];
  const sheet = tableSheet_(kind);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, t.fields.length).getValues().map(function (r, i) {
    const e = { row: i + 2 };
    t.fields.forEach(function (f, j) {
      const v = r[j];
      if (MONEY_FIELDS[f]) e[f] = Math.round((Number(v) || 0) * 100);
      else if (NUMBER_FIELDS[f]) e[f] = Number(v) || 0;
      else if (f === 'date') e[f] = dayText_(v);
      else e[f] = str_(v);
    });
    return e;
  }).filter(function (e) { return e.id; });
}

function toRow_(kind, e) {
  return TABLES[kind].fields.map(function (f) {
    const v = e[f];
    if (MONEY_FIELDS[f]) return (v || 0) / 100;
    if (NUMBER_FIELDS[f]) return v || 0;
    return safe_(str_(v));
  });
}

// A date cell as "YYYY-MM-DD", also when someone typed a date straight into the sheet.
function dayText_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm').slice(0, 10);
  return str_(v).slice(0, 10);
}

// ---------------------------------------------------------------------------
// Website sales (read only, from the order Sheet)
// ---------------------------------------------------------------------------

// ORDER_SHEET_ID can be the Sheet's ID, or simply its whole address copied from the
// browser (https://docs.google.com/spreadsheets/d/<ID>/edit...): the ID is taken from it.
function orderSheetId_() {
  const raw = str_(PropertiesService.getScriptProperties().getProperty('ORDER_SHEET_ID'));
  const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(raw);
  return m ? m[1] : raw;
}

// Paid and delivered website orders: { invoice, date, qty, total, fee, sachets, discount, card } in cents.
// The columns are found by their header names, so the order Sheet can gain columns freely.
function websiteSales_() {
  const id = orderSheetId_();
  if (!id) return { connected: false, message: 'Website sales are not connected yet. See SETUP-GUIDE.md.', orders: [] };
  let sheet;
  try {
    sheet = SpreadsheetApp.openById(id).getSheetByName('Orders');
  } catch (err) {
    return { connected: false, message: 'Could not open the order Sheet. Check ORDER_SHEET_ID in Script properties.', orders: [] };
  }
  if (!sheet) return { connected: false, message: 'The order Sheet has no Orders tab.', orders: [] };
  const last = sheet.getLastRow();
  const width = sheet.getLastColumn();
  if (last < 2 || width < 1) return { connected: true, orders: [] };
  const head = sheet.getRange(1, 1, 1, width).getValues()[0].map(str_);
  const at = function (name) { return head.indexOf(name); };
  const c = {
    invoice: at('Invoice'), created: at('Created'), qty: at('Qty'), price: at('Unit price'), fee: at('Delivery fee'),
    total: at('Total'), status: at('Status'), paid: at('Paid on'), notes: at('Notes')
  };
  if (c.invoice < 0 || c.qty < 0 || c.total < 0 || c.status < 0) {
    return { connected: false, message: 'The order Sheet columns have changed. The books cannot read the sales.', orders: [] };
  }
  const orders = [];
  sheet.getRange(2, 1, last - 1, width).getValues().forEach(function (r) {
    if (SOLD.indexOf(str_(r[c.status])) === -1) return;
    const qty = Number(r[c.qty]) || 0;
    const total = Math.round((Number(r[c.total]) || 0) * 100);
    const fee = c.fee < 0 ? 0 : Math.round((Number(r[c.fee]) || 0) * 100);
    const items = c.price < 0 ? total - fee : Math.round((Number(r[c.price]) || 0) * 100) * qty;
    const sachets = total - fee; // what the sachets brought in, after any discount
    const date = dayText_(c.paid >= 0 && r[c.paid] ? r[c.paid] : r[c.created]);
    orders.push({
      invoice: str_(r[c.invoice]), date: date, qty: qty, total: total, fee: fee, sachets: sachets,
      discount: Math.max(0, items - sachets),
      card: c.notes >= 0 && CARD_TAG.test(str_(r[c.notes]))
    });
  });
  return { connected: true, orders: orders };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

// Profit and loss for a period, plus cash, owners, stock and the tax year, all as of `to`.
// Profit is on a cash basis: costs count when they are paid, sales when they are paid.
function report_(fromText, toText) {
  const from = str_(fromText);
  const to = str_(toText);
  if (!isDay_(from) || !isDay_(to)) throw fail_('invalid', 'Pick the dates for the report.');
  if (from > to) throw fail_('invalid', 'The start date is after the end date.');

  const s = readSettings_();
  const live = function (e) { return !e.removed; };
  const expenses = readTable_('expense').filter(live);
  const money = readTable_('money').filter(live);
  const batches = readTable_('batch').filter(live);
  const web = websiteSales_();
  const inPeriod = function (x) { return x.date >= from && x.date <= to; };
  const upTo = function (x) { return x.date <= to; };
  const cardFee = function (o) {
    return s.cardFees === 'estimate' && o.card ? Math.round(o.total * s.cardPercent / 100) + s.cardFixed : 0;
  };
  const sum = function (list, f) { return list.reduce(function (n, x) { return n + (typeof f === 'function' ? f(x) : x[f]); }, 0); };

  // Income
  const sold = web.orders.filter(inPeriod);
  const other = money.filter(function (m) { return m.kind === 'Other sale' && inPeriod(m); });
  const sales = {
    orders: sold.length,
    sachets: sum(sold, 'qty'),
    sachetIncome: sum(sold, 'sachets'),
    discounts: sum(sold, 'discount'),
    deliveryFees: sum(sold, 'fee'),
    total: sum(sold, 'total'),
    cardOrders: sold.filter(function (o) { return o.card; }).length
  };
  const otherSales = { count: other.length, sachets: sum(other, 'sachets'), total: sum(other, 'amount') };
  const income = sales.total + otherSales.total;

  // Costs
  const spent = expenses.filter(inPeriod);
  const byCategory = CATEGORIES.map(function (c) {
    const list = spent.filter(function (e) { return e.category === c; });
    return { category: c, count: list.length, total: sum(list, 'amount') };
  }).filter(function (c) { return c.count > 0; });
  const cardFees = sum(sold, cardFee);
  const costs = sum(spent, 'amount') + cardFees;

  // Per sachet. The cost to make is every batch so far: what was spent / sachets made.
  const madeSoFar = batches.filter(upTo);
  const made = sum(madeSoFar, 'sachets');
  const makeCost = sum(madeSoFar, 'cost');
  const sachetsSold = sales.sachets + otherSales.sachets;
  const costPerSachet = made > 0 ? Math.round(makeCost / made) : null;
  const avgPrice = sachetsSold > 0 ? Math.round((sales.sachetIncome + otherSales.total) / sachetsSold) : null;
  const soldSoFar = sum(web.orders.filter(upTo), 'qty') + sum(money.filter(function (m) { return m.kind === 'Other sale' && upTo(m); }), 'sachets');

  // Cash in the business account at the end of `to`, counted from the start day.
  const counted = function (x) { return x.date >= s.booksStart && x.date <= to; };
  const ownerIn = money.filter(function (m) { return (m.kind === 'Loan' || m.kind === 'Capital') && counted(m); });
  const paidBack = money.filter(function (m) { return m.kind === 'Paid back' && counted(m); });
  const webCash = web.orders.filter(counted);
  const cash = {
    since: s.booksStart,
    opening: s.openingBalance,
    ownersIn: sum(ownerIn, 'amount'),
    sales: sum(webCash, 'total') + sum(money.filter(function (m) { return m.kind === 'Other sale' && counted(m); }), 'amount'),
    spent: sum(expenses.filter(function (e) { return e.paidBy === BUSINESS && counted(e); }), 'amount') + sum(webCash, cardFee),
    paidBack: sum(paidBack, 'amount')
  };
  cash.onHand = cash.opening + cash.ownersIn + cash.sales - cash.spent - cash.paidBack;

  // Owners, all time up to `to`. Expenses an owner paid themselves are owed back to them, like a loan.
  // Someone removed from the owners still shows (as a former owner) while they have entries,
  // so money the business owes them never drops out of the report.
  const named = s.owners.slice();
  expenses.forEach(function (e) { if (e.paidBy !== BUSINESS && upTo(e) && named.indexOf(e.paidBy) === -1) named.push(e.paidBy); });
  money.forEach(function (m) { if (m.who && upTo(m) && named.indexOf(m.who) === -1) named.push(m.who); });
  const owners = named.map(function (name) {
    const mine = money.filter(function (m) { return m.who === name && upTo(m); });
    const o = {
      name: name,
      former: s.owners.indexOf(name) === -1,
      loan: sum(mine.filter(function (m) { return m.kind === 'Loan'; }), 'amount'),
      capital: sum(mine.filter(function (m) { return m.kind === 'Capital'; }), 'amount'),
      expenses: sum(expenses.filter(function (e) { return e.paidBy === name && upTo(e); }), 'amount'),
      paidBack: sum(mine.filter(function (m) { return m.kind === 'Paid back'; }), 'amount')
    };
    o.owed = o.loan + o.expenses - o.paidBack;
    return o;
  });

  // The SARS tax year (1 March to the end of February) that `to` falls in.
  const ty = taxYear_(to);
  const inYear = function (x) { return x.date >= ty.start && x.date <= to; };
  const turnover = sum(web.orders.filter(inYear), 'total') + sum(money.filter(function (m) { return m.kind === 'Other sale' && inYear(m); }), 'amount');

  const rand = function (c) { return c === null ? null : c / 100; };
  const randAll = function (o) {
    const out = {};
    Object.keys(o).forEach(function (k) { out[k] = typeof o[k] === 'number' && k !== 'orders' && k !== 'sachets' && k !== 'count' && k !== 'cardOrders' ? o[k] / 100 : o[k]; });
    return out;
  };
  return {
    from: from,
    to: to,
    salesConnected: web.connected,
    salesMessage: web.message || '',
    cardFeesMode: s.cardFees,
    sales: randAll(sales),
    otherSales: randAll(otherSales),
    income: rand(income),
    expenses: byCategory.map(function (c) { return { category: c.category, count: c.count, total: rand(c.total) }; }),
    cardFees: rand(cardFees),
    costs: rand(costs),
    profit: rand(income - costs),
    vatPaid: s.vatRegistered ? rand(sum(spent, 'vat')) : null,
    missingReceipts: spent.filter(function (e) { return !e.receipt; }).length,
    perSachet: { sold: sachetsSold, avgPrice: rand(avgPrice), costToMake: rand(costPerSachet), margin: avgPrice !== null && costPerSachet !== null ? rand(avgPrice - costPerSachet) : null },
    stock: { made: made, sold: soldSoFar, left: made - soldSoFar },
    cash: randAll(cash),
    owners: owners.map(randAll),
    taxYear: { label: ty.label, start: ty.start, end: ty.end, turnover: rand(turnover), limit: TURNOVER_LIMIT, percent: Math.round(turnover / (TURNOVER_LIMIT * 100) * 1000) / 10 }
  };
}

// "2026-11-03" -> { start: '2026-03-01', end: '2027-02-28', label: '2026/27' }
function taxYear_(day) {
  const y = Number(day.slice(0, 4));
  const startYear = Number(day.slice(5, 7)) >= 3 ? y : y - 1;
  const endYear = startYear + 1;
  const leap = (endYear % 4 === 0 && endYear % 100 !== 0) || endYear % 400 === 0;
  return {
    start: startYear + '-03-01',
    end: endYear + '-02-' + (leap ? '29' : '28'),
    label: startYear + '/' + String(endYear).slice(2)
  };
}

// ---------------------------------------------------------------------------
// Download for an accountant or investor
// ---------------------------------------------------------------------------

// Every entry and website sale in the period, one per line, with money in and money out in
// separate columns, then the report summary underneath.
function exportCsv_(body) {
  const r = report_(body.from, body.to);
  const s = readSettings_();
  const inPeriod = function (x) { return !x.removed && x.date >= r.from && x.date <= r.to; };
  const lines = [];
  readTable_('expense').filter(inPeriod).forEach(function (e) {
    lines.push([e.date, 'Expense', e.id, e.category, e.supplier, e.what, '', e.amount, s.vatRegistered ? e.vat : '', e.paidBy, e.receipt, e.notes]);
  });
  readTable_('money').filter(inPeriod).forEach(function (m) {
    const out = m.kind === 'Paid back';
    const what = m.kind === 'Other sale' ? (m.sachets ? m.sachets + ' sachets' : 'Sale') : (out ? 'Paid back to ' : 'Put in by ') + m.who;
    lines.push([m.date, m.kind === 'Other sale' ? 'Other sale' : 'Owner ' + m.kind.toLowerCase(), m.id, m.kind, m.who, what, out ? '' : m.amount, out ? m.amount : '', '', '', '', m.notes]);
  });
  websiteSales_().orders.filter(inPeriod).forEach(function (o) {
    lines.push([o.date, 'Website sale', o.invoice, 'Sales', '', o.qty + ' sachets' + (o.fee ? ', delivery ' + money_(o.fee / 100) : ''), o.total, '', '', '', '', o.card ? 'Paid by card' : '']);
  });
  readTable_('batch').filter(inPeriod).forEach(function (b) {
    lines.push([b.date, 'Batch made', b.id, b.flavour, '', b.sachets + ' sachets, cost ' + money_(b.cost / 100), '', '', '', '', '', b.notes]);
  });
  lines.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : String(a[2]) < String(b[2]) ? -1 : 1; });

  const cents = function (v) { return typeof v === 'number' ? (v / 100).toFixed(2) : v; };
  const rows = [['Date', 'Type', 'Reference', 'Category', 'Who / supplier', 'Description', 'Money in', 'Money out', 'VAT', 'Paid by', 'Receipt', 'Notes']];
  lines.forEach(function (l) {
    rows.push(l.map(function (v, i) { return i >= 6 && i <= 8 ? cents(v) : v; }));
  });
  const fixed = function (n) { return n === null ? '' : n.toFixed(2); };
  rows.push([]);
  rows.push(['Summary', r.from + ' to ' + r.to]);
  rows.push(['Income', fixed(r.income)]);
  r.expenses.forEach(function (c) { rows.push(['Spent: ' + c.category, fixed(c.total)]); });
  if (r.cardFees) rows.push(['Card fees (estimated)', fixed(r.cardFees)]);
  rows.push(['Costs', fixed(r.costs)]);
  rows.push(['Profit', fixed(r.profit)]);
  rows.push(['Cash on hand at ' + r.to, fixed(r.cash.onHand)]);
  r.owners.forEach(function (o) {
    rows.push(['Owed to ' + o.name, fixed(o.owed)]);
    rows.push(['Capital from ' + o.name, fixed(o.capital)]);
  });
  rows.push(['Turnover in tax year ' + r.taxYear.label, fixed(r.taxYear.turnover)]);
  if (!r.salesConnected) rows.push(['Note', r.salesMessage]);

  const csv = rows.map(function (row) { return row.map(csvCell_).join(','); }).join('\r\n') + '\r\n';
  return { ok: true, csv: csv, filename: 'supa-juice-books-' + r.from + '-to-' + r.to + '.csv' };
}

// A CSV cell. Text that a spreadsheet would read as a formula gets a leading quote mark.
function csvCell_(v) {
  let t = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t)) t = "'" + t;
  return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}

// ---------------------------------------------------------------------------
// Receipts (saved in Google Drive)
// ---------------------------------------------------------------------------

const RECEIPT_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
const RECEIPTS_FOLDER = 'Supa Juice receipts';

// A photo or PDF of a receipt. It goes in the "Supa Juice receipts" Drive folder, private to
// the account that runs this script, and the link is saved with the expense.
function uploadReceipt_(body) {
  const type = str_(body.type);
  const ext = RECEIPT_TYPES[type];
  if (!ext) throw fail_('invalid', 'The receipt must be a photo (JPEG, PNG, WebP) or a PDF.');
  const data = typeof body.data === 'string' ? body.data : '';
  if (!data || data.length > Math.ceil(MAX_RECEIPT_BYTES / 3) * 4) throw fail_('invalid', 'The receipt file is too large. The limit is 8 MB.');
  let bytes;
  try {
    bytes = Utilities.base64Decode(data);
  } catch (err) {
    throw fail_('invalid', 'Could not read the receipt file.');
  }
  const date = isDay_(str_(body.date)) ? str_(body.date) : today_();
  const label = clean_(body.label, 60).replace(/[\\/:*?"<>|]+/g, ' ').trim();
  const name = date + (label ? ' ' + label : '') + '.' + ext;
  const file = receiptsFolder_().createFile(Utilities.newBlob(bytes, type, name));
  return { ok: true, url: file.getUrl(), name: name };
}

function receiptsFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('RECEIPTS_FOLDER_ID');
  if (id) {
    try {
      return DriveApp.getFolderById(id);
    } catch (err) { /* deleted: make a new one */ }
  }
  const folder = DriveApp.createFolder(RECEIPTS_FOLDER);
  props.setProperty('RECEIPTS_FOLDER_ID', folder.getId());
  return folder;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function settingsSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SETTINGS_TAB);
  if (!sheet) throw fail_('not_ready', 'The books are not set up yet. Run setup in Apps Script.');
  return sheet;
}

function readRawSettings_() {
  const sheet = settingsSheet_();
  const raw = {};
  SETTING_DEFS.forEach(function (d) { raw[d.key] = d.value; });
  const last = sheet.getLastRow();
  if (last >= 2) {
    sheet.getRange(2, 1, last - 1, 2).getValues().forEach(function (r) {
      const k = str_(r[0]);
      if (Object.prototype.hasOwnProperty.call(raw, k)) raw[k] = str_(r[1]);
    });
  }
  return raw;
}

// Typed settings. A value typed into the sheet by hand that is not valid falls back to the default.
function readSettings_() {
  const raw = readRawSettings_();
  const value = function (key) {
    return validateSetting_(key, raw[key]) === null ? raw[key] : SETTING_DEFS.filter(function (d) { return d.key === key; })[0].value;
  };
  return {
    raw: raw,
    brand: value('brand_name'),
    owners: parseOwners_(value('owners')),
    booksStart: value('books_start'),
    openingBalance: parseCents_(value('opening_balance')),
    cardFees: value('card_fees'),
    cardPercent: parseFloat(value('card_fee_percent')),
    cardFixed: parseCents_(value('card_fee_fixed')),
    vatRegistered: value('vat_registered') === 'yes'
  };
}

function parseOwners_(text) {
  return str_(text).split(',').map(function (n) { return clean_(n, 30); }).filter(Boolean);
}

// null when the value is fine, otherwise the message to show.
function validateSetting_(key, value) {
  const v = str_(value);
  switch (key) {
    case 'brand_name':
      return v && v.length <= 60 ? null : 'Enter the business name.';
    case 'owners': {
      const names = parseOwners_(v);
      if (names.length < 1 || names.length > 6) return 'Enter 1 to 6 owner names, separated by commas.';
      const seen = {};
      for (let i = 0; i < names.length; i++) {
        const n = names[i].toLowerCase();
        if (n === BUSINESS.toLowerCase()) return '"Business" cannot be an owner name.';
        if (seen[n]) return names[i] + ' is there twice.';
        seen[n] = true;
      }
      return null;
    }
    case 'books_start':
      return isDay_(v) && v >= FIRST_DATE ? null : 'Enter the start day as YYYY-MM-DD.';
    case 'opening_balance': {
      const c = parseCents_(v);
      return c !== null && Math.abs(c) <= MAX_AMOUNT_CENTS ? null : 'Enter the opening balance in rand, for example 0 or 1500.';
    }
    case 'card_fees':
      return v === 'estimate' || v === 'recorded' ? null : 'Choose estimate or recorded.';
    case 'card_fee_percent':
      return /^\d{1,2}(\.\d{1,2})?$/.test(v) && parseFloat(v) <= 10 ? null : 'Enter the card fee percent, from 0 to 10.';
    case 'card_fee_fixed': {
      const c = parseCents_(v);
      return c !== null && c >= 0 && c <= 1000 ? null : 'Enter the fixed card fee in rand, from 0 to 10.';
    }
    case 'vat_registered':
      return v === 'yes' || v === 'no' ? null : 'Choose yes or no.';
    default:
      return 'Unknown setting.';
  }
}

function saveSettings_(body) {
  const values = body.values && typeof body.values === 'object' ? body.values : null;
  if (!values) throw fail_('bad_request', 'Nothing to save.');
  const keys = Object.keys(values);
  keys.forEach(function (k) {
    const problem = validateSetting_(k, values[k]);
    if (problem) throw fail_('invalid', problem, { field: k });
  });
  // Removing an owner who has entries is fine: the entries keep their name, and the report
  // keeps showing them as a former owner.
  const sheet = settingsSheet_();
  const last = sheet.getLastRow();
  const rows = last >= 2 ? sheet.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return str_(r[0]); }) : [];
  keys.forEach(function (k) {
    const v = k === 'owners' ? parseOwners_(values[k]).join(', ') : str_(values[k]);
    const i = rows.indexOf(k);
    if (i >= 0) sheet.getRange(i + 2, 2).setValue(v);
  });
  return { ok: true, settings: readRawSettings_(), owners: readSettings_().owners, vatRegistered: readSettings_().vatRegistered };
}

// ---------------------------------------------------------------------------
// Admin key
// ---------------------------------------------------------------------------

function requireAdmin_(key) {
  const expected = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  const given = typeof key === 'string' ? key : '';
  if (!expected || !sameText_(given, expected)) {
    Utilities.sleep(400); // slows down guessing
    throw fail_('unauthorized', 'That key is not right.');
  }
}

// Compares in a time that does not depend on where the first difference is.
function sameText_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function newKey_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function str_(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

// Plain text: no line breaks or control characters, limited length.
function clean_(v, max) {
  let s = v === null || v === undefined ? '' : String(v);
  s = s.replace(/\s*[\r\n]+\s*/g, ', ');
  s = s.replace(/[\u0000-\u001F\u007F\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.slice(0, max);
}

// Text that starts with = + - or @ could be read as a formula. A leading space prevents that.
function safe_(s) {
  return /^[=+\-@]/.test(s) ? ' ' + s : s;
}

function pad_(n, width) {
  let s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

function money_(n) {
  return 'R' + n.toFixed(2);
}

function nowString_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
}

function today_() {
  return nowString_().slice(0, 10);
}

// ---------------------------------------------------------------------------
// One-off functions, run from the Apps Script editor
// ---------------------------------------------------------------------------

/** Run once. Creates the tabs and the admin key. Safe to run again: nothing is overwritten. */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Open this script from a Google Sheet (Extensions > Apps Script), then run setup again.');

  Object.keys(TABLES).forEach(function (kind) {
    const t = TABLES[kind];
    const sheet = ss.getSheetByName(t.tab) || ss.insertSheet(t.tab);
    sheet.getRange(1, 1, 1, t.headers.length).setValues([t.headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    if (sheet.getMaxRows() < 2) sheet.insertRowsAfter(1, 998);
    t.formats.forEach(function (format, i) {
      sheet.getRange(2, i + 1, sheet.getMaxRows() - 1, 1).setNumberFormat(format);
    });
    t.widths.forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  });

  // Settings tab. Existing values are never overwritten.
  const settings = ss.getSheetByName(SETTINGS_TAB) || ss.insertSheet(SETTINGS_TAB);
  settings.getRange(1, 1, 1, 3).setValues([['Key', 'Value', 'Note']]).setFontWeight('bold');
  settings.setFrozenRows(1);
  const have = {};
  const last = settings.getLastRow();
  if (last >= 2) {
    settings.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) { have[str_(r[0])] = true; });
  }
  let next = Math.max(last, 1) + 1;
  SETTING_DEFS.forEach(function (d) {
    if (!have[d.key]) {
      settings.getRange(next, 1, 1, 3).setNumberFormat('@').setValues([[d.key, d.value, d.note]]);
      next++;
    }
  });
  settings.getRange(1, 2, settings.getMaxRows(), 1).setNumberFormat('@');
  settings.setColumnWidth(1, 150);
  settings.setColumnWidth(2, 220);
  settings.setColumnWidth(3, 480);

  // Remove the empty default tab.
  const spare = ss.getSheetByName('Sheet1');
  if (spare && spare.getLastRow() === 0 && spare.getLastColumn() === 0 && ss.getSheets().length > 1) ss.deleteSheet(spare);

  const props = PropertiesService.getScriptProperties();
  let created = false;
  if (!props.getProperty('ADMIN_KEY')) {
    props.setProperty('ADMIN_KEY', newKey_());
    created = true;
  }
  Logger.log(created ? 'Setup done. Admin key created.' : 'Setup done. Admin key already existed.');
  Logger.log('Admin key: ' + props.getProperty('ADMIN_KEY'));
  Logger.log(orderSheetId_() ? 'Website sales: connected to the order Sheet.' : 'Website sales: add ORDER_SHEET_ID in Script properties (see SETUP-GUIDE.md).');
}

/** Logs the admin key again. */
function showAdminKey() {
  const key = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  Logger.log(key ? 'Admin key: ' + key : 'No admin key yet. Run setup first.');
}

/** Replaces the admin key. The old key and any saved links stop working. */
function rotateAdminKey() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('ADMIN_KEY', newKey_());
  Logger.log('New admin key: ' + props.getProperty('ADMIN_KEY'));
}

/** Checks that the order Sheet can be read, and logs what it found. */
function checkSales() {
  const web = websiteSales_();
  Logger.log(web.connected ? 'Connected. ' + web.orders.length + ' paid or delivered orders found.' : web.message);
}
