// ─── BrickLink Wanted-List XML helpers ───

function parseWantedListXML(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid XML file.');

  const itemNodes = doc.querySelectorAll('ITEM');
  if (itemNodes.length === 0) throw new Error('No items found in XML.');

  const items = [];
  itemNodes.forEach(node => {
    const getText = (tag) => { const el = node.querySelector(tag); return el ? el.textContent.trim() : ''; };
    const getNum  = (tag) => { const v = parseFloat(getText(tag)); return isNaN(v) ? 0 : v; };

    const blType   = getText('ITEMTYPE') || 'S';
    const itemId   = getText('ITEMID');
    if (!itemId) return;

    const colorId  = getText('COLOR');
    const colorName= getText('COLORNAME');
    const qty      = parseInt(getText('MINQTY') || getText('QTY')) || 1;
    const maxPrice = getNum('MAXPRICE') || getNum('PRICE') || 0;
    const condition= getText('CONDITION') || 'X'; // X = any
    const notify   = getText('NOTIFY') || 'N';
    const remarks  = getText('REMARKS') || '';
    const itemName = cleanName(getText('ITEMNAME') || getText('DESCRIPTION') || '');

    const BL_TYPE_MAP = { S:'set', M:'minifig', P:'part', G:'gear', B:'book', C:'catalog', I:'instruction', O:'original box' };

    items.push({
      id:        genId(),
      type:      BL_TYPE_MAP[blType] || 'part',
      itemNumber: itemId,
      name:      itemName,
      qty:       qty,
      maxPrice:  maxPrice || null,
      colorId:   colorId  || '',
      colorName: colorName|| '',
      condition: condition === 'N' ? 'new' : condition === 'U' ? 'used' : 'any',
      notify:    notify === 'Y',
      remarks:   remarks,
    });
  });
  return items;
}

function generateWantedListXML(items, listName = '') {
  let xml = '<INVENTORY>\n';
  if (listName) xml += `  <!-- ${escapeXml(listName)} -->\n`;
  items.forEach(item => {
    const BL_TYPES = { set:'S', minifig:'M', part:'P', gear:'G', book:'B', catalog:'C', instruction:'I' };
    const blType = BL_TYPES[item.type] || 'P';
    const cond   = item.condition === 'new' ? 'N' : item.condition === 'used' ? 'U' : 'X';

    xml += '  <ITEM>\n';
    xml += `    <ITEMTYPE>${blType}</ITEMTYPE>\n`;
    xml += `    <ITEMID>${escapeXml(item.itemNumber)}</ITEMID>\n`;
    if (item.colorId) xml += `    <COLOR>${escapeXml(item.colorId)}</COLOR>\n`;
    xml += `    <MINQTY>${item.qty || 1}</MINQTY>\n`;
    if (item.maxPrice) xml += `    <MAXPRICE>${Number(item.maxPrice).toFixed(4)}</MAXPRICE>\n`;
    if (cond !== 'X')  xml += `    <CONDITION>${cond}</CONDITION>\n`;
    if (item.notify)   xml += `    <NOTIFY>Y</NOTIFY>\n`;
    if (item.remarks)  xml += `    <REMARKS>${escapeXml(item.remarks)}</REMARKS>\n`;
    xml += '  </ITEM>\n';
  });
  xml += '</INVENTORY>';
  return xml;
}

// ─── Shared: Add-to-Wanted-List button ───
// Drop this anywhere you have access to `data` and `setData`.
// Props:
//   item        – { type, itemNumber, name } (the catalog/inventory item to add)
//   data        – app data object (needs data.wantedLists)
//   setData     – setter for app data
//   buttonStyle – optional extra style for the trigger button
function AddToWantedListButton({ item, data, setData, buttonStyle = {} }) {
  const [open,    setOpen]    = React.useState(false);
  const [added,   setAdded]   = React.useState(null); // listId just added to
  const [newName, setNewName] = React.useState('');
  const ref = React.useRef(null);

  const lists = data?.wantedLists || [];

  // Close on outside click
  React.useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Reset "added" flash after a moment
  React.useEffect(() => {
    if (!added) return;
    const t = setTimeout(() => setAdded(null), 1800);
    return () => clearTimeout(t);
  }, [added]);

  const addToList = (listId) => {
    setData(prev => {
      const lists = prev.wantedLists || [];
      return {
        ...prev,
        wantedLists: lists.map(l => {
          if (l.id !== listId) return l;
          // Don't add duplicates (same type + itemNumber)
          const already = l.items.some(i => i.type === item.type && i.itemNumber === item.itemNumber);
          if (already) return l;
          return { ...l, items: [...l.items, { id: genId(), type: item.type, itemNumber: item.itemNumber, name: item.name || '', qty: 1, maxPrice: null, colorId: '', colorName: '', condition: 'any', notify: false, remarks: '' }] };
        }),
      };
    });
    setAdded(listId);
    setOpen(false);
  };

  const createAndAdd = () => {
    const name   = newName.trim() || `Wanted List ${lists.length + 1}`;
    const listId = genId();
    setData(prev => ({
      ...prev,
      wantedLists: [
        ...(prev.wantedLists || []),
        { id: listId, name, items: [{ id: genId(), type: item.type, itemNumber: item.itemNumber, name: item.name || '', qty: 1, maxPrice: null, colorId: '', colorName: '', condition: 'any', notify: false, remarks: '' }], createdAt: new Date().toISOString() },
      ],
    }));
    setAdded(listId);
    setNewName('');
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className={added ? 'btn btn-secondary btn-sm' : 'btn btn-secondary btn-sm'}
        style={{ fontSize: 11, padding: '2px 8px', whiteSpace: 'nowrap', ...buttonStyle }}
        title="Add to a wanted list"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
      >
        {added ? '✓ Wanted' : '♥ Wanted'}
      </button>

      {open && (
        <div style={{
          position: 'absolute', zIndex: 200, top: '100%', right: 0, marginTop: 4,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,.18)',
          minWidth: 200, padding: '6px 0',
        }}
          onClick={e => e.stopPropagation()}>

          {lists.length > 0 && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px', padding: '4px 12px 2px' }}>Add to list</div>
              {lists.map(l => {
                const already = l.items.some(i => i.type === item.type && i.itemNumber === item.itemNumber);
                return (
                  <button key={l.id}
                    onClick={() => !already && addToList(l.id)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '6px 12px', background: 'none', border: 'none',
                      fontSize: 13, cursor: already ? 'default' : 'pointer',
                      color: already ? 'var(--text3)' : 'var(--text)',
                      opacity: already ? 0.6 : 1,
                    }}>
                    {already ? '✓ ' : ''}{l.name}
                    <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text3)' }}>({l.items.length})</span>
                  </button>
                );
              })}
              <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
            </>
          )}

          <div style={{ padding: '4px 8px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4, paddingLeft: 4 }}>New list</div>
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                autoFocus={lists.length === 0}
                placeholder="List name…"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') createAndAdd(); if (e.key === 'Escape') setOpen(false); }}
                style={{ flex: 1, fontSize: 12, padding: '4px 6px' }}
              />
              <button className="btn btn-primary btn-sm"
                style={{ fontSize: 11, padding: '4px 8px', flexShrink: 0 }}
                onClick={createAndAdd}>
                + Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Add / Edit Item Modal ───
function WantedItemModal({ item, onSave, onClose }) {
  const isEdit = !!item;
  const [form, setForm] = React.useState(item || {
    type: 'set', itemNumber: '', name: '', qty: 1,
    maxPrice: '', colorId: '', colorName: '', condition: 'any',
    notify: false, remarks: '',
  });
  const [lookupStatus, setLookupStatus] = React.useState('');
  const [lookupMsg,    setLookupMsg]    = React.useState('');

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const doLookup = async () => {
    if (!form.itemNumber.trim()) { setLookupMsg('Enter an item number first.'); setLookupStatus('error'); return; }
    setLookupStatus('loading'); setLookupMsg('Looking up…');
    try {
      const info = await lookupItemBrickLink(form.type, form.itemNumber.trim(), form.colorId || '');
      setForm(f => ({
        ...f,
        name:      info.name     || f.name,
        colorName: info.color    || f.colorName,
        colorId:   info.colorId  || f.colorId,
      }));
      setLookupStatus('success');
      setLookupMsg(info.name ? `Found: ${info.name}` : 'Found item but no name returned.');
    } catch(e) {
      setLookupStatus('error'); setLookupMsg(e.message);
    }
  };

  const handleSave = () => {
    if (!form.itemNumber.trim()) { alert('Item number is required.'); return; }
    onSave({
      ...form,
      itemNumber: form.itemNumber.trim(),
      qty:      parseInt(form.qty)      || 1,
      maxPrice: form.maxPrice !== '' ? parseFloat(form.maxPrice) || null : null,
      id:       form.id || genId(),
    });
  };

  const statusColor = lookupStatus === 'success' ? 'var(--green)' : lookupStatus === 'error' ? 'var(--red)' : 'var(--text2)';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{maxWidth:480}}>
        <div className="modal-header">
          <h2>{isEdit ? 'Edit Wanted Item' : 'Add Wanted Item'}</h2>
          <button className="btn-icon" onClick={onClose}>{Icons.x}</button>
        </div>
        <div className="modal-body" style={{padding:'16px 20px',display:'flex',flexDirection:'column',gap:12}}>

          {/* Type + Item Number */}
          <div className="form-row">
            <div className="form-group" style={{marginBottom:0,flex:'0 0 130px'}}>
              <label>Type</label>
              <select value={form.type} onChange={e => set('type', e.target.value)}>
                <option value="set">Set</option>
                <option value="minifig">Minifig</option>
                <option value="part">Part</option>
                <option value="gear">Gear</option>
                <option value="book">Book</option>
              </select>
            </div>
            <div className="form-group" style={{marginBottom:0,flex:1}}>
              <label>Item Number</label>
              <div style={{display:'flex',gap:6}}>
                <input style={{flex:1}}
                  placeholder={form.type === 'set' ? 'e.g. 75192-1' : form.type === 'minifig' ? 'e.g. sw0001' : 'e.g. 3001'}
                  value={form.itemNumber}
                  onChange={e => set('itemNumber', e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); doLookup(); }}}
                />
                <button className="btn btn-secondary btn-sm" onClick={doLookup}
                  disabled={lookupStatus === 'loading'} style={{whiteSpace:'nowrap',flexShrink:0}}>
                  {lookupStatus === 'loading' ? '…' : `${Icons.search} Lookup`}
                </button>
              </div>
              {lookupMsg && <div style={{marginTop:3,fontSize:11,color:statusColor}}>{lookupMsg}</div>}
            </div>
          </div>

          {/* Name */}
          <div className="form-group" style={{marginBottom:0}}>
            <label>Name <span style={{color:'var(--text3)',fontWeight:400}}>(auto-filled by lookup)</span></label>
            <input placeholder="e.g. Millennium Falcon" value={form.name} onChange={e => set('name', e.target.value)} />
          </div>

          {/* Qty + Max Price */}
          <div className="form-row">
            <div className="form-group" style={{marginBottom:0}}>
              <label>Qty Wanted</label>
              <input type="number" min="1" value={form.qty} onChange={e => set('qty', e.target.value)} />
            </div>
            <div className="form-group" style={{marginBottom:0}}>
              <label>Max Price ($)</label>
              <input type="number" step="0.01" min="0" placeholder="any" value={form.maxPrice ?? ''} onChange={e => set('maxPrice', e.target.value)} />
            </div>
            <div className="form-group" style={{marginBottom:0}}>
              <label>Condition</label>
              <select value={form.condition} onChange={e => set('condition', e.target.value)}>
                <option value="any">Any</option>
                <option value="new">New</option>
                <option value="used">Used</option>
              </select>
            </div>
          </div>

          {/* Color (parts) */}
          {(form.type === 'part' || form.colorId) && (
            <div className="form-row">
              <div className="form-group" style={{marginBottom:0}}>
                <label>Color ID <span style={{color:'var(--text3)',fontWeight:400}}>(BrickLink)</span></label>
                <input placeholder="e.g. 11" value={form.colorId} onChange={e => set('colorId', e.target.value)} />
              </div>
              <div className="form-group" style={{marginBottom:0}}>
                <label>Color Name</label>
                <input placeholder="e.g. Black" value={form.colorName} onChange={e => set('colorName', e.target.value)} />
              </div>
            </div>
          )}

          {/* Remarks + Notify */}
          <div className="form-group" style={{marginBottom:0}}>
            <label>Remarks</label>
            <input placeholder="Optional notes for BrickLink" value={form.remarks} onChange={e => set('remarks', e.target.value)} />
          </div>
          <label style={{display:'flex',alignItems:'center',gap:8,fontSize:13,cursor:'pointer',userSelect:'none'}}>
            <input type="checkbox" checked={!!form.notify} onChange={e => set('notify', e.target.checked)} />
            Notify me when available (BrickLink)
          </label>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>{isEdit ? 'Save Changes' : 'Add Item'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Wanted List → Sales Order Modal ───
// Matches wanted list items against inventory, shows prices, allows global override,
// and generates a printable BrickLink-style order summary.
function WantedToOrderModal({ list, inventoryItems, updateItems, setData, blConfigured, settings, onClose }) {
  const [globalOverride, setGlobalOverride] = React.useState('');
  const [buyerName,      setBuyerName]      = React.useState('');
  const [orderNote,      setOrderNote]      = React.useState('');
  const [shipping,       setShipping]       = React.useState('');
  const [fees,           setFees]           = React.useState('');
  const [importState,    setImportState]    = React.useState({ status: 'idle', message: '' });
  // status: idle | importing | bl_removing | done | error

  // ── Item matching (same logic used by BL order import) ──
  const normNum = (type, num) => {
    const raw = String(num || '').trim().toUpperCase();
    return (type || '').toLowerCase() === 'set' ? raw.replace(/-\d+$/, '') : raw;
  };

  const matchResult = React.useMemo(() => {
    const pool = (inventoryItems || [])
      .filter(inv => inv.sellStatus !== 'sold')
      .map(inv => ({ item: inv, remaining: Number(inv.quantity) || 1 }));

    const rows = [];

    for (const wanted of list.items) {
      const wantedNum  = String(wanted.itemNumber || '').trim().toUpperCase();
      const wantedType = wanted.type || 'set';
      const wantedQty  = Number(wanted.qty) || 1;
      const wantedColorId = String(wanted.colorId || '').trim();
      const wantedCond    = wanted.condition; // 'new'|'used'|'any'

      // Score candidates
      const score = (cand) => {
        const inv = cand.item;
        let s = 0;
        const invNum = String(inv.itemNumber || '').trim().toUpperCase();
        if (invNum && invNum === wantedNum) s += 80;
        if (normNum(inv.type, inv.itemNumber) === normNum(wantedType, wantedNum)) s += 40;
        const invColor = String(inv.blColorId || inv.colorId || '').trim();
        if (wantedColorId && invColor && invColor === wantedColorId) s += 30;
        if ((inv.sellStatus || 'available') === 'listed') s += 20;
        return s;
      };

      const matches = (cand) => {
        if (cand.remaining <= 0) return false;
        const inv = cand.item;
        if ((inv.type || 'set') !== wantedType) return false;
        const invNum = String(inv.itemNumber || '').trim().toUpperCase();
        const exactNum  = invNum && wantedNum && invNum === wantedNum;
        const baseNum   = normNum(inv.type, inv.itemNumber) === normNum(wantedType, wantedNum);
        if (!exactNum && !baseNum) return false;
        // Color: if wanted has a specific colorId and inventory item has a different colorId, skip
        if (wantedType === 'part' && wantedColorId && wantedColorId !== '0') {
          const invColor = String(inv.blColorId || inv.colorId || '').trim();
          if (invColor && invColor !== wantedColorId) return false;
        }
        // Condition: skip if mismatch
        if (wantedCond === 'new' && !['new_sealed','new_open'].includes(inv.condition)) return false;
        if (wantedCond === 'used' && !['used_complete','used_incomplete'].includes(inv.condition)) return false;
        return true;
      };

      const candidates = pool.filter(matches).sort((a, b) => score(b) - score(a));
      let needed = wantedQty;
      const allocations = [];

      for (const cand of candidates) {
        if (needed <= 0) break;
        const take = Math.min(cand.remaining, needed);
        cand.remaining -= take;
        needed -= take;
        allocations.push({ item: cand.item, qty: take });
      }

      rows.push({
        wanted,
        allocations,
        matchedQty:   allocations.reduce((s, a) => s + a.qty, 0),
        unmatchedQty: needed,
      });
    }

    return rows;
  }, [list, inventoryItems]);

  const overrideVal = globalOverride !== '' ? parseFloat(globalOverride) : null;
  const isValidOverride = overrideVal !== null && !isNaN(overrideVal) && overrideVal >= 0;

  // Price priority: BrickLink listed price → any list price → suggested (price guide) → estimated value
  const itemPrice = (item) => {
    if (item.itemNumber === 'sw0056') {
      console.log('sw0056 raw item:', JSON.stringify({
        listPrice: item.listPrice,
        platformPrices: item.platformPrices,
        estimatedValue: item.estimatedValue,
        bricklinkMedian: item.bricklinkMedian,
        bricklinkActiveMedian: item.bricklinkActiveMedian,
        sellStatus: item.sellStatus,
        platform: item.platform,
      }));
    }
    // Find BrickLink price regardless of key casing (could be 'bricklink', 'BrickLink', etc.)
    const pp = item.platformPrices || {};
    const blKey = Object.keys(pp).find(k => k.toLowerCase().replace(/\s+/g, '') === 'bricklink');
    const blPrice = blKey != null ? pp[blKey] : undefined;
    if (blPrice != null && Number(blPrice) > 0) return Number(blPrice);
    const lp = item.listPrice;
    if (lp != null && Number(lp) > 0) return Number(lp);
    const suggested = suggestedPrice(item);
    if (suggested != null && suggested > 0) return suggested;
    return Number(item.estimatedValue || 0);
  };

  const orderRows = React.useMemo(() => {
    // Build base rows using listed prices
    const base = [];
    for (const row of matchResult) {
      for (const alloc of row.allocations) {
        const listedUnit = itemPrice(alloc.item);
        base.push({
          wanted:      row.wanted,
          inv:         alloc.item,
          qty:         alloc.qty,
          listedUnit,
          unitPrice:   listedUnit,
        });
      }
    }

    if (!isValidOverride || base.length === 0) return base;

    // Override is a grand total — distribute proportionally by (listedUnit × qty).
    // If all listed prices are zero, divide equally across all line quantities.
    const listedTotal = base.reduce((s, r) => s + r.listedUnit * r.qty, 0);
    const grandTotal  = overrideVal;

    return base.map(r => {
      let unitPrice;
      if (listedTotal > 0) {
        // Each line's share = its fraction of the listed total × grand total, then per-unit
        const lineShare = (r.listedUnit * r.qty) / listedTotal * grandTotal;
        unitPrice = lineShare / r.qty;
      } else {
        // No price data: split equally across every item unit
        const totalUnits = base.reduce((s, row) => s + row.qty, 0);
        unitPrice = grandTotal / totalUnits;
      }
      return { ...r, unitPrice: Math.round(unitPrice * 100) / 100 };
    });
  }, [matchResult, overrideVal, isValidOverride]);

  // Map inv.id → unitPrice for use in the table render (which iterates matchResult, not orderRows)
  const unitPriceMap  = React.useMemo(() => {
    const m = new Map();
    for (const r of orderRows) m.set(r.inv.id, r.unitPrice);
    return m;
  }, [orderRows]);

  const shippingVal   = parseFloat(shipping) || 0;
  const feesVal       = parseFloat(fees)     || 0;
  const subTotal      = orderRows.reduce((s, r) => s + r.unitPrice * r.qty, 0);
  const totalItems    = orderRows.reduce((s, r) => s + r.qty, 0);
  const matchedLines  = matchResult.filter(r => r.matchedQty > 0).length;
  const unmatchedLines= matchResult.filter(r => r.unmatchedQty > 0).length;

  const condLabel = (c) => c === 'new' ? 'New' : c === 'used' ? 'Used' : 'Any';
  const invCondLabel = (c) => ({ new_sealed:'New/Sealed', new_open:'New/Open', used_complete:'Used-Complete', used_incomplete:'Used-Incomplete' })[c] || c || '—';

  // ── Import Sale: mark items sold + remove from BrickLink store ──
  const importSale = async () => {
    if (!orderRows.length) return;
    if (importState.status === 'importing' || importState.status === 'bl_removing') return;

    const unmatched = matchResult.filter(r => r.unmatchedQty > 0);
    if (unmatched.length) {
      const ok = confirm(
        `Record sale for ${orderRows.length} matched allocation${orderRows.length !== 1 ? 's' : ''}?\n` +
        `${unmatched.length} line${unmatched.length !== 1 ? 's are' : ' is'} not in inventory and will be skipped.`
      );
      if (!ok) return;
    }

    setImportState({ status: 'importing', message: 'Recording sale in inventory…' });

    const now = new Date().toISOString();
    const noteParts = [
      'Sales order from wanted list',
      list.name ? `"${list.name}"` : null,
      buyerName  ? `buyer: ${buyerName}` : null,
      orderNote  ? orderNote : null,
    ].filter(Boolean);

    // ── Step 1: mark items sold in local data ──
    // Capture the BrickLink inventory IDs we need to touch for step 2
    const blUpdates = []; // { inventoryId, newQty }

    updateItems(prev => {
      const soldItems = prev.filter(i => i.sellStatus === 'sold');
      const activeMap = new Map(
        prev.filter(i => i.sellStatus !== 'sold').map(i => [i.id, { ...i }])
      );
      const newSold = [];

      for (const row of orderRows) {
        const current = activeMap.get(row.inv.id);
        if (!current) continue;
        const total    = Number(current.quantity) || 1;
        const qtySold  = row.qty;
        const saleNote = [current.notes, noteParts.join(' | ')].filter(Boolean).join(current.notes ? ' | ' : '');

        // Distribute shipping + fees proportionally by this row's share of the subtotal
        const rowTotal   = row.unitPrice * row.qty;
        const shareRatio = subTotal > 0 ? rowTotal / subTotal : (orderRows.length > 0 ? 1 / orderRows.length : 0);
        const rowShip    = Math.round(shippingVal * shareRatio * 100) / 100;
        const rowFees    = Math.round(feesVal     * shareRatio * 100) / 100;

        const soldRecord = {
          ...current,
          sellStatus:   'sold',
          salePrice:    row.unitPrice,
          fees:         rowFees,
          shippingCost: rowShip,
          platform:     'BrickLink',
          notes:        saleNote,
          updatedAt:    now,
        };

        if (qtySold >= total) {
          activeMap.delete(current.id);
          newSold.push(soldRecord);
          // Schedule full BL removal
          if (current.bricklinkInventoryId) {
            blUpdates.push({ inventoryId: current.bricklinkInventoryId, newQty: 0 });
          }
        } else {
          const remaining = total - qtySold;
          activeMap.set(current.id, { ...current, quantity: remaining, updatedAt: now });
          newSold.push({ ...soldRecord, id: genId(), quantity: qtySold, createdAt: now });
          // Schedule partial BL quantity reduction
          if (current.bricklinkInventoryId) {
            blUpdates.push({ inventoryId: current.bricklinkInventoryId, newQty: remaining });
          }
        }
      }

      return [...Array.from(activeMap.values()), ...soldItems, ...newSold];
    });

    // ── Step 1b: save order record ──
    const orderRecord = {
      id:          genId(),
      createdAt:   now,
      listName:    list.name,
      buyerName:   buyerName.trim() || null,
      note:        orderNote.trim()  || null,
      subtotal:    subTotal,
      shipping:    shippingVal || null,
      fees:        feesVal     || null,
      grandTotal:  subTotal + shippingVal + feesVal,
      totalItems,
      lines: orderRows.map(r => ({
        itemId:      r.inv.id,
        itemNumber:  r.inv.itemNumber || r.wanted.itemNumber,
        name:        r.wanted.name || r.inv.name || r.wanted.itemNumber,
        type:        r.inv.type || r.wanted.type,
        colorName:   r.inv.color || r.inv.colorName || r.wanted.colorName || null,
        condition:   r.inv.condition || null,
        qty:         r.qty,
        listedUnit:  r.listedUnit,
        unitPrice:   r.unitPrice,
        lineTotal:   Math.round(r.unitPrice * r.qty * 100) / 100,
      })),
    };
    setData(prev => ({ ...prev, salesOrders: [orderRecord, ...(prev.salesOrders || [])] }));

    // ── Step 2: update BrickLink store (if configured) ──
    if (blConfigured && blUpdates.length > 0) {
      setImportState({ status: 'bl_removing', message: `Updating BrickLink store (0 / ${blUpdates.length})…` });
      let done = 0;
      const errors = [];
      for (const { inventoryId, newQty } of blUpdates) {
        try {
          const resp = await fetch('/api/bricklink/store/update-quantity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ inventory_id: inventoryId, quantity: newQty }),
          });
          const data = await resp.json();
          if (!resp.ok || data.error) errors.push(`ID ${inventoryId}: ${data.error || resp.status}`);
        } catch (e) {
          errors.push(`ID ${inventoryId}: ${e.message}`);
        }
        done++;
        setImportState({ status: 'bl_removing', message: `Updating BrickLink store (${done} / ${blUpdates.length})…` });
      }

      if (errors.length) {
        setImportState({
          status: 'error',
          message: `Sale recorded. BrickLink store errors (${errors.length}): ${errors.join('; ')}`,
        });
        return;
      }
    }

    setImportState({
      status: 'done',
      message: `Sale recorded — ${orderRows.length} item${orderRows.length !== 1 ? 's' : ''} marked sold${blConfigured && blUpdates.length ? `, ${blUpdates.length} BrickLink listing${blUpdates.length !== 1 ? 's' : ''} updated` : ''}.`,
    });
  };

  // ── Print / copy summary ──
  const orderDate = new Date().toLocaleDateString();

  const summaryText = React.useMemo(() => {
    const shopName = settings?.shopName?.trim();
    const lines = [
      shopName ? shopName : null,
      shopName ? '='.repeat(Math.min(shopName.length, 74)) : null,
      `Sales Order — ${list.name}`,
      `Date: ${orderDate}`,
      buyerName ? `Buyer: ${buyerName}` : null,
      orderNote  ? `Note: ${orderNote}` : null,
      '',
      'Item'.padEnd(30) + 'Cond'.padEnd(16) + 'Qty'.padEnd(6) + 'Unit Price'.padEnd(12) + 'Line Total',
      '-'.repeat(74),
    ];
    for (const r of orderRows) {
      const name     = (r.wanted.name || r.inv.name || r.wanted.itemNumber || '').slice(0, 28);
      const cond     = invCondLabel(r.inv.condition).slice(0, 14);
      const qty      = String(r.qty).padEnd(6);
      const unit     = `$${r.unitPrice.toFixed(2)}`.padEnd(12);
      const total    = `$${(r.unitPrice * r.qty).toFixed(2)}`;
      lines.push(name.padEnd(30) + cond.padEnd(16) + qty + unit + total);
    }
    lines.push('-'.repeat(74));
    lines.push('');
    lines.push(`Items: ${totalItems}   Subtotal: $${subTotal.toFixed(2)}`);
    if (shippingVal > 0) lines.push(`Shipping: $${shippingVal.toFixed(2)}`);
    if (feesVal     > 0) lines.push(`Fees: $${feesVal.toFixed(2)}`);
    if (shippingVal > 0 || feesVal > 0) lines.push(`Grand Total: $${(subTotal + shippingVal + feesVal).toFixed(2)}`);
    return lines.filter(l => l !== null).join('\n');
  }, [orderRows, subTotal, totalItems, shippingVal, feesVal, buyerName, orderNote, list.name, settings]);

  const copySummary = async () => {
    try { await navigator.clipboard.writeText(summaryText); alert('Order summary copied to clipboard!'); }
    catch { alert('Could not copy — please select and copy the text manually.'); }
  };

  const printSummary = () => {
    const win = window.open('', '_blank', 'width=700,height=600');
    if (!win) { alert('Pop-up blocked. Allow pop-ups and try again.'); return; }
    win.document.write(`<!DOCTYPE html><html><head><title>Sales Order — ${list.name}</title>
      <style>
        html, body { margin: 0; padding: 0; }
        body { font-family: monospace; font-size: 13px; white-space: pre-wrap; line-height: 1.6; }
        .page { padding: 24px; transform: rotate(180deg); transform-origin: center center; }
        @page { margin: 1cm; }
        @media print {
          html, body { height: 100%; }
          .page { min-height: 100vh; box-sizing: border-box; }
        }
      </style></head><body>
      <div class="page"><pre>${summaryText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre></div>
      <script>window.print();<\/script></body></html>`);
    win.document.close();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 820 }}>
        <div className="modal-header">
          <h2>Sales Order — {list.name}</h2>
          <button className="btn-icon" onClick={onClose}>{Icons.x}</button>
        </div>

        <div className="modal-body" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Config row */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ marginBottom: 0, flex: '1 1 180px' }}>
              <label>Buyer name <span style={{ fontWeight: 400, color: 'var(--text3)' }}>(optional)</span></label>
              <input placeholder="e.g. jsmith42" value={buyerName} onChange={e => setBuyerName(e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: 0, flex: '2 1 240px' }}>
              <label>Order note <span style={{ fontWeight: 400, color: 'var(--text3)' }}>(optional)</span></label>
              <input placeholder="e.g. agreed price via Reddit DM" value={orderNote} onChange={e => setOrderNote(e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: 0, flex: '0 1 180px' }}>
              <label>
                Total price override ($)
                <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 400, color: 'var(--text3)' }}>
                  (split by listed price)
                </span>
              </label>
              <input
                type="number" step="0.01" min="0" placeholder="use listed prices"
                value={globalOverride}
                onChange={e => setGlobalOverride(e.target.value)}
                style={{ maxWidth: 160 }}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0, flex: '0 1 130px' }}>
              <label>Shipping ($)</label>
              <input
                type="number" step="0.01" min="0" placeholder="0.00"
                value={shipping}
                onChange={e => setShipping(e.target.value)}
                style={{ maxWidth: 120 }}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0, flex: '0 1 130px' }}>
              <label>Fees ($)</label>
              <input
                type="number" step="0.01" min="0" placeholder="0.00"
                value={fees}
                onChange={e => setFees(e.target.value)}
                style={{ maxWidth: 120 }}
              />
            </div>
          </div>

          {/* Stats row */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: 'var(--text2)' }}>
            <span>
              <strong style={{ color: 'var(--green)' }}>{matchedLines}</strong> / {matchResult.length} lines matched
            </span>
            {unmatchedLines > 0 && (
              <span style={{ color: 'var(--orange)' }}>⚠ {unmatchedLines} line{unmatchedLines !== 1 ? 's' : ''} not in inventory</span>
            )}
            {isValidOverride && (
              <span style={{ color: 'var(--accent)' }}>⚡ Grand total override: {currency(overrideVal)} — distributed by listed price</span>
            )}
          </div>

          {/* Match table */}
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', maxHeight: 360, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--surface2)' }}>
                  {['Item', 'Inv. Condition', 'Listed Price', 'Qty', 'Unit Price', 'Line Total', 'Status'].map(h => (
                    <th key={h} style={{ padding: '7px 10px', textAlign: h === 'Qty' || h === 'Unit Price' || h === 'Line Total' || h === 'Listed Price' ? 'right' : 'left', fontWeight: 600, color: 'var(--text2)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.4px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matchResult.map((row, ri) => {
                  if (row.allocations.length === 0) {
                    return (
                      <tr key={row.wanted.id || ri} style={{ background: ri % 2 === 0 ? 'transparent' : 'rgba(0,0,0,.025)', borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '7px 10px', color: 'var(--text)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <span style={{ fontWeight: 500 }}>{row.wanted.name || row.wanted.itemNumber}</span>
                          <br /><span style={{ fontSize: 11, color: 'var(--text3)' }}>{row.wanted.itemNumber}</span>
                        </td>
                        <td style={{ padding: '7px 10px', color: 'var(--text3)' }}>—</td>
                        <td style={{ padding: '7px 10px', color: 'var(--text3)' }}>—</td>
                        <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text3)' }}>{row.wanted.qty || 1}</td>
                        <td colSpan={2} style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text3)' }}>—</td>
                        <td style={{ padding: '7px 10px' }}><span style={{ fontSize: 11, color: 'var(--orange)', fontWeight: 600 }}>Not in inventory</span></td>
                      </tr>
                    );
                  }
                  return row.allocations.map((alloc, ai) => {
                    const unit  = unitPriceMap.get(alloc.item.id) ?? 0;
                    const total = unit * alloc.qty;
                    const isFirst = ai === 0;
                    return (
                      <tr key={`${row.wanted.id || ri}-${ai}`} style={{ background: ri % 2 === 0 ? 'transparent' : 'rgba(0,0,0,.025)', borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '7px 10px', color: 'var(--text)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {isFirst && (
                            <>
                              <span style={{ fontWeight: 500 }}>{row.wanted.name || alloc.item.name || row.wanted.itemNumber}</span>
                              <br /><span style={{ fontSize: 11, color: 'var(--text3)' }}>{row.wanted.itemNumber}{row.wanted.colorName ? ` · ${row.wanted.colorName}` : ''}</span>
                            </>
                          )}
                        </td>
                        <td style={{ padding: '7px 10px', color: 'var(--text2)', whiteSpace: 'nowrap', fontSize: 12 }}>{invCondLabel(alloc.item.condition)}</td>
                        <td style={{ padding: '7px 10px', color: 'var(--text2)', fontSize: 12, textAlign: 'right' }}>
                          {isFirst
                            ? (() => {
                                const p = itemPrice(alloc.item);
                                const isBL = !!alloc.item.platformPrices?.bricklink;
                                return p > 0
                                  ? <span title={isBL ? 'BrickLink listed price' : 'List / suggested price'}>{currency(p)}{isBL ? <span style={{fontSize:9,marginLeft:3,color:'var(--blue)'}}>BL</span> : null}</span>
                                  : <span style={{ color: 'var(--text3)' }}>—</span>;
                              })()
                            : ''}
                        </td>
                        <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 600 }}>{alloc.qty}</td>
                        <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text2)' }}>
                          {unit > 0 ? currency(unit) : <span style={{ color: 'var(--text3)' }}>—</span>}
                        </td>
                        <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 600, color: 'var(--accent)' }}>
                          {unit > 0 ? currency(total) : <span style={{ color: 'var(--text3)' }}>—</span>}
                        </td>
                        <td style={{ padding: '7px 10px' }}>
                          {isFirst && (
                            row.unmatchedQty > 0
                              ? <span style={{ fontSize: 11, color: 'var(--orange)' }}>Partial ({row.matchedQty}/{row.wanted.qty || 1})</span>
                              : <span style={{ fontSize: 11, color: 'var(--green)' }}>✓ Matched</span>
                          )}
                        </td>
                      </tr>
                    );
                  });
                })}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          {orderRows.length > 0 && (
            <div style={{ display: 'flex', gap: 24, alignItems: 'baseline', padding: '10px 14px', background: 'var(--surface2)', borderRadius: 8, flexWrap: 'wrap' }}>
              <div>
                <span style={{ fontSize: 11, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.4px', fontWeight: 600 }}>Items </span>
                <span style={{ fontSize: 20, fontWeight: 700 }}>{totalItems}</span>
              </div>
              <div>
                <span style={{ fontSize: 11, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.4px', fontWeight: 600 }}>Subtotal </span>
                <span style={{ fontSize: 18, fontWeight: 700 }}>{currency(subTotal)}</span>
              </div>
              {shippingVal > 0 && (
                <div>
                  <span style={{ fontSize: 11, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.4px', fontWeight: 600 }}>Shipping </span>
                  <span style={{ fontSize: 18, fontWeight: 700 }}>{currency(shippingVal)}</span>
                </div>
              )}
              {feesVal > 0 && (
                <div>
                  <span style={{ fontSize: 11, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.4px', fontWeight: 600 }}>Fees </span>
                  <span style={{ fontSize: 18, fontWeight: 700 }}>{currency(feesVal)}</span>
                </div>
              )}
              <div>
                <span style={{ fontSize: 11, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.4px', fontWeight: 600 }}>Grand Total </span>
                <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>{currency(subTotal + shippingVal + feesVal)}</span>
              </div>
              {isValidOverride && (
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                  (override total: {currency(overrideVal)})
                </div>
              )}
            </div>
          )}

          {orderRows.length === 0 && (
            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text3)', fontSize: 13 }}>
              No items from this wanted list were found in your inventory.
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
          {orderRows.length > 0 && (
            <>
              <button className="btn btn-secondary" onClick={copySummary}
                style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                📋 Copy Summary
              </button>
              <button className="btn btn-secondary" onClick={printSummary}
                style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                🖨 Print / Save
              </button>
            </>
          )}
          {importState.message && (
            <span style={{
              fontSize: 12, flex: '1 1 100%', order: 10,
              color: importState.status === 'done'  ? 'var(--green)'
                   : importState.status === 'error' ? 'var(--red)'
                   : 'var(--text2)',
            }}>
              {importState.message}
            </span>
          )}
          {orderRows.length > 0 && importState.status !== 'done' && (
            <button
              className="btn btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 'auto' }}
              disabled={importState.status === 'importing' || importState.status === 'bl_removing'}
              onClick={importSale}
              title="Mark matched items as sold and remove them from your BrickLink store"
            >
              {importState.status === 'importing' ? '⏳ Recording…'
               : importState.status === 'bl_removing' ? '⏳ Updating BL…'
               : '✓ Import Sale'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───
function WantedListPage({ data, setData, items: inventoryItems, settings, updateItems, blConfigured }) {
  // wantedLists: [ { id, name, items: [...] } ]
  const lists = React.useMemo(() => data.wantedLists || [], [data.wantedLists]);
  const typeColumn  = !!settings?.typeColumn;
  const blIdColumn  = !!settings?.blIdColumn;
  const colorColumn = !!settings?.colorColumn;
  const blCountryCode = settings?.blCountryCode !== undefined ? settings.blCountryCode : 'US';

  const updateLists = React.useCallback((fn) => {
    setData(prev => ({ ...prev, wantedLists: fn(prev.wantedLists || []) }));
  }, [setData]);

  const [activeListId, setActiveListId] = React.useState(null);
  const [newListName,  setNewListName]  = React.useState('');
  const [editingListId, setEditingListId] = React.useState(null);
  const [editingListName, setEditingListName] = React.useState('');
  const [editingItem, setEditingItem] = React.useState(null); // { listId, item } | null
  const [addingToList, setAddingToList] = React.useState(null); // listId | null
  const [search, setSearch] = React.useState('');
  const [collapsedGroups, setCollapsedGroups] = React.useState({});
  const [salesOrderOpen, setSalesOrderOpen] = React.useState(false);
  const importRef = React.useRef(null);
  const importListRef = React.useRef(null);

  // ─── Price fetching ───
  // priceCache: "type:itemNumber" → { status:'fetching'|'done'|'error', suggested, soldMedian, activeMedian }
  const [priceCache, setPriceCache] = React.useState({});
  const [batchStatus,   setBatchStatus]   = React.useState('idle'); // idle|running|done
  const [batchProgress, setBatchProgress] = React.useState('');
  const batchCancelRef = React.useRef(false);

  const priceKeyFor = React.useCallback((item) => {
    const cond = item.condition === 'new' ? 'N' : 'U';
    return [item.type, item.itemNumber, item.colorId || '', cond, blCountryCode || ''].join(':');
  }, [blCountryCode]);

  const fetchSuggestedPrice = React.useCallback(async (item) => {
    const key = priceKeyFor(item);
    setPriceCache(prev => ({ ...prev, [key]: { status: 'fetching' } }));
    try {
      const cond = item.condition === 'new' ? 'N' : 'U';
      const paramsFor = (guide, newOrUsed) => {
        const params = new URLSearchParams({
          type: item.type,
          itemNumber: item.itemNumber,
          guide,
          newOrUsed,
          filterOutliers: 'true',
          countryCode: blCountryCode || '',
        });
        if (item.colorId) params.set('colorId', item.colorId);
        return params;
      };

      const [soldResp, activeResp] = await Promise.allSettled([
        fetch(`/api/bricklink/price?${paramsFor('sold', cond)}`).then(r => r.json()),
        fetch(`/api/bricklink/price?${paramsFor('stock', cond)}`).then(r => r.json()),
      ]);
      let sold   = soldResp.status   === 'fulfilled' && !soldResp.value.error   ? soldResp.value   : null;
      const active = activeResp.status === 'fulfilled' && !activeResp.value.error ? activeResp.value : null;
      let priceEstimated = null;

      // Match Price Guide item fetch behavior: if no sold data exists for the
      // selected condition, estimate from the opposite condition.
      if (!sold?.avg) {
        const oppositeCondition = cond === 'U' ? 'N' : 'U';
        try {
          const resp = await fetch(`/api/bricklink/price?${paramsFor('sold', oppositeCondition)}`);
          const fallback = await resp.json();
          if (resp.ok && !fallback.error && fallback.avg != null) {
            const scale = cond === 'U' ? 0.6 : 1.4;
            sold = {
              ...fallback,
              avg:    fallback.avg    != null ? Math.round(fallback.avg    * scale * 100) / 100 : null,
              median: fallback.median != null ? Math.round(fallback.median * scale * 100) / 100 : null,
            };
            priceEstimated = cond === 'U' ? 'used_from_new' : 'new_from_used';
          }
        } catch(e) {}
      }

      const synthetic = {
        bricklinkMedian:       sold?.median   ?? null,
        bricklinkActiveMedian: active?.median ?? null,
        bricklinkActive:       active?.avg    ?? null,
        bricklinkPriceEstimated: priceEstimated,
        priceHistory: [],
      };
      const suggested = suggestedPrice(synthetic);
      setPriceCache(prev => ({ ...prev, [key]: { status: 'done', suggested, soldMedian: sold?.median ?? null, activeMedian: active?.median ?? null, activeAvg: active?.avg ?? null, estimated: priceEstimated } }));
    } catch(e) {
      setPriceCache(prev => ({ ...prev, [key]: { status: 'error' } }));
    }
  }, [blCountryCode, priceKeyFor]);

  const fetchAllPrices = React.useCallback(async (items) => {
    batchCancelRef.current = false;
    setBatchStatus('running');
    for (let i = 0; i < items.length; i++) {
      if (batchCancelRef.current) { setBatchStatus('idle'); setBatchProgress(''); return; }
      setBatchProgress(`${i + 1} / ${items.length}`);
      await fetchSuggestedPrice(items[i]);
      if (i < items.length - 1) await new Promise(r => setTimeout(r, 350));
    }
    setBatchStatus('done');
    setBatchProgress('');
  }, [fetchSuggestedPrice]);

  // Auto-select first list
  React.useEffect(() => {
    if (!activeListId && lists.length > 0) setActiveListId(lists[0].id);
    if (activeListId && !lists.find(l => l.id === activeListId) && lists.length > 0) {
      setActiveListId(lists[0].id);
    }
  }, [lists, activeListId]);

  const activeList = lists.find(l => l.id === activeListId) || null;

  const inventoryStock = React.useMemo(() => {
    const keyFor = (type, itemNumber) => `${type || ''}:${String(itemNumber || '').trim().toUpperCase()}`;
    const keysFor = (type, itemNumber) => {
      const raw = String(itemNumber || '').trim().toUpperCase();
      if (!raw) return [];
      const keys = new Set([keyFor(type, raw)]);

      // BrickLink numeric sets are often stored with "-1"; keep IDs like col19-3 exact.
      if (type === 'set' && /^\d+-1$/.test(raw)) {
        keys.add(keyFor(type, raw.replace(/-1$/, '')));
      }
      return [...keys];
    };

    const stock = new Map();
    for (const inv of inventoryItems || []) {
      if (!inv?.itemNumber || inv.sellStatus === 'sold') continue;
      const qty = inv.quantity || 1;
      for (const key of keysFor(inv.type, inv.itemNumber)) {
        stock.set(key, (stock.get(key) || 0) + qty);
      }
    }

    return {
      quantityFor(item) {
        const keys = keysFor(item.type, item.itemNumber);
        return keys.reduce((max, key) => Math.max(max, stock.get(key) || 0), 0);
      },
    };
  }, [inventoryItems]);

  // ─── List CRUD ───
  const createList = () => {
    const name = newListName.trim() || `Wanted List ${lists.length + 1}`;
    const id = genId();
    updateLists(prev => [...prev, { id, name, items: [], createdAt: new Date().toISOString() }]);
    setActiveListId(id);
    setNewListName('');
  };

  const renameList = (id, name) => {
    updateLists(prev => prev.map(l => l.id === id ? { ...l, name } : l));
    setEditingListId(null);
  };

  const deleteList = (id) => {
    if (!confirm('Delete this wanted list and all its items?')) return;
    updateLists(prev => prev.filter(l => l.id !== id));
    if (activeListId === id) setActiveListId(null);
  };

  // ─── Item CRUD ───
  const addItem = (listId, item) => {
    updateLists(prev => prev.map(l => l.id === listId
      ? { ...l, items: [...l.items, { ...item, id: genId() }] }
      : l
    ));
    setAddingToList(null);
  };

  const updateItem = (listId, item) => {
    updateLists(prev => prev.map(l => l.id === listId
      ? { ...l, items: l.items.map(i => i.id === item.id ? item : i) }
      : l
    ));
    setEditingItem(null);
  };

  const deleteItem = (listId, itemId) => {
    updateLists(prev => prev.map(l => l.id === listId
      ? { ...l, items: l.items.filter(i => i.id !== itemId) }
      : l
    ));
  };

  // ─── Export ───
  const exportList = (list) => {
    const xml = generateWantedListXML(list.items, list.name);
    const blob = new Blob([xml], { type: 'application/xml' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href: url,
      download: `${list.name.replace(/[^a-zA-Z0-9_-]/g, '_')}-wantedlist.xml`,
    });
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyBrickLinkXML = async (list) => {
    const xml = generateWantedListXML(list.items, list.name);
    try {
      await navigator.clipboard.writeText(xml);
      return true;
    } catch(e) {
      const box = document.createElement('textarea');
      box.value = xml;
      box.style.position = 'fixed';
      box.style.left = '-9999px';
      document.body.appendChild(box);
      box.focus();
      box.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(box);
      return copied;
    }
  };

  const openBrickLinkUpload = async (list) => {
    const uploadWindow = window.open('https://www.bricklink.com/wantedXML.asp', '_blank', 'noopener');
    const copied = await copyBrickLinkXML(list);
    if (!uploadWindow) {
      alert(copied
        ? 'Wanted-list XML copied. Open BrickLink XML upload and paste it to transfer this list.'
        : 'Popup and clipboard copy were blocked. Use Export XML, then upload the file in BrickLink.');
      return;
    }
    alert(copied
      ? 'Wanted-list XML copied. Paste it into BrickLink XML upload to transfer this list.'
      : 'BrickLink upload opened. Use Export XML if clipboard copy was blocked.');
  };

  // ─── Import into new list ───
  const handleImportNewList = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const items = parseWantedListXML(ev.target.result);
        const name  = file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
        const id    = genId();
        updateLists(prev => [...prev, { id, name, items, createdAt: new Date().toISOString() }]);
        setActiveListId(id);
      } catch(err) {
        alert('Import failed: ' + err.message);
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  // ─── Import into existing list (append) ───
  const handleImportIntoList = (e, listId) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const newItems = parseWantedListXML(ev.target.result);
        updateLists(prev => prev.map(l => l.id === listId
          ? { ...l, items: [...l.items, ...newItems] }
          : l
        ));
      } catch(err) {
        alert('Import failed: ' + err.message);
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  // ─── Filtered items ───
  const filteredItems = React.useMemo(() => {
    if (!activeList) return [];
    if (!search.trim()) return activeList.items;
    const q = search.toLowerCase();
    return activeList.items.filter(i =>
      i.itemNumber?.toLowerCase().includes(q) ||
      i.name?.toLowerCase().includes(q) ||
      i.colorName?.toLowerCase().includes(q)
    );
  }, [activeList, search]);

  const groupedItems = React.useMemo(() => groupItemsByTypeCategory(filteredItems), [filteredItems]);
  const tableColSpan = 7 + (typeColumn ? 1 : 0) + (blIdColumn ? 1 : 0) + (colorColumn ? 1 : 0);
  const groupKey = (kind, value) => `${kind}:${value || 'blank'}`;
  const toggleGroup = (kind, value) => {
    const key = groupKey(kind, value);
    setCollapsedGroups(prev => ({ ...prev, [key]: !(key in prev ? prev[key] : true) }));
  };
  // Groups here default to expanded (absent key = not collapsed), so expand/collapse-all
  // need to write explicit false/true for every group rather than just clearing the map.
  const expandAll = () => {
    const all = {};
    groupedItems.forEach(tg => {
      all[groupKey('type', tg.type)] = false;
      tg.rows.forEach(({ category }) => { all[groupKey('category', `${tg.type}:${category}`)] = false; });
    });
    setCollapsedGroups(all);
  };
  const collapseAll = () => {
    const all = {};
    groupedItems.forEach(tg => {
      all[groupKey('type', tg.type)] = true;
      tg.rows.forEach(({ category }) => { all[groupKey('category', `${tg.type}:${category}`)] = true; });
    });
    setCollapsedGroups(all);
  };
  const allExpanded = React.useMemo(() => {
    if (!groupedItems.length) return true;
    return groupedItems.every(tg =>
      !collapsedGroups[groupKey('type', tg.type)] &&
      tg.rows.every(({ category }) => !collapsedGroups[groupKey('category', `${tg.type}:${category}`)])
    );
  }, [groupedItems, collapsedGroups]);

  const typeLabel = (type) => {
    const m = { set: 'Set', minifig: 'Minifig', part: 'Part', gear: 'Gear', book: 'Book', instruction: 'Instruction' };
    return m[type] || type;
  };
  const condLabel = (c) => c === 'new' ? 'New' : c === 'used' ? 'Used' : 'Any';
  const listQty = (list) => (list?.items || []).reduce((sum, item) => sum + (item.qty || 1), 0);
  const activeTotalQty = listQty(activeList);
  const itemMeta = (item) => [
    !blIdColumn ? item.itemNumber : null,
    !colorColumn && (item.colorName || item.colorId)
      ? item.colorName
        ? `${item.colorName}${item.colorId ? ` (${item.colorId})` : ''}`
        : `Color ID ${item.colorId}`
      : null,
  ].filter(Boolean).join(' · ');

  return (
    <div style={{display:'flex',height:'100%',overflow:'hidden'}}>

      {/* ── Left panel: list of wanted lists ── */}
      <div style={{
        width: 220, flexShrink: 0, borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        background: 'var(--surface)',
      }}>
        <div style={{padding:'16px 14px 10px',borderBottom:'1px solid var(--border)'}}>
          <div style={{fontSize:13,fontWeight:700,color:'var(--text)',marginBottom:10}}>Wanted Lists</div>
          <div style={{display:'flex',gap:6}}>
            <input
              placeholder="New list name…"
              value={newListName}
              onChange={e => setNewListName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') createList(); }}
              style={{flex:1,fontSize:12,padding:'4px 8px'}}
            />
            <button className="btn btn-primary btn-sm" onClick={createList} title="Create new list"
              style={{padding:'4px 8px',flexShrink:0}}>
              {Icons.plus}
            </button>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            style={{width:'100%',marginTop:6,fontSize:11,display:'flex',alignItems:'center',justifyContent:'center',gap:5}}
            onClick={() => importRef.current?.click()}
            title="Import a BrickLink Wanted List XML as a new list">
            {Icons.upload} Import XML
          </button>
          <input ref={importRef} type="file" accept=".xml" style={{display:'none'}} onChange={handleImportNewList} />
        </div>

        <div style={{flex:1,overflowY:'auto',padding:'6px 0'}}>
          {lists.length === 0 && (
            <div style={{padding:'20px 14px',fontSize:12,color:'var(--text3)',textAlign:'center',lineHeight:1.6}}>
              No wanted lists yet.<br/>Create one above or import a BrickLink XML.
            </div>
          )}
          {lists.map(list => (
            <div
              key={list.id}
              onClick={() => setActiveListId(list.id)}
              style={{
                display:'flex', alignItems:'center', gap:6,
                padding:'8px 14px', cursor:'pointer', userSelect:'none',
                background: activeListId === list.id ? 'var(--surface2)' : 'transparent',
                borderLeft: activeListId === list.id ? '3px solid var(--accent)' : '3px solid transparent',
                transition:'background .1s',
              }}>
              {editingListId === list.id ? (
                <input
                  autoFocus
                  value={editingListName}
                  onChange={e => setEditingListName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') renameList(list.id, editingListName.trim() || list.name);
                    if (e.key === 'Escape') setEditingListId(null);
                  }}
                  onBlur={() => renameList(list.id, editingListName.trim() || list.name)}
                  onClick={e => e.stopPropagation()}
                  style={{flex:1,fontSize:12,padding:'2px 4px'}}
                />
              ) : (
                <>
                  <span style={{flex:1,fontSize:12,fontWeight:activeListId===list.id?600:400,color:'var(--text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {list.name}
                  </span>
                  <span style={{fontSize:11,color:'var(--text3)',flexShrink:0}} title={`${list.items.length} row${list.items.length !== 1 ? 's' : ''}`}>
                    {listQty(list)}
                  </span>
                  <button
                    onClick={e => { e.stopPropagation(); setEditingListId(list.id); setEditingListName(list.name); }}
                    className="btn-icon" style={{opacity:.5,padding:2,flexShrink:0}}
                    title="Rename">
                    {Icons.edit}
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); deleteList(list.id); }}
                    className="btn-icon" style={{opacity:.5,padding:2,flexShrink:0,color:'var(--red)'}}
                    title="Delete list">
                    {Icons.trash}
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Right panel: items in selected list ── */}
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        {!activeList ? (
          <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:12,color:'var(--text3)'}}>
            <div style={{fontSize:40,opacity:.3}}>📋</div>
            <div style={{fontSize:14,fontWeight:600}}>Select or create a wanted list</div>
            <div style={{fontSize:12}}>Use the panel on the left to get started.</div>
          </div>
        ) : (
          <>
            {/* Toolbar */}
            <div style={{padding:'12px 20px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
              <div style={{flex:1}}>
                <div style={{fontSize:16,fontWeight:700,color:'var(--text)'}}>{activeList.name}</div>
                <div style={{fontSize:11,color:'var(--text3)',marginTop:1}}>
                  {activeTotalQty} total item{activeTotalQty !== 1 ? 's' : ''}
                  {activeList.items.length !== activeTotalQty && ` across ${activeList.items.length} row${activeList.items.length !== 1 ? 's' : ''}`}
                </div>
              </div>
              <input
                placeholder="Search items…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{fontSize:12,padding:'5px 10px',width:180}}
              />
              <button className="btn btn-secondary btn-sm"
                style={{whiteSpace:'nowrap',flexShrink:0}}
                onClick={allExpanded ? collapseAll : expandAll}
                title={allExpanded ? 'Collapse all categories' : 'Expand all categories'}>
                {allExpanded ? '⊟ Collapse All' : '⊞ Expand All'}
              </button>
              <button className="btn btn-secondary btn-sm"
                style={{display:'flex',alignItems:'center',gap:5,fontSize:12}}
                onClick={() => { importListRef.current?.click(); }}
                title="Append items from a BrickLink Wanted List XML">
                {Icons.upload} Import XML
              </button>
              <input ref={importListRef} type="file" accept=".xml" style={{display:'none'}}
                onChange={e => handleImportIntoList(e, activeList.id)} />
              <button className="btn btn-secondary btn-sm"
                style={{display:'flex',alignItems:'center',gap:5,fontSize:12}}
                onClick={() => exportList(activeList)}
                title="Export as BrickLink Wanted List XML">
                {Icons.download} Export XML
              </button>
              <button className="btn btn-secondary btn-sm"
                style={{display:'flex',alignItems:'center',gap:5,fontSize:12}}
                onClick={() => openBrickLinkUpload(activeList)}
                title="Copy BrickLink XML and open the wanted-list upload page">
                {Icons.upload} BrickLink Upload
              </button>
              {batchStatus === 'running' ? (
                <div style={{display:'flex',alignItems:'center',gap:8,fontSize:12,color:'var(--text2)'}}>
                  <span>🔄 {batchProgress}</span>
                  <button className="btn btn-secondary btn-sm" style={{fontSize:11}}
                    onClick={() => { batchCancelRef.current = true; }}>Stop</button>
                </div>
              ) : (
                <button className="btn btn-secondary btn-sm"
                  style={{display:'flex',alignItems:'center',gap:5,fontSize:12}}
                  onClick={() => fetchAllPrices(activeList.items)}
                  title="Fetch BrickLink suggested prices for all items">
                  📊 Fetch Prices
                </button>
              )}
              <button className="btn btn-secondary btn-sm"
                style={{display:'flex',alignItems:'center',gap:5,fontSize:12}}
                onClick={() => setSalesOrderOpen(true)}
                title="Convert this wanted list to a sales order against your inventory">
                🧾 Sales Order
              </button>
              <button className="btn btn-primary btn-sm"
                style={{display:'flex',alignItems:'center',gap:5,fontSize:12}}
                onClick={() => setAddingToList(activeList.id)}>
                {Icons.plus} Add Item
              </button>
            </div>

            {/* Table */}
            <div style={{flex:1,overflowY:'auto'}}>
              {filteredItems.length === 0 ? (
                <div style={{padding:'40px 20px',textAlign:'center',color:'var(--text3)'}}>
                  {activeList.items.length === 0
                    ? <><div style={{fontSize:36,marginBottom:10,opacity:.3}}>📋</div><div style={{fontSize:13,fontWeight:600,marginBottom:6}}>This list is empty</div><div style={{fontSize:12}}>Add items manually or import a BrickLink Wanted List XML.</div></>
                    : <div style={{fontSize:13}}>No items match your search.</div>
                  }
                </div>
              ) : (
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                  <thead>
                    <tr style={{background:'var(--surface2)'}}>
                      {typeColumn && <th style={{padding:'8px 12px',textAlign:'left',fontWeight:600,color:'var(--text2)',fontSize:11,textTransform:'uppercase',letterSpacing:'.4px',borderBottom:'1px solid var(--border)',whiteSpace:'nowrap'}}>Type</th>}
                      {blIdColumn && <th style={{padding:'8px 12px',textAlign:'left',fontWeight:600,color:'var(--text2)',fontSize:11,textTransform:'uppercase',letterSpacing:'.4px',borderBottom:'1px solid var(--border)',whiteSpace:'nowrap'}}>Item #</th>}
                      <th style={{padding:'8px 12px',textAlign:'left',fontWeight:600,color:'var(--text2)',fontSize:11,textTransform:'uppercase',letterSpacing:'.4px',borderBottom:'1px solid var(--border)'}}>Name</th>
                      {colorColumn && <th style={{padding:'8px 12px',textAlign:'left',fontWeight:600,color:'var(--text2)',fontSize:11,textTransform:'uppercase',letterSpacing:'.4px',borderBottom:'1px solid var(--border)'}}>Color</th>}
                      <th style={{padding:'8px 12px',textAlign:'right',fontWeight:600,color:'var(--text2)',fontSize:11,textTransform:'uppercase',letterSpacing:'.4px',borderBottom:'1px solid var(--border)',whiteSpace:'nowrap'}}>Qty</th>
                      <th style={{padding:'8px 12px',textAlign:'right',fontWeight:600,color:'var(--text2)',fontSize:11,textTransform:'uppercase',letterSpacing:'.4px',borderBottom:'1px solid var(--border)',whiteSpace:'nowrap'}} title="Total quantity in your inventory">In Stock</th>
                      <th style={{padding:'8px 12px',textAlign:'right',fontWeight:600,color:'var(--text2)',fontSize:11,textTransform:'uppercase',letterSpacing:'.4px',borderBottom:'1px solid var(--border)',whiteSpace:'nowrap'}}>Max Price</th>
                      <th style={{padding:'8px 12px',textAlign:'right',fontWeight:600,color:'var(--text2)',fontSize:11,textTransform:'uppercase',letterSpacing:'.4px',borderBottom:'1px solid var(--border)',whiteSpace:'nowrap'}}>Suggested</th>
                      <th style={{padding:'8px 12px',textAlign:'left',fontWeight:600,color:'var(--text2)',fontSize:11,textTransform:'uppercase',letterSpacing:'.4px',borderBottom:'1px solid var(--border)',whiteSpace:'nowrap'}}>Cond.</th>
                      <th style={{padding:'8px 12px',textAlign:'left',fontWeight:600,color:'var(--text2)',fontSize:11,textTransform:'uppercase',letterSpacing:'.4px',borderBottom:'1px solid var(--border)'}}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedItems.map(typeGroup => {
                      const typeRows = typeGroup.rows.flatMap(g => g.rows);
                      const typeQty = typeRows.reduce((sum, item) => sum + (Number(item.qty) || 1), 0);
                      const typeCollapsed = !!collapsedGroups[groupKey('type', typeGroup.type)];
                      return (
                        <React.Fragment key={`type-${typeGroup.type}`}>
                          <tr>
                            <td colSpan={tableColSpan}
                              onClick={() => toggleGroup('type', typeGroup.type)}
                              style={{padding:'8px 12px',background:'var(--surface2)',borderBottom:'1px solid var(--border)',cursor:'pointer',userSelect:'none'}}>
                              <span style={{color:'var(--text3)',display:'inline-block',width:14}}>{typeCollapsed ? '▶' : '▼'}</span>
                              <span style={{fontWeight:700,color:itemTypeColor(typeGroup.type)}}>{itemTypeLabel(typeGroup.type)}</span>
                              <span style={{fontSize:11,color:'var(--text3)',marginLeft:8}}>{typeRows.length} listing{typeRows.length !== 1 ? 's' : ''} · {typeQty} item{typeQty !== 1 ? 's' : ''}</span>
                            </td>
                          </tr>
                          {!typeCollapsed && typeGroup.rows.map(categoryGroup => {
                            const categoryKey = `${typeGroup.type}:${categoryGroup.category}`;
                            const categoryCollapsed = !!collapsedGroups[groupKey('category', categoryKey)];
                            const categoryQty = categoryGroup.rows.reduce((sum, item) => sum + (Number(item.qty) || 1), 0);
                            return (
                              <React.Fragment key={`category-${categoryKey}`}>
                                <tr>
                                  <td colSpan={tableColSpan}
                                    onClick={() => toggleGroup('category', categoryKey)}
                                    style={{padding:'6px 12px 6px 34px',background:'rgba(0,0,0,.03)',borderBottom:'1px solid var(--border)',cursor:'pointer',userSelect:'none'}}>
                                    <span style={{color:'var(--text3)',display:'inline-block',width:14}}>{categoryCollapsed ? '▶' : '▼'}</span>
                                    <span style={{fontWeight:600,color:'var(--text2)'}}>{categoryGroup.category}</span>
                                    <span style={{fontSize:11,color:'var(--text3)',marginLeft:8}}>{categoryGroup.rows.length} listing{categoryGroup.rows.length !== 1 ? 's' : ''} · {categoryQty} item{categoryQty !== 1 ? 's' : ''}</span>
                                  </td>
                                </tr>
                                {!categoryCollapsed && categoryGroup.rows.map((item, idx) => (
                      <tr key={item.id} style={{background: idx%2===0 ? 'transparent' : 'rgba(0,0,0,.03)',borderBottom:'1px solid var(--border)'}}>
                        {typeColumn && <td style={{padding:'8px 12px',whiteSpace:'nowrap'}}>
                          <span style={{
                            fontSize:10,fontWeight:600,padding:'2px 6px',borderRadius:4,
                            background: item.type==='set' ? 'rgba(76,140,231,.12)' : item.type==='minifig' ? 'rgba(251,146,60,.12)' : 'rgba(139,92,246,.12)',
                            color:      item.type==='set' ? 'var(--blue)'          : item.type==='minifig' ? 'var(--orange)'         : 'var(--purple)',
                          }}>
                            {typeLabel(item.type)}
                          </span>
                        </td>}
                        {blIdColumn && <td style={{padding:'8px 12px',whiteSpace:'nowrap'}}>
                          <a href={bricklinkUrl(item)} target="_blank" rel="noopener"
                            style={{color:'var(--accent)',textDecoration:'none',fontWeight:500}}
                            onClick={e => e.stopPropagation()}>
                            {item.itemNumber}
                          </a>
                        </td>}
                        <td style={{padding:'8px 12px',color:'var(--text)',maxWidth:260,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                          <span style={{color:typeColumn?undefined:item.type==='set'?'var(--blue)':item.type==='minifig'?'var(--orange)':'var(--purple)',fontWeight:500}}>
                            {item.name || <span style={{color:'var(--text3)'}}>—</span>}
                          </span>
                          {itemMeta(item) && (
                            <><br /><span style={{fontSize:11,color:'var(--text3)'}}>{itemMeta(item)}</span></>
                          )}
                        </td>
                        {colorColumn && <td style={{padding:'8px 12px',color:'var(--text2)',whiteSpace:'nowrap'}}>
                          {item.colorName
                            ? <span>{item.colorName}{item.colorId ? <span style={{color:'var(--text3)',marginLeft:4,fontSize:11}}>({item.colorId})</span> : null}</span>
                            : item.colorId ? <span style={{color:'var(--text3)',fontSize:11}}>ID {item.colorId}</span>
                            : <span style={{color:'var(--text3)'}}>—</span>
                          }
                        </td>}
                        <td style={{padding:'8px 12px',textAlign:'right',fontWeight:600,whiteSpace:'nowrap'}}>{item.qty || 1}</td>
                        <td style={{padding:'8px 12px',textAlign:'right',whiteSpace:'nowrap'}}>
                          {(() => {
                            const total = inventoryStock.quantityFor(item);
                            if (total === 0) return <span style={{color:'var(--text3)'}}>—</span>;
                            return (
                              <span style={{
                                fontWeight: 700,
                                color: total >= (item.qty || 1) ? 'var(--green)' : 'var(--orange)',
                              }} title={`${total} in inventory (want ${item.qty || 1})`}>
                                {total}
                              </span>
                            );
                          })()}
                        </td>
                        <td style={{padding:'8px 12px',textAlign:'right',whiteSpace:'nowrap',color: item.maxPrice ? 'var(--text)' : 'var(--text3)'}}>
                          {item.maxPrice ? currency(item.maxPrice) : '—'}
                        </td>
                        <td style={{padding:'8px 12px',textAlign:'right',whiteSpace:'nowrap'}}>
                          {(() => {
                            const key = priceKeyFor(item);
                            const p = priceCache[key];
                            if (!p) return (
                              <button className="btn btn-secondary btn-sm"
                                style={{fontSize:10,padding:'2px 6px'}}
                                onClick={() => fetchSuggestedPrice(item)}>
                                Fetch
                              </button>
                            );
                            if (p.status === 'fetching') return <span style={{color:'var(--text3)',fontSize:11}}>…</span>;
                            if (p.status === 'error')   return <span style={{color:'var(--red)',fontSize:11}}>n/a</span>;
                            if (p.suggested == null)    return <span style={{color:'var(--text3)',fontSize:11}}>—</span>;
                            const perUnit = p.suggested;
                            const total   = perUnit * (item.qty || 1);
                            const tooltipParts = [
                              `${currency(perUnit)} ea × ${item.qty || 1}`,
                              p.soldMedian != null ? `Sold median ${currency(p.soldMedian)}` : null,
                              p.activeMedian != null ? `Active median ${currency(p.activeMedian)}` : null,
                              p.activeAvg != null ? `Active avg ${currency(p.activeAvg)}` : null,
                              p.estimated === 'used_from_new' ? 'Estimated from new ×0.6' : null,
                              p.estimated === 'new_from_used' ? 'Estimated from used ×1.4' : null,
                            ].filter(Boolean);
                            return (
                              <span title={tooltipParts.join(' · ')}
                                style={{fontWeight:600,color:'var(--accent)'}}>
                                {currency(total)}
                                {(item.qty || 1) > 1 && <span style={{fontSize:10,color:'var(--text3)',marginLeft:3}}>({currency(perUnit)} ea)</span>}
                              </span>
                            );
                          })()}
                        </td>
                        <td style={{padding:'8px 12px',color:'var(--text2)',whiteSpace:'nowrap'}}>{condLabel(item.condition)}</td>
                        <td style={{padding:'8px 12px',whiteSpace:'nowrap'}}>
                          <div style={{display:'flex',gap:4,justifyContent:'flex-end'}}>
                            {item.notify && (
                              <span title="Notify on BrickLink" style={{fontSize:11,color:'var(--green)'}}>🔔</span>
                            )}
                            <button className="btn-icon" style={{padding:3,opacity:.65}}
                              onClick={() => setEditingItem({ listId: activeList.id, item })}
                              title="Edit">{Icons.edit}</button>
                            <button className="btn-icon" style={{padding:3,opacity:.65,color:'var(--red)'}}
                              onClick={() => deleteItem(activeList.id, item.id)}
                              title="Delete">{Icons.trash}</button>
                          </div>
                        </td>
                      </tr>
                                ))}
                              </React.Fragment>
                            );
                          })}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer: list total + BrickLink tip */}
            {activeList.items.length > 0 && (() => {
              const pricedItems = activeList.items.filter(i => {
                const p = priceCache[priceKeyFor(i)];
                return p?.status === 'done' && p.suggested != null;
              });
              const listTotal = pricedItems.reduce((sum, i) => {
                const p = priceCache[priceKeyFor(i)];
                return sum + p.suggested * (i.qty || 1);
              }, 0);
              const pricedCount = pricedItems.length;
              const totalItems  = activeList.items.length;

              return (
                <div style={{padding:'10px 20px',borderTop:'1px solid var(--border)',display:'flex',alignItems:'center',gap:16,flexWrap:'wrap',background:'var(--surface2)'}}>
                  <div style={{display:'flex',alignItems:'baseline',gap:8}}>
                    <span style={{fontSize:11,color:'var(--text2)',textTransform:'uppercase',letterSpacing:'.4px',fontWeight:600}}>Total Items</span>
                    <span style={{fontSize:20,fontWeight:700,color:'var(--text)'}}>{activeTotalQty}</span>
                    {activeList.items.length !== activeTotalQty && (
                      <span style={{fontSize:11,color:'var(--text3)'}}>({activeList.items.length} row{activeList.items.length !== 1 ? 's' : ''})</span>
                    )}
                  </div>
                  {pricedCount > 0 && (
                    <div style={{display:'flex',alignItems:'baseline',gap:8}}>
                      <span style={{fontSize:11,color:'var(--text2)',textTransform:'uppercase',letterSpacing:'.4px',fontWeight:600}}>List Total</span>
                      <span style={{fontSize:20,fontWeight:700,color:'var(--accent)'}}>{currency(listTotal)}</span>
                      {pricedCount < totalItems && (
                        <span style={{fontSize:11,color:'var(--text3)'}}>({pricedCount} of {totalItems} priced)</span>
                      )}
                    </div>
                  )}
                  <div style={{marginLeft:'auto',fontSize:11,color:'var(--text3)',display:'flex',alignItems:'center',gap:6}}>
                    <span>💡</span>
                    <span>
                      Export XML → upload to BrickLink via{' '}
                      <a href="https://www.bricklink.com/wantedXML.asp" target="_blank" rel="noopener"
                        style={{color:'var(--accent)'}}>
                        bricklink.com/wantedXML.asp
                      </a>
                    </span>
                  </div>
                </div>
              );
            })()}
          </>
        )}
      </div>

      {/* ── Modals ── */}
      {addingToList && (
        <WantedItemModal
          onSave={(item) => addItem(addingToList, item)}
          onClose={() => setAddingToList(null)}
        />
      )}
      {editingItem && (
        <WantedItemModal
          item={editingItem.item}
          onSave={(item) => updateItem(editingItem.listId, item)}
          onClose={() => setEditingItem(null)}
        />
      )}
      {salesOrderOpen && activeList && (
        <WantedToOrderModal
          list={activeList}
          inventoryItems={inventoryItems}
          updateItems={updateItems}
          setData={setData}
          blConfigured={blConfigured}
          settings={settings}
          onClose={() => setSalesOrderOpen(false)}
        />
      )}
    </div>
  );
}
