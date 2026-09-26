# RoboGolfPro Club Repair POS

A point-of-sale screen for club repair tickets at RoboGolfPro Las Vegas. It replaces
`docs/template_club_repair.xlsx`: employees tap grips, shafts and services, the matching
labor is added automatically, Nevada sales tax is calculated, and the ticket prints as an
invoice with the RoboGolfPro logo at the top.

## Two ways to run it

| | **Windows app (.exe)** | **Website (Vercel)** |
|---|---|---|
| Where the catalog is saved | A folder on that PC | Online database (Upstash) |
| Cost | Free | Free (Upstash free plan) |
| Needs internet | No | Yes |
| Multiple devices share the catalog | No, one PC | Yes |

Both run the same app. Tickets are never saved in either one: ring up, print, press **Clear**.

## Windows app (.exe)

**Getting the .exe:** GitHub builds it automatically on every push.
1. Open the repository on GitHub → **Actions** tab → **Build Windows app**.
2. Click the newest run with a green check, then scroll to **Artifacts** and download
   **RoboGolfPOS-windows**. Unzip it to get `RoboGolfPOS.exe`.
   (For a permanent download link, push a tag like `v1.2.0`. The .exe is then attached to a
   GitHub Release.)

**Installing on the shop PC:**
1. Make a folder such as `Documents\RoboGolf POS` and put `RoboGolfPOS.exe` in it.
2. Double-click it. Windows will warn about an unrecognized app because the file isn't
   code-signed: click **More info → Run anyway** (only needed the first time).
3. A small black window opens (this is the app's engine; minimize it, don't close it), then
   the POS opens in its own Edge window.
4. Right-click the .exe → **Send to → Desktop (create shortcut)**. Optionally copy that
   shortcut into the Startup folder (`Win+R`, type `shell:startup`) so it starts with the PC.

**Where changes are saved:** a **`RoboGolf POS Data`** folder next to the .exe:
- `catalog.json` holds the catalog and settings. `catalog.json.bak` is the version before
  the last save.
- `admin-pin.json` holds the admin PIN (hashed, not readable). The first time someone
  clicks **Unlock** in Catalog or Settings, they choose the PIN. **Forgot the PIN?** Delete
  this file and choose a new one.
- **Back up** by copying the folder to a USB drive or OneDrive. **Move to a new PC** by
  copying the .exe and the folder together.

The app only listens on the PC itself (`127.0.0.1`); other computers on the network can't
reach it. To quit, close the black window.

## Website on Vercel (optional)

- The **catalog and settings are saved online**, so every device sees the same items and
  prices.
- Anyone with the link can ring up tickets. **Changing the catalog or settings requires the
  admin PIN.**

### Deploying to Vercel

1. **Import the repo:** in Vercel choose *Add New → Project*, pick this GitHub repository and
   click **Deploy**. No build settings are needed; `vercel.json` handles them.
2. **Create a free database** at **console.upstash.com** (no credit card): *Redis → Create
   Database → Free plan*. On its page, copy **UPSTASH_REDIS_REST_URL** and
   **UPSTASH_REDIS_REST_TOKEN** from the *REST API* section. (Don't use the Upstash
   integration inside Vercel; it only offers paid plans.)
3. In Vercel, go to **Settings → Environment Variables** and add `UPSTASH_REDIS_REST_URL`,
   `UPSTASH_REDIS_REST_TOKEN`, and `ADMIN_PIN` (6+ characters).
4. **Redeploy** (Deployments → ⋯ → Redeploy). The sidebar should read **"Catalog synced"**.

**Install it like an app:** in Chrome or Edge choose *Install* from the ⋯ menu; on
iPad/iPhone use Share → *Add to Home Screen*.

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

Open **Catalog** and click **Unlock** (admin PIN; in the Windows app the first person to
unlock creates it). Editing stays unlocked until the page is reloaded or you click
*Lock editing* in the sidebar.

- **Add Category:** e.g. "Grip Tape". Choose *Product* (parts) or *Labor*.
- **Add Item:** name, price, taxable, and optionally:
  - **Sizes:** e.g. Undersize / Standard / Midsize / Jumbo, each with its own price or the
    item price. Employees pick the size when ringing it up.
  - **Different price after the first:** tiered labor like shaft installation.
  - **Linked items:** items added automatically at the same quantity (e.g. a new grip
    links to *Golf Grip Installation*). Turn *Auto* off to offer it as a one-tap option.
  - **Show in POS:** hide discontinued items without deleting them.
- Changes save immediately. On the website they show on other devices the next time
  those devices are opened or focused. If two people edit at the same moment, the second
  save is refused and that person is asked to redo the change on the latest catalog, so
  nothing is silently overwritten.
- **Settings → Download backup** saves a copy of the catalog and settings. Keep one after
  big changes; **Restore from backup** puts it back.

## For developers

```
app/                      static site (UI, pricing engine, default catalog)
api/catalog.js            GET catalog / PUT catalog (x-admin-pin, version check)
api/verify-pin.js         POST { pin } (desktop: first PIN creates it)
lib/store.js              storage: Upstash REST (cloud) or JSON file (desktop/dev)
lib/local-server.js       HTTP server used by the desktop app and dev server
desktop/main.js           desktop entry: data folder, server on 127.0.0.1:47817, app window
scripts/build-exe.js      packages desktop/main.js + app/ into one executable (Node SEA)
.github/workflows/        builds and smoke-tests RoboGolfPOS.exe on Windows
tests/                    `npm test`
```

- `npm run dev`: website mode locally (http://localhost:3000, PIN `1234`).
- `npm run desktop`: desktop mode from source (data in `.desktop-data/`).
- `npm run build:exe`: build an executable for the current OS into `dist/`.
