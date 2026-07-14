// ─── Sales Orders Page ───
// Lists all locally-saved sales orders (created from Wanted List → Sales Order → Import Sale).
// Supports viewing order detail, searching, and deleting orders.

function SalesOrdersPage({ data, setData }) {
  const orders = React.useMemo(() => data.salesOrders || [], [data.salesOrders]);

  const [selectedId,   setSelectedId]   = React.useState(null);
  const [search,       setSearch]       = React.useState('');
  const [pauseStatus,  setPauseStatus]  = React.useState(''); // '', 'working', 'done', 'error'
  const [pauseDetail,  setPauseDetail]  = React.useState(''); // summary or error text

  // Auto-select first order
  React.useEffect(() => {
    if (!selectedId && orders.length > 0) setSelectedId(orders[0].id);
    if (selectedId && !orders.find(o => o.id === selectedId) && orders.length > 0) {
      setSelectedId(orders[0].id);
    }
  }, [orders, selectedId]);

  const filteredOrders = React.useMemo(() => {
    if (!search.trim()) return orders;
    const q = search.toLowerCase();
    return orders.filter(o =>
      (o.buyerName || '').toLowerCase().includes(q) ||
      (o.listName  || '').toLowerCase().includes(q) ||
      (o.note      || '').toLowerCase().includes(q) ||
      (o.lines || []).some(l => (l.name || '').toLowerCase().includes(q) || (l.itemNumber || '').toLowerCase().includes(q))
    );
  }, [orders, search]);

  const selectedOrder = orders.find(o => o.id === selectedId) || null;

  const deleteOrder = (id) => {
    if (!confirm('Delete this sales order record? This does not affect your inventory.')) return;
    setData(prev => ({ ...prev, salesOrders: (prev.salesOrders || []).filter(o => o.id !== id) }));
    if (selectedId === id) setSelectedId(null);
  };

  const condLabel = (c) => ({ new_sealed:'New/Sealed', new_open:'New/Open', used_complete:'Used-Complete', used_incomplete:'Used-Incomplete' })[c] || c || '—';

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

  // ── Pause items on BrickLink (move to stockroom) ──
  const pauseOnBrickLink = async (order, pause) => {
    const verb = pause ? 'paused' : 'unpaused';
    setPauseStatus('working');
    setPauseDetail('Fetching store inventory…');

    // 1. Pull current store inventory (try cache first, then live)
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

    // 2. For each order line, find matching store inventory items
    const condMap = { new_sealed:'N', new_open:'N', used_complete:'U', used_incomplete:'U' };
    const lines = order.lines || [];
    const matches = [];
    const unmatched = [];

    for (const line of lines) {
      const lineNo   = (line.itemNumber || '').toLowerCase().replace(/-1$/, '');
      const lineCond = condMap[line.condition] || null;
      const found = inventories.filter(inv => {
        const invNo = (inv.item_number || '').toLowerCase().replace(/-1$/, '');
        if (invNo !== lineNo) return false;
        if (lineCond && inv.condition !== lineCond) return false;
        // Skip items already in the desired state
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

    // 3. Move each match to stockroom (or back)
    let done = 0, failed = 0, failedNames = [];
    for (const { inv, line } of matches) {
      setPauseDetail(`${pause ? 'Pausing' : 'Unpausing'} ${inv.item_number}… (${done + failed + 1}/${matches.length})`);
      try {
        const resp = await fetch('/api/bricklink/store/stockroom', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inventory_id: inv.inventory_id, stockroom: pause }),
        });
        const result = await resp.json();
        if (result.ok) { done++; }
        else { failed++; failedNames.push(inv.item_number); }
      } catch(e) {
        failed++; failedNames.push(inv.item_number);
      }
    }

    const summary = `${done} item${done !== 1 ? 's' : ''} ${verb}${failed ? `, ${failed} failed (${failedNames.join(', ')})` : ''}${unmatched.length ? `; ${unmatched.length} not found in store` : ''}.`;
    setPauseStatus(failed > 0 ? 'error' : 'done');
    setPauseDetail(summary);
  };

  // ── Print order ──
  const printOrder = (order) => {
    const lines = [
      `Sales Order`,
      `Date: ${formatDateTime(order.createdAt)}`,
      order.buyerName ? `Buyer: ${order.buyerName}` : null,
      order.listName  ? `Wanted List: ${order.listName}` : null,
      order.note      ? `Note: ${order.note}` : null,
      '',
      'Item'.padEnd(30) + 'Cond'.padEnd(16) + 'Qty'.padEnd(6) + 'Listed'.padEnd(12) + 'Unit Price'.padEnd(12) + 'Line Total',
      '-'.repeat(80),
    ];
    for (const l of order.lines || []) {
      const name   = (l.name || l.itemNumber || '').slice(0, 28).padEnd(30);
      const cond   = condLabel(l.condition).slice(0, 14).padEnd(16);
      const qty    = String(l.qty).padEnd(6);
      const listed = (l.listedUnit != null ? `$${Number(l.listedUnit).toFixed(2)}` : '—').padEnd(12);
      const unit   = `$${Number(l.unitPrice).toFixed(2)}`.padEnd(12);
      const total  = `$${Number(l.lineTotal).toFixed(2)}`;
      lines.push(name + cond + qty + listed + unit + total);
    }
    lines.push('-'.repeat(80));
    lines.push('');
    lines.push(`Items: ${order.totalItems}   Subtotal: $${Number(order.subtotal).toFixed(2)}`);
    if (order.shipping) lines.push(`Shipping: $${Number(order.shipping).toFixed(2)}`);
    if (order.fees)     lines.push(`Fees: $${Number(order.fees).toFixed(2)}`);
    if (order.shipping || order.fees) lines.push(`Grand Total: $${Number(order.grandTotal ?? order.subtotal).toFixed(2)}`);
    const text = lines.filter(l => l !== null).join('\n');

    const win = window.open('', '_blank', 'width=760,height=640');
    if (!win) { alert('Pop-up blocked.'); return; }
    win.document.write(`<!DOCTYPE html><html><head><title>Sales Order — ${order.buyerName || order.listName || ''}</title>
      <style>body{font-family:monospace;font-size:13px;padding:24px;white-space:pre-wrap;line-height:1.6}</style></head>
      <body><pre>${text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>
      <script>window.print();<\/script></body></html>`);
    win.document.close();
  };

  return (
    <div style={{ display:'flex', height:'100%', overflow:'hidden' }}>

      {/* ── Left panel: order list ── */}
      <div style={{
        width: 260, flexShrink: 0, borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        background: 'var(--surface)',
      }}>
        <div style={{ padding:'16px 14px 10px', borderBottom:'1px solid var(--border)' }}>
          <div style={{ fontSize:13, fontWeight:700, color:'var(--text)', marginBottom:10 }}>Sales Orders</div>
          <input
            placeholder="Search orders…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width:'100%', fontSize:12, padding:'5px 8px' }}
          />
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'6px 0' }}>
          {orders.length === 0 ? (
            <div style={{ padding:'20px 14px', fontSize:12, color:'var(--text3)', textAlign:'center', lineHeight:1.6 }}>
              No sales orders yet.<br />Create one from the Wanted List page via "🧾 Sales Order" → "Import Sale".
            </div>
          ) : filteredOrders.length === 0 ? (
            <div style={{ padding:'20px 14px', fontSize:12, color:'var(--text3)', textAlign:'center' }}>No orders match your search.</div>
          ) : (
            filteredOrders.map(order => (
              <div
                key={order.id}
                onClick={() => setSelectedId(order.id)}
                style={{
                  padding:'10px 14px', cursor:'pointer', userSelect:'none',
                  background: selectedId === order.id ? 'var(--surface2)' : 'transparent',
                  borderLeft: selectedId === order.id ? '3px solid var(--accent)' : '3px solid transparent',
                  transition:'background .1s',
                }}>
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ flex:1, fontSize:13, fontWeight:selectedId===order.id?600:400, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {order.buyerName || <span style={{ color:'var(--text3)' }}>Unknown buyer</span>}
                  </span>
                  <span style={{ fontSize:12, fontWeight:600, color:'var(--accent)', flexShrink:0 }}>
                    {currency(order.subtotal)}
                  </span>
                </div>
                <div style={{ fontSize:11, color:'var(--text3)', marginTop:2, display:'flex', gap:8 }}>
                  <span>{formatDate(order.createdAt)}</span>
                  {order.listName && <span>· {order.listName}</span>}
                </div>
                <div style={{ fontSize:11, color:'var(--text3)', marginTop:1 }}>
                  {order.totalItems} item{order.totalItems !== 1 ? 's' : ''}
                  {(order.lines || []).length !== order.totalItems ? ` (${(order.lines||[]).length} lines)` : ''}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Right panel: order detail ── */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        {!selectedOrder ? (
          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:12, color:'var(--text3)' }}>
            <div style={{ fontSize:40, opacity:.3 }}>🧾</div>
            <div style={{ fontSize:14, fontWeight:600 }}>Select a sales order</div>
            <div style={{ fontSize:12 }}>Your saved orders will appear in the panel on the left.</div>
          </div>
        ) : (
          <>
            {/* Detail toolbar */}
            <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:16, fontWeight:700, color:'var(--text)' }}>
                  {selectedOrder.buyerName || 'Unknown buyer'}
                </div>
                <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>
                  {formatDateTime(selectedOrder.createdAt)}
                  {selectedOrder.listName && ` · from "${selectedOrder.listName}"`}
                </div>
              </div>
              <button className="btn btn-secondary btn-sm"
                style={{ display:'flex', alignItems:'center', gap:5, fontSize:12 }}
                onClick={() => { setPauseStatus(''); setPauseDetail(''); pauseOnBrickLink(selectedOrder, true); }}
                disabled={pauseStatus === 'working'}
                title="Move these items to BrickLink stockroom so they can't be purchased">
                ⏸ Pause on BL
              </button>
              <button className="btn btn-secondary btn-sm"
                style={{ display:'flex', alignItems:'center', gap:5, fontSize:12 }}
                onClick={() => { setPauseStatus(''); setPauseDetail(''); pauseOnBrickLink(selectedOrder, false); }}
                disabled={pauseStatus === 'working'}
                title="Move these items back out of BrickLink stockroom">
                ▶ Unpause on BL
              </button>
              <button className="btn btn-secondary btn-sm"
                style={{ display:'flex', alignItems:'center', gap:5, fontSize:12 }}
                onClick={() => printOrder(selectedOrder)}>
                🖨 Print
              </button>
              <button className="btn btn-secondary btn-sm"
                style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, color:'var(--red)' }}
                onClick={() => deleteOrder(selectedOrder.id)}>
                {Icons.trash} Delete
              </button>
            </div>
            {pauseStatus && (
              <div style={{ padding:'8px 20px', fontSize:12, borderBottom:'1px solid var(--border)',
                background: pauseStatus === 'working' ? 'var(--surface2)' : pauseStatus === 'done' ? 'rgba(76,175,125,.1)' : 'rgba(231,76,76,.1)',
                color: pauseStatus === 'working' ? 'var(--text2)' : pauseStatus === 'done' ? 'var(--green)' : 'var(--red)',
                display:'flex', alignItems:'center', gap:8 }}>
                {pauseStatus === 'working' && <span style={{ animation:'spin 1s linear infinite', display:'inline-block' }}>⟳</span>}
                {pauseStatus === 'done'    && '✓'}
                {pauseStatus === 'error'   && '⚠'}
                {pauseDetail}
                {pauseStatus !== 'working' && <button onClick={() => { setPauseStatus(''); setPauseDetail(''); }} style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer', color:'inherit', fontSize:14 }}>✕</button>}
              </div>
            )}

            {/* Meta cards */}
            <div style={{ padding:'12px 20px', display:'flex', gap:12, flexWrap:'wrap', borderBottom:'1px solid var(--border)' }}>
              {[
                { label:'Buyer',       value: selectedOrder.buyerName || '—' },
                { label:'Wanted List', value: selectedOrder.listName  || '—' },
                { label:'Items',       value: selectedOrder.totalItems },
                { label:'Subtotal',    value: currency(selectedOrder.subtotal) },
                ...(selectedOrder.shipping ? [{ label:'Shipping', value: currency(selectedOrder.shipping) }] : []),
                ...(selectedOrder.fees     ? [{ label:'Fees',     value: currency(selectedOrder.fees)     }] : []),
                { label: selectedOrder.shipping || selectedOrder.fees ? 'Grand Total' : 'Total',
                  value: currency(selectedOrder.grandTotal ?? selectedOrder.subtotal), accent: true },
              ].map(({ label, value, accent }) => (
                <div key={label} style={{ padding:'8px 12px', border:'1px solid var(--border)', borderRadius:8, background:'var(--surface2)', minWidth:100 }}>
                  <div style={{ fontSize:10, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'.4px' }}>{label}</div>
                  <div style={{ fontWeight:700, fontSize:15, color: accent ? 'var(--accent)' : 'var(--text)', marginTop:2 }}>{value}</div>
                </div>
              ))}
              {selectedOrder.note && (
                <div style={{ padding:'8px 12px', border:'1px solid var(--border)', borderRadius:8, background:'var(--surface2)', flex:'1 1 200px' }}>
                  <div style={{ fontSize:10, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'.4px' }}>Note</div>
                  <div style={{ fontSize:13, color:'var(--text)', marginTop:2 }}>{selectedOrder.note}</div>
                </div>
              )}
            </div>

            {/* Line items table */}
            <div style={{ flex:1, overflowY:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                <thead>
                  <tr style={{ background:'var(--surface2)' }}>
                    {[
                      ['Item',       'left'],
                      ['Condition',  'left'],
                      ['Qty',        'right'],
                      ['Listed',     'right'],
                      ['Unit Price', 'right'],
                      ['Line Total', 'right'],
                    ].map(([h, align]) => (
                      <th key={h} style={{ padding:'8px 14px', textAlign:align, fontWeight:600, color:'var(--text2)', fontSize:11, textTransform:'uppercase', letterSpacing:'.4px', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(selectedOrder.lines || []).map((line, i) => (
                    <tr key={i} style={{ background: i%2===0 ? 'transparent' : 'rgba(0,0,0,.025)', borderBottom:'1px solid var(--border)' }}>
                      <td style={{ padding:'9px 14px', color:'var(--text)', maxWidth:260 }}>
                        <span style={{ fontWeight:500 }}>{line.name || line.itemNumber}</span>
                        {line.name && line.itemNumber && (
                          <><br /><span style={{ fontSize:11, color:'var(--text3)' }}>{line.itemNumber}{line.colorName ? ` · ${line.colorName}` : ''}</span></>
                        )}
                      </td>
                      <td style={{ padding:'9px 14px', color:'var(--text2)', whiteSpace:'nowrap', fontSize:12 }}>{condLabel(line.condition)}</td>
                      <td style={{ padding:'9px 14px', textAlign:'right', fontWeight:600 }}>{line.qty}</td>
                      <td style={{ padding:'9px 14px', textAlign:'right', color:'var(--text3)', fontSize:12 }}>
                        {line.listedUnit != null && line.listedUnit > 0 ? currency(line.listedUnit) : '—'}
                      </td>
                      <td style={{ padding:'9px 14px', textAlign:'right', color:'var(--text2)' }}>{currency(line.unitPrice)}</td>
                      <td style={{ padding:'9px 14px', textAlign:'right', fontWeight:600, color:'var(--accent)' }}>{currency(line.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Footer totals */}
            <div style={{ padding:'10px 20px', borderTop:'1px solid var(--border)', display:'flex', alignItems:'baseline', gap:24, background:'var(--surface2)', flexWrap:'wrap' }}>
              <div>
                <span style={{ fontSize:11, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'.4px', fontWeight:600 }}>Items </span>
                <span style={{ fontSize:20, fontWeight:700 }}>{selectedOrder.totalItems}</span>
              </div>
              <div>
                <span style={{ fontSize:11, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'.4px', fontWeight:600 }}>Subtotal </span>
                <span style={{ fontSize:18, fontWeight:700 }}>{currency(selectedOrder.subtotal)}</span>
              </div>
              {selectedOrder.shipping > 0 && (
                <div>
                  <span style={{ fontSize:11, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'.4px', fontWeight:600 }}>Shipping </span>
                  <span style={{ fontSize:18, fontWeight:700 }}>{currency(selectedOrder.shipping)}</span>
                </div>
              )}
              {selectedOrder.fees > 0 && (
                <div>
                  <span style={{ fontSize:11, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'.4px', fontWeight:600 }}>Fees </span>
                  <span style={{ fontSize:18, fontWeight:700 }}>{currency(selectedOrder.fees)}</span>
                </div>
              )}
              <div>
                <span style={{ fontSize:11, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'.4px', fontWeight:600 }}>
                  {selectedOrder.shipping || selectedOrder.fees ? 'Grand Total' : 'Total'}{' '}
                </span>
                <span style={{ fontSize:20, fontWeight:700, color:'var(--accent)' }}>
                  {currency(selectedOrder.grandTotal ?? selectedOrder.subtotal)}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
