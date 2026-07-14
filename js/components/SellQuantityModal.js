// ─── Sell Quantity Modal ───
// Lets you record a sale of some or all units of a multi-quantity item.
// If qty sold < total qty, the original item's quantity is reduced and a new
// "sold" record is created for the sold portion.
// If qty sold = total qty, the original item is simply marked as sold.

function SellQuantityModal({ item, onConfirm, onClose }) {
  const maxQty = item.quantity || 1;
  const defaultPrice = item.listPrice || suggestedPrice(item) || item.estimatedValue || '';

  const [qtySold,   setQtySold]   = React.useState(1);
  const [salePrice, setSalePrice] = React.useState(defaultPrice ? Number(defaultPrice).toFixed(2) : '');
  const [fees,      setFees]      = React.useState('');
  const [shipping,  setShipping]  = React.useState('');
  const [platform,  setPlatform]  = React.useState(item.platform || '');

  const qty        = Math.max(1, Math.min(parseInt(qtySold) || 1, maxQty));
  const priceEach  = parseFloat(salePrice) || 0;
  const totalFees  = parseFloat(fees)      || 0;
  const totalShip  = parseFloat(shipping)  || 0;
  const revenue    = priceEach * qty;
  const costEach   = (item.purchasePrice || 0);
  const profit     = revenue - costEach * qty - totalFees - totalShip;
  const isPartial  = qty < maxQty;

  const handleConfirm = () => {
    if (qty < 1) return;
    onConfirm({
      qtySold:   qty,
      salePrice: priceEach,
      fees:      totalFees,
      shippingCost: totalShip,
      platform,
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Record Sale</h2>
          <button className="btn-icon" onClick={onClose}>{Icons.x}</button>
        </div>
        <div className="modal-body">

          {/* Item summary */}
          <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 13 }}>
            <div style={{ fontWeight: 600, color: 'var(--text)' }}>{item.name || item.itemNumber}</div>
            <div style={{ color: 'var(--text2)', marginTop: 2 }}>
              {item.itemNumber}{item.theme ? ` · ${item.theme}` : ''} · {maxQty} in inventory
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Qty Sold</label>
              <input type="number" min="1" max={maxQty} value={qtySold}
                onChange={e => setQtySold(e.target.value)} />
              {maxQty > 1 && (
                <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 3 }}>
                  {isPartial
                    ? `${maxQty - qty} will remain in inventory`
                    : 'All units — item will be marked sold'}
                </div>
              )}
            </div>
            <div className="form-group">
              <label>Sale Price Each ($)</label>
              <input type="number" step="0.01" min="0" placeholder="0.00"
                value={salePrice} onChange={e => setSalePrice(e.target.value)} />
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

          <div className="form-group">
            <label>Platform</label>
            <input placeholder="BrickLink, eBay, etc." value={platform}
              onChange={e => setPlatform(e.target.value)} />
          </div>

          {/* Sale summary */}
          <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '12px 14px', marginTop: 4, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ color: 'var(--text2)' }}>Revenue ({qty} × {currency(priceEach)})</span>
              <span style={{ fontWeight: 600 }}>{currency(revenue)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ color: 'var(--text2)' }}>Cost ({qty} × {currency(costEach)})</span>
              <span>−{currency(costEach * qty)}</span>
            </div>
            {totalFees > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: 'var(--text2)' }}>Fees</span>
                <span>−{currency(totalFees)}</span>
              </div>
            )}
            {totalShip > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: 'var(--text2)' }}>Shipping</span>
                <span>−{currency(totalShip)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
              <span style={{ fontWeight: 600 }}>Net Profit</span>
              <span style={{ fontWeight: 700, color: profit >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {currency(profit)}
              </span>
            </div>
          </div>

        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleConfirm}>
            Record Sale{qty > 1 ? ` (${qty})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
