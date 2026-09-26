# RoboGolfPro Club Repair POS

A point-of-sale screen for club repair tickets at RoboGolfPro Las Vegas. It replaces
`docs/template_club_repair.xlsx`: employees tap grips, shafts and services, the matching
labor is added automatically, Nevada sales tax is calculated, and the ticket prints as an
invoice with the RoboGolfPro logo at the top.

Everything runs in the browser from local files — no internet, server or install needed.

## Starting it

**Windows:** double-click **`Start RoboGolf POS.bat`**. It opens the app in its own
Microsoft Edge window (no tabs or address bar). Right-click the file → *Send to → Desktop
(create shortcut)* to put it on the desktop.

**Any computer:** open `app/index.html` in Chrome, Edge or Safari.

Keep the whole folder together — `index.html` needs the other files in `app/`.

> Data (catalog, settings, saved tickets) is stored in that browser on that computer.
> Always open the app the same way (same browser), and use **Settings → Export full
> backup** regularly. Clearing the browser's site data erases it.

## Using it

1. **Ticket** — type the customer's name/phone, then tap items. A grip adds *Golf Grip
   Installation*; a shaft adds *Shaft Installation* (and offers *Save Grip*). Use −/+ to
   change quantity, tap a line to pick a size, override a price, make it free, or add a
   note. Tap **Remove/Add** beside a linked labor line to switch it off or on.
2. **Print** saves the ticket (assigning an invoice number like `RGP-1001`) and opens the
   print dialog.
3. **History** — search past tickets, reprint, or reopen one to edit.

## Pricing rules

- **Shaft labor:** first shaft on a ticket $30, each additional $15 — across all lines on
  the ticket. Any catalog item can use this "different price after the first" rule.
- **Sales tax:** 8.375% (Clark County: 4.6% state + 3.775% local), applied only to items
  marked *Taxable*. Physical parts (grips, shafts) are taxable; repair and installation
  labor is not, because the invoice lists it separately
  ([NV Dept. of Taxation — Repairs & Reconditioning](https://tax.nv.gov/wp-content/uploads/2024/03/Repairs-Reconditioning.pdf)).
  The rate is editable in **Settings**.

## Adding products and labor (no coding)

**Catalog** screen:

- **Add Category** — e.g. "Grip Tape"; choose *Product* (parts) or *Labor*.
- **Add Item** — name, price, taxable, and optionally:
  - **Sizes** — e.g. Undersize / Standard / Midsize / Jumbo, each with its own price or the
    item price. Employees pick the size when ringing it up.
  - **Different price after the first** — tiered labor like shaft installation.
  - **Linked items** — items added automatically at the same quantity (e.g. a new grip
    links to *Golf Grip Installation*). Turn *Auto* off to offer it as a one-tap option.
  - **Show in POS** — hide discontinued items without deleting them.
- **Export / Import** copies the catalog to another computer.

Saved tickets keep the prices they were printed with, even after catalog changes.

## For developers

```
app/index.html            shell
app/app.js                UI (vanilla JS, no build step)
app/pricing.js            pricing/tax engine (pure functions, unit-tested)
app/catalog-defaults.js   starting catalog from the spreadsheet
tests/pricing.test.js     `npm test` (Node 18+)
```
