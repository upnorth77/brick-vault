// ─── Sell Lot Modal ───
// Records a sale of multiple different items as a single lot.
// Revenue, fees, and shipping are all split proportionally by each item's list price × qty sold.
// If no list prices are set, falls back to splitting evenly by quantity.
// Each item gets its own sold record (consistent with individual sales).
// Partial quantities are supported: the original item's qty is reduced if not all are sold.

function SellLotModal({ items, onConfirm, onClose }) {
  // Build initial lot entries from all available items (qty default 0 — user picks what to include)
  const makeEntry = (item) => ({ id: item.id, qty: '' });

  const [entries,   setEntries]   = React.useState(() => items.map(makeEntry));
  const [lotPrice,  setLotPrice]  = React.useState('');
  const [fees,      setFees]      = React.useState('');
  const [shipping,  setShipping]  = React.useState('');
  const [platform,  setPlatform]  = React.useState('');
  const [search,    setSearch]    = React.useState('');

  // Map item id → item for quick lookup
  const itemMap = React.useMemo(() => {
    const m = {};
    items.forEach(i => { m[i.id] = i; });
    return m;
  }, [items]);

  // Only entries where the user typed a qty > 0
  const activeEntries = React.useMemo(() =>
    entries
      .map(e => ({ ...e, qty: Math.max(0, parseInt(e.qty) || 0) }))
      .filter(e => e.qty > 0 && itemMap[e.id]),
    [entries, itemMap]
  );

  const totalLotPrice = parseFloat(lotPrice)  || 0;
  const totalFees     = parseFloat(fees)       || 0;
  const totalShip     = parseFloat(shipping)   || 0;
  const totalQty      = activeEntries.reduce((s, e) => s + e.qty, 0);

  // ─── List-price basis: each item's listPrice × qty (drives revenue, fees, and shipping split) ───
  const totalListBasis = React.useMemo(() =>
    activeEntries.reduce((s, e) => s + (itemMap[e.id]?.listPrice || 0) * e.qty, 0),
    [activeEntries, itemMap]
  );

  const rowData = React.useMemo(() => {
    const overhead = totalFees + totalShip;
    return activeEntries.map(e => {
      const item      = itemMap[e.id];
      const costEach  = item?.purchasePrice || 0;
      const costTotal = costEach * e.qty;
      const listTotal = (item?.listPrice || 0) * e.qty;

      // Revenue, fees, and shipping all proportional to list price × qty; fall back to qty if no list prices set
      const listShare = totalListBasis > 0
        ? listTotal / totalListBasis
        : totalQty > 0 ? e.qty / totalQty : 0;

      const revShare      = Math.round(listShare * totalLotPrice * 100) / 100;
      const feesShare     = Math.round(listShare * totalFees     * 100) / 100;
      const shippingShare = Math.round(listShare * totalShip     * 100) / 100;
      const overheadShare = feesShare + shippingShare;

      const profit = revShare - costTotal - overheadShare;

      return {
        item,
        qty: e.qty,
        maxQty: item?.quantity || 1,
        listTotal,
        costTotal,
        revShare,
        feesShare,
        shippingShare,
        overheadShare,
        profit,
        // Sale price per unit stored on the sold record
        salePriceEach: e.qty > 0 ? Math.round(revShare / e.qty * 100) / 100 : 0,
      };
    });
  }, [activeEntries, itemMap, totalLotPrice, totalFees, totalShip, totalQty, totalListBasis]);

  const totalRevenue = rowData.reduce((s, r) => s + r.revShare, 0);
  const totalCost    = rowData.reduce((s, r) => s + r.costTotal, 0);
  const totalProfit  = rowData.reduce((s, r) => s + r.profit, 0);

  // Validation
  const canConfirm = activeEntries.length >= 2 && totalLotPrice > 0 &&
    activeEntries.every(e => e.qty <= (itemMap[e.id]?.quantity || 1));

  const setQty = (id, val) => {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, qty: val } : e));
  };

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm({
      rows: rowData.map(r => ({
        item:         r.item,
        qtySold:      r.qty,
        salePrice:    r.salePriceEach,
        fees:         r.feesShare,
        shippingCost: r.shippingShare,
        platform,
      })),
    });
  };

  // Filtered list for item picker
  const filteredItems = React.useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(i =>
      i.name?.toLowerCase().includes(q) ||
      i.itemNumber?.toLowerCase().includes(q) ||
      i.theme?.toLowerCase().includes(q)
    );
  }, [items, search]);

  const entryMap = React.useMemo(() => {
    const m = {};
    entries.forEach(e => { m[e.id] = e; });
    return m;
  }, [entries]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 680, width: '95vw' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Record Lot Sale</h2>
          <button className="btn-icon" onClick={onClose}>{Icons.x}</button>
        </div>

        <div className="modal-body" style={{ maxHeight: '75vh', overflowY: 'auto' }}>

          {/* ── Item Picker ── */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: 'var(--text)' }}>
              Items in Lot
              <span style={{ fontWeight: 400, color: 'var(--text2)', marginLeft: 8 }}>
                Enter a quantity next to each item to include it
              </span>
            </div>

            {/* Search */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <button className="btn-icon" title="Clear search"
                style={{ opacity: search ? 1 : 0.35, flexShrink: 0 }}
                onClick={() => setSearch('')}>
                {Icons.x}
              </button>
              <input className="search-box" placeholder="Filter items…" value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ flex: 1 }} />
            </div>

            {/* Item rows */}
            <div style={{
              border: '1px solid var(--border)', borderRadius: 8,
              maxHeight: 260, overflowY: 'auto',
              background: 'var(--surface2)',
            }}>
              {filteredItems.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>No items match</div>
              ) : filteredItems.map(item => {
                const entry  = entryMap[item.id] || { qty: '' };
                const qty    = parseInt(entry.qty) || 0;
                const maxQty = item.quantity || 1;
                const over   = qty > maxQty;
                return (
                  <div key={item.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px',
                    borderBottom: '1px solid var(--border)',
                    background: qty > 0 ? 'rgba(246,199,0,.06)' : undefined,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.name || item.itemNumber}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                        {item.itemNumber}{item.theme ? ` · ${item.theme}` : ''} · {maxQty} listed
                        {item.listPrice ? ` · list ${currency(item.listPrice)} ea` : ''}
                        {item.purchasePrice ? ` · cost ${currency(item.purchasePrice)} ea` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <input
                        type="number" min="0" max={maxQty}
                        placeholder="0"
                        value={entry.qty}
                        onChange={e => setQty(item.id, e.target.value)}
                        style={{
                          width: 64, textAlign: 'center', fontSize: 13,
                          borderColor: over ? 'var(--red)' : undefined,
                        }}
                      />
                      <span style={{ fontSize: 11, color: over ? 'var(--red)' : 'var(--text3)', width: 48 }}>
                        {over ? `max ${maxQty}` : qty > 0 ? `of ${maxQty}` : `/ ${maxQty}`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {activeEntries.length > 0 && (
              <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6 }}>
                {activeEntries.length} item type{activeEntries.length !== 1 ? 's' : ''}, {totalQty} unit{totalQty !== 1 ? 's' : ''} total
              </div>
            )}
            {activeEntries.length < 2 && (
              <div style={{ fontSize: 12, color: 'var(--orange)', marginTop: 4 }}>
                Add at least 2 different items to record a lot sale
              </div>
            )}
          </div>

          {/* ── Sale Details ── */}
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: 'var(--text)' }}>Sale Details</div>

          <div className="form-row">
            <div className="form-group">
              <label>Total Lot Price ($)</label>
              <input type="number" step="0.01" min="0" placeholder="0.00"
                value={lotPrice} onChange={e => setLotPrice(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Platform</label>
              <input placeholder="BrickLink, eBay, etc."
                value={platform} onChange={e => setPlatform(e.target.value)} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Fees ($)</label>
              <input type="number" step="0.01" min="0" placeholder="0.00"
                value={fees} onChange={e => setFees(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Shipping Cost ($)</label>
              <input type="number" step="0.01" min="0" placeholder="0.00"
                value={shipping} onChange={e => setShipping(e.target.value)} />
            </div>
          </div>

          {/* ── Per-item breakdown ── */}
          {rowData.length > 0 && totalLotPrice > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: 'var(--text)' }}>
                Lot Breakdown
                <span style={{ fontWeight: 400, color: 'var(--text2)', marginLeft: 8, fontSize: 12 }}>
                  Revenue, fees &amp; shipping all split proportionally by list price
                </span>
              </div>
              {totalListBasis === 0 && activeEntries.length > 0 && (
                <div style={{ fontSize: 12, color: 'var(--orange)', marginBottom: 8 }}>
                  ⚠ No list prices set — revenue split evenly by quantity instead
                </div>
              )}
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--surface2)', color: 'var(--text2)' }}>
                      <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600 }}>Item</th>
                      <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>Qty</th>
                      <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>List Value</th>
                      <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>Revenue</th>
                      <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>Cost</th>
                      <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>Overhead</th>
                      <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowData.map(r => (
                      <tr key={r.item.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '6px 10px', color: 'var(--text)' }}>
                          <span style={{ fontWeight: 500 }}>{r.item.name || r.item.itemNumber}</span>
                          <span style={{ color: 'var(--text3)', marginLeft: 4 }}>{r.item.itemNumber}</span>
                          {r.qty >= r.maxQty && (
                            <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text3)' }}>all units</span>
                          )}
                        </td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text2)' }}>{r.qty}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text2)' }}>
                          {r.listTotal > 0 ? currency(r.listTotal) : '—'}
                        </td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 500 }}>{currency(r.revShare)}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text2)' }}>−{currency(r.costTotal)}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text2)' }}>
                          {r.overheadShare > 0 ? `−${currency(r.overheadShare)}` : '—'}
                        </td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700,
                          color: r.profit >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {currency(r.profit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface2)' }}>
                      <td style={{ padding: '7px 10px', fontWeight: 700, color: 'var(--text)' }}>Total</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 600 }}>{totalQty}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text2)' }}>
                        {totalListBasis > 0 ? currency(totalListBasis) : '—'}
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 600 }}>{currency(totalRevenue)}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text2)' }}>−{currency(totalCost)}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text2)' }}>
                        {totalFees + totalShip > 0 ? `−${currency(totalFees + totalShip)}` : '—'}
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700,
                        color: totalProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {currency(totalProfit)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleConfirm}
            disabled={!canConfirm}
            title={!canConfirm ? 'Add at least 2 items and enter a lot price' : undefined}>
            Record Lot Sale ({totalQty} unit{totalQty !== 1 ? 's' : ''})
          </button>
        </div>
      </div>
    </div>
  );
}
