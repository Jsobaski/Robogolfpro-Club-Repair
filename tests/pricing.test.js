const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../app/pricing.js');
const { DEFAULT_CATALOG } = require('../app/catalog-defaults.js');

const RATE = 8.375;
const calc = (lines, catalog = DEFAULT_CATALOG) => P.computeTicket({ lines }, catalog, RATE);

test('grip auto-adds installation labor at same quantity; only the grip is taxed', () => {
  const r = calc([{ uid: 'a', itemId: 'ss-crossline-2', qty: 10 }]);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].total, 6990);
  assert.equal(r.rows[1].name, 'Golf Grip Installation');
  assert.equal(r.rows[1].qty, 10);
  assert.equal(r.rows[1].total, 5000);
  assert.equal(r.taxableSubtotal, 6990);
  assert.equal(r.tax, 585); // 69.90 * 8.375% = 5.854 -> 5.85
  assert.equal(r.total, 6990 + 5000 + 585);
});

test('shaft labor: first shaft $30, each additional $15', () => {
  const one = calc([{ uid: 'a', itemId: 'shaft-customer', qty: 1 }]);
  assert.equal(one.laborTotal, 3000);
  const four = calc([{ uid: 'a', itemId: 'shaft-customer', qty: 4 }]);
  assert.equal(four.laborTotal, 3000 + 3 * 1500);
});

test('shaft tier carries across separate lines on the same ticket', () => {
  const r = calc([
    { uid: 'a', itemId: 'shaft-customer', qty: 1 },
    { uid: 'b', itemId: 'shaft-customer', qty: 2 },
    { uid: 'c', itemId: 'lab-shaft-install', qty: 1 }
  ]);
  const labor = r.rows.filter(x => x.itemId === 'lab-shaft-install').map(x => x.total);
  assert.deepEqual(labor, [3000, 3000, 1500]);
});

test('linked items can be switched on/off per line', () => {
  const r = calc([{ uid: 'a', itemId: 'shaft-customer', qty: 2, links: { 'lab-shaft-install': false, 'lab-save-grip': true } }]);
  assert.deepEqual(r.rows.map(x => x.itemId), ['shaft-customer', 'lab-save-grip']);
  assert.equal(r.total, 1200);
});

test('price override (free shaft) and custom lines', () => {
  const r = calc([
    { uid: 'a', itemId: 'lab-shaft-install', qty: 1, priceOverride: 0 },
    { uid: 'b', itemId: 'lab-shaft-install', qty: 1 },
    { uid: 'c', itemId: null, name: 'Ferrule', price: 1.5, qty: 2, taxable: true }
  ]);
  // Overridden unit consumed the "first" tier, so the next is $15.
  assert.deepEqual(r.rows.map(x => x.total), [0, 1500, 300]);
  assert.equal(r.tax, 25); // 3.00 * 8.375% = 0.25125
});

test('size-specific pricing falls back to item price when blank', () => {
  const catalog = JSON.parse(JSON.stringify(DEFAULT_CATALOG));
  catalog.items.find(i => i.id === 'gp-cp2-wrap').sizes = [
    { name: 'Standard', price: '' }, { name: 'Jumbo', price: 13.49 }
  ];
  assert.equal(calc([{ uid: 'a', itemId: 'gp-cp2-wrap', qty: 1, size: 'Standard', links: { 'lab-grip-install': false } }], catalog).total, 1199 + 100);
  assert.equal(calc([{ uid: 'a', itemId: 'gp-cp2-wrap', qty: 1, size: 'Jumbo', links: { 'lab-grip-install': false } }], catalog).subtotal, 1349);
});

test('formatMoney', () => {
  assert.equal(P.formatMoney(123456), '$1,234.56');
  assert.equal(P.formatMoney(5), '$0.05');
  assert.equal(P.formatMoney(-250), '-$2.50');
});

test('grip options: logo required, +4 or more wraps adds $1 per grip (taxable)', () => {
  const grips = DEFAULT_CATALOG.categories.find(c => c.id === 'grips');
  assert.deepEqual(P.missingOptions(grips.options, {}).map(o => o.id), ['logo']);
  assert.deepEqual(P.missingOptions(grips.options, { logo: 'Down' }), []);

  const three = calc([{ uid: 'a', itemId: 'ss-crossline-2', qty: 2, opts: { logo: 'Down', wraps: '+3' } }]);
  assert.deepEqual(three.rows[0].options, ['Logo Down', 'Extra wraps +3']);
  assert.equal(three.rows.length, 2); // grip + install, no wrap charge

  const five = calc([{ uid: 'a', itemId: 'ss-crossline-2', qty: 2, opts: { logo: 'Up', wraps: '+5' } }]);
  const wrap = five.rows.find(r => r.isOption);
  assert.equal(wrap.name, 'Extra wraps +5');
  assert.equal(wrap.total, 200);
  assert.equal(wrap.taxable, true);
  assert.equal(five.taxableSubtotal, 2 * 699 + 200);
});

test('loft & lie requires a description of the change', () => {
  const ll = DEFAULT_CATALOG.categories.find(c => c.id === 'loft-lie');
  assert.equal(P.missingOptions(ll.options, { adjust: '  ' }).length, 1);
  const r = calc([{ uid: 'a', itemId: 'lab-loft-lie', qty: 1, opts: { adjust: '2° up, 1° strong' } }]);
  assert.deepEqual(r.rows[0].options, ['Change: 2° up, 1° strong']);
  assert.equal(r.total, 500);
});

test('migration adds options to an old saved catalog once, without overwriting edits', () => {
  const { migrateCatalog } = require('../app/catalog-defaults.js');
  const old = JSON.parse(JSON.stringify(DEFAULT_CATALOG));
  delete old.migrations;
  old.categories.forEach(c => delete c.options);
  migrateCatalog(old);
  assert.equal(old.categories.find(c => c.id === 'grips').options.length, 2);
  old.categories.find(c => c.id === 'grips').options = [];
  migrateCatalog(old);
  assert.equal(old.categories.find(c => c.id === 'grips').options.length, 0);
});
