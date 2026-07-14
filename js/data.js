// ─── Data Helpers ───
const genId = () => Math.random().toString(36).slice(2,10);
const currency = (n) => n == null || isNaN(n) ? '—' : '$' + Number(n).toFixed(2);
const pct = (n) => n == null || isNaN(n) ? '—' : (n >= 0 ? '+' : '') + n.toFixed(1) + '%';

// ─── Constants ───
const ITEM_TYPES = ['set','minifig','part'];
const SELL_STATUSES = ['available','listed','sold'];
const CONDITIONS = ['new_sealed','new_open','used_complete','used_incomplete'];
const CONDITION_LABELS = {
  new_sealed:    'New/Sealed',
  new_open:      'New/Open Box',
  used_complete: 'Used - Complete',
  used_incomplete:'Used - Incomplete'
};

const itemTypeLabel = (type) => ({
  set: 'Set',
  minifig: 'Minifig',
  part: 'Part',
  gear: 'Gear',
  book: 'Book',
  catalog: 'Catalog',
  instruction: 'Instruction',
})[type] || type || 'Other';

const itemTypeColor = (type) => ({
  set: 'var(--accent)',
  minifig: 'var(--orange)',
  part: 'var(--blue)',
  gear: 'var(--green)',
  book: 'var(--purple)',
  catalog: 'var(--text2)',
  instruction: 'var(--text2)',
})[type] || 'var(--text2)';

const itemCategoryLabel = (item) => item.theme || item.category || 'Uncategorized';

const ITEM_TYPE_ORDER = ['set', 'minifig', 'part', 'gear', 'book', 'catalog', 'instruction'];

const sortItemTypes = ([a], [b]) => {
  const ai = ITEM_TYPE_ORDER.indexOf(a);
  const bi = ITEM_TYPE_ORDER.indexOf(b);
  if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  return String(a).localeCompare(String(b));
};

const groupItemsByTypeCategory = (items) => {
  const typeMap = new Map();
  (items || []).forEach(item => {
    const type = item.type || 'other';
    const category = itemCategoryLabel(item);
    if (!typeMap.has(type)) typeMap.set(type, new Map());
    const categoryMap = typeMap.get(type);
    if (!categoryMap.has(category)) categoryMap.set(category, []);
    categoryMap.get(category).push(item);
  });
  return [...typeMap.entries()]
    .sort(sortItemTypes)
    .map(([type, categories]) => ({
      type,
      rows: [...categories.entries()]
        .sort(([a], [b]) => String(a).localeCompare(String(b)))
        .map(([category, rows]) => ({ category, rows })),
    }));
};

// ─── Name Sanitizer ───
// Removes hidden/control characters, including HTML-entity-encoded ones like &#30;
const cleanName = (s) => {
  if (!s) return s;
  // Decode HTML numeric entities (e.g. &#30; or &#x1e;) then strip control chars
  const decoded = s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
                   .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
  return decoded.replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}]/gu, '').trim();
};

// ─── eBay avg helper ───
// Computes the average eBay price from a list of listing objects, respecting the
// "plus shipping" rule: if ALL listings have fixed (non-calculated) shipping, include
// shipping in the total. If any listing has calculated shipping, use item price only.
function ebayAvgFromListings(listings) {
  if (!listings || listings.length === 0) return null;
  const allFixed = listings.every(l => !l.shippingUnknown && l.shippingType !== 'CALCULATED');
  const prices = listings.map(l => allFixed ? (l.total ?? l.price) : l.price).filter(p => p > 0);
  if (!prices.length) return null;
  return Math.round((prices.reduce((s, v) => s + v, 0) / prices.length) * 100) / 100;
}

// ─── BrickLink Catalog (server-side) ───
// The catalog is stored on disk by start.py and looked up via API.
// These helpers just talk to the server.

const fetchCatalogStatus = async () => {
  try {
    const resp = await fetch('/api/catalog/status');
    if (!resp.ok) return null;
    return resp.json(); // { loaded, counts, loadedAt }
  } catch { return null; }
};

const uploadCatalogFiles = async (files) => {
  const formData = new FormData();
  for (const file of files) formData.append('files', file);
  const resp = await fetch('/api/catalog/upload', { method: 'POST', body: formData });
  if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
  return resp.json(); // { ok, saved, errors, counts, total, loadedAt }
};

const clearCatalogServer = async () => {
  await fetch('/api/catalog/clear', { method: 'POST' });
};

// ─── Colors catalog ───
const fetchColorsStatus = async () => {
  try { const r = await fetch('/api/colors/status'); return r.ok ? r.json() : null; } catch { return null; }
};
const uploadColorsFile = async (file) => {
  const fd = new FormData(); fd.append('files', file);
  const r = await fetch('/api/colors/upload', { method: 'POST', body: fd });
  if (!r.ok) throw new Error(`Upload failed: ${r.status}`);
  return r.json();
};
const clearColorsServer = async () => { await fetch('/api/colors/clear', { method: 'POST' }); };

// Fetch the full color map from the server: colorId → { name, type, hex }
// Returns an empty object if colors aren't loaded yet.
const fetchAllColors = async () => {
  try {
    const r = await fetch('/api/colors/all');
    if (!r.ok) return {};
    return await r.json();
  } catch { return {}; }
};

// Fetch the full category map from the server: categoryId → { name, parentId }
const fetchAllCategories = async () => {
  try {
    const r = await fetch('/api/categories/all');
    if (!r.ok) return {};
    return await r.json();
  } catch { return {}; }
};

// Enrich items whose theme is a raw numeric category ID, resolving it to a name.
const enrichItemsWithCategory = async (items) => {
  const needsEnrich = items.some(i => i.theme && /^\d+$/.test(i.theme));
  if (!needsEnrich) return items;

  const catMap = await fetchAllCategories();
  if (Object.keys(catMap).length === 0) return items;

  return items.map(item => {
    if (item.theme && /^\d+$/.test(item.theme) && catMap[item.theme]) {
      return { ...item, theme: catMap[item.theme].name };
    }
    return item;
  });
};

// Enrich an array of items that have blColorId but missing color name or colorHex.
const enrichItemsWithColorHex = async (items) => {
  const needsEnrich = items.some(i => i.blColorId && (!i.color || !i.colorHex));
  if (!needsEnrich) return items;

  const colorMap = await fetchAllColors();
  if (Object.keys(colorMap).length === 0) return items;

  return items.map(item => {
    if (item.blColorId && colorMap[item.blColorId]) {
      const { name, hex } = colorMap[item.blColorId];
      return {
        ...item,
        color:    item.color    || name,
        colorHex: item.colorHex || hex,
      };
    }
    return item;
  });
};

// ─── Categories catalog ───
const fetchCategoriesStatus = async () => {
  try { const r = await fetch('/api/categories/status'); return r.ok ? r.json() : null; } catch { return null; }
};
const uploadCategoriesFile = async (file) => {
  const fd = new FormData(); fd.append('files', file);
  const r = await fetch('/api/categories/upload', { method: 'POST', body: fd });
  if (!r.ok) throw new Error(`Upload failed: ${r.status}`);
  return r.json();
};
const clearCategoriesServer = async () => { await fetch('/api/categories/clear', { method: 'POST' }); };

// ─── Storage ───
const STORAGE_KEY  = 'brickvault_data';
const SETTINGS_KEY = 'brickvault_settings';

// ─── Color migration helper ───
// Extracts "Color: Name (ID)" or "Color ID: ID" from a notes string,
// returning { color, colorId, notes } with the color segment removed.
const extractColorFromNotes = (notes) => {
  if (!notes) return { color: '', colorId: '', notes: '' };
  // Match "Color: Some Name (123)" format
  const named = notes.match(/Color:\s*([^(|]+?)\s*\((\d+)\)/);
  if (named) {
    const color   = named[1].trim();
    const colorId = named[2].trim();
    const cleaned = notes.replace(named[0], '').replace(/^\s*\|\s*|\s*\|\s*$/g, '').replace(/\s*\|\s*\|\s*/g, ' | ').trim();
    return { color, colorId, notes: cleaned };
  }
  // Match "Color ID: 123" format (no name)
  const idOnly = notes.match(/Color ID:\s*(\d+)/);
  if (idOnly) {
    const colorId = idOnly[1].trim();
    const cleaned = notes.replace(idOnly[0], '').replace(/^\s*\|\s*|\s*\|\s*$/g, '').replace(/\s*\|\s*\|\s*/g, ' | ').trim();
    return { color: '', colorId, notes: cleaned };
  }
  return { color: '', colorId: '', notes };
};

const loadData = () => {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY)) || { items: [], sales: [], wantedLists: [], salesOrders: [], salesQuotes: [] };
    if (!data.wantedLists) data.wantedLists = [];
    if (!data.salesOrders) data.salesOrders = [];
    if (!data.salesQuotes) data.salesQuotes = [];
    if (data.items) data.items = data.items.map(item => {
      // Sanitize names
      item = { ...item, name: cleanName(item.name) };
      // Migrate color out of notes for parts that don't already have a color field
      if (item.type === 'part' && !item.color && item.notes) {
        const { color, colorId, notes } = extractColorFromNotes(item.notes);
        if (color || colorId) {
          item = { ...item, color, blColorId: colorId || item.blColorId || '', notes };
        }
      }
      return item;
    });
    return data;
  }
  catch { return { items: [], sales: [] }; }
};
const saveData = (data) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    // localStorage quota exceeded — retry without priceSnapshots (disk save is the source of truth)
    console.warn('localStorage full, retrying without snapshots:', e.message);
    try {
      const slim = { ...data, items: (data.items || []).map(i => { const { priceSnapshots, ...rest } = i; return rest; }) };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
    } catch (e2) {
      // Still too large — give up, Flask disk save is the fallback
      console.warn('localStorage save failed even after trimming snapshots:', e2.message);
    }
  }
};

const loadSettings = () => {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; }
  catch { return {}; }
};
const saveSettings = (s) => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch (e) {
    console.warn('localStorage settings save failed:', e.message);
  }
};

// ─── URL Generators ───
const bricklinkUrl = (item) => {
  if (item.type === 'set')     return `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${encodeURIComponent(item.itemNumber)}`;
  if (item.type === 'minifig') return `https://www.bricklink.com/v2/catalog/catalogitem.page?M=${encodeURIComponent(item.itemNumber)}`;
  if (item.type === 'part')    return `https://www.bricklink.com/v2/catalog/catalogitem.page?P=${encodeURIComponent(item.itemNumber)}`;
  return `https://www.bricklink.com/v2/search.page?q=${encodeURIComponent(item.itemNumber || item.name)}`;
};
const bricklinkPriceUrl = (item) => {
  if (item.type === 'set')     return `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${encodeURIComponent(item.itemNumber)}#T=P`;
  if (item.type === 'minifig') return `https://www.bricklink.com/v2/catalog/catalogitem.page?M=${encodeURIComponent(item.itemNumber)}#T=P`;
  if (item.type === 'part')    return `https://www.bricklink.com/v2/catalog/catalogitem.page?P=${encodeURIComponent(item.itemNumber)}#T=P`;
  return bricklinkUrl(item);
};
const ebaySearchUrl = (item) => {
  const q = item.type === 'set' ? `LEGO ${item.itemNumber} ${item.name}` : `LEGO ${item.name} ${item.itemNumber}`;
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&LH_Sold=1&LH_Complete=1`;
};
const ebayActiveUrl = (item) => {
  const q = item.type === 'set' ? `LEGO ${item.itemNumber} ${item.name}` : `LEGO ${item.name} ${item.itemNumber}`;
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}`;
};

// ─── Merge Duplicates ───
// Two items are considered duplicates if they share the same type, itemNumber,
// color (case-insensitive), and condition.  Sold items are never merged so that
// individual sale records are preserved.
//
// For each group of duplicates the function keeps the most-complete "primary"
// item and:
//   • sums quantities
//   • takes the lowest purchasePrice (best deal paid)
//   • takes the highest estimatedValue / bricklinkPrice / ebayPrice / listPrice
//   • concatenates non-empty, distinct notes (separated by " | ")
//   • keeps the first non-empty value for imageUrl, theme, platform, rebrickableId,
//     colorHex, blColorId
//
// Returns { mergedItems, mergeCount } where mergeCount is the number of rows
// that were collapsed (i.e. total duplicates removed).
const mergeDuplicates = (items) => {
  const groups = new Map();

  for (const item of items) {
    // Never merge sold items — keep each sale as its own record
    if ((item.sellStatus || 'available') === 'sold') {
      const soloKey = `__sold__${item.id}`;
      groups.set(soloKey, [item]);
      continue;
    }

    const key = [
      (item.type        || '').toLowerCase(),
      (item.itemNumber  || '').toLowerCase(),
      (item.color       || '').toLowerCase(),
      (item.condition   || '').toLowerCase(),
    ].join('||');

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  let mergeCount = 0;
  const mergedItems = [];

  for (const group of groups.values()) {
    if (group.length === 1) {
      mergedItems.push(group[0]);
      continue;
    }

    mergeCount += group.length - 1;

    // Sort so the item with the most fields filled in comes first
    const sorted = [...group].sort((a, b) => {
      const score = (i) => [i.name, i.theme, i.imageUrl, i.notes].filter(Boolean).length;
      return score(b) - score(a);
    });

    const primary = { ...sorted[0] };

    // Aggregate across all items in the group
    let totalQty       = 0;
    let minCost        = Infinity;
    let maxValue       = -Infinity;
    let maxBLPrice     = -Infinity;
    let maxEbayPrice   = -Infinity;
    let maxListPrice   = -Infinity;
    const notesParts   = [];

    for (const item of sorted) {
      totalQty     += (item.quantity      || 1);
      minCost       = Math.min(minCost,      item.purchasePrice   || 0);
      maxValue      = Math.max(maxValue,     item.estimatedValue  || 0);
      maxBLPrice    = Math.max(maxBLPrice,   item.bricklinkPrice  || 0);
      maxEbayPrice  = Math.max(maxEbayPrice, item.ebayPrice       || 0);
      maxListPrice  = Math.max(maxListPrice, item.listPrice       || 0);

      // Collect non-empty notes, skipping duplicates
      const n = (item.notes || '').trim();
      if (n && !notesParts.includes(n)) notesParts.push(n);

      // Back-fill optional fields from secondary items if primary lacks them
      if (!primary.imageUrl      && item.imageUrl)      primary.imageUrl      = item.imageUrl;
      if (!primary.theme         && item.theme)         primary.theme         = item.theme;
      if (!primary.platform      && item.platform)      primary.platform      = item.platform;
      if (!primary.rebrickableId && item.rebrickableId) primary.rebrickableId = item.rebrickableId;
      if (!primary.colorHex      && item.colorHex)      primary.colorHex      = item.colorHex;
      if (!primary.blColorId     && item.blColorId)     primary.blColorId     = item.blColorId;
    }

    primary.quantity       = totalQty;
    primary.purchasePrice  = minCost   === Infinity  ? 0 : minCost;
    primary.estimatedValue = maxValue  === -Infinity ? 0 : maxValue;
    primary.bricklinkPrice = maxBLPrice  === -Infinity ? 0 : maxBLPrice;
    primary.ebayPrice      = maxEbayPrice === -Infinity ? 0 : maxEbayPrice;
    primary.listPrice      = maxListPrice === -Infinity ? 0 : maxListPrice;
    primary.notes          = notesParts.join(' | ');
    primary.updatedAt      = new Date().toISOString();

    mergedItems.push(primary);
  }

  return { mergedItems, mergeCount };
};

// ─── Price trend helper ───
// Returns { pct, color } from the last two data points in a price history array,
// or null if there isn't enough data.
const trend = (history, key) => {
  if (!history || history.length < 2) return null;
  const pts = history.map(h => h[key]).filter(v => v != null && !isNaN(v));
  if (pts.length < 2) return null;
  const prev = pts[pts.length - 2];
  const curr = pts[pts.length - 1];
  if (prev === 0) return null;
  const pct = ((curr - prev) / prev) * 100;
  const intensity = Math.min(Math.abs(pct) / 20, 1);
  const alpha = 0.25 + intensity * 0.75;
  const color = pct > 0
    ? `rgba(76, 175, 125, ${alpha.toFixed(2)})`
    : `rgba(231, 76, 76, ${alpha.toFixed(2)})`;
  return { pct, color };
};

// ─── Suggested Price ───
// Blends BL Sold median (1/3) + BL Active median (2/3), nudges by recent trend,
// then pulls toward the lowest active listing if it undercuts the baseline.
const suggestedPrice = (item) => {
  const soldMed   = item.bricklinkMedian        || null;
  const activeMed = item.bricklinkActiveMedian  || null;
  const activeMin = item.bricklinkActive        || null;

  if (soldMed == null && activeMed == null) return null;

  const estimated = item.bricklinkPriceEstimated;

  // 1. Baseline: 1/3 sold + 2/3 active (active reflects current market reality)
  let baseline;
  if (estimated || activeMed == null) {
    baseline = soldMed;
  } else if (soldMed == null) {
    baseline = activeMed;
  } else {
    baseline = soldMed * (1/3) + activeMed * (2/3);
  }

  // 2. Trend nudge: ±0–5% based on recent price direction
  const t = trend(item.priceHistory, 'blPrice');
  if (t) {
    const nudgePct = Math.max(-5, Math.min(5, t.pct * 0.25));
    baseline = baseline * (1 + nudgePct / 100);
  }

  // 3. Competition: undercut lowest active listing by 3% if it's below baseline
  if (!estimated && activeMin != null) {
    const competitionFloor = activeMin * 0.97;
    if (competitionFloor < baseline) baseline = competitionFloor;
  }

  return Math.round(Math.max(0.01, baseline) * 100) / 100;
};
