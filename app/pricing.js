/*
 * Pricing engine for the RoboGolfPro club repair POS.
 * Pure functions only (no DOM) so it can be unit-tested in Node.
 *
 * Money is computed in integer cents to avoid floating point drift.
 */
(function (root) {
  'use strict';

  function toCents(dollars) {
    var n = Number(dollars);
    return isFinite(n) ? Math.round(n * 100) : 0;
  }

  function fromCents(cents) {
    return cents / 100;
  }

  function formatMoney(cents) {
    var sign = cents < 0 ? '-' : '';
    var abs = Math.abs(cents);
    var dollars = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    var rem = String(abs % 100).padStart(2, '0');
    return sign + '$' + dollars + '.' + rem;
  }

  function indexCatalog(catalog) {
    var items = {};
    var cats = {};
    (catalog.items || []).forEach(function (it) { items[it.id] = it; });
    (catalog.categories || []).forEach(function (c) { cats[c.id] = c; });
    return { items: items, cats: cats };
  }

  // Base unit price (in cents) of a catalog item, honouring a chosen size.
  function basePriceCents(item, sizeName) {
    if (sizeName && Array.isArray(item.sizes)) {
      var s = item.sizes.find(function (x) { return x.name === sizeName; });
      if (s && s.price !== null && s.price !== undefined && s.price !== '') return toCents(s.price);
    }
    return toCents(item.price);
  }

  function isTiered(item) {
    return item && item.addlPrice !== null && item.addlPrice !== undefined && item.addlPrice !== '';
  }

  /*
   * Price `qty` units of a tiered item given how many units of that same item
   * have already been charged earlier on the ticket. The first unit on the
   * ticket is charged at `price`, every later unit at `addlPrice`.
   */
  function tieredCharge(item, qty, alreadyCharged) {
    var first = toCents(item.price);
    var addl = toCents(item.addlPrice);
    var firstUnits = alreadyCharged === 0 && qty > 0 ? 1 : 0;
    var addlUnits = qty - firstUnits;
    var parts = [];
    if (firstUnits) parts.push({ qty: 1, unit: first });
    if (addlUnits > 0) parts.push({ qty: addlUnits, unit: addl });
    return {
      total: firstUnits * first + addlUnits * addl,
      parts: parts
    };
  }

  /*
   * Expand a ticket into printable rows and totals.
   *
   * ticket.lines: [{ uid, itemId|null, name?, qty, size?, priceOverride?,
   *                  taxable? (custom lines), links: { [itemId]: bool } , note? }]
   * catalog: { categories, items }
   * taxRatePct: e.g. 8.375
   */
  function computeTicket(ticket, catalog, taxRatePct) {
    var idx = indexCatalog(catalog);
    var tierCount = {}; // itemId -> units charged so far
    var rows = [];

    function pushRow(opts) {
      var item = opts.item;
      var qty = Math.max(0, Math.floor(Number(opts.qty) || 0));
      var row = {
        lineUid: opts.lineUid,
        itemId: item ? item.id : null,
        name: opts.name,
        size: opts.size || '',
        note: opts.note || '',
        qty: qty,
        isLabor: opts.isLabor,
        isLinked: !!opts.isLinked,
        parentUid: opts.parentUid || null,
        taxable: opts.taxable,
        overridden: false,
        parts: [],
        total: 0
      };

      if (opts.priceOverride !== null && opts.priceOverride !== undefined && opts.priceOverride !== '') {
        var unit = toCents(opts.priceOverride);
        row.overridden = true;
        row.parts = [{ qty: qty, unit: unit }];
        row.total = unit * qty;
        // An overridden tiered line still counts toward the tier so the
        // "first unit" price is not charged twice.
        if (item && isTiered(item)) tierCount[item.id] = (tierCount[item.id] || 0) + qty;
      } else if (item && isTiered(item)) {
        var done = tierCount[item.id] || 0;
        var t = tieredCharge(item, qty, done);
        tierCount[item.id] = done + qty;
        row.parts = t.parts;
        row.total = t.total;
      } else {
        var u = item ? basePriceCents(item, opts.size) : toCents(opts.customPrice);
        row.parts = [{ qty: qty, unit: u }];
        row.total = u * qty;
      }
      row.unit = row.parts.length === 1 ? row.parts[0].unit : null;
      rows.push(row);
      return row;
    }

    (ticket.lines || []).forEach(function (line) {
      var item = line.itemId ? idx.items[line.itemId] : null;
      if (line.itemId && !item) {
        // Item was deleted from catalog after the ticket was made: fall back to snapshot.
        item = null;
      }
      var cat = item ? idx.cats[item.categoryId] : null;
      var isLabor = item ? (cat ? cat.type === 'labor' : !!item.isLabor) : !!line.isLabor;
      var taxable = item ? !!item.taxable : !!line.taxable;

      pushRow({
        lineUid: line.uid,
        item: item,
        name: item ? item.name : (line.name || 'Custom item'),
        size: line.size,
        note: line.note,
        qty: line.qty,
        isLabor: isLabor,
        taxable: taxable,
        priceOverride: line.priceOverride,
        customPrice: line.price
      });

      if (!item || !Array.isArray(item.links)) return;
      item.links.forEach(function (link) {
        var on = line.links && Object.prototype.hasOwnProperty.call(line.links, link.itemId)
          ? !!line.links[link.itemId]
          : !!link.auto;
        if (!on) return;
        var li = idx.items[link.itemId];
        if (!li || li.active === false) return;
        var lcat = idx.cats[li.categoryId];
        pushRow({
          lineUid: line.uid + ':' + li.id,
          parentUid: line.uid,
          item: li,
          name: li.name,
          qty: line.qty,
          isLabor: lcat ? lcat.type === 'labor' : true,
          isLinked: true,
          taxable: !!li.taxable
        });
      });
    });

    var subtotal = 0, taxableSubtotal = 0, parts = 0, labor = 0;
    rows.forEach(function (r) {
      subtotal += r.total;
      if (r.taxable) taxableSubtotal += r.total;
      if (r.isLabor) labor += r.total; else parts += r.total;
    });
    var rate = Number(taxRatePct) || 0;
    // Round half away from zero to the cent.
    var tax = Math.round(taxableSubtotal * rate / 100);

    return {
      rows: rows,
      partsTotal: parts,
      laborTotal: labor,
      subtotal: subtotal,
      taxableSubtotal: taxableSubtotal,
      taxRate: rate,
      tax: tax,
      total: subtotal + tax
    };
  }

  var api = {
    toCents: toCents,
    fromCents: fromCents,
    formatMoney: formatMoney,
    basePriceCents: basePriceCents,
    isTiered: isTiered,
    tieredCharge: tieredCharge,
    computeTicket: computeTicket
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Pricing = api;
})(this);
