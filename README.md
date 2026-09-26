# RoboGolfPro Club Repair POS

A point-of-sale screen for club repair tickets at RoboGolfPro Las Vegas. It replaces
`docs/template_club_repair.xlsx`: employees tap grips, shafts and services, the matching
labor is added automatically, Nevada sales tax is calculated, and the ticket prints as an
invoice with the RoboGolfPro logo at the top.

## How it works

- The app is a website hosted on **Vercel**. Open it from any computer, tablet or phone.
- The **catalog and settings are saved online** (in a free Upstash Redis database connected
  through Vercel), so every device sees the same items and prices. Nothing depends on a
  particular browser, and clearing browser history doesn't affect it.
- **Tickets aren't saved.** Ring up, print, then press **Clear**. Reloading the page drops
  the current ticket; the browser warns you before that happens.
- Anyone with the link can ring up tickets. **Changing the catalog or settings requires the
  admin PIN.**

## Deploying to Vercel (one time, about 10 minutes)

1. **Import the repo:** in Vercel choose *Add New → Project*, pick this GitHub repository and
   click **Deploy**. No build settings are needed; `vercel.json` handles them.
2. **Add the database:** open the project → **Storage** tab → *Create Database* → choose
   **Upstash for Redis** (free plan) → connect it to the project. Vercel adds the
   `KV_REST_API_URL` and `KV_REST_API_TOKEN` environment variables automatically.
3. **Set the admin PIN:** project → **Settings → Environment Variables** → add
   `ADMIN_PIN` with a code of at least 6 characters (Production and Preview).
4. **Redeploy** (Deployments → ⋯ → Redeploy) so the new variables take effect.
5. Open the site. The bottom of the sidebar should read **"Catalog synced"**. Until the first
   catalog save, the app uses the built-in price list from the spreadsheet.

**Install it like an app:** in Chrome or Edge, open the site and choose *Install* from the
address bar or the ⋯ menu. On iPad/iPhone, use Share → *Add to Home Screen*. You get its own
window and a desktop/home-screen icon.

If the sidebar says **"Storage not connected"**, step 2 or step 4 was missed. If saving says
**"ADMIN_PIN is not set"**, do step 3 and redeploy.

## Using it

1. **Ticket:** type the customer's name/phone, then tap items. A grip adds *Golf Grip
   Installation*; a shaft adds *Shaft Installation* (and offers *Save Grip*). Use −/+ to
   change quantity. Tap a line to pick a size, override a price, make it free, or add a
   note. Tap **Remove/Add** beside a linked labor line to switch it off or on.
2. **Print** prints the invoice with a ticket number based on date and time
   (e.g. `260926-143205`). Then press **Clear** for the next customer.

## Pricing rules

- **Shaft labor:** first shaft on a ticket $30, each additional $15 — across all lines on
  the ticket. Any catalog item can use this "different price after the first" rule.
- **Sales tax:** 8.375% (Clark County: 4.6% state + 3.775% local), applied only to items
  marked *Taxable*. Physical parts (grips, shafts) are taxable; repair and installation
  labor is not, because the invoice lists it separately
  ([NV Dept. of Taxation — Repairs & Reconditioning](https://tax.nv.gov/wp-content/uploads/2024/03/Repairs-Reconditioning.pdf)).
  The rate is editable in **Settings**.

## Adding products and labor (no coding)

Open **Catalog** and click **Unlock** (admin PIN). Editing stays unlocked until the page is
reloaded or you click *Lock editing* in the sidebar.

- **Add Category:** e.g. "Grip Tape". Choose *Product* (parts) or *Labor*.
- **Add Item:** name, price, taxable, and optionally:
  - **Sizes:** e.g. Undersize / Standard / Midsize / Jumbo, each with its own price or the
    item price. Employees pick the size when ringing it up.
  - **Different price after the first:** tiered labor like shaft installation.
  - **Linked items:** items added automatically at the same quantity (e.g. a new grip
    links to *Golf Grip Installation*). Turn *Auto* off to offer it as a one-tap option.
  - **Show in POS:** hide discontinued items without deleting them.
- Changes save immediately and show on other devices the next time they're opened or
  focused. If two people edit at the same moment, the second save is refused and that
  person is asked to redo the change on the latest catalog, so nothing is silently
  overwritten.
- **Settings → Download backup** saves a copy of the catalog and settings. Keep one after
  big changes; **Restore from backup** puts it back.

## For developers

```
app/                      static site (Vercel output directory)
  index.html, styles.css  shell and Apple-style design
  app.js                  UI (vanilla JS, no build step)
  pricing.js              pricing/tax engine (pure functions)
  catalog-defaults.js     starting catalog from the spreadsheet
api/catalog.js            GET catalog / PUT catalog (x-admin-pin, version check)
api/verify-pin.js         POST { pin }
lib/                      storage (Upstash REST or local file), validation, helpers
scripts/dev-server.js     local stand-in for Vercel
tests/                    `npm test` (Node 18+)
```

Run locally: `ADMIN_PIN=1234 npm run dev`, then open http://localhost:3000. The catalog is
stored in `.local-store.json`.
