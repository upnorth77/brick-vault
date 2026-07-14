// ─── Sales Quote Page ───
// Create a quote from inventory items (manually or from a wanted list match),
// apply per-item and global discounts, print a pick list, and convert to a sales order.

function SalesQuotePage({ data, setData, settings }) {
  const allItems = React.useMemo(() => (data.items || []).filter(i => i.sellStatus !== 'sold'), [data.items]);
  const quotes   = React.useMemo(() => data.salesQuotes || [], [data.salesQuotes]);

  const [selectedId,  setSelectedId]  = React.useState(null);
  const [editingId,   setEditingId]   = React.useState(null); // quote being edited (null = list view)
  const [search,      setSearch]      = React.useState('');
  const [tab,         setTab]         = React.useState('active'); // 'active' | 'completed' | 'archived'
  const [pauseStatus, setPauseStatus] = React.useState(''); // '', 'working', 'done', 'error'
  const [pauseDetail, setPauseDetail] = React.useState('');
  const [saleStatus,  setSaleStatus]  = React.useState(''); // '', 'working', 'done', 'error'
  const [saleDetail,  setSaleDetail]  = React.useState('');
  const [renamingId,  setRenamingId]  = React.useState(null); // id of quote being renamed inline
  const [renameValue, setRenameValue] = React.useState('');

  const quoteStatus = (q) => q.quoteStatus || 'active';

  // Auto-select first quote in current tab
  React.useEffect(() => {
    const tabQuotes = quotes.filter(q => quoteStatus(q) === tab);
    if (!selectedId && tabQuotes.length > 0) setSelectedId(tabQuotes[0].id);
    if (selectedId && !quotes.find(q => q.id === selectedId) && tabQuotes.length > 0) setSelectedId(tabQuotes[0].id);
  }, [quotes, selectedId, tab]);

  const tabQuotes = React.useMemo(() => quotes.filter(q => quoteStatus(q) === tab), [quotes, tab]);

  const filteredQuotes = React.useMemo(() => {
    if (!search.trim()) return tabQuotes;
    const q = search.toLowerCase();
    return tabQuotes.filter(o =>
      (o.name      || '').toLowerCase().includes(q) ||
      (o.buyerName || '').toLowerCase().includes(q) ||
      (o.note      || '').toLowerCase().includes(q) ||
      (o.lines || []).some(l => (l.name || '').toLowerCase().includes(q) || (l.itemNumber || '').toLowerCase().includes(q))
    );
  }, [tabQuotes, search]);

  const selectedQuote = quotes.find(q => q.id === selectedId) || null;

  const saveQuote = (quote) => {
    setData(prev => {
      const existing = (prev.salesQuotes || []).find(q => q.id === quote.id);
      const next = existing
        ? (prev.salesQuotes || []).map(q => q.id === quote.id ? quote : q)
        : [...(prev.salesQuotes || []), quote];
      return { ...prev, salesQuotes: next };
    });
    setSelectedId(quote.id);
    setEditingId(null);
  };

  const deleteQuote = (id) => {
    if (!confirm('Delete this quote? This does not affect your inventory.')) return;
    setData(prev => ({ ...prev, salesQuotes: (prev.salesQuotes || []).filter(q => q.id !== id) }));
    if (selectedId === id) setSelectedId(null);
  };

  // Returns the best display name for a quote: custom name → buyer name → fallback
  const quoteDisplayName = (q) => q.name || q.buyerName || 'Untitled';

  const startRename = (q, e) => {
    e.stopPropagation();
    setRenamingId(q.id);
    setRenameValue(q.name || q.buyerName || '');
  };

  const commitRename = (id) => {
    const trimmed = renameValue.trim();
    setData(prev => ({
      ...prev,
      salesQuotes: (prev.salesQuotes || []).map(q =>
        q.id === id ? { ...q, name: trimmed, updatedAt: new Date().toISOString() } : q
      ),
    }));
    setRenamingId(null);
  };

  const setQuoteStatus = (id, status) => {
    setData(prev => ({
      ...prev,
      salesQuotes: (prev.salesQuotes || []).map(q =>
        q.id === id ? { ...q, quoteStatus: status, updatedAt: new Date().toISOString() } : q
      ),
    }));
    // Switch to the new tab so the quote stays selected there
    setTab(status);
  };

  const convertToOrder = (quote) => {
    if (!confirm(`Convert this quote to a sales order? The quote will remain.`)) return;
    const order = {
      id:         genId(),
      createdAt:  new Date().toISOString(),
      buyerName:  quote.buyerName || '',
      listName:   quote.note || '',
      note:       quote.note || '',
      lines:      (quote.lines || []).map(l => ({
        name:       l.name,
        itemNumber: l.itemNumber,
        condition:  l.condition,
        colorName:  l.colorName,
        qty:        l.qty,
        listedUnit: l.listedUnit,
        unitPrice:  l.finalUnit,
        lineTotal:  Math.round(l.finalUnit * l.qty * 100) / 100,
      })),
      totalItems: (quote.lines || []).reduce((s, l) => s + l.qty, 0),
      subtotal:   quote.finalSubtotal,
      shipping:   quote.shipping || 0,
      fees:       quote.fees || 0,
      grandTotal: quote.grandTotal,
    };
    setData(prev => ({ ...prev, salesOrders: [...(prev.salesOrders || []), order] }));
    alert('Converted to sales order.');
  };

  const condLabel = (c) => ({ new_sealed:'New/Sealed', new_open:'New/Open', used_complete:'Used-Complete', used_incomplete:'Used-Incomplete' })[c] || c || '—';
  const pauseOnBrickLink = async (quote, pause) => {
    const verb = pause ? 'paused' : 'unpaused';
    setPauseStatus('working');
    setPauseDetail('Fetching store inventory…');

    let inventories = [];
    try {
      const cacheResp = await fetch('/api/bricklink/store/inventory/cache');
      const cacheData = cacheResp.ok ? await cacheResp.json() : null;
      if (cacheData?.inventories?.length) {
        inventories = cacheData.inventories;
      } else {
        const liveResp = await fetch('/api/bricklink/store/inventory/all');
        if (!liveResp.ok) throw new Error('Could not fetch store inventory');
        const liveData = await liveResp.json();
        inventories = liveData.inventories || [];
      }
    } catch(e) {
      setPauseStatus('error');
      setPauseDetail(e.message || 'Could not reach the server.');
      return;
    }

    const condMap = { new_sealed:'N', new_open:'N', used_complete:'U', used_incomplete:'U' };
    const lines = quote.lines || [];
    const matches = [];
    const unmatched = [];

    for (const line of lines) {
      const lineNo   = (line.itemNumber || '').toLowerCase().replace(/-1$/, '');
      const lineCond = condMap[line.condition] || null;
      const found = inventories.filter(inv => {
        const invNo = (inv.item_number || '').toLowerCase().replace(/-1$/, '');
        if (invNo !== lineNo) return false;
        if (lineCond && inv.condition !== lineCond) return false;
        if (pause && inv.is_stock_room) return false;
        if (!pause && !inv.is_stock_room) return false;
        return true;
      });
      if (found.length) {
        found.forEach(inv => matches.push({ inv, line }));
      } else {
        unmatched.push(line.itemNumber || line.name);
      }
    }

    if (matches.length === 0) {
      setPauseStatus('error');
      setPauseDetail(unmatched.length
        ? `No matching active listings found for: ${unmatched.join(', ')}`
        : `All items are already ${verb}.`);
      return;
    }

    let done = 0, failed = 0, failedNames = [];
    for (const { inv } of matches) {
      setPauseDetail(`${pause ? 'Pausing' : 'Unpausing'} ${inv.item_number}… (${done + failed + 1}/${matches.length})`);
      try {
        const resp = await fetch('/api/bricklink/store/stockroom', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inventory_id: inv.inventory_id, stockroom: pause }),
        });
        const result = await resp.json();
        if (result.ok) { done++; } else { failed++; failedNames.push(inv.item_number); }
      } catch(e) {
        failed++; failedNames.push(inv.item_number);
      }
    }

    const summary = `${done} item${done !== 1 ? 's' : ''} ${verb}${failed ? `, ${failed} failed (${failedNames.join(', ')})` : ''}${unmatched.length ? `; ${unmatched.length} not found in store` : ''}.`;
    setPauseStatus(failed > 0 ? 'error' : 'done');
    setPauseDetail(summary);
  };

  const completeSale = async (quote) => {
    const lines = quote.lines || [];
    if (!lines.length) return;

    const confirmMsg = [
      `Complete this sale for ${quote.buyerName || 'this buyer'}?`,
      '',
      'This will:',
      '  • Mark each item as sold in your inventory',
      '  • Remove matching BrickLink listings',
      '',
      `${lines.reduce((s, l) => s + l.qty, 0)} item(s) across ${lines.length} line(s)`,
    ].join('\n');
    if (!confirm(confirmMsg)) return;

    setSaleStatus('working');
    setSaleDetail('Marking items as sold…');

    // ── Step 1: Compute remaining quantities and mark inventory items as sold ──
    // We pre-compute remainingQtyByLineId so the BrickLink step knows how much
    // stock is left after this sale without having to read back from setState.
    const currentItems = (data.items || []);
    const remainingQtyByLineId = {};
    const soldIds = new Set();

    for (const line of lines) {
      if (!line.id) continue;
      const item = currentItems.find(i => i.id === line.id);
      if (!item) continue;
      const newQty = (item.quantity || 1) - (line.qty || 1);
      remainingQtyByLineId[line.id] = Math.max(0, newQty);
    }

    setData(prev => {
      const updatedItems = (prev.items || []).map(item => {
        const matchingLine = lines.find(l => l.id && l.id === item.id);
        if (!matchingLine) return item;
        soldIds.add(item.id);
        const soldPrice = Number(matchingLine.finalUnit) || Number(matchingLine.afterItemUnit) || Number(matchingLine.listedUnit) || Number(matchingLine.suggested) || 0;
        const newQty = remainingQtyByLineId[item.id] ?? 0;
        if (newQty <= 0) {
          return { ...item, sellStatus: 'sold', quantity: 0, soldAt: new Date().toISOString(), soldPrice };
        } else {
          return { ...item, quantity: newQty };
        }
      });
      return { ...prev, items: updatedItems };
    });

    // ── Step 2: Update or remove BrickLink listings ──
    setSaleDetail('Fetching BrickLink inventory…');

    let inventories = [];
    try {
      const cacheResp = await fetch('/api/bricklink/store/inventory/cache');
      const cacheData = cacheResp.ok ? await cacheResp.json() : null;
      if (cacheData?.inventories?.length) {
        inventories = cacheData.inventories;
      } else {
        const liveResp = await fetch('/api/bricklink/store/inventory/all');
        if (liveResp.ok) {
          const liveData = await liveResp.json();
          inventories = liveData.inventories || [];
        }
      }
    } catch(e) {
      // BL update is best-effort — inventory is already marked sold
    }

    const condMap = { new_sealed: 'N', new_open: 'N', used_complete: 'U', used_incomplete: 'U' };
    let blRemoved = 0, blUpdated = 0, blFailed = 0, blMissed = 0;
    const failedNames = [];

    for (const line of lines) {
      const lineNo        = (line.itemNumber || '').toLowerCase().replace(/-1$/, '');
      const lineCond      = condMap[line.condition] || null;
      const remainingQty  = line.id != null ? (remainingQtyByLineId[line.id] ?? 0) : 0;
      const soldQty       = line.qty || 1;

      const matches = inventories.filter(inv => {
        const invNo = (inv.item_number || '').toLowerCase().replace(/-1$/, '');
        if (invNo !== lineNo) return false;
        if (lineCond && inv.condition !== lineCond) return false;
        return true;
      });

      if (!matches.length) { blMissed++; continue; }

      for (const inv of matches) {
        // How many does BrickLink currently list? Deduct the sold qty from that.
        const blCurrentQty  = inv.quantity || 0;
        const blNewQty      = Math.max(0, blCurrentQty - soldQty);

        if (blNewQty <= 0 || remainingQty <= 0) {
          // No stock left — delete the listing entirely
          setSaleDetail(`Removing ${inv.item_number} from BrickLink…`);
          try {
            const resp = await fetch('/api/bricklink/store/remove-listing', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ inventory_id: inv.inventory_id }),
            });
            const result = await resp.json();
            if (result.ok) { blRemoved++; } else { blFailed++; failedNames.push(inv.item_number); }
          } catch(e) {
            blFailed++; failedNames.push(inv.item_number);
          }
        } else {
          // Stock remains — reduce quantity on BrickLink instead of deleting
          setSaleDetail(`Updating ${inv.item_number} quantity on BrickLink…`);
          try {
            const resp = await fetch('/api/bricklink/store/update-quantity', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ inventory_id: inv.inventory_id, quantity: blNewQty }),
            });
            const result = await resp.json();
            if (result.ok) { blUpdated++; } else { blFailed++; failedNames.push(inv.item_number); }
          } catch(e) {
            blFailed++; failedNames.push(inv.item_number);
          }
        }
      }
    }

    const parts = [];
    parts.push(`${soldIds.size} item(s) marked as sold`);
    if (blRemoved > 0) parts.push(`${blRemoved} removed from BrickLink`);
    if (blUpdated > 0) parts.push(`${blUpdated} quantity reduced on BrickLink`);
    if (blMissed > 0) parts.push(`${blMissed} not found on BrickLink`);
    if (blFailed > 0) parts.push(`${blFailed} BrickLink update failed (${failedNames.join(', ')})`);

    // Mark the quote itself as completed
    setData(prev => ({
      ...prev,
      salesQuotes: (prev.salesQuotes || []).map(q =>
        q.id === quote.id
          ? { ...q, quoteStatus: 'completed', completedAt: new Date().toISOString() }
          : q
      ),
    }));
    setTab('completed');

    setSaleStatus(blFailed > 0 ? 'error' : 'done');
    setSaleDetail(parts.join(' · '));
  };

  const formatDate = (iso) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' }); }
    catch { return iso; }
  };

  const formatDateTime = (iso) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(undefined, { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }); }
    catch { return iso; }
  };

  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const printSalesQuote = (quote, shopName) => {
    const quoteLines = quote.lines || [];
    const shop = escapeHtml((shopName || '').trim());
    const buyer = escapeHtml((quote.buyerName || '').trim() || 'Customer');
    const note = (quote.note || '').trim();
    const created = quote.createdAt || new Date().toISOString();
    const quoteNo = escapeHtml((quote.id || '').slice(0, 8).toUpperCase());
    const totalQty = quoteLines.reduce((sum, line) => sum + (Number(line.qty) || 0), 0);
    const listedTotal = quoteLines.reduce((sum, line) => sum + (Number(line.listedUnit) || 0) * (Number(line.qty) || 0), 0);
    const itemDiscountTotal = quoteLines.reduce((sum, line) => {
      const base = Number(line.baseUnit ?? line.listedUnit ?? line.suggested ?? line.finalUnit) || 0;
      const afterItem = Number(line.afterItemUnit ?? line.finalUnit ?? base) || 0;
      return sum + Math.max(0, base - afterItem) * (Number(line.qty) || 0);
    }, 0);
    const globalDiscountAmt = Number(quote.globalDiscountAmt) || 0;
    const subtotal = Number(quote.finalSubtotal) || quoteLines.reduce((sum, line) => sum + (Number(line.finalUnit) || 0) * (Number(line.qty) || 0), 0);
    const shipping = Number(quote.shipping) || 0;
    const fees = Number(quote.fees) || 0;
    const grandTotal = Number(quote.grandTotal ?? (subtotal + shipping + fees)) || 0;

    const rows = quoteLines.map((line, idx) => {
      const qty        = Number(line.qty) || 0;
      const unit       = Number(line.finalUnit) || 0;
      const base       = Number(line.baseUnit ?? line.listedUnit ?? 0) || 0;
      const afterItem  = Number(line.afterItemUnit ?? unit) || unit;
      const itemSav    = Math.max(0, base - afterItem);
      const globalSav  = Math.max(0, afterItem - unit);
      const hasItemD   = itemSav > 0.005;
      const hasGlobalD = globalSav > 0.005;
      const itemMeta   = [line.itemNumber, line.colorName, condLabel(line.condition)].filter(Boolean).map(escapeHtml).join(' · ');

      let discCell = '—';
      if (hasItemD || hasGlobalD) {
        const itemLabel = hasItemD
          ? (line.itemDiscountType === 'pct'
              ? `-${Number(line.itemDiscount)}%`
              : `-${currency(itemSav)}`)
          : '';
        const itemSubLabel = hasItemD && line.itemDiscountType === 'pct'
          ? `<div class="disc-sub">-${currency(itemSav)}</div>` : '';
        const globalLabel = hasGlobalD
          ? `<div class="disc-sub">-${currency(globalSav)} global</div>` : '';
        discCell = `<span class="disc-label">${itemLabel}</span>${itemSubLabel}${globalLabel}`;
      }

      return `
        <tr>
          <td class="num">${idx + 1}</td>
          <td>
            <div class="item-name">${escapeHtml(line.name || line.itemNumber || 'Item')}</div>
            ${itemMeta ? `<div class="item-meta">${itemMeta}</div>` : ''}
          </td>
          <td class="qty">${qty}</td>
          <td class="money orig">${base > 0 ? `<span class="${hasItemD || hasGlobalD ? 'strike' : ''}">${currency(base)}</span>` : '—'}</td>
          <td class="money disc-cell">${discCell}</td>
          <td class="money">${currency(unit)}</td>
          <td class="money strong">${currency(unit * qty)}</td>
        </tr>`;
    }).join('');

    const totalRows = [
      listedTotal > 0 ? ['Listed total', currency(listedTotal)] : null,
      itemDiscountTotal > 0 ? ['Item discounts', `-${currency(itemDiscountTotal)}`] : null,
      globalDiscountAmt > 0 ? ['Quote discount', `-${currency(globalDiscountAmt)}`] : null,
      ['Subtotal', currency(subtotal)],
      shipping > 0 ? ['Shipping', currency(shipping)] : null,
      fees > 0 ? ['Fees', currency(fees)] : null,
    ].filter(Boolean).map(([label, value]) => `
      <div class="total-row">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>`).join('');

    const win = window.open('', '_blank', 'width=960,height=720');
    if (!win) { alert('Pop-up blocked.'); return; }
    win.document.write(`<!doctype html><html><head><title>Sales Quote ${quoteNo}</title><style>
      @page { size: letter; margin: 0.55in; }
      * { box-sizing: border-box; }
      body { margin: 0; color: #111827; font-family: Arial, Helvetica, sans-serif; background: #fff; font-size: 12px; line-height: 1.45; }
      .quote { max-width: 7.4in; margin: 0 auto; }
      .topbar { height: 8px; background: #f6c700; margin-bottom: 22px; }
      .header { display: grid; grid-template-columns: 1fr auto; gap: 24px; align-items: start; padding-bottom: 18px; border-bottom: 2px solid #111827; }
      .shop { font-size: 24px; font-weight: 800; letter-spacing: 0; }
      .doc-title { text-align: right; text-transform: uppercase; font-size: 26px; font-weight: 800; letter-spacing: 0; }
      .muted { color: #6b7280; }
      .meta { margin-top: 6px; font-size: 11px; color: #4b5563; }
      .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin: 20px 0 18px; }
      .info-box { border: 1px solid #d1d5db; border-radius: 6px; padding: 10px 12px; min-height: 66px; }
      .label { text-transform: uppercase; color: #6b7280; font-size: 9px; font-weight: 700; letter-spacing: .8px; margin-bottom: 4px; }
      .value { font-size: 13px; font-weight: 700; color: #111827; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; }
      th { text-align: left; background: #111827; color: #fff; padding: 8px 9px; font-size: 10px; text-transform: uppercase; letter-spacing: .5px; }
      td { padding: 9px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
      tbody tr:nth-child(even) td { background: #f9fafb; }
      .num { width: 34px; color: #6b7280; text-align: center; }
      .qty { width: 54px; text-align: right; font-weight: 700; }
      .money { width: 80px; text-align: right; white-space: nowrap; }
      .strong { font-weight: 800; }
      .item-name { font-weight: 700; }
      .item-meta { color: #6b7280; font-size: 10px; margin-top: 2px; }
      .orig { color: #374151; }
      .strike { text-decoration: line-through; color: #9ca3af; }
      .disc-cell { text-align: right; }
      .disc-label { color: #d97706; font-weight: 700; }
      .disc-sub { font-size: 9.5px; color: #6b7280; margin-top: 1px; }
      .bottom { display: grid; grid-template-columns: 1fr 260px; gap: 28px; margin-top: 18px; align-items: start; }
      .note { border-left: 4px solid #f6c700; padding: 8px 12px; color: #374151; background: #fffbeb; min-height: 42px; }
      .totals { border: 1px solid #d1d5db; border-radius: 6px; overflow: hidden; }
      .total-row { display: flex; justify-content: space-between; gap: 18px; padding: 8px 12px; border-bottom: 1px solid #e5e7eb; }
      .grand { display: flex; justify-content: space-between; gap: 18px; padding: 12px; background: #111827; color: #fff; font-size: 17px; font-weight: 800; }
      .fineprint { margin-top: 24px; padding-top: 10px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 10px; display: flex; justify-content: space-between; gap: 16px; }
      @media print { .quote { max-width: none; } }
    </style></head><body>
      <div class="quote">
        <div class="topbar"></div>
        <div class="header">
          <div>
            ${shop ? `<div class="shop">${shop}</div>` : ''}
            <div class="meta">Prepared ${escapeHtml(formatDateTime(new Date().toISOString()))}</div>
          </div>
          <div>
            <div class="doc-title">Sales Quote</div>
            <div class="meta">Quote ${quoteNo || 'Draft'}<br>Created ${escapeHtml(formatDate(created))}</div>
          </div>
        </div>

        <div class="info-grid">
          <div class="info-box">
            <div class="label">Prepared For</div>
            <div class="value">${buyer}</div>
          </div>
          <div class="info-box">
            <div class="label">Items</div>
            <div class="value">${totalQty} total item${totalQty === 1 ? '' : 's'}</div>
          </div>
          <div class="info-box">
            <div class="label">Quote Total</div>
            <div class="value">${currency(grandTotal)}</div>
          </div>
        </div>

        <table>
          <thead><tr><th></th><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Original</th><th style="text-align:right">Discount</th><th style="text-align:right">Unit</th><th style="text-align:right">Line Total</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#6b7280;padding:24px">No items on this quote.</td></tr>'}</tbody>
        </table>

        <div class="bottom">
          <div>
            ${note ? `<div class="label">Note</div><div class="note">${escapeHtml(note)}</div>` : ''}
          </div>
          <div class="totals">
            ${totalRows}
            <div class="grand"><span>Total</span><span>${currency(grandTotal)}</span></div>
          </div>
        </div>

        <div class="fineprint">
          <span>Quote is based on current availability and condition at time of preparation.</span>
          <span>${shop}</span>
        </div>
      </div>
      <script>window.print();<\/script>
    </body></html>`);
    win.document.close();
    win.focus();
  };

  const printPickList = (quote, shopName) => {
    const ROWS_PER_PAGE = 10;
    const allLines = quote.lines || [];
    const totalQty = allLines.reduce((s, l) => s + l.qty, 0);
    const shop = (shopName || '').replace(/&/g,'&amp;').replace(/</g,'&lt;');
    const buyer = (quote.buyerName || '—').replace(/&/g,'&amp;');
    const dateStr = new Date().toLocaleString();

    const pages = [];
    for (let i = 0; i < allLines.length; i += ROWS_PER_PAGE) pages.push(allLines.slice(i, i + ROWS_PER_PAGE));
    if (!pages.length) pages.push([]);
    const totalPages = pages.length;

    const pageBlocks = [...pages].reverse().map((pageLines, revIdx) => {
      const pageNum = totalPages - revIdx;
      const rows = pageLines.map(l => `
        <tr>
          <td class="qty">${l.qty}</td>
          <td class="item">
            <div class="name">${(l.name || l.itemNumber || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')}</div>
            <div class="meta">${[l.itemNumber, l.colorName, condLabel(l.condition)].filter(Boolean).join(' · ').replace(/&/g,'&amp;')}</div>
          </td>
          <td class="price">${currency(l.finalUnit)}</td>
        </tr>`).join('');
      const header = pageNum === 1
        ? `<div class="header">${shop ? `<div class="title">${shop}</div>` : ''}<div class="${shop ? 'sub' : 'title'}">Pick List</div><div class="sub">Quote for ${buyer}</div><div class="sub">${dateStr}</div></div>`
        : `<div class="header">${shop ? `<div class="title">${shop}</div>` : ''}<div class="${shop ? 'sub' : 'title'}">Pick List — continued (${pageNum}/${totalPages})</div></div>`;
      const footer = pageNum === 1
        ? `<div class="footer">Items: ${totalQty} · Subtotal: ${currency(quote.finalSubtotal)}${totalPages > 1 ? ` · Page 1/${totalPages}` : ''}</div>`
        : `<div class="footer">Page ${pageNum}/${totalPages}</div>`;
      return `<div class="sheet">${header}<table><tbody>${rows}</tbody></table>${footer}</div>`;
    }).join('');

    const win = window.open('', '_blank', 'width=420,height=620');
    if (!win) { alert('Pop-up blocked.'); return; }
    win.document.write(`<!doctype html><html><head><title>Quote Pick List</title><style>
      @page { size: 4in 6in; margin: 0.15in; }
      body { font-family: Arial, sans-serif; margin: 0; color: #000; }
      .sheet { width: 3.7in; min-height: 5.7in; }
      .sheet:not(:last-child) { page-break-after: always; }
      .header { border-bottom: 1px solid #000; padding-bottom: 8px; margin-bottom: 8px; }
      .title { font-size: 16px; font-weight: 700; }
      .sub { font-size: 11px; margin-top: 3px; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      td { vertical-align: top; padding: 5px 0; border-bottom: 1px solid #ddd; }
      .qty { width: 0.35in; font-size: 14px; font-weight: 700; text-align: center; }
      .item { padding-left: 4px; }
      .price { width: 0.6in; text-align: right; font-weight: 600; white-space: nowrap; }
      .name { font-weight: 700; line-height: 1.2; }
      .meta { color: #444; margin-top: 2px; font-size: 10px; }
      .footer { margin-top: 8px; font-size: 10px; color: #444; }
    </style></head><body>${pageBlocks}</body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  if (editingId !== null) {
    const quoteToEdit = editingId === 'new' ? null : quotes.find(q => q.id === editingId) || null;
    return (
      <QuoteEditor
        quote={quoteToEdit}
        allItems={allItems}
        settings={settings}
        onSave={saveQuote}
        onCancel={() => setEditingId(null)}
        onPrint={(q) => printPickList(q, settings?.shopName)}
        onPrintQuote={(q) => printSalesQuote(q, settings?.shopName)}
      />
    );
  }

  return (
    <div style={{ display:'flex', height:'100%', overflow:'hidden' }}>

      {/* ── Left panel ── */}
      <div style={{ width:260, flexShrink:0, borderRight:'1px solid var(--border)', display:'flex', flexDirection:'column', overflow:'hidden', background:'var(--surface)' }}>
        <div style={{ padding:'16px 14px 10px', borderBottom:'1px solid var(--border)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
            <div style={{ fontSize:13, fontWeight:700, color:'var(--text)', flex:1 }}>Sales Quotes</div>
            <button className="btn btn-primary btn-sm" style={{ fontSize:12 }} onClick={() => { setTab('active'); setEditingId('new'); }}>+ New</button>
          </div>
          {/* Tab switcher */}
          <div style={{ display:'flex', gap:2, marginBottom:8, background:'var(--surface2)', borderRadius:6, padding:2 }}>
            {[
              { key:'active',    label:'Active',    color:'var(--accent)' },
              { key:'completed', label:'Done',      color:'var(--green)'  },
              { key:'archived',  label:'Archived',  color:'var(--text3)'  },
            ].map(({ key, label, color }) => {
              const count = quotes.filter(q => quoteStatus(q) === key).length;
              return (
                <button key={key} onClick={() => { setTab(key); setSelectedId(null); }}
                  style={{ flex:1, fontSize:11, fontWeight:tab===key?700:400, padding:'4px 0',
                    background: tab===key ? 'var(--surface)' : 'transparent',
                    border: tab===key ? '1px solid var(--border)' : '1px solid transparent',
                    borderRadius:4, cursor:'pointer',
                    color: tab===key ? color : 'var(--text3)' }}>
                  {label}{count > 0 ? ` (${count})` : ''}
                </button>
              );
            })}
          </div>
          <input placeholder="Search quotes…" value={search} onChange={e => setSearch(e.target.value)}
            style={{ width:'100%', fontSize:12, padding:'5px 8px' }} />
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'6px 0' }}>
          {tabQuotes.length === 0 ? (
            <div style={{ padding:'20px 14px', fontSize:12, color:'var(--text3)', textAlign:'center', lineHeight:1.6 }}>
              {tab === 'active'    && <>{quotes.length === 0 ? <>No quotes yet.<br />Click <strong>+ New</strong> to create one.</> : 'No active quotes.'}</>}
              {tab === 'completed' && 'No completed sales yet.'}
              {tab === 'archived'  && 'No archived quotes.'}
            </div>
          ) : filteredQuotes.length === 0 ? (
            <div style={{ padding:'20px 14px', fontSize:12, color:'var(--text3)', textAlign:'center' }}>No quotes match.</div>
          ) : filteredQuotes.map(q => (
            <div key={q.id} onClick={() => { if (renamingId !== q.id) setSelectedId(q.id); }}
              className="quote-list-item"
              style={{ padding:'10px 14px', cursor:'pointer', userSelect:'none', position:'relative',
                background: selectedId===q.id ? 'var(--surface2)' : 'transparent',
                borderLeft: selectedId===q.id ? '3px solid var(--accent)' : '3px solid transparent' }}>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                {renamingId === q.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') commitRename(q.id); if (e.key === 'Escape') setRenamingId(null); }}
                    onBlur={() => commitRename(q.id)}
                    onClick={e => e.stopPropagation()}
                    style={{ flex:1, fontSize:13, padding:'2px 5px', borderRadius:4, border:'1px solid var(--accent)' }}
                  />
                ) : (
                  <span style={{ flex:1, fontSize:13, fontWeight:selectedId===q.id?600:400, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {quoteDisplayName(q)}
                  </span>
                )}
                {renamingId !== q.id && (
                  <button
                    className="quote-rename-btn"
                    onClick={e => startRename(q, e)}
                    title="Rename quote"
                    style={{ background:'none', border:'none', cursor:'pointer', padding:'0 2px', fontSize:11, color:'var(--text3)', opacity:0, flexShrink:0 }}>
                    ✏
                  </button>
                )}
                <span style={{ fontSize:12, fontWeight:600, color:'var(--accent)', flexShrink:0 }}>{currency(q.finalSubtotal)}</span>
              </div>
              <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>
                {tab === 'completed' && q.completedAt ? `Completed ${formatDate(q.completedAt)}` : formatDate(q.createdAt)}
                {' · '}{(q.lines||[]).reduce((s,l)=>s+l.qty,0)} items
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right panel ── */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        {!selectedQuote ? (
          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:12, color:'var(--text3)' }}>
            <div style={{ fontSize:40, opacity:.3 }}>📋</div>
            <div style={{ fontSize:14, fontWeight:600 }}>Select a quote or create a new one</div>
            <button className="btn btn-primary" onClick={() => setEditingId('new')}>+ New Quote</button>
          </div>
        ) : (
          <>
            <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
              <div style={{ flex:1 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ fontSize:16, fontWeight:700 }}>{quoteDisplayName(selectedQuote)}</span>
                  {quoteStatus(selectedQuote) === 'completed' && (
                    <span style={{ fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:10, background:'rgba(76,175,125,.18)', color:'var(--green)', textTransform:'uppercase', letterSpacing:'.5px' }}>Completed</span>
                  )}
                  {quoteStatus(selectedQuote) === 'archived' && (
                    <span style={{ fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:10, background:'rgba(150,150,150,.15)', color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.5px' }}>Archived</span>
                  )}
                </div>
                <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>
                  {formatDate(selectedQuote.createdAt)}
                  {selectedQuote.name && selectedQuote.buyerName ? ` · ${selectedQuote.buyerName}` : ''}
                  {selectedQuote.note ? ` · ${selectedQuote.note}` : ''}
                  {selectedQuote.completedAt ? ` · Completed ${formatDate(selectedQuote.completedAt)}` : ''}
                </div>
              </div>
              {/* Print buttons always available */}
              <button className="btn btn-secondary btn-sm" style={{ fontSize:12 }} onClick={() => printSalesQuote(selectedQuote, settings?.shopName)}>🖨 Quote</button>
              <button className="btn btn-secondary btn-sm" style={{ fontSize:12 }} onClick={() => printPickList(selectedQuote, settings?.shopName)}>🖨 Pick List</button>
              {/* Active-only actions */}
              {quoteStatus(selectedQuote) === 'active' && (<>
                <button className="btn btn-secondary btn-sm" style={{ fontSize:12 }} onClick={() => setEditingId(selectedQuote.id)}>✏️ Edit</button>
                <button className="btn btn-secondary btn-sm" style={{ fontSize:12 }}
                  onClick={() => { setPauseStatus(''); setPauseDetail(''); pauseOnBrickLink(selectedQuote, true); }}
                  disabled={pauseStatus === 'working'}
                  title="Move these items to BrickLink stockroom so they can't be purchased">⏸ Pause on BL</button>
                <button className="btn btn-secondary btn-sm" style={{ fontSize:12 }}
                  onClick={() => { setPauseStatus(''); setPauseDetail(''); pauseOnBrickLink(selectedQuote, false); }}
                  disabled={pauseStatus === 'working'}
                  title="Move these items back out of BrickLink stockroom">▶ Unpause on BL</button>
                <button className="btn btn-primary btn-sm" style={{ fontSize:12 }} onClick={() => convertToOrder(selectedQuote)}>🧾 Convert to Order</button>
                <button className="btn btn-primary btn-sm" style={{ fontSize:12, background:'var(--green)', borderColor:'var(--green)' }}
                  onClick={() => { setSaleStatus(''); setSaleDetail(''); completeSale(selectedQuote); }}
                  disabled={saleStatus === 'working'}
                  title="Mark items as sold and remove from BrickLink">✅ Complete Sale</button>
                <button className="btn btn-secondary btn-sm" style={{ fontSize:12, color:'var(--text2)' }}
                  onClick={() => setQuoteStatus(selectedQuote.id, 'archived')}
                  title="Archive this quote without completing it">📦 Archive</button>
              </>)}
              {/* Completed/Archived: restore to active */}
              {quoteStatus(selectedQuote) !== 'active' && (
                <button className="btn btn-secondary btn-sm" style={{ fontSize:12 }}
                  onClick={() => setQuoteStatus(selectedQuote.id, 'active')}
                  title="Move back to active quotes">↩ Restore</button>
              )}
              {/* Archived: also offer to mark completed */}
              {quoteStatus(selectedQuote) === 'archived' && (
                <button className="btn btn-secondary btn-sm" style={{ fontSize:12 }}
                  onClick={() => setQuoteStatus(selectedQuote.id, 'completed')}
                  title="Mark as completed without running the sale process">✅ Mark Completed</button>
              )}
              <button className="btn btn-secondary btn-sm" style={{ fontSize:12, color:'var(--red)' }} onClick={() => deleteQuote(selectedQuote.id)}>Delete</button>
            </div>
            {pauseStatus && (
              <div style={{ padding:'8px 20px', fontSize:12, borderBottom:'1px solid var(--border)',
                background: pauseStatus === 'working' ? 'var(--surface2)' : pauseStatus === 'done' ? 'rgba(76,175,125,.1)' : 'rgba(231,76,76,.1)',
                color: pauseStatus === 'working' ? 'var(--text2)' : pauseStatus === 'done' ? 'var(--green)' : 'var(--red)',
                display:'flex', alignItems:'center', gap:8 }}>
                {pauseStatus === 'done'  && '✓'}
                {pauseStatus === 'error' && '⚠'}
                {pauseDetail}
                {pauseStatus !== 'working' && <button onClick={() => { setPauseStatus(''); setPauseDetail(''); }} style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer', color:'inherit', fontSize:14 }}>✕</button>}
              </div>
            )}
            {saleStatus && (
              <div style={{ padding:'8px 20px', fontSize:12, borderBottom:'1px solid var(--border)',
                background: saleStatus === 'working' ? 'var(--surface2)' : saleStatus === 'done' ? 'rgba(76,175,125,.1)' : 'rgba(231,76,76,.1)',
                color: saleStatus === 'working' ? 'var(--text2)' : saleStatus === 'done' ? 'var(--green)' : 'var(--red)',
                display:'flex', alignItems:'center', gap:8 }}>
                {saleStatus === 'working' && '⏳'}
                {saleStatus === 'done'    && '✓'}
                {saleStatus === 'error'   && '⚠'}
                {saleDetail}
                {saleStatus !== 'working' && <button onClick={() => { setSaleStatus(''); setSaleDetail(''); }} style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer', color:'inherit', fontSize:14 }}>✕</button>}
              </div>
            )}

            {/* Summary cards */}
            {(() => {
              const lines = selectedQuote.lines || [];
              const totalItemSavings = lines.reduce((s, l) =>
                s + (((l.baseUnit ?? l.listedUnit ?? 0) - (l.afterItemUnit ?? l.finalUnit ?? 0)) * l.qty), 0);
              const hasItemDisc   = totalItemSavings > 0.005;
              const hasGlobalDisc = (selectedQuote.globalDiscountAmt || 0) > 0.005;
              return (
                <div style={{ padding:'12px 20px', display:'flex', gap:12, flexWrap:'wrap', borderBottom:'1px solid var(--border)' }}>
                  {[
                    { label:'Items',        value: lines.reduce((s,l)=>s+l.qty,0) },
                    { label:'Listed Total', value: currency(lines.reduce((s,l)=>s+(l.listedUnit||0)*l.qty,0)) },
                    ...(hasItemDisc   ? [{ label:'Item Disc',    value: `-${currency(totalItemSavings)}`,              orange:true }] : []),
                    ...(hasGlobalDisc ? [{ label: hasItemDisc ? 'Global Disc' : 'Discount', value: `-${currency(selectedQuote.globalDiscountAmt)}`, orange:true }] : []),
                    { label:'Subtotal',     value: currency(selectedQuote.finalSubtotal) },
                    ...(selectedQuote.shipping ? [{ label:'Shipping', value: currency(selectedQuote.shipping) }] : []),
                    ...(selectedQuote.fees     ? [{ label:'Fees',     value: currency(selectedQuote.fees)     }] : []),
                    { label:'Grand Total',  value: currency(selectedQuote.grandTotal), accent:true },
                  ].map(({ label, value, accent, orange }) => (
                    <div key={label} style={{ padding:'8px 12px', border:'1px solid var(--border)', borderRadius:8, background:'var(--surface2)', minWidth:100 }}>
                      <div style={{ fontSize:10, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'.4px' }}>{label}</div>
                      <div style={{ fontWeight:700, fontSize:15, marginTop:2, color: accent ? 'var(--accent)' : orange ? 'var(--orange)' : 'var(--text)' }}>{value}</div>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Line items */}
            <div style={{ flex:1, overflowY:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                <thead>
                  <tr style={{ background:'var(--surface2)' }}>
                    {[['Item','left'],['Cond','left'],['Qty','right'],['Listed','right'],['Suggested','right'],['Discount','right'],['Unit Price','right'],['Line Total','right']].map(([h,a]) => (
                      <th key={h} style={{ padding:'8px 12px', textAlign:a, fontWeight:600, color:'var(--text2)', fontSize:11, textTransform:'uppercase', letterSpacing:'.4px', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(selectedQuote.lines||[]).map((line, i) => (
                    <tr key={i} style={{ background: i%2===0?'transparent':'rgba(0,0,0,.025)', borderBottom:'1px solid var(--border)' }}>
                      <td style={{ padding:'9px 12px' }}>
                        <div style={{ fontWeight:500 }}>{line.name || line.itemNumber}</div>
                        {line.name && line.itemNumber && <div style={{ fontSize:11, color:'var(--text3)' }}>{line.itemNumber}{line.colorName ? ` · ${line.colorName}` : ''}</div>}
                      </td>
                      <td style={{ padding:'9px 12px', color:'var(--text2)', fontSize:12, whiteSpace:'nowrap' }}>{condLabel(line.condition)}</td>
                      <td style={{ padding:'9px 12px', textAlign:'right', fontWeight:600 }}>{line.qty}</td>
                      <td style={{ padding:'9px 12px', textAlign:'right', color:'var(--text3)' }}>{line.listedUnit > 0 ? currency(line.listedUnit) : '—'}</td>
                      <td style={{ padding:'9px 12px', textAlign:'right', color:'var(--text3)' }}>{line.suggested > 0 ? currency(line.suggested) : '—'}</td>
                      <td style={{ padding:'9px 12px', textAlign:'right' }}>
                        {(() => {
                          const itemSav   = ((line.baseUnit ?? line.listedUnit ?? 0) - (line.afterItemUnit ?? line.finalUnit ?? 0));
                          const globalSav = ((line.afterItemUnit ?? line.finalUnit ?? 0) - (line.finalUnit ?? 0));
                          const hasItem   = (line.itemDiscount || 0) > 0;
                          const hasGlobal = globalSav > 0.005;
                          if (!hasItem && !hasGlobal) return <span style={{ color:'var(--text3)' }}>—</span>;
                          return (
                            <>
                              {hasItem && (
                                <div style={{ color:'var(--orange)' }}>
                                  {line.itemDiscountType === 'pct'
                                    ? `-${line.itemDiscount}%`
                                    : `-${currency(line.itemDiscount)}`}
                                </div>
                              )}
                              {hasItem && line.itemDiscountType === 'pct' && itemSav > 0.005 && (
                                <div style={{ fontSize:10, color:'var(--text3)' }}>-{currency(itemSav)}</div>
                              )}
                              {hasGlobal && (
                                <div style={{ fontSize:10, color:'var(--text3)' }}>-{currency(globalSav)} global</div>
                              )}
                            </>
                          );
                        })()}
                      </td>
                      <td style={{ padding:'9px 12px', textAlign:'right' }}>{currency(line.finalUnit)}</td>
                      <td style={{ padding:'9px 12px', textAlign:'right', fontWeight:600, color:'var(--accent)' }}>{currency(line.finalUnit * line.qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ padding:'10px 20px', borderTop:'1px solid var(--border)', display:'flex', gap:24, alignItems:'baseline', background:'var(--surface2)', flexWrap:'wrap' }}>
              <div><span style={{ fontSize:11, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'.4px', fontWeight:600 }}>Listed Total </span><span style={{ fontSize:16, fontWeight:700, color:'var(--text3)' }}>{currency((selectedQuote.lines||[]).reduce((s,l)=>s+(l.listedUnit||0)*l.qty,0))}</span></div>
              <div><span style={{ fontSize:11, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'.4px', fontWeight:600 }}>Subtotal </span><span style={{ fontSize:18, fontWeight:700 }}>{currency(selectedQuote.finalSubtotal)}</span></div>
              {selectedQuote.grandTotal !== selectedQuote.finalSubtotal && (
                <div><span style={{ fontSize:11, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'.4px', fontWeight:600 }}>Grand Total </span><span style={{ fontSize:20, fontWeight:700, color:'var(--accent)' }}>{currency(selectedQuote.grandTotal)}</span></div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Quote Editor ───
function QuoteEditor({ quote, allItems, settings, onSave, onCancel, onPrint, onPrintQuote }) {
  const [buyerName, setBuyerName] = React.useState(quote?.buyerName || '');
  const [note,      setNote]      = React.useState(quote?.note || '');
  const [lines,     setLines]     = React.useState(quote?.lines || []);
  const [globalDiscount,     setGlobalDiscount]     = React.useState(String(quote?.globalDiscount || ''));
  const [globalDiscountType, setGlobalDiscountType] = React.useState(quote?.globalDiscountType || 'pct'); // 'pct' | 'flat'
  const [shipping,  setShipping]  = React.useState(String(quote?.shipping || ''));
  const [fees,      setFees]      = React.useState(String(quote?.fees || ''));

  // Item picker state
  const [pickerSearch, setPickerSearch] = React.useState('');
  const [pickerOpen,   setPickerOpen]   = React.useState(false);
  const pickerRef = React.useRef(null);

  React.useEffect(() => {
    const handler = (e) => { if (pickerRef.current && !pickerRef.current.contains(e.target)) setPickerOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const pickerResults = React.useMemo(() => {
    if (!pickerSearch.trim()) return [];
    const q = pickerSearch.toLowerCase();
    return allItems.filter(i =>
      (i.name || '').toLowerCase().includes(q) ||
      (i.itemNumber || '').toLowerCase().includes(q) ||
      (i.theme || '').toLowerCase().includes(q)
    ).slice(0, 30);
  }, [allItems, pickerSearch]);

  const addItem = (item) => {
    const listed = Number(item.platformPrices?.bricklink || item.listPrice || 0);
    const suggested = suggestedPrice(item) || item.estimatedValue || 0;
    setLines(prev => [...prev, {
      id:          item.id,
      name:        item.name,
      itemNumber:  item.itemNumber,
      condition:   item.condition,
      colorName:   item.color,
      qty:         1,
      available:   item.quantity || 1,
      listedUnit:  listed,
      suggested:   suggested,
      itemDiscount: 0,
      itemDiscountType: 'flat', // 'flat' | 'pct'
    }]);
    setPickerSearch('');
    setPickerOpen(false);
  };

  const refreshPrices = () => {
    setLines(prev => prev.map(line => {
      const item = allItems.find(i => i.id === line.id);
      if (!item) return line;
      const pp = item.platformPrices || {};
      const blKey = Object.keys(pp).find(k => k.toLowerCase().replace(/\s+/g, '') === 'bricklink');
      const blPrice = blKey != null ? Number(pp[blKey]) : 0;
      const listed = blPrice > 0 ? blPrice : Number(item.listPrice || 0);
      const suggested = suggestedPrice(item) || item.estimatedValue || 0;
      return { ...line, listedUnit: listed, suggested, available: item.quantity || line.available };
    }));
  };

  const removeLine = (idx) => setLines(prev => prev.filter((_, i) => i !== idx));

  const updateLine = (idx, field, value) => {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };

  // Computed: apply per-item discounts then global discount
  const computedLines = React.useMemo(() => {
    return lines.map(l => {
      const base = l.listedUnit > 0 ? l.listedUnit : (l.suggested || 0);
      const itemDisc = Number(l.itemDiscount) || 0;
      const afterItem = l.itemDiscountType === 'pct'
        ? base * (1 - itemDisc / 100)
        : base - itemDisc;
      return { ...l, baseUnit: base, afterItemUnit: Math.round(Math.max(0, afterItem) * 100) / 100 };
    });
  }, [lines]);

  const preDiscountSubtotal = computedLines.reduce((s, l) => s + l.afterItemUnit * l.qty, 0);

  const globalDiscVal = parseFloat(globalDiscount) || 0;
  const globalDiscountAmt = Math.round((globalDiscountType === 'pct'
    ? preDiscountSubtotal * (globalDiscVal / 100)
    : globalDiscVal) * 100) / 100;
  const finalSubtotal = Math.round(Math.max(0, preDiscountSubtotal - globalDiscountAmt) * 100) / 100;

  const finalLines = computedLines.map(l => {
    const globalShare = preDiscountSubtotal > 0
      ? (l.afterItemUnit * l.qty / preDiscountSubtotal) * globalDiscountAmt / l.qty
      : 0;
    const finalUnit = Math.max(0, l.afterItemUnit - globalShare);
    return { ...l, finalUnit: Math.round(finalUnit * 100) / 100, itemDiscount: Number(l.itemDiscount) || 0 };
  });

  const shippingVal = parseFloat(shipping) || 0;
  const feesVal     = parseFloat(fees)     || 0;
  const grandTotal  = Math.round((finalSubtotal + shippingVal + feesVal) * 100) / 100;

  const buildQuote = () => ({
    id:                 quote?.id || genId(),
    createdAt:          quote?.createdAt || new Date().toISOString(),
    updatedAt:          new Date().toISOString(),
    buyerName,
    note,
    globalDiscount:     globalDiscVal,
    globalDiscountType,
    globalDiscountAmt,
    shipping:           shippingVal,
    fees:               feesVal,
    finalSubtotal,
    grandTotal,
    lines:              finalLines,
  });

  const condLabel = (c) => ({ new_sealed:'New/Sealed', new_open:'New/Open', used_complete:'Used-Complete', used_incomplete:'Used-Incomplete' })[c] || c || '—';

  const inputStyle = { fontSize:13, padding:'5px 8px' };
  const labelStyle = { fontSize:11, fontWeight:600, color:'var(--text2)', marginBottom:3, display:'block', textTransform:'uppercase', letterSpacing:'.3px' };

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>

      {/* Header */}
      <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
        <div style={{ fontSize:16, fontWeight:700, flex:1 }}>{quote ? 'Edit Quote' : 'New Quote'}</div>
        <button className="btn btn-secondary btn-sm" style={{ fontSize:12 }} onClick={refreshPrices} disabled={lines.length === 0} title="Re-pull listed and suggested prices from current inventory data">↻ Refresh Prices</button>
        <button className="btn btn-secondary btn-sm" style={{ fontSize:12 }} onClick={() => onPrintQuote(buildQuote())} disabled={finalLines.length === 0}>🖨 Print Quote</button>
        <button className="btn btn-secondary btn-sm" style={{ fontSize:12 }} onClick={() => onPrint(buildQuote())} disabled={finalLines.length === 0}>🖨 Print Pick List</button>
        <button className="btn btn-secondary btn-sm" style={{ fontSize:12 }} onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary btn-sm" style={{ fontSize:12 }} onClick={() => onSave(buildQuote())} disabled={finalLines.length === 0}>Save Quote</button>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'16px 20px' }}>

        {/* Buyer / note */}
        <div style={{ display:'flex', gap:16, marginBottom:20, flexWrap:'wrap' }}>
          <div style={{ flex:'1 1 200px' }}>
            <label style={labelStyle}>Buyer name</label>
            <input value={buyerName} onChange={e => setBuyerName(e.target.value)} placeholder="e.g. John Smith" style={{ ...inputStyle, width:'100%' }} />
          </div>
          <div style={{ flex:'2 1 300px' }}>
            <label style={labelStyle}>Note</label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Reddit deal, lot discount agreed" style={{ ...inputStyle, width:'100%' }} />
          </div>
        </div>

        {/* Item picker */}
        <div style={{ marginBottom:16 }} ref={pickerRef}>
          <label style={labelStyle}>Add items</label>
          <div style={{ position:'relative' }}>
            <input
              value={pickerSearch}
              onChange={e => { setPickerSearch(e.target.value); setPickerOpen(true); }}
              onFocus={() => setPickerOpen(true)}
              placeholder="Search inventory by name, item #, or theme…"
              style={{ ...inputStyle, width:'100%' }}
            />
            {pickerOpen && pickerResults.length > 0 && (
              <div style={{ position:'absolute', top:'100%', left:0, right:0, zIndex:50, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, boxShadow:'0 8px 24px rgba(0,0,0,.4)', maxHeight:240, overflowY:'auto', marginTop:4 }}>
                {pickerResults.map(item => {
                  const listed = Number(item.platformPrices?.bricklink || item.listPrice || 0);
                  const suggested = suggestedPrice(item) || item.estimatedValue || 0;
                  return (
                    <div key={item.id} onClick={() => addItem(item)}
                      style={{ padding:'8px 12px', cursor:'pointer', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:10 }}
                      onMouseEnter={e => e.currentTarget.style.background='var(--surface2)'}
                      onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13, fontWeight:500 }}>{item.name}</div>
                        <div style={{ fontSize:11, color:'var(--text3)' }}>{item.itemNumber}{item.color && item.color !== '(Not Applicable)' ? ` · ${item.color}` : ''} · {condLabel(item.condition)} · qty {item.quantity || 1}</div>
                      </div>
                      <div style={{ textAlign:'right', flexShrink:0 }}>
                        {listed > 0 && <div style={{ fontSize:12, fontWeight:600, color:'var(--blue)' }}>{currency(listed)} listed</div>}
                        {suggested > 0 && <div style={{ fontSize:11, color:'var(--text3)' }}>{currency(suggested)} guide</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Lines table */}
        {finalLines.length === 0 ? (
          <div style={{ padding:'32px', textAlign:'center', color:'var(--text3)', fontSize:13, border:'1px dashed var(--border)', borderRadius:8 }}>
            Search for items above to add them to this quote.
          </div>
        ) : (
          <div style={{ marginBottom:20, overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ background:'var(--surface2)' }}>
                  {[['#','right'],['Item','left'],['Cond','left'],['Qty','right'],['Listed','right'],['Suggested','right'],['Item Disc.','right'],['After Item Disc.','right'],...( globalDiscVal > 0 ? [['Global Disc.','right'],['Final Unit','right']] : []),[''],].map(([h,a]) => (
                    <th key={h} style={{ padding:'7px 10px', textAlign:a||'center', fontWeight:600, color:'var(--text2)', fontSize:11, textTransform:'uppercase', letterSpacing:'.4px', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {finalLines.map((line, idx) => (
                  <tr key={idx} style={{ borderBottom:'1px solid var(--border)', background: idx%2===0?'transparent':'rgba(0,0,0,.02)' }}>
                    <td style={{ padding:'7px 8px', textAlign:'right', color:'var(--text3)', fontSize:12, fontWeight:600, width:34 }}>{idx + 1}</td>
                    <td style={{ padding:'7px 10px' }}>
                      <div style={{ fontWeight:500 }}>{line.name || line.itemNumber}</div>
                      {line.name && <div style={{ fontSize:11, color:'var(--text3)' }}>{line.itemNumber}{line.colorName ? ` · ${line.colorName}` : ''}</div>}
                    </td>
                    <td style={{ padding:'7px 10px', color:'var(--text2)', fontSize:12, whiteSpace:'nowrap' }}>{condLabel(line.condition)}</td>
                    <td style={{ padding:'7px 6px', textAlign:'right' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:4, justifyContent:'flex-end' }}>
                        <input type="number" min="1" max={line.available || undefined} value={line.qty}
                          onChange={e => updateLine(idx, 'qty', Math.max(1, parseInt(e.target.value)||1))}
                          style={{ width:48, fontSize:12, padding:'2px 4px', textAlign:'right' }} />
                        {line.available != null && <span style={{ fontSize:11, color:'var(--text3)', whiteSpace:'nowrap' }}>/ {line.available}</span>}
                      </div>
                    </td>
                    <td style={{ padding:'7px 10px', textAlign:'right', color:'var(--text3)' }}>
                      <input type="number" min="0" step="0.01" value={line.listedUnit || ''}
                        onChange={e => updateLine(idx, 'listedUnit', parseFloat(e.target.value)||0)}
                        style={{ width:72, fontSize:12, padding:'2px 4px', textAlign:'right' }} />
                    </td>
                    <td style={{ padding:'7px 10px', textAlign:'right', color:'var(--text3)' }}>
                      {line.suggested > 0 ? currency(line.suggested) : '—'}
                    </td>
                    <td style={{ padding:'7px 6px', textAlign:'right' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:4, justifyContent:'flex-end' }}>
                        <input type="number" min="0" step="0.01" value={line.itemDiscount || ''}
                          onChange={e => updateLine(idx, 'itemDiscount', parseFloat(e.target.value)||0)}
                          placeholder="0"
                          style={{ width:56, fontSize:12, padding:'2px 4px', textAlign:'right' }} />
                        <select value={line.itemDiscountType}
                          onChange={e => updateLine(idx, 'itemDiscountType', e.target.value)}
                          style={{ fontSize:11, padding:'2px 3px' }}>
                          <option value="flat">$</option>
                          <option value="pct">%</option>
                        </select>
                      </div>
                    </td>
                    <td style={{ padding:'7px 10px', textAlign:'right', color: line.itemDiscount > 0 ? 'var(--accent)' : 'var(--text3)' }}>
                      {currency(line.afterItemUnit)}
                      {line.qty > 1 && <div style={{ fontSize:10, color:'var(--text3)', fontWeight:400 }}>{currency(line.afterItemUnit * line.qty)}</div>}
                    </td>
                    {globalDiscVal > 0 && (() => {
                      const globalShare = preDiscountSubtotal > 0
                        ? (line.afterItemUnit * line.qty / preDiscountSubtotal) * globalDiscountAmt / line.qty
                        : 0;
                      return (
                        <>
                          <td style={{ padding:'7px 10px', textAlign:'right', color:'var(--orange)', fontSize:12 }}>
                            {globalShare > 0 ? `−${currency(globalShare)}` : '—'}
                          </td>
                          <td style={{ padding:'7px 10px', textAlign:'right', fontWeight:600, color:'var(--accent)' }}>
                            {currency(line.finalUnit)}
                            {line.qty > 1 && <div style={{ fontSize:10, color:'var(--text3)', fontWeight:400 }}>{currency(line.finalUnit * line.qty)} total</div>}
                          </td>
                        </>
                      );
                    })()}
                    <td style={{ padding:'7px 6px', textAlign:'center' }}>
                      <button className="btn-icon" onClick={() => removeLine(idx)} title="Remove" style={{ color:'var(--red)' }}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Totals / global discount */}
        {finalLines.length > 0 && (
          <div style={{ display:'flex', gap:20, flexWrap:'wrap', alignItems:'flex-start' }}>

            {/* Global discount */}
            <div style={{ padding:'14px 16px', border:'1px solid var(--border)', borderRadius:8, background:'var(--surface2)', minWidth:260 }}>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--text)', marginBottom:10 }}>Global Discount</div>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <input type="number" min="0" step="0.01" value={globalDiscount}
                  onChange={e => setGlobalDiscount(e.target.value)}
                  placeholder="0"
                  style={{ width:80, fontSize:13, padding:'4px 8px', textAlign:'right' }} />
                <select value={globalDiscountType} onChange={e => setGlobalDiscountType(e.target.value)}
                  style={{ fontSize:12, padding:'4px 6px' }}>
                  <option value="pct">% off subtotal</option>
                  <option value="flat">$ off subtotal</option>
                </select>
              </div>
              {globalDiscountAmt > 0 && (
                <div style={{ fontSize:12, color:'var(--orange)', marginTop:6 }}>
                  −{currency(globalDiscountAmt)} off
                </div>
              )}
            </div>

            {/* Shipping / fees */}
            <div style={{ padding:'14px 16px', border:'1px solid var(--border)', borderRadius:8, background:'var(--surface2)', minWidth:200 }}>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--text)', marginBottom:10 }}>Shipping & Fees</div>
              <div style={{ display:'flex', gap:12 }}>
                <div>
                  <label style={{ ...labelStyle, marginBottom:4 }}>Shipping</label>
                  <input type="number" min="0" step="0.01" value={shipping}
                    onChange={e => setShipping(e.target.value)}
                    placeholder="0.00"
                    style={{ width:80, fontSize:13, padding:'4px 8px', textAlign:'right' }} />
                </div>
                <div>
                  <label style={{ ...labelStyle, marginBottom:4 }}>Fees</label>
                  <input type="number" min="0" step="0.01" value={fees}
                    onChange={e => setFees(e.target.value)}
                    placeholder="0.00"
                    style={{ width:80, fontSize:13, padding:'4px 8px', textAlign:'right' }} />
                </div>
              </div>
            </div>

            {/* Summary */}
            <div style={{ padding:'14px 16px', border:'1px solid var(--accent)', borderRadius:8, background:'rgba(76,140,231,.06)', minWidth:200 }}>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--text)', marginBottom:10 }}>Summary</div>
              <div style={{ display:'flex', flexDirection:'column', gap:4, fontSize:13 }}>
                <div style={{ display:'flex', justifyContent:'space-between', gap:24 }}>
                  <span style={{ color:'var(--text2)' }}>Listed total</span>
                  <span style={{ color:'var(--text3)' }}>{currency(computedLines.reduce((s,l)=>s+(l.listedUnit||0)*l.qty,0))}</span>
                </div>
                {globalDiscountAmt > 0 && (
                  <div style={{ display:'flex', justifyContent:'space-between', gap:24 }}>
                    <span style={{ color:'var(--text2)' }}>Discount</span>
                    <span style={{ color:'var(--orange)' }}>−{currency(globalDiscountAmt)}</span>
                  </div>
                )}
                <div style={{ display:'flex', justifyContent:'space-between', gap:24 }}>
                  <span style={{ color:'var(--text2)' }}>Subtotal</span>
                  <span style={{ fontWeight:600 }}>{currency(finalSubtotal)}</span>
                </div>
                {shippingVal > 0 && (
                  <div style={{ display:'flex', justifyContent:'space-between', gap:24 }}>
                    <span style={{ color:'var(--text2)' }}>Shipping</span>
                    <span>{currency(shippingVal)}</span>
                  </div>
                )}
                {feesVal > 0 && (
                  <div style={{ display:'flex', justifyContent:'space-between', gap:24 }}>
                    <span style={{ color:'var(--text2)' }}>Fees</span>
                    <span>{currency(feesVal)}</span>
                  </div>
                )}
                <div style={{ display:'flex', justifyContent:'space-between', gap:24, borderTop:'1px solid var(--border)', paddingTop:6, marginTop:4 }}>
                  <span style={{ fontWeight:700 }}>Grand Total</span>
                  <span style={{ fontWeight:700, fontSize:16, color:'var(--accent)' }}>{currency(grandTotal)}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
