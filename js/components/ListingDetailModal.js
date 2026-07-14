// ─── Listing Detail Modal ───
// Shown when clicking an item row in the Selling page.
// Compact item header + selling fields + embedded price guide row.

function ListingDetailModal({ item, onClose, onSave, setSellItem, updateItems, blConfigured, ebayConfigured, settings, setPage, setPricingSearch, setEditItem, setModal }) {
  const initialSuggested = suggestedPrice(item);
  const [form, setForm] = React.useState({
    sellStatus:    item.sellStatus || 'listed',
    purchasePrice: item.purchasePrice || (item.retailPrice > 0 ? item.retailPrice : ''),
    listPrice:     initialSuggested || item.listPrice || '',
    desiredProfit: item.desiredProfit ?? '',
    platformPrices:{ ...(item.platformPrices || {}) },
    salePrice:     item.salePrice     || '',
    fees:          item.fees          || '',
    shippingCost:  item.shippingCost  || '',
    platform:      item.platform      || '',
    notes:         item.notes         || '',
  });
  const [listPriceTouched, setListPriceTouched] = React.useState(false);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const num = (key) => (e) => set(key, e.target.value === '' ? '' : parseFloat(e.target.value) || 0);
  const defaultPlatforms = [
    { id: 'bricklink', name: 'BrickLink',    pctFee: 3,    flatFee: 0 },
    { id: 'ebay',      name: 'eBay',         pctFee: 13.25, flatFee: 0.30 },
    { id: 'facebook',  name: 'Facebook',     pctFee: 5,    flatFee: 0 },
    { id: 'reddit',    name: 'Reddit',       pctFee: 0,    flatFee: 0 },
    { id: 'private',   name: 'Private Sale', pctFee: 0,    flatFee: 0 },
  ];
  const sellingPlatforms = (settings?.platforms?.length ? settings.platforms : defaultPlatforms)
    .filter(p => (p.name || '').trim());

  const platformAliases = {
    bricklink: ['bricklink', 'brick link', 'bl'],
    ebay: ['ebay', 'e-bay'],
    reddit: ['reddit', 'legomarket', 'r/legomarket'],
    facebook: ['facebook', 'fb', 'marketplace', 'facebook marketplace'],
    private: ['private', 'private sale'],
  };

  const platformTokens = (value) => String(value || '')
    .split(/[,&/;+|]|\band\b/gi)
    .map(s => s.trim())
    .filter(Boolean);

  const platformMatches = (token, platform) => {
    const t = token.toLowerCase();
    const id = (platform.id || '').toLowerCase();
    const name = (platform.name || '').toLowerCase();
    const aliases = [id, name, ...(platformAliases[id] || [])].filter(Boolean);
    return aliases.some(alias => t === alias || t.includes(alias));
  };

  const hasPlatform = (value, platform) =>
    platformTokens(value).some(token => platformMatches(token, platform));

  const platformKey = (platform) => platform.id || platform.name;

  const defaultListPrice = () => suggestedPrice(liveItem) || form.listPrice || item.listPrice || '';

  const platformListPrice = (platform) => {
    const price = form.platformPrices?.[platformKey(platform)];
    return price === 0 || price ? price : defaultListPrice();
  };

  const setPlatformListPrice = (platform, value) => {
    const key = platformKey(platform);
    setForm(f => ({
      ...f,
      platformPrices: { ...(f.platformPrices || {}), [key]: value },
    }));
  };

  const requiredListPriceForProfit = (platform, desiredProfit, totalCost, quantity) => {
    const target = parseFloat(desiredProfit);
    if (target == null || Number.isNaN(target) || quantity <= 0) return null;
    const rate = (platform.pctFee || 0) / 100;
    const denominator = quantity * (1 - rate);
    if (denominator <= 0) return null;
    return Math.ceil(((target + totalCost + (platform.flatFee || 0)) / denominator) * 100) / 100;
  };

  const togglePlatform = (platform) => {
    setForm(f => {
      const tokens = platformTokens(f.platform);
      const exists = tokens.some(token => platformMatches(token, platform));
      const next = exists
        ? tokens.filter(token => !platformMatches(token, platform))
        : [...tokens, platform.name];
      return { ...f, platform: next.join(', ') };
    });
  };

  // ─── Inline price guide state (mirrors PricingPage row) ───
  const blCountryCode = settings?.blCountryCode !== undefined ? settings.blCountryCode : 'US';
  const [fetchStatus, setFetchStatus] = React.useState(
    (item.bricklinkPrice != null || item.ebayPrice != null) ? 'done' : 'idle'
  );
  const [fetchMsg, setFetchMsg] = React.useState('');
  // Live copy of the item so price updates reflect immediately
  const [liveItem, setLiveItem] = React.useState(item);

  // Keep liveItem in sync if parent updates (e.g. after a fetch)
  React.useEffect(() => { setLiveItem(item); }, [item]);

  const handleFetch = React.useCallback(async () => {
    if (!item.itemNumber) return;
    setFetchStatus('fetching');
    setFetchMsg('');
    let blAvg = null, blMedian = null, blSoldQty = null;
    let blActiveAvg = null, blActiveMedian = null, blActiveQty = null;
    let ebayAvg = null;
    let blDetail = null, blActiveDetail = null, ebayDetail = null;
    let blPriceEstimated = null;
    let ebayPlusShipping = false;
    let newImageUrl = null;
    const errors = [];

    // For parts with a color, fetch the color-specific image from BrickLink catalog
    if (blConfigured && item.type === 'part' && item.blColorId) {
      try {
        const imgParams = new URLSearchParams({ type: 'part', itemNumber: item.itemNumber, colorId: item.blColorId });
        const imgResp = await fetch(`/api/bricklink/catalog?${imgParams}`);
        const imgData = imgResp.ok ? await imgResp.json() : null;
        if (imgData && !imgData.error && imgData.imageUrl) newImageUrl = imgData.imageUrl;
      } catch(e) { /* non-fatal */ }
    }

    if (blConfigured) {
      try {
        const params = new URLSearchParams({ type: item.type || 'set', itemNumber: item.itemNumber, guide: 'sold', newOrUsed: blCondition(item), filterOutliers: 'true', countryCode: blCountryCode });
        if (item.blColorId) params.set('colorId', item.blColorId);
        const resp = await fetch(`/api/bricklink/price?${params}`);
        const bl = await resp.json();
        if (resp.ok && !bl.error) {
          blAvg = bl.avg ?? null; blMedian = bl.median ?? null; blSoldQty = bl.unitQuantity ?? null;
          blDetail = bl.priceDetail?.length ? { avg: bl.avg, median: bl.median, lots: bl.priceDetail } : null;
        }
      } catch(e) { errors.push(`BL sold: ${e.message}`); }

      if (blAvg == null) {
        try {
          const isUsed = blCondition(item) === 'U';
          const params = new URLSearchParams({ type: item.type || 'set', itemNumber: item.itemNumber, guide: 'sold', newOrUsed: isUsed ? 'N' : 'U', filterOutliers: 'true', countryCode: blCountryCode });
          if (item.blColorId) params.set('colorId', item.blColorId);
          const resp = await fetch(`/api/bricklink/price?${params}`);
          const fb = await resp.json();
          if (resp.ok && !fb.error && fb.avg != null) {
            const scale = isUsed ? 0.6 : 1.4;
            blAvg = Math.round(fb.avg * scale * 100) / 100;
            blMedian = fb.median != null ? Math.round(fb.median * scale * 100) / 100 : null;
            blSoldQty = fb.unitQuantity ?? null;
            blPriceEstimated = isUsed ? 'used_from_new' : 'new_from_used';
          }
        } catch(e) {}
      }

      try {
        const params = new URLSearchParams({ type: item.type || 'set', itemNumber: item.itemNumber, guide: 'stock', newOrUsed: blCondition(item), filterOutliers: 'true', countryCode: blCountryCode });
        if (item.blColorId) params.set('colorId', item.blColorId);
        const resp = await fetch(`/api/bricklink/price?${params}`);
        const bla = await resp.json();
        if (resp.ok && !bla.error) {
          blActiveAvg = bla.avg || null; blActiveMedian = bla.median || null; blActiveQty = bla.unitQuantity ?? null;
          blActiveDetail = bla.priceDetail?.length ? { avg: bla.avg, median: bla.median, lots: bla.priceDetail } : null;
        }
      } catch(e) { errors.push(`BL active: ${e.message}`); }
    }

    if (ebayConfigured && item.type !== 'part') {
      try {
        const isCol = /^col/i.test(item.itemNumber);
        let searchTerm;
        if (isCol) {
          let name = item.name || '';
          if (name.includes(',')) name = name.split(',')[0].trim();
          searchTerm = name ? `${item.itemNumber} ${name}` : item.itemNumber;
        } else if (item.type === 'set') {
          const itemNum = /^.+-1$/i.test(item.itemNumber) ? item.itemNumber.replace(/-1$/, '') : item.itemNumber;
          searchTerm = item.name ? `${itemNum} ${item.name}` : itemNum;
        } else {
          searchTerm = item.name ? `${item.itemNumber} ${item.name}` : item.itemNumber;
        }
        const conditionTerm = item.condition === 'new_sealed' ? 'new sealed' : item.condition === 'new_open' ? 'new open box' : item.condition === 'used_complete' ? 'used' : '';
        const q = `LEGO ${searchTerm}${conditionTerm ? ' ' + conditionTerm : ''}`.trim();
        const resp = await fetch(`/api/ebay/price?${new URLSearchParams({ query: q, limit: '10' })}`);
        const eb = await resp.json();
        if (resp.ok && !eb.error) {
          ebayPlusShipping = eb.hasCalculated ?? false;
          ebayAvg = ebayPlusShipping ? (eb.avgItemOnly ?? eb.avg ?? null) : (eb.avg ?? null);
          ebayDetail = eb.items?.length ? { listings: eb.items } : null;
        }
      } catch(e) { errors.push(`eBay: ${e.message}`); }
    }

    if (blAvg == null && blMedian == null && blActiveAvg == null && ebayAvg == null) {
      setFetchStatus('error'); setFetchMsg(errors.join('; ') || 'No data returned'); return;
    }

    const now = new Date().toISOString();
    const weekKey = (() => {
      const d = new Date(now); d.setUTCHours(0,0,0,0); d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
      const ys = new Date(Date.UTC(d.getUTCFullYear(),0,1));
      return `${d.getUTCFullYear()}-W${String(Math.ceil(((d-ys)/86400000+1)/7)).padStart(2,'0')}`;
    })();

    if (updateItems) {
      updateItems(prev => prev.map(it => {
        if (it.id !== item.id) return it;

        // Apply ignored title filter and shipping rule before storing avg or history entry
        let filteredEbayAvg = ebayAvg;
        let filteredEbayPlusShipping = ebayPlusShipping;
        if (ebayDetail?.listings?.length) {
          const ignoredSet = new Set(it.ebayIgnoredUrls || []);
          const activeListings = ebayDetail.listings.filter(l => !ignoredSet.has(l.title));
          const computed = ebayAvgFromListings(activeListings);
          if (computed != null) {
            filteredEbayAvg = computed;
            filteredEbayPlusShipping = !activeListings.every(l => !l.shippingUnknown && l.shippingType !== 'CALCULATED');
          }
        }

        const entry = { date: now, blPrice: blAvg, blMedian, blActivePrice: blActiveAvg, blActiveMedian, ebayPrice: filteredEbayAvg, source: 'api', ...(blPriceEstimated ? { blPriceEstimated } : {}), ...(ebayPlusShipping ? { ebayPlusShipping: true } : {}) };
        const history = [...(it.priceHistory || []), entry];
        let snapshots = { ...(it.priceSnapshots || {}) };
        const existing = snapshots[weekKey] || {};
        snapshots[weekKey] = { ...existing, date: now, weekKey,
          bl:       blDetail       ? { avg: blAvg,       ...blDetail       } : (existing.bl       ?? null),
          blActive: blActiveDetail ? { avg: blActiveAvg, ...blActiveDetail } : (existing.blActive  ?? null),
          ebay:     ebayDetail     ? { avg: ebayAvg,     ...ebayDetail     } : (existing.ebay      ?? null),
        };
        const updated = {
          ...it,
          priceHistory: history, priceSnapshots: snapshots,
          bricklinkPrice:          blAvg             != null ? blAvg             : it.bricklinkPrice,
          bricklinkMedian:         blMedian          != null ? blMedian          : it.bricklinkMedian,
          bricklinkSoldQty:        blSoldQty         != null ? blSoldQty         : it.bricklinkSoldQty,
          bricklinkPriceEstimated: blPriceEstimated  != null ? blPriceEstimated  : (blAvg != null ? null : it.bricklinkPriceEstimated),
          bricklinkActive:         blActiveAvg       != null ? blActiveAvg       : it.bricklinkActive,
          bricklinkActiveMedian:   blActiveMedian    != null ? blActiveMedian    : it.bricklinkActiveMedian,
          bricklinkActiveQty:      blActiveQty       != null ? blActiveQty       : it.bricklinkActiveQty,
          ebayPrice:               filteredEbayAvg        != null ? filteredEbayAvg        : it.ebayPrice,
          ebayPlusShipping:        filteredEbayAvg        != null ? filteredEbayPlusShipping : it.ebayPlusShipping,
          imageUrl:                newImageUrl            != null ? newImageUrl             : it.imageUrl,
          updatedAt: now,
        };
        setLiveItem(updated);
        return updated;
      }));
    }

    const parts = [];
    if (blAvg       != null) parts.push(`BL sold ${currency(blAvg)}`);
    if (blMedian    != null) parts.push(`med ${currency(blMedian)}`);
    if (blActiveAvg != null) parts.push(`active ${currency(blActiveAvg)}`);
    if (ebayAvg     != null) parts.push(`eBay ${currency(ebayAvg)}`);
    setFetchStatus('done'); setFetchMsg(parts.join(' · '));
  }, [item, blConfigured, ebayConfigured, blCountryCode, updateItems]);

  // ─── BrickLink store listing state ───
  // 'idle' | 'checking' | 'already_listed' | 'ready' | 'listing' | 'done' | 'error'
  const [blListState, setBlListState]   = React.useState('idle');
  const [blListMsg,   setBlListMsg]     = React.useState('');
  const [blExisting,  setBlExisting]    = React.useState(null); // existing inventory_id if already listed
  const [blListPrice, setBlListPrice]   = React.useState('');   // editable price for the BL listing
  const [blListPriceTouched, setBlListPriceTouched] = React.useState(false);

  // Pre-fill blListPrice when form.listPrice changes
  React.useEffect(() => {
    const bricklinkPlatform = sellingPlatforms.find(p => (p.id || '').toLowerCase() === 'bricklink') || { id: 'bricklink', name: 'BrickLink' };
    const price = platformListPrice(bricklinkPlatform);
    if (!blListPriceTouched && !blListPrice && price) setBlListPrice(String(price));
  }, [form.listPrice, form.platformPrices, blListPrice, blListPriceTouched]);

  const checkAndListOnBrickLink = React.useCallback(async () => {
    if (!item.itemNumber) return;
    setBlListState('checking');
    setBlListMsg('');
    setBlExisting(null);

    // Check if this item already has an active listing in the store
    try {
      const params = new URLSearchParams({ type: item.type || 'set', itemNumber: item.itemNumber });
      if (item.blColorId) params.set('colorId', item.blColorId);
      const resp = await fetch(`/api/bricklink/store/inventory?${params}`);
      const data = await resp.json();
      if (!resp.ok || data.error) {
        setBlListState('error');
        setBlListMsg(data.error || 'Could not check store inventory.');
        return;
      }
      if (data.inventories?.length > 0) {
        setBlExisting(data.inventories[0]);
        setBlListState('already_listed');
        return;
      }
    } catch(e) {
      setBlListState('error');
      setBlListMsg(e.message);
      return;
    }

    // Not yet listed — show the confirmation UI
    const bricklinkPlatform = sellingPlatforms.find(p => (p.id || '').toLowerCase() === 'bricklink') || { id: 'bricklink', name: 'BrickLink' };
    const price = platformListPrice(bricklinkPlatform);
    if (!blListPriceTouched && !blListPrice && price) setBlListPrice(String(price));
    setBlListState('ready');
  }, [item, blListPrice, blListPriceTouched, form.listPrice, form.platformPrices, sellingPlatforms]);

  const confirmListOnBrickLink = React.useCallback(async () => {
    const price = parseFloat(blListPrice);
    if (!price || price <= 0) { alert('Enter a valid list price first.'); return; }

    const TYPE_MAP = { set: 'SET', minifig: 'MINIFIG', part: 'PART' };
    const blType  = TYPE_MAP[item.type] || 'SET';
    const cond    = (item.condition === 'new_sealed' || item.condition === 'new_open') ? 'N' : 'U';
    const completeness = item.type === 'set'
      ? (item.condition === 'new_sealed' ? 'S' : 'C')
      : undefined;

    setBlListState('listing');
    setBlListMsg('');

    try {
      const resp = await fetch('/api/bricklink/store/create-listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_type:   blType,
          item_number: item.itemNumber,
          color_id:    item.blColorId || '',
          quantity:    item.quantity  || 1,
          price,
          condition:   cond,
          completeness,
          description: item.name     || '',
          remarks:     form.notes    || '',
        }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        setBlListState('error');
        setBlListMsg(data.error || 'Failed to create listing.');
        return;
      }
      setBlListState('done');
      setBlListMsg(`Listed on BrickLink${data.inventory_id ? ` (ID ${data.inventory_id})` : ''}`);
      const bricklinkPlatform = sellingPlatforms.find(p => (p.id || '').toLowerCase() === 'bricklink') || { id: 'bricklink', name: 'BrickLink' };
      const platformTokensAfterBl = platformTokens(form.platform);
      const nextPlatform = platformTokensAfterBl.some(token => platformMatches(token, bricklinkPlatform))
        ? platformTokensAfterBl.join(', ')
        : [...platformTokensAfterBl, 'BrickLink'].join(', ');
      const nextPlatformPrices = {
        ...(form.platformPrices || {}),
        [platformKey(bricklinkPlatform)]: price,
      };
      set('sellStatus', 'listed');
      set('platform', nextPlatform);
      set('platformPrices', nextPlatformPrices);
      if (!form.listPrice) set('listPrice', price);
      if (updateItems) {
        updateItems(prev => prev.map(it => it.id === item.id ? {
          ...it,
          sellStatus: 'listed',
          platform: nextPlatform,
          listPrice: price,
          platformPrices: nextPlatformPrices,
          bricklinkInventoryId: data.inventory_id || it.bricklinkInventoryId,
          updatedAt: new Date().toISOString(),
        } : it));
      }
    } catch(e) {
      setBlListState('error');
      setBlListMsg(e.message);
    }
  }, [item, form.notes, form.listPrice, blListPrice, updateItems]);

  const handleSave = () => {
    onSave({
      ...item,
      sellStatus:    form.sellStatus,
      purchasePrice: parseFloat(form.purchasePrice) || 0,
      listPrice:     parseFloat(form.listPrice)     || 0,
      desiredProfit: form.desiredProfit === '' ? '' : parseFloat(form.desiredProfit) || 0,
      platformPrices: Object.fromEntries(
        Object.entries(form.platformPrices || {})
          .filter(([, v]) => v !== '' && v != null)
          .map(([k, v]) => [k, parseFloat(v) || 0])
      ),
      salePrice:     parseFloat(form.salePrice)     || 0,
      fees:          parseFloat(form.fees)          || 0,
      shippingCost:  parseFloat(form.shippingCost)  || 0,
      platform:      form.platform,
      notes:         form.notes,
    });
    onClose();
  };

  const suggested  = suggestedPrice(liveItem);
  const qty        = item.quantity || 1;
  const cost       = (parseFloat(form.purchasePrice) || 0) * qty;
  const listP      = parseFloat(form.listPrice) || 0;
  const desiredProfit = form.desiredProfit === '' ? null : parseFloat(form.desiredProfit);
  const saleP      = parseFloat(form.salePrice) || 0;
  const expectedProfit = form.sellStatus === 'sold'
    ? saleP * qty - cost - (parseFloat(form.fees) || 0) - (parseFloat(form.shippingCost) || 0)
    : listP > 0 ? listP * qty - cost : null;

  React.useEffect(() => {
    if (form.sellStatus !== 'sold' && suggested && !listPriceTouched && form.listPrice !== suggested) {
      set('listPrice', suggested);
    }
    if (suggested && !blListPriceTouched && blListPrice !== String(suggested)) {
      setBlListPrice(String(suggested));
    }
  }, [suggested, form.sellStatus, form.listPrice, listPriceTouched, blListPrice, blListPriceTouched]);

  const typeColor = item.type === 'set' ? 'var(--accent)' : item.type === 'minifig' ? 'var(--orange)' : 'var(--blue)';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 680 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Listing Detail</h2>
          <button className="btn-icon" onClick={onClose}>{Icons.x}</button>
        </div>
        <div className="modal-body">

          {/* Compact item header */}
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', background: 'var(--surface2)', borderRadius: 10, padding: '12px 16px', marginBottom: 20 }}>
            {item.imageUrl && (
              <img src={item.imageUrl} alt="" style={{ width: 56, height: 56, objectFit: 'contain', borderRadius: 6, flexShrink: 0, background: 'var(--surface)' }} />
            )}
            {!item.imageUrl && (
              <div style={{ width: 56, height: 56, borderRadius: 6, background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, flexShrink: 0 }}>
                {item.type === 'set' ? '📦' : item.type === 'minifig' ? '🧑' : '🧱'}
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{ fontWeight: 700, fontSize: 15, color: typeColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: setEditItem && setModal ? 'pointer' : undefined, textDecoration: setEditItem && setModal ? 'underline dotted' : undefined }}
                title={setEditItem && setModal ? 'Open Item Detail' : undefined}
                onClick={setEditItem && setModal ? () => { onClose(); setEditItem(item); setModal('edit'); } : undefined}>
                {item.name || item.itemNumber}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                {item.itemNumber}{item.theme ? ` · ${item.theme}` : ''}{item.color && item.color !== '(Not Applicable)' ? ` · ${item.color}` : ''}{item.condition && CONDITION_LABELS[item.condition] ? ` · ${CONDITION_LABELS[item.condition]}` : ''}
              </div>
              {qty > 1 && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 1 }}>Qty: {qty}</div>}
            </div>
            {setPage && setPricingSearch && item.itemNumber && (
              <button
                onClick={() => { setPricingSearch(item.itemNumber); setPage('pricing'); onClose(); }}
                style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, background: 'rgba(76,140,231,.12)', color: 'var(--blue)', border: '1px solid rgba(76,140,231,.25)', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
                Price Guide ↗
              </button>
            )}
          </div>

          {/* ─── Inline Price Guide row ─── */}
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', marginBottom: 20, background: 'var(--surface2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Price Guide</div>
              {(blConfigured || ebayConfigured) && (
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ fontSize: 11, padding: '2px 8px' }}
                  disabled={fetchStatus === 'fetching'}
                  onClick={handleFetch}>
                  {fetchStatus === 'fetching' ? '🔄 Fetching…' : '↻ Fetch Prices'}
                </button>
              )}
              {fetchStatus === 'done'  && fetchMsg && <span style={{ fontSize: 11, color: 'var(--green)' }}>✓ {fetchMsg}</span>}
              {fetchStatus === 'error' && <span style={{ fontSize: 11, color: 'var(--red)' }}>✗ {fetchMsg}</span>}
            </div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {/* Suggested */}
              <div>
                <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.4px' }}>Suggested</div>
                {suggested != null
                  ? <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)' }}>{currency(suggested)}</div>
                  : <div style={{ color: 'var(--text3)', fontSize: 13 }}>—</div>}
              </div>
              {/* BL Sold */}
              <div>
                <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.4px' }}>BL Sold</div>
                {liveItem.bricklinkPrice != null
                  ? <>
                      <div style={{ fontWeight: 600, color: 'var(--blue)' }}>{currency(liveItem.bricklinkPrice)}</div>
                      {liveItem.bricklinkMedian != null && <div style={{ fontSize: 11, color: 'var(--text2)' }}>med <span style={{ color: 'var(--blue)' }}>{currency(liveItem.bricklinkMedian)}</span></div>}
                      {liveItem.bricklinkSoldQty != null && <div style={{ fontSize: 11, color: 'var(--text2)' }}>{liveItem.bricklinkSoldQty} sales</div>}
                      {liveItem.bricklinkPriceEstimated === 'used_from_new' && <div style={{ fontSize: 10, color: 'var(--orange)' }}>est. from new ×0.6</div>}
                      {liveItem.bricklinkPriceEstimated === 'new_from_used' && <div style={{ fontSize: 10, color: 'var(--orange)' }}>est. from used ×1.4</div>}
                    </>
                  : <div style={{ color: 'var(--text3)', fontSize: 13 }}>—</div>}
              </div>
              {/* BL Active */}
              <div>
                <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.4px' }}>BL Active</div>
                {liveItem.bricklinkActive != null
                  ? <>
                      <div style={{ fontWeight: 600, color: 'var(--purple)' }}>{currency(liveItem.bricklinkActive)}</div>
                      {liveItem.bricklinkActiveMedian != null && <div style={{ fontSize: 11, color: 'var(--text2)' }}>med <span style={{ color: 'var(--purple)' }}>{currency(liveItem.bricklinkActiveMedian)}</span></div>}
                      {liveItem.bricklinkActiveQty != null && <div style={{ fontSize: 11, color: 'var(--text2)' }}>{liveItem.bricklinkActiveQty} listings</div>}
                    </>
                  : <div style={{ color: 'var(--text3)', fontSize: 13 }}>—</div>}
              </div>
              {/* eBay */}
              {item.type !== 'part' && (
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.4px' }}>eBay Active</div>
                  {liveItem.ebayPrice != null
                    ? <>
                        <div style={{ fontWeight: 600, color: 'var(--orange)' }}>{currency(liveItem.ebayPrice)}</div>
                        <div style={{ fontSize: 10, color: 'var(--text2)' }}>{liveItem.ebayPlusShipping ? 'plus shipping' : 'incl. shipping'}</div>
                      </>
                    : <div style={{ color: 'var(--text3)', fontSize: 13 }}>—</div>}
                </div>
              )}
              {/* Sparkline */}
              {liveItem.priceHistory?.length >= 2 && (
                <div style={{ marginLeft: 'auto' }}>
                  <Sparkline history={liveItem.priceHistory} width={140} height={44} />
                </div>
              )}
            </div>
            {/* External links */}
            <div className="price-links" style={{ marginTop: 12, flexWrap: 'wrap', gap: 4 }}>
              <a className="price-link bl" href={bricklinkPriceUrl(liveItem)} target="_blank" rel="noopener">BL Sold</a>
              <a className="price-link" style={{ background: 'rgba(156,108,231,.15)', color: 'var(--purple)' }} href={bricklinkUrl(liveItem)} target="_blank" rel="noopener">BL Active</a>
              {item.type !== 'part' && (
                <a className="price-link" style={{ background: 'rgba(231,138,76,.15)', color: 'var(--orange)' }}
                  href={(() => {
                    const conditionTerm = item.condition === 'new_sealed' ? 'new sealed' : item.condition === 'new_open' ? 'new open box' : item.condition === 'used_complete' ? 'used' : '';
                    const isCol = /^col/i.test(item.itemNumber);
                    let searchTerm;
                    if (isCol) { let name = item.name || ''; if (name.includes(',')) name = name.split(',')[0].trim(); const parts = [item.itemNumber]; if (item.colMinifigId && item.colMinifigId.toLowerCase() !== item.itemNumber.toLowerCase()) parts.push(item.colMinifigId); if (name) parts.push(name); searchTerm = parts.join(' '); }
                    else if (item.type === 'set') { const n = /^.+-1$/i.test(item.itemNumber) ? item.itemNumber.replace(/-1$/,'') : item.itemNumber; searchTerm = item.name ? `${n} ${item.name}` : n; }
                    else { searchTerm = item.name ? `${item.itemNumber} ${item.name}` : item.itemNumber; }
                    return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`LEGO ${searchTerm}${conditionTerm ? ' ' + conditionTerm : ''}`)}`;
                  })()}
                  target="_blank" rel="noopener">eBay Active</a>
              )}
            </div>
          </div>

          {/* ─── Selling fields ─── */}
          <div className="form-row" style={{ marginBottom: 14 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Status</label>
              <select value={form.sellStatus} onChange={e => set('sellStatus', e.target.value)}>
                <option value="available">Available</option>
                <option value="listed">Listed</option>
                <option value="sold">Sold</option>
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>
                Purchase Price ($)
                {item.retailPrice > 0 && <span style={{ fontWeight: 400, color: 'var(--text2)', marginLeft: 6 }}>(MSRP {currency(item.retailPrice)})</span>}
              </label>
              <input type="number" step="0.01" min="0"
                placeholder={item.retailPrice > 0 ? item.retailPrice.toFixed(2) : '0.00'}
                value={form.purchasePrice}
                onChange={num('purchasePrice')} />
            </div>
          </div>
          <div className="form-row" style={{ marginBottom: 14 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Platform</label>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:6 }}>
                {sellingPlatforms.map(p => {
                  const selected = hasPlatform(form.platform, p);
                  return (
                    <button key={p.id || p.name}
                      type="button"
                      className={`btn btn-sm ${selected ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ fontSize:11, padding:'3px 9px', borderRadius:6 }}
                      onClick={() => togglePlatform(p)}
                      title={`${selected ? 'Remove' : 'Add'} ${p.name}`}>
                      {p.name}
                    </button>
                  );
                })}
              </div>
              <input placeholder="Other platform..." value={form.platform} onChange={e => set('platform', e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>{form.sellStatus === 'sold' ? 'Sale Price ($)' : 'Default List Price ($)'}</label>
              <input type="number" step="0.01" min="0" placeholder="0.00"
                value={form.sellStatus === 'sold' ? form.salePrice : form.listPrice}
                onChange={form.sellStatus === 'sold'
                  ? num('salePrice')
                  : ((e) => { setListPriceTouched(true); num('listPrice')(e); })} />
            </div>
          </div>

          {form.sellStatus !== 'sold' && (
            <div className="form-row" style={{ marginBottom: 14 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Desired Profit ($)</label>
                <input type="number" step="0.01" min="0" placeholder="Target total profit"
                  value={form.desiredProfit}
                  onChange={num('desiredProfit')} />
              </div>
            </div>
          )}

          {(form.sellStatus === 'sold' || form.sellStatus === 'listed') && (
            <div className="form-row" style={{ marginBottom: 14 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Fees ($)</label>
                <input type="number" step="0.01" min="0" placeholder="0.00" value={form.fees} onChange={num('fees')} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Shipping Cost ($)</label>
                <input type="number" step="0.01" min="0" placeholder="0.00" value={form.shippingCost} onChange={num('shippingCost')} />
              </div>
            </div>
          )}

          <div className="form-group" style={{ marginBottom: 14 }}>
            <label>Notes</label>
            <textarea rows="2" placeholder="Any notes…" value={form.notes} onChange={e => set('notes', e.target.value)} />
          </div>

          {/* Profit summary */}
          {form.sellStatus === 'sold' && expectedProfit !== null && (
            <div style={{ fontSize: 13, color: expectedProfit >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600, textAlign: 'right', marginBottom: 4 }}>
              Net profit: {currency(expectedProfit)}
            </div>
          )}

          {/* Platform profit breakdown — shown when not sold and there's a list price or desired profit */}
          {form.sellStatus !== 'sold' && (listP > 0 || desiredProfit != null) && (() => {
            const platforms = sellingPlatforms;
            if (!platforms.length) return null;
            return (
              <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', marginBottom: 4 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>Expected Profit by Platform</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px auto auto', gap: '5px 10px', alignItems: 'center' }}>
                  {/* Header */}
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>Platform</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'right' }}>List Price</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'right' }}>Needed</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'right' }}>Fees</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'right' }}>Profit</div>
                  {platforms.map(p => {
                    const rowPrice     = parseFloat(platformListPrice(p)) || 0;
                    const neededPrice  = requiredListPriceForProfit(p, desiredProfit, cost, qty);
                    const platformFees = rowPrice > 0 ? (rowPrice * qty * (p.pctFee || 0) / 100) + (p.flatFee || 0) : 0;
                    const netSale      = rowPrice * qty - platformFees;
                    const profit       = netSale - cost;
                    const isSelected   = hasPlatform(form.platform, p);
                    return (
                      <React.Fragment key={p.id}>
                        <div style={{ fontSize: 13, fontWeight: isSelected ? 700 : 400, color: isSelected ? 'var(--accent)' : 'var(--text)' }}>
                          {p.name}{isSelected ? ' ✓' : ''}
                        </div>
                        <input type="number" step="0.01" min="0"
                          value={form.platformPrices?.[platformKey(p)] ?? defaultListPrice()}
                          placeholder={defaultListPrice() || '0.00'}
                          onChange={e => setPlatformListPrice(p, e.target.value)}
                          style={{ width: 90, fontSize: 12, padding: '3px 6px', textAlign: 'right' }} />
                        <div style={{ fontSize: 12, textAlign: 'right', color: neededPrice != null ? 'var(--accent)' : 'var(--text3)' }}>
                          {neededPrice != null ? (
                            <button className="btn btn-secondary btn-sm"
                              style={{ fontSize: 11, padding: '2px 6px' }}
                              onClick={() => setPlatformListPrice(p, neededPrice.toFixed(2))}
                              title={`Use ${currency(neededPrice)} for ${p.name}`}>
                              {currency(neededPrice)}
                            </button>
                          ) : '—'}
                        </div>
                        <div style={{ fontSize: 13, textAlign: 'right', color: 'var(--text2)' }}>{currency(platformFees)}</div>
                        <div style={{ fontSize: 13, textAlign: 'right', fontWeight: 600, color: rowPrice > 0 && profit >= 0 ? 'var(--green)' : rowPrice > 0 ? 'var(--red)' : 'var(--text3)' }}>
                          {currency(profit)}
                          {cost > 0 && <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 5, opacity: 0.8 }}>({(profit / cost * 100).toFixed(0)}%)</span>}
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* ─── BrickLink store listing ─── */}
          {blConfigured && item.itemNumber && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.5px' }}>BrickLink Store</div>

                {/* Idle — show the button */}
                {blListState === 'idle' && (
                  <button className="btn btn-secondary btn-sm"
                    style={{ fontSize: 11, padding: '3px 10px', display: 'flex', alignItems: 'center', gap: 5 }}
                    title="Check your BrickLink store, then confirm before creating a listing"
                    onClick={checkAndListOnBrickLink}>
                    🏪 Check BrickLink
                  </button>
                )}

                {/* Checking */}
                {blListState === 'checking' && (
                  <span style={{ fontSize: 11, color: 'var(--text2)' }}>🔄 Checking store…</span>
                )}

                {/* Already listed */}
                {blListState === 'already_listed' && blExisting && (
                  <>
                    <span style={{ fontSize: 11, color: 'var(--orange)', fontWeight: 600 }}>
                      Already listed — {blExisting.quantity} × {currency(blExisting.price)} ({blExisting.condition === 'N' ? 'New' : 'Used'})
                    </span>
                    <a href={`https://www.bricklink.com/inventory.asp`} target="_blank" rel="noopener"
                      style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>
                      View store ↗
                    </a>
                    <button className="btn btn-secondary btn-sm" style={{ fontSize: 11, padding: '2px 8px', marginLeft: 'auto' }}
                      onClick={() => setBlListState('idle')}>
                      Dismiss
                    </button>
                  </>
                )}

                {/* Ready to list — price input + confirm */}
                {blListState === 'ready' && (
                  <>
                    <span style={{ fontSize: 12, color: 'var(--text)' }}>Price:</span>
                    <input
                      type="number" step="0.01" min="0"
                      value={blListPrice}
                      onChange={e => { setBlListPriceTouched(true); setBlListPrice(e.target.value); }}
                      style={{ width: 80, fontSize: 12, padding: '3px 6px', textAlign: 'right' }}
                      autoFocus
                    />
                    <button className="btn btn-primary btn-sm"
                      style={{ fontSize: 11, padding: '3px 10px' }}
                      onClick={confirmListOnBrickLink}>
                      Confirm &amp; List
                    </button>
                    <button className="btn btn-secondary btn-sm"
                      style={{ fontSize: 11, padding: '3px 8px' }}
                      onClick={() => setBlListState('idle')}>
                      Cancel
                    </button>
                    <div style={{ width: '100%', fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                      Will create a {(item.condition === 'new_sealed' || item.condition === 'new_open') ? 'New' : 'Used'} listing for {item.quantity || 1} × {item.itemNumber}.
                    </div>
                  </>
                )}

                {/* Listing in progress */}
                {blListState === 'listing' && (
                  <span style={{ fontSize: 11, color: 'var(--text2)' }}>🔄 Creating listing…</span>
                )}

                {/* Done */}
                {blListState === 'done' && (
                  <>
                    <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>✓ {blListMsg}</span>
                    <a href="https://www.bricklink.com/inventory.asp" target="_blank" rel="noopener"
                      style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>
                      View store ↗
                    </a>
                  </>
                )}

                {/* Error */}
                {blListState === 'error' && (
                  <>
                    <span style={{ fontSize: 11, color: 'var(--red)', fontWeight: 600 }}>⚠ {blListMsg}</span>
                    <button className="btn btn-secondary btn-sm" style={{ fontSize: 11, padding: '2px 8px' }}
                      onClick={() => setBlListState('idle')}>
                      Retry
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Sell button (listed items) */}
          {form.sellStatus === 'listed' && setSellItem && (
            <div style={{ textAlign: 'right', marginBottom: 4 }}>
              <button className="btn btn-danger btn-sm"
                onClick={() => { onClose(); setSellItem(item); }}>
                Record Sale
              </button>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}
