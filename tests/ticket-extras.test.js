const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../app/ticket-extras.js');

test('due at pickup: full balance due', () => {
  const s = X.paymentSummary({ status: 'due' }, 2075);
  assert.equal(s.balanceDue, 2075);
  assert.equal(s.paid, 0);
  assert.equal(s.label, 'Due at pickup');
});

test('paid in cash: change due, and a warning when short', () => {
  const s = X.paymentSummary({ status: 'paid', method: 'cash', tendered: '40' }, 2075);
  assert.equal(s.balanceDue, 0);
  assert.equal(s.changeDue, 1925);
  assert.equal(s.label, 'Paid in full (Cash)');
  const short = X.paymentSummary({ status: 'paid', method: 'cash', tendered: '20' }, 2075);
  assert.match(short.warning, /less than/);
  assert.equal(short.changeDue, 0);
  assert.equal(X.paymentSummary({ status: 'paid', method: 'card' }, 2075).changeDue, 0);
});

test('deposit: balance due, capped at total', () => {
  const s = X.paymentSummary({ status: 'deposit', method: 'card', deposit: '20' }, 20875);
  assert.equal(s.paid, 2000);
  assert.equal(s.balanceDue, 18875);
  const over = X.paymentSummary({ status: 'deposit', deposit: '500' }, 20875);
  assert.equal(over.balanceDue, 0);
  assert.match(over.warning, /more than/);
});

test('ready-by dates are local (no off-by-one day)', () => {
  const d = X.parseLocalDate('2026-09-30');
  assert.equal(d.getDate(), 30);
  assert.equal(X.formatReadyBy('2026-09-30', '15:30'), 'Wed, Sep 30 3:30 PM');
  assert.equal(X.formatReadyBy('2026-09-30', ''), 'Wed, Sep 30');
  assert.equal(X.formatReadyBy('', '10:00'), '');
  assert.equal(X.ymd(new Date(2026, 0, 5)), '2026-01-05');
});

test('tag helpers', () => {
  const rows = [
    { name: 'Golf Pride CP2 Wrap', size: 'Midsize' },
    { name: 'Golf Grip Installation', isLinked: true },
    { name: 'Loft and Lie Adjustment' }
  ];
  assert.equal(X.tagWorkSummary(rows), 'Golf Pride CP2 Wrap (Midsize), Loft and Lie Adjustment');
  assert.deepEqual(X.tagWorkLines([{ qty: 2, name: 'Ventus Black 6S', note: 'tip 1 in' }, { qty: 2, name: 'Install', isLinked: true }]),
    [{ qty: 2, name: 'Ventus Black 6S', size: '', options: [], note: 'tip 1 in' }]);
  assert.equal(X.clubCount([{ qty: 10 }, { qty: 3 }]), 10);
  assert.equal(X.clubCount([]), 1);
});
