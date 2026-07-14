function ItemModal({ item, prefill, onSave, onClose, onPriceFetched, setPage, setPricingSearch, data, setData, _depth = 0, _onBack = null }) {
  const isEdit = !!item;
  const [form, setForm] = React.useState(item || {
    type: prefill?.type || 'set',
    itemNumber: prefill?.itemNumber || '',
    rebrickableId: '',
    name:  prefill?.name  || '',
    theme: prefill?.theme || '',
    condition:'new_sealed',
    quantity:1, purchasePrice:'', estimatedValue:'', bricklinkPrice:'', ebayPrice:'',
    retailPrice: item?.retailPrice ?? '',
    sellStatus:'available', listPrice:'', salePrice:'', fees:'', shippingCost:'',
    platform:'', notes:'', imageUrl: prefill?.imageUrl || '', color: prefill?.color || '',
    keywords: item?.keywords || [],
    dateAdded: item?.dateAdded || (!item ? new Date().toISOString().slice(0, 10) : ''),
    dateListed: item?.dateListed || '',
  });
  const [keywordInput, setKeywordInput] = React.useState('');
  const [lookupStatus, setLookupStatus] = React.useState('');
  const [lookupMsg,    setLookupMsg]    = React.useState('');
  const [priceStatus,  setPriceStatus]  = React.useState(''); // '', 'loading', 'done', 'error'
  const [supersets,      setSupersets]      = React.useState(null); // null | 'loading' | [] | [{ setNumber, name, qty }]
  const [minifigs,       setMinifigs]       = React.useState(null); // null | 'loading' | [] | [{ itemNumber, name, qty }]
  const [minifigPrices,  setMinifigPrices]  = React.useState(null); // null | 'loading' | { [itemNumber]: number }
  const [drilldown,      setDrilldown]      = React.useState(null); // { type, itemNumber, name } | null
  const lookupTimer = React.useRef(null);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const num = (key) => (e) => set(key, e.target.value === '' ? '' : parseFloat(e.target.value) || 0);

  const doLookup = async (overrideType, overrideNumber) => {
    const itemType   = overrideType   || form.type;
    const itemNumber = overrideNumber || form.itemNumber;
    if (!itemNumber.trim()) { setLookupMsg('Enter an item number first.'); setLookupStatus('error'); return; }
    setLookupStatus('loading'); setLookupMsg('Looking up...');
    try {
      const info = await lookupItemBrickLink(itemType, itemNumber, form.blColorId || '');

      setForm(f => ({
        ...f,
        name:        info.name     || f.name,
        imageUrl:    info.imageUrl || f.imageUrl,
        theme:       info.theme    || f.theme,
        color:       info.color    || f.color,
        blColorId:   info.colorId  || f.blColorId,
        colorHex:    info.colorHex || f.colorHex,
        blLookupFailed: false,
      }));
      setLookupStatus('success');
      setLookupMsg(info.name ? `Found: ${info.name}` : 'Found item but no name available.');
      doFetchPrice(itemType, itemNumber, form.condition);
    } catch(e) {
      setLookupStatus('error'); setLookupMsg(e.message);
    }
  };

  // Fetch BL sold + active prices and populate estimatedValue / bricklinkPrice
  const doFetchPrice = React.useCallback(async (itemType, itemNumber, condition) => {
    if (!itemNumber?.trim()) return;
    setPriceStatus('loading');
    const newOrUsed = (condition === 'new_sealed' || condition === 'new_open') ? 'N' : 'U';
    try {
      // Fetch sold and active in parallel
      const [soldResp, activeResp] = await Promise.allSettled([
        fetch(`/api/bricklink/price?${new URLSearchParams({ type: itemType, itemNumber, guide: 'sold',  newOrUsed, filterOutliers: 'true', countryCode: 'US' })}`).then(r => r.json()),
        fetch(`/api/bricklink/price?${new URLSearchParams({ type: itemType, itemNumber, guide: 'stock', newOrUsed, filterOutliers: 'true', countryCode: 'US' })}`).then(r => r.json()),
      ]);
      const sold   = soldResp.status   === 'fulfilled' && !soldResp.value.error   ? soldResp.value   : null;
      const active = activeResp.status === 'fulfilled' && !activeResp.value.error ? activeResp.value : null;

      const blSoldMedian   = sold?.median || null;
      const blActiveMedian = active?.median || null;
      const blActiveMin    = active?.min    || null;

      // Use the shared suggestedPrice() so the result matches the inventory column exactly
      const syntheticItem = {
        bricklinkMedian:       blSoldMedian,
        bricklinkActiveMedian: blActiveMedian,
        bricklinkActive:       blActiveMin,
        bricklinkPriceEstimated: null,
        priceHistory: [],
      };
      const suggested = suggestedPrice(syntheticItem);

      setForm(f => ({
        ...f,
        bricklinkPrice: blSoldMedian != null ? blSoldMedian : f.bricklinkPrice,
        estimatedValue: suggested    != null ? suggested    : (blSoldMedian != null ? blSoldMedian : f.estimatedValue),
      }));

      // Notify any parent (e.g. CatalogSearchPage) so it can display the price without re-fetching
      if (onPriceFetched) {
        onPriceFetched({ loading: false, suggested, soldMedian: blSoldMedian, activeMedian: blActiveMedian });
      }

      setPriceStatus('done');
    } catch(e) {
      setPriceStatus('error');
    }
  }, [onPriceFetched]); // eslint-disable-line react-hooks/exhaustive-deps

  // On mount: auto-lookup details for new prefilled items; auto-fetch prices for existing items
  React.useEffect(() => {
    if (!isEdit && prefill?.itemNumber) {
      doLookup(prefill.type || 'set', prefill.itemNumber);
    }
    if (isEdit && item?.itemNumber) {
      doFetchPrice(item.type, item.itemNumber, item.condition);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch supersets (which sets contain this item) for minifigs and parts
  React.useEffect(() => {
    const itemNumber = form.itemNumber?.trim();
    const itemType   = form.type;
    if (!itemNumber || itemType === 'set') return;
    setSupersets('loading');
    const p = { type: itemType, itemNumber };
    if (form.blColorId) p.colorId = form.blColorId;
    const params = new URLSearchParams(p);
    fetch(`/api/bricklink/supersets?${params}`)
      .then(r => r.json())
      .then(data => setSupersets(data.error ? [] : (data.supersets || [])))
      .catch(() => setSupersets([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch subsets (minifigs in this set) for sets
  React.useEffect(() => {
    const itemNumber = form.itemNumber?.trim();
    if (!itemNumber || form.type !== 'set') return;
    setMinifigs('loading');
    const params = new URLSearchParams({ itemNumber });
    fetch(`/api/bricklink/subsets?${params}`)
      .then(r => r.json())
      .then(data => setMinifigs(data.error ? [] : (data.minifigs || [])))
      .catch(() => setMinifigs([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch suggested prices for each minifig once the list is known
  React.useEffect(() => {
    if (!Array.isArray(minifigs) || minifigs.length === 0) return;
    const itemNumber = form.itemNumber?.trim();
    if (!itemNumber) return;
    const newOrUsed = (form.condition === 'new_sealed' || form.condition === 'new_open') ? 'N' : 'U';
    setMinifigPrices('loading');
    const params = new URLSearchParams({ itemNumber, newOrUsed });
    fetch(`/api/bricklink/minifig-value?${params}`)
      .then(r => r.json())
      .then(data => {
        if (data.error || !data.minifigs) { setMinifigPrices({}); return; }
        // Use suggestedPrice computed by the backend (same formula + outlier filtering
        // as the price guide) so the values match exactly.
        const map = {};
        for (const fig of data.minifigs) {
          if (fig.suggestedPrice != null || fig.soldMedian != null || fig.activeMedian != null) {
            map[fig.itemNumber] = {
              blAvg:     fig.soldMedian,
              suggested: fig.suggestedPrice ?? null,
            };
          }
        }
        setMinifigPrices(map);
      })
      .catch(() => setMinifigPrices({}));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minifigs]);

  const handleItemNumberChange = (val) => {
    set('itemNumber', val);
  };

  const handleSave = () => {
    if (!form.name && !form.itemNumber) { alert('Please enter at least a name or item number.'); return; }
    onSave({
      ...form,
      purchasePrice:  parseFloat(form.purchasePrice)  || 0,
      estimatedValue: parseFloat(form.estimatedValue) || 0,
      bricklinkPrice: parseFloat(form.bricklinkPrice) || 0,
      ebayPrice:      parseFloat(form.ebayPrice)      || 0,
      retailPrice:    parseFloat(form.retailPrice)    || 0,
      listPrice:      parseFloat(form.listPrice)      || 0,
      salePrice:      parseFloat(form.salePrice)      || 0,
      fees:           parseFloat(form.fees)           || 0,
      shippingCost:   parseFloat(form.shippingCost)   || 0,
      quantity:       parseInt(form.quantity)         || 1,
      keywords:       form.keywords || [],
    });
  };

  const statusColor = lookupStatus === 'success' ? 'var(--green)' : lookupStatus === 'error' ? 'var(--red)' : 'var(--text2)';

  return (
    <>
    <div className="modal-overlay" onClick={onClose} style={drilldown ? {display:'none'} : undefined}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEdit ? 'Item Detail' : 'Add New Item'}</h2>
          <button className="btn-icon" onClick={onClose}>{Icons.x}</button>
        </div>
        <div className="modal-body" style={{padding:'12px 20px'}}>

          {/* Top grid: image (left) + details & pricing (right) */}
          <div className="modal-top-grid" style={{gap:16}}>

            {/* Left: image + URL */}
            <div className="modal-image-col">
              <div className="modal-image-box">
                {form.imageUrl
                  ? <img src={form.imageUrl} alt={form.name} style={{maxWidth:'100%',maxHeight:'100%',objectFit:'contain',borderRadius:4}} />
                  : <span style={{fontSize:56,opacity:.25}}>{form.type==='set' ? '📦' : form.type==='minifig' ? '🧑' : '🧱'}</span>
                }
              </div>
              <div className="form-group" style={{marginBottom:0,marginTop:8}}>
                <label>Image URL</label>
                <input placeholder="https://..." value={form.imageUrl||''} onChange={e => set('imageUrl', e.target.value)} />
              </div>
            </div>

            {/* Right: item details + pricing */}
            <div className="modal-fields-col" style={{gap:0}}>
              <div style={{fontSize:11,fontWeight:600,color:'var(--text2)',marginBottom:8,textTransform:'uppercase',letterSpacing:'.5px'}}>Item Details</div>

              <div className="form-row" style={{marginBottom:8}}>
                <div className="form-group" style={{marginBottom:0}}>
                  <label>Type</label>
                  <select value={form.type} onChange={e => set('type', e.target.value)}>
                    <option value="set">Set</option>
                    <option value="minifig">Minifigure</option>
                    <option value="part">Part</option>
                  </select>
                </div>
                <div className="form-group" style={{marginBottom:0}}>
                  <label>Item Number</label>
                  <div style={{display:'flex',gap:6}}>
                    <input style={{flex:1}}
                      placeholder={form.type==='set' ? 'e.g. 75192-1' : form.type==='minifig' ? 'e.g. sw0001' : 'e.g. 3001'}
                      value={form.itemNumber}
                      onChange={e => handleItemNumberChange(e.target.value)}
                      onKeyDown={e => { if (e.key==='Enter') { e.preventDefault(); doLookup(); }}} />
                    <button className="btn btn-secondary btn-sm" onClick={() => doLookup()}
                      disabled={lookupStatus==='loading'} style={{whiteSpace:'nowrap',flexShrink:0}}>
                      {lookupStatus==='loading' ? '...' : Icons.search} {lookupStatus!=='loading' && 'Lookup'}
                    </button>
                  </div>
                  {lookupMsg && <div style={{marginTop:3,fontSize:11,color:statusColor}}>{lookupMsg}</div>}
                </div>
              </div>

              <div className="form-row" style={{marginBottom:8}}>
                <div className="form-group" style={{marginBottom:0}}>
                  <label>Name</label>
                  <input placeholder="e.g. Millennium Falcon" value={form.name} onChange={e => set('name', e.target.value)} />
                </div>
                <div className="form-group" style={{marginBottom:0}}>
                  <label>Theme</label>
                  <input placeholder="e.g. Star Wars" value={form.theme} onChange={e => set('theme', e.target.value)} />
                </div>
              </div>

              <div className="form-row-3" style={{marginBottom:8}}>
                <div className="form-group" style={{marginBottom:0}}>
                  <label>Condition</label>
                  <select value={form.condition} onChange={e => set('condition', e.target.value)}>
                    {CONDITIONS.map(c => <option key={c} value={c}>{CONDITION_LABELS[c]}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{marginBottom:0}}>
                  <label>Quantity</label>
                  <input type="number" min="1" value={form.quantity} onChange={e => set('quantity', e.target.value)} />
                </div>
                <div className="form-group" style={{marginBottom:0}}>
                  <label>Rebrickable ID</label>
                  <input
                    placeholder={form.type==='set' ? 'e.g. 75192' : 'e.g. fig-000001'}
                    value={form.rebrickableId||''}
                    onChange={e => set('rebrickableId', e.target.value)} />
                </div>
              </div>

              <div className="form-row" style={{marginBottom: form.type === 'part' ? 8 : 0}}>
                <div className="form-group" style={{marginBottom:0}}>
                  <label>Date Added</label>
                  <input type="date" value={form.dateAdded||''} onChange={e => set('dateAdded', e.target.value)} />
                </div>
                <div className="form-group" style={{marginBottom:0}} />
              </div>

              {form.type === 'part' && (
                <div className="form-group" style={{marginBottom:0}}>
                  <label>Color</label>
                  <input placeholder="e.g. Red, Dark Bluish Gray" value={form.color||''} onChange={e => set('color', e.target.value)} />
                </div>
              )}

              <hr style={{border:'none',borderTop:'1px solid var(--border)',margin:'10px 0'}} />
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8,flexWrap:'wrap'}}>
                <div style={{fontSize:11,fontWeight:600,color:'var(--text2)',textTransform:'uppercase',letterSpacing:'.5px'}}>Pricing</div>
                {form.itemNumber && (
                  <button className="btn btn-secondary btn-sm" style={{fontSize:11,padding:'2px 8px'}}
                    disabled={priceStatus === 'loading'}
                    onClick={() => doFetchPrice(form.type, form.itemNumber, form.condition)}>
                    {priceStatus === 'loading' ? '🔄 Fetching…' : '↓ Fetch Prices'}
                  </button>
                )}
                {priceStatus === 'done'  && <span style={{fontSize:11,color:'var(--green)'}}>✓ Done</span>}
                {priceStatus === 'error' && <span style={{fontSize:11,color:'var(--red)'}}>Could not fetch prices</span>}
                {form.itemNumber && setPage && setPricingSearch && (
                  <button
                    onClick={() => { setPricingSearch(form.itemNumber); setPage('pricing'); onClose(); }}
                    style={{marginLeft:'auto',fontSize:11,padding:'2px 10px',borderRadius:6,background:'rgba(76,140,231,.12)',color:'var(--blue)',border:'1px solid rgba(76,140,231,.25)',cursor:'pointer',fontWeight:600,whiteSpace:'nowrap'}}>
                    📈 Price Guide ↗
                  </button>
                )}
              </div>

              <div className="form-row-3" style={{marginBottom:8}}>
                <div className="form-group" style={{marginBottom:0}}>
                  <label>Purchase Price ($)</label>
                  <input type="number" step="0.01" min="0" placeholder="0.00" value={form.purchasePrice} onChange={num('purchasePrice')} />
                </div>
                <div className="form-group" style={{marginBottom:0}}>
                  <label>Estimated Value ($)</label>
                  <input type="number" step="0.01" min="0" placeholder="0.00" value={form.estimatedValue} onChange={num('estimatedValue')} />
                </div>
                {form.type === 'set'
                  ? <div className="form-group" style={{marginBottom:0}}>
                      <label>MSRP ($)</label>
                      <input type="number" step="0.01" min="0" placeholder="0.00" value={form.retailPrice||''} onChange={num('retailPrice')} />
                    </div>
                  : <div className="form-group" style={{marginBottom:0}} />
                }
              </div>
              <div className="form-row" style={{marginBottom:0}}>
                <div className="form-group" style={{marginBottom:0}}>
                  <label>BrickLink Price ($)</label>
                  <input type="number" step="0.01" min="0" placeholder="0.00" value={form.bricklinkPrice} onChange={num('bricklinkPrice')} />
                </div>
                <div className="form-group" style={{marginBottom:0}}>
                  <label>eBay Price ($)</label>
                  <input type="number" step="0.01" min="0" placeholder="0.00" value={form.ebayPrice} onChange={num('ebayPrice')} />
                </div>
              </div>
            </div>
          </div>{/* end modal-top-grid */}

          {/* Bottom: selling info + notes, full width */}
          <hr style={{border:'none',borderTop:'1px solid var(--border)',margin:'10px 0'}} />
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
            <div style={{fontSize:11,fontWeight:600,color:'var(--text2)',textTransform:'uppercase',letterSpacing:'.5px'}}>Selling</div>
            {(form.sellStatus === 'available' || form.sellStatus === 'collection') && (
              <button
                className="btn btn-primary btn-sm"
                style={{fontSize:11,padding:'2px 10px'}}
                onClick={() => setForm(f => ({
                  ...f,
                  sellStatus: 'listed',
                  dateListed: f.dateListed || new Date().toISOString().slice(0, 10),
                }))}
                title="Mark as listed for sale (not saved until you click Save Changes)">
                + List
              </button>
            )}
            {form.sellStatus === 'listed' && (
              <span style={{fontSize:11,color:'var(--green)',fontWeight:600}}>Listed ✓</span>
            )}
            {form.sellStatus === 'collection' && (
              <span style={{fontSize:11,color:'#d44f88',fontWeight:600}}>Collection — not for sale</span>
            )}
          </div>

          <div className="form-row-3" style={{marginBottom: (form.sellStatus==='sold' || form.sellStatus==='listed') ? 8 : 0, display: form.sellStatus==='collection' ? 'none' : undefined}}>
            <div className="form-group" style={{marginBottom:0}}>
              <label>Sell Status</label>
              <select value={form.sellStatus} onChange={e => set('sellStatus', e.target.value)}>
                <option value="available">Available</option>
                <option value="collection">Collection</option>
                <option value="listed">Listed</option>
                <option value="sold">Sold</option>
              </select>
            </div>
            <div className="form-group" style={{marginBottom:0}}>
              <label>Platform</label>
              <input placeholder="BrickLink, eBay, etc." value={form.platform||''} onChange={e => set('platform', e.target.value)} />
            </div>
            <div className="form-group" style={{marginBottom:0}}>
              <label>{form.sellStatus==='sold' ? 'Sale Price ($)' : 'List Price ($)'}</label>
              <input type="number" step="0.01" min="0" placeholder="0.00"
                value={form.sellStatus==='sold' ? form.salePrice : form.listPrice}
                onChange={form.sellStatus==='sold' ? num('salePrice') : num('listPrice')} />
            </div>
          </div>

          {(form.sellStatus==='sold' || form.sellStatus==='listed') && form.sellStatus !== 'collection' && (
            <>
              <div className="form-row" style={{marginBottom:8}}>
                <div className="form-group" style={{marginBottom:0}}>
                  <label>Fees ($)</label>
                  <input type="number" step="0.01" min="0" placeholder="0.00" value={form.fees} onChange={num('fees')} />
                </div>
                <div className="form-group" style={{marginBottom:0}}>
                  <label>Shipping Cost ($)</label>
                  <input type="number" step="0.01" min="0" placeholder="0.00" value={form.shippingCost} onChange={num('shippingCost')} />
                </div>
              </div>
              <div className="form-group" style={{marginBottom:0,maxWidth:200}}>
                <label>Date Listed</label>
                <input type="date" value={form.dateListed||''} onChange={e => set('dateListed', e.target.value)} />
              </div>
            </>
          )}

          <div className="form-group" style={{marginTop:8,marginBottom:0}}>
            <label>Notes</label>
            <textarea rows="2" placeholder="Any notes about this item..." value={form.notes||''} onChange={e => set('notes', e.target.value)} />
          </div>

          {/* Keywords */}
          <div className="form-group" style={{marginTop:8,marginBottom:0}}>
            <label>Keywords</label>
            <div style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:6}}>
              {(form.keywords || []).map((kw, i) => (
                <span key={i} style={{display:'inline-flex',alignItems:'center',gap:4,background:'rgba(76,140,231,.12)',color:'var(--blue)',border:'1px solid rgba(76,140,231,.25)',borderRadius:12,padding:'2px 8px',fontSize:12,fontWeight:500}}>
                  {kw}
                  <button
                    onClick={() => setForm(f => ({ ...f, keywords: f.keywords.filter((_, j) => j !== i) }))}
                    style={{background:'none',border:'none',cursor:'pointer',padding:'0 0 0 2px',color:'var(--blue)',lineHeight:1,fontSize:14,opacity:.7}}
                    title="Remove keyword">×</button>
                </span>
              ))}
              {(form.keywords || []).length === 0 && (
                <span style={{fontSize:12,color:'var(--text3)'}}>No keywords yet</span>
              )}
            </div>
            <div style={{display:'flex',gap:6}}>
              <input
                placeholder="Add keyword…"
                value={keywordInput}
                onChange={e => setKeywordInput(e.target.value)}
                onKeyDown={e => {
                  if ((e.key === 'Enter' || e.key === ',') && keywordInput.trim()) {
                    e.preventDefault();
                    const kw = keywordInput.trim().replace(/,$/, '');
                    if (kw && !(form.keywords || []).includes(kw)) {
                      setForm(f => ({ ...f, keywords: [...(f.keywords || []), kw] }));
                    }
                    setKeywordInput('');
                  } else if (e.key === 'Escape') {
                    setKeywordInput('');
                  }
                }}
                style={{flex:1}}
              />
              <button
                className="btn btn-secondary btn-sm"
                style={{whiteSpace:'nowrap'}}
                onClick={() => {
                  const kw = keywordInput.trim().replace(/,$/, '');
                  if (kw && !(form.keywords || []).includes(kw)) {
                    setForm(f => ({ ...f, keywords: [...(f.keywords || []), kw] }));
                  }
                  setKeywordInput('');
                }}>Add</button>
            </div>
          </div>

          {/* Minifigures — subsets for sets */}
          {form.type === 'set' && form.itemNumber && (
            <>
              <hr style={{border:'none',borderTop:'1px solid var(--border)',margin:'10px 0'}} />
              <div style={{fontSize:11,fontWeight:600,color:'var(--text2)',marginBottom:6,textTransform:'uppercase',letterSpacing:'.5px'}}>Minifigures</div>
              {minifigs === 'loading' && (
                <div style={{fontSize:12,color:'var(--text2)'}}>Looking up minifigures…</div>
              )}
              {minifigs === null && (
                <div style={{fontSize:12,color:'var(--text3)'}}>—</div>
              )}
              {Array.isArray(minifigs) && minifigs.length === 0 && (
                <div style={{fontSize:12,color:'var(--text3)'}}>No minifigures found in BrickLink catalog.</div>
              )}
              {Array.isArray(minifigs) && minifigs.length > 0 && (
                <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                  {minifigs.map((m, i) => {
                    const priceEntry = typeof minifigPrices === 'object' && minifigPrices !== null
                      ? minifigPrices[m.itemNumber]
                      : null;
                    const totalSuggested = priceEntry?.suggested != null
                      ? priceEntry.suggested * m.qty
                      : null;
                    return (
                      <button key={i}
                        onClick={() => setDrilldown({ type: 'minifig', itemNumber: m.itemNumber, name: m.name })}
                        style={{fontSize:12,padding:'4px 8px',borderRadius:6,background:'var(--surface2)',color:'var(--orange)',border:'1px solid var(--border)',whiteSpace:'nowrap',cursor:'pointer',textAlign:'left',display:'flex',flexDirection:'column',gap:2}}
                        title={m.name || undefined}>
                        <div>
                          {m.qty > 1 && <span style={{color:'var(--text2)',marginRight:4}}>×{m.qty}</span>}
                          {m.itemNumber}
                          {m.name && <span style={{color:'var(--text2)',marginLeft:4}}>{m.name}</span>}
                        </div>
                        {minifigPrices === 'loading'
                          ? <div style={{fontSize:10,color:'var(--text3)'}}>fetching…</div>
                          : totalSuggested != null
                            ? <div style={{fontSize:11,color:'var(--accent)',fontWeight:600}}>
                                {currency(totalSuggested)}
                                {m.qty > 1 && <span style={{fontWeight:400,color:'var(--text3)',marginLeft:4}}>({currency(priceEntry.suggested)} ea)</span>}
                              </div>
                            : null
                        }
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* Found In — supersets */}
          {form.type !== 'set' && form.itemNumber && (
            <>
              <hr style={{border:'none',borderTop:'1px solid var(--border)',margin:'10px 0'}} />
              <div style={{fontSize:11,fontWeight:600,color:'var(--text2)',marginBottom:6,textTransform:'uppercase',letterSpacing:'.5px'}}>Found In</div>
              {supersets === 'loading' && (
                <div style={{fontSize:12,color:'var(--text2)'}}>Looking up sets…</div>
              )}
              {supersets === null && (
                <div style={{fontSize:12,color:'var(--text3)'}}>—</div>
              )}
              {Array.isArray(supersets) && supersets.length === 0 && (
                <div style={{fontSize:12,color:'var(--text3)'}}>No sets found in BrickLink catalog.</div>
              )}
              {Array.isArray(supersets) && supersets.length > 0 && (
                <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                  {supersets.map((s, i) => (
                    <button key={i}
                      onClick={() => setDrilldown({ type: 'set', itemNumber: s.setNumber, name: s.name })}
                      style={{fontSize:12,padding:'3px 8px',borderRadius:6,background:'var(--surface2)',color:'var(--accent)',border:'1px solid var(--border)',whiteSpace:'nowrap',cursor:'pointer'}}
                      title={s.name ? `${s.name}${s.qty > 1 ? ` (×${s.qty})` : ''}` : undefined}>
                      {s.setNumber}{s.qty > 1 ? ` ×${s.qty}` : ''}
                      {s.name && <span style={{color:'var(--text2)',marginLeft:4}}>{s.name}</span>}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div className="modal-footer">
          {data && setData && form.itemNumber && (
            <AddToWantedListButton
              item={{ type: form.type, itemNumber: form.itemNumber, name: form.name }}
              data={data}
              setData={setData}
              buttonStyle={{ marginRight: 'auto' }}
            />
          )}
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>{isEdit ? 'Save Changes' : 'Add Item'}</button>
        </div>
      </div>
    </div>

    {/* Drilldown — opens a fresh modal, closing this one first */}
    {drilldown && (
      <ItemModal
        _depth={_depth + 1}
        prefill={{ type: drilldown.type, itemNumber: drilldown.itemNumber, name: drilldown.name }}
        onSave={(newItem) => { onSave(newItem); setDrilldown(null); }}
        onClose={() => setDrilldown(null)}
      />
    )}
    </>
  );
}
