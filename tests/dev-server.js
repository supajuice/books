'use strict';
/*
  A local stand-in for the real setup, for trying the books page in a browser.

    node tests/dev-server.js [--mode=seeded|ready|unconnected] [--latency=300] [--site-port=5183] [--api-port=5184]

  docs/ is served on one port, with config.js pointing at a fake books service on another
  port. The fake service runs the real Code.gs against in-memory copies of Google's services
  (including a pretend order Sheet with some paid orders), and answers the way Apps Script does:
    - a POST to /exec is answered with a 302 to an "echo" address that returns the JSON,
    - a preflight (OPTIONS) request is refused, because Apps Script cannot answer one.
  Nothing is saved: stop the server and the data is gone.
*/
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createGas } = require('./gas-mock');

const DOCS = path.join(__dirname, '..', 'docs');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

function expectOk(res) {
  if (!res || res.ok !== true) throw new Error('Setup step failed: ' + JSON.stringify(res));
  return res;
}

// A few weeks of a small gel business, with a made-up second owner Sam: Greg's start-up money, receipts, batches and website sales.
function seed(gas, key) {
  const add = (kind, entry) => expectOk(gas.call({ action: 'add', key, kind, entry }));
  expectOk(gas.call({ action: 'saveSettings', key, values: { books_start: '2026-09-01', opening_balance: '0', owners: 'Greg, Sam' } }));
  add('money', { date: '2026-09-01', amount: '5000', kind: 'Loan', who: 'Greg', notes: 'Start-up money' });
  add('expense', { date: '2026-09-03', amount: '1450', category: 'Ingredients', what: 'Maltodextrin and fructose', supplier: 'Bulk Nutrients', paidBy: 'Business', receipt: 'https://drive.google.com/file/d/sample-1/view' });
  add('expense', { date: '2026-09-04', amount: '620', category: 'Packaging', what: 'Sachets x 500', supplier: 'PackRite', paidBy: 'Business' });
  add('batch', { date: '2026-09-06', flavour: 'Orange', sachets: '120', cost: '1240', notes: 'First batch' });
  add('expense', { date: '2026-09-20', amount: '189', category: 'Tech & software', what: 'Domain for a year', paidBy: 'Greg' });
  add('expense', { date: '2026-10-02', amount: '850', category: 'Marketing', what: 'Race stall at the Sea Point 10K', paidBy: 'Business', receipt: 'https://drive.google.com/file/d/sample-2/view' });
  add('money', { date: '2026-10-04', amount: '600', kind: 'Other sale', sachets: '15', notes: 'Cash at the race stall' });
  add('batch', { date: '2026-10-12', flavour: 'Cranberry', sachets: '100', cost: '1100' });
  add('expense', { date: '2026-10-15', amount: '360', category: 'Tech & software', what: 'Claude Code, October', paidBy: 'Sam' });
  add('expense', { date: '2026-10-28', amount: '238', category: 'Shipping & boxes', what: 'Pudo lockers x 4', supplier: 'Pudo', paidBy: 'Business' });
  add('money', { date: '2026-10-30', amount: '500', kind: 'Paid back', who: 'Greg' });
  add('expense', { date: '2026-11-02', amount: '310', category: 'Ingredients', what: 'Orange flavouring', paidBy: 'Business' });
  gas.addOrders([
    { invoice: 'SJ-0001', qty: 6, price: 40, fee: 69, paidOn: '2026-09-12 10:00' },
    { invoice: 'SJ-0002', qty: 12, price: 40, paidOn: '2026-09-18 16:20', notes: 'Paid by card (Paystack SJ-0002-a1b2)' },
    { invoice: 'SJ-0003', qty: 4, price: 40, fee: 99, paidOn: '2026-10-03 09:15', status: 'Delivered' },
    { invoice: 'SJ-0004', qty: 10, price: 40, discount: 10, paidOn: '2026-10-11 12:00' },
    { invoice: 'SJ-0005', qty: 3, price: 40, status: 'Awaiting payment' },
    { invoice: 'SJ-0006', qty: 8, price: 40, paidOn: '2026-10-21 18:30', notes: 'Paid by card (Paystack SJ-0006-c3d4)' },
    { invoice: 'SJ-0007', qty: 5, price: 40, fee: 69, paidOn: '2026-11-01 08:40' }
  ]);
}

function build(mode) {
  const gas = createGas();
  gas.run('setup()');
  const key = gas.key();
  if (mode !== 'unconnected') gas.connectOrders();
  if (mode === 'seeded') seed(gas, key);
  return { gas, key };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function startDevServer(opts) {
  opts = opts || {};
  let current = build(opts.mode || 'seeded');
  const settings = { latency: opts.latency || 0, endpoint: null };
  const calls = []; // what the page sent: { method, action, contentType }
  const echo = new Map();
  let apiPort = 0;

  const api = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const cors = { 'Access-Control-Allow-Origin': '*' };

    // Apps Script cannot answer a preflight. A page that triggers one would fail for real.
    if (req.method === 'OPTIONS') {
      res.writeHead(405);
      res.end();
      return;
    }

    if (url.pathname === '/exec') {
      const body = req.method === 'POST' ? await readBody(req) : '';
      await new Promise((r) => setTimeout(r, settings.latency));
      let content;
      if (req.method === 'POST') {
        let action = null;
        try { action = JSON.parse(body).action; } catch (err) { /* not JSON */ }
        calls.push({ method: 'POST', action, contentType: String(req.headers['content-type'] || '') });
        content = current.gas.ctx.doPost({ postData: { contents: body, type: req.headers['content-type'] || '' } }).getContent();
      } else {
        calls.push({ method: 'GET', action: null, contentType: '' });
        content = current.gas.ctx.doGet({ parameter: Object.fromEntries(url.searchParams) }).getContent();
      }
      const id = crypto.randomUUID();
      echo.set(id, content);
      res.writeHead(302, Object.assign({ Location: 'http://127.0.0.1:' + apiPort + '/echo/' + id }, cors));
      res.end();
      return;
    }

    if (url.pathname.indexOf('/echo/') === 0) {
      const id = url.pathname.slice('/echo/'.length);
      const content = echo.get(id);
      echo.delete(id);
      if (content === undefined) {
        res.writeHead(404, cors);
        res.end();
        return;
      }
      res.writeHead(200, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors));
      res.end(content);
      return;
    }

    res.writeHead(404, cors);
    res.end();
  });
  apiPort = await listen(api, opts.apiPort || 0);

  const site = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let p;
    try { p = decodeURIComponent(url.pathname); } catch (err) { p = '/'; }
    const headers = { 'Cache-Control': 'no-store' };

    if (p === '/config.js') {
      const endpoint = settings.endpoint === null ? 'http://127.0.0.1:' + apiPort + '/exec' : settings.endpoint;
      res.writeHead(200, Object.assign({ 'Content-Type': TYPES['.js'] }, headers));
      res.end('window.SJ_CONFIG = ' + JSON.stringify({ endpoint: endpoint }) + ';\n');
      return;
    }

    if (p.slice(-1) === '/') p += 'index.html';
    const file = path.normalize(path.join(DOCS, p));
    if (file.indexOf(DOCS + path.sep) !== 0) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, Object.assign({ 'Content-Type': 'text/plain' }, headers));
        res.end('Not found');
        return;
      }
      res.writeHead(200, Object.assign({ 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }, headers));
      res.end(data);
    });
  });
  const sitePort = await listen(site, opts.sitePort || 0);

  const siteUrl = 'http://127.0.0.1:' + sitePort;
  return {
    siteUrl: siteUrl,
    apiUrl: 'http://127.0.0.1:' + apiPort + '/exec',
    calls: calls,
    get gas() { return current.gas; },
    get key() { return current.key; },
    booksUrl: function (key) { return siteUrl + '/#' + (key === undefined ? current.key : key); },
    // Start again: 'seeded' (sample books), 'ready' (empty books, sales connected) or 'unconnected'.
    reset: function (mode) {
      current = build(mode || 'seeded');
      calls.length = 0;
    },
    setLatency: function (ms) { settings.latency = ms; },
    setEndpoint: function (url) { settings.endpoint = url; }, // null puts the fake service back
    close: function () {
      return Promise.all([
        new Promise((r) => { api.close(r); api.closeAllConnections && api.closeAllConnections(); }),
        new Promise((r) => { site.close(r); site.closeAllConnections && site.closeAllConnections(); })
      ]);
    }
  };
}

module.exports = { startDevServer };

if (require.main === module) {
  const args = {};
  process.argv.slice(2).forEach((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) args[m[1]] = m[2] === undefined ? true : m[2];
  });
  startDevServer({
    mode: args.mode || 'seeded',
    latency: Number(args.latency || 0),
    sitePort: Number(args['site-port'] || 5183),
    apiPort: Number(args['api-port'] || 5184)
  }).then((dev) => {
    console.log('Books  ' + dev.booksUrl());
    console.log('Fake books service on ' + dev.apiUrl + ' (data lives in memory and is gone when this stops)');
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
