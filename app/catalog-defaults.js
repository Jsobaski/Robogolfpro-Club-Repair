/*
 * Starting catalog, taken from the "prices" sheet of template_club_repair.xlsx.
 * This is only used on first launch (or "Reset catalog to defaults").
 * Day-to-day changes are made in the app's Catalog screen and saved in the browser.
 *
 * Item fields:
 *   price      unit price in dollars
 *   addlPrice  optional; when set, the first unit on a ticket costs `price`
 *              and every additional unit costs `addlPrice` (e.g. shafts $30 / $15)
 *   taxable    Nevada: parts are taxable, separately stated repair/installation
 *              labor is not
 *   sizes      optional [{ name, price }]; price blank = use item price
 *   links      [{ itemId, auto }] items added alongside this one at the same qty.
 *              auto:true = on by default, auto:false = offered as a toggle
 */
(function (root) {
  'use strict';

  var DEFAULT_CATALOG = {
    version: 1,
    categories: [
      { id: 'grips', name: 'Grips', type: 'product' },
      { id: 'putter-grips', name: 'Putter Grips', type: 'product' },
      { id: 'shafts', name: 'Shafts', type: 'product' },
      { id: 'grip-labor', name: 'Grip Labor', type: 'labor' },
      { id: 'shaft-labor', name: 'Shaft Labor', type: 'labor' },
      { id: 'length', name: 'Extend / Shorten', type: 'labor' },
      { id: 'loft-lie', name: 'Loft & Lie', type: 'labor' },
      { id: 'repairs', name: 'Repairs', type: 'labor' }
    ],
    items: [
      // Grips
      { id: 'gp-cp2-wrap', categoryId: 'grips', name: 'Golf Pride CP2 Wrap', price: 11.99, taxable: true, sizes: [],
        links: [{ itemId: 'lab-grip-install', auto: true }] },
      { id: 'ss-crossline-2', categoryId: 'grips', name: 'SuperStroke Crossline 2.0', price: 6.99, taxable: true, sizes: [],
        links: [{ itemId: 'lab-grip-install', auto: true }] },
      { id: 'ss-element', categoryId: 'grips', name: 'SuperStroke Element', price: 10.99, taxable: true, sizes: [],
        links: [{ itemId: 'lab-grip-install', auto: true }] },
      { id: 'ss-revl-comfort-white', categoryId: 'grips', name: 'SuperStroke Revl Comfort White', price: 9.99, taxable: true, sizes: [],
        links: [{ itemId: 'lab-grip-install', auto: true }] },
      { id: 'grip-customer', categoryId: 'grips', name: 'Customer-Supplied Grip', price: 0, taxable: false, sizes: [],
        links: [{ itemId: 'lab-grip-install', auto: true }] },

      // Putter grips
      { id: 'winn-excel-pro-x', categoryId: 'putter-grips', name: 'WINN Excel Pro X', price: 25.99, taxable: true, sizes: [],
        links: [{ itemId: 'lab-grip-install', auto: true }] },
      { id: 'winn-excel-medalist-pistol', categoryId: 'putter-grips', name: 'WINN Excel Medalist Pistol', price: 16.99, taxable: true, sizes: [],
        links: [{ itemId: 'lab-grip-install', auto: true }] },
      { id: 'winn-no-taper', categoryId: 'putter-grips', name: 'WINN No Taper', price: 20.99, taxable: true, sizes: [],
        links: [{ itemId: 'lab-grip-install', auto: true }] },

      // Shafts
      { id: 'shaft-customer', categoryId: 'shafts', name: 'Customer-Supplied Shaft', price: 0, taxable: false, sizes: [],
        links: [{ itemId: 'lab-shaft-install', auto: true }, { itemId: 'lab-save-grip', auto: false }] },

      // Grip labor
      { id: 'lab-grip-install', categoryId: 'grip-labor', name: 'Golf Grip Installation', price: 5, taxable: false, sizes: [], links: [] },
      { id: 'lab-long-putter-grip', categoryId: 'grip-labor', name: 'Long/Belly Putter Grip Installation', price: 10, taxable: false, sizes: [], links: [] },
      { id: 'lab-save-grip', categoryId: 'grip-labor', name: 'Save Grip', price: 6, taxable: false, sizes: [], links: [] },

      // Shaft labor
      { id: 'lab-shaft-install', categoryId: 'shaft-labor', name: 'Shaft Installation', price: 30, addlPrice: 15, taxable: false, sizes: [], links: [] },
      { id: 'lab-reshaft-set-8', categoryId: 'shaft-labor', name: 'Reshaft (Set of 8)', price: 105, taxable: false, sizes: [], links: [] },
      { id: 'lab-remove-shaft', categoryId: 'shaft-labor', name: 'Remove Shaft', price: 15, taxable: false, sizes: [], links: [] },
      { id: 'lab-remove-broken-shaft', categoryId: 'shaft-labor', name: 'Remove Broken Shaft', price: 20, taxable: false, sizes: [], links: [] },

      // Extend / shorten
      { id: 'lab-extend', categoryId: 'length', name: 'Extend Shaft', price: 10, taxable: false, sizes: [], links: [] },
      { id: 'lab-extend-save-grip', categoryId: 'length', name: 'Extend Shaft + Save & Reinstall Grip', price: 18, taxable: false, sizes: [], links: [] },
      { id: 'lab-shorten', categoryId: 'length', name: 'Shorten Shaft', price: 5, taxable: false, sizes: [], links: [] },
      { id: 'lab-shorten-save-grip', categoryId: 'length', name: 'Shorten Shaft + Save & Reinstall Grip', price: 12, taxable: false, sizes: [], links: [] },

      // Loft & lie
      { id: 'lab-loft-lie', categoryId: 'loft-lie', name: 'Loft and Lie Adjustment', price: 5, taxable: false, sizes: [], links: [] },
      { id: 'lab-putter-lie', categoryId: 'loft-lie', name: 'Putter Lie Adjustment', price: 10, taxable: false, sizes: [], links: [] },

      // Repairs
      { id: 'lab-reglue-head', categoryId: 'repairs', name: 'Re-glue Loose Head', price: 15, taxable: false, sizes: [], links: [] }
    ]
  };

  var DEFAULT_SETTINGS = {
    // Clark County, NV combined rate (4.6% state + 3.775% local), effective 2020-01-01.
    taxRate: 8.375,
    // Order tag: 'sheet' = printed on regular Letter paper and cut out,
    // 'label' = a label printer using labelWidth x labelHeight inches.
    tagFormat: 'sheet',
    labelWidth: 2.25,
    labelHeight: 1.25,
    footer: 'Thank you for choosing RoboGolfPro Las Vegas! Repair labor is separately stated and not subject to Nevada sales tax.'
  };

  var api = { DEFAULT_CATALOG: DEFAULT_CATALOG, DEFAULT_SETTINGS: DEFAULT_SETTINGS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.DEFAULT_CATALOG = DEFAULT_CATALOG; root.DEFAULT_SETTINGS = DEFAULT_SETTINGS; }
})(this);
