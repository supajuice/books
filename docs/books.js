/* Supa Juice books: add expenses and money in, see the ledger and the report. */
(function () {
  'use strict';

  var cfg = window.SJ_CONFIG || {};
  var KEY_STORE = 'sjb_key';
  var MAX_PDF_BYTES = 8 * 1024 * 1024;
  var PHOTO_SIDE = 1600; // receipt photos are shrunk to this many pixels on the long side

  var KIND_NAMES = { expense: 'Expense', money: 'Money in', batch: 'Batch' };
  var MONEY_HELP = {
    'Loan': 'An owner puts money in, to be paid back later.',
    'Capital': 'An owner puts money in as their share of the business.',
    'Paid back': 'The business pays an owner back.',
    'Other sale': 'A sale that did not go through the website, such as cash at a race stall.'
  };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var state = {
    key: null,
    data: null, // the list reply: entries, settings, owners, categories, kinds, today
    tab: 'add',
    addKind: 'expense',
    editing: null, // 'expense:E-0001' while that ledger entry is open for editing
    filter: { type: 'all', month: 'all', q: '' },
    period: 'month',
    custom: { from: '', to: '' },
    report: null
  };

  function $(id) { return document.getElementById(id); }

  // ---------- Talking to the Apps Script web app ----------

  function ApiError(code, message, data) {
    this.name = 'ApiError';
    this.code = code;
    this.message = message || code;
    this.data = data || {};
  }
  ApiError.prototype = Object.create(Error.prototype);

  // POST with the JSON sent as text/plain. That is a "simple" request, so the browser
  // does not send a preflight, which Apps Script cannot answer.
  async function api(action, data) {
    var url = cfg.endpoint;
    if (!url || !/^https?:\/\//.test(url)) {
      throw new ApiError('not_configured', 'This page is not connected yet. Add the web app address to config.js.');
    }
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 60000);
    var json = null;
    try {
      var res;
      try {
        res = await fetch(url, {
          method: 'POST',
          body: JSON.stringify(Object.assign({ action: action, key: state.key }, data || {})),
          signal: controller.signal
        });
      } catch (err) {
        throw new ApiError('network', 'Could not reach the books. Check your connection and try again.');
      }
      try { json = await res.json(); } catch (err) { json = null; }
    } finally {
      clearTimeout(timer);
    }
    if (!json || typeof json !== 'object') throw new ApiError('bad_response', 'The books sent back something unexpected. Please try again.');
    if (json.ok !== true) {
      if (json.error === 'unauthorized') lock('That key is not right, or it was changed. Paste the new one.');
      throw new ApiError(json.error || 'server_error', json.message || 'Something went wrong. Please try again.', json);
    }
    return json;
  }

  // ---------- Small helpers ----------

  // el('div', {class: 'x', onclick: fn}, 'text', childNode, [more children])
  // Strings always become text nodes, so typed-in text can never inject markup.
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (v === true) node.setAttribute(k, '');
        else node.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
    return node;
  }

  function append(node, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) child.forEach(function (c) { append(node, c); });
    else if (child instanceof Node) node.appendChild(child);
    else node.appendChild(document.createTextNode(String(child)));
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  // R1,234.50 (or R40 for whole rand). Negative amounts get a minus sign in front.
  function money(n) {
    n = Number(n) || 0;
    var cents = Math.round(Math.abs(n) * 100);
    var whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    var part = cents % 100;
    return (n < 0 && cents ? '−' : '') + 'R' + whole + (part ? '.' + (part < 10 ? '0' : '') + part : '');
  }

  // Always two decimals, for totals that line up.
  function money2(n) {
    var text = money(n);
    return /\.\d\d$/.test(text) ? text : text + '.00';
  }

  // An amount taken off: "−R500.00", or "R0.00" when there is nothing.
  function less(n) {
    return (n ? '−' : '') + money2(n);
  }

  // "2026-10-05" -> "5 Oct 2026"
  function formatDay(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
    return m ? Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1] : String(d || '');
  }

  // "2026-10" -> "October 2026"
  function formatMonth(ym) {
    var names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return names[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4);
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function lastDayOf(y, m) { // m is 1 to 12
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }

  var toastTimer = null;
  function toast(message, kind) {
    var node = $('toast');
    if (!node) {
      node = el('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(node);
    }
    node.className = 'toast' + (kind === 'bad' ? ' toast--bad' : '');
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.hidden = true; }, kind === 'bad' ? 7000 : 4000);
  }

  // localStorage that never throws (some in-app browsers block it).
  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (err) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (err) { /* ignore */ } },
    remove: function (k) { try { window.localStorage.removeItem(k); } catch (err) { /* ignore */ } }
  };

  // ---------- Start, key and tabs ----------

  function keyFromLink() {
    var raw = String(window.location.hash || '').replace(/^#/, '');
    if (!raw) return null;
    try { window.history.replaceState(null, '', window.location.pathname + window.location.search); } catch (err) { /* ignore */ }
    var key = raw.replace(/^k=/, '');
    try { key = decodeURIComponent(key); } catch (err) { /* keep as is */ }
    return key.trim() || null;
  }

  function show(id, on) { $(id).hidden = !on; }

  function lock(message) {
    store.remove(KEY_STORE);
    state.key = null;
    state.data = null;
    show('topbar', false);
    ['loading', 'load-error', 'panel-add', 'panel-ledger', 'panel-report', 'panel-settings'].forEach(function (id) { show(id, false); });
    show('login', true);
    var box = $('login-error');
    box.textContent = message || '';
    box.hidden = !message;
  }

  async function load() {
    show('login', false);
    show('load-error', false);
    show('loading', true);
    try {
      var data = await api('list');
      state.data = data;
      store.set(KEY_STORE, state.key);
      show('loading', false);
      show('topbar', true);
      if (data.settings && data.settings.brand_name) $('brand').textContent = data.settings.brand_name + ' books';
      setTab(state.tab);
    } catch (err) {
      show('loading', false);
      if (err.code === 'unauthorized') return;
      $('load-error-text').textContent = err.message;
      show('load-error', true);
    }
  }

  function setTab(name) {
    state.tab = name;
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      if (b.getAttribute('data-tab') === name) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    ['add', 'ledger', 'report', 'settings'].forEach(function (t) { show('panel-' + t, t === name); });
    if (name === 'add') renderAdd();
    if (name === 'ledger') renderLedger();
    if (name === 'report') renderReport();
    if (name === 'settings') renderSettings();
  }

  // ---------- Entry forms (used to add, and to edit in the ledger) ----------

  var formCount = 0;

  // A field with a label, a hint and a place for its error message.
  function field(id, label, input, hint) {
    return el('div', { class: 'field', 'data-field': id },
      label ? el('label', { for: input.id }, label) : null,
      input,
      hint ? el('p', { class: 'hint' }, hint) : null,
      el('p', { class: 'hint hint-bad', 'data-error': id, hidden: true }));
  }

  // Buttons that work like radio buttons: one is pressed at a time.
  function choiceRow(name, options, value, onChange, kind) {
    var row = el('div', { class: kind === 'chips' ? 'chips' : 'seg', role: 'group', 'aria-label': name, 'data-choice': name });
    options.forEach(function (o) {
      var b = el('button', {
        type: 'button', class: kind === 'chips' ? 'chip' : 'seg-btn', 'aria-pressed': String(o === value), 'data-value': o
      }, o);
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(row.children, function (c) { c.setAttribute('aria-pressed', String(c === b)); });
        if (onChange) onChange(o);
      });
      row.appendChild(b);
    });
    return row;
  }

  // The owners to choose from. An old entry that names a former owner keeps them as a choice.
  function withPerson(owners, name) {
    return name && owners.indexOf(name) === -1 ? owners.concat(name) : owners;
  }

  function choiceValue(row) {
    var on = row.querySelector('[aria-pressed="true"]');
    return on ? on.getAttribute('data-value') : '';
  }

  // Builds the form for one kind of entry. values: an existing entry when editing.
  // Returns { node, read, showError, clearErrors, file }.
  function entryForm(kind, values) {
    var d = state.data;
    var v = values || {};
    var n = ++formCount;
    var id = function (name) { return 'f' + n + '-' + name; };
    var parts = {};
    var node = el('div', { class: 'stack' });

    var date = el('input', { id: id('date'), type: 'date', max: d.today, value: v.date || d.today, required: true });
    var amountInput = function (name, val) {
      return el('input', { id: id(name), type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00', value: val === undefined || val === null || val === '' ? '' : String(val) });
    };
    var notes = el('input', { id: id('notes'), type: 'text', maxlength: '300', autocomplete: 'off', value: v.notes || '' });

    // Cash on hand counts from "Books start on", so an earlier date gets a note saying so.
    // A batch moves no money, so it does not need one.
    var startNote = kind === 'batch' ? null : el('p', { class: 'hint start-note', 'data-role': 'before-start', role: 'status', hidden: true });
    function syncStart() {
      var start = d.settings.books_start;
      var before = !!(date.value && start && date.value < start);
      startNote.hidden = !before;
      startNote.textContent = before
        ? 'This is before the books start on ' + formatDay(start) + '. It counts towards profit and what owners are owed, but not cash on hand. To count it in cash too, move "Books start on" in Settings to this day or earlier.'
        : '';
    }
    if (startNote) {
      date.addEventListener('input', syncStart);
      date.addEventListener('change', syncStart);
    }

    if (kind === 'expense') {
      parts.amount = amountInput('amount', v.amount);
      parts.category = choiceRow('Category', d.categories, v.category || '', null, 'chips');
      parts.what = el('input', { id: id('what'), type: 'text', maxlength: '120', autocomplete: 'off', value: v.what || '' });
      parts.supplier = el('input', { id: id('supplier'), type: 'text', maxlength: '80', autocomplete: 'off', value: v.supplier || '' });
      parts.paidBy = choiceRow('Paid by', ['Business'].concat(withPerson(d.owners, v.paidBy === 'Business' ? '' : v.paidBy)), v.paidBy || 'Business');
      if (d.vatRegistered) parts.vat = amountInput('vat', v.vat || '');
      parts.receiptFile = el('input', { id: id('receipt'), type: 'file', accept: 'image/*,application/pdf', class: 'file-input' });
      parts.receipt = v.receipt || '';
      node.appendChild(el('div', { class: 'form-grid' },
        field('date', 'Date', date),
        field('amount', 'Amount (R)', parts.amount)));
      node.appendChild(startNote);
      node.appendChild(el('div', { class: 'field', 'data-field': 'category' },
        el('span', { class: 'label' }, 'Category'), parts.category,
        el('p', { class: 'hint hint-bad', 'data-error': 'category', hidden: true })));
      node.appendChild(field('what', 'What was it for?', parts.what, 'For example "Maltodextrin 5 kg" or "Claude Code, November".'));
      node.appendChild(field('supplier', 'Supplier (optional)', parts.supplier));
      node.appendChild(el('div', { class: 'field', 'data-field': 'paidBy' },
        el('span', { class: 'label' }, 'Who paid?'), parts.paidBy,
        el('p', { class: 'hint' }, 'An owner who paid from their own pocket is owed it back.'),
        el('p', { class: 'hint hint-bad', 'data-error': 'paidBy', hidden: true })));
      if (parts.vat) node.appendChild(field('vat', 'VAT included (R)', parts.vat, 'From the tax invoice. Leave blank if there is none.'));
      node.appendChild(field('receipt', parts.receipt ? 'Replace the receipt' : 'Receipt photo or PDF', parts.receiptFile,
        parts.receipt ? el('a', { href: parts.receipt, target: '_blank', rel: 'noopener' }, 'Open the saved receipt') : 'Take a photo, or pick a PDF. Keep receipts for 5 years.'));
    } else if (kind === 'money') {
      var kindHelp = el('p', { class: 'hint', 'data-role': 'kind-help' }, MONEY_HELP[v.kind || 'Loan']);
      parts.who = choiceRow('Who', withPerson(d.owners, v.who), v.who || d.owners[0]);
      parts.sachets = el('input', { id: id('sachets'), type: 'text', inputmode: 'numeric', autocomplete: 'off', value: v.sachets ? String(v.sachets) : '' });
      var whoField = el('div', { class: 'field', 'data-field': 'who' },
        el('span', { class: 'label' }, 'Which owner?'), parts.who,
        el('p', { class: 'hint hint-bad', 'data-error': 'who', hidden: true }));
      var sachetsField = field('sachets', 'Sachets sold (optional)', parts.sachets, 'Counts towards stock and the price per sachet.');
      var syncKind = function (k) {
        kindHelp.textContent = MONEY_HELP[k];
        whoField.hidden = k === 'Other sale';
        sachetsField.hidden = k !== 'Other sale';
      };
      parts.kind = choiceRow('Kind', d.kinds, v.kind || 'Loan', syncKind, 'chips');
      parts.amount = amountInput('amount', v.amount);
      node.appendChild(el('div', { class: 'field', 'data-field': 'kind' }, el('span', { class: 'label' }, 'What is it?'), parts.kind, kindHelp,
        el('p', { class: 'hint hint-bad', 'data-error': 'kind', hidden: true })));
      node.appendChild(whoField);
      node.appendChild(el('div', { class: 'form-grid' },
        field('date', 'Date', date),
        field('amount', 'Amount (R)', parts.amount)));
      node.appendChild(startNote);
      node.appendChild(sachetsField);
      syncKind(v.kind || 'Loan');
    } else {
      parts.flavour = el('input', { id: id('flavour'), type: 'text', maxlength: '40', autocomplete: 'off', list: id('flavours'), value: v.flavour || '' });
      var seen = {};
      var flavours = el('datalist', { id: id('flavours') });
      ['Orange', 'Cranberry'].concat(d.entries.batch.map(function (b) { return b.flavour; })).forEach(function (f) {
        if (!seen[f]) { seen[f] = true; flavours.appendChild(el('option', { value: f })); }
      });
      parts.sachets = el('input', { id: id('sachets'), type: 'text', inputmode: 'numeric', autocomplete: 'off', value: v.sachets ? String(v.sachets) : '' });
      parts.cost = amountInput('cost', v.cost);
      node.appendChild(el('div', { class: 'form-grid' },
        field('date', 'Date made', date),
        field('flavour', 'Flavour', parts.flavour)));
      node.appendChild(flavours);
      node.appendChild(el('div', { class: 'form-grid' },
        field('sachets', 'Sachets made', parts.sachets),
        field('cost', 'What it cost (R)', parts.cost)));
      node.appendChild(el('p', { class: 'hint' }, 'The ingredients and packaging used for this batch. The receipts for them go in as expenses too: this is only for the cost per sachet.'));
    }
    node.appendChild(field('notes', 'Notes (optional)', notes));
    if (startNote) syncStart(); // an entry being edited may already be dated before the start

    function read() {
      var out = { date: date.value, notes: notes.value };
      if (kind === 'expense') {
        out.amount = parts.amount.value;
        out.category = choiceValue(parts.category);
        out.what = parts.what.value;
        out.supplier = parts.supplier.value;
        out.paidBy = choiceValue(parts.paidBy);
        if (parts.vat) out.vat = parts.vat.value;
        out.receipt = parts.receipt;
      } else if (kind === 'money') {
        out.kind = choiceValue(parts.kind);
        out.who = out.kind === 'Other sale' ? '' : choiceValue(parts.who);
        out.amount = parts.amount.value;
        out.sachets = out.kind === 'Other sale' ? (parts.sachets.value.trim() || '0') : '0';
      } else {
        out.flavour = parts.flavour.value;
        out.sachets = parts.sachets.value.trim();
        out.cost = parts.cost.value;
      }
      return out;
    }

    function clearErrors() {
      Array.prototype.forEach.call(node.querySelectorAll('[data-error]'), function (p) { p.hidden = true; p.textContent = ''; });
      Array.prototype.forEach.call(node.querySelectorAll('[aria-invalid]'), function (i) { i.removeAttribute('aria-invalid'); });
    }

    // Shows the message under its field and moves there. Returns false when the field is unknown.
    function showError(name, message) {
      var p = node.querySelector('[data-error="' + name + '"]');
      if (!p) return false;
      p.textContent = message;
      p.hidden = false;
      var input = node.querySelector('[data-field="' + name + '"] input, [data-field="' + name + '"] button');
      if (input) {
        if (input.tagName === 'INPUT') input.setAttribute('aria-invalid', 'true');
        input.focus();
      }
      return true;
    }

    return {
      node: node, read: read, showError: showError, clearErrors: clearErrors,
      file: function () { return parts.receiptFile && parts.receiptFile.files[0] ? parts.receiptFile.files[0] : null; },
      setReceipt: function (url) { parts.receipt = url; }
    };
  }

  // Saves a receipt file first (when one was picked), then the entry. Returns the saved entry,
  // or null when it did not save (the error is shown in the form or as a toast).
  async function saveEntry(kind, form, id, button) {
    form.clearErrors();
    var label = button.textContent;
    button.disabled = true;
    try {
      var file = form.file();
      if (file) {
        button.textContent = 'Saving the receipt…';
        var entry0 = form.read();
        var up = await api('uploadReceipt', Object.assign(await receiptPayload(file), { date: entry0.date, label: entry0.supplier || entry0.what }));
        form.setReceipt(up.url);
      }
      button.textContent = 'Saving…';
      var res = await api(id ? 'edit' : 'add', { kind: kind, id: id, entry: form.read() });
      var list = state.data.entries[kind];
      var at = list.findIndex(function (e) { return e.id === res.entry.id; });
      if (at >= 0) list[at] = res.entry;
      else list.push(res.entry);
      state.report = null;
      return res.entry;
    } catch (err) {
      if (!(err.data && err.data.field && form.showError(err.data.field, err.message))) toast(err.message, 'bad');
      return null;
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  // A photo is shrunk and sent as JPEG. A PDF goes as it is.
  async function receiptPayload(file) {
    if (file.type === 'application/pdf') {
      if (file.size > MAX_PDF_BYTES) throw new ApiError('invalid', 'That PDF is larger than 8 MB. Save a smaller copy and try again.', { field: 'receipt' });
      return { type: 'application/pdf', data: await base64Of(file) };
    }
    if (!/^image\//.test(file.type)) throw new ApiError('invalid', 'Pick a photo or a PDF of the receipt.', { field: 'receipt' });
    var blob = await shrinkPhoto(file);
    return { type: 'image/jpeg', data: await base64Of(blob) };
  }

  function shrinkPhoto(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, PHOTO_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (b) {
          if (b) resolve(b);
          else reject(new ApiError('invalid', 'Could not read that photo. Try again, or use a PDF.', { field: 'receipt' }));
        }, 'image/jpeg', 0.82);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new ApiError('invalid', 'Could not read that photo. Try again, or use a PDF.', { field: 'receipt' }));
      };
      img.src = url;
    });
  }

  function base64Of(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).replace(/^data:[^,]*,/, '')); };
      r.onerror = function () { reject(new ApiError('invalid', 'Could not read that file.', { field: 'receipt' })); };
      r.readAsDataURL(blob);
    });
  }

  // ---------- Add ----------

  function renderAdd() {
    var panel = clear($('panel-add'));
    var kinds = ['expense', 'money', 'batch'];
    var seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'What to add' });
    kinds.forEach(function (k) {
      seg.appendChild(el('button', {
        type: 'button', class: 'seg-btn', 'aria-pressed': String(state.addKind === k), 'data-role': 'add-' + k,
        onclick: function () { state.addKind = k; renderAdd(); }
      }, KIND_NAMES[k]));
    });
    var form = entryForm(state.addKind);
    var submit = el('button', { type: 'submit', class: 'btn btn-primary btn-block', id: 'add-save' }, 'Save ' + KIND_NAMES[state.addKind].toLowerCase());
    var node = el('form', { class: 'stack-lg', id: 'add-form', novalidate: true }, form.node, submit);
    node.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var saved = await saveEntry(state.addKind, form, null, submit);
      if (!saved) return;
      toast('Saved ' + saved.id + ', ' + money(saved.amount !== undefined ? saved.amount : saved.cost));
      renderAdd();
    });
    panel.appendChild(el('h2', { class: 'section-title' }, 'Add to the books'));
    panel.appendChild(seg);
    panel.appendChild(node);
  }

  // ---------- Ledger ----------

  // Every entry as { kind, e }, newest first. Paid website orders come in as kind 'sale':
  // they are read from the order Sheet and change only on the order site.
  function allEntries() {
    var out = [];
    ['expense', 'money', 'batch'].forEach(function (kind) {
      state.data.entries[kind].forEach(function (e) { out.push({ kind: kind, e: e }); });
    });
    (state.data.sales || []).forEach(function (e) { out.push({ kind: 'sale', e: e }); });
    return out.sort(function (a, b) {
      if (a.e.date !== b.e.date) return a.e.date < b.e.date ? 1 : -1;
      return (a.e.added || a.e.id) < (b.e.added || b.e.id) ? 1 : -1;
    });
  }

  // Money out is negative, money in positive, and a batch moves no money.
  function flow(item) {
    if (item.kind === 'sale') return item.e.total;
    if (item.kind === 'expense') return -item.e.amount;
    if (item.kind === 'money') return item.e.kind === 'Paid back' ? -item.e.amount : item.e.amount;
    return 0;
  }

  function entryTitle(item) {
    var e = item.e;
    if (item.kind === 'sale') return 'Website sale, ' + e.qty + (e.qty === 1 ? ' sachet' : ' sachets');
    if (item.kind === 'expense') return e.what;
    if (item.kind === 'batch') return e.sachets + ' ' + e.flavour + ' sachets made';
    if (e.kind === 'Other sale') return 'Other sale' + (e.sachets ? ', ' + e.sachets + ' sachets' : '');
    if (e.kind === 'Paid back') return 'Paid back to ' + e.who;
    return e.who + ' put in (' + e.kind.toLowerCase() + ')';
  }

  function entryMeta(item) {
    var e = item.e;
    if (item.kind === 'sale') {
      return [e.fee ? 'incl. delivery ' + money2(e.fee) : '', e.discount ? 'after a discount of ' + money2(e.discount) : '', e.card ? 'paid by card' : '']
        .filter(Boolean).join(' · ');
    }
    if (item.kind === 'expense') return [e.category, e.paidBy === 'Business' ? 'paid by the business' : 'paid by ' + e.paidBy, e.supplier].filter(Boolean).join(' · ');
    if (item.kind === 'batch') return 'Cost ' + money(e.cost) + (e.sachets ? ', ' + money(e.cost / e.sachets) + ' a sachet' : '');
    return '';
  }

  function matches(item) {
    var f = state.filter;
    if (f.type !== 'all' && item.kind !== f.type) return false;
    if (f.month !== 'all' && item.e.date.slice(0, 7) !== f.month) return false;
    if (f.q) {
      var hay = [item.e.id, entryTitle(item), entryMeta(item), item.e.notes, item.e.kind, item.e.who].join(' ').toLowerCase();
      if (hay.indexOf(f.q.toLowerCase()) === -1) return false;
    }
    return true;
  }

  function renderLedger() {
    var panel = clear($('panel-ledger'));
    var items = allEntries();
    var months = {};
    items.forEach(function (i) { months[i.e.date.slice(0, 7)] = true; });

    var chips = el('div', { class: 'chips', role: 'group', 'aria-label': 'Show' });
    [['all', 'All'], ['sale', 'Website sales'], ['expense', 'Expenses'], ['money', 'Money in'], ['batch', 'Batches']].forEach(function (t) {
      chips.appendChild(el('button', {
        type: 'button', class: 'chip', 'aria-pressed': String(state.filter.type === t[0]), 'data-role': 'type-' + t[0],
        onclick: function () { state.filter.type = t[0]; renderLedger(); }
      }, t[1]));
    });
    var month = el('select', { id: 'ledger-month' }, el('option', { value: 'all' }, 'Every month'));
    Object.keys(months).sort().reverse().forEach(function (m) {
      month.appendChild(el('option', { value: m, selected: state.filter.month === m }, formatMonth(m)));
    });
    month.addEventListener('change', function () { state.filter.month = month.value; renderLedger(); });
    var search = el('input', { id: 'ledger-search', type: 'search', placeholder: 'Supplier, what, ID…', value: state.filter.q, autocomplete: 'off' });
    search.addEventListener('input', function () {
      state.filter.q = search.value.trim();
      renderList();
    });

    var listBox = el('div', { id: 'ledger-list' });
    panel.appendChild(el('h2', { class: 'section-title' }, 'Ledger'));
    if (!state.data.salesConnected) {
      panel.appendChild(el('div', { class: 'alert alert-wait', role: 'status' }, (state.data.salesMessage || 'Website sales are not connected.') + ' Website sales are missing below.'));
    }
    panel.appendChild(chips);
    panel.appendChild(el('div', { class: 'form-grid' },
      el('div', { class: 'field' }, el('label', { for: 'ledger-month' }, 'Month'), month),
      el('div', { class: 'field' }, el('label', { for: 'ledger-search' }, 'Search'), search)));
    panel.appendChild(listBox);

    function renderList() {
      clear(listBox);
      var shown = items.filter(matches);
      if (!items.length) {
        listBox.appendChild(el('p', { class: 'empty' }, 'Nothing in the books yet. Start on the Add tab.'));
        return;
      }
      var into = 0;
      var out = 0;
      shown.forEach(function (i) { var f = flow(i); if (f > 0) into += f; else out -= f; });
      listBox.appendChild(el('p', { class: 'fine', id: 'ledger-total' },
        shown.length + (shown.length === 1 ? ' entry' : ' entries') + ' · in ' + money2(into) + ' · out ' + money2(out)));
      if (!shown.length) {
        listBox.appendChild(el('p', { class: 'empty' }, 'Nothing matches.'));
        return;
      }
      var ul = el('ul', { class: 'entries' });
      shown.forEach(function (i) { ul.appendChild(entryRow(i)); });
      listBox.appendChild(ul);
    }
    renderList();
  }

  function entryRow(item) {
    var e = item.e;
    var key = item.kind + ':' + e.id;
    var f = flow(item);
    var li = el('li', { class: 'entry', 'data-id': e.id });
    var amount = item.kind === 'batch' ? el('span', { class: 'entry-amount' }, e.sachets + ' made')
      : el('span', { class: 'entry-amount' + (f > 0 ? ' entry-amount--in' : '') }, (f > 0 ? '+' : '−') + money2(Math.abs(f)));
    li.appendChild(el('div', { class: 'entry-head' },
      el('span', { class: 'entry-when' }, formatDay(e.date) + ' · ' + e.id),
      amount));
    li.appendChild(el('p', { class: 'entry-title' }, entryTitle(item)));
    var meta = entryMeta(item);
    if (meta) li.appendChild(el('p', { class: 'entry-meta' }, meta));
    if (e.notes) li.appendChild(el('p', { class: 'entry-meta' }, e.notes));
    if (item.kind === 'sale') {
      li.appendChild(el('p', { class: 'entry-meta fine' }, 'From the order site. Change it there.'));
      return li;
    }
    var tools = el('div', { class: 'entry-tools' });
    if (item.kind === 'expense') {
      tools.appendChild(e.receipt
        ? el('a', { href: e.receipt, target: '_blank', rel: 'noopener', class: 'entry-link' }, 'Receipt')
        : el('span', { class: 'flag' }, 'No receipt'));
    }
    var editBtn = el('button', { type: 'button', class: 'btn btn-quiet btn-small', 'aria-expanded': String(state.editing === key) }, 'Edit');
    editBtn.addEventListener('click', function () {
      state.editing = state.editing === key ? null : key;
      renderLedger();
      if (state.editing) {
        var open = document.querySelector('.entry[data-id="' + e.id + '"] input');
        if (open) open.focus();
      }
    });
    tools.appendChild(editBtn);
    li.appendChild(tools);
    if (state.editing === key) li.appendChild(editBox(item));
    return li;
  }

  function editBox(item) {
    var form = entryForm(item.kind, item.e);
    var save = el('button', { type: 'submit', class: 'btn btn-primary' }, 'Save changes');
    var cancel = el('button', { type: 'button', class: 'btn btn-quiet' }, 'Cancel');
    var remove = el('button', { type: 'button', class: 'btn btn-danger' }, 'Remove');
    var node = el('form', { class: 'stack edit-box', novalidate: true }, form.node, el('div', { class: 'row-actions' }, save, cancel, remove));
    node.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var saved = await saveEntry(item.kind, form, item.e.id, save);
      if (!saved) return;
      state.editing = null;
      toast('Saved ' + saved.id);
      renderLedger();
    });
    cancel.addEventListener('click', function () { state.editing = null; renderLedger(); });
    remove.addEventListener('click', async function () {
      if (remove.getAttribute('data-confirm') !== 'yes') {
        remove.setAttribute('data-confirm', 'yes');
        remove.textContent = 'Tap again to remove ' + item.e.id;
        return;
      }
      remove.disabled = true;
      try {
        await api('remove', { kind: item.kind, id: item.e.id });
        var list = state.data.entries[item.kind];
        list.splice(list.findIndex(function (x) { return x.id === item.e.id; }), 1);
        state.editing = null;
        state.report = null;
        toast('Removed ' + item.e.id + '. It stays in the sheet, marked removed.');
        renderLedger();
      } catch (err) {
        remove.disabled = false;
        toast(err.message, 'bad');
      }
    });
    return node;
  }

  // ---------- Report ----------

  // The dates for a period, worked out from today on the server.
  function periodDates(period) {
    var t = state.data.today;
    var y = Number(t.slice(0, 4));
    var m = Number(t.slice(5, 7));
    if (period === 'month') return { from: t.slice(0, 7) + '-01', to: t };
    if (period === 'last-month') {
      var ly = m === 1 ? y - 1 : y;
      var lm = m === 1 ? 12 : m - 1;
      return { from: ly + '-' + pad2(lm) + '-01', to: ly + '-' + pad2(lm) + '-' + pad2(lastDayOf(ly, lm)) };
    }
    var start = m >= 3 ? y : y - 1; // the SARS tax year starts on 1 March
    if (period === 'tax-year') return { from: start + '-03-01', to: t };
    if (period === 'last-tax-year') return { from: (start - 1) + '-03-01', to: start + '-02-' + pad2(lastDayOf(start, 2)) };
    return { from: state.custom.from, to: state.custom.to };
  }

  function renderReport() {
    var panel = clear($('panel-report'));
    panel.appendChild(el('h2', { class: 'section-title' }, 'Report'));
    var seg = el('div', { class: 'chips', role: 'group', 'aria-label': 'Period' });
    [['month', 'This month'], ['last-month', 'Last month'], ['tax-year', 'This tax year'], ['last-tax-year', 'Last tax year'], ['custom', 'Pick dates']].forEach(function (p) {
      seg.appendChild(el('button', {
        type: 'button', class: 'chip', 'aria-pressed': String(state.period === p[0]), 'data-role': 'period-' + p[0],
        onclick: function () {
          state.period = p[0];
          state.report = null;
          renderReport();
        }
      }, p[1]));
    });
    panel.appendChild(seg);

    if (state.period === 'custom') {
      var from = el('input', { id: 'report-from', type: 'date', value: state.custom.from, max: state.data.today });
      var to = el('input', { id: 'report-to', type: 'date', value: state.custom.to || state.data.today, max: state.data.today });
      var go = el('button', { type: 'submit', class: 'btn btn-primary' }, 'Show');
      var form = el('form', { class: 'stack', novalidate: true },
        el('div', { class: 'form-grid' },
          el('div', { class: 'field' }, el('label', { for: 'report-from' }, 'From'), from),
          el('div', { class: 'field' }, el('label', { for: 'report-to' }, 'To'), to)),
        go);
      form.addEventListener('submit', function (ev) {
        ev.preventDefault();
        state.custom = { from: from.value, to: to.value };
        state.report = null;
        renderReport();
      });
      panel.appendChild(form);
      if (!state.custom.from) return;
    }

    var dates = periodDates(state.period);
    var body = el('div', { class: 'stack-lg', id: 'report-body', 'aria-live': 'polite' });
    panel.appendChild(body);
    if (state.report && state.report.from === dates.from && state.report.to === dates.to) {
      drawReport(body, state.report);
      return;
    }
    body.appendChild(el('p', { class: 'fine', role: 'status' }, 'Working it out…'));
    api('report', dates).then(function (res) {
      state.report = res.report;
      if (state.tab === 'report' && body.isConnected) drawReport(clear(body), res.report);
    }).catch(function (err) {
      clear(body).appendChild(el('div', { class: 'alert alert-bad', role: 'alert' }, err.message));
    });
  }

  function rows(list) {
    return el('dl', { class: 'summary' }, list.filter(Boolean).map(function (r) {
      return el('div', { class: 'summary-row' + (r[2] ? ' ' + r[2] : '') }, el('dt', null, r[0]), el('dd', null, r[1]));
    }));
  }

  function section(title, children, role) {
    return el('section', { class: 'report-card stack-sm', 'data-role': role }, el('h3', { class: 'report-title' }, title), children);
  }

  function drawReport(body, r) {
    body.appendChild(el('p', { class: 'fine' }, formatDay(r.from) + ' to ' + formatDay(r.to)));
    if (!r.salesConnected) body.appendChild(el('div', { class: 'alert alert-wait', role: 'status' }, r.salesMessage + ' The report below has no website sales.'));

    body.appendChild(el('div', { class: 'headline', 'data-role': 'headline' },
      el('div', null, el('p', { class: 'fine' }, r.profit < 0 ? 'Loss' : 'Profit'), el('p', { class: 'headline-figure', id: 'report-profit' }, money2(r.profit))),
      el('div', null, el('p', { class: 'fine' }, 'Income'), el('p', { class: 'headline-small' }, money2(r.income))),
      el('div', null, el('p', { class: 'fine' }, 'Costs'), el('p', { class: 'headline-small' }, money2(r.costs)))));

    var s = r.sales;
    body.appendChild(section('Income', rows([
      ['Website sales: ' + s.orders + (s.orders === 1 ? ' order, ' : ' orders, ') + s.sachets + ' sachets', money2(s.sachetIncome)],
      s.discounts ? ['after discount codes of', money2(s.discounts), 'summary-sub'] : null,
      ['Delivery and collection fees charged', money2(s.deliveryFees)],
      r.otherSales.count ? ['Other sales' + (r.otherSales.sachets ? ', ' + r.otherSales.sachets + ' sachets' : ''), money2(r.otherSales.total)] : null,
      ['Income', money2(r.income), 'summary-total']
    ]), 'income'));

    var costRows = r.expenses.map(function (c) { return [c.category, money2(c.total)]; });
    if (r.cardFees) costRows.push(['Card fees (estimated from ' + s.cardOrders + (s.cardOrders === 1 ? ' card payment)' : ' card payments)'), money2(r.cardFees)]);
    if (!costRows.length) costRows.push(['No costs in this period', money2(0)]);
    costRows.push(['Costs', money2(r.costs), 'summary-total']);
    if (r.vatPaid !== null) costRows.push(['VAT included in the costs', money2(r.vatPaid), 'summary-sub']);
    body.appendChild(section('Costs', [
      rows(costRows),
      r.missingReceipts ? el('p', { class: 'flag-line', 'data-role': 'missing-receipts' },
        r.missingReceipts + (r.missingReceipts === 1 ? ' expense has' : ' expenses have') + ' no receipt. Add them on the Ledger tab.') : null
    ], 'costs'));

    var p = r.perSachet;
    body.appendChild(section('Per sachet', [
      rows([
        ['Sachets sold', String(p.sold)],
        ['Average price', p.avgPrice === null ? '–' : money2(p.avgPrice)],
        ['Cost to make (all batches so far)', p.costToMake === null ? 'Add a batch' : money2(p.costToMake)],
        ['Kept per sachet', p.margin === null ? '–' : money2(p.margin), 'summary-total']
      ]),
      rows([
        ['Made so far', String(r.stock.made)],
        ['Sold so far', String(r.stock.sold)],
        ['Should be in the freezer', String(r.stock.left), 'summary-total']
      ])
    ], 'per-sachet'));

    var c = r.cash;
    body.appendChild(section('Cash in the business account', [
      el('p', { class: 'fine' }, 'From ' + formatDay(c.since) + ' to ' + formatDay(r.to) + '. Check it against the bank statement.'),
      rows([
        ['Opening balance', money2(c.opening)],
        ['Put in by owners', money2(c.ownersIn)],
        ['Sales', money2(c.sales)],
        ['Spent by the business', less(c.spent)],
        ['Paid back to owners', less(c.paidBack)],
        ['Cash on hand', money2(c.onHand), 'summary-total']
      ])
    ], 'cash'));

    body.appendChild(section('Owners', r.owners.map(function (o) {
      return el('div', { class: 'owner stack-sm', 'data-owner': o.name },
        el('p', { class: 'owner-name' }, o.name, o.former ? el('span', { class: 'fine' }, ' (former owner)') : null),
        rows([
          ['Loans', money2(o.loan)],
          ['Paid for the business from their own pocket', money2(o.expenses)],
          ['Paid back', less(o.paidBack)],
          ['The business owes ' + o.name, money2(o.owed), 'summary-total'],
          ['Capital (their share)', money2(o.capital)]
        ]));
    }), 'owners'));

    var ty = r.taxYear;
    var pct = Math.min(100, ty.percent);
    body.appendChild(section('Tax year ' + ty.label, [
      el('p', { class: 'fine' }, formatDay(ty.start) + ' to ' + formatDay(ty.end) + ', so far'),
      rows([['Turnover', money2(ty.turnover), 'summary-total']]),
      el('div', { class: 'meter', role: 'img', 'aria-label': ty.percent + '% of ' + money(ty.limit) },
        el('div', { class: 'meter-fill', style: 'width:' + pct + '%' })),
      el('p', { class: 'fine' }, ty.percent + '% of ' + money(ty.limit) + '. Above that in 12 months, VAT registration is compulsory, and turnover tax for micro businesses no longer applies. For information only: ask an accountant before deciding anything.')
    ], 'tax-year'));

    var dl = el('button', { type: 'button', class: 'btn btn-primary btn-block', id: 'report-download' }, 'Download for an accountant (CSV)');
    dl.addEventListener('click', async function () {
      dl.disabled = true;
      try {
        var res = await api('export', { from: r.from, to: r.to });
        var url = URL.createObjectURL(new Blob(['﻿' + res.csv], { type: 'text/csv;charset=utf-8' }));
        var a = el('a', { href: url, download: res.filename });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
      } catch (err) {
        toast(err.message, 'bad');
      } finally {
        dl.disabled = false;
      }
    });
    body.appendChild(dl);
  }

  // ---------- Settings ----------

  function renderSettings() {
    var panel = clear($('panel-settings'));
    var s = state.data.settings;
    var input = function (key, label, hint, attrs) {
      var i = el('input', Object.assign({ id: 's-' + key, type: 'text', autocomplete: 'off', value: s[key] || '' }, attrs || {}));
      return { key: key, input: i, read: function () { return i.value; }, node: field(key, label, i, hint) };
    };
    var choice = function (key, label, options, hint, onChange) {
      var row = choiceRow(label, options.map(function (o) { return o[1]; }), (options.filter(function (o) { return o[0] === s[key]; })[0] || options[0])[1], onChange);
      return {
        key: key,
        read: function () { var v = choiceValue(row); return options.filter(function (o) { return o[1] === v; })[0][0]; },
        node: el('div', { class: 'field', 'data-field': key }, el('span', { class: 'label' }, label), row,
          hint ? el('p', { class: 'hint' }, hint) : null, el('p', { class: 'hint hint-bad', 'data-error': key, hidden: true }))
      };
    };
    var general = [
      input('brand_name', 'Business name', null, { maxlength: '60' }),
      input('books_start', 'Books start on', 'Cash on hand counts from this day.', { type: 'date' }),
      input('opening_balance', 'Business account balance on that day (R)', null, { inputmode: 'decimal' })
    ];
    var vat = choice('vat_registered', 'Registered for VAT', [['no', 'No'], ['yes', 'Yes']], 'Yes adds a VAT field to expenses.');
    var fees = cardFeesSection(choice, input);
    var fields = general.concat(fees.fields, [vat]);
    var save = el('button', { type: 'submit', class: 'btn btn-primary btn-block', id: 'settings-save' }, 'Save settings');
    var form = el('form', { class: 'stack-lg', id: 'settings-form', novalidate: true },
      general.map(function (f) { return f.node; }), fees.node, vat.node, save);
    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      Array.prototype.forEach.call(form.querySelectorAll('[data-error]'), function (p) { p.hidden = true; });
      var values = {};
      fields.forEach(function (f) { values[f.key] = f.read(); });
      save.disabled = true;
      try {
        var res = await api('saveSettings', { values: values });
        state.data.settings = res.settings;
        state.data.owners = res.owners;
        state.data.vatRegistered = res.vatRegistered;
        state.report = null;
        $('brand').textContent = res.settings.brand_name + ' books';
        toast('Settings saved');
        renderSettings();
      } catch (err) {
        var p = err.data && err.data.field ? form.querySelector('[data-error="' + err.data.field + '"]') : null;
        if (p) {
          p.textContent = err.message;
          p.hidden = false;
        } else {
          toast(err.message, 'bad');
        }
      } finally {
        save.disabled = false;
      }
    });
    panel.appendChild(el('h2', { class: 'section-title' }, 'Settings'));
    if (!state.data.salesConnected) {
      panel.appendChild(el('div', { class: 'alert alert-wait' }, state.data.salesMessage || 'Website sales are not connected.'));
    }
    panel.appendChild(ownersEditor());
    panel.appendChild(form);
  }

  // Card fees in their own box: what they are, how the books should count them, and,
  // only when the books estimate them, the Paystack rate with a worked example.
  function cardFeesSection(choice, input) {
    var help = el('p', { class: 'hint', 'data-role': 'fee-help' });
    var example = el('p', { class: 'fee-example', 'data-role': 'fee-example', 'aria-live': 'polite' });
    var percent = input('card_fee_percent', 'Percent of each payment', null, { inputmode: 'decimal' });
    var fixed = input('card_fee_fixed', 'Plus a fixed amount (R)', null, { inputmode: 'decimal' });
    var rates = el('div', { class: 'stack', 'data-role': 'fee-rates' },
      el('div', { class: 'form-grid' }, percent.node, fixed.node),
      example,
      el('p', { class: 'hint' }, 'Check the rate on your Paystack dashboard, as it can change.'));
    var mode = choice('card_fees', 'How should the books count them?',
      [['estimate', 'Estimate for me'], ['recorded', 'I’ll add them']], null, sync);

    function sync() {
      var estimate = mode.read() === 'estimate';
      rates.hidden = !estimate;
      help.textContent = estimate
        ? 'For every website order paid by card, the books take off a fee worked out from the rate below. You enter nothing.'
        : 'Each month, add the fee total from your Paystack statement as an expense, with the category Payment fees. The books estimate nothing, so the fees are never counted twice.';
      var p = Number(percent.read().trim());
      var f = Number(fixed.read().trim().replace(/^R\s*/i, ''));
      if (percent.read().trim() === '' || fixed.read().trim() === '' || !isFinite(p) || !isFinite(f)) {
        example.textContent = 'Enter the percent and the fixed amount to see an example.';
        return;
      }
      var fee = Math.round(200 * p + f * 100) / 100;
      example.textContent = 'Example: on a R200 card payment, Paystack keeps about ' + money2(fee) + ', so ' + money2(200 - fee) + ' reaches the bank.';
    }
    percent.input.addEventListener('input', sync);
    fixed.input.addEventListener('input', sync);
    sync();

    return {
      fields: [mode, percent, fixed],
      node: el('section', { class: 'report-card stack', 'aria-labelledby': 'fees-title', 'data-role': 'card-fees' },
        el('h3', { class: 'report-title', id: 'fees-title' }, 'Card payment fees (Paystack)'),
        el('p', { class: 'fine' }, 'When a customer pays by card, Paystack keeps a small fee, so less reaches the bank than the customer paid. The books need to count that fee to get profit and cash right.'),
        mode.node, help, rates)
    };
  }

  // The owners: a list of names with Add and Remove. Each change is saved straight away.
  // Removing someone with entries asks first. Their entries keep their name, and the
  // report keeps showing what the business owes them, as a former owner.
  function ownersEditor() {
    var list = el('ul', { class: 'owner-list', id: 'owner-list' });
    var name = el('input', { id: 's-owner-new', type: 'text', maxlength: '30', autocomplete: 'off', autocapitalize: 'words', placeholder: 'Name' });
    var add = el('button', { type: 'button', class: 'btn btn-primary', id: 'owner-add' }, 'Add');
    var error = el('p', { class: 'hint hint-bad', id: 'owner-error', role: 'alert', hidden: true });

    function used() {
      var out = {};
      state.data.entries.expense.forEach(function (e) { if (e.paidBy !== 'Business') out[e.paidBy] = true; });
      state.data.entries.money.forEach(function (m) { if (m.who) out[m.who] = true; });
      return out;
    }

    function say(message) {
      error.textContent = message || '';
      error.hidden = !message;
    }

    function draw() {
      clear(list);
      var busy = used();
      var names = state.data.owners;
      names.forEach(function (n) {
        var label = el('div', { class: 'owner-row-text' }, el('span', { class: 'owner-row-name' }, n),
          busy[n] ? el('span', { class: 'fine' }, 'Has entries') : null);
        var tools;
        if (names.length === 1) {
          tools = el('span', { class: 'fine' }, 'At least one owner');
        } else {
          tools = el('button', { type: 'button', class: 'btn btn-quiet btn-small', 'aria-label': 'Remove ' + n }, 'Remove');
          tools.addEventListener('click', function () {
            var rest = names.filter(function (x) { return x !== n; });
            if (!busy[n] || tools.getAttribute('data-confirm') === 'yes') {
              save(rest, busy[n] ? 'Removed ' + n + '. Their entries stay in the books.' : 'Removed ' + n);
              return;
            }
            tools.setAttribute('data-confirm', 'yes');
            tools.setAttribute('aria-label', 'Tap again to remove ' + n);
            tools.textContent = 'Tap again';
            say(n + ' has entries. They stay in the books, and the report keeps showing what is owed to ' + n + '. Tap again to remove.');
          });
        }
        list.appendChild(el('li', { class: 'owner-row', 'data-owner': n }, label, tools));
      });
    }

    async function save(names, done) {
      say('');
      add.disabled = true;
      try {
        var res = await api('saveSettings', { values: { owners: names.join(', ') } });
        state.data.settings.owners = res.settings.owners;
        state.data.owners = res.owners;
        state.report = null;
        toast(done);
        draw();
        return true;
      } catch (err) {
        say(err.message);
        return false;
      } finally {
        add.disabled = false;
      }
    }

    async function addName() {
      var n = name.value.trim().replace(/\s+/g, ' ');
      if (!n) return say('Type a name first.');
      if (n.indexOf(',') !== -1) return say('Use a name without commas.');
      if (n.toLowerCase() === 'business') return say('"Business" is already a choice under Who paid.');
      var taken = state.data.owners.some(function (x) { return x.toLowerCase() === n.toLowerCase(); });
      if (taken) return say(n + ' is already an owner.');
      if (await save(state.data.owners.concat(n), 'Added ' + n)) {
        name.value = '';
        name.focus();
      }
    }

    add.addEventListener('click', addName);
    name.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        addName();
      }
    });
    draw();
    return el('section', { class: 'report-card stack', 'aria-labelledby': 'owners-title' },
      el('h3', { class: 'report-title', id: 'owners-title' }, 'Owners'),
      el('p', { class: 'fine' }, 'The people who put money in, or pay for things from their own pocket.'),
      list,
      el('div', { class: 'field' },
        el('label', { for: 's-owner-new' }, 'Add an owner'),
        el('div', { class: 'owner-add-row' }, name, add),
        error));
  }

  // ---------- Wiring ----------

  $('login-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var key = $('key').value.trim();
    if (!key) return;
    state.key = key;
    $('key').value = '';
    load();
  });
  $('lock').addEventListener('click', function () { lock(); });
  $('load-retry').addEventListener('click', load);
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
    b.addEventListener('click', function () { setTab(b.getAttribute('data-tab')); });
  });
  window.addEventListener('hashchange', function () {
    if (window.location.hash.length > 1) window.location.reload();
  });

  state.key = keyFromLink() || store.get(KEY_STORE);
  if (state.key) load();
  else lock();
})();
