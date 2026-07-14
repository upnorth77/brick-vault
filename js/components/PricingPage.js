// ─── Sparkline SVG ───
function Sparkline({ history, width = 120, height = 36 }) {
  if (!history || history.length < 2) {
    return React.createElement('span', { style: { color: 'var(--text3)', fontSize: 11 } }, '—');
  }

  const blPts  = history.map(h => h.blPrice).filter(v => v != null && !isNaN(v));
  const ebPts  = history.map(h => h.ebayPrice).filter(v => v != null && !isNaN(v));
  const allPts = [...blPts, ...ebPts];
  if (allPts.length < 2) {
    return React.createElement('span', { style: { color: 'var(--text3)', fontSize: 11 } }, '—');
  }

  const minY = Math.min(...allPts), maxY = Math.max(...allPts);
  const rangeY = maxY - minY || 1;
  const pad = 4;
  const toX = (i, total) => pad + (i / (total - 1)) * (width - pad * 2);
  const toY = (v) => pad + (1 - (v - minY) / rangeY) * (height - pad * 2);

  const makePath = (points) => {
    const valid = points.map((v, i) => v != null && !isNaN(v) ? [i, v] : null).filter(Boolean);
    if (valid.length < 2) return null;
    return valid.map(([i, v], idx) => `${idx === 0 ? 'M' : 'L'} ${toX(i, history.length).toFixed(1)} ${toY(v).toFixed(1)}`).join(' ');
  };

  const blPath = makePath(history.map(h => h.blPrice));
  const ebPath = makePath(history.map(h => h.ebayPrice));
  const lastBl = history[history.length - 1].blPrice;
  const lastEb = history[history.length - 1].ebayPrice;

  return React.createElement('svg', { width, height, style: { display: 'block', overflow: 'visible' } },
    blPath && React.createElement('path', { d: blPath, fill: 'none', stroke: 'var(--blue)', strokeWidth: 1.5, strokeLinejoin: 'round', strokeLinecap: 'round' }),
    ebPath && React.createElement('path', { d: ebPath, fill: 'none', stroke: 'var(--orange)',  strokeWidth: 1.5, strokeLinejoin: 'round', strokeLinecap: 'round' }),
    lastBl != null && React.createElement('circle', { cx: toX(history.length - 1, history.length), cy: toY(lastBl), r: 2.5, fill: 'var(--blue)' }),
    lastEb != null && React.createElement('circle', { cx: toX(history.length - 1, history.length), cy: toY(lastEb), r: 2.5, fill: 'var(--orange)'  })
  );
}

// ─── Price History Modal ───
const PRICE_HISTORY_COLS = [
  { key: 'blPrice',       label: 'BL Sold Avg',    color: 'var(--blue)'   },
  { key: 'blMedian',      label: 'BL Sold Med',    color: 'var(--blue)'   },
  { key: 'blActivePrice', label: 'BL Active Avg',  color: 'var(--purple)' },
  { key: 'blActiveMedian',label: 'BL Active Med',  color: 'var(--purple)' },
  { key: 'ebayPrice',     label: 'eBay Active Avg', color: 'var(--orange)' },
];

function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Map focusField → which snapshot key holds lot detail
const SNAPSHOT_KEY_MAP = {
  blPrice:        'bl',
  blMedian:       'bl',
  blActivePrice:  'blActive',
  blActiveMedian: 'blActive',
  ebayPrice:      'ebay',
};

function PriceHistoryModal({ item, focusField, onClose, updateItems }) {
  const history = item.priceHistory || [];

  // Chart uses the focused field if set, otherwise blPrice
  const chartKey = focusField || 'blPrice';
  const chartCol = PRICE_HISTORY_COLS.find(c => c.key === chartKey) || PRICE_HISTORY_COLS[0];

  // Find the most recent weekly snapshot that has lot detail for the focused guide
  const snapshotGuideKey = SNAPSHOT_KEY_MAP[focusField];
  const latestSnapshot = React.useMemo(() => {
    if (!snapshotGuideKey || !item.priceSnapshots) return null;
    const entries = Object.values(item.priceSnapshots)
      .filter(s => {
        const d = s[snapshotGuideKey];
        return d?.lots?.length || d?.listings?.length;
      })
      .sort((a, b) => (b.date > a.date ? 1 : -1));
    return entries[0] || null;
  }, [item.priceSnapshots, snapshotGuideKey, focusField]);

  // For BL guides use 'lots', for eBay use 'listings' — both signal "has detail data"
  const lots = latestSnapshot?.[snapshotGuideKey]?.lots || latestSnapshot?.[snapshotGuideKey]?.listings || null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: lots ? (snapshotGuideKey === 'ebay' ? 960 : 860) : 700, maxHeight: '85vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Price History — {item.name || item.itemNumber}</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {history.length === 0
            ? <p style={{ color: 'var(--text2)' }}>No price history recorded yet. Use "Fetch Prices" to pull live data from BrickLink and eBay.</p>
            : <>
                {/* Chart */}
                <div style={{ marginBottom: 16 }}>
                  <svg width="100%" height="120" viewBox="0 0 640 120" style={{ display: 'block' }}>
                    {(() => {
                      const allPts = PRICE_HISTORY_COLS.flatMap(c => history.map(h => h[c.key])).filter(v => v != null && !isNaN(v));
                      if (allPts.length < 2) return null;
                      const minY = Math.min(...allPts), maxY = Math.max(...allPts);
                      const rangeY = maxY - minY || 1;
                      const W = 640, H = 120, pad = 12;
                      const toX = (i) => pad + (i / (history.length - 1)) * (W - pad * 2);
                      const toY = (v) => pad + (1 - (v - minY) / rangeY) * (H - pad * 2);
                      const makePath = (key) => {
                        const valid = history.map((h, i) => h[key] != null && !isNaN(h[key]) ? [i, h[key]] : null).filter(Boolean);
                        if (valid.length < 2) return null;
                        return valid.map(([i, v], idx) => `${idx === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(v).toFixed(1)}`).join(' ');
                      };
                      return React.createElement(React.Fragment, null,
                        PRICE_HISTORY_COLS.map(col => {
                          const p = makePath(col.key);
                          const isFocus = col.key === chartKey;
                          return p && React.createElement('path', { key: col.key, d: p, fill: 'none', stroke: col.color, strokeWidth: isFocus ? 2.5 : 1, strokeOpacity: isFocus ? 1 : 0.3, strokeDasharray: col.key.includes('Median') ? '4 3' : undefined, strokeLinejoin: 'round', strokeLinecap: 'round' });
                        }),
                        history.map((h, i) => h[chartKey] != null && React.createElement('circle', { key: i, cx: toX(i), cy: toY(h[chartKey]), r: 3, fill: chartCol.color }))
                      );
                    })()}
                  </svg>
                  <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text2)', justifyContent: 'center', marginTop: 4, flexWrap: 'wrap' }}>
                    {PRICE_HISTORY_COLS.map(col => (
                      <span key={col.key} style={{ color: col.key === chartKey ? col.color : 'var(--text2)', fontWeight: col.key === chartKey ? 600 : undefined }}>
                        {col.key.includes('Median') ? '-- ' : '— '}{col.label}
                      </span>
                    ))}
                  </div>
                </div>

                {/* History Table */}
                <div style={{ overflowX: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Date &amp; Time</th>
                        {PRICE_HISTORY_COLS.map(col => (
                          <th key={col.key} style={{ color: col.key === focusField ? col.color : undefined }}>{col.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...history].reverse().map((h, i) => (
                        <tr key={i}>
                          <td style={{ color: 'var(--text2)', fontSize: 12, whiteSpace: 'nowrap' }}>{formatDateTime(h.date)}</td>
                          {PRICE_HISTORY_COLS.map(col => (
                            <td key={col.key} style={{ color: h[col.key] != null ? col.color : 'var(--text2)', fontWeight: h[col.key] != null ? 600 : undefined, background: col.key === focusField ? 'rgba(255,255,255,0.04)' : undefined }}>
                              {currency(h[col.key])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Lot Detail — BL Sold / BL Active */}
                {lots && snapshotGuideKey !== 'ebay' && (() => {
                  const guideLabel = snapshotGuideKey === 'bl' ? 'BL Sold' : 'BL Active';
                  const guideColor = snapshotGuideKey === 'bl' ? 'var(--blue)' : 'var(--purple)';
                  const ignoredField = snapshotGuideKey === 'bl' ? 'blIgnoredPrices' : 'blActiveIgnoredPrices';
                  const priceField   = snapshotGuideKey === 'bl' ? 'bricklinkPrice'  : 'bricklinkActive';
                  const medianField  = snapshotGuideKey === 'bl' ? 'bricklinkMedian' : 'bricklinkActiveMedian';
                  const snap = latestSnapshot[snapshotGuideKey];
                  const sorted = [...lots].sort((a, b) => b.unit_price - a.unit_price);

                  // Ignored prices stored as a Set of unit_price strings (rounded to 4dp for stability)
                  const ignoredPrices = new Set((item[ignoredField] || []).map(p => p.toFixed(4)));

                  const toggleIgnore = (unit_price) => {
                    if (!updateItems) return;
                    updateItems(prev => prev.map(it => {
                      if (it.id !== item.id) return it;
                      const ignored = new Set((it[ignoredField] || []).map(p => p.toFixed(4)));
                      const key = unit_price.toFixed(4);
                      if (ignored.has(key)) ignored.delete(key);
                      else ignored.add(key);
                      const newIgnored = [...ignored].map(Number);

                      // Recompute avg + median from latest snapshot lots, excluding ignored prices
                      const snapLots = (it.priceSnapshots
                        ? Object.values(it.priceSnapshots).sort((a, b) => b.date > a.date ? 1 : -1)[0]?.[snapshotGuideKey]?.lots
                        : null) || [];
                      const expanded = [];
                      for (const lot of snapLots) {
                        if (!ignored.has(lot.unit_price.toFixed(4))) {
                          for (let q = 0; q < lot.quantity; q++) expanded.push(lot.unit_price);
                        }
                      }
                      expanded.sort((a, b) => a - b);
                      const newAvg = expanded.length ? expanded.reduce((s, v) => s + v, 0) / expanded.length : it[priceField];
                      const mid = Math.floor(expanded.length / 2);
                      const newMedian = expanded.length
                        ? (expanded.length % 2 ? expanded[mid] : (expanded[mid - 1] + expanded[mid]) / 2)
                        : it[medianField];

                      return {
                        ...it,
                        [ignoredField]: newIgnored,
                        [priceField]:  expanded.length ? Math.round(newAvg    * 100) / 100 : it[priceField],
                        [medianField]: expanded.length ? Math.round(newMedian * 100) / 100 : it[medianField],
                      };
                    }));
                  };

                  // Live avg/median from non-ignored lots
                  const activeLots = sorted.filter(l => !ignoredPrices.has(l.unit_price.toFixed(4)));
                  const expanded = [];
                  for (const lot of activeLots) for (let q = 0; q < lot.quantity; q++) expanded.push(lot.unit_price);
                  expanded.sort((a, b) => a - b);
                  const liveAvg = expanded.length ? expanded.reduce((s, v) => s + v, 0) / expanded.length : null;
                  const mid = Math.floor(expanded.length / 2);
                  const liveMedian = expanded.length
                    ? (expanded.length % 2 ? expanded[mid] : (expanded[mid - 1] + expanded[mid]) / 2)
                    : null;
                  const totalQty    = sorted.reduce((s, l) => s + l.quantity, 0);
                  const activeQty   = activeLots.reduce((s, l) => s + l.quantity, 0);
                  const ignoredCount = sorted.length - activeLots.length;

                  return (
                    <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: guideColor }}>{guideLabel} — Individual Lots</span>
                        <span style={{ fontSize: 11, color: 'var(--text2)' }}>from {formatDateTime(latestSnapshot.date)}</span>
                        {liveAvg != null && <span style={{ fontSize: 11, color: 'var(--text2)' }}>
                          · avg {currency(liveAvg)} · median {currency(liveMedian)}
                          {ignoredCount > 0 && <span style={{ color: 'var(--orange)', marginLeft: 4 }}>({ignoredCount} ignored)</span>}
                          · {activeQty} of {totalQty} units, {activeLots.length} of {sorted.length} lots
                        </span>}
                      </div>
                      <div style={{ overflowX: 'auto' }}>
                        <table>
                          <thead>
                            <tr>
                              <th style={{ width: 24 }}></th>
                              <th style={{ textAlign: 'right' }}>Qty</th>
                              <th style={{ textAlign: 'right' }}>Unit Price</th>
                              <th style={{ textAlign: 'right' }}>vs Avg</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sorted.map((lot, i) => {
                              const ignored = ignoredPrices.has(lot.unit_price.toFixed(4));
                              const pctOfAvg = liveAvg && !ignored ? ((lot.unit_price / liveAvg - 1) * 100) : null;
                              return (
                                <tr key={i} style={{ opacity: ignored ? 0.4 : 1 }}>
                                  <td style={{ textAlign: 'center' }}>
                                    <input type="checkbox" checked={ignored}
                                      onChange={() => toggleIgnore(lot.unit_price)}
                                      title="Ignore this lot"
                                      style={{ cursor: 'pointer', accentColor: guideColor }} />
                                  </td>
                                  <td style={{ textAlign: 'right', color: 'var(--text2)', textDecoration: ignored ? 'line-through' : undefined }}>{lot.quantity}</td>
                                  <td style={{ textAlign: 'right', fontWeight: 600, color: ignored ? 'var(--text2)' : guideColor, textDecoration: ignored ? 'line-through' : undefined }}>{currency(lot.unit_price)}</td>
                                  <td style={{ textAlign: 'right', fontSize: 11, color: pctOfAvg == null ? 'var(--text2)' : pctOfAvg > 0 ? 'var(--green)' : 'var(--red)' }}>
                                    {pctOfAvg != null ? `${pctOfAvg > 0 ? '+' : ''}${pctOfAvg.toFixed(1)}%` : '\u2014'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr>
                              <td style={{ borderTop: '1px solid var(--border)' }} />
                              <td style={{ textAlign: 'right', fontWeight: 600, borderTop: '1px solid var(--border)', paddingTop: 6 }}>{activeQty}{ignoredCount > 0 ? ` / ${totalQty}` : ''}</td>
                              <td style={{ borderTop: '1px solid var(--border)' }} />
                              <td style={{ borderTop: '1px solid var(--border)' }} />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  );
                })()}

                {/* eBay Listing Detail */}
                {lots && snapshotGuideKey === 'ebay' && (() => {
                  const snap = latestSnapshot['ebay'];
                  const listings = snap?.listings || [];
                  // Use title as stable key — eBay URLs contain session tokens that change between fetches
                  const ignoredTitles = new Set(item.ebayIgnoredUrls || []);
                  const sorted = [...listings].sort((a, b) => a.price - b.price);

                  // Recompute avg from non-ignored listings using shipping rule
                  const activeListings = sorted.filter(l => !ignoredTitles.has(l.title));
                  const liveAvg = ebayAvgFromListings(activeListings);
                  const allFixed = activeListings.every(l => !l.shippingUnknown && l.shippingType !== 'CALCULATED');

                  const toggleIgnore = (title) => {
                    if (!updateItems || !title) return;
                    updateItems(prev => prev.map(it => {
                      if (it.id !== item.id) return it;
                      const ignored = new Set(it.ebayIgnoredUrls || []);
                      if (ignored.has(title)) ignored.delete(title);
                      else ignored.add(title);
                      const newIgnored = [...ignored];
                      // Recompute ebayPrice from latest snapshot listings using shipping rule
                      const snapListings = (it.priceSnapshots
                        ? Object.values(it.priceSnapshots).sort((a,b) => b.date > a.date ? 1 : -1)[0]?.ebay?.listings
                        : null) || [];
                      const activeSnap = snapListings.filter(l => !ignored.has(l.title));
                      const newAllFixed = activeSnap.every(l => !l.shippingUnknown && l.shippingType !== 'CALCULATED');
                      const newAvg = ebayAvgFromListings(activeSnap) ?? it.ebayPrice;
                      return { ...it, ebayIgnoredUrls: newIgnored, ebayPrice: newAvg, ebayPlusShipping: !newAllFixed };
                    }));
                  };

                  return (
                    <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--orange)' }}>eBay Active — Individual Listings</span>
                        <span style={{ fontSize: 11, color: 'var(--text2)' }}>from {formatDateTime(latestSnapshot.date)}</span>
                        {liveAvg != null && <span style={{ fontSize: 11, color: 'var(--text2)' }}>
                          · avg {currency(liveAvg)} ({allFixed ? 'incl. shipping' : 'plus shipping'})
                          {ignoredTitles.size > 0 && <span style={{ color: 'var(--orange)', marginLeft: 4 }}>({ignoredTitles.size} ignored)</span>}
                          · {activeListings.length} of {sorted.length} listings
                        </span>}
                      </div>
                      <div style={{ overflowX: 'auto' }}>
                        <table>
                          <thead>
                            <tr>
                              <th style={{ width: 24 }}></th>
                              <th>Title</th>
                              <th style={{ textAlign: 'right' }}>Price</th>
                              <th style={{ textAlign: 'right' }}>Shipping</th>
                              <th style={{ textAlign: 'right' }}>Total</th>
                              <th style={{ textAlign: 'right' }}>vs Avg</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sorted.map((listing, i) => {
                              const total = listing.total ?? listing.price;
                              const comparablePrice = allFixed ? total : listing.price;
                              const ignored = ignoredTitles.has(listing.title);
                              const pctOfAvg = liveAvg && !ignored ? ((comparablePrice / liveAvg - 1) * 100) : null;
                              return (
                                <tr key={i} style={{ opacity: ignored ? 0.4 : 1 }}>
                                  <td style={{ textAlign: 'center' }}>
                                    <input
                                      type="checkbox"
                                      checked={ignored}
                                      onChange={() => toggleIgnore(listing.title)}
                                      title="Ignore this listing"
                                      style={{ cursor: 'pointer', accentColor: 'var(--orange)' }} />
                                  </td>
                                  <td style={{ fontSize: 12, maxWidth: 320 }}>
                                    {listing.url
                                      ? <a href={listing.url} target="_blank" rel="noopener" style={{ color: ignored ? 'var(--text2)' : 'var(--accent)', textDecoration: ignored ? 'line-through' : 'none' }}>{listing.title}</a>
                                      : listing.title}
                                  </td>
                                  <td style={{ textAlign: 'right', color: 'var(--text2)', whiteSpace: 'nowrap', fontSize: 12 }}>{currency(listing.price)}</td>
                                  <td style={{ textAlign: 'right', color: 'var(--text2)', whiteSpace: 'nowrap', fontSize: 12 }}>
                                    {listing.shippingUnknown || listing.shippingType === 'CALCULATED'
                                      ? <span style={{ color: 'var(--text3)' }} title="Calculated shipping — cost varies by location">calc.</span>
                                      : listing.shipping === 0 && listing.shippingType !== 'FREE'
                                        ? <span style={{ color: 'var(--green)' }}>Free</span>
                                        : listing.shipping > 0
                                          ? currency(listing.shipping)
                                          : <span style={{ color: 'var(--text3)' }}>—</span>}
                                  </td>
                                  <td style={{ textAlign: 'right', fontWeight: 600, color: ignored ? 'var(--text2)' : 'var(--orange)', whiteSpace: 'nowrap' }}>{currency(total)}</td>
                                  <td style={{ textAlign: 'right', fontSize: 11, whiteSpace: 'nowrap', color: pctOfAvg == null ? 'var(--text2)' : pctOfAvg > 0 ? 'var(--green)' : 'var(--red)' }}>
                                    {pctOfAvg != null ? `${pctOfAvg > 0 ? '+' : ''}${pctOfAvg.toFixed(1)}%` : '\u2014'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}
              </>
          }
        </div>
      </div>
    </div>
  );
}

// ─── Trend helper ───
// Returns { pct, color } comparing the two most recent history entries for a given price key.
// Up = red (bad, price rising), down = green (good, price falling).
// Brightness scales with magnitude: caps at full color at 20% change.
// trend() and suggestedPrice() are defined in data.js (shared)

// ─── API fetch helpers ───
// Map inventory condition to BrickLink's N/U parameter
function blCondition(item) {
  return (item.condition === 'new_sealed' || item.condition === 'new_open') ? 'N' : 'U';
}

async function fetchWithTimeout(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    return resp;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Request timed out');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Fetches both sold and active price guides in a single round-trip.
// Returns { sold, active } — either may be null if that guide had no data.
async function fetchBLPrices(item, countryCode) {
  const typeMap = { set: 'set', minifig: 'minifig', part: 'part' };
  const params = new URLSearchParams({
    type:           typeMap[item.type] || 'set',
    itemNumber:     item.itemNumber,
    newOrUsed:      blCondition(item),
    filterOutliers: 'true',
    countryCode:    countryCode || 'US',
  });
  if (item.blColorId) params.set('colorId', item.blColorId);
  const resp = await fetchWithTimeout(`/api/bricklink/prices?${params}`);
  const data = await resp.json();
  if (!resp.ok || data.error) throw new Error(data.error || 'BrickLink price error');
  return data; // { sold: { avg, median, ... }, active: { avg, median, ... }, soldError, activeError }
}

async function fetchEbayPrice(item, options = {}) {
  const batchMode = !!options.batch;
  if (item.type === 'part') return null; // don't search eBay for parts
  const conditionTerm = item.condition === 'new_sealed'      ? 'new sealed'
                      : item.condition === 'new_open'        ? 'new open box'
                      : item.condition === 'used_complete'   ? 'used'
                      : item.condition === 'used_incomplete' ? 'used incomplete'
                      : '';
  let searchTerm;
  const isCol = /^col/i.test(item.itemNumber);
  if (isCol) {
    // Collectible minifigs (col*): include the col series number, the name, and the actual
    // minifig item number from the subset (e.g. col001) since eBay sellers use both formats.
    // e.g. "Deep Sea Diver, Series 1" → "LEGO col01-15 col001 Deep Sea Diver"
    let name = item.name || '';
    if (name.includes(',')) name = name.split(',')[0].trim();
    // Try to fetch the minifig item number from subsets for manual fetches.
    // During batch runs this extra request is expensive and usually not worth it.
    let minifigId = '';
    if (!batchMode) {
      try {
        const subParams = new URLSearchParams({ itemNumber: item.itemNumber });
        const subResp = await fetchWithTimeout(`/api/bricklink/subsets?${subParams}`, 8000);
        const subData = await subResp.json();
        if (subResp.ok && subData.minifigs?.length > 0) {
          minifigId = subData.minifigs[0].itemNumber; // e.g. "col001"
        }
      } catch(e) { /* subset lookup failed — proceed without it */ }
    }
    const parts = [item.itemNumber];
    if (minifigId && minifigId.toLowerCase() !== item.itemNumber.toLowerCase()) parts.push(minifigId);
    if (name) parts.push(name);
    searchTerm = parts.join(' ');
    // Tag result so caller can persist the resolved minifig ID
    const q2 = `LEGO ${searchTerm}${conditionTerm ? ' ' + conditionTerm : ''}`.trim();
    const params2 = new URLSearchParams({ query: q2, limit: '10' });
    const resp2 = await fetchWithTimeout(`/api/ebay/price?${params2}`);
    const data2 = await resp2.json();
    if (!resp2.ok || data2.error) throw new Error(data2.error || 'eBay price error');
    data2._colMinifigId = minifigId || null;
    return data2;
  } else if (item.type === 'set') {
    // Sets: include set number (strip trailing -1) + name.
    const itemNum = /^.+-1$/i.test(item.itemNumber)
      ? item.itemNumber.replace(/-1$/, '')
      : item.itemNumber;
    searchTerm = item.name ? `${itemNum} ${item.name}` : itemNum;
  } else {
    // Minifigs/parts: include both the BrickLink ID and name for specificity.
    searchTerm = item.name ? `${item.itemNumber} ${item.name}` : item.itemNumber;
  }
  const q = `LEGO ${searchTerm}${conditionTerm ? ' ' + conditionTerm : ''}`.trim();
  const params = new URLSearchParams({ query: q, limit: '10' });
  const resp = await fetchWithTimeout(`/api/ebay/price?${params}`);
  const data = await resp.json();
  if (!resp.ok || data.error) throw new Error(data.error || 'eBay price error');
  return data; // { avg, avgItemOnly, hasCalculated, min, max, count, items }
}

// Returns ISO year-week string e.g. "2026-W15" for the current date.
function isoWeekKey(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ─── Main Page ───
function PricingPage({ items, updateItems, blConfigured, ebayConfigured, settings, setEditItem, setModal, initialSearch,
    priceBatchStatus, setPriceBatchStatus, priceBatchProgress, priceBatchCounts, priceBatchCurrent,
    fetchAllPrices, resumePriceFetch, discardPriceBatch, cancelPriceFetch, priceFetcherRef }) {
  const [search,      setSearch]      = React.useState(initialSearch || '');
  const [warningFilter, setWarningFilter] = React.useState('all');
  const [sortCol, setSortCol] = React.useState('item');
  const [sortDir, setSortDir] = React.useState('asc');
  const [lookupType,  setLookupType]  = React.useState('set');
  const [lookupId,    setLookupId]    = React.useState('');
  const [historyItem,  setHistoryItem]  = React.useState(null);
  const [historyField, setHistoryField] = React.useState(null);
  const [collapsedGroups, setCollapsedGroups] = React.useState({});
  const [selectedIds, setSelectedIds] = React.useState(() => new Set());
  const typeColumn  = !!settings?.typeColumn;
  const blIdColumn  = !!settings?.blIdColumn;
  const colorColumn = !!settings?.colorColumn;
  const dateAddedColumn = !!settings?.dateAddedColumn;
  // Price Guide values are intentionally US-only for both sold sales and active listings.
  const blCountryCode = 'US';

  // Per-item fetch state: itemId → { status: 'idle'|'fetching'|'done'|'error', message }
  const [fetchState, setFetchState]   = React.useState({});
  // Per-item BrickLink listing state: itemId → { status: 'listing'|'done'|'error', message }
  const [blListState, setBlListState] = React.useState({});

  // Whether batch price fetches should also update eBay listings
  const [updateEbay, setUpdateEbay] = React.useState(true);
  const updateEbayRef = React.useRef(true);
  React.useEffect(() => { updateEbayRef.current = updateEbay; }, [updateEbay]);

  const batchRunning = priceBatchStatus === 'running';

  // BL store price update
  const [blUpdateItem,  setBlUpdateItem]  = React.useState(null); // item being updated
  const [blUpdateState, setBlUpdateState] = React.useState(null); // { loading, inventories, error, updating, done }

  const openBlUpdate = React.useCallback(async (item) => {
    const newPrice = item.listPrice || suggestedPrice(item);
    if (!newPrice) { alert('No list price or suggested price available for this item.'); return; }
    setBlUpdateItem(item);
    setBlUpdateState({ loading: true });
    try {
      const params = new URLSearchParams({ type: item.type, itemNumber: item.itemNumber });
      if (item.blColorId) params.set('colorId', item.blColorId);
      const resp = await fetch(`/api/bricklink/store/inventory?${params}`);
      const data = await resp.json();
      if (!resp.ok || data.error) { setBlUpdateState({ error: data.error || 'Failed to fetch store inventory' }); return; }
      setBlUpdateState({ loading: false, inventories: data.inventories, newPrice });
    } catch(e) {
      setBlUpdateState({ error: e.message });
    }
  }, []);

  const confirmBlUpdate = React.useCallback(async (inventoryId, newPrice) => {
    setBlUpdateState(prev => ({ ...prev, updating: true }));
    try {
      const resp = await fetch('/api/bricklink/store/update-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inventory_id: inventoryId, price: newPrice }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) { setBlUpdateState(prev => ({ ...prev, updating: false, error: data.error || 'Update failed' })); return; }
      setBlUpdateState(prev => ({ ...prev, updating: false, done: true }));
    } catch(e) {
      setBlUpdateState(prev => ({ ...prev, updating: false, error: e.message }));
    }
  }, []);

  const listOnBrickLinkAtSuggested = React.useCallback(async (item) => {
    const price = suggestedPrice(item);
    if (!price || price <= 0) { alert('Fetch prices first so this item has a suggested price.'); return; }
    if (!item.itemNumber) return;
    if (!confirm(`List ${item.itemNumber} on BrickLink for ${currency(price)}?`)) return;

    const typeMap = { set: 'SET', minifig: 'MINIFIG', part: 'PART' };
    const itemType = typeMap[item.type] || 'SET';
    const condition = (item.condition === 'new_sealed' || item.condition === 'new_open') ? 'N' : 'U';
    const completeness = item.type === 'set'
      ? (item.condition === 'new_sealed' ? 'S' : 'C')
      : undefined;

    setBlListState(prev => ({ ...prev, [item.id]: { status: 'listing', message: '' } }));
    try {
      const resp = await fetch('/api/bricklink/store/create-listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_type:   itemType,
          item_number: item.itemNumber,
          color_id:    item.blColorId || '',
          quantity:    item.quantity || 1,
          price,
          condition,
          completeness,
          description: item.name || '',
          remarks:     item.notes || '',
        }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        setBlListState(prev => ({ ...prev, [item.id]: { status: 'error', message: data.error || 'Failed to create BrickLink listing.' } }));
        return;
      }

      updateItems(prev => prev.map(it => {
        if (it.id !== item.id) return it;
        const platforms = String(it.platform || '')
          .split(/[,/;+]/)
          .map(p => p.trim())
          .filter(Boolean);
        const hasBrickLink = platforms.some(p => p.toLowerCase().replace(/\s+/g, '') === 'bricklink' || p.toLowerCase() === 'bl');
        return {
          ...it,
          sellStatus: 'listed',
          platform: hasBrickLink ? platforms.join(', ') : [...platforms, 'BrickLink'].join(', '),
          listPrice: it.listPrice || price,
          platformPrices: {
            ...(it.platformPrices || {}),
            bricklink: price,
          },
          bricklinkInventoryId: data.inventory_id || it.bricklinkInventoryId,
          updatedAt: new Date().toISOString(),
        };
      }));
      setBlListState(prev => ({ ...prev, [item.id]: { status: 'done', message: `Listed on BrickLink${data.inventory_id ? ` (ID ${data.inventory_id})` : ''}` } }));
    } catch(e) {
      setBlListState(prev => ({ ...prev, [item.id]: { status: 'error', message: e.message } }));
    }
  }, [updateItems]);

  const updateBrickLinkToSuggested = React.useCallback(async (item) => {
    const price = suggestedPrice(item);
    if (!price || price <= 0) { alert('Fetch prices first so this item has a suggested price.'); return; }

    setBlListState(prev => ({ ...prev, [item.id]: { status: 'listing', message: '' } }));
    try {
      let inventoryId = item.bricklinkInventoryId;

      if (!inventoryId) {
        const params = new URLSearchParams({ type: item.type || 'set', itemNumber: item.itemNumber });
        if (item.blColorId) params.set('colorId', item.blColorId);
        const invResp = await fetch(`/api/bricklink/store/inventory?${params}`);
        const invData = await invResp.json();
        if (!invResp.ok || invData.error) throw new Error(invData.error || 'Could not find BrickLink store listing.');
        inventoryId = invData.inventories?.[0]?.inventory_id;
        if (!inventoryId) throw new Error('No matching BrickLink store listing found.');
      }

      const resp = await fetch('/api/bricklink/store/update-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inventory_id: inventoryId, price }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error || 'BrickLink price update failed.');

      updateItems(prev => prev.map(it => it.id === item.id ? {
        ...it,
        sellStatus: 'listed',
        platform: String(it.platform || '').toLowerCase().replace(/\s+/g, '').includes('bricklink')
          ? it.platform
          : [it.platform, 'BrickLink'].filter(Boolean).join(', '),
        listPrice: price,
        platformPrices: {
          ...(it.platformPrices || {}),
          bricklink: price,
        },
        bricklinkInventoryId: inventoryId,
        updatedAt: new Date().toISOString(),
      } : it));

      setBlListState(prev => ({ ...prev, [item.id]: { status: 'done', message: `BrickLink updated to ${currency(price)}` } }));
    } catch(e) {
      setBlListState(prev => ({ ...prev, [item.id]: { status: 'error', message: e.message } }));
    }
  }, [updateItems]);

  const quickLookupUrl = (id, type) => {
    if (!id) return null;
    if (type === 'set')     return `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${encodeURIComponent(id)}#T=P`;
    if (type === 'minifig') return `https://www.bricklink.com/v2/catalog/catalogitem.page?M=${encodeURIComponent(id)}#T=P`;
    return `https://www.bricklink.com/v2/catalog/catalogitem.page?P=${encodeURIComponent(id)}#T=P`;
  };

  // Quick Lookup live fetch state
  const [lookupFetchState, setLookupFetchState] = React.useState('idle'); // 'idle'|'fetching'|'done'|'error'
  const [lookupResult,     setLookupResult]     = React.useState(null);   // { blSold, blSoldMedian, blActive, blActiveMedian, ebay, suggested, name, theme, condition }
  const [lookupCondition,  setLookupCondition]  = React.useState('U');    // 'N' or 'U'

  // Quick Lookup autocomplete state
  const [lookupSuggestions,    setLookupSuggestions]    = React.useState([]);
  const [lookupSugLoading,     setLookupSugLoading]     = React.useState(false);
  const [lookupDropdownOpen,   setLookupDropdownOpen]   = React.useState(false);
  const [lookupActiveSug,      setLookupActiveSug]      = React.useState(-1);
  const lookupInputRef = React.useRef(null);
  const lookupDropdownRef = React.useRef(null);

  // Debounced autocomplete search
  React.useEffect(() => {
    const q = lookupId.trim();
    if (!q || q.length < 2) { setLookupSuggestions([]); setLookupDropdownOpen(false); return; }
    setLookupSugLoading(true);
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, type: lookupType, limit: 8, offset: 0 });
        const resp = await fetch(`/api/catalog/search?${params}`);
        const data = resp.ok ? await resp.json() : { results: [] };
        setLookupSuggestions(data.results || []);
        setLookupDropdownOpen((data.results || []).length > 0);
        setLookupActiveSug(-1);
      } catch(e) { setLookupSuggestions([]); setLookupDropdownOpen(false); }
      setLookupSugLoading(false);
    }, 250);
    return () => clearTimeout(t);
  }, [lookupId, lookupType]);

  // Close dropdown on outside click
  React.useEffect(() => {
    const handler = e => {
      if (lookupDropdownRef.current && !lookupDropdownRef.current.contains(e.target) &&
          lookupInputRef.current && !lookupInputRef.current.contains(e.target)) {
        setLookupDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const runQuickLookup = React.useCallback(async (overrideId) => {
    const id = (overrideId ?? lookupId).trim();
    if (!id) return;
    setLookupFetchState('fetching');
    setLookupResult(null);

    const fakeItem = { id: '__lookup__', type: lookupType, itemNumber: id, condition: lookupCondition === 'N' ? 'new_sealed' : 'used_complete' };
    let blSold = null, blSoldMed = null, blSoldQty = null;
    let blActive = null, blActiveMed = null, blActiveQty = null;
    let ebay = null;
    let catalogName = '', catalogTheme = '';
    let imageUrl = null, yearReleased = null, description = '';
    let pieces = null, retailPrice = null;
    let minifigValue = null;
    const errs = [];

    // 1. Local catalog lookup (name + theme)
    try {
      const bucket = lookupType === 'set' ? 'set' : lookupType === 'minifig' ? 'minifig' : 'part';
      const catResp = await fetch(`/api/catalog/lookup?type=${bucket}&itemNumber=${encodeURIComponent(id)}`);
      const catData = catResp.ok ? await catResp.json() : null;
      if (catData?.found) { catalogName = catData.name; catalogTheme = catData.theme; }
    } catch(e) { /* non-fatal */ }

    // 2. BrickLink catalog API (image, year, description) — if configured
    if (blConfigured) {
      try {
        const blCatParams = new URLSearchParams({ type: lookupType, itemNumber: id });
        const blCatResp = await fetch(`/api/bricklink/catalog?${blCatParams}`);
        const blCatData = blCatResp.ok ? await blCatResp.json() : null;
        if (blCatData && !blCatData.error) {
          if (!catalogName && blCatData.name)  catalogName  = blCatData.name;
          if (!catalogTheme && blCatData.theme) catalogTheme = blCatData.theme;
          imageUrl     = blCatData.imageUrl || blCatData.thumbnailUrl || null;
          yearReleased = blCatData.yearReleased || null;
          description  = blCatData.description || '';
        }
      } catch(e) { /* non-fatal */ }
    }

    // 3. CDN image fallback for sets (no auth needed)
    if (!imageUrl && lookupType === 'set') {
      const bare = id.replace(/-\d+$/, '');
      imageUrl = `https://img.bricklink.com/ItemImage/SN/0/${bare}-1.png`;
    }

    // 4. Minifig value for sets (if BL configured)
    if (blConfigured && lookupType === 'set') {
      try {
        const mfParams = new URLSearchParams({ itemNumber: id, newOrUsed: lookupCondition, countryCode: blCountryCode });
        const mfResp = await fetch(`/api/bricklink/minifig-value?${mfParams}`);
        const mfData = mfResp.ok ? await mfResp.json() : null;
        if (mfData && !mfData.error && mfData.totalValue != null) {
          minifigValue = mfData.totalValue;
        }
      } catch(e) { /* non-fatal */ }
    }

    // 5. Check if this item is already in the local inventory
    const bare = id.replace(/-\d+$/, '');
    const inventoryMatch = items.find(it =>
      it.type === lookupType &&
      (it.itemNumber === id ||
       it.itemNumber === bare ||
       it.itemNumber === bare + '-1' ||
       it.itemNumber?.replace(/-\d+$/, '') === bare)
    ) || null;

    // 6. BL prices (sold + active in one call)
    if (blConfigured) {
      try {
        const bl = await fetchBLPrices(fakeItem, blCountryCode);
        const sold = bl.sold;
        if (sold) {
          blSold    = sold.avg    ?? null;
          blSoldMed = sold.median ?? null;
          blSoldQty = sold.unitQuantity ?? null;
        } else if (bl.soldError) errs.push(`BL sold: ${bl.soldError}`);
        const active = bl.active;
        if (active) {
          blActive    = active.avg    || null;
          blActiveMed = active.median || null;
          blActiveQty = active.unitQuantity ?? null;
        } else if (bl.activeError) errs.push(`BL active: ${bl.activeError}`);
      } catch(e) { errs.push(`BL: ${e.message}`); }
    }

    // 7. eBay
    if (ebayConfigured && lookupType !== 'part') {
      try {
        const eb = await fetchEbayPrice({ ...fakeItem, name: catalogName });
        if (eb) {
          const hasCalc = eb.hasCalculated ?? false;
          ebay = hasCalc ? (eb.avgItemOnly ?? eb.avg ?? null) : (eb.avg ?? null);
        }
      } catch(e) { errs.push(`eBay: ${e.message}`); }
    }

    if (blSold == null && blActive == null && ebay == null) {
      setLookupFetchState('error');
      setLookupResult({ error: errs.join('; ') || 'No data returned', name: catalogName, theme: catalogTheme, imageUrl, yearReleased, pieces, retailPrice, minifigValue, inventoryMatch });
      return;
    }

    // Compute suggested price using the same logic as inventory items
    const syntheticItem = {
      ...fakeItem,
      bricklinkMedian: blSoldMed,
      bricklinkActiveMedian: blActiveMed,
      bricklinkActive: blActive,
      bricklinkPrice: blSold,
      ebayPrice: ebay,
      priceHistory: [],
    };
    const suggested = suggestedPrice(syntheticItem);

    setLookupResult({ blSold, blSoldMed, blSoldQty, blActive, blActiveMed, blActiveQty, ebay, suggested, name: catalogName, theme: catalogTheme, condition: lookupCondition, imageUrl, yearReleased, pieces, retailPrice, minifigValue, inventoryMatch });
    setLookupFetchState('done');
  }, [lookupId, lookupType, lookupCondition, blConfigured, ebayConfigured, blCountryCode, items]);

  const itemHasPricingWarning = React.useCallback((item) => {
    const suggested = suggestedPrice(item);
    const activeQty = item.bricklinkActiveQty ?? null;
    const estimatedSuggested = suggested != null && (activeQty == null || activeQty < 6);

    const ignoredTitles = new Set(item.ebayIgnoredUrls || []);
    const snapListings = item.priceSnapshots
      ? (Object.values(item.priceSnapshots).sort((a, b) => b.date > a.date ? 1 : -1)[0]?.ebay?.listings || [])
      : [];
    const activePrices = snapListings
      .filter(l => !ignoredTitles.has(l.title))
      .map(l => l.total ?? l.price)
      .filter(p => p > 0);
    const activeMin = activePrices.length ? Math.min(...activePrices) : null;
    const activeMax = activePrices.length ? Math.max(...activePrices) : null;
    const wideVariance = activeMin > 0 && activeMax > 0 && (activeMax / activeMin) >= 5;

    return estimatedSuggested || wideVariance;
  }, []);

  const listedSuggestedPct = React.useCallback((item) => {
    const listed = item.sellStatus === 'listed'
      ? (item.platformPrices?.bricklink ?? item.listPrice ?? null)
      : null;
    const suggested = suggestedPrice(item);
    if (listed == null || suggested == null || Number(listed) === 0) return null;
    return ((suggested - listed) / Number(listed)) * 100;
  }, []);

  const filtered = items.filter(i => {
    const matchesSearch = !search || (() => {
      const q = search.toLowerCase();
      return i.name?.toLowerCase().includes(q) || i.itemNumber?.toLowerCase().includes(q) || i.theme?.toLowerCase().includes(q) || (i.keywords || []).some(k => k.toLowerCase().includes(q));
    })();
    if (!matchesSearch) return false;
    if (warningFilter === 'warnings') return itemHasPricingWarning(i);
    return true;
  });

  const sortedFiltered = React.useMemo(() => {
    const getSortValue = (item) => {
      switch (sortCol) {
        case 'type': return item.type || '';
        case 'blid': return item.itemNumber || '';
        case 'item': return item.name || item.itemNumber || '';
        case 'color': return item.color || '';
        case 'listed': return item.sellStatus === 'listed' ? (item.platformPrices?.bricklink ?? item.listPrice ?? null) : null;
        case 'suggested': return suggestedPrice(item);
        case 'listedPct': return listedSuggestedPct(item);
        case 'blSold': return item.bricklinkPrice ?? null;
        case 'blActive': return item.bricklinkActive ?? null;
        case 'ebay': return item.ebayPrice ?? null;
        case 'dateListed': return item.dateListed || null;
        case 'dateAdded': return item.dateAdded || null;
        case 'trend': {
          const t = trend(item.priceHistory, 'blPrice');
          return t?.pct ?? null;
        }
        default: return item.name || item.itemNumber || '';
      }
    };

    return [...filtered].sort((a, b) => {
      let va = getSortValue(a);
      let vb = getSortValue(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filtered, sortCol, sortDir, listedSuggestedPct]);

  const groupedFiltered = React.useMemo(() => groupItemsByTypeCategory(sortedFiltered), [sortedFiltered]);
  const groupKey = (kind, value) => `${kind}:${value || 'blank'}`;
  const toggleGroup = (kind, value) => {
    const key = groupKey(kind, value);
    setCollapsedGroups(prev => ({ ...prev, [key]: !(key in prev ? prev[key] : true) }));
  };
  const expandAll  = () => {
    const all = {};
    groupedFiltered.forEach(tg => {
      all[groupKey('type', tg.type)] = false;
      tg.rows.forEach(({ category }) => { all[groupKey('category', `${tg.type}:${category}`)] = false; });
    });
    setCollapsedGroups(all);
  };
  const collapseAll = () => setCollapsedGroups({});
  const allExpanded = React.useMemo(() => {
    if (!groupedFiltered.length) return false;
    return groupedFiltered.every(tg =>
      collapsedGroups[groupKey('type', tg.type)] === false &&
      tg.rows.every(({ category }) => collapsedGroups[groupKey('category', `${tg.type}:${category}`)] === false)
    );
  }, [groupedFiltered, collapsedGroups]);
  const tableColSpan = 10 + (typeColumn ? 1 : 0) + (blIdColumn ? 1 : 0) + (colorColumn ? 1 : 0) + (dateAddedColumn ? 1 : 0);

  const isFiltered = search || warningFilter !== 'all';

  const effectiveCollapsed = React.useMemo(() => {
    if (isFiltered) return {};
    const defaults = {};
    groupedFiltered.forEach(typeGroup => {
      const typeKey = groupKey('type', typeGroup.type);
      defaults[typeKey] = typeKey in collapsedGroups ? collapsedGroups[typeKey] : true;
      typeGroup.rows.forEach(({ category }) => {
        const catKey = groupKey('category', `${typeGroup.type}:${category}`);
        defaults[catKey] = catKey in collapsedGroups ? collapsedGroups[catKey] : true;
      });
    });
    return defaults;
  }, [isFiltered, groupedFiltered, collapsedGroups]);

  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });

  const selectedItems = React.useMemo(
    () => sortedFiltered.filter(i => selectedIds.has(i.id)),
    [sortedFiltered, selectedIds]
  );

  const fetchSelectedPrices = React.useCallback(async () => {
    if (!selectedItems.length) return;
    // Use the same batch runner from App via priceBatchProps
    if (typeof fetchAllPrices === 'function') {
      // Run only for selected items by temporarily overriding — instead call runPriceBatch via priceFetcherRef
      if (!priceFetcherRef?.current) { alert('Price fetcher not ready — navigate away and back to Price Guide first.'); return; }
      // We'll sequence through selected items ourselves using the registered fetcher
      for (let i = 0; i < selectedItems.length; i++) {
        await priceFetcherRef.current(selectedItems[i], { batch: true });
        if (i < selectedItems.length - 1) await new Promise(r => setTimeout(r, 1500));
      }
    }
  }, [selectedItems, fetchAllPrices, priceFetcherRef]);

  const handleSort = React.useCallback((col) => {
    if (sortCol === col) setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    else {
      setSortCol(col);
      setSortDir('asc');
    }
  }, [sortCol]);

  const SortTH = ({ col, children }) => (
    <th onClick={() => handleSort(col)} style={{ cursor:'pointer', userSelect:'none' }}>
      {children}
      {sortCol === col && <span style={{ marginLeft:4 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );

  // Fetch prices for a single item from BL + eBay and append a history entry
  const fetchPricesForItem = React.useCallback(async (item, options = {}) => {
    if (!item.itemNumber) return;
    const batchMode = !!options.batch;
    setFetchState(prev => ({ ...prev, [item.id]: { status: 'fetching', message: 'Fetching…' } }));

    let blAvg = null, blMedian = null, blSoldQty = null, blActiveAvg = null, blActiveMedian = null, blActiveQty = null, ebayAvg = null;
    let blOutliers = 0, blActiveOutliers = 0;
    let blDetail = null, blActiveDetail = null, ebayDetail = null;
    let blPriceEstimated = null; // null | 'used_from_new' | 'new_from_used'
    let ebayPlusShipping = false;
    let colMinifigId = null; // for col* items: the actual minifig ID returned by subsets
    let newImageUrl    = null; // color-specific image for parts
    let newMinifigValue = null; // total BL value of minifigs in this set
    let newMinifigList  = null; // array of { itemNumber, name, qty, price }
    const errors = [];

    // For parts with a color, fetch the color-specific image from BrickLink catalog
    if (!batchMode && blConfigured && item.type === 'part' && item.blColorId) {
      try {
        const imgParams = new URLSearchParams({ type: 'part', itemNumber: item.itemNumber, colorId: item.blColorId });
        const imgResp = await fetch(`/api/bricklink/catalog?${imgParams}`);
        const imgData = imgResp.ok ? await imgResp.json() : null;
        if (imgData && !imgData.error && imgData.imageUrl) newImageUrl = imgData.imageUrl;
      } catch(e) { /* non-fatal — keep existing image */ }
    }


    // BrickLink and eBay are independent providers — run them concurrently instead
    // of back-to-back so per-item latency is roughly max(BL, eBay) instead of BL + eBay.
    const runBL = async () => {
      if (!blConfigured) return;
      try {
        const bl = await fetchBLPrices(item, blCountryCode);

        // Unpack sold guide
        const sold = bl.sold;
        if (sold) {
          blAvg      = sold.avg          ?? null;
          blMedian   = sold.median       ?? null;
          blSoldQty  = sold.unitQuantity ?? null;
          blOutliers = sold.outliersRemoved ?? 0;
          blDetail   = sold.priceDetail?.length ? { avg: sold.avg, median: sold.median, min: sold.min, max: sold.max, unitQuantity: sold.unitQuantity, lots: sold.priceDetail } : null;
        } else if (bl.soldError) {
          errors.push(`BL sold: ${bl.soldError}`);
        }

        // Unpack active/stock guide
        const active = bl.active;
        if (active) {
          blActiveAvg      = active.avg     || null;  // treat 0 as null (no listings)
          blActiveMedian   = active.median  || null;
          blActiveQty      = active.unitQuantity ?? null;
          blActiveOutliers = active.outliersRemoved ?? 0;
          blActiveDetail   = active.priceDetail?.length ? { avg: active.avg, median: active.median, min: active.min, max: active.max, unitQuantity: active.unitQuantity, lots: active.priceDetail } : null;
        } else if (bl.activeError) {
          errors.push(`BL active: ${bl.activeError}`);
        }
      } catch(e) {
        errors.push(`BL: ${e.message}`);
      }

      // Fallback: if sold returned no data, try the opposite condition and scale
      if (blAvg == null && blConfigured) {
        const isUsed = blCondition(item) === 'U';
        const oppositeCondition = isUsed ? 'N' : 'U';
        try {
          const typeMap = { set: 'set', minifig: 'minifig', part: 'part' };
          const params = new URLSearchParams({
            type:           typeMap[item.type] || 'set',
            itemNumber:     item.itemNumber,
            guide:          'sold',
            newOrUsed:      oppositeCondition,
            filterOutliers: 'true',
            countryCode:    blCountryCode,
          });
          if (item.blColorId) params.set('colorId', item.blColorId);
          const resp = await fetch(`/api/bricklink/price?${params}`);
          const fallback = await resp.json();
          if (resp.ok && !fallback.error && fallback.avg != null) {
            const scale = isUsed ? 0.6 : 1.4;
            blAvg    = fallback.avg    != null ? Math.round(fallback.avg    * scale * 100) / 100 : null;
            blMedian = fallback.median != null ? Math.round(fallback.median * scale * 100) / 100 : null;
            blSoldQty  = fallback.unitQuantity ?? null;
            blOutliers = fallback.outliersRemoved ?? 0;
            blPriceEstimated = isUsed ? 'used_from_new' : 'new_from_used';
          }
        } catch(e) {
          // Fallback failed — leave blAvg as null, no big deal
        }
      }
    };

    const runEbay = async () => {
      if (!(ebayConfigured && item.type !== 'part' && updateEbayRef.current)) return;
      try {
        const eb = await fetchEbayPrice(item, { batch: batchMode });
        if (eb) {
          ebayPlusShipping = eb.hasCalculated ?? false;
          ebayAvg    = ebayPlusShipping ? (eb.avgItemOnly ?? eb.avg ?? null) : (eb.avg ?? null);
          ebayDetail = eb.items?.length ? { min: eb.min, max: eb.max, count: eb.count, listings: eb.items } : null;
          if (eb._colMinifigId) colMinifigId = eb._colMinifigId;
        }
      } catch(e) {
        errors.push(`eBay: ${e.message}`);
      }
    };

    await Promise.all([runBL(), runEbay()]);

    // For sets, minifig-value lookups are one of the slowest calls.
    // Skip them during batch runs and leave that enrichment for focused/manual fetches.
    if (!batchMode && blConfigured && item.type === 'set' && item.itemNumber) {
      try {
        const mvParams = new URLSearchParams({
          itemNumber: item.itemNumber,
          newOrUsed:  blCondition(item),
          countryCode: blCountryCode,
        });
        const mvResp = await fetchWithTimeout(`/api/bricklink/minifig-value?${mvParams}`, 30000);
        const mvData = mvResp.ok ? await mvResp.json() : null;
        if (mvData && !mvData.error && mvData.totalValue != null) {
          newMinifigValue = mvData.totalValue;
          newMinifigList  = mvData.minifigs || null;
        }
      } catch(e) { /* non-fatal */ }
    }

    if (blAvg == null && blMedian == null && blActiveAvg == null && blActiveMedian == null && ebayAvg == null) {
      const message = errors.join('; ') || 'No data returned';
      setFetchState(prev => ({ ...prev, [item.id]: { status: 'error', message } }));
      throw new Error(message);
    }

    const now   = new Date().toISOString();

    // Weekly full snapshot — keyed by ISO week, merged with any existing data for this week
    const weekKey = isoWeekKey(now);
    const hasNewDetail = blDetail || blActiveDetail || ebayDetail;

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

      // Build history entry using the filtered eBay avg so ignored listings don't pollute history
      const entry = { date: now, blPrice: blAvg, blMedian, blActivePrice: blActiveAvg, blActiveMedian, ebayPrice: filteredEbayAvg, source: 'api', ...(blPriceEstimated ? { blPriceEstimated } : {}), ...(filteredEbayPlusShipping ? { ebayPlusShipping: true } : {}) };
      const history = [...(it.priceHistory || []), entry];

      // Merge into existing snapshot for this week — only overwrite keys that have new data
      let snapshots = { ...(it.priceSnapshots || {}) };
      if (hasNewDetail) {
        const existing = snapshots[weekKey] || {};
        snapshots[weekKey] = {
          ...existing,
          date:     now,
          weekKey,
          bl:       blDetail       ? { avg: blAvg,       ...blDetail       } : (existing.bl       ?? null),
          blActive: blActiveDetail ? { avg: blActiveAvg, ...blActiveDetail } : (existing.blActive  ?? null),
          ebay:     ebayDetail     ? { avg: ebayAvg,     ...ebayDetail     } : (existing.ebay      ?? null),
        };
      }

      const r2 = (v) => v != null ? Math.round(v * 100) / 100 : v;
      return {
        ...it,
        priceHistory:    history,
        priceSnapshots:  snapshots,
        bricklinkPrice:          blAvg          != null ? r2(blAvg)          : it.bricklinkPrice,
        bricklinkMedian:         blMedian       != null ? r2(blMedian)       : it.bricklinkMedian,
        bricklinkSoldQty:        blSoldQty      != null ? blSoldQty          : it.bricklinkSoldQty,
        bricklinkSoldOutliers:   blAvg          != null ? blOutliers         : it.bricklinkSoldOutliers,
        bricklinkPriceEstimated: blPriceEstimated != null ? blPriceEstimated : (blAvg != null ? null : it.bricklinkPriceEstimated),
        bricklinkActive:         blActiveAvg    != null ? r2(blActiveAvg)    : it.bricklinkActive,
        bricklinkActiveMedian:   blActiveMedian != null ? r2(blActiveMedian) : it.bricklinkActiveMedian,
        bricklinkActiveQty:      blActiveQty    != null ? blActiveQty        : it.bricklinkActiveQty,
        bricklinkActiveOutliers: blActiveAvg    != null ? blActiveOutliers   : it.bricklinkActiveOutliers,
        ebayPrice:        filteredEbayAvg != null ? r2(filteredEbayAvg)        : it.ebayPrice,
        ebayPlusShipping: filteredEbayAvg != null ? filteredEbayPlusShipping   : it.ebayPlusShipping,
        colMinifigId:     colMinifigId    != null ? colMinifigId               : it.colMinifigId,
        ebayMin:          ebayDetail?.min  != null ? r2(ebayDetail.min)        : it.ebayMin,
        ebayMax:          ebayDetail?.max  != null ? r2(ebayDetail.max)        : it.ebayMax,
        estimatedValue:  blAvg           != null ? r2(blAvg) : (filteredEbayAvg != null ? r2(filteredEbayAvg) : it.estimatedValue),
        imageUrl:        newImageUrl     != null ? newImageUrl     : it.imageUrl,
        minifigValue:    newMinifigValue != null ? r2(newMinifigValue) : it.minifigValue,
        minifigList:     newMinifigList  != null ? newMinifigList  : it.minifigList,
        updatedAt:       now,
      };
    }));

    const parts = [];
    if (blAvg          != null) parts.push(`BL sold avg: $${blAvg.toFixed(2)}`);
    if (blMedian       != null) parts.push(`median: $${blMedian.toFixed(2)}`);
    if (blActiveAvg    != null) parts.push(`BL active avg: $${blActiveAvg.toFixed(2)}`);
    if (blActiveMedian != null) parts.push(`median: $${blActiveMedian.toFixed(2)}`);
    if (ebayAvg        != null) parts.push(`eBay: $${ebayAvg.toFixed(2)}`);
    setFetchState(prev => ({ ...prev, [item.id]: { status: 'done', message: parts.join(' · ') } }));
    return { ok: true, message: parts.join(' · '), errors };
  }, [blConfigured, ebayConfigured, updateItems]);

  // Register fetchPricesForItem with App so the sidebar batch runner can call it
  React.useEffect(() => {
    if (priceFetcherRef) priceFetcherRef.current = fetchPricesForItem;
    return () => { if (priceFetcherRef) priceFetcherRef.current = null; };
  }, [fetchPricesForItem, priceFetcherRef]);

  const neitherConfigured = !blConfigured && !ebayConfigured;

  return (
    <>
      <div className="header"><h1>Price Guide</h1></div>

      {/* Quick Lookup */}
      <div className="stat-card" style={{ marginBottom: 20 }}>
        <div className="label" style={{ marginBottom: 12 }}>Quick Lookup</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="filter-select" value={lookupType} onChange={e => { setLookupType(e.target.value); setLookupResult(null); setLookupFetchState('idle'); setLookupId(''); setLookupSuggestions([]); setLookupDropdownOpen(false); }}>
            <option value="set">Set</option>
            <option value="minifig">Minifigure</option>
            <option value="part">Part</option>
          </select>
          <select className="filter-select" value={lookupCondition} onChange={e => { setLookupCondition(e.target.value); setLookupResult(null); setLookupFetchState('idle'); }}>
            <option value="U">Used</option>
            <option value="N">New</option>
          </select>
          {/* Autocomplete input */}
          <div style={{ flex: 1, maxWidth: 340, position: 'relative' }}>
            <input className="search-box" style={{ width: '100%', boxSizing: 'border-box' }}
              ref={lookupInputRef}
              placeholder={lookupType === 'set' ? 'Search by name or number…' : lookupType === 'minifig' ? 'Search minifig by name or number…' : 'Search part by name or number…'}
              value={lookupId}
              onChange={e => { setLookupId(e.target.value); setLookupResult(null); setLookupFetchState('idle'); }}
              onFocus={() => { if (lookupSuggestions.length > 0) setLookupDropdownOpen(true); }}
              onKeyDown={e => {
                if (!lookupDropdownOpen || lookupSuggestions.length === 0) {
                  if (e.key === 'Enter' && lookupId.trim()) runQuickLookup();
                  return;
                }
                if (e.key === 'ArrowDown') { e.preventDefault(); setLookupActiveSug(i => Math.min(i + 1, lookupSuggestions.length - 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setLookupActiveSug(i => Math.max(i - 1, -1)); }
                else if (e.key === 'Enter') {
                  e.preventDefault();
                  if (lookupActiveSug >= 0 && lookupSuggestions[lookupActiveSug]) {
                    const s = lookupSuggestions[lookupActiveSug];
                    setLookupId(s.itemNumber); setLookupDropdownOpen(false); setLookupSuggestions([]);
                    runQuickLookup(s.itemNumber);
                  } else if (lookupId.trim()) { setLookupDropdownOpen(false); runQuickLookup(); }
                } else if (e.key === 'Escape') { setLookupDropdownOpen(false); }
              }} />
            {/* Suggestions dropdown */}
            {lookupDropdownOpen && lookupSuggestions.length > 0 && (
              <div ref={lookupDropdownRef} style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
                background: 'var(--surface1)', border: '1px solid var(--border)',
                borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,.15)', marginTop: 3,
                maxHeight: 280, overflowY: 'auto',
              }}>
                {lookupSuggestions.map((sug, i) => (
                  <div key={sug.itemNumber + i}
                    style={{
                      padding: '7px 11px', cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center',
                      background: i === lookupActiveSug ? 'var(--surface2)' : 'transparent',
                      borderBottom: i < lookupSuggestions.length - 1 ? '1px solid var(--border)' : 'none',
                    }}
                    onMouseEnter={() => setLookupActiveSug(i)}
                    onMouseDown={e => {
                      e.preventDefault();
                      setLookupId(sug.itemNumber);
                      setLookupDropdownOpen(false);
                      setLookupSuggestions([]);
                      runQuickLookup(sug.itemNumber);
                    }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', minWidth: 56, flexShrink: 0 }}>{sug.itemNumber}</span>
                    <span style={{ fontSize: 13, color: 'var(--text1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{sug.name}</span>
                    {sug.theme && <span style={{ fontSize: 11, color: 'var(--text3)', flexShrink: 0 }}>{sug.theme}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
          {(blConfigured || ebayConfigured) && (
            <button className="btn btn-primary"
              disabled={!lookupId.trim() || lookupFetchState === 'fetching'}
              onClick={() => { setLookupDropdownOpen(false); runQuickLookup(); }}>
              {lookupFetchState === 'fetching' ? 'Fetching…' : 'Fetch Prices'}
            </button>
          )}
        </div>

        {/* Results */}
        {(lookupFetchState === 'error' || lookupFetchState === 'done') && lookupResult && (
          <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>

              {/* Thumbnail */}
              {lookupResult.imageUrl && (
                <img src={lookupResult.imageUrl} alt=""
                  onError={e => e.target.style.display = 'none'}
                  style={{ width: 90, height: 70, objectFit: 'contain', borderRadius: 6, background: 'var(--surface2)', flexShrink: 0 }} />
              )}

              {/* Identity block */}
              <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                {lookupResult.name
                  ? <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text1)', lineHeight: 1.3 }}>{lookupResult.name}</div>
                  : <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text2)' }}>{lookupId.trim()}</div>
                }
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {lookupResult.theme && <span>{lookupResult.theme}</span>}
                  {lookupResult.yearReleased && <span>· {lookupResult.yearReleased}</span>}
                  {lookupResult.pieces     && <span>· {lookupResult.pieces.toLocaleString()} pcs</span>}
                  {lookupResult.retailPrice != null && <span>· MSRP {currency(lookupResult.retailPrice)}</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>
                  {lookupId.trim()} · {lookupResult.condition === 'N' ? 'New' : 'Used'}
                </div>
                {lookupResult.inventoryMatch && (
                  <div style={{ marginTop: 6 }}>
                    <span
                      style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: 'rgba(76,140,231,.15)', color: 'var(--blue)', cursor: 'pointer' }}
                      onClick={() => { setEditItem(lookupResult.inventoryMatch); setModal('edit'); }}
                      title="This item is in your inventory — click to open">
                      In your inventory ↗
                    </span>
                  </div>
                )}
              </div>

              {/* Price columns */}
              {lookupFetchState === 'done' && (() => {
                const blUrl = quickLookupUrl(lookupId.trim(), lookupType);
                const ebUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent('LEGO ' + lookupId.trim())}`;
                const valueNoFigs = (lookupResult.suggested != null && lookupResult.minifigValue != null)
                  ? Math.max(0, Math.round((lookupResult.suggested - lookupResult.minifigValue) * 100) / 100)
                  : null;
                return (
                  <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    {/* Suggested */}
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 3 }}>Suggested</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>{lookupResult.suggested != null ? currency(lookupResult.suggested) : '—'}</div>
                      {valueNoFigs != null && (
                        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}
                          title={`Minifig value: ${currency(lookupResult.minifigValue)} · Set without figs: ${currency(valueNoFigs)}`}>
                          w/o figs {currency(valueNoFigs)}
                        </div>
                      )}
                    </div>

                    {/* BL Sold */}
                    {(lookupResult.blSold != null || lookupResult.blSoldMed != null) && (
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 3 }}>BL Sold avg</div>
                        <a href={blUrl} target="_blank" rel="noopener" style={{ textDecoration: 'none' }}>
                          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--blue)' }}>{lookupResult.blSold != null ? currency(lookupResult.blSold) : '—'} ↗</div>
                        </a>
                        {lookupResult.blSoldMed != null && <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 1 }}>med {currency(lookupResult.blSoldMed)}</div>}
                        {lookupResult.blSoldQty != null && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>{lookupResult.blSoldQty.toLocaleString()} sales</div>}
                      </div>
                    )}

                    {/* BL Active */}
                    {(lookupResult.blActive != null || lookupResult.blActiveMed != null) && (
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 3 }}>BL Active avg</div>
                        <a href={blUrl} target="_blank" rel="noopener" style={{ textDecoration: 'none' }}>
                          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--purple)' }}>{lookupResult.blActive != null ? currency(lookupResult.blActive) : '—'} ↗</div>
                        </a>
                        {lookupResult.blActiveMed != null && <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 1 }}>med {currency(lookupResult.blActiveMed)}</div>}
                        {lookupResult.blActiveQty != null && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>{lookupResult.blActiveQty.toLocaleString()} listings</div>}
                      </div>
                    )}

                    {/* eBay */}
                    {ebayConfigured && lookupType !== 'part' && lookupResult.ebay != null && (
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 3 }}>eBay Active avg</div>
                        <a href={ebUrl} target="_blank" rel="noopener" style={{ textDecoration: 'none' }}>
                          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--orange)' }}>{currency(lookupResult.ebay)} ↗</div>
                        </a>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Error state (still show catalog info) */}
              {lookupFetchState === 'error' && lookupResult.error && (
                <div style={{ fontSize: 12, color: 'var(--red)', alignSelf: 'center' }}>✗ {lookupResult.error}</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Inventory Table */}
      <div className="table-wrap">
        <div className="table-toolbar" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn-icon" onClick={() => setSearch('')} title="Clear search"
            style={{ opacity: search ? 1 : 0.35, flexShrink: 0 }}>
            {Icons.x}
          </button>
          <input className="search-box" style={{ flex: 1 }} placeholder="Search your inventory for price checks…" value={search} onChange={e => setSearch(e.target.value)} />
          {!isFiltered && (
            <button className="btn btn-secondary btn-sm" style={{ whiteSpace:'nowrap', flexShrink:0 }}
              onClick={allExpanded ? collapseAll : expandAll}
              title={allExpanded ? 'Collapse all categories' : 'Expand all categories'}>
              {allExpanded ? '⊟ Collapse All' : '⊞ Expand All'}
            </button>
          )}
          <select className="filter-select" value={warningFilter} onChange={e => setWarningFilter(e.target.value)}>
            <option value="all">All Rows</option>
            <option value="warnings">Warnings Only</option>
          </select>
          {neitherConfigured
            ? <span style={{ fontSize: 12, color: 'var(--text2)' }}>Configure BrickLink or eBay API in Configuration to enable price fetching.</span>
            : priceBatchStatus === 'running'
              ? <span style={{ fontSize: 12, color: 'var(--accent)' }}>💰 Fetching prices… {priceBatchProgress}</span>
              : <>
                  {priceBatchStatus === 'done' && priceBatchCounts && (
                    <span style={{ fontSize: 12, color: 'var(--green)' }}>✓ {priceBatchCounts.done} updated{priceBatchCounts.failed ? `, ${priceBatchCounts.failed} failed` : ''}</span>
                  )}
                  {selectedItems.length > 0 && (
                    <button className="btn btn-secondary" onClick={fetchSelectedPrices}>↻ Fetch Selected ({selectedItems.length})</button>
                  )}
                  <button className="btn btn-primary" onClick={fetchAllPrices} disabled={!fetchAllPrices}>↻ Fetch Prices for All</button>
                  {ebayConfigured && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text2)', cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none' }}
                      title="When unchecked, batch price fetches will only pull BrickLink data and skip eBay">
                      <input type="checkbox" checked={updateEbay} onChange={e => setUpdateEbay(e.target.checked)}
                        style={{ cursor: 'pointer', accentColor: 'var(--orange)' }} />
                      Update eBay
                    </label>
                  )}
                </>
          }
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 20, fontSize: 11, color: 'var(--text2)', padding: '6px 0 4px 2px', flexWrap: 'wrap' }}>
          {!typeColumn && <span>Item type: <span style={{ color: 'var(--accent)' }}>● Set</span> &nbsp;<span style={{ color: 'var(--orange)' }}>● Minifig</span> &nbsp;<span style={{ color: 'var(--blue)' }}>● Part</span></span>}
          <span>Trend: <span style={{ color: 'var(--blue)' }}>— BrickLink avg (used sold)</span> &nbsp;<span style={{ color: 'var(--orange)' }}>— eBay avg (active)</span></span>
        </div>

        {filtered.length === 0
          ? <div className="empty-state"><p>No items to show. Add items to your inventory first.</p></div>
          : <table>
              <thead>
                <tr>
                  <th style={{ width: 32, padding: '8px 6px', textAlign: 'center' }}>
                    <input type="checkbox"
                      checked={sortedFiltered.length > 0 && sortedFiltered.every(i => selectedIds.has(i.id))}
                      onChange={e => setSelectedIds(e.target.checked ? new Set(sortedFiltered.map(i => i.id)) : new Set())}
                      title="Select all visible" style={{ cursor: 'pointer', accentColor: 'var(--accent)' }} />
                  </th>
                  {typeColumn && <SortTH col="type">Type</SortTH>}
                  {blIdColumn && <SortTH col="blid">BL ID</SortTH>}
                  <SortTH col="item">Item</SortTH>
                  {colorColumn && <SortTH col="color">Color</SortTH>}
                  {dateAddedColumn && <SortTH col="dateAdded">Date Added</SortTH>}
                  <SortTH col="dateListed">Date Listed</SortTH>
                  <SortTH col="listed">Listed Price</SortTH>
                  <SortTH col="suggested">Suggested</SortTH>
                  <SortTH col="listedPct">Listed vs Suggested %</SortTH>
                  <SortTH col="blSold">BL Sold</SortTH>
                  <SortTH col="blActive">BL Active</SortTH>
                  <SortTH col="ebay">eBay Active</SortTH>
                  <SortTH col="trend">Price Trend</SortTH>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {groupedFiltered.map(typeGroup => {
                  const typeRows = typeGroup.rows.flatMap(g => g.rows);
                  const typeQty = typeRows.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
                  const typeCollapsed = !!effectiveCollapsed[groupKey('type', typeGroup.type)];
                  return (
                    <React.Fragment key={`type-${typeGroup.type}`}>
                      <tr>
                        <td style={{padding:'8px 6px',background:'var(--surface2)',borderBottom:'1px solid var(--border)',textAlign:'center',width:32}}
                          onClick={e => e.stopPropagation()}>
                          <input type="checkbox"
                            checked={typeRows.length > 0 && typeRows.every(i => selectedIds.has(i.id))}
                            onChange={e => setSelectedIds(prev => {
                              const next = new Set(prev);
                              typeRows.forEach(i => e.target.checked ? next.add(i.id) : next.delete(i.id));
                              return next;
                            })}
                            title={`Check all ${itemTypeLabel(typeGroup.type)}s`}
                            style={{ cursor: 'pointer', accentColor: 'var(--accent)' }} />
                        </td>
                        <td colSpan={tableColSpan - 1}
                          onClick={() => toggleGroup('type', typeGroup.type)}
                          style={{padding:'8px 12px',background:'var(--surface2)',borderBottom:'1px solid var(--border)',cursor:'pointer',userSelect:'none'}}>
                          <span style={{color:'var(--text3)',display:'inline-block',width:14}}>{typeCollapsed ? '▶' : '▼'}</span>
                          <span style={{fontWeight:700,color:itemTypeColor(typeGroup.type)}}>{itemTypeLabel(typeGroup.type)}</span>
                          <span style={{fontSize:11,color:'var(--text3)',marginLeft:8}}>{typeRows.length} listing{typeRows.length !== 1 ? 's' : ''} · {typeQty} item{typeQty !== 1 ? 's' : ''}</span>
                        </td>
                      </tr>
                      {!typeCollapsed && typeGroup.rows.map(categoryGroup => {
                        const categoryKey = `${typeGroup.type}:${categoryGroup.category}`;
                        const categoryCollapsed = !!effectiveCollapsed[groupKey('category', categoryKey)];
                        const categoryQty = categoryGroup.rows.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
                        const categoryIds = categoryGroup.rows.map(i => i.id);
                        return (
                          <React.Fragment key={`category-${categoryKey}`}>
                            <tr>
                              <td style={{padding:'6px 6px',background:'rgba(0,0,0,.03)',borderBottom:'1px solid var(--border)',textAlign:'center',width:32}}
                                onClick={e => e.stopPropagation()}>
                                <input type="checkbox"
                                  checked={categoryIds.length > 0 && categoryIds.every(id => selectedIds.has(id))}
                                  onChange={e => setSelectedIds(prev => {
                                    const next = new Set(prev);
                                    categoryIds.forEach(id => e.target.checked ? next.add(id) : next.delete(id));
                                    return next;
                                  })}
                                  title={`Check all in ${categoryGroup.category}`}
                                  style={{ cursor: 'pointer', accentColor: 'var(--accent)' }} />
                              </td>
                              <td colSpan={tableColSpan - 1}
                                onClick={() => toggleGroup('category', categoryKey)}
                                style={{padding:'6px 12px 6px 10px',background:'rgba(0,0,0,.03)',borderBottom:'1px solid var(--border)',cursor:'pointer',userSelect:'none'}}>
                                <span style={{color:'var(--text3)',display:'inline-block',width:14}}>{categoryCollapsed ? '▶' : '▼'}</span>
                                <span style={{fontWeight:600,color:'var(--text2)'}}>{categoryGroup.category}</span>
                                <span style={{fontSize:11,color:'var(--text3)',marginLeft:8}}>{categoryGroup.rows.length} listing{categoryGroup.rows.length !== 1 ? 's' : ''} · {categoryQty} item{categoryQty !== 1 ? 's' : ''}</span>
                              </td>
                            </tr>
                            {!categoryCollapsed && categoryGroup.rows.map(item => {
                  const fs = fetchState[item.id] || { status: 'idle' };
                  const bls = blListState[item.id] || { status: 'idle' };
                  const itemPlatforms = String(item.platform || '').split(/[,/;+]/).map(p => p.trim().toLowerCase()).filter(Boolean);
                  const listedOnBrickLink = item.sellStatus === 'listed' && (
                    !!item.bricklinkInventoryId ||
                    itemPlatforms.some(p => p.replace(/\s+/g, '') === 'bricklink' || p === 'bl')
                  );
                  const bricklinkListedPrice = listedOnBrickLink
                    ? (item.platformPrices?.bricklink ?? item.listPrice ?? null)
                    : null;
                  const listedPct = listedSuggestedPct(item);
                  return (
                    <tr key={item.id}>
                      <td style={{ padding: '6px 6px', textAlign: 'center', width: 32 }} onClick={e => e.stopPropagation()}>
                        <input type="checkbox"
                          checked={selectedIds.has(item.id)}
                          onChange={() => toggleSelect(item.id)}
                          style={{ cursor: 'pointer', accentColor: 'var(--accent)' }} />
                      </td>
                      {typeColumn && <td><span className={`badge badge-${item.type}`}>{item.type}</span></td>}
                      {blIdColumn && <td className="item-id">{item.itemNumber}</td>}
                      <td onClick={() => { setEditItem(item); setModal('edit'); }} style={{ cursor: 'pointer' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span className="item-name" style={{ color: typeColumn ? undefined : item.type === 'set' ? 'var(--accent)' : item.type === 'minifig' ? 'var(--orange)' : 'var(--blue)' }}>{item.name}</span>
                          {item.sellStatus === 'listed' && (
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: 'rgba(76,140,231,.15)', color: 'var(--blue)', whiteSpace: 'nowrap', letterSpacing: '.3px' }}>LISTED</span>
                          )}
                        </div>
                        <br />
                        <span className="item-id">
                          {!blIdColumn && <>{item.itemNumber}</>}
                          {!colorColumn && item.color && item.color !== '(Not Applicable)' && <>{!blIdColumn ? ' · ' : ''}{item.color}</>}
                          {item.condition && CONDITION_LABELS[item.condition] && <> · {CONDITION_LABELS[item.condition]}</>}
                          {item.type === 'set' && item.retailPrice > 0 && <> · <span style={{ color: 'var(--text2)' }}>MSRP {currency(item.retailPrice)}</span></>}
                        </span>
                      </td>
                      {colorColumn && (
                        <td style={{ color: 'var(--text2)', fontSize: 12 }}>
                          {item.color && item.color !== '(Not Applicable)' ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              {item.colorHex && (
                                <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: item.colorHex, border: '1px solid rgba(255,255,255,.2)', flexShrink: 0 }} />
                              )}
                              {item.color}
                            </div>
                          ) : '—'}
                        </td>
                      )}
                      {dateAddedColumn && (
                        <td style={{ fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                          {item.dateAdded || <span style={{ color: 'var(--text3)' }}>—</span>}
                        </td>
                      )}
                      <td style={{ fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                        {item.dateListed || <span style={{ color: 'var(--text3)' }}>—</span>}
                      </td>
                      <td>
                        {bricklinkListedPrice != null
                          ? <>
                              <div style={{ color: 'var(--blue)', fontWeight: 600 }}>{currency(bricklinkListedPrice)}</div>
                              {item.bricklinkInventoryId && (
                                <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 2 }}>
                                  ID {item.bricklinkInventoryId}
                                </div>
                              )}
                            </>
                          : <span style={{ color: 'var(--text3)' }}>—</span>
                        }
                      </td>
                      {(() => {
                        const suggested = suggestedPrice(item);
                        const soldMed   = item.bricklinkMedian ?? null;
                        const activeMed = item.bricklinkActiveMedian ?? null;
                        const t = trend(item.priceHistory, 'blPrice');
                        const hasCompetition = item.bricklinkActive != null && item.bricklinkActive * 0.98 < ((soldMed != null && activeMed != null ? (soldMed + activeMed) / 2 : soldMed ?? activeMed) ?? Infinity);
                        const activeQty = item.bricklinkActiveQty ?? null;
                        const isEstimated = suggested != null && (activeQty == null || activeQty < 6);
                        const estimatedLabel = item.bricklinkPriceEstimated === 'used_from_new' ? 'No used sales — price scaled from new'
                          : item.bricklinkPriceEstimated === 'new_from_used' ? 'No new sales — price scaled from used'
                          : activeQty == null ? 'No active listing data — price may be stale'
                          : `Only ${activeQty} active listing${activeQty !== 1 ? 's' : ''} — limited data`;
                        const minifigVal = item.minifigValue != null ? item.minifigValue : null;
                        const valueNoFigs = (suggested != null && minifigVal != null && item.type === 'set')
                          ? Math.max(0, suggested - minifigVal)
                          : null;
                        return (
                          <td>
                            {suggested != null
                              ? <>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 15 }}>{currency(suggested)}</span>
                                    {isEstimated && (
                                      <span title={estimatedLabel || 'Price estimated from opposite condition'}
                                        style={{ color: 'var(--orange)', fontSize: 13, lineHeight: 1, cursor: 'default' }}>⚠</span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 2, lineHeight: 1.5 }}>
                                    {[
                                      soldMed != null && activeMed != null ? 'blend' : soldMed != null ? 'sold med' : 'active med',
                                      t ? `${t.pct > 0 ? '▲' : '▼'} trend` : null,
                                      hasCompetition ? 'undercut' : null,
                                    ].filter(Boolean).join(' · ')}
                                  </div>
                                  {valueNoFigs != null && (
                                    <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3, lineHeight: 1.4 }}
                                      title={`Minifig value: ${currency(minifigVal)} · Set without figs: ${currency(valueNoFigs)}`}>
                                      w/o figs: <span style={{ color: 'var(--text2)', fontWeight: 500 }}>{currency(valueNoFigs)}</span>
                                    </div>
                                  )}
                                </>
                              : <span style={{ color: 'var(--text3)' }}>—</span>
                            }
                          </td>
                        );
                      })()}
                      <td>
                        {listedPct != null
                          ? <span style={{ color: listedPct >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                              {listedPct >= 0 ? '+' : ''}{listedPct.toFixed(1)}%
                            </span>
                          : <span style={{ color: 'var(--text3)' }}>—</span>
                        }
                      </td>
                      <td>
                        <div
                          style={{ color: 'var(--blue)', fontWeight: 600, cursor: item.priceHistory?.length ? 'pointer' : undefined }}
                          title={item.priceHistory?.length ? 'View price history' : undefined}
                          onClick={item.priceHistory?.length ? () => { setHistoryItem(item); setHistoryField('blPrice'); } : undefined}>
                          {currency(item.bricklinkPrice)}
                        </div>
                        {item.bricklinkMedian != null && (
                          <div
                            style={{ fontSize: 11, color: 'var(--text2)', cursor: item.priceHistory?.length ? 'pointer' : undefined }}
                            title={item.priceHistory?.length ? 'View price history' : undefined}
                            onClick={item.priceHistory?.length ? () => { setHistoryItem(item); setHistoryField('blMedian'); } : undefined}>
                            med <span style={{ color: 'var(--blue)', fontWeight: 500 }}>{currency(item.bricklinkMedian)}</span>
                          </div>
                        )}
                        {item.bricklinkSoldQty != null && (
                          <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                            {item.bricklinkSoldQty.toLocaleString()} sales
                            {item.bricklinkSoldOutliers > 0 && <span title={`${item.bricklinkSoldOutliers} low-price lots excluded`} style={{ color: 'var(--orange)', marginLeft: 4 }}>−{item.bricklinkSoldOutliers}</span>}
                          </div>
                        )}
                        {item.bricklinkPriceEstimated === 'used_from_new' && (
                          <div style={{ fontSize: 10, color: 'var(--orange)', marginTop: 2 }} title="No used listings found — estimated at 60% of new price">
                            est. from new ×0.6
                          </div>
                        )}
                        {item.bricklinkPriceEstimated === 'new_from_used' && (
                          <div style={{ fontSize: 10, color: 'var(--orange)', marginTop: 2 }} title="No new listings found — estimated at 140% of used price">
                            est. from used ×1.4
                          </div>
                        )}
                        {(() => { const t = trend(item.priceHistory, 'blPrice'); return t && <div style={{ fontSize: 11, color: t.color, fontWeight: 600, marginTop: 1 }}>{t.pct > 0 ? '▲' : '▼'} {Math.abs(t.pct).toFixed(1)}%</div>; })()}
                      </td>
                      <td>
                        <div
                          style={{ color: 'var(--purple)', fontWeight: 600, cursor: item.priceHistory?.length ? 'pointer' : undefined }}
                          title={item.priceHistory?.length ? 'View price history' : undefined}
                          onClick={item.priceHistory?.length ? () => { setHistoryItem(item); setHistoryField('blActivePrice'); } : undefined}>
                          {currency(item.bricklinkActive)}
                        </div>
                        {item.bricklinkActiveMedian != null && (
                          <div
                            style={{ fontSize: 11, color: 'var(--text2)', cursor: item.priceHistory?.length ? 'pointer' : undefined }}
                            title={item.priceHistory?.length ? 'View price history' : undefined}
                            onClick={item.priceHistory?.length ? () => { setHistoryItem(item); setHistoryField('blActiveMedian'); } : undefined}>
                            med <span style={{ color: 'var(--purple)', fontWeight: 500 }}>{currency(item.bricklinkActiveMedian)}</span>
                          </div>
                        )}
                        {item.bricklinkActiveQty != null && (
                          <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                            {item.bricklinkActiveQty.toLocaleString()} listings
                            {item.bricklinkActiveOutliers > 0 && <span title={`${item.bricklinkActiveOutliers} low-price lots excluded`} style={{ color: 'var(--orange)', marginLeft: 4 }}>−{item.bricklinkActiveOutliers}</span>}
                          </div>
                        )}
                        {(() => { const t = trend(item.priceHistory, 'blActivePrice'); return t && <div style={{ fontSize: 11, color: t.color, fontWeight: 600, marginTop: 1 }}>{t.pct > 0 ? '▲' : '▼'} {Math.abs(t.pct).toFixed(1)}%</div>; })()}
                      </td>
                      <td>
                        {(() => {
                          // Compute min/max only from non-ignored listings in the latest snapshot
                          const ignoredTitles = new Set(item.ebayIgnoredUrls || []);
                          const snapListings = item.priceSnapshots
                            ? (Object.values(item.priceSnapshots).sort((a, b) => b.date > a.date ? 1 : -1)[0]?.ebay?.listings || [])
                            : [];
                          const activePrices = snapListings
                            .filter(l => !ignoredTitles.has(l.title))
                            .map(l => l.total ?? l.price)
                            .filter(p => p > 0);
                          const activeMin = activePrices.length ? Math.min(...activePrices) : null;
                          const activeMax = activePrices.length ? Math.max(...activePrices) : null;
                          const wideVariance = activeMin > 0 && activeMax > 0 && (activeMax / activeMin) >= 5;
                          return <>
                            <span
                              style={{ color: 'var(--orange)', fontWeight: 600, cursor: item.priceHistory?.length ? 'pointer' : undefined }}
                              title={item.priceHistory?.length ? 'View price history' : undefined}
                              onClick={item.priceHistory?.length ? () => { setHistoryItem(item); setHistoryField('ebayPrice'); } : undefined}>
                              {currency(item.ebayPrice)}
                            </span>
                            {wideVariance && (
                              <span
                                title={`Wide price spread: ${currency(activeMin)}–${currency(activeMax)} — average may not be reliable`}
                                style={{ marginLeft: 5, cursor: 'default', fontSize: 13 }}>
                                ⚠️
                              </span>
                            )}
                            {item.ebayPrice != null && <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 1 }}>{item.ebayPlusShipping ? 'plus shipping' : 'incl. shipping'}</div>}
                            {wideVariance && <div style={{ fontSize: 10, color: 'var(--orange)', marginTop: 1 }}>wide spread</div>}
                            {(() => { const t = trend(item.priceHistory, 'ebayPrice'); return t && <div style={{ fontSize: 11, color: t.color, fontWeight: 600, marginTop: 1 }}>{t.pct > 0 ? '▲' : '▼'} {Math.abs(t.pct).toFixed(1)}%</div>; })()}
                          </>;
                        })()}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Sparkline history={item.priceHistory} />
                          {item.priceHistory?.length > 0 &&
                            <button
                              title="View full price history"
                              onClick={() => { setHistoryItem(item); setHistoryField(null); }}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text2)', fontSize: 13, padding: '0 2px', lineHeight: 1 }}>
                              📈
                            </button>
                          }
                        </div>
                        {(() => {
                          const last = [...(item.priceHistory||[])].reverse().find(h => h.blPrice != null || h.blActivePrice != null || h.ebayPrice != null);
                          return last ? <div style={{fontSize:10,color:'var(--text3)',marginTop:3}}>Updated {new Date(last.date).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}</div> : null;
                        })()}
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <div className="price-links" style={{ flexWrap: 'wrap', gap: 4 }}>
                            <a className="price-link bl" href={bricklinkPriceUrl(item)} target="_blank" rel="noopener">BrickLink Sold</a>
                            <a className="price-link" style={{ background: 'rgba(156,108,231,.15)', color: 'var(--purple)' }} href={bricklinkUrl(item)} target="_blank" rel="noopener">BrickLink Active</a>
                            <a className="price-link" style={{ background: 'rgba(231,138,76,.15)', color: 'var(--orange)' }} href={(() => {
                              const conditionTerm = item.condition === 'new_sealed' ? 'new sealed' : item.condition === 'new_open' ? 'new open box' : item.condition === 'used_complete' ? 'used' : item.condition === 'used_incomplete' ? 'used incomplete' : '';
                              let searchTerm;
                              const isCol = /^col/i.test(item.itemNumber);
                              if (isCol) {
                                let name = item.name || '';
                                if (name.includes(',')) name = name.split(',')[0].trim();
                                const parts = [item.itemNumber];
                                if (item.colMinifigId && item.colMinifigId.toLowerCase() !== item.itemNumber.toLowerCase()) parts.push(item.colMinifigId);
                                if (name) parts.push(name);
                                searchTerm = parts.join(' ');
                              } else if (item.type === 'set') {
                                const itemNum = /^.+-1$/i.test(item.itemNumber) ? item.itemNumber.replace(/-1$/, '') : item.itemNumber;
                                searchTerm = item.name ? `${itemNum} ${item.name}` : itemNum;
                              } else {
                                searchTerm = item.name ? `${item.itemNumber} ${item.name}` : item.itemNumber;
                              }
                              const q = `LEGO ${searchTerm}${conditionTerm ? ' ' + conditionTerm : ''}`.trim();
                              return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}`;
                            })()} target="_blank" rel="noopener">eBay Active</a>
                            {!neitherConfigured && (
                              <button
                                className="price-link"
                                style={{ background: 'rgba(100,200,100,.12)', color: 'var(--green)', border: 'none', cursor: 'pointer', opacity: fs.status === 'fetching' ? 0.6 : 1 }}
                                disabled={fs.status === 'fetching' || batchRunning}
                                onClick={() => fetchPricesForItem(item)}>
                                {fs.status === 'fetching' ? '…' : '↻ Fetch'}
                              </button>
                            )}
                            {blConfigured && !listedOnBrickLink && suggestedPrice(item) && (
                              <button
                                className="price-link"
                                style={{ background: 'rgba(76,140,231,.12)', color: 'var(--blue)', border: 'none', cursor: bls.status === 'listing' ? 'wait' : 'pointer', opacity: bls.status === 'listing' ? 0.6 : 1 }}
                                disabled={bls.status === 'listing' || batchRunning}
                                onClick={() => listOnBrickLinkAtSuggested(item)}
                                title="Create a BrickLink store listing at the suggested price">
                                {bls.status === 'listing' ? 'Listing…' : `List BL ${currency(suggestedPrice(item))}`}
                              </button>
                            )}
                            {blConfigured && listedOnBrickLink && suggestedPrice(item) && (
                              <button
                                className="price-link"
                                style={{ background: 'rgba(76,140,231,.12)', color: 'var(--blue)', border: 'none', cursor: bls.status === 'listing' ? 'wait' : 'pointer', opacity: bls.status === 'listing' ? 0.6 : 1 }}
                                disabled={bls.status === 'listing' || batchRunning}
                                onClick={() => updateBrickLinkToSuggested(item)}
                                title="Update the BrickLink store listing to the suggested price">
                                {bls.status === 'listing' ? 'Updating…' : `Update BL ${currency(suggestedPrice(item))}`}
                              </button>
                            )}
                          </div>
                          {fs.status === 'done'  && <span style={{ fontSize: 11, color: 'var(--green)' }}>✓ {fs.message}</span>}
                          {fs.status === 'error' && <span style={{ fontSize: 11, color: 'var(--red)'   }}>✗ {fs.message}</span>}
                          {bls.status === 'done'  && <span style={{ fontSize: 11, color: 'var(--green)' }}>✓ {bls.message}</span>}
                          {bls.status === 'error' && <span style={{ fontSize: 11, color: 'var(--red)'   }}>✗ {bls.message}</span>}
                        </div>
                      </td>
                    </tr>
                  );
                            })}
                          </React.Fragment>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
        }
      </div>

      {/* Price History Modal */}
      {historyItem && <PriceHistoryModal
        item={items.find(i => i.id === historyItem.id) || historyItem}
        focusField={historyField}
        onClose={() => { setHistoryItem(null); setHistoryField(null); }}
        updateItems={updateItems}
      />}

      {/* BL Store Price Update Modal */}
      {blUpdateItem && blUpdateState && (
        <div className="modal-overlay" onClick={() => { setBlUpdateItem(null); setBlUpdateState(null); }}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Update BrickLink Store Price</h2>
              <button className="btn-icon" onClick={() => { setBlUpdateItem(null); setBlUpdateState(null); }}>{Icons.x}</button>
            </div>
            <div className="modal-body">

              {/* Item summary */}
              <div style={{ background: 'var(--surface2)', borderRadius: 8, padding: '10px 14px', marginBottom: 20, fontSize: 13 }}>
                <div style={{ fontWeight: 600 }}>{blUpdateItem.name || blUpdateItem.itemNumber}</div>
                <div style={{ color: 'var(--text2)', marginTop: 2 }}>{blUpdateItem.itemNumber}{blUpdateItem.theme ? ` · ${blUpdateItem.theme}` : ''}</div>
              </div>

              {blUpdateState.loading && <div style={{ color: 'var(--text2)', fontSize: 13 }}>Fetching store inventory…</div>}
              {blUpdateState.error   && <div style={{ color: 'var(--red)', fontSize: 13 }}>✗ {blUpdateState.error}</div>}
              {blUpdateState.done    && <div style={{ color: 'var(--green)', fontSize: 13 }}>✓ Price updated successfully.</div>}

              {!blUpdateState.loading && !blUpdateState.error && !blUpdateState.done && blUpdateState.inventories && (() => {
                const invs = blUpdateState.inventories;
                const newPrice = blUpdateState.newPrice;
                if (invs.length === 0) {
                  return <div style={{ color: 'var(--text2)', fontSize: 13 }}>No matching listings found in your BrickLink store.</div>;
                }
                return (
                  <>
                    <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 12 }}>
                      New price: <strong style={{ color: 'var(--accent)', fontSize: 14 }}>{currency(newPrice)}</strong>
                      {blUpdateItem.listPrice ? ' (from list price)' : ' (from suggested price)'}
                    </div>
                    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: 'var(--surface2)', color: 'var(--text2)' }}>
                            <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600 }}>Condition</th>
                            <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>Qty</th>
                            <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>Current Price</th>
                            <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>New Price</th>
                            <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>Change</th>
                          </tr>
                        </thead>
                        <tbody>
                          {invs.map(inv => {
                            const oldPrice = inv.price;
                            const changePct = oldPrice > 0 ? ((newPrice - oldPrice) / oldPrice) * 100 : null;
                            const bigChange = changePct != null && Math.abs(changePct) >= 20;
                            return (
                              <tr key={inv.inventory_id} style={{ borderTop: '1px solid var(--border)' }}>
                                <td style={{ padding: '7px 10px' }}>{inv.condition === 'N' ? 'New' : 'Used'}</td>
                                <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text2)' }}>{inv.quantity}</td>
                                <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text2)' }}>{currency(oldPrice)}</td>
                                <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 600, color: 'var(--accent)' }}>{currency(newPrice)}</td>
                                <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 600,
                                  color: bigChange ? 'var(--red)' : changePct > 0 ? 'var(--green)' : changePct < 0 ? 'var(--orange)' : 'var(--text2)' }}>
                                  {changePct != null ? `${changePct > 0 ? '+' : ''}${changePct.toFixed(1)}%${bigChange ? ' ⚠' : ''}` : '—'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {invs.some(inv => { const p = ((blUpdateState.newPrice - inv.price) / inv.price) * 100; return Math.abs(p) >= 20; }) && (
                      <div style={{ marginTop: 10, fontSize: 12, color: 'var(--red)' }}>
                        ⚠ One or more listings have a price change of 20% or more. Please review before confirming.
                      </div>
                    )}
                    <div className="modal-footer" style={{ marginTop: 16, padding: 0 }}>
                      <button className="btn btn-secondary" onClick={() => { setBlUpdateItem(null); setBlUpdateState(null); }}>Cancel</button>
                      {invs.map(inv => (
                        <button key={inv.inventory_id} className="btn btn-primary"
                          disabled={blUpdateState.updating}
                          onClick={() => confirmBlUpdate(inv.inventory_id, newPrice)}>
                          {blUpdateState.updating ? 'Updating…' : invs.length > 1 ? `Update listing ${inv.inventory_id}` : 'Confirm Update'}
                        </button>
                      ))}
                    </div>
                  </>
                );
              })()}

            </div>
            {(blUpdateState.error || blUpdateState.done) && (
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => { setBlUpdateItem(null); setBlUpdateState(null); }}>Close</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
