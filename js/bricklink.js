// ─── BrickLink Catalog Lookup (via local proxy in start.py) ───
// colorId is optional — required by BrickLink API for colored parts.
async function lookupItemBrickLink(type, itemNumber, colorId) {
  if (!itemNumber || !itemNumber.trim())
    throw new Error('Enter an item number first.');

  const tryLookup = async (id) => {
    const p = { type, itemNumber: id.trim() };
    if (colorId) p.colorId = colorId;
    const params = new URLSearchParams(p);
    let resp;
    try {
      resp = await fetch(`/api/bricklink/catalog?${params}`);
    } catch(e) {
      throw new Error('Could not reach the local server. Make sure you started the app with start.py.');
    }

    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('application/json'))
      throw new Error('BrickLink proxy not available. Please restart the app using start.py.');

    const data = await resp.json();
    if (!resp.ok || data.error)
      throw new Error(data.error || `API error: ${resp.status}`);

    return data; // { name, imageUrl, thumbnailUrl, yearReleased, theme, description }
  };

  // First attempt with original ID
  try {
    return await tryLookup(itemNumber);
  } catch(firstErr) {
    // Retry with "-1" appended only for sets (e.g. "75192" → "75192-1").
    // Parts and minifigs never use the -1 suffix.
    const trimmed = itemNumber.trim();
    if (type === 'set' && !/-\d+$/.test(trimmed)) {
      try {
        return await tryLookup(trimmed + '-1');
      } catch(_) {
        // Both failed — throw the original error
      }
    }
    throw firstErr;
  }
}

// ─── BrickLink XML Import / Export ───
// Type codes: S=Set, M=Minifig, P=Part, B=Book, G=Gear, C=Catalog, I=Instruction, O=Original Box
const BL_TYPE_TO_APP = { S:'set', M:'minifig', P:'part', B:'set', G:'set', C:'set', I:'set', O:'set' };
const APP_TYPE_TO_BL = { set:'S', minifig:'M', part:'P' };

function parseBricklinkXML(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid XML file. Make sure this is a BrickLink inventory XML.');

  const itemNodes = doc.querySelectorAll('ITEM');
  if (itemNodes.length === 0) throw new Error('No items found. Expected BrickLink inventory format with <INVENTORY> and <ITEM> elements.');

  const items = [];
  itemNodes.forEach(node => {
    const getText = (tag) => { const el = node.querySelector(tag); return el ? el.textContent.trim() : ''; };
    const getNum  = (tag) => { const v = parseFloat(getText(tag)); return isNaN(v) ? 0 : v; };

    const blType      = getText('ITEMTYPE') || 'S';
    const itemId      = getText('ITEMID');
    const colorId     = getText('COLOR');
    const colorName   = getText('COLORNAME');
    const qty         = parseInt(getText('QTY')) || 1;
    const condition   = getText('CONDITION');   // N=New, U=Used
    const price       = getNum('PRICE');
    const notify      = getText('NOTIFY');
    const remarks     = getText('REMARKS');
    const bulk        = getText('BULK');
    const salePercent = getText('SALE');
    const myPrice     = getNum('MYPRICE');
    const itemName    = cleanName(getText('ITEMNAME') || getText('DESCRIPTION'));
    const categoryName= getText('CATEGORYNAME') || getText('CATEGORY') || '';
    const myCost      = getNum('MYCOST');

    let appCondition = 'used_complete';
    if (condition === 'N') appCondition = 'new_sealed';

    const notes = remarks || '';

    items.push({
      id: genId(),
      type: BL_TYPE_TO_APP[blType] || 'part',
      itemNumber: itemId,
      name: itemName,
      theme: categoryName,
      condition: appCondition,
      quantity: qty,
      purchasePrice: myCost || 0,
      estimatedValue: price || myPrice || 0,
      bricklinkPrice: price || 0,
      ebayPrice: 0,
      sellStatus: 'available',
      listPrice: myPrice || price || 0,
      salePrice: 0,
      fees: 0,
      shippingCost: 0,
      platform: '',
      notes,
      imageUrl: '',
      color:    colorName || '',
      blColorId: colorId || '',
      blRemarks: remarks || '',
      blBulk: bulk || '',
      blSalePercent: salePercent || '',
      blNotify: notify || '',
      createdAt: new Date().toISOString(),
    });
  });
  return items;
}

function generateBricklinkXML(items, options = {}) {
  const { forSale = false, includePrice = true } = options;
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<INVENTORY>\n';

  items.forEach(item => {
    const blType = APP_TYPE_TO_BL[item.type] || 'P';
    const cond   = (item.condition === 'new_sealed' || item.condition === 'new_open') ? 'N' : 'U';

    xml += '  <ITEM>\n';
    xml += `    <ITEMTYPE>${blType}</ITEMTYPE>\n`;
    xml += `    <ITEMID>${escapeXml(item.itemNumber)}</ITEMID>\n`;
    if (item.blColorId && item.blColorId !== '0') xml += `    <COLOR>${escapeXml(item.blColorId)}</COLOR>\n`;
    xml += `    <CONDITION>${cond}</CONDITION>\n`;
    xml += `    <QTY>${item.quantity || 1}</QTY>\n`;

    if (includePrice) {
      const price = forSale
        ? (item.listPrice || item.estimatedValue || item.bricklinkPrice || 0)
        : (item.bricklinkPrice || item.estimatedValue || 0);
      if (price > 0) xml += `    <PRICE>${price.toFixed(4)}</PRICE>\n`;
    }
    if (item.purchasePrice > 0)  xml += `    <MYCOST>${item.purchasePrice.toFixed(4)}</MYCOST>\n`;
    if (item.blBulk)             xml += `    <BULK>${escapeXml(item.blBulk)}</BULK>\n`;
    if (item.blSalePercent)      xml += `    <SALE>${escapeXml(item.blSalePercent)}</SALE>\n`;

    const remarks = item.blRemarks || (item.notes ? item.notes.split(' | ')[0] : '');
    if (remarks && !remarks.startsWith('Color')) xml += `    <REMARKS>${escapeXml(remarks)}</REMARKS>\n`;
    if (item.blNotify === 'Y')   xml += `    <NOTIFY>Y</NOTIFY>\n`;
    xml += '  </ITEM>\n';
  });

  xml += '</INVENTORY>';
  return xml;
}

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
