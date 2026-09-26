/*
 * Payment / pickup and order-tag helpers. Pure functions (no DOM) so they can
 * be unit-tested in Node. Money is in integer cents, like pricing.js.
 */
(function (root) {
  'use strict';

  var METHODS = { cash: 'Cash', card: 'Card', other: 'Other' };

  function toCents(v) {
    var n = parseFloat(v);
    return isFinite(n) ? Math.round(n * 100) : 0;
  }

  function newPayment() {
    return { status: 'due', method: 'card', tendered: '', deposit: '' };
  }

  /*
   * status: 'due' (pay at pickup) | 'paid' | 'deposit'
   * Returns what to show on screen and on the invoice.
   */
  function paymentSummary(payment, totalCents) {
    var p = payment || newPayment();
    var method = METHODS[p.method] || 'Card';
    var out = { status: p.status, method: method, paid: 0, balanceDue: totalCents, changeDue: 0, tendered: 0, warning: '', label: '' };

    if (p.status === 'paid') {
      out.paid = totalCents;
      out.balanceDue = 0;
      out.label = 'Paid in full (' + method + ')';
      if (p.method === 'cash' && p.tendered !== '' && p.tendered !== undefined) {
        out.tendered = toCents(p.tendered);
        if (out.tendered < totalCents) out.warning = 'Cash received is less than the total';
        else out.changeDue = out.tendered - totalCents;
      }
    } else if (p.status === 'deposit') {
      var dep = Math.max(0, toCents(p.deposit));
      if (dep > totalCents) out.warning = 'Deposit is more than the total';
      dep = Math.min(dep, totalCents);
      out.paid = dep;
      out.balanceDue = totalCents - dep;
      out.label = 'Deposit (' + method + ')';
    } else {
      out.label = 'Due at pickup';
    }
    return out;
  }

  // "2026-09-30" -> local Date (new Date("2026-09-30") would be UTC and can show the day before).
  function parseLocalDate(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  }

  // "Tue, Sep 30" plus optional "3:30 PM"
  function formatReadyBy(ymd, hhmm) {
    var d = parseLocalDate(ymd);
    if (!d) return '';
    var s = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    var t = /^(\d{2}):(\d{2})$/.exec(hhmm || '');
    if (t) {
      var h = Number(t[1]);
      s += ' ' + ((h % 12) || 12) + ':' + t[2] + ' ' + (h < 12 ? 'AM' : 'PM');
    }
    return s;
  }

  // YYYY-MM-DD for a Date, in local time.
  function ymd(date) {
    function p(n) { return String(n).padStart(2, '0'); }
    return date.getFullYear() + '-' + p(date.getMonth() + 1) + '-' + p(date.getDate());
  }

  // Short description of the work for a tag: the parts and services, not the auto-added labor.
  function tagWorkSummary(rows) {
    var seen = [];
    (rows || []).forEach(function (r) {
      if (r.isLinked) return;
      var name = r.name + (r.size ? ' (' + r.size + ')' : '');
      if (seen.indexOf(name) === -1) seen.push(name);
    });
    return seen.join(', ');
  }

  // Work list for the repair tag: one entry per item the customer asked for
  // (auto-added labor is left out), with quantity, size and the line's note.
  function tagWorkLines(rows) {
    return (rows || []).filter(function (r) { return !r.isLinked; }).map(function (r) {
      return { qty: r.qty, name: r.name, size: r.size || '', options: r.options || [], note: r.note || '' };
    });
  }

  // Number of clubs on the order = the largest quantity on any line (10 grips -> 10 clubs).
  function clubCount(lines) {
    var max = 0;
    (lines || []).forEach(function (l) { max = Math.max(max, Math.floor(Number(l.qty) || 0)); });
    return Math.max(1, max);
  }

  var api = {
    newPayment: newPayment,
    paymentSummary: paymentSummary,
    parseLocalDate: parseLocalDate,
    formatReadyBy: formatReadyBy,
    ymd: ymd,
    tagWorkSummary: tagWorkSummary,
    tagWorkLines: tagWorkLines,
    clubCount: clubCount
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TicketExtras = api;
})(this);
