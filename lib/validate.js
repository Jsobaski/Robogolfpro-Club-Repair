'use strict';

// Light structural validation so a bad request can't wipe or corrupt the catalog.
function validateCatalog(c) {
  if (!c || typeof c !== 'object') return 'catalog missing';
  if (!Array.isArray(c.categories) || !Array.isArray(c.items)) return 'catalog needs categories and items';
  const catIds = new Set();
  for (const cat of c.categories) {
    if (!cat || typeof cat.id !== 'string' || typeof cat.name !== 'string') return 'bad category';
    if (cat.type !== 'product' && cat.type !== 'labor') return 'bad category type';
    catIds.add(cat.id);
  }
  for (const it of c.items) {
    if (!it || typeof it.id !== 'string' || typeof it.name !== 'string') return 'bad item';
    if (!catIds.has(it.categoryId)) return 'item "' + it.name + '" has unknown category';
    if (typeof it.price !== 'number' || !isFinite(it.price)) return 'item "' + it.name + '" has bad price';
  }
  return null;
}

function validateSettings(s) {
  if (!s || typeof s !== 'object') return 'settings missing';
  if (typeof s.taxRate !== 'number' || s.taxRate < 0 || s.taxRate > 25) return 'tax rate must be 0–25';
  return null;
}

module.exports = { validateCatalog, validateSettings };
