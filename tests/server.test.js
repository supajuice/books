'use strict';
// Runs the real Code.gs against the in-memory Apps Script stand-in.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./gas-mock');

// A set-up books with the default settings. Today is Tue 3 Nov 2026.
function books(opts) {
  opts = opts || {};
  const gas = createGas();
  gas.run('setup()');
  if (opts.sales !== false) gas.connectOrders();
  const key = gas.key();
  const call = (action, body) => gas.call(Object.assign({ action, key }, body || {}));
  const ok = (action, body) => {
    const r = call(action, body);
    assert.equal(r.ok, true, action + ' failed: ' + JSON.stringify(r));
    return r;
  };
  const expense = (over) => ok('add', { kind: 'expense', entry: Object.assign({ date: '2026-10-05', amount: '100', category: 'Ingredients', what: 'Maltodextrin 5 kg', paidBy: 'Business' }, over) }).entry;
  const money = (over) => ok('add', { kind: 'money', entry: Object.assign({ date: '2026-10-01', amount: '1000', kind: 'Loan', who: 'Greg' }, over) }).entry;
  const batch = (over) => ok('add', { kind: 'batch', entry: Object.assign({ date: '2026-10-02', flavour: 'Orange', sachets: '100', cost: '1500' }, over) }).entry;
  const report = (from, to) => ok('report', { from, to }).report;
  return { gas, key, call, ok, expense, money, batch, report };
}

test('setup makes the tabs, the settings and a key, and is safe to run again', () => {
  const { gas } = books();
  ['Expenses', 'Money in', 'Batches', 'Settings'].forEach((t) => assert.ok(gas.sheet(t), t));
  assert.equal(gas.sheet('Sheet1'), null);
  assert.equal(gas.rows('Settings').find((r) => r.Key === 'owners').Value, 'Greg');
  const key = gas.key();
  gas.run('setup()');
  assert.equal(gas.key(), key);
  assert.equal(gas.rows('Settings').length, 8);
});

test('every action needs the key', () => {
  const { gas } = books();
  assert.equal(gas.call({ action: 'list' }).error, 'unauthorized');
  assert.equal(gas.call({ action: 'list', key: 'nope' }).error, 'unauthorized');
  assert.equal(gas.raw('not json').error, 'bad_request');
});

test('an expense is saved with an ID, in rand, and listed', () => {
  const t = books();
  const e = t.expense({ amount: 'R 1 234,50', supplier: 'Dischem', notes: 'For the first batch' });
  assert.equal(e.id, 'E-0001');
  assert.equal(e.amount, 1234.5);
  const row = t.gas.rows('Expenses')[0];
  assert.equal(row.Amount, 1234.5);
  assert.equal(row['Added on'], '2026-11-03 10:00');
  assert.equal(t.expense().id, 'E-0002');
  const list = t.ok('list');
  assert.equal(list.entries.expense.length, 2);
  assert.deepEqual(list.owners, ['Greg']);
  assert.equal(list.today, '2026-11-03');
  assert.equal(list.salesConnected, true);
});

test('entries are checked', () => {
  const t = books();
  const bad = (kind, entry) => {
    const r = t.call('add', { kind, entry });
    assert.equal(r.error, 'invalid', JSON.stringify(entry));
    return r.field;
  };
  const base = { date: '2026-10-05', amount: '100', category: 'Ingredients', what: 'Gel', paidBy: 'Business' };
  assert.equal(bad('expense', Object.assign({}, base, { date: '2026-11-04' })), 'date', 'not in the future');
  assert.equal(bad('expense', Object.assign({}, base, { date: '2026-02-30' })), 'date');
  assert.equal(bad('expense', Object.assign({}, base, { amount: '-5' })), 'amount');
  assert.equal(bad('expense', Object.assign({}, base, { amount: '0' })), 'amount');
  assert.equal(bad('expense', Object.assign({}, base, { amount: '12.345' })), 'amount');
  assert.equal(bad('expense', Object.assign({}, base, { category: 'Fun' })), 'category');
  assert.equal(bad('expense', Object.assign({}, base, { what: '  ' })), 'what');
  assert.equal(bad('expense', Object.assign({}, base, { paidBy: 'Someone' })), 'paidBy');
  assert.equal(bad('expense', Object.assign({}, base, { receipt: 'javascript:alert(1)' })), 'receipt');
  assert.equal(bad('money', { date: '2026-10-05', amount: '100', kind: 'Gift', who: 'Greg' }), 'kind');
  assert.equal(bad('money', { date: '2026-10-05', amount: '100', kind: 'Loan', who: '' }), 'who');
  assert.equal(bad('batch', { date: '2026-10-05', flavour: 'Orange', sachets: '0', cost: '10' }), 'sachets');
  assert.equal(bad('batch', { date: '2026-10-05', flavour: '', sachets: '10', cost: '10' }), 'flavour');
  assert.equal(t.call('add', { kind: 'pizza', entry: {} }).error, 'bad_request');
  assert.equal(t.gas.rows('Expenses').length, 0);
});

test('text that looks like a formula is stored as plain text', () => {
  const t = books();
  t.expense({ what: '=HYPERLINK("x")', supplier: '+27 shop' });
  const row = t.gas.rows('Expenses')[0];
  assert.equal(row.What, ' =HYPERLINK("x")');
  assert.equal(row.Supplier, ' +27 shop');
});

test('VAT is only kept once the business is VAT registered', () => {
  const t = books();
  assert.equal(t.expense({ amount: '115', vat: '15' }).vat, 0);
  t.ok('saveSettings', { values: { vat_registered: 'yes' } });
  assert.equal(t.expense({ amount: '115', vat: '15' }).vat, 15);
  assert.equal(t.call('add', { kind: 'expense', entry: { date: '2026-10-05', amount: '10', vat: '11', category: 'Other', what: 'x', paidBy: 'Business' } }).field, 'vat');
});

test('edit changes an entry and remove hides it, but both leave a trail', () => {
  const t = books();
  const e = t.expense();
  const edited = t.ok('edit', { kind: 'expense', id: e.id, entry: { date: '2026-10-06', amount: '120', category: 'Packaging', what: 'Sachets', paidBy: 'Greg' } }).entry;
  assert.equal(edited.id, 'E-0001');
  assert.equal(edited.amount, 120);
  assert.equal(t.gas.rows('Expenses')[0]['Edited on'], '2026-11-03 10:00');
  t.ok('remove', { kind: 'expense', id: e.id });
  assert.equal(t.ok('list').entries.expense.length, 0);
  assert.equal(t.gas.rows('Expenses').length, 1, 'the row stays in the sheet');
  assert.equal(t.gas.rows('Expenses')[0]['Removed on'], '2026-11-03 10:00');
  assert.equal(t.call('edit', { kind: 'expense', id: e.id, entry: {} }).error, 'not_found');
  assert.equal(t.call('remove', { kind: 'expense', id: e.id }).error, 'not_found');
  // A removed entry's number is not given out again.
  assert.equal(t.expense().id, 'E-0002');
});

test('money in: owners need a name, other sales do not', () => {
  const t = books();
  assert.equal(t.money({ kind: 'Capital', who: 'Greg' }).who, 'Greg');
  const sale = t.money({ kind: 'Other sale', who: 'Greg', sachets: '12', amount: '480' });
  assert.equal(sale.who, '', 'a sale is not an owner\'s');
  assert.equal(sale.sachets, 12);
  assert.equal(t.money({ kind: 'Loan', sachets: '5' }).sachets, 0);
});

test('the report: profit and loss on a cash basis', () => {
  const t = books();
  t.gas.addOrders([
    { invoice: 'SJ-0001', qty: 3, price: 40, fee: 30, paidOn: '2026-10-10 12:00' }, // R150
    { invoice: 'SJ-0002', qty: 10, price: 40, discount: 10, paidOn: '2026-10-20 08:00', notes: 'Paid by card (Paystack SJ-0002-ab12)' }, // R360, card
    { invoice: 'SJ-0003', qty: 2, price: 40, status: 'Delivered', paidOn: '2026-10-31 18:00' }, // R80
    { invoice: 'SJ-0004', qty: 5, price: 40, status: 'Awaiting payment' }, // not paid: not a sale
    { invoice: 'SJ-0005', qty: 4, price: 40, status: 'Cancelled', paidOn: '2026-10-12 10:00' },
    { invoice: 'SJ-0006', qty: 1, price: 40, paidOn: '2026-11-01 09:00' } // next month
  ]);
  t.money({ kind: 'Other sale', amount: '200', sachets: '5', date: '2026-10-15' });
  t.expense({ amount: '500', category: 'Ingredients' });
  t.expense({ amount: '99.99', category: 'Tech & software', what: 'Claude Code', paidBy: 'Greg', receipt: 'https://drive.google.com/file/d/x/view' });
  t.expense({ amount: '60', category: 'Shipping & boxes', date: '2026-11-02' }); // next month
  const r = t.report('2026-10-01', '2026-10-31');
  assert.equal(r.salesConnected, true);
  assert.deepEqual(r.sales, { orders: 3, sachets: 15, sachetIncome: 560, discounts: 40, deliveryFees: 30, total: 590, cardOrders: 1 });
  assert.deepEqual(r.otherSales, { count: 1, sachets: 5, total: 200 });
  assert.equal(r.income, 790);
  assert.deepEqual(r.expenses.map((c) => [c.category, c.total]), [['Ingredients', 500], ['Tech & software', 99.99]]);
  assert.equal(r.cardFees, 11.44, '2.9% of R360 + R1');
  assert.equal(r.costs, 611.43);
  assert.equal(r.profit, 178.57);
  assert.equal(r.missingReceipts, 1);
  assert.equal(r.vatPaid, null);
  assert.equal(t.gas.ordersWrites.length, 0, 'the order Sheet is never written to');
});

test('card fees can be left to the expenses instead of estimated', () => {
  const t = books();
  t.gas.addOrders([{ invoice: 'SJ-0001', qty: 10, price: 40, paidOn: '2026-10-20 08:00', notes: 'Paid by card (Paystack SJ-0001-x)' }]);
  t.ok('saveSettings', { values: { card_fees: 'recorded' } });
  const r = t.report('2026-10-01', '2026-10-31');
  assert.equal(r.cardFees, 0);
  assert.equal(r.profit, 400);
});

test('the report: cost per sachet, margin and stock', () => {
  const t = books();
  t.batch({ sachets: '100', cost: '1500', date: '2026-09-01' });
  t.batch({ sachets: '50', cost: '900', date: '2026-10-25' });
  t.batch({ sachets: '80', cost: '1000', date: '2026-11-02' }); // after the period: not counted
  t.gas.addOrders([{ invoice: 'SJ-0001', qty: 20, price: 40, paidOn: '2026-10-10 12:00' }]);
  t.money({ kind: 'Other sale', amount: '350', sachets: '10', date: '2026-10-15' });
  const r = t.report('2026-10-01', '2026-10-31');
  assert.deepEqual(r.perSachet, { sold: 30, avgPrice: 38.33, costToMake: 16, margin: 22.33 });
  assert.deepEqual(r.stock, { made: 150, sold: 30, left: 120 });
});

test('the report: cash on hand counts from the start day', () => {
  const t = books();
  t.ok('saveSettings', { values: { books_start: '2026-10-01', opening_balance: '250' } });
  t.money({ kind: 'Loan', who: 'Greg', amount: '2000', date: '2026-10-01' });
  t.money({ kind: 'Capital', who: 'Greg', amount: '500', date: '2026-09-15' }); // before the start: not cash
  t.money({ kind: 'Paid back', who: 'Greg', amount: '300', date: '2026-10-30' });
  t.expense({ amount: '700', paidBy: 'Business' });
  t.expense({ amount: '120', paidBy: 'Greg' }); // from Greg's pocket: not the business's cash
  t.gas.addOrders([{ invoice: 'SJ-0001', qty: 5, price: 40, paidOn: '2026-10-10 12:00' }]);
  const r = t.report('2026-10-01', '2026-10-31');
  assert.deepEqual(r.cash, { since: '2026-10-01', opening: 250, ownersIn: 2000, sales: 200, spent: 700, paidBack: 300, onHand: 1450 });
});

test('the report: what each owner put in and is owed', () => {
  const t = books();
  t.ok('saveSettings', { values: { owners: 'Greg, Sam' } });
  t.money({ kind: 'Loan', who: 'Greg', amount: '3000' });
  t.money({ kind: 'Capital', who: 'Greg', amount: '1000' });
  t.expense({ amount: '450', paidBy: 'Greg' });
  t.money({ kind: 'Paid back', who: 'Greg', amount: '500', date: '2026-10-20' });
  t.expense({ amount: '99', paidBy: 'Sam', category: 'Tech & software', what: 'Claude Code' });
  const r = t.report('2026-10-01', '2026-10-31');
  assert.deepEqual(r.owners, [
    { name: 'Greg', former: false, loan: 3000, capital: 1000, expenses: 450, paidBack: 500, owed: 2950 },
    { name: 'Sam', former: false, loan: 0, capital: 0, expenses: 99, paidBack: 0, owed: 99 }
  ]);
  // As of an earlier day, later entries do not count yet.
  assert.equal(t.report('2026-09-01', '2026-09-30').owners[0].loan, 0);
});

test('the SARS tax year runs 1 March to the end of February', () => {
  const t = books();
  const ty = (d) => t.gas.run('taxYear_("' + d + '")');
  assert.deepEqual(JSON.parse(JSON.stringify(ty('2026-11-03'))), { start: '2026-03-01', end: '2027-02-28', label: '2026/27' });
  assert.equal(ty('2027-02-28').label, '2026/27');
  assert.equal(ty('2027-03-01').label, '2027/28');
  assert.equal(ty('2028-01-10').end, '2028-02-29', 'leap year');
  t.gas.addOrders([
    { invoice: 'SJ-0001', qty: 10, price: 40, paidOn: '2026-02-27 12:00' }, // last tax year
    { invoice: 'SJ-0002', qty: 25, price: 40, paidOn: '2026-03-01 08:00' },
    { invoice: 'SJ-0003', qty: 25, price: 40, paidOn: '2026-10-01 08:00' }
  ]);
  const r = t.report('2026-10-01', '2026-10-31');
  assert.equal(r.taxYear.label, '2026/27');
  assert.equal(r.taxYear.turnover, 2000);
  assert.equal(r.taxYear.limit, 1000000);
  assert.equal(r.taxYear.percent, 0.2);
});

test('the report works, and says so, when website sales are not connected', () => {
  const t = books({ sales: false });
  t.expense();
  const r = t.report('2026-10-01', '2026-10-31');
  assert.equal(r.salesConnected, false);
  assert.match(r.salesMessage, /not connected/);
  assert.equal(r.profit, -100);
  t.gas.store.set('ORDER_SHEET_ID', 'wrong-id');
  assert.match(t.report('2026-10-01', '2026-10-31').salesMessage, /Could not open/);
  const listed = t.ok('list');
  assert.equal(listed.salesConnected, false, 'a wrong ID cannot be read');
  assert.match(listed.salesMessage, /Could not open/);
});

test('ORDER_SHEET_ID can be the whole address of the order Sheet', () => {
  const t = books({ sales: false });
  t.gas.addOrders([{ invoice: 'SJ-0001', qty: 2, price: 40, paidOn: '2026-10-10 12:00' }]);
  ['https://docs.google.com/spreadsheets/d/order-sheet-id/edit#gid=0',
    '  https://docs.google.com/spreadsheets/d/order-sheet-id/edit?usp=sharing  ',
    'docs.google.com/spreadsheets/d/order-sheet-id',
    'order-sheet-id'].forEach((value) => {
    t.gas.store.set('ORDER_SHEET_ID', value);
    const r = t.report('2026-10-01', '2026-10-31');
    assert.equal(r.salesConnected, true, value);
    assert.equal(r.sales.total, 80, value);
  });
});

test('the report checks its dates', () => {
  const t = books();
  assert.equal(t.call('report', { from: '2026-10-31', to: '2026-10-01' }).error, 'invalid');
  assert.equal(t.call('report', { from: 'last month', to: '2026-10-01' }).error, 'invalid');
});

test('the download lists every entry and sale, then the summary', () => {
  const t = books();
  t.gas.addOrders([{ invoice: 'SJ-0001', qty: 3, price: 40, fee: 30, paidOn: '2026-10-10 12:00' }]);
  t.expense({ what: 'Sachets, "foil"', supplier: '=cmd', amount: '50' });
  t.money({ kind: 'Loan', who: 'Greg', amount: '1000' });
  t.money({ kind: 'Paid back', who: 'Greg', amount: '100', date: '2026-10-30' });
  t.batch();
  const out = t.ok('export', { from: '2026-10-01', to: '2026-10-31' });
  assert.equal(out.filename, 'supa-juice-books-2026-10-01-to-2026-10-31.csv');
  const lines = out.csv.split('\r\n');
  assert.equal(lines[0], 'Date,Type,Reference,Category,Who / supplier,Description,Money in,Money out,VAT,Paid by,Receipt,Notes');
  assert.equal(lines[1], '2026-10-01,Owner loan,M-0001,Loan,Greg,Put in by Greg,1000.00,,,,,');
  assert.equal(lines[2], '2026-10-02,Batch made,B-0001,Orange,,"100 sachets, cost R1500.00",,,,,,');
  assert.equal(lines[3], '2026-10-05,Expense,E-0001,Ingredients,\'=cmd,"Sachets, ""foil""",,50.00,,Business,,');
  assert.equal(lines[4], '2026-10-10,Website sale,SJ-0001,Sales,,"3 sachets, delivery R30.00",150.00,,,,,');
  assert.equal(lines[5], '2026-10-30,Owner paid back,M-0002,Paid back,Greg,Paid back to Greg,,100.00,,,,');
  assert.ok(lines.includes('Profit,100.00'));
  assert.ok(lines.includes('Owed to Greg,900.00'));
});

test('a receipt is saved in one Drive folder and its link returned', () => {
  const t = books();
  const data = Buffer.from('%PDF-1.4 receipt').toString('base64');
  const a = t.ok('uploadReceipt', { type: 'application/pdf', data, date: '2026-10-05', label: 'Dischem/maltodextrin' });
  assert.equal(a.url, 'https://drive.google.com/file/d/file-1/view');
  assert.equal(a.name, '2026-10-05 Dischem maltodextrin.pdf');
  t.ok('uploadReceipt', { type: 'image/jpeg', data });
  assert.equal(t.gas.drive.folders.size, 1, 'the same folder is used again');
  assert.equal(t.gas.drive.files[1].folder, t.gas.drive.files[0].folder);
  assert.equal(t.call('uploadReceipt', { type: 'text/html', data }).error, 'invalid');
  assert.equal(t.call('uploadReceipt', { type: 'image/png', data: 'not base64!' }).error, 'invalid');
  assert.equal(t.call('uploadReceipt', { type: 'image/png', data: 'A'.repeat(12 * 1024 * 1024) }).error, 'invalid');
});

test('settings are checked', () => {
  const t = books();
  const bad = (values) => t.call('saveSettings', { values });
  assert.equal(bad({ owners: '' }).error, 'invalid');
  assert.equal(bad({ owners: 'Greg, greg' }).error, 'invalid');
  assert.equal(bad({ owners: 'Greg, Business' }).error, 'invalid');
  assert.equal(bad({ books_start: '2026-13-01' }).error, 'invalid');
  assert.equal(bad({ card_fees: 'maybe' }).error, 'invalid');
  assert.equal(bad({ card_fee_percent: '50' }).error, 'invalid');
  assert.equal(bad({ vat_registered: '' }).error, 'invalid');
  assert.equal(bad({ nonsense: '1' }).error, 'invalid');
  const saved = t.ok('saveSettings', { values: { owners: ' Greg ,Lee,  Sam ', opening_balance: 'R 1 500' } });
  assert.deepEqual(saved.owners, ['Greg', 'Lee', 'Sam']);
  assert.equal(saved.settings.owners, 'Greg, Lee, Sam');
});

test('a removed owner keeps their entries and still shows in the report', () => {
  const t = books();
  t.ok('saveSettings', { values: { owners: 'Greg, Sam' } });
  const lent = t.money({ kind: 'Loan', who: 'Sam', amount: '800' });
  const paid = t.expense({ paidBy: 'Sam', amount: '50' });
  assert.deepEqual(t.ok('saveSettings', { values: { owners: 'Greg' } }).owners, ['Greg']);

  // The report still shows what is owed to Sam.
  const r = t.report('2026-10-01', '2026-10-31');
  assert.deepEqual(r.owners.map((o) => [o.name, o.former, o.owed]), [['Greg', false, 0], ['Sam', true, 850]]);
  assert.equal(t.ok('list').entries.money[0].who, 'Sam');

  // An old entry can still be edited and keep Sam. A new one cannot name Sam.
  t.ok('edit', { kind: 'money', id: lent.id, entry: { date: '2026-10-01', amount: '900', kind: 'Loan', who: 'Sam' } });
  t.ok('edit', { kind: 'expense', id: paid.id, entry: { date: '2026-10-05', amount: '60', category: 'Other', what: 'x', paidBy: 'Sam' } });
  assert.equal(t.call('add', { kind: 'money', entry: { date: '2026-10-02', amount: '10', kind: 'Loan', who: 'Sam' } }).field, 'who');
  assert.equal(t.call('add', { kind: 'expense', entry: { date: '2026-10-02', amount: '10', category: 'Other', what: 'x', paidBy: 'Sam' } }).field, 'paidBy');
  // Nor can an edit move an entry to someone else who is not an owner.
  assert.equal(t.call('edit', { kind: 'money', id: lent.id, entry: { date: '2026-10-01', amount: '900', kind: 'Loan', who: 'Lee' } }).field, 'who');
  assert.equal(t.report('2026-10-01', '2026-10-31').owners[1].owed, 960);
});

test('a bad value typed into the Settings sheet falls back to the default', () => {
  const t = books();
  const sheet = t.gas.sheet('Settings');
  const row = t.gas.rows('Settings').findIndex((r) => r.Key === 'card_fee_percent') + 2;
  sheet.getRange(row, 2).setValue('lots');
  t.gas.addOrders([{ invoice: 'SJ-0001', qty: 10, price: 40, paidOn: '2026-10-20 08:00', notes: 'Paid by card (Paystack SJ-0001-x)' }]);
  assert.equal(t.report('2026-10-01', '2026-10-31').cardFees, 12.6, 'the default 2.9% + R1');
});

test('a busy lock gives a clear message and saves nothing', () => {
  const t = books();
  t.gas.lock.failNext = true;
  const r = t.call('add', { kind: 'expense', entry: { date: '2026-10-05', amount: '1', category: 'Other', what: 'x', paidBy: 'Business' } });
  assert.equal(r.error, 'busy');
  assert.equal(t.gas.rows('Expenses').length, 0);
});
