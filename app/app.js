/* RoboGolfPro Club Repair POS — UI */
(function () {
  'use strict';

  var P = window.Pricing;
  var money = P.formatMoney;

  function clone(o) { return o === undefined ? o : JSON.parse(JSON.stringify(o)); }
  function uid(prefix) { return (prefix || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function blankOrNum(v) { return v === '' || v === null || v === undefined ? '' : num(v); }
  function fmtDate(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function fmtDateTime(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' +
      d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function newDraft() {
    return { id: null, number: null, createdAt: null, customer: { name: '', phone: '', email: '' }, notes: '', lines: [] };
  }

  // ---------------------------------------------------------------- state
  // The catalog and settings live on the server (/api/catalog), shared by every
  // device. The ticket being rung up is kept in memory only and is never saved.
  var S = {
    catalog: clone(window.DEFAULT_CATALOG),
    settings: clone(window.DEFAULT_SETTINGS),
    draft: newDraft(),
    view: 'ticket',
    posCat: null,
    search: '',
    catalogCat: null
  };
  var sheet = null; // { el, edit, onDone }

  // ---------------------------------------------------------------- server sync
  var Remote = {
    mode: 'loading',   // loading | online | unconfigured | offline
    storage: 'cloud',  // cloud (Vercel + Upstash) | local (desktop app, file on this PC)
    pinStatus: 'set',  // set | setup (desktop: no PIN chosen yet) | missing
    location: null,    // desktop: folder the catalog is saved in
    version: 0,
    updatedAt: null,
    pin: null,         // admin PIN, kept in memory for this page only
    saving: false,
    error: null
  };

  function apply(data) {
    if (!data) return;
    if (validCatalog(data.catalog)) S.catalog = data.catalog;
    S.settings = Object.assign(clone(window.DEFAULT_SETTINGS), data.settings || {});
    Remote.version = data.version || 0;
    Remote.updatedAt = data.updatedAt || null;
    settingsEdit = null;
  }

  function api(method, path, body) {
    var headers = { 'Content-Type': 'application/json', 'x-robogolf': '1' };
    if (Remote.pin) headers['x-admin-pin'] = Remote.pin;
    return fetch(path, { method: method, headers: headers, cache: 'no-store', body: body ? JSON.stringify(body) : undefined })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (json) { json.status = res.status; return json; });
      });
  }

  function loadRemote(quiet) {
    if (location.protocol === 'file:') { Remote.mode = 'offline'; render(); return Promise.resolve(); }
    return api('GET', '/api/catalog').then(function (r) {
      if (r.status !== 200) throw new Error(r.error || 'HTTP ' + r.status);
      if (!r.configured) { Remote.mode = 'unconfigured'; Remote.error = r.error; }
      else {
        Remote.mode = 'online';
        Remote.storage = r.storage || 'cloud';
        Remote.pinStatus = r.pin || 'set';
        Remote.location = r.location || null;
        if (r.data) apply(r.data);
        if (Remote.storage === 'local') loadAppInfo();
        else { Remote.version = 0; }
      }
      if (!sheet || !quiet) render();
    }).catch(function (e) {
      Remote.mode = 'offline';
      Remote.error = e.message;
      render();
      if (!quiet) toast('Could not reach the server — using built-in prices');
    });
  }

  function canEdit() { return Remote.mode === 'online'; }

  // ---------------------------------------------------------------- desktop updates
  var App = { info: null, busy: false };

  function loadAppInfo() {
    return api('GET', '/api/app-info').then(function (r) {
      if (r.status !== 200) return;
      var had = App.info && App.info.available;
      App.info = r;
      if (!had && r.available && !sheet) render(); else renderMeta();
    }).catch(function () {});
  }

  function updateBanner() {
    var i = App.info;
    if (!i || !i.available) return '';
    return '<div class="notice"><span><strong>Update available:</strong> version ' + esc(i.latest.version) +
      ' (you have ' + esc(i.version) + '). Your catalog and settings are kept.</span>' +
      '<button class="btn primary" data-action="install-update">Install Update</button></div>';
  }

  function installUpdate() {
    var i = App.info;
    if (!i || !i.available || App.busy) return;
    if (!confirm('Install version ' + i.latest.version + ' now?\n\nThe app will restart in a few seconds. ' +
      (S.draft.lines.length ? 'The ticket in progress will be cleared. ' : '') + 'Your catalog and settings are kept.')) return;
    App.busy = true;
    var target = i.latest.version;
    showOverlay('Downloading update…', 'Version ' + target + '. This can take a minute.');
    api('POST', '/api/update/install').then(function (r) {
      if (r.status !== 200) throw new Error(r.error || 'Update failed');
      showOverlay('Restarting…', 'Almost done.');
      var started = Date.now();
      (function poll() {
        api('GET', '/api/app-info').then(function (x) {
          if (x.status === 200 && x.version === target) {
            S.draft = newDraft(); // nothing to warn about on reload
            location.reload();
          } else retry();
        }).catch(retry);
        function retry() {
          if (Date.now() - started > 120000) {
            hideOverlay(); App.busy = false;
            alert('The update was installed but the app did not come back. Close this window and start RoboGolf POS again.');
          } else setTimeout(poll, 1500);
        }
      })();
    }).catch(function (e) {
      hideOverlay(); App.busy = false;
      alert('Could not install the update: ' + e.message);
      loadAppInfo();
    });
  }

  function showOverlay(title, sub) {
    var el = document.getElementById('overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'overlay';
      el.className = 'overlay';
      document.body.appendChild(el);
    }
    el.innerHTML = '<div class="overlay-card"><div class="spinner"></div><div class="overlay-title">' + esc(title) + '</div><div class="muted small">' + esc(sub) + '</div></div>';
  }
  function hideOverlay() { var el = document.getElementById('overlay'); if (el) el.remove(); }

  // Save catalog + settings to the server. The local copy is updated first; on
  // failure the server copy is reloaded so screens never show unsaved data.
  function persist(successMsg) {
    if (!canEdit()) { toast('Not connected — changes cannot be saved'); loadRemote(true); return Promise.resolve(false); }
    Remote.saving = true;
    renderMeta();
    return api('PUT', '/api/catalog', { catalog: S.catalog, settings: S.settings, baseVersion: Remote.version })
      .then(function (r) {
        Remote.saving = false;
        if (r.status === 200) {
          apply(r.data);
          if (successMsg) toast(successMsg);
          render();
          return true;
        }
        if (r.status === 409) {
          apply(r.data);
          alert('The catalog was changed on another device, so your last change was not saved.\n\nThe latest catalog has been loaded — please make your change again.');
        } else if (r.status === 401) {
          Remote.pin = null;
          alert('Wrong or expired PIN. Unlock editing again to save changes.');
          loadRemote(true);
        } else {
          alert('Could not save: ' + (r.error || 'server error ' + r.status));
          loadRemote(true);
        }
        render();
        return false;
      })
      .catch(function () {
        Remote.saving = false;
        alert('Could not save — check the internet connection.');
        loadRemote(true);
        return false;
      });
  }

  // Run `fn` once the admin PIN has been entered.
  function requireUnlock(fn) {
    if (!canEdit()) {
      toast(Remote.mode === 'unconfigured' ? 'Storage not connected — see README' : 'Not connected — editing is unavailable');
      return;
    }
    if (Remote.pin) { fn(); return; }
    var creating = Remote.pinStatus === 'setup';
    openSheet({
      title: creating ? 'Create Admin PIN' : 'Unlock Editing',
      done: creating ? 'Create' : 'Unlock',
      edit: { pin: '' },
      onDone: function (e) {
        var pin = String(e.pin || '');
        if (!pin) return false;
        if (creating && pin !== String(e.confirm || '')) { toast('The two PINs don’t match'); return false; }
        api('POST', '/api/verify-pin', { pin: pin }).then(function (r) {
          if (r.status === 200) {
            Remote.pin = pin;
            if (r.created) { Remote.pinStatus = 'set'; toast('Admin PIN created'); }
            closeSheet();
            render();
            fn();
          } else {
            toast(r.error || 'Wrong PIN');
          }
        }).catch(function () { toast('Could not reach the server'); });
        return false; // keep the sheet open until the server answers
      },
      renderBody: function (e) {
        if (creating) {
          return '<div class="group-title">Choose an admin PIN</div><div class="group">' +
            '<div class="row"><label>New PIN</label><input type="password" autocomplete="new-password" autofocus data-bind="edit:pin" value="' + esc(e.pin) + '"></div>' +
            '<div class="row"><label>Confirm</label><input type="password" autocomplete="new-password" data-bind="edit:confirm" value="' + esc(e.confirm || '') + '"></div>' +
            '</div><div class="group-foot">At least 4 characters. It will be needed to change the catalog or settings; staff can ring up tickets without it. ' +
            'To reset a forgotten PIN, delete <b>admin-pin.json</b> from the data folder.</div>';
        }
        return '<div class="group-title">Admin PIN</div><div class="group">' +
          '<div class="row"><label>PIN</label><input type="password" autocomplete="off" autofocus data-bind="edit:pin" value="' + esc(e.pin) + '"></div>' +
          '</div><div class="group-foot">Needed to change the catalog or settings. Staff can ring up tickets without it.</div>';
      }
    });
  }

  function itemById(id) { return S.catalog.items.find(function (i) { return i.id === id; }); }
  function catById(id) { return S.catalog.categories.find(function (c) { return c.id === id; }); }
  function itemsIn(catId, includeInactive) {
    return S.catalog.items.filter(function (i) { return i.categoryId === catId && (includeInactive || i.active !== false); });
  }
  function compute(draft) { return P.computeTicket(draft || S.draft, S.catalog, S.settings.taxRate); }

  function priceLabel(item) {
    if (P.isTiered(item)) return money(P.toCents(item.price)) + ' <small>first · ' + money(P.toCents(item.addlPrice)) + ' each add’l</small>';
    var sizes = (item.sizes || []).filter(function (s) { return s.price !== '' && s.price !== null && s.price !== undefined; });
    if (sizes.length) {
      var all = sizes.map(function (s) { return P.toCents(s.price); }).concat([P.toCents(item.price)]);
      var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
      if (lo !== hi) return money(lo) + ' – ' + money(hi);
    }
    return money(P.toCents(item.price));
  }

  // ---------------------------------------------------------------- icons
  var ICON = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    chev: '<svg class="chev" viewBox="0 0 8 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m1.5 1.5 5 5-5 5"/></svg>',
    link: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 1v5a2 2 0 0 0 2 2h6"/><path d="m8 6 2 2-2 2"/></svg>',
    print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>'
  };

  // ---------------------------------------------------------------- toast
  var toastTimer;
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  // ---------------------------------------------------------------- navigation
  function go(view) {
    S.view = view;
    document.querySelectorAll('#nav button').forEach(function (b) { b.classList.toggle('active', b.dataset.view === view); });
    ['ticket', 'catalog', 'settings'].forEach(function (v) {
      document.getElementById('view-' + v).classList.toggle('hidden', v !== view);
    });
    render();
  }

  function render() {
    if (S.view === 'ticket') renderTicketView();
    else if (S.view === 'catalog') renderCatalog();
    else if (S.view === 'settings') renderSettings();
    renderMeta();
  }

  function renderMeta() {
    var status;
    if (Remote.saving) status = '<span class="dot busy"></span>Saving…';
    else if (Remote.mode === 'online') status = '<span class="dot ok"></span>' + (Remote.storage === 'local' ? 'Saved on this computer' : 'Catalog synced') + (Remote.updatedAt ? '<br>Updated ' + esc(fmtDateTime(Remote.updatedAt)) : '');
    else if (Remote.mode === 'loading') status = '<span class="dot busy"></span>Loading catalog…';
    else if (Remote.mode === 'unconfigured') status = '<span class="dot bad"></span>Storage not connected — using built-in prices';
    else status = '<span class="dot bad"></span>Offline — using built-in prices';
    document.getElementById('sideMeta').innerHTML = status + '<br>Sales tax ' + esc(S.settings.taxRate) + '%' +
      (App.info ? ' · v' + esc(App.info.version) : '') +
      (Remote.pin ? ' · <a href="#" data-action="lock">Lock editing</a>' : '');
  }

  function lockBar(what) {
    if (!canEdit()) {
      return '<div class="notice bad">' + (Remote.mode === 'unconfigured'
        ? 'Storage is not connected to this Vercel project, so ' + what + ' cannot be saved. See the README (“Deploying to Vercel”).'
        : Remote.mode === 'loading' ? 'Loading…'
        : 'Can’t reach the server, so ' + what + ' can’t be edited right now. Showing the built-in defaults.') + '</div>';
    }
    if (Remote.pin) return '';
    if (Remote.pinStatus === 'setup') {
      return '<div class="notice"><span>Create an admin PIN to start editing. After that, ' + what + ' require the PIN.</span>' +
        '<button class="btn primary" data-action="unlock">Create PIN</button></div>';
    }
    return '<div class="notice"><span>' + what.charAt(0).toUpperCase() + what.slice(1) + ' are locked. Changes require the admin PIN.</span>' +
      '<button class="btn primary" data-action="unlock">Unlock</button></div>';
  }

  // ================================================================ TICKET VIEW
  function renderTicketView() {
    var cats = S.catalog.categories;
    if (!S.posCat || !catById(S.posCat)) S.posCat = cats.length ? cats[0].id : null;
    var d = S.draft;
    var el = document.getElementById('view-ticket');
    el.innerHTML =
      updateBanner() +
      '<div class="pos">' +
        '<div class="picker">' +
          '<div class="title-row">' +
            '<div><div class="large-title">Club Repair</div><p class="subtitle" style="margin:0">Tap a product or service to add it to the ticket.</p></div>' +
            '<label class="search">' + ICON.search + '<input id="posSearch" placeholder="Search all items" value="' + esc(S.search) + '"></label>' +
          '</div>' +
          '<div class="chips" id="posChips"></div>' +
          '<div class="grid" id="itemGrid"></div>' +
        '</div>' +
        '<div class="ticket">' +
          '<div class="ticket-head"><h2>Ticket</h2><span class="num">' + esc(fmtDate(new Date().toISOString())) + '</span></div>' +
          '<div class="ticket-body">' +
            '<div class="group-title">Customer</div>' +
            '<div class="group">' +
              '<div class="row"><label for="cName">Name</label><input id="cName" data-bind="draft:customer.name" placeholder="Customer name" value="' + esc(d.customer.name) + '"></div>' +
              '<div class="row"><label for="cPhone">Phone</label><input id="cPhone" type="tel" data-bind="draft:customer.phone" placeholder="702-555-0100" value="' + esc(d.customer.phone) + '"></div>' +
              '<div class="row"><label for="cEmail">Email</label><input id="cEmail" type="email" data-bind="draft:customer.email" placeholder="Optional" value="' + esc(d.customer.email) + '"></div>' +
            '</div>' +
            '<div class="group-title">Items</div>' +
            '<div class="group" id="lines"></div>' +
            '<div class="group-title">Notes</div>' +
            '<div class="group"><textarea class="notes" data-bind="draft:notes" placeholder="Club details, lengths, special instructions…">' + esc(d.notes) + '</textarea></div>' +
          '</div>' +
          '<div class="totals" id="totals"></div>' +
          '<div class="ticket-actions">' +
            '<button class="btn" data-action="new-ticket">Clear</button>' +
            '<button class="btn primary" data-action="print-ticket">' + ICON.print + 'Print</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    renderChips();
    renderGrid();
    renderLines();
  }

  function renderChips() {
    var html = S.catalog.categories.map(function (c) {
      return '<button class="chip' + (!S.search && c.id === S.posCat ? ' active' : '') + '" data-action="pos-cat" data-id="' + esc(c.id) + '">' + esc(c.name) + '</button>';
    }).join('');
    document.getElementById('posChips').innerHTML = html;
  }

  function renderGrid() {
    var q = S.search.trim().toLowerCase();
    var items = q
      ? S.catalog.items.filter(function (i) { return i.active !== false && i.name.toLowerCase().indexOf(q) !== -1; })
      : itemsIn(S.posCat);
    var html = items.map(function (it) {
      var cat = catById(it.categoryId);
      var tags = [];
      if (cat && cat.type === 'labor') tags.push('<span class="badge">Labor</span>');
      else if (it.taxable) tags.push('<span class="badge accent">Taxable</span>');
      if (it.sizes && it.sizes.length) tags.push('<span class="badge">' + it.sizes.length + ' sizes</span>');
      if (it.links && it.links.some(function (l) { return l.auto; })) tags.push('<span class="badge green">+ labor</span>');
      if (q && cat) tags.push('<span class="badge">' + esc(cat.name) + '</span>');
      return '<button class="tile" data-action="add-item" data-id="' + esc(it.id) + '">' +
        '<span class="name">' + esc(it.name) + '</span>' +
        '<span class="tags">' + tags.join('') + '</span>' +
        '<span class="price">' + priceLabel(it) + '</span>' +
      '</button>';
    }).join('');
    html += '<button class="tile custom" data-action="custom-item">' + ICON.plus.replace('<svg', '<svg width="22" height="22"') + 'Custom Item</button>';
    if (!items.length && q) html = '<div class="empty" style="grid-column:1/-1">No items match “' + esc(S.search) + '”.</div>' + html;
    document.getElementById('itemGrid').innerHTML = html;
  }

  function renderLines() {
    var c = compute();
    var byLine = {};
    c.rows.forEach(function (r) {
      var key = r.parentUid || r.lineUid;
      (byLine[key] = byLine[key] || []).push(r);
    });
    var linesEl = document.getElementById('lines');
    if (!S.draft.lines.length) {
      linesEl.innerHTML = '<div class="empty" style="padding:22px 12px">No items yet.</div>';
    } else {
      linesEl.innerHTML = S.draft.lines.map(function (line) {
        var rows = byLine[line.uid] || [];
        var main = rows[0];
        var item = line.itemId ? itemById(line.itemId) : null;
        var sub = rowDetail(main);
        if (line.size) sub = esc(line.size) + ' · ' + sub;
        if (main.overridden) sub += ' · <span style="color:var(--accent-text)">price override</span>';
        if (line.note) sub += '<br>' + esc(line.note);
        var linkedHtml = '';
        if (item && item.links) {
          linkedHtml = item.links.map(function (link) {
            var li = itemById(link.itemId);
            if (!li || li.active === false) return '';
            var on = isLinkOn(line, link);
            var r = rows.find(function (x) { return x.itemId === li.id && x.isLinked; });
            return '<div class="linked' + (on ? '' : ' off') + '">' + ICON.link +
              '<span class="nm2">' + esc(li.name) + (on && r ? ' <span style="opacity:.8">(' + rowDetail(r) + ')</span>' : '') + '</span>' +
              (on && r ? '<span class="amt">' + money(r.total) + '</span>' : '') +
              '<button data-action="toggle-link" data-line="' + esc(line.uid) + '" data-id="' + esc(li.id) + '">' + (on ? 'Remove' : 'Add') + '</button>' +
            '</div>';
          }).join('');
        }
        return '<div class="line">' +
          '<div class="line-main">' +
            '<div class="info" data-action="edit-line" data-id="' + esc(line.uid) + '"><div class="nm">' + esc(main.name) + '</div><div class="sub">' + sub + '</div></div>' +
            '<div class="stepper"><button data-action="qty" data-id="' + esc(line.uid) + '" data-d="-1" aria-label="Decrease">−</button><span class="val">' + line.qty + '</span><button data-action="qty" data-id="' + esc(line.uid) + '" data-d="1" aria-label="Increase">+</button></div>' +
            '<div class="amt">' + money(main.total) + '</div>' +
          '</div>' + linkedHtml +
        '</div>';
      }).join('');
    }
    document.getElementById('totals').innerHTML =
      '<div class="t"><span>Parts</span><span>' + money(c.partsTotal) + '</span></div>' +
      '<div class="t"><span>Labor</span><span>' + money(c.laborTotal) + '</span></div>' +
      '<div class="t"><span>Sales tax (' + c.taxRate + '% on ' + money(c.taxableSubtotal) + ')</span><span>' + money(c.tax) + '</span></div>' +
      '<div class="t grand"><span>Total</span><span>' + money(c.total) + '</span></div>';
  }

  function rowDetail(r) {
    if (!r) return '';
    return r.parts.map(function (p) { return p.qty + ' × ' + money(p.unit); }).join(' + ') || '0 × ' + money(0);
  }

  function isLinkOn(line, link) {
    return line.links && Object.prototype.hasOwnProperty.call(line.links, link.itemId) ? !!line.links[link.itemId] : !!link.auto;
  }

  function draftChanged() {
    if (S.view === 'ticket') renderLines();
  }

  function addItem(item, size) {
    var existing = S.draft.lines.find(function (l) {
      return l.itemId === item.id && (l.size || '') === (size || '') &&
        (l.priceOverride === undefined || l.priceOverride === '' || l.priceOverride === null) && !l.note &&
        (!l.links || !Object.keys(l.links).length);
    });
    if (existing) existing.qty += 1;
    else S.draft.lines.push({ uid: uid('l'), itemId: item.id, qty: 1, size: size || '', links: {} });
    draftChanged();
    toast('Added ' + item.name + (size ? ' (' + size + ')' : ''));
  }

  // ---------------- sheets
  function openSheet(opts) {
    closeSheet();
    var root = document.getElementById('sheet-root');
    root.innerHTML =
      '<div class="backdrop" data-action="sheet-backdrop">' +
        '<div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(opts.title) + '">' +
          '<div class="sheet-head">' +
            '<div class="l">' + (opts.cancel === false ? '' : '<button class="btn plain" data-action="sheet-cancel">Cancel</button>') + '</div>' +
            '<h3>' + esc(opts.title) + '</h3>' +
            '<div class="r">' + (opts.done ? '<button class="btn plain" data-action="sheet-done" style="font-weight:700">' + esc(opts.done) + '</button>' : '') + '</div>' +
          '</div>' +
          '<div class="sheet-body" id="sheetBody"></div>' +
        '</div>' +
      '</div>';
    sheet = { el: root.firstChild, edit: opts.edit, onDone: opts.onDone, renderBody: opts.renderBody };
    refreshSheet();
    var first = root.querySelector('input[autofocus]');
    if (first) setTimeout(function () { first.focus(); first.select && first.select(); }, 50);
  }
  function refreshSheet() {
    if (!sheet) return;
    document.getElementById('sheetBody').innerHTML = sheet.renderBody(sheet.edit);
  }
  function closeSheet() {
    document.getElementById('sheet-root').innerHTML = '';
    sheet = null;
  }

  function openSizeSheet(item) {
    openSheet({
      title: item.name,
      edit: {},
      renderBody: function () {
        return '<div class="group-title">Choose size</div><div class="size-pills">' +
          item.sizes.map(function (s) {
            var p = s.price === '' || s.price === null || s.price === undefined ? item.price : s.price;
            return '<button data-action="pick-size" data-id="' + esc(item.id) + '" data-size="' + esc(s.name) + '">' + esc(s.name) + '<small>' + money(P.toCents(p)) + '</small></button>';
          }).join('') + '</div>';
      }
    });
  }

  function openLineSheet(lineUid) {
    var line = S.draft.lines.find(function (l) { return l.uid === lineUid; });
    if (!line) return;
    var item = line.itemId ? itemById(line.itemId) : null;
    var edit = clone(line);
    edit.links = edit.links || {};
    if (item) (item.links || []).forEach(function (lk) { if (!(lk.itemId in edit.links)) edit.links[lk.itemId] = !!lk.auto; });
    openSheet({
      title: item ? item.name : (line.name || 'Custom Item'),
      done: 'Done',
      edit: edit,
      onDone: function (e) {
        e.qty = Math.max(1, Math.floor(num(e.qty)) || 1);
        e.priceOverride = blankOrNum(e.priceOverride);
        if (!item) e.price = num(e.price);
        Object.assign(line, e);
        draftChanged();
      },
      renderBody: function (e) {
        var base = item ? P.basePriceCents(item, e.size) : P.toCents(e.price);
        var h = '';
        if (!item) {
          h += '<div class="group-title">Item</div><div class="group">' +
            '<div class="row"><label>Description</label><input data-bind="edit:name" value="' + esc(e.name) + '"></div>' +
            '<div class="row"><label>Unit price</label><input type="number" step="0.01" data-bind="edit:price" value="' + esc(e.price) + '"></div>' +
            '<div class="row"><span class="lbl">Taxable part</span><span class="end"><label class="switch"><input type="checkbox" data-bind="edit:taxable" data-type="bool"' + (e.taxable ? ' checked' : '') + '><span></span></label></span></div>' +
          '</div>';
        }
        h += '<div class="group-title">Quantity</div><div class="group">' +
          '<div class="row"><label>Qty</label><input type="number" min="1" step="1" data-bind="edit:qty" value="' + esc(e.qty) + '"></div>' +
        '</div>';
        if (item && item.sizes && item.sizes.length) {
          h += '<div class="group-title">Size</div><div class="size-pills" style="padding-top:0">' +
            item.sizes.map(function (s) {
              return '<button class="' + (e.size === s.name ? 'active' : '') + '" data-action="line-size" data-size="' + esc(s.name) + '">' + esc(s.name) +
                '<small>' + money(P.basePriceCents(item, s.name)) + '</small></button>';
            }).join('') + '</div>';
        }
        if (item) {
          h += '<div class="group-title">Price</div><div class="group">' +
            '<div class="row"><label>Override</label><div class="inline-inputs" style="justify-content:flex-end">' +
            '<input type="number" step="0.01" data-bind="edit:priceOverride" placeholder="' + (P.isTiered(item) ? 'Tiered' : money(base)) + '" value="' + esc(e.priceOverride === undefined ? '' : e.priceOverride) + '" style="max-width:130px">' +
            '<button class="btn" data-action="line-free">Free</button></div></div>' +
          '</div><div class="group-foot">Leave blank to use the catalog price' + (P.isTiered(item) ? ' (' + money(P.toCents(item.price)) + ' first, ' + money(P.toCents(item.addlPrice)) + ' each additional)' : '') + '.</div>';
          if (item.links && item.links.length) {
            h += '<div class="group-title">Included with this item</div><div class="group">' +
              item.links.map(function (lk) {
                var li = itemById(lk.itemId);
                if (!li) return '';
                return '<div class="row"><span class="grow">' + esc(li.name) + ' <span class="muted small">' + priceLabel(li).replace(/<[^>]+>/g, '') + '</span></span>' +
                  '<label class="switch"><input type="checkbox" data-bind="edit:links.' + esc(li.id) + '" data-type="bool"' + (e.links[li.id] ? ' checked' : '') + '><span></span></label></div>';
              }).join('') + '</div>';
          }
        }
        h += '<div class="group-title">Line note</div><div class="group"><div class="row"><input data-bind="edit:note" placeholder="e.g. Driver, +1/2 in, 2 extra wraps" value="' + esc(e.note) + '" style="text-align:left"></div></div>';
        h += '<div style="margin-top:22px"><button class="btn danger lg" style="width:100%" data-action="remove-line" data-id="' + esc(line.uid) + '">Remove from Ticket</button></div>';
        return h;
      }
    });
  }

  function openCustomSheet() {
    openSheet({
      title: 'Custom Item',
      done: 'Add',
      edit: { name: '', price: '', qty: 1, taxable: true },
      onDone: function (e) {
        if (!e.name.trim()) { toast('Enter a description'); return false; }
        S.draft.lines.push({ uid: uid('l'), itemId: null, name: e.name.trim(), price: num(e.price), qty: Math.max(1, Math.floor(num(e.qty)) || 1), taxable: !!e.taxable, isLabor: !e.taxable, links: {} });
        draftChanged();
      },
      renderBody: function (e) {
        return '<div class="group-title">One-off item (not saved to catalog)</div><div class="group">' +
          '<div class="row"><label>Description</label><input autofocus data-bind="edit:name" placeholder="e.g. Ferrule replacement" value="' + esc(e.name) + '"></div>' +
          '<div class="row"><label>Unit price</label><input type="number" step="0.01" data-bind="edit:price" placeholder="0.00" value="' + esc(e.price) + '"></div>' +
          '<div class="row"><label>Qty</label><input type="number" min="1" data-bind="edit:qty" value="' + esc(e.qty) + '"></div>' +
          '<div class="row"><span class="lbl">Taxable part</span><span class="end"><label class="switch"><input type="checkbox" data-bind="edit:taxable" data-type="bool"' + (e.taxable ? ' checked' : '') + '><span></span></label></span></div>' +
        '</div><div class="group-foot">Turn off “Taxable part” for labor/service charges — Nevada does not tax separately stated repair labor.</div>';
      }
    });
  }

  // ---------------- save / print
  function hasContent(d) {
    return d.lines.length || d.customer.name || d.customer.phone || d.customer.email || d.notes;
  }

  // Ticket numbers come from the date and time, since tickets are not stored.
  function ticketNumber(date) {
    function p(n) { return String(n).padStart(2, '0'); }
    return String(date.getFullYear()).slice(2) + p(date.getMonth() + 1) + p(date.getDate()) + '-' +
      p(date.getHours()) + p(date.getMinutes()) + p(date.getSeconds());
  }

  function printTicket() {
    var d = S.draft;
    if (!d.lines.length) { toast('Add at least one item first'); return; }
    var now = new Date();
    var t = { number: ticketNumber(now), createdAt: now.toISOString(), customer: d.customer, notes: d.notes };
    document.getElementById('print-area').innerHTML = invoiceHTML(t, compute(), S.settings.footer);
    var img = document.querySelector('#print-area img');
    var done = false;
    function go() { if (done) return; done = true; window.print(); }
    if (img && !img.complete) { img.onload = go; img.onerror = go; setTimeout(go, 800); } else go();
  }

  function invoiceHTML(t, c, footer) {
    var rows = c.rows.map(function (r) {
      var unit = r.parts.length === 1 ? money(r.parts[0].unit) : r.parts.map(function (p) { return money(p.unit); }).join(' / ');
      var det = [];
      if (r.size) det.push(esc(r.size));
      if (r.parts.length > 1) det.push(rowDetail(r));
      if (r.note) det.push(esc(r.note));
      return '<tr class="' + (r.isLinked ? 'linked-row' : '') + '">' +
        '<td>' + (r.isLinked ? '↳ ' : '') + esc(r.name) + (r.taxable ? '<span class="tax-mark">T</span>' : '') +
          (det.length ? '<div class="det">' + det.join(' · ') + '</div>' : '') + '</td>' +
        '<td>' + (r.isLabor ? 'Labor' : 'Part') + '</td>' +
        '<td class="num">' + r.qty + '</td>' +
        '<td class="num">' + unit + '</td>' +
        '<td class="num">' + money(r.total) + '</td>' +
      '</tr>';
    }).join('');
    var cust = t.customer || {};
    return '<div class="invoice">' +
      '<img class="logo" src="logo.jpg" alt="RoboGolfPro Las Vegas — 8790 S Maryland Pkwy, Las Vegas, NV 89123 — 702-715-9651">' +
      '<div class="inv-head">' +
        '<div class="bill-to"><div class="lbl">Invoice for</div><div class="nm">' + esc(cust.name || '—') + '</div>' +
          (cust.phone ? '<div>' + esc(cust.phone) + '</div>' : '') + (cust.email ? '<div>' + esc(cust.email) + '</div>' : '') + '</div>' +
        '<div><h1>INVOICE</h1><dl class="kv"><dt>Invoice #</dt><dd>' + esc(t.number || '—') + '</dd><dt>Date</dt><dd>' + esc(fmtDate(t.createdAt || new Date().toISOString())) + '</dd></dl></div>' +
      '</div>' +
      '<table><thead><tr><th>Description</th><th>Type</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="bottom">' +
        '<div class="notes-box"><div class="lbl">Notes</div>' + esc(t.notes || '') + '</div>' +
        '<div class="sum">' +
          '<div class="muted"><span>Parts</span><span>' + money(c.partsTotal) + '</span></div>' +
          '<div class="muted"><span>Labor (not taxed)</span><span>' + money(c.laborTotal) + '</span></div>' +
          '<div><span>Subtotal</span><span>' + money(c.subtotal) + '</span></div>' +
          '<div><span>NV sales tax ' + c.taxRate + '% <span class="muted">on ' + money(c.taxableSubtotal) + '</span></span><span>' + money(c.tax) + '</span></div>' +
          '<div class="grand"><span>Total</span><span>' + money(c.total) + '</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="sig"><div>Customer signature</div><div style="flex:.5">Date</div></div>' +
      '<div class="foot"><span class="tax-mark" style="margin:0">T</span> = taxable item. ' + esc(footer || '') + '</div>' +
    '</div>';
  }

  // ================================================================ CATALOG
  function renderCatalog() {
    var cats = S.catalog.categories;
    if (!S.catalogCat || !catById(S.catalogCat)) S.catalogCat = cats.length ? cats[0].id : null;
    var cat = catById(S.catalogCat);
    var items = cat ? itemsIn(cat.id, true) : [];
    var el = document.getElementById('view-catalog');
    el.innerHTML =
      '<div class="title-row"><div><div class="large-title">Catalog</div><p class="subtitle" style="margin:0">Add grips, sizes, shafts and labor. ' + (Remote.storage === 'local' ? 'Saved on this computer.' : 'Saved online and shared by every device.') + '</p></div>' +
      '<div class="actions"><button class="btn" data-action="export-catalog">Export</button><button class="btn" data-action="import-catalog">Import</button><button class="btn danger" data-action="reset-catalog">Reset to Defaults</button></div></div>' +
      lockBar('catalog changes') +
      '<div class="split">' +
        '<div>' +
          '<div class="group-title">Categories</div>' +
          '<div class="group">' + cats.map(function (c) {
            return '<div class="row tap' + (c.id === S.catalogCat ? ' active' : '') + '" data-action="catalog-cat" data-id="' + esc(c.id) + '">' +
              '<span class="grow">' + esc(c.name) + '</span><span class="end"><span class="badge">' + (c.type === 'labor' ? 'Labor' : 'Product') + '</span>' + itemsIn(c.id, true).length + '</span></div>';
          }).join('') +
          '<div class="row tap" data-action="add-category" style="color:var(--accent-text);font-weight:600">' + ICON.plus.replace('<svg', '<svg width="18" height="18"') + 'Add Category</div></div>' +
        '</div>' +
        '<div>' +
          (cat ?
            '<div class="group-title" style="display:flex;justify-content:space-between;align-items:center"><span>' + esc(cat.name) + '</span>' +
              '<button class="btn plain small" data-action="edit-category" data-id="' + esc(cat.id) + '" style="text-transform:none">Edit Category</button></div>' +
            '<div class="group">' + items.map(function (it) {
              var badges = [];
              if (it.active === false) badges.push('<span class="badge">Hidden</span>');
              if (it.taxable) badges.push('<span class="badge accent">Taxable</span>');
              if (P.isTiered(it)) badges.push('<span class="badge">Tiered</span>');
              if (it.sizes && it.sizes.length) badges.push('<span class="badge">' + it.sizes.map(function (s) { return esc(s.name); }).join(', ') + '</span>');
              (it.links || []).forEach(function (lk) {
                var li = itemById(lk.itemId);
                if (li) badges.push('<span class="badge green">' + (lk.auto ? '+ ' : 'opt. ') + esc(li.name) + '</span>');
              });
              return '<div class="row tap item-row" data-action="edit-item" data-id="' + esc(it.id) + '">' +
                '<span class="grow"><span' + (it.active === false ? ' class="muted"' : '') + '>' + esc(it.name) + '</span><br><span style="display:inline-flex;gap:4px;flex-wrap:wrap;margin-top:3px">' + badges.join('') + '</span></span>' +
                '<span class="end"><span class="price">' + priceLabel(it).replace(/<[^>]+>/g, '') + '</span>' + ICON.chev + '</span></div>';
            }).join('') +
            '<div class="row tap" data-action="add-item-catalog" style="color:var(--accent-text);font-weight:600">' + ICON.plus.replace('<svg', '<svg width="18" height="18"') + 'Add Item to ' + esc(cat.name) + '</div></div>'
          : '<div class="empty">Create a category to get started.</div>') +
        '</div>' +
      '</div>';
  }

  function openItemEditor(id) {
    var existing = id ? itemById(id) : null;
    var cat = catById(S.catalogCat);
    var edit = existing ? clone(existing) : {
      id: null, categoryId: S.catalogCat, name: '', price: '', addlPrice: '', taxable: cat ? cat.type === 'product' : true,
      active: true, sizes: [], links: []
    };
    edit.sizes = edit.sizes || [];
    edit.links = edit.links || [];
    if (edit.addlPrice === undefined || edit.addlPrice === null) edit.addlPrice = '';
    if (edit.active === undefined) edit.active = true;
    edit._tiered = edit.addlPrice !== '';

    openSheet({
      title: existing ? 'Edit Item' : 'New Item',
      done: 'Save',
      edit: edit,
      onDone: function (e) {
        if (!e.name.trim()) { toast('Name is required'); return false; }
        var out = {
          id: e.id || (slug(e.name) || 'item') + '-' + Math.random().toString(36).slice(2, 6),
          categoryId: e.categoryId,
          name: e.name.trim(),
          price: num(e.price),
          taxable: !!e.taxable,
          active: e.active !== false,
          sizes: e.sizes.filter(function (s) { return s.name.trim(); }).map(function (s) { return { name: s.name.trim(), price: blankOrNum(s.price) }; }),
          links: e.links.filter(function (l) { return l.itemId && itemById(l.itemId); }).map(function (l) { return { itemId: l.itemId, auto: !!l.auto }; })
        };
        if (e._tiered && e.addlPrice !== '') out.addlPrice = num(e.addlPrice);
        if (existing) Object.keys(existing).forEach(function (k) { delete existing[k]; });
        if (existing) Object.assign(existing, out); else S.catalog.items.push(out);
        S.catalogCat = out.categoryId;
        persist('Saved ' + out.name);
      },
      renderBody: function (e) {
        var catOptions = S.catalog.categories.map(function (c) {
          return '<option value="' + esc(c.id) + '"' + (c.id === e.categoryId ? ' selected' : '') + '>' + esc(c.name) + '</option>';
        }).join('');
        var linkable = S.catalog.items.filter(function (i) { return i.id !== e.id; });
        var h = '<div class="group-title">Details</div><div class="group">' +
          '<div class="row"><label>Name</label><input autofocus data-bind="edit:name" placeholder="e.g. Golf Pride MCC Plus4" value="' + esc(e.name) + '"></div>' +
          '<div class="row"><label>Category</label><select data-bind="edit:categoryId">' + catOptions + '</select></div>' +
          '<div class="row"><label>Price</label><input type="number" step="0.01" data-bind="edit:price" placeholder="0.00" value="' + esc(e.price) + '"></div>' +
          '<div class="row"><span class="lbl">Taxable (part)</span><span class="end"><label class="switch"><input type="checkbox" data-bind="edit:taxable" data-type="bool"' + (e.taxable ? ' checked' : '') + '><span></span></label></span></div>' +
          '<div class="row"><span class="lbl">Show in POS</span><span class="end"><label class="switch"><input type="checkbox" data-bind="edit:active" data-type="bool"' + (e.active !== false ? ' checked' : '') + '><span></span></label></span></div>' +
        '</div><div class="group-foot">Nevada: turn Taxable on for physical parts (grips, shafts). Leave it off for labor.</div>';

        h += '<div class="group-title">Multi-unit pricing</div><div class="group">' +
          '<div class="row"><span class="lbl grow" style="width:auto">Different price after the first</span><label class="switch"><input type="checkbox" data-bind="edit:_tiered" data-type="bool" data-rerender="1"' + (e._tiered ? ' checked' : '') + '><span></span></label></div>' +
          (e._tiered ? '<div class="row"><label>Each additional</label><input type="number" step="0.01" data-bind="edit:addlPrice" placeholder="15.00" value="' + esc(e.addlPrice) + '"></div>' : '') +
        '</div><div class="group-foot">Example: Shaft Installation is $30 for the first shaft on a ticket and $15 for each additional.</div>';

        h += '<div class="group-title">Sizes</div><div class="group">' +
          e.sizes.map(function (s, i) {
            return '<div class="row"><div class="inline-inputs">' +
              '<input data-bind="edit:sizes.' + i + '.name" placeholder="Size name" value="' + esc(s.name) + '">' +
              '<input type="number" step="0.01" data-bind="edit:sizes.' + i + '.price" placeholder="Same price" value="' + esc(s.price) + '" style="max-width:130px">' +
              '</div><button class="x-btn" data-action="rm-size" data-i="' + i + '" aria-label="Remove size">⊖</button></div>';
          }).join('') +
          '<div class="row"><button class="btn plain" data-action="add-size">' + ICON.plus + 'Add Size</button>' +
          (e.sizes.length ? '' : '<button class="btn plain" data-action="std-sizes">Add Undersize / Standard / Midsize / Jumbo</button>') + '</div>' +
        '</div><div class="group-foot">Leave a size’s price blank to use the item price. Employees pick a size when adding the item.</div>';

        h += '<div class="group-title">Linked items</div><div class="group">' +
          e.links.map(function (l, i) {
            var opts = '<option value="">Choose…</option>' + S.catalog.categories.map(function (c) {
              var inCat = linkable.filter(function (x) { return x.categoryId === c.id; });
              if (!inCat.length) return '';
              return '<optgroup label="' + esc(c.name) + '">' + inCat.map(function (x) {
                return '<option value="' + esc(x.id) + '"' + (x.id === l.itemId ? ' selected' : '') + '>' + esc(x.name) + '</option>';
              }).join('') + '</optgroup>';
            }).join('');
            return '<div class="row"><select data-bind="edit:links.' + i + '.itemId" style="text-align:left;text-align-last:left">' + opts + '</select>' +
              '<span class="small muted">Auto</span><label class="switch"><input type="checkbox" data-bind="edit:links.' + i + '.auto" data-type="bool"' + (l.auto ? ' checked' : '') + '><span></span></label>' +
              '<button class="x-btn" data-action="rm-link" data-i="' + i + '" aria-label="Remove link">⊖</button></div>';
          }).join('') +
          '<div class="row"><button class="btn plain" data-action="add-link">' + ICON.plus + 'Add Linked Item</button></div>' +
        '</div><div class="group-foot">Linked items are added with the same quantity when this item is rung up (e.g. a grip adds Grip Installation). “Auto” on = included by default; off = offered as a one-tap option.</div>';

        if (existing) h += '<div style="margin-top:22px"><button class="btn danger lg" style="width:100%" data-action="delete-item" data-id="' + esc(existing.id) + '">Delete Item</button></div>';
        return h;
      }
    });
  }

  function openCategoryEditor(id) {
    var existing = id ? catById(id) : null;
    openSheet({
      title: existing ? 'Edit Category' : 'New Category',
      done: 'Save',
      edit: existing ? clone(existing) : { id: null, name: '', type: 'product' },
      onDone: function (e) {
        if (!e.name.trim()) { toast('Name is required'); return false; }
        if (existing) { existing.name = e.name.trim(); existing.type = e.type; }
        else {
          var c = { id: (slug(e.name) || 'cat') + '-' + Math.random().toString(36).slice(2, 6), name: e.name.trim(), type: e.type };
          S.catalog.categories.push(c);
          S.catalogCat = c.id;
        }
        persist('Saved ' + e.name.trim());
      },
      renderBody: function (e) {
        var h = '<div class="group-title">Category</div><div class="group">' +
          '<div class="row"><label>Name</label><input autofocus data-bind="edit:name" placeholder="e.g. Grip Tape" value="' + esc(e.name) + '"></div>' +
          '<div class="row"><label>Type</label><select data-bind="edit:type">' +
            '<option value="product"' + (e.type === 'product' ? ' selected' : '') + '>Product (parts)</option>' +
            '<option value="labor"' + (e.type === 'labor' ? ' selected' : '') + '>Labor / service</option></select></div>' +
        '</div><div class="group-foot">Type controls whether items print as “Part” or “Labor” on the invoice.</div>';
        if (existing) {
          var i = existing.id;
          var up = S.catalog.categories.findIndex(function (c) { return c.id === i; });
          h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:20px">' +
            '<button class="btn lg" data-action="move-cat" data-id="' + esc(i) + '" data-d="-1"' + (up === 0 ? ' disabled' : '') + '>Move Up</button>' +
            '<button class="btn lg" data-action="move-cat" data-id="' + esc(i) + '" data-d="1"' + (up === S.catalog.categories.length - 1 ? ' disabled' : '') + '>Move Down</button></div>' +
            '<button class="btn danger lg" style="width:100%;margin-top:8px" data-action="delete-category" data-id="' + esc(i) + '">Delete Category</button>';
        }
        return h;
      }
    });
  }

  // ================================================================ SETTINGS
  var settingsEdit = null; // working copy until "Save Settings"

  function renderSettings() {
    if (!settingsEdit) settingsEdit = clone(S.settings);
    var s = settingsEdit;
    var locked = !Remote.pin || !canEdit();
    var dis = locked ? ' disabled' : '';
    document.getElementById('view-settings').innerHTML =
      '<div class="large-title">Settings</div><p class="subtitle">' + (Remote.storage === 'local' ? 'Saved on this computer with the catalog.' : 'Saved online with the catalog and shared by every device.') + ' Tickets are never stored.</p>' +
      '<div style="max-width:640px">' + lockBar('settings') +
      '<div class="group-title">Sales tax</div><div class="group">' +
        '<div class="row"><label>Tax rate (%)</label><input type="number" step="0.001" min="0" max="25" data-bind="settings:taxRate" data-type="number" value="' + esc(s.taxRate) + '"' + dis + '></div>' +
      '</div><div class="group-foot">Clark County, NV combined rate is 8.375% (4.6% state + 3.775% local). Tax is applied only to items marked Taxable (parts); separately stated repair and installation labor is not taxable in Nevada.</div>' +
      '<div class="group-title">Printed invoice</div><div class="group">' +
        '<div class="row"><label>Footer message</label><input data-bind="settings:footer" value="' + esc(s.footer) + '"' + dis + '></div>' +
      '</div>' +
      (locked ? '' : '<div style="margin-top:14px;display:flex;gap:8px"><button class="btn primary lg" data-action="save-settings">Save Settings</button><button class="btn lg" data-action="revert-settings">Revert</button></div>') +
      aboutSection() +
      '<div class="group-title">Backup</div><div class="group">' +
        '<div class="row tap" data-action="export-all"><span class="grow">Download backup</span><span class="end small">Catalog & settings' + ICON.chev + '</span></div>' +
        '<div class="row tap" data-action="import-all"><span class="grow">Restore from backup…</span>' + ICON.chev + '</div>' +
      '</div><div class="group-foot">' + (Remote.storage === 'local' && Remote.location
        ? 'The catalog is saved in <b>' + esc(Remote.location) + '</b> (catalog.json, plus catalog.json.bak with the previous version). Copy that folder to a USB drive or cloud folder to back it up.'
        : 'The catalog is stored online. A downloaded backup lets you restore it if something is deleted by mistake.') + '</div>' +
      '</div>';
  }

  function aboutSection() {
    var i = App.info;
    if (!i) return '';
    var status;
    if (!i.updatesEnabled) status = 'Automatic updates are only available in the Windows app.';
    else if (i.error) status = esc(i.error);
    else if (i.available) status = 'Version ' + esc(i.latest.version) + ' is available.';
    else status = 'Up to date' + (i.checkedAt ? ' (checked ' + esc(fmtDateTime(i.checkedAt)) + ')' : '') + '.';
    return '<div class="group-title">App version</div><div class="group">' +
      '<div class="row"><span class="grow">RoboGolf POS ' + esc(i.version) + '<br><span class="muted small">' + status + '</span></span>' +
      (i.available ? '<button class="btn primary" data-action="install-update">Install Update</button>'
        : i.updatesEnabled ? '<button class="btn" data-action="check-update">Check for Updates</button>' : '') +
      '</div></div><div class="group-foot">The app checks for new versions when it starts and every few hours. Updating never changes your catalog, settings or PIN.</div>';
  }

  // ---------------------------------------------------------------- files
  function download(filename, data) {
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function stamp() { return new Date().toISOString().slice(0, 10); }
  function pickFile(cb) {
    var input = document.getElementById('fileInput');
    input.value = '';
    input.onchange = function () {
      var f = input.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try { cb(JSON.parse(r.result)); } catch (e) { toast('That file is not valid JSON'); }
      };
      r.readAsText(f);
    };
    input.click();
  }
  function validCatalog(c) { return c && Array.isArray(c.categories) && Array.isArray(c.items); }

  // ---------------------------------------------------------------- data binding
  function setPath(obj, path, value) {
    var parts = path.split('.');
    var o = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (o[parts[i]] === undefined) o[parts[i]] = {};
      o = o[parts[i]];
    }
    o[parts[parts.length - 1]] = value;
  }

  function onBind(el) {
    var spec = el.dataset.bind.split(':');
    var target = spec[0], path = spec[1];
    var v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.type === 'number') v = num(v);
    if (target === 'draft') { setPath(S.draft, path, v); }
    else if (target === 'edit' && sheet) {
      setPath(sheet.edit, path, v);
      if (el.dataset.rerender) refreshSheet();
    } else if (target === 'settings' && settingsEdit) {
      setPath(settingsEdit, path, v);
    }
  }

  document.addEventListener('input', function (ev) {
    var el = ev.target;
    if (el.dataset && el.dataset.bind && el.type !== 'checkbox' && el.tagName !== 'SELECT') onBind(el);
    if (el.id === 'posSearch') {
      S.search = el.value; renderChips(); renderGrid();
    }
  });
  document.addEventListener('change', function (ev) {
    var el = ev.target;
    if (el.dataset && el.dataset.bind && (el.type === 'checkbox' || el.tagName === 'SELECT')) onBind(el);
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && sheet) closeSheet();
    if (ev.key === 'Enter' && sheet && ev.target.tagName === 'INPUT' && ev.target.type !== 'checkbox') {
      var done = sheet.el.querySelector('[data-action="sheet-done"]');
      if (done) { ev.preventDefault(); done.click(); }
    }
  });

  // ---------------------------------------------------------------- actions
  var actions = {
    'pos-cat': function (el) { S.posCat = el.dataset.id; S.search = ''; renderTicketView(); },
    'add-item': function (el) {
      var item = itemById(el.dataset.id);
      if (!item) return;
      if (item.sizes && item.sizes.length) openSizeSheet(item); else addItem(item);
    },
    'pick-size': function (el) { closeSheet(); addItem(itemById(el.dataset.id), el.dataset.size); },
    'custom-item': function () { openCustomSheet(); },
    'qty': function (el) {
      var line = S.draft.lines.find(function (l) { return l.uid === el.dataset.id; });
      if (!line) return;
      line.qty += Number(el.dataset.d);
      if (line.qty < 1) S.draft.lines = S.draft.lines.filter(function (l) { return l !== line; });
      draftChanged();
    },
    'toggle-link': function (el) {
      var line = S.draft.lines.find(function (l) { return l.uid === el.dataset.line; });
      var item = itemById(line.itemId);
      var link = item.links.find(function (l) { return l.itemId === el.dataset.id; });
      line.links = line.links || {};
      line.links[link.itemId] = !isLinkOn(line, link);
      draftChanged();
    },
    'edit-line': function (el) { openLineSheet(el.dataset.id); },
    'line-size': function (el) { sheet.edit.size = el.dataset.size; refreshSheet(); },
    'line-free': function () { sheet.edit.priceOverride = 0; refreshSheet(); },
    'remove-line': function (el) {
      S.draft.lines = S.draft.lines.filter(function (l) { return l.uid !== el.dataset.id; });
      closeSheet(); draftChanged();
    },
    'new-ticket': function () {
      if (hasContent(S.draft) && !confirm('Clear this ticket and start a new one?')) return;
      S.draft = newDraft(); renderTicketView();
    },
    'print-ticket': function () { printTicket(); },

    'catalog-cat': function (el) { S.catalogCat = el.dataset.id; renderCatalog(); },
    'add-category': function () { requireUnlock(function () { openCategoryEditor(null); }); },
    'edit-category': function (el) { requireUnlock(function () { openCategoryEditor(el.dataset.id); }); },
    'move-cat': function (el) {
      var cats = S.catalog.categories;
      var i = cats.findIndex(function (c) { return c.id === el.dataset.id; });
      var j = i + Number(el.dataset.d);
      if (j < 0 || j >= cats.length) return;
      var tmp = cats[i]; cats[i] = cats[j]; cats[j] = tmp;
      closeSheet(); persist('Order saved');
    },
    'delete-category': function (el) {
      var id = el.dataset.id;
      var n = itemsIn(id, true).length;
      if (n) { toast('Move or delete its ' + n + ' item' + (n === 1 ? '' : 's') + ' first'); return; }
      if (!confirm('Delete this category?')) return;
      S.catalog.categories = S.catalog.categories.filter(function (c) { return c.id !== id; });
      closeSheet(); persist('Category deleted');
    },
    'add-item-catalog': function () { requireUnlock(function () { openItemEditor(null); }); },
    'edit-item': function (el) { requireUnlock(function () { openItemEditor(el.dataset.id); }); },
    'delete-item': function (el) {
      var id = el.dataset.id;
      var users = S.catalog.items.filter(function (i) { return (i.links || []).some(function (l) { return l.itemId === id; }); });
      var msg = 'Delete this item?' + (users.length ? '\n\nIt is linked from ' + users.length + ' other item(s); those links will be removed.' : '');
      if (!confirm(msg)) return;
      S.catalog.items = S.catalog.items.filter(function (i) { return i.id !== id; });
      users.forEach(function (u) { u.links = u.links.filter(function (l) { return l.itemId !== id; }); });
      closeSheet(); persist('Item deleted');
    },
    'add-size': function () { sheet.edit.sizes.push({ name: '', price: '' }); refreshSheet(); },
    'std-sizes': function () {
      ['Undersize', 'Standard', 'Midsize', 'Jumbo'].forEach(function (n) { sheet.edit.sizes.push({ name: n, price: '' }); });
      refreshSheet();
    },
    'rm-size': function (el) { sheet.edit.sizes.splice(Number(el.dataset.i), 1); refreshSheet(); },
    'add-link': function () { sheet.edit.links.push({ itemId: '', auto: true }); refreshSheet(); },
    'rm-link': function (el) { sheet.edit.links.splice(Number(el.dataset.i), 1); refreshSheet(); },
    'export-catalog': function () { download('robogolf-catalog-' + stamp() + '.json', S.catalog); },
    'import-catalog': function () {
      requireUnlock(function () {
        pickFile(function (data) {
          var c = data.catalog || data;
          if (!validCatalog(c)) { toast('That file does not contain a catalog'); return; }
          if (!confirm('Replace the online catalog with the imported one? Every device will see the change.')) return;
          S.catalog = c; persist('Catalog imported');
        });
      });
    },
    'reset-catalog': function () {
      requireUnlock(function () {
        if (!confirm('Reset the catalog to the original price list? Added items will be removed for every device. (Export first if unsure.)')) return;
        S.catalog = clone(window.DEFAULT_CATALOG); persist('Catalog reset');
      });
    },
    'export-all': function () {
      download('robogolf-backup-' + stamp() + '.json', { app: 'robogolf-repair-pos', version: 2, exportedAt: new Date().toISOString(), catalog: S.catalog, settings: S.settings });
    },
    'import-all': function () {
      requireUnlock(function () {
        pickFile(function (data) {
          if (!data || !validCatalog(data.catalog)) { toast('That file is not a backup'); return; }
          if (!confirm('Restore this backup? It replaces the online catalog and settings for every device.')) return;
          S.catalog = data.catalog;
          S.settings = Object.assign(clone(window.DEFAULT_SETTINGS), data.settings || {});
          settingsEdit = null;
          persist('Backup restored');
        });
      });
    },
    'save-settings': function () {
      var active = document.activeElement;
      if (active && active.dataset && active.dataset.bind) onBind(active);
      var rate = Number(settingsEdit.taxRate);
      if (!isFinite(rate) || rate < 0 || rate > 25) { toast('Tax rate must be between 0 and 25'); return; }
      S.settings = clone(settingsEdit);
      settingsEdit = null;
      persist('Settings saved');
    },
    'revert-settings': function () { settingsEdit = null; renderSettings(); },
    'install-update': function () { installUpdate(); },
    'check-update': function (el) {
      el.disabled = true; el.textContent = 'Checking…';
      api('POST', '/api/update/check').then(function (r) {
        if (r.status === 200) { App.info = r; toast(r.available ? 'Update available' : (r.error || 'You have the latest version')); }
        render();
      }).catch(function () { toast('Could not check for updates'); render(); });
    },
    'unlock': function () { requireUnlock(function () { settingsEdit = null; render(); }); },
    'lock': function (el, ev) { ev.preventDefault(); Remote.pin = null; settingsEdit = null; render(); toast('Editing locked'); },

    'sheet-cancel': function () { closeSheet(); },
    'sheet-backdrop': function (el, ev) { if (ev.target === el) closeSheet(); },
    'sheet-done': function () {
      if (!sheet) return;
      var active = document.activeElement;
      if (active && active.dataset && active.dataset.bind) onBind(active);
      if (sheet.onDone && sheet.onDone(sheet.edit) === false) return;
      closeSheet();
    }
  };


  document.addEventListener('click', function (ev) {
    var nav = ev.target.closest('#nav button');
    if (nav) { go(nav.dataset.view); return; }
    var el = ev.target.closest('[data-action]');
    if (!el) return;
    var fn = actions[el.dataset.action];
    if (fn) fn(el, ev);
  });

  // Keep the printed invoice light and complete even if printed with Ctrl+P.
  window.addEventListener('beforeprint', function () {
    if (!document.getElementById('print-area').innerHTML && S.draft.lines.length) {
      var now = new Date();
      var t = { number: ticketNumber(now), createdAt: now.toISOString(), customer: S.draft.customer, notes: S.draft.notes };
      document.getElementById('print-area').innerHTML = invoiceHTML(t, compute(), S.settings.footer);
    }
  });

  // Tickets are not saved, so warn before closing/reloading with one in progress.
  window.addEventListener('beforeunload', function (ev) {
    if (S.draft.lines.length) { ev.preventDefault(); ev.returnValue = ''; }
  });

  // Pick up catalog changes made on other devices when this window regains focus.
  var lastSync = 0;
  function refreshIfIdle() {
    if (document.hidden || sheet || Remote.saving || Remote.mode === 'offline' && location.protocol === 'file:') return;
    if (Date.now() - lastSync < 15000) return;
    lastSync = Date.now();
    loadRemote(true);
  }
  window.addEventListener('focus', refreshIfIdle);
  document.addEventListener('visibilitychange', refreshIfIdle);
  window.addEventListener('afterprint', function () { document.getElementById('print-area').innerHTML = ''; });

  // ---------------------------------------------------------------- boot
  render();
  lastSync = Date.now();
  loadRemote();
})();
