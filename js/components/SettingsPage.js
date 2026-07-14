function SettingsPage({ data, setData, settings, setSettings, exportData, exportCSV, exportBricklinkXML, exportBricklinkWanted, importData,
    batchStatus, batchProgress, batchCounts, batchCurrent,
    fetchBricklinkDetails, cancelBricklinkFetch, resumeBricklinkFetch, discardBatch,
    priceBatchStatus, priceBatchProgress, priceBatchCounts, priceBatchCurrent,
    forceFetchAllPrices, cancelPriceFetch, resumePriceFetch, discardPriceBatch,
    imgStatus, imgProgress, imgCounts, imgCurrent, fetchImages, cancelImageFetch, resumeImageFetch, discardImageFetch, clearImages,
    onMergeDuplicates, blConfigured, ebayConfigured, bricksetConfigured, updateItems }) {

  const localFileInput = React.useRef(null);
  const [trimDays, setTrimDays] = React.useState(90);
  const [storeImportStatus, setStoreImportStatus] = React.useState(null); // null | 'loading' | { matched, notFound, errors }
  const [msrpStatus, setMsrpStatus] = React.useState(null); // null | 'loading' | result

  const importStoreInventory = async () => {
    setStoreImportStatus('loading');
    try {
      const resp = await fetch('/api/bricklink/store/inventory/all');
      const json = await resp.json();
      if (json.error) { setStoreImportStatus({ error: json.error }); return; }

      const inventories = json.inventories || [];
      // condition in our data: 'new' | 'used' | '' — BL uses 'N' | 'U'
      const condMap = { 'N': 'new', 'U': 'used' };

      // First pass: compute updates against current items
      const currentItems = data.items;
      const matchedIds = new Map(); // item.id → { listPrice, platform }
      for (const item of currentItems) {
        if (item.sellStatus === 'sold') continue;
        const match = inventories.find(inv => {
          // Tolerant number match: "2538-1" matches "2538" and vice versa
          const blNo  = (inv.item_number || '').toUpperCase().replace(/-\d+$/, '');
          const ourNo = (item.itemNumber  || '').toUpperCase().replace(/-\d+$/, '');
          const numMatch = blNo === ourNo;
          const typeMatch = inv.item_type === (item.type || 'set');
          const cond = condMap[inv.condition] || 'used';
          const condMatch = !item.condition || !inv.condition || cond === item.condition;
          const colorMatch = !inv.color_id || inv.color_id === '0' || !item.colorId || inv.color_id === String(item.colorId);
          return numMatch && typeMatch && condMatch && colorMatch;
        });
        if (match) matchedIds.set(item.id, { listPrice: match.price, platform: 'BrickLink' });
      }

      const matched = matchedIds.size;
      const notFound = inventories.length - matched;

      // Second pass: apply updates
      updateItems(prevItems => prevItems.map(item => {
        const update = matchedIds.get(item.id);
        if (!update) return item;
        return { ...item, sellStatus: 'listed', listPrice: update.listPrice, platform: update.platform };
      }));
      setStoreImportStatus({ matched, notFound, total: inventories.length });
    } catch (e) {
      setStoreImportStatus({ error: e.message || 'Unknown error' });
    }
  };

  const normaliseSetNumber = (n) => {
    const raw = String(n || '').trim().toUpperCase();
    if (!raw) return '';
    return /-\d+$/.test(raw) ? raw : `${raw}-1`;
  };

  const loadMissingMsrp = async () => {
    const targetItems = data.items.filter(item =>
      (item.type || 'set') === 'set' &&
      item.itemNumber &&
      (item.retailPrice == null || item.retailPrice === '' || Number(item.retailPrice) <= 0)
    );
    const setNumbers = [...new Set(targetItems.map(item => normaliseSetNumber(item.itemNumber)).filter(Boolean))];
    if (!setNumbers.length) {
      setMsrpStatus({ updated: 0, total: 0, cached: 0, fetched: 0, calls: 0, message: 'All set items already have MSRP.' });
      return;
    }

    setMsrpStatus('loading');
    try {
      const resp = await fetch('/api/brickset/msrp-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setNumbers }),
      });
      const json = await resp.json();
      if (!resp.ok || json.error) {
        setMsrpStatus({ error: json.error || 'Brickset MSRP lookup failed' });
        return;
      }

      const prices = json.prices || {};
      const updated = data.items.filter(item => {
        const key = normaliseSetNumber(item.itemNumber);
        const retail = Number(prices[key]?.retailPrice);
        return (item.type || 'set') === 'set' &&
          item.itemNumber &&
          (item.retailPrice == null || item.retailPrice === '' || Number(item.retailPrice) <= 0) &&
          retail > 0;
      }).length;
      updateItems(prevItems => prevItems.map(item => {
        const key = normaliseSetNumber(item.itemNumber);
        const record = prices[key];
        const retail = Number(record?.retailPrice);
        if ((item.type || 'set') !== 'set' || !record || !retail || retail <= 0) return item;
        if (item.retailPrice != null && Number(item.retailPrice) > 0) return item;
        return {
          ...item,
          retailPrice: retail,
          name: item.name || record.name || '',
          theme: item.theme || record.theme || '',
          pieces: item.pieces || record.pieces || null,
          updatedAt: new Date().toISOString(),
        };
      }));

      setMsrpStatus({
        updated,
        total: setNumbers.length,
        cached: json.cached || 0,
        fetched: json.fetched || 0,
        calls: json.calls || 0,
        missing: json.missing || [],
        errors: json.errors || [],
      });
    } catch (e) {
      setMsrpStatus({ error: e.message || 'Brickset MSRP lookup failed' });
    }
  };

  const clearAll = () => {
    if (confirm('Are you sure you want to delete ALL data? This cannot be undone!')) {
      if (confirm('Really delete everything? Last chance!')) {
        setData({ items: [], sales: [] });
      }
    }
  };

  const clearPriceHistory = () => {
    const totalEntries = data.items.reduce((s, i) => s + (i.priceHistory?.length || 0), 0);
    if (totalEntries === 0) { alert('No price history to clear.'); return; }
    if (confirm(`Clear all price history? This will remove ${totalEntries.toLocaleString()} history entries and all weekly snapshots across ${data.items.length} items. Current stored prices (BL/eBay values) are not affected.`)) {
      setData(prev => ({
        ...prev,
        items: prev.items.map(i => ({ ...i, priceHistory: [], priceSnapshots: {} }))
      }));
    }
  };

  const trimPriceHistory = () => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - trimDays);
    const cutoffIso = cutoff.toISOString();
    let trimmed = 0;
    const newItems = data.items.map(i => {
      if (!i.priceHistory?.length) return i;
      const kept = i.priceHistory.filter(h => h.date >= cutoffIso);
      trimmed += (i.priceHistory.length - kept.length);
      const snapshots = {};
      for (const [k, v] of Object.entries(i.priceSnapshots || {})) {
        if (v.date >= cutoffIso) snapshots[k] = v;
      }
      return { ...i, priceHistory: kept, priceSnapshots: snapshots };
    });
    if (trimmed === 0) { alert(`No entries older than ${trimDays} days found.`); return; }
    if (confirm(`Remove ${trimmed.toLocaleString()} history entries older than ${trimDays} days?`)) {
      setData(prev => ({ ...prev, items: newItems }));
    }
  };

  const totalHistoryEntries = data.items.reduce((s, i) => s + (i.priceHistory?.length || 0), 0);
  const totalSnapshots = data.items.reduce((s, i) => s + Object.keys(i.priceSnapshots || {}).length, 0);

  return (
    <>
      <div className="header"><h1>Settings</h1></div>

      {/* Display */}
      <div className="stat-card" style={{marginBottom:20}}>
        <div className="label" style={{marginBottom:14}}>Display</div>

        <div style={{marginBottom:16}}>
          <div style={{fontSize:13,fontWeight:600,marginBottom:4}}>Shop name</div>
          <div style={{fontSize:12,color:'var(--text2)',marginBottom:6}}>Appears at the top of printed quotes and pick lists.</div>
          <input
            placeholder="e.g. My Lego Store"
            value={settings?.shopName || ''}
            onChange={e => setSettings(s => ({...s, shopName: e.target.value}))}
            style={{maxWidth:280,fontSize:13}}
          />
        </div>

        <div style={{marginBottom:16}}>
          <div style={{fontSize:13,fontWeight:600,marginBottom:8}}>Theme</div>
          <div style={{display:'flex',gap:8}}>
            {[
              { value: 'dark',  label: '🌙 Dark',  desc: 'Dark background' },
              { value: 'light', label: '☀️ Light', desc: 'Light background' },
            ].map(opt => (
              <label key={opt.value} style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',padding:'6px 14px',borderRadius:8,border:`1px solid ${(settings?.theme ?? 'dark') === opt.value ? 'var(--accent)' : 'var(--border)'}`,background:(settings?.theme ?? 'dark') === opt.value ? 'rgba(246,199,0,.08)' : 'var(--surface2)'}}>
                <input type="radio" name="theme"
                  checked={(settings?.theme ?? 'dark') === opt.value}
                  onChange={() => setSettings(s => ({...s, theme: opt.value}))}
                  style={{accentColor:'var(--accent)'}} />
                <span style={{fontSize:13,fontWeight:600}}>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        <label style={{display:'flex',alignItems:'center',gap:12,cursor:'pointer',userSelect:'none',marginBottom:12}}>
          <input type="checkbox"
            checked={!!settings?.typeColumn}
            onChange={e => setSettings(s => ({...s, typeColumn: e.target.checked}))}
            style={{width:16,height:16,accentColor:'var(--accent)',cursor:'pointer'}} />
          <div>
            <div style={{fontSize:13,fontWeight:600}}>Show Type column</div>
            <div style={{fontSize:12,color:'var(--text2)',marginTop:2}}>Show a separate Type column (Set / Minifig / Part) in the Inventory, Price Guide, Wanted List, and BrickLink Store tables instead of coloring the item name.</div>
          </div>
        </label>
        <label style={{display:'flex',alignItems:'center',gap:12,cursor:'pointer',userSelect:'none',marginBottom:12}}>
          <input type="checkbox"
            checked={!!settings?.blIdColumn}
            onChange={e => setSettings(s => ({...s, blIdColumn: e.target.checked}))}
            style={{width:16,height:16,accentColor:'var(--accent)',cursor:'pointer'}} />
          <div>
            <div style={{fontSize:13,fontWeight:600}}>Show BrickLink ID column</div>
            <div style={{fontSize:12,color:'var(--text2)',marginTop:2}}>Show the BrickLink item ID in a separate column in the Inventory, Price Guide, Wanted List, and BrickLink Store tables instead of below the item name.</div>
          </div>
        </label>
        <label style={{display:'flex',alignItems:'center',gap:12,cursor:'pointer',userSelect:'none',marginBottom:12}}>
          <input type="checkbox"
            checked={!!settings?.colorColumn}
            onChange={e => setSettings(s => ({...s, colorColumn: e.target.checked}))}
            style={{width:16,height:16,accentColor:'var(--accent)',cursor:'pointer'}} />
          <div>
            <div style={{fontSize:13,fontWeight:600}}>Show Color column</div>
            <div style={{fontSize:12,color:'var(--text2)',marginTop:2}}>Show color in a separate column in the Inventory, Price Guide, Wanted List, and BrickLink Store tables instead of next to the item number.</div>
          </div>
        </label>
        <label style={{display:'flex',alignItems:'center',gap:12,cursor:'pointer',userSelect:'none'}}>
          <input type="checkbox"
            checked={!!settings?.dateAddedColumn}
            onChange={e => setSettings(s => ({...s, dateAddedColumn: e.target.checked}))}
            style={{width:16,height:16,accentColor:'var(--accent)',cursor:'pointer'}} />
          <div>
            <div style={{fontSize:13,fontWeight:600}}>Show Date Added column</div>
            <div style={{fontSize:12,color:'var(--text2)',marginTop:2}}>Show a sortable Date Added column in the Inventory and Price Guide tables. You can always filter and sort by date added in the Inventory table regardless of this setting.</div>
          </div>
        </label>
      </div>

      {/* BrickLink Price Settings */}
      <div className="stat-card" style={{marginBottom:20}}>
        <div className="label" style={{marginBottom:14}}>BrickLink Price Region</div>
        <div style={{marginBottom:8}}>
          <div style={{fontSize:13,fontWeight:600,marginBottom:4}}>Sale region</div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            {[
              { value: 'US',  label: 'US only',   desc: 'Only sales within the United States' },
              { value: '',    label: 'Worldwide',  desc: 'All sales globally — matches BrickLink website default' },
            ].map(opt => (
              <label key={opt.value} style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',padding:'6px 12px',borderRadius:8,border:`1px solid ${(settings?.blCountryCode ?? 'US') === opt.value ? 'var(--accent)' : 'var(--border)'}`,background:(settings?.blCountryCode ?? 'US') === opt.value ? 'rgba(255,200,0,.08)' : 'var(--surface2)'}}>
                <input type="radio" name="blCountryCode"
                  checked={(settings?.blCountryCode ?? 'US') === opt.value}
                  onChange={() => setSettings(s => ({...s, blCountryCode: opt.value}))}
                  style={{accentColor:'var(--accent)'}} />
                <div>
                  <div style={{fontSize:13,fontWeight:600}}>{opt.label}</div>
                  <div style={{fontSize:11,color:'var(--text2)'}}>{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
          <p style={{fontSize:12,color:'var(--text2)',marginTop:8}}>
            US only returns fewer lots but is more relevant for US sellers. Worldwide matches the BrickLink website default view for supporting screens. The main Price Guide page always uses US sold sales and US active listings.
          </p>
        </div>
      </div>

      {/* Brickset MSRP */}
      <div className="stat-card" style={{marginBottom:20}}>
        <div className="label" style={{marginBottom:12}}>Brickset MSRP</div>
        <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap',marginBottom:8}}>
          <button
            className="btn btn-primary"
            onClick={loadMissingMsrp}
            disabled={msrpStatus === 'loading' || !bricksetConfigured}>
            {msrpStatus === 'loading' ? 'Loading MSRP…' : 'Load Missing MSRP'}
          </button>
          {!bricksetConfigured && (
            <span style={{fontSize:12,color:'var(--orange)'}}>Add a Brickset API key in Configuration first.</span>
          )}
          {msrpStatus && msrpStatus !== 'loading' && (
            msrpStatus.error ? (
              <span style={{fontSize:12,color:'var(--red)'}}>Error: {msrpStatus.error}</span>
            ) : (
              <span style={{fontSize:12,color:'var(--green)',fontWeight:600}}>
                {msrpStatus.message || `Done — ${msrpStatus.updated} item${msrpStatus.updated !== 1 ? 's' : ''} updated from ${msrpStatus.total} unique set${msrpStatus.total !== 1 ? 's' : ''}; ${msrpStatus.cached} cached, ${msrpStatus.fetched} fetched, ${msrpStatus.calls} Brickset call${msrpStatus.calls !== 1 ? 's' : ''}.`}
              </span>
            )
          )}
        </div>
        {msrpStatus && msrpStatus !== 'loading' && !msrpStatus.error && msrpStatus.missing?.length > 0 && (
          <div style={{fontSize:12,color:'var(--text2)',marginBottom:8}}>
            No US MSRP found for {msrpStatus.missing.length} set{msrpStatus.missing.length !== 1 ? 's' : ''}: {msrpStatus.missing.slice(0, 8).join(', ')}{msrpStatus.missing.length > 8 ? '…' : ''}
          </div>
        )}
        <p style={{fontSize:12,color:'var(--text2)',margin:0}}>
          Updates set items that do not already have MSRP. Unique set numbers are batched through Brickset and cached locally, so future runs only call Brickset for new uncached sets.
        </p>
      </div>

      {/* Price Guide Refresh */}
      <div className="stat-card" style={{marginBottom:20}}>
        <div className="label" style={{marginBottom:12}}>Price Guide Refresh</div>
        <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap',marginBottom:8}}>
          {priceBatchStatus === 'running' ? (
            <button className="btn btn-danger" onClick={cancelPriceFetch}>
              ⏹ Cancel Price Fetch ({priceBatchProgress})
            </button>
          ) : priceBatchStatus === 'interrupted' || priceBatchStatus === 'cancelled' ? (
            <>
              <button className="btn btn-primary" onClick={resumePriceFetch}>▶ Resume Price Fetch</button>
              <button className="btn btn-secondary" onClick={discardPriceBatch}>Discard</button>
            </>
          ) : (
            <button
              className="btn btn-primary"
              onClick={forceFetchAllPrices}
              disabled={priceBatchStatus === 'queued' || (!blConfigured && !ebayConfigured)}>
              {priceBatchStatus === 'queued' ? 'Opening Price Guide…' : '↻ Force Load All New Prices'}
            </button>
          )}
          {priceBatchStatus === 'queued' && (
            <span style={{fontSize:12,color:'var(--accent)',fontWeight:600}}>Opening Price Guide…</span>
          )}
          {priceBatchStatus === 'running' && priceBatchCurrent && (
            <span style={{fontSize:12,color:'var(--text2)',fontStyle:'italic'}}>{priceBatchCurrent}</span>
          )}
          {(priceBatchStatus === 'done' || priceBatchStatus === 'cancelled') && priceBatchCounts && (
            <span style={{fontSize:12,color:priceBatchStatus==='cancelled'?'var(--text2)':'var(--green)',fontWeight:600}}>
              {priceBatchStatus==='cancelled' ? 'Cancelled' : 'Done'} — {priceBatchCounts.done} updated{priceBatchCounts.failed ? `, ${priceBatchCounts.failed} failed` : ''}
            </span>
          )}
          {typeof priceBatchStatus === 'string' && priceBatchStatus.startsWith('error:') && (
            <span style={{fontSize:12,color:'var(--red)'}}>{priceBatchStatus.slice(6)}</span>
          )}
          {!blConfigured && !ebayConfigured && (
            <span style={{fontSize:12,color:'var(--orange)'}}>Configure BrickLink or eBay first.</span>
          )}
        </div>
        <p style={{fontSize:12,color:'var(--text2)',margin:0}}>
          Forces every active inventory item through the Price Guide fetch, ignoring the normal 8-hour freshness skip. This updates saved BrickLink/eBay values, weekly snapshots, history, and suggested prices.
        </p>
      </div>

      {/* BrickLink XML */}
      <div className="stat-card" style={{marginBottom:20}}>
        <div className="label" style={{marginBottom:12}}>BrickLink XML Import / Export</div>
        <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:12}}>
          <button className="btn btn-secondary" onClick={()=>localFileInput.current.click()}>{Icons.upload} Import BrickLink XML</button>
          <button className="btn btn-secondary" onClick={()=>exportBricklinkXML({forSale:false})}>{Icons.download} Export Inventory XML</button>
          <button className="btn btn-secondary" onClick={()=>exportBricklinkXML({forSale:true})}>{Icons.download} Export For Sale XML</button>
          <button className="btn btn-secondary" onClick={exportBricklinkWanted}>{Icons.download} Export Wanted List</button>
        </div>
        <div style={{fontSize:13,color:'var(--text2)',lineHeight:1.7,marginBottom:14}}>
          <p style={{marginBottom:6}}><strong style={{color:'var(--blue)'}}>Import:</strong> BrickLink → My Inventory → Export, then import the XML here. Also accepts BrickStore/BrickStock .bsx files.</p>
          <p style={{marginBottom:6}}><strong style={{color:'var(--green)'}}>Inventory XML:</strong> Upload to BrickLink via My Inventory → Upload to sync your stock.</p>
          <p style={{marginBottom:6}}><strong style={{color:'var(--accent)'}}>For Sale XML:</strong> Uses your list prices — upload to create store listings on BrickLink.</p>
          <p><strong style={{color:'var(--orange)'}}>Wanted List:</strong> Items without prices, for uploading as a BrickLink wanted list.</p>
        </div>

        <div style={{borderTop:'1px solid var(--border)',paddingTop:14}}>
          <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
            {batchStatus === 'running' ? (
              <button className="btn btn-danger" onClick={cancelBricklinkFetch}>
                ⏹ Cancel Fetch ({batchProgress})
              </button>
            ) : batchStatus === 'interrupted' ? (
              <>
                <button className="btn btn-primary" onClick={resumeBricklinkFetch}>▶ Resume Fetch</button>
                <button className="btn btn-secondary" onClick={discardBatch}>Discard</button>
              </>
            ) : (
              <button className="btn btn-primary" onClick={fetchBricklinkDetails}>
                🔄 Fetch BrickLink Details
              </button>
            )}
            {batchStatus==='running' && batchCurrent && (
              <span style={{fontSize:12,color:'var(--text2)',fontStyle:'italic'}}>{batchCurrent}</span>
            )}
            {(batchStatus==='done' || batchStatus==='cancelled') && batchCounts && (
              <span style={{fontSize:12,color:batchStatus==='cancelled'?'var(--text2)':'var(--green)',fontWeight:600}}>
                {batchStatus==='cancelled' ? 'Cancelled' : 'Done'} — {batchCounts.updated} updated, {batchCounts.skipped} skipped{batchCounts.failed ? `, ${batchCounts.failed} failed` : ''}
              </span>
            )}
            {typeof batchStatus === 'string' && batchStatus.startsWith('error:') && (
              <span style={{fontSize:12,color:'var(--red)'}}>{batchStatus.slice(6)}</span>
            )}
          </div>
          <p style={{marginTop:8,fontSize:12,color:'var(--text2)'}}>
            Fills in name and theme for each item. Uses the local catalog if loaded (instant, no API calls) — falls back to BrickLink API for any misses. Images always require the API.
          </p>
        </div>

        <div style={{borderTop:'1px solid var(--border)',paddingTop:14}}>
          <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
            {imgStatus === 'running' ? (
              <button className="btn btn-danger" onClick={cancelImageFetch}>
                ⏹ Cancel ({imgProgress})
              </button>
            ) : imgStatus === 'interrupted' ? (
              <>
                <button className="btn btn-primary" onClick={resumeImageFetch}>▶ Resume Image Fetch</button>
                <button className="btn btn-secondary" onClick={discardImageFetch}>Discard</button>
              </>
            ) : (
              <button className="btn btn-primary" onClick={fetchImages}>
                🖼 Fetch BrickLink Images
              </button>
            )}
            {imgStatus === 'running' && imgCurrent && (
              <span style={{fontSize:12,color:'var(--text2)',fontStyle:'italic'}}>{imgCurrent}</span>
            )}
            {(imgStatus === 'done' || imgStatus === 'cancelled') && imgCounts && (
              <span style={{fontSize:12,color:imgStatus==='cancelled'?'var(--text2)':'var(--green)',fontWeight:600}}>
                {imgStatus === 'cancelled' ? 'Cancelled' : 'Done'} — {imgCounts.updated} updated{imgCounts.failed ? `, ${imgCounts.failed} failed` : ''}
              </span>
            )}
            {typeof imgStatus === 'string' && imgStatus.startsWith('error:') && (
              <span style={{fontSize:12,color:'var(--red)'}}>{imgStatus.slice(6)}</span>
            )}
          </div>
          <p style={{marginTop:8,fontSize:12,color:'var(--text2)'}}>
            Fetches image URLs from BrickLink for items that don't have one. Requires BrickLink API credentials.
          </p>
        </div>

        <div style={{borderTop:'1px solid var(--border)',paddingTop:14}}>
          <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
            <button className="btn btn-danger" onClick={() => {
              if (window.confirm('Clear all item images and the local image cache? Images will need to be re-fetched from BrickLink.')) {
                clearImages();
              }
            }}>
              🗑 Clear All Images &amp; Cache
            </button>
          </div>
          <p style={{marginTop:8,fontSize:12,color:'var(--text2)'}}>
            Removes image URLs from all items and deletes cached image files from disk. Use this to force a fresh re-fetch of color-correct images.
          </p>
        </div>
      </div>

      {/* BrickLink Store Import */}
      {blConfigured && (
        <div className="stat-card" style={{marginBottom:20}}>
          <div className="label" style={{marginBottom:12}}>BrickLink Store</div>
          <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap',marginBottom:8}}>
            <button
              className="btn btn-primary"
              onClick={importStoreInventory}
              disabled={storeImportStatus === 'loading'}>
              {storeImportStatus === 'loading' ? '⏳ Importing…' : '🔄 Import Store Inventory'}
            </button>
            {storeImportStatus && storeImportStatus !== 'loading' && (
              storeImportStatus.error ? (
                <span style={{fontSize:12,color:'var(--red)'}}>Error: {storeImportStatus.error}</span>
              ) : (
                <span style={{fontSize:12,color:'var(--green)',fontWeight:600}}>
                  Done — {storeImportStatus.matched} item{storeImportStatus.matched !== 1 ? 's' : ''} matched &amp; marked listed
                  {storeImportStatus.notFound > 0 ? `, ${storeImportStatus.notFound} BL listing${storeImportStatus.notFound !== 1 ? 's' : ''} not in inventory` : ''}
                </span>
              )
            )}
          </div>
          <p style={{fontSize:12,color:'var(--text2)',margin:0}}>
            Fetches your active BrickLink store listings and marks matching inventory items as listed, setting their list price and platform to BrickLink. Items already marked as sold are not changed.
          </p>
        </div>
      )}

      {/* Price History */}
      <div className="stat-card" style={{marginBottom:20}}>
        <div className="label" style={{marginBottom:4}}>Price History</div>
        <p style={{fontSize:12,color:'var(--text2)',marginBottom:14}}>
          Currently storing {totalHistoryEntries.toLocaleString()} history {totalHistoryEntries === 1 ? 'entry' : 'entries'} and {totalSnapshots.toLocaleString()} weekly {totalSnapshots === 1 ? 'snapshot' : 'snapshots'} across {data.items.length} items.
        </p>

        {/* Trim */}
        <div style={{marginBottom:16}}>
          <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',marginBottom:6}}>
            <button className="btn btn-secondary" onClick={trimPriceHistory}>✂ Trim History</button>
            <span style={{fontSize:13,color:'var(--text2)'}}>Keep last</span>
            <input
              type="number" min="7" max="3650" value={trimDays}
              onChange={e => setTrimDays(Math.max(1, parseInt(e.target.value) || 90))}
              style={{width:64,padding:'4px 8px',borderRadius:6,border:'1px solid var(--border)',background:'var(--surface2)',color:'var(--text)',fontSize:13,textAlign:'center'}} />
            <span style={{fontSize:13,color:'var(--text2)'}}>days of history per item.</span>
          </div>
          <p style={{fontSize:12,color:'var(--text2)'}}>Removes fetch records and weekly snapshots older than the specified number of days. Current stored prices are not affected.</p>
        </div>

        {/* Clear all */}
        <div style={{borderTop:'1px solid var(--border)',paddingTop:14}}>
          <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',marginBottom:6}}>
            <button className="btn btn-danger" onClick={clearPriceHistory}>🗑 Clear All Price History</button>
          </div>
          <p style={{fontSize:12,color:'var(--text2)'}}>Wipes all history entries and weekly snapshots from every item. The sparklines, trend indicators, and history modal will be empty until you re-fetch. Current stored prices are not affected.</p>
        </div>
      </div>

      {/* Merge Duplicates */}
      <div className="stat-card" style={{marginBottom:20}}>
        <div className="label" style={{marginBottom:12}}>Merge Duplicate Items</div>
        <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:12}}>
          <button className="btn btn-secondary" onClick={onMergeDuplicates}>⊞ Merge Duplicates</button>
        </div>
        <p style={{fontSize:13,color:'var(--text2)',lineHeight:1.7}}>
          Finds rows that share the same item number, color, and condition, then collapses them into one — summing quantities, keeping the lowest purchase price, and keeping the highest estimated value. Notes are combined. Sold items are never touched.
        </p>
      </div>

      {/* General Data Management */}
      <div className="stat-card" style={{marginBottom:20}}>
        <div className="label" style={{marginBottom:12}}>General Data Management</div>
        <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
          <button className="btn btn-secondary" onClick={exportData}>{Icons.download} Export JSON</button>
          <button className="btn btn-secondary" onClick={exportCSV}>{Icons.download} Export CSV</button>
          <button className="btn btn-secondary" onClick={()=>localFileInput.current.click()}>{Icons.upload} Import</button>
          <button className="btn btn-danger"    onClick={clearAll}>{Icons.trash} Clear All Data</button>
        </div>
        <p style={{marginTop:12,fontSize:13,color:'var(--text2)'}}>
          Import supports JSON, CSV, BrickLink XML (.xml), and BrickStore (.bsx) files.
        </p>
      </div>

      <input ref={localFileInput} type="file" style={{display:'none'}} accept=".json,.csv,.xml,.bsx" onChange={importData} />

      {/* Tips */}
      <div className="stat-card">
        <div className="label" style={{marginBottom:12}}>Price Guide Tips</div>
        <div style={{fontSize:13,color:'var(--text2)',lineHeight:1.7}}>
          <p style={{marginBottom:8}}>Every item has quick links to check current prices. Use the <strong>Price Guide</strong> page to search any item number without adding it to inventory first.</p>
          <p><strong style={{color:'var(--blue)'}}>BrickLink</strong> → Price Guide tab with recent sales. <strong style={{color:'var(--red)'}}>eBay Sold</strong> → completed listings for real market prices. <strong style={{color:'var(--orange)'}}>eBay Active</strong> → current competitor listings.</p>
        </div>
      </div>
    </>
  );
}
