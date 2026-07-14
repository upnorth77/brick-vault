// ─── BrickLink Store Page ───
// Shows all items currently in your BrickLink store inventory, compares prices to
// the local suggested price (from BrickLink price guide), and lets you update
// prices one-at-a-time or in bulk.

function StorePage({ items: inventoryItems, blConfigured, settings, updateItems, setSellItem, ebayConfigured, setPage, setPricingSearch, setEditItem, setModal }) {
  const typeColumn  = !!settings?.typeColumn;
  const blIdColumn  = !!settings?.blIdColumn;
  const colorColumn = !!settings?.colorColumn;
  const sellingPlatforms = Array.isArray(settings?.platforms) ? settings.platforms : [];
  const [activeTab, setActiveTab] = React.useState('inventory');

  // ── Store listings from BrickLink ──
  const [listings,     setListings]     = React.useState(null); // null | [] | [...]
  const [loadState,    setLoadState]    = React.useState('idle'); // idle|loading|done|error
  const [loadError,    setLoadError]    = React.useState('');
  const [lastLoaded,   setLastLoaded]   = React.useState(null);

  // ── Orders from BrickLink ──
  const [orders, setOrders] = React.useState(null); // null | [] | [...]
  const [ordersLoadState, setOrdersLoadState] = React.useState('idle'); // idle|loading|done|error
  const [ordersLoadError, setOrdersLoadError] = React.useState('');
  const [ordersLastLoaded, setOrdersLastLoaded] = React.useState(null);
  const [expandedOrders, setExpandedOrders] = React.useState({});
  const [orderActionState, setOrderActionState] = React.useState({});

  // ── Price guide values (loaded from matching local inventory items) ──
  // Map: inventory_id → { status: 'idle'|'loading'|'done'|'error', suggested, soldMedian, activeMedian, activeAvg }
  const [marketPrices, setMarketPrices] = React.useState({});

  // ── Price update state ──
  // Map: inventory_id → { status: 'idle'|'updating'|'done'|'error', error }
  const [updateState, setUpdateState] = React.useState({});

  // ── Pending new prices (user edits before confirming) ──
  // Map: inventory_id → string (raw input value)
  const [pendingPrices, setPendingPrices] = React.useState({});
  const [selectedUpdateIds, setSelectedUpdateIds] = React.useState(() => new Set());

  // ── Filters / sort ──
  const [search,    setSearch]    = React.useState('');
  const [typeFilter, setTypeFilter] = React.useState('all');
  const [sortCol,   setSortCol]   = React.useState('item_number');
  const [sortDir,   setSortDir]   = React.useState('asc');
  const [collapsedGroups, setCollapsedGroups] = React.useState({});

  // ── Item detail modal ──
  const [detailItem, setDetailItem] = React.useState(null);

  // ── Remove selection ──
  const [selectedRemoveIds, setSelectedRemoveIds] = React.useState(() => new Set());
  const [removeMode, setRemoveMode] = React.useState(false);

  // ── Batch fetch market prices ──
  const [batchStatus,   setBatchStatus]   = React.useState('idle'); // idle|running|done|error
  const [batchProgress, setBatchProgress] = React.useState('');
  const batchCancelRef = React.useRef(false);

  // ─── Load store listings ───
  const applyLoadedStore = React.useCallback((data, fallbackDate) => {
    setListings(data.inventories || []);
    setLoadState('done');
    setLastLoaded(data.cached_at ? new Date(data.cached_at * 1000) : fallbackDate);
    setMarketPrices({});
    setUpdateState({});
    setPendingPrices({});
    setSelectedUpdateIds(new Set());
  }, []);

  const loadStore = React.useCallback(async () => {
    setLoadState('loading');
    setLoadError('');
    try {
      const resp = await fetch('/api/bricklink/store/inventory/all');
      const data = await resp.json();
      if (!resp.ok || data.error) { setLoadError(data.error || 'Failed to load store inventory'); setLoadState('error'); return; }
      applyLoadedStore(data, new Date());
    } catch(e) {
      setLoadError(e.message);
      setLoadState('error');
    }
  }, [applyLoadedStore]);

  const loadCachedStore = React.useCallback(async () => {
    setLoadError('');
    try {
      const resp = await fetch('/api/bricklink/store/inventory/cache');
      const data = await resp.json();
      if (!resp.ok || data.error) return;
      if ((data.inventories || []).length > 0) applyLoadedStore(data, null);
    } catch(e) {
      // Cache load is best-effort; the Refresh button can still fetch live data.
    }
  }, [applyLoadedStore]);

  React.useEffect(() => {
    if (blConfigured && loadState === 'idle') loadCachedStore();
  }, [blConfigured, loadState, loadCachedStore]);

  const loadOrders = React.useCallback(async () => {
    setOrdersLoadState('loading');
    setOrdersLoadError('');
    try {
      const resp = await fetch('/api/bricklink/orders?limit=10');
      const data = await resp.json();
      if (!resp.ok || data.error) {
        setOrdersLoadError(data.error || 'Failed to load BrickLink orders');
        setOrdersLoadState('error');
        return;
      }

      const summaries = data.orders || [];
      const detailResults = await Promise.all(summaries.map(async (order) => {
        try {
          const detailResp = await fetch(`/api/bricklink/orders/${encodeURIComponent(order.orderId)}`);
          const detailData = await detailResp.json();
          if (!detailResp.ok || detailData.error) {
            return { ...order, items: [], detailError: detailData.error || 'Failed to load order items' };
          }
          return { ...order, ...detailData, items: detailData.items || [] };
        } catch (e) {
          return { ...order, items: [], detailError: e.message };
        }
      }));

      setOrders(detailResults);
      setOrdersLastLoaded(new Date());
      setOrdersLoadState('done');
    } catch (e) {
      setOrdersLoadError(e.message);
      setOrdersLoadState('error');
    }
  }, []);

  React.useEffect(() => {
    if (blConfigured && activeTab === 'orders' && ordersLoadState === 'idle') loadOrders();
  }, [blConfigured, activeTab, ordersLoadState, loadOrders]);

  const matchingLocalItem = React.useCallback((listing) => {
    const listingType = listing.item_type;
    const listingNumber = String(listing.item_number || '').trim();
    const listingBase = listingNumber.replace(/-\d+$/, '');
    const listingColorId = String(listing.color_id || '');
    const canUseSetBaseMatch = listingType === 'set' && /^\d+$/.test(listingBase);
    const typeMatches = (inventoryItems || []).filter(i => i.type === listingType);

    const byInventoryId = listing.inventory_id
      ? typeMatches.find(i => String(i.bricklinkInventoryId || '') === String(listing.inventory_id))
      : null;
    if (byInventoryId) return byInventoryId;

    const exactNumberMatches = typeMatches.filter(i => String(i.itemNumber || '').trim() === listingNumber);
    if (listingColorId && listingColorId !== '0') {
      const byColor = exactNumberMatches.find(i => String(i.blColorId || i.colorId || '') === listingColorId);
      if (byColor) return byColor;
    }
    if (exactNumberMatches.length === 1) return exactNumberMatches[0];

    if (canUseSetBaseMatch) {
      const baseMatches = typeMatches.filter(i => {
        const itemNumber = String(i.itemNumber || '').trim();
        const itemBase = itemNumber.replace(/-\d+$/, '');
        return itemBase === listingBase && /^\d+$/.test(itemBase);
      });
      if (baseMatches.length === 1) return baseMatches[0];
    }

    return null;
  }, [inventoryItems]);

  const normaliseTypeNumber = React.useCallback((type, itemNumber) => {
    const raw = String(itemNumber || '').trim().toUpperCase();
    if (!raw) return raw;
    return (type || '').toLowerCase() === 'set' ? raw.replace(/-\d+$/, '') : raw;
  }, []);

  const orderImportPreview = React.useCallback((order) => {
    if (!order?.items?.length) return { rows: [], importRows: [], matchedCount: 0, unmatchedCount: 0 };

    const availablePool = (inventoryItems || [])
      .filter(item => item.sellStatus !== 'sold')
      .map(item => ({ item, remaining: Number(item.quantity) || 1 }));
    const importRows = [];
    const rows = [];

    const candidateScore = (candidate, line) => {
      const item = candidate.item;
      let score = 0;
      if (line.inventoryId && String(item.bricklinkInventoryId || '') === String(line.inventoryId)) score += 1000;
      if ((item.sellStatus || 'available') === 'listed') score += 200;
      if (String(item.itemNumber || '').trim().toUpperCase() === String(line.itemNumber || '').trim().toUpperCase()) score += 80;
      if (normaliseTypeNumber(item.type, item.itemNumber) === normaliseTypeNumber(line.itemType, line.itemNumber)) score += 40;
      if (String(item.blColorId || item.colorId || '') && String(item.blColorId || item.colorId || '') === String(line.colorId || '')) score += 30;
      return score;
    };

    const matchesLine = (candidate, line) => {
      const item = candidate.item;
      if (candidate.remaining <= 0) return false;
      if ((item.type || 'set') !== (line.itemType || 'set')) return false;

      const exactNumber = String(item.itemNumber || '').trim().toUpperCase() === String(line.itemNumber || '').trim().toUpperCase();
      const baseNumber = normaliseTypeNumber(item.type, item.itemNumber) === normaliseTypeNumber(line.itemType, line.itemNumber);
      if (!exactNumber && !baseNumber) return false;

      if (line.itemType === 'part' && line.colorId && line.colorId !== '0') {
        const itemColor = String(item.blColorId || item.colorId || '');
        if (itemColor && itemColor !== String(line.colorId)) return false;
      }

      if (line.inventoryId && item.bricklinkInventoryId && String(item.bricklinkInventoryId) === String(line.inventoryId)) return true;
      if (line.condition === 'N' && !['new_sealed', 'new_open'].includes(item.condition)) return false;
      if (line.condition === 'U' && !['used_complete', 'used_incomplete'].includes(item.condition)) return false;
      return true;
    };

    order.items.forEach(line => {
      let needed = Math.max(1, Number(line.quantity) || 1);
      const matches = availablePool
        .filter(candidate => matchesLine(candidate, line))
        .sort((a, b) => candidateScore(b, line) - candidateScore(a, line));
      const allocations = [];

      matches.forEach(candidate => {
        if (needed <= 0) return;
        const take = Math.min(candidate.remaining, needed);
        if (take <= 0) return;
        candidate.remaining -= take;
        needed -= take;
        allocations.push({ item: candidate.item, qtySold: take });
        importRows.push({
          item: candidate.item,
          qtySold: take,
          salePrice: Number(line.unitPrice) || 0,
          fees: 0,
          shippingCost: 0,
          platform: 'BrickLink',
          orderId: order.orderId,
          inventoryId: line.inventoryId,
        });
      });

      rows.push({
        ...line,
        allocations,
        matchedQty: allocations.reduce((sum, row) => sum + row.qtySold, 0),
        unmatchedQty: needed,
      });
    });

    return {
      rows,
      importRows,
      matchedCount: rows.filter(row => row.matchedQty > 0).length,
      unmatchedCount: rows.filter(row => row.unmatchedQty > 0).length,
    };
  }, [inventoryItems, normaliseTypeNumber]);

  // ─── Load saved Price Guide value for one listing ───
  const loadPriceGuideValue = React.useCallback((listing) => {
    const key = listing.inventory_id;
    setMarketPrices(prev => ({ ...prev, [key]: { status: 'loading' } }));

    const localItem = matchingLocalItem(listing);
    if (!localItem) {
      setMarketPrices(prev => ({ ...prev, [key]: { status: 'error', error: 'No matching local inventory item' } }));
      return;
    }

    const suggested = suggestedPrice(localItem);
    if (suggested == null) {
      setMarketPrices(prev => ({ ...prev, [key]: { status: 'done', suggested: null, source: 'local' } }));
      return;
    }

    setMarketPrices(prev => ({
      ...prev,
      [key]: {
        status: 'done',
        suggested,
        source: 'local',
        soldMedian: localItem.bricklinkMedian ?? null,
        activeMedian: localItem.bricklinkActiveMedian ?? null,
        activeAvg: localItem.bricklinkActive ?? null,
        soldQty: localItem.bricklinkSoldQty ?? null,
        activeQty: localItem.bricklinkActiveQty ?? null,
      },
    }));
  }, [matchingLocalItem]);

  // ─── Batch load all saved Price Guide values ───
  const loadAllPriceGuideValues = React.useCallback(async () => {
    if (!listings?.length) return;
    batchCancelRef.current = false;
    setBatchStatus('running');

    for (let i = 0; i < listings.length; i++) {
      if (batchCancelRef.current) { setBatchStatus('idle'); setBatchProgress(''); return; }
      const l = listings[i];
      setBatchProgress(`${i + 1} / ${listings.length} — ${l.item_number}`);
      loadPriceGuideValue(l);
      await new Promise(r => setTimeout(r, 0));
    }

    setBatchStatus('done');
    setBatchProgress('');
  }, [listings, loadPriceGuideValue]);

  // ─── Update price on BrickLink ───
  const updatePrice = React.useCallback(async (inventoryId, newPrice) => {
    setUpdateState(prev => ({ ...prev, [inventoryId]: { status: 'updating' } }));
    try {
      const resp = await fetch('/api/bricklink/store/update-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inventory_id: inventoryId, price: newPrice }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        setUpdateState(prev => ({ ...prev, [inventoryId]: { status: 'error', error: data.error || 'Update failed' } }));
        return;
      }
      // Update the local listings array so the "current price" column reflects the change immediately
      setListings(prev => prev.map(l =>
        l.inventory_id === inventoryId ? { ...l, price: newPrice } : l
      ));
      setMarketPrices(prev => {
        const existing = prev[inventoryId];
        if (!existing) return prev;
        return { ...prev, [inventoryId]: { ...existing, updatedPrice: newPrice } };
      });
      setPendingPrices(prev => { const n = { ...prev }; delete n[inventoryId]; return n; });
      setUpdateState(prev => ({ ...prev, [inventoryId]: { status: 'done' } }));
    } catch(e) {
      setUpdateState(prev => ({ ...prev, [inventoryId]: { status: 'error', error: e.message } }));
    }
  }, []);

  // ─── Remove listing from BrickLink ───
  const removeListing = React.useCallback(async (listing) => {
    const label = [listing.item_number, listing.description].filter(Boolean).join(' — ');
    if (!confirm(`Remove ${label || 'this item'} from your BrickLink store inventory?`)) return;

    const inventoryId = listing.inventory_id;
    setUpdateState(prev => ({ ...prev, [inventoryId]: { status: 'removing' } }));
    try {
      const resp = await fetch('/api/bricklink/store/remove-listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inventory_id: inventoryId }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        setUpdateState(prev => ({ ...prev, [inventoryId]: { status: 'error', error: data.error || 'Remove failed' } }));
        return;
      }
      setListings(prev => prev.filter(l => l.inventory_id !== inventoryId));
      setMarketPrices(prev => { const n = { ...prev }; delete n[inventoryId]; return n; });
      setPendingPrices(prev => { const n = { ...prev }; delete n[inventoryId]; return n; });
      setUpdateState(prev => { const n = { ...prev }; delete n[inventoryId]; return n; });
      const localItem = matchingLocalItem(listing);
      if (localItem && updateItems && confirm('Update the matching local inventory item now? This will remove BrickLink from its platform list and mark it available if it is not listed anywhere else.')) {
        updateItems(prev => prev.map(item => {
          if (item.id !== localItem.id) return item;
          const remainingPlatforms = String(item.platform || '')
            .split(/[,/;+]/)
            .map(p => p.trim())
            .filter(Boolean)
            .filter(p => {
              const key = p.toLowerCase().replace(/\s+/g, '');
              return key !== 'bricklink' && key !== 'bl';
            });
          const platformPrices = { ...(item.platformPrices || {}) };
          delete platformPrices.bricklink;
          return {
            ...item,
            sellStatus: remainingPlatforms.length ? 'listed' : 'available',
            platform: remainingPlatforms.join(', '),
            platformPrices,
            bricklinkInventoryId: '',
            updatedAt: new Date().toISOString(),
          };
        }));
      }
    } catch(e) {
      setUpdateState(prev => ({ ...prev, [inventoryId]: { status: 'error', error: e.message } }));
    }
  }, [matchingLocalItem, updateItems]);

  // ─── Bulk remove selected listings from BrickLink ───
  const removeSelectedListings = React.useCallback(async () => {
    const ids = [...selectedRemoveIds];
    if (!ids.length) return;
    if (!confirm(`Remove ${ids.length} selected listing${ids.length !== 1 ? 's' : ''} from your BrickLink store? This will not affect your local inventory.`)) return;
    for (const inventoryId of ids) {
      setUpdateState(prev => ({ ...prev, [inventoryId]: { status: 'removing' } }));
      try {
        const resp = await fetch('/api/bricklink/store/remove-listing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inventory_id: inventoryId }),
        });
        const data = await resp.json();
        if (!resp.ok || data.error) {
          setUpdateState(prev => ({ ...prev, [inventoryId]: { status: 'error', error: data.error || 'Remove failed' } }));
        } else {
          setListings(prev => prev.filter(l => l.inventory_id !== inventoryId));
          setMarketPrices(prev => { const n = { ...prev }; delete n[inventoryId]; return n; });
          setPendingPrices(prev => { const n = { ...prev }; delete n[inventoryId]; return n; });
          setUpdateState(prev => { const n = { ...prev }; delete n[inventoryId]; return n; });
          setSelectedRemoveIds(prev => { const n = new Set(prev); n.delete(inventoryId); return n; });
        }
      } catch(e) {
        setUpdateState(prev => ({ ...prev, [inventoryId]: { status: 'error', error: e.message } }));
      }
      await new Promise(r => setTimeout(r, 200));
    }
    setRemoveMode(false);
    setSelectedRemoveIds(new Set());
  }, [selectedRemoveIds]);

  // ─── Bulk update: apply suggested price to all listings that have market data ───
  const [bulkStatus, setBulkStatus] = React.useState('idle'); // idle|running|done
  const [bulkProgress, setBulkProgress] = React.useState('');
  const bulkCancelRef = React.useRef(false);

  const runBulkUpdate = React.useCallback(async (targets) => {
    bulkCancelRef.current = false;
    setBulkStatus('running');

    for (let i = 0; i < targets.length; i++) {
      if (bulkCancelRef.current) { setBulkStatus('idle'); setBulkProgress(''); return; }
      const { inventoryId, newPrice } = targets[i];
      setBulkProgress(`${i + 1} / ${targets.length}`);
      await updatePrice(inventoryId, newPrice);
      if (i < targets.length - 1) await new Promise(r => setTimeout(r, 300));
    }

    setBulkStatus('done');
    setBulkProgress('');
  }, [updatePrice]);

  // ─── Filtered + sorted listings ───
  const filtered = React.useMemo(() => {
    if (!listings) return [];
    const diffAbs = (listing) => {
      const mp = marketPrices[listing.inventory_id];
      return mp?.suggested != null ? Math.abs(mp.suggested - listing.price) : null;
    };
    const discrepancyRank = (listing) => {
      const d = diffAbs(listing);
      if (d == null) return 0;
      const pct = Number(listing.price) > 0 ? d / Number(listing.price) : Infinity;
      if (d >= 5 || pct >= 0.25) return 2;
      if (d >= 0.50) return 1;
      return 0;
    };
    let rows = listings;
    if (typeFilter !== 'all') rows = rows.filter(l => l.item_type === typeFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(l =>
        l.item_number?.toLowerCase().includes(q) ||
        l.color_name?.toLowerCase().includes(q) ||
        l.category_name?.toLowerCase().includes(q) ||
        l.description?.toLowerCase().includes(q)
      );
    }
    return [...rows].sort((a, b) => {
      const rankA = discrepancyRank(a);
      const rankB = discrepancyRank(b);
      if (rankA !== rankB) return rankB - rankA;
      if (rankA > 0) {
        const da = diffAbs(a) ?? 0;
        const db = diffAbs(b) ?? 0;
        if (da !== db) return db - da;
      }
      let va, vb;
      if (sortCol === 'suggested') {
        va = marketPrices[a.inventory_id]?.suggested ?? null;
        vb = marketPrices[b.inventory_id]?.suggested ?? null;
      } else if (sortCol === 'diff') {
        const ma = marketPrices[a.inventory_id];
        const mb = marketPrices[b.inventory_id];
        va = ma?.suggested != null ? ma.suggested - a.price : null;
        vb = mb?.suggested != null ? mb.suggested - b.price : null;
      } else {
        va = a[sortCol];
        vb = b[sortCol];
      }
      // Nulls last
      if (va == null && vb == null) return 0;
      if (va == null) return sortDir === 'asc' ? 1 : -1;
      if (vb == null) return sortDir === 'asc' ? -1 : 1;
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ?  1 : -1;
      return 0;
    });
  }, [listings, typeFilter, search, sortCol, sortDir, marketPrices]);

  const tableColSpan = 8 + (typeColumn ? 1 : 0) + (blIdColumn ? 1 : 0) + (colorColumn ? 1 : 0);
  const categoryLabel = (listing) => listing.category_name || (listing.category_id ? `Category ${listing.category_id}` : 'Uncategorized');
  const groupKey = (kind, value) => `${kind}:${value || 'blank'}`;
  const toggleGroup = (kind, value) => {
    const key = groupKey(kind, value);
    setCollapsedGroups(prev => ({ ...prev, [key]: !(key in prev ? prev[key] : true) }));
  };
  const grouped = React.useMemo(() => {
    const typeOrder = ['set', 'minifig', 'part', 'gear', 'book', 'catalog', 'instruction'];
    const rowRank = (listing) => {
      const mp = marketPrices[listing.inventory_id];
      if (mp?.suggested == null) return 0;
      const diff = Math.abs(mp.suggested - listing.price);
      const pct = Number(listing.price) > 0 ? diff / Number(listing.price) : Infinity;
      if (diff >= 5 || pct >= 0.25) return 2;
      if (diff >= 0.50) return 1;
      return 0;
    };
    const groupRank = (rows) => rows.reduce((max, row) => Math.max(max, rowRank(row)), 0);
    const typeMap = new Map();
    filtered.forEach(listing => {
      const type = listing.item_type || 'other';
      if (!typeMap.has(type)) typeMap.set(type, new Map());
      const cat = categoryLabel(listing);
      const cats = typeMap.get(type);
      if (!cats.has(cat)) cats.set(cat, []);
      cats.get(cat).push(listing);
    });
    return [...typeMap.entries()]
      .sort(([a, catsA], [b, catsB]) => {
        const ra = Math.max(...[...catsA.values()].map(groupRank));
        const rb = Math.max(...[...catsB.values()].map(groupRank));
        if (ra !== rb) return rb - ra;
        const ai = typeOrder.indexOf(a);
        const bi = typeOrder.indexOf(b);
        if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        return a.localeCompare(b);
      })
      .map(([type, cats]) => ({
        type,
        rows: [...cats.entries()]
          .sort(([a, rowsA], [b, rowsB]) => {
            const ra = groupRank(rowsA);
            const rb = groupRank(rowsB);
            if (ra !== rb) return rb - ra;
            return a.localeCompare(b);
          })
          .map(([category, rows]) => ({ category, rows })),
      }));
  }, [filtered, marketPrices]);

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const isFiltered = search.trim() || typeFilter !== 'all';

  const effectiveCollapsed = React.useMemo(() => {
    if (isFiltered) return {};
    const defaults = {};
    grouped.forEach(typeGroup => {
      const typeKey = groupKey('type', typeGroup.type);
      defaults[typeKey] = typeKey in collapsedGroups ? collapsedGroups[typeKey] : true;
      typeGroup.rows.forEach(({ category }) => {
        const catKey = groupKey('category', `${typeGroup.type}:${category}`);
        defaults[catKey] = catKey in collapsedGroups ? collapsedGroups[catKey] : true;
      });
    });
    return defaults;
  }, [isFiltered, grouped, collapsedGroups]);

  const expandAll  = () => {
    const all = {};
    grouped.forEach(tg => {
      all[groupKey('type', tg.type)] = false;
      tg.rows.forEach(({ category }) => { all[groupKey('category', `${tg.type}:${category}`)] = false; });
    });
    setCollapsedGroups(all);
  };
  const collapseAll = () => setCollapsedGroups({});
  const allExpanded = React.useMemo(() => {
    if (!grouped.length) return false;
    return grouped.every(tg =>
      collapsedGroups[groupKey('type', tg.type)] === false &&
      tg.rows.every(({ category }) => collapsedGroups[groupKey('category', `${tg.type}:${category}`)] === false)
    );
  }, [grouped, collapsedGroups]);

  // Price difference helpers
  const priceDiff = (listing) => {
    const mp = marketPrices[listing.inventory_id];
    if (!mp || mp.suggested == null) return null;
    return mp.suggested - listing.price;
  };

  const discrepancyLevel = React.useCallback((listing) => {
    const diff = priceDiff(listing);
    if (diff == null) return 'none';
    const abs = Math.abs(diff);
    const pct = Number(listing.price) > 0 ? abs / Number(listing.price) : Infinity;
    if (abs >= 5 || pct >= 0.25) return 'wide';
    if (abs >= 0.50) return 'stale';
    return 'none';
  }, [marketPrices]);

  const isUpdateCandidate = React.useCallback((listing) => {
    const mp = marketPrices[listing.inventory_id];
    return mp?.suggested != null && Math.abs(mp.suggested - listing.price) >= 0.50;
  }, [marketPrices]);

  const diffColor = (diff) => {
    if (diff == null) return 'var(--text3)';
    if (Math.abs(diff) < 0.50) return 'var(--text2)'; // within $0.50 — essentially matched
    return diff > 0 ? 'var(--green)' : 'var(--red)';
  };

  // Count listings that have market data and differ from suggested by > $0.50
  const stalePriceCount = React.useMemo(() => {
    if (!listings) return 0;
    return listings.filter(l => {
      return isUpdateCandidate(l);
    }).length;
  }, [listings, isUpdateCandidate]);

  const selectedUpdateTargets = React.useMemo(() => {
    if (!listings) return [];
    return listings
      .filter(l => selectedUpdateIds.has(l.inventory_id) && isUpdateCandidate(l))
      .map(l => ({ inventoryId: l.inventory_id, newPrice: marketPrices[l.inventory_id].suggested }));
  }, [listings, selectedUpdateIds, isUpdateCandidate, marketPrices]);

  const selectableUpdateIds = React.useMemo(() => (
    filtered.filter(isUpdateCandidate).map(l => l.inventory_id)
  ), [filtered, isUpdateCandidate]);

  const allVisibleCandidatesSelected = selectableUpdateIds.length > 0 && selectableUpdateIds.every(id => selectedUpdateIds.has(id));

  const toggleUpdateSelection = React.useCallback((inventoryId, checked) => {
    setSelectedUpdateIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(inventoryId);
      else next.delete(inventoryId);
      return next;
    });
  }, []);

  const setVisibleUpdateSelection = React.useCallback((checked) => {
    setSelectedUpdateIds(prev => {
      const next = new Set(prev);
      selectableUpdateIds.forEach(id => {
        if (checked) next.add(id);
        else next.delete(id);
      });
      return next;
    });
  }, [selectableUpdateIds]);

  const SortTH = ({ col, children, style = {} }) => (
    <th onClick={() => handleSort(col)}
      style={{ padding:'8px 12px', textAlign:'left', fontWeight:600, color:'var(--text2)',
        fontSize:11, textTransform:'uppercase', letterSpacing:'.4px',
        borderBottom:'1px solid var(--border)', whiteSpace:'nowrap',
        cursor:'pointer', userSelect:'none', ...style }}>
      {children}
      {sortCol === col && <span style={{marginLeft:4}}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );

  const typeLabel = (t) => ({ set:'Set', minifig:'Minifig', part:'Part' })[t] || t;
  const typeColor = (t) => ({
    set:    { bg:'rgba(246,199,0,.12)',     color:'var(--accent)' },
    minifig:{ bg:'rgba(231,138,76,.12)',    color:'var(--orange)' },
    part:   { bg:'rgba(76,140,231,.12)',    color:'var(--blue)'   },
  })[t] || { bg:'var(--surface2)', color:'var(--text2)' };
  const colorLabel = (listing) => {
    const id = String(listing.color_id || '');
    const name = listing.color_name || '';
    if (name && name !== '(Not Applicable)') return id && id !== '0' ? `${name} (${id})` : name;
    if (id && id !== '0') return `Color ${id}`;
    return '';
  };
  const hiddenMeta = (listing) => [
    !blIdColumn ? listing.item_number : null,
    !colorColumn ? colorLabel(listing) : null,
    listing.is_stock_room ? 'Stockroom' : null,
  ].filter(Boolean).join(' · ');
  const toggleOrderExpanded = React.useCallback((orderId) => {
    setExpandedOrders(prev => ({ ...prev, [orderId]: !prev[orderId] }));
  }, []);

  const convertOrderToSoldLot = React.useCallback((order) => {
    if (!order || !updateItems) return;
    const preview = orderImportPreview(order);
    if (!preview.importRows.length) {
      setOrderActionState(prev => ({ ...prev, [order.orderId]: { status: 'error', message: 'No matching local inventory items found.' } }));
      return;
    }

    let shippingCost = order.shippingCost;
    if (shippingCost == null || Number.isNaN(Number(shippingCost))) {
      const response = window.prompt(`BrickLink order #${order.orderId} does not include shipping in the API response. Enter shipping cost:`, '0');
      if (response == null) return;
      shippingCost = parseFloat(response);
      if (Number.isNaN(shippingCost) || shippingCost < 0) {
        alert('Enter a valid non-negative shipping cost.');
        return;
      }
    } else {
      shippingCost = Number(shippingCost) || 0;
    }

    let feeTotal = order.feeTotal;
    if (feeTotal == null || Number.isNaN(Number(feeTotal))) {
      const bricklinkPlatform = sellingPlatforms.find(p => String(p.id || '').toLowerCase() === 'bricklink')
        || sellingPlatforms.find(p => String(p.name || '').toLowerCase() === 'bricklink');
      if (bricklinkPlatform) {
        const pctFee = Number(bricklinkPlatform.pctFee) || 0;
        const flatFee = Number(bricklinkPlatform.flatFee) || 0;
        const subtotal = Number(order.subtotal) || preview.importRows.reduce((sum, row) => sum + ((Number(row.salePrice) || 0) * (Number(row.qtySold) || 0)), 0);
        feeTotal = Math.round(((subtotal * pctFee / 100) + flatFee) * 100) / 100;
      } else {
        const response = window.prompt(`BrickLink order #${order.orderId} does not include fees in the API response, and no BrickLink fee settings were found. Enter total BrickLink fees:`, '0');
        if (response == null) return;
        feeTotal = parseFloat(response);
        if (Number.isNaN(feeTotal) || feeTotal < 0) {
          alert('Enter a valid non-negative fee total.');
          return;
        }
      }
    } else {
      feeTotal = Number(feeTotal) || 0;
    }

    const unmatched = preview.rows.filter(row => row.unmatchedQty > 0);
    if (unmatched.length && !confirm(`Convert matched items from order #${order.orderId}? ${unmatched.length} order line${unmatched.length !== 1 ? 's are' : ' is'} not fully matched.`)) return;

    setOrderActionState(prev => ({ ...prev, [order.orderId]: { status: 'working', message: 'Converting order…' } }));
    const now = new Date().toISOString();
    const totalUnits = preview.importRows.reduce((sum, row) => sum + row.qtySold, 0) || 1;
    const totalSaleBasis = preview.importRows.reduce((sum, row) => sum + ((Number(row.salePrice) || 0) * (Number(row.qtySold) || 0)), 0);
    const soldInventoryIds = new Set(preview.rows.map(row => row.inventoryId).filter(Boolean).map(String));

    updateItems(prev => {
      const soldItems = prev.filter(existing => existing.sellStatus === 'sold');
      const activeMap = new Map(
        prev
          .filter(existing => existing.sellStatus !== 'sold')
          .map(existing => [existing.id, { ...existing }])
      );
      const importedSold = [];
      const noteParts = [
        `BrickLink order #${order.orderId}`,
        order.buyerName ? `buyer ${order.buyerName}` : '',
        order.dateOrdered ? new Date(order.dateOrdered).toLocaleString() : '',
        feeTotal ? `fees ${currency(feeTotal)}` : '',
        shippingCost ? `shipping ${currency(shippingCost)}` : '',
      ].filter(Boolean);

      for (const row of preview.importRows) {
        const current = activeMap.get(row.item.id);
        if (!current) continue;
        const total = Number(current.quantity) || 1;
        const soldNotes = [current.notes, noteParts.join(' | ')].filter(Boolean).join(current.notes ? ' | ' : '');
        const saleBasis = (Number(row.salePrice) || 0) * (Number(row.qtySold) || 0);
        const share = totalSaleBasis > 0
          ? saleBasis / totalSaleBasis
          : (Number(row.qtySold) || 0) / totalUnits;
        const saleRow = {
          ...current,
          quantity: row.qtySold,
          sellStatus: 'sold',
          salePrice: row.salePrice,
          fees: Math.round(feeTotal * share * 100) / 100,
          shippingCost: Math.round(shippingCost * share * 100) / 100,
          platform: 'BrickLink',
          notes: soldNotes,
          bricklinkOrderId: order.orderId,
          updatedAt: now,
        };

        if (row.qtySold >= total) {
          activeMap.delete(row.item.id);
          importedSold.push(saleRow);
        } else {
          activeMap.set(row.item.id, { ...current, quantity: total - row.qtySold, updatedAt: now });
          importedSold.push({ ...saleRow, id: genId(), createdAt: now });
        }
      }

      return [...Array.from(activeMap.values()), ...soldItems, ...importedSold];
    });

    setListings(prev => Array.isArray(prev) ? prev.filter(listing => !soldInventoryIds.has(String(listing.inventory_id))) : prev);
    setOrderActionState(prev => ({
      ...prev,
      [order.orderId]: { status: 'done', message: `Converted order #${order.orderId} to sold items.` },
    }));
  }, [orderImportPreview, sellingPlatforms, updateItems]);

  const printOrderPickList = React.useCallback((order) => {
    if (!order) return;
    const win = window.open('', '_blank', 'width=420,height=620');
    if (!win) {
      alert('Pop-up blocked. Please allow pop-ups to print the pick list.');
      return;
    }

    const allItems = order.items || [];
    const totalQty = allItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
    const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const shopName = esc(settings?.shopName || '');
    const orderId = esc(order.orderId || '');
    const buyerName = esc(order.buyerName || '—');
    const dateStr = order.dateOrdered ? new Date(order.dateOrdered).toLocaleString() : '';

    const styles = `
      @page { size: 4in 6in; margin: 0.15in; }
      body { font-family: Arial, sans-serif; margin: 0; color: #000; }
      .sheet { width: 3.7in; }
      .sheet:not(:last-child) { page-break-after: always; }
      .header { border-bottom: 1px solid #000; padding-bottom: 8px; margin-bottom: 8px; }
      .title { font-size: 16px; font-weight: 700; }
      .sub { font-size: 11px; margin-top: 3px; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      td { vertical-align: top; padding: 6px 0; border-bottom: 1px solid #ddd; }
      tr { page-break-inside: avoid; }
      .qty { width: 0.45in; font-size: 16px; font-weight: 700; text-align: center; }
      .name { font-weight: 700; line-height: 1.2; }
      .meta { color: #444; margin-top: 2px; line-height: 1.25; }
      .footer { margin-top: 10px; font-size: 10px; color: #444; }
    `;

    const rowHtml = (item) => `
      <tr>
        <td class="qty">${item.quantity || 0}</td>
        <td class="item">
          <div class="name">${esc(item.name || item.itemNumber)}</div>
          <div class="meta">${esc([item.itemNumber, item.colorName, typeLabel(item.itemType)].filter(Boolean).join(' · '))}</div>
        </td>
      </tr>`;

    const firstHeaderHtml = `
      <div class="header">
        ${shopName ? `<div class="title">${shopName}</div>` : ''}
        <div class="${shopName ? 'sub' : 'title'}">Pick List</div>
        <div class="sub">Order #${orderId}</div>
        <div class="sub">${buyerName}</div>
        <div class="sub">${dateStr}</div>
      </div>`;
    const contHeaderHtml = (pageNum, totalPages) => `
      <div class="header">
        ${shopName ? `<div class="title">${shopName}</div>` : ''}
        <div class="${shopName ? 'sub' : 'title'}">Pick List — Order #${orderId} continued (${pageNum}/${totalPages})</div>
      </div>`;
    const lastFooterHtml = (pageNum, totalPages) => `<div class="footer">Items: ${totalQty}${totalPages > 1 ? ` · Page ${pageNum}/${totalPages}` : ''}</div>`;
    const midFooterHtml = (pageNum, totalPages) => `<div class="footer">Page ${pageNum}/${totalPages}</div>`;

    // PAGE_CONTENT_HEIGHT_PX matches the .sheet content box: physical 6in page minus
    // 0.15in top/bottom margin = 5.7in, at the CSS-standard 96px/in.
    const PAGE_CONTENT_HEIGHT_PX = 5.7 * 96;
    const SAFETY_MARGIN_PX = 8;

    // Row and header/footer heights vary with item name/metadata length (wrapping),
    // so measure actual rendered heights in the print window rather than assuming a
    // fixed row count per page — a fixed count previously overflowed the physical
    // page whenever names wrapped to a second line, silently pushing extra content
    // onto trailing pages.
    win.document.open();
    win.document.write(`<!doctype html><html><head><style>${styles}
      #measure { position: absolute; top: -10000px; left: 0; visibility: hidden; }
      </style></head><body>
      <div id="measure">
        <div class="sheet"><div id="m-first-header">${firstHeaderHtml}</div></div>
        <div class="sheet"><div id="m-cont-header">${contHeaderHtml(2, 9)}</div></div>
        <div class="sheet"><div id="m-last-footer">${lastFooterHtml(9, 9)}</div></div>
        <div class="sheet"><div id="m-mid-footer">${midFooterHtml(2, 9)}</div></div>
        <table><tbody id="m-rows">${allItems.map(rowHtml).join('')}</tbody></table>
      </div>
      </body></html>`);
    win.document.close();

    const h = (id) => win.document.getElementById(id).getBoundingClientRect().height;
    const firstHeaderH = h('m-first-header');
    const contHeaderH  = h('m-cont-header');
    // The item-total footer only ever lands on the last page, but which page that is
    // isn't known until after chunking — so budget every page against the taller of
    // the two footer variants to guarantee whichever one lands there still fits.
    const footerH = Math.max(h('m-last-footer'), h('m-mid-footer'));
    const rowHeights = Array.from(win.document.querySelectorAll('#m-rows tr')).map(el => el.getBoundingClientRect().height);

    const availFirst = PAGE_CONTENT_HEIGHT_PX - firstHeaderH - footerH - SAFETY_MARGIN_PX;
    const availCont   = PAGE_CONTENT_HEIGHT_PX - contHeaderH  - footerH - SAFETY_MARGIN_PX;

    const pages = [];
    let current = [];
    let currentHeight = 0;
    for (let i = 0; i < allItems.length; i++) {
      const rowH = rowHeights[i] || 0;
      const avail = pages.length === 0 ? availFirst : availCont;
      if (current.length > 0 && currentHeight + rowH > avail) {
        pages.push(current);
        current = [];
        currentHeight = 0;
      }
      current.push(allItems[i]);
      currentHeight += rowH;
    }
    if (current.length > 0 || pages.length === 0) pages.push(current);
    const totalPages = pages.length;

    // Build pages in REVERSE order so the printer's face-down stack comes out correct
    const pageBlocks = [...pages].reverse().map((pageItems, revIdx) => {
      const pageNum = totalPages - revIdx; // actual page number
      const header = pageNum === 1 ? firstHeaderHtml : contHeaderHtml(pageNum, totalPages);
      const footer = pageNum === totalPages ? lastFooterHtml(pageNum, totalPages) : midFooterHtml(pageNum, totalPages);
      return `
        <div class="sheet">
          ${header}
          <table><tbody>${pageItems.map(rowHtml).join('')}</tbody></table>
          ${footer}
        </div>`;
    }).join('');

    win.document.open();
    win.document.write(`
      <!doctype html>
      <html>
      <head>
        <title>Pick List ${order.orderId}</title>
        <style>${styles}</style>
      </head>
      <body>${pageBlocks}</body>
      </html>
    `);
    win.document.close();
    win.focus();
    win.print();
  }, [typeLabel, settings]);

  // ─── Render ───
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden' }}>

      {/* ── Header bar ── */}
      <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:18, fontWeight:700, color:'var(--text)' }}>
            {activeTab === 'inventory' ? 'BrickLink Store Inventory' : 'BrickLink Orders'}
          </div>
          {activeTab === 'inventory' && lastLoaded && (
            <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>
              Last refreshed {lastLoaded.toLocaleTimeString()} · {listings?.length ?? 0} item{listings?.length !== 1 ? 's' : ''}
              {stalePriceCount > 0 && (
                <span style={{ marginLeft:8, color:'var(--orange)', fontWeight:600 }}>
                  · {stalePriceCount} price{stalePriceCount !== 1 ? 's' : ''} may need updating
                </span>
              )}
            </div>
          )}
          {activeTab === 'orders' && ordersLastLoaded && (
            <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>
              Last refreshed {ordersLastLoaded.toLocaleTimeString()} · {orders?.length ?? 0} order{orders?.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>

        <div className="tabs" style={{ marginBottom:0 }}>
          <div className={`tab ${activeTab==='inventory'?'active':''}`} onClick={() => setActiveTab('inventory')}>Inventory</div>
          <div className={`tab ${activeTab==='orders'?'active':''}`} onClick={() => setActiveTab('orders')}>Orders</div>
        </div>

        {activeTab === 'inventory' && loadState === 'done' && listings?.length > 0 && (
          <>
            {batchStatus === 'running' ? (
              <div style={{ fontSize:12, color:'var(--text2)', display:'flex', alignItems:'center', gap:8 }}>
                <span>🔄 Loading guide prices… {batchProgress}</span>
                <button className="btn btn-secondary btn-sm" onClick={() => { batchCancelRef.current = true; }}>Stop</button>
              </div>
            ) : (
              <button className="btn btn-secondary btn-sm"
                style={{ fontSize:12, display:'flex', alignItems:'center', gap:5 }}
                onClick={loadAllPriceGuideValues}
                title="Load saved Price Guide values from matching local inventory items">
                📊 Load Price Guide Values
              </button>
            )}

            {stalePriceCount > 0 && bulkStatus !== 'running' && (
              <>
                <button className="btn btn-secondary btn-sm"
                  style={{ fontSize:12, display:'flex', alignItems:'center', gap:5 }}
                  disabled={selectableUpdateIds.length === 0}
                  onClick={() => setVisibleUpdateSelection(!allVisibleCandidatesSelected)}
                  title="Check or uncheck stale listings in the current filtered view">
                  {allVisibleCandidatesSelected ? '☐ Uncheck Visible' : `☑ Check Visible Stale (${selectableUpdateIds.length})`}
                </button>
                <button className="btn btn-primary btn-sm"
                  style={{ fontSize:12, display:'flex', alignItems:'center', gap:5 }}
                  disabled={selectedUpdateTargets.length === 0}
                  onClick={() => {
                    if (selectedUpdateTargets.length === 0) return;
                    if (!confirm(`Update ${selectedUpdateTargets.length} checked listing price${selectedUpdateTargets.length !== 1 ? 's' : ''} on BrickLink to match suggested prices?`)) return;
                    runBulkUpdate(selectedUpdateTargets);
                  }}
                  title="Update checked stale prices to their suggested values">
                  ⚡ Update Checked ({selectedUpdateTargets.length})
                </button>
              </>
            )}
            {bulkStatus === 'running' && (
              <div style={{ fontSize:12, color:'var(--text2)', display:'flex', alignItems:'center', gap:8 }}>
                <span>⚡ Updating… {bulkProgress}</span>
                <button className="btn btn-secondary btn-sm" onClick={() => { bulkCancelRef.current = true; }}>Stop</button>
              </div>
            )}
          </>
        )}

        {activeTab === 'inventory' && loadState === 'done' && listings?.length > 0 && (
          removeMode ? (
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <button className="btn btn-danger btn-sm"
                style={{ fontSize:12 }}
                disabled={selectedRemoveIds.size === 0}
                onClick={removeSelectedListings}>
                🗑 Remove Selected ({selectedRemoveIds.size})
              </button>
              <button className="btn btn-secondary btn-sm"
                style={{ fontSize:12 }}
                onClick={() => { setRemoveMode(false); setSelectedRemoveIds(new Set()); }}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="btn btn-secondary btn-sm"
              style={{ fontSize:12 }}
              onClick={() => setRemoveMode(true)}>
              🗑 Select to Remove
            </button>
          )
        )}

        <button className="btn btn-secondary btn-sm"
          style={{ fontSize:12, display:'flex', alignItems:'center', gap:5 }}
          disabled={activeTab === 'inventory' ? loadState === 'loading' : ordersLoadState === 'loading'}
          onClick={activeTab === 'inventory' ? loadStore : loadOrders}>
          {activeTab === 'inventory'
            ? (loadState === 'loading' ? '🔄 Loading…' : '↻ Refresh Store')
            : (ordersLoadState === 'loading' ? '🔄 Loading…' : '↻ Refresh Orders')}
        </button>
      </div>

      {/* ── Filters ── */}
      {activeTab === 'inventory' && loadState === 'done' && listings?.length > 0 && (
        <div style={{ padding:'8px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:10, background:'var(--surface)' }}>
          <input
            placeholder="Search item #, category, color, or description…"
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ fontSize:12, padding:'5px 10px', width:220 }}
          />
          {!isFiltered && (
            <button className="btn btn-secondary btn-sm" style={{ whiteSpace:'nowrap', flexShrink:0 }}
              onClick={allExpanded ? collapseAll : expandAll}
              title={allExpanded ? 'Collapse all categories' : 'Expand all categories'}>
              {allExpanded ? '⊟ Collapse All' : '⊞ Expand All'}
            </button>
          )}
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
            style={{ fontSize:12, padding:'5px 8px' }}>
            <option value="all">All types</option>
            <option value="set">Sets</option>
            <option value="minifig">Minifigs</option>
            <option value="part">Parts</option>
          </select>
          <div style={{ marginLeft:'auto', fontSize:11, color:'var(--text3)' }}>
            {filtered.length} of {listings.length} listing{listings.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}

      {/* ── Body ── */}
      <div style={{ flex:1, overflowY:'auto' }}>

        {/* Not configured */}
        {!blConfigured && (
          <div style={{ padding:'48px 24px', textAlign:'center', color:'var(--text3)' }}>
            <div style={{ fontSize:36, marginBottom:12, opacity:.4 }}>🔑</div>
            <div style={{ fontSize:14, fontWeight:600, marginBottom:6 }}>BrickLink API not configured</div>
            <div style={{ fontSize:12 }}>Go to Configuration and set up your BrickLink API credentials first.</div>
          </div>
        )}

        {/* Idle — not loaded yet */}
        {blConfigured && activeTab === 'inventory' && loadState === 'idle' && (
          <div style={{ padding:'48px 24px', textAlign:'center', color:'var(--text3)' }}>
            <div style={{ fontSize:36, marginBottom:12, opacity:.4 }}>🏪</div>
            <div style={{ fontSize:14, fontWeight:600, marginBottom:10 }}>Your BrickLink store inventory</div>
            <div style={{ fontSize:12, marginBottom:20 }}>Click Refresh Store to load your current BrickLink inventory.</div>
            <button className="btn btn-primary" onClick={loadStore}>Load Store Inventory</button>
          </div>
        )}

        {blConfigured && activeTab === 'orders' && ordersLoadState === 'idle' && (
          <div style={{ padding:'48px 24px', textAlign:'center', color:'var(--text3)' }}>
            <div style={{ fontSize:36, marginBottom:12, opacity:.4 }}>📦</div>
            <div style={{ fontSize:14, fontWeight:600, marginBottom:10 }}>Your BrickLink orders</div>
            <div style={{ fontSize:12, marginBottom:20 }}>Click Refresh Orders to load recent incoming BrickLink orders.</div>
            <button className="btn btn-primary" onClick={loadOrders}>Load Orders</button>
          </div>
        )}

        {/* Loading */}
        {activeTab === 'inventory' && loadState === 'loading' && (
          <div style={{ padding:'48px 24px', textAlign:'center', color:'var(--text2)' }}>
            <div style={{ fontSize:24, marginBottom:12 }}>🔄</div>
            <div style={{ fontSize:13 }}>Loading store inventory from BrickLink...</div>
          </div>
        )}

        {activeTab === 'orders' && ordersLoadState === 'loading' && (
          <div style={{ padding:'48px 24px', textAlign:'center', color:'var(--text2)' }}>
            <div style={{ fontSize:24, marginBottom:12 }}>🔄</div>
            <div style={{ fontSize:13 }}>Loading orders from BrickLink...</div>
          </div>
        )}

        {/* Error */}
        {activeTab === 'inventory' && loadState === 'error' && (
          <div style={{ padding:'48px 24px', textAlign:'center' }}>
            <div style={{ fontSize:36, marginBottom:12, opacity:.5 }}>⚠️</div>
            <div style={{ fontSize:14, fontWeight:600, color:'var(--red)', marginBottom:8 }}>Failed to load store</div>
            <div style={{ fontSize:12, color:'var(--text2)', marginBottom:20 }}>{loadError}</div>
            <button className="btn btn-secondary" onClick={loadStore}>Try Again</button>
          </div>
        )}

        {activeTab === 'orders' && ordersLoadState === 'error' && (
          <div style={{ padding:'48px 24px', textAlign:'center' }}>
            <div style={{ fontSize:36, marginBottom:12, opacity:.5 }}>⚠️</div>
            <div style={{ fontSize:14, fontWeight:600, color:'var(--red)', marginBottom:8 }}>Failed to load orders</div>
            <div style={{ fontSize:12, color:'var(--text2)', marginBottom:20 }}>{ordersLoadError}</div>
            <button className="btn btn-secondary" onClick={loadOrders}>Try Again</button>
          </div>
        )}

        {/* Empty store */}
        {activeTab === 'inventory' && loadState === 'done' && listings?.length === 0 && (
          <div style={{ padding:'48px 24px', textAlign:'center', color:'var(--text3)' }}>
            <div style={{ fontSize:36, marginBottom:12, opacity:.4 }}>📭</div>
            <div style={{ fontSize:14, fontWeight:600, marginBottom:6 }}>No listings found</div>
            <div style={{ fontSize:12 }}>Your BrickLink store inventory did not return any items.</div>
          </div>
        )}

        {activeTab === 'orders' && ordersLoadState === 'done' && orders?.length === 0 && (
          <div style={{ padding:'48px 24px', textAlign:'center', color:'var(--text3)' }}>
            <div style={{ fontSize:36, marginBottom:12, opacity:.4 }}>📭</div>
            <div style={{ fontSize:14, fontWeight:600, marginBottom:6 }}>No orders found</div>
            <div style={{ fontSize:12 }}>BrickLink did not return any recent incoming orders.</div>
          </div>
        )}

        {/* Table */}
        {activeTab === 'inventory' && loadState === 'done' && listings?.length > 0 && (
          <>
          {!typeColumn && (
            <div style={{ padding:'8px 20px', borderBottom:'1px solid var(--border)', fontSize:11, color:'var(--text3)', display:'flex', alignItems:'center', gap:14, flexWrap:'wrap' }}>
              <span>Item type colors:</span>
              {['set','minifig','part'].map(t => {
                const tc = typeColor(t);
                return <span key={t} style={{ color:tc.color, fontWeight:600 }}>{typeLabel(t)}</span>;
              })}
            </div>
          )}
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ background:'var(--surface2)', position:'sticky', top:0, zIndex:1 }}>
                <th style={{ padding:'8px 10px', borderBottom:'1px solid var(--border)', width:34, textAlign:'center' }}>
                  {removeMode ? (
                    <input
                      type="checkbox"
                      checked={filtered.length > 0 && filtered.every(l => selectedRemoveIds.has(l.inventory_id))}
                      onChange={e => {
                        setSelectedRemoveIds(prev => {
                          const next = new Set(prev);
                          filtered.forEach(l => e.target.checked ? next.add(l.inventory_id) : next.delete(l.inventory_id));
                          return next;
                        });
                      }}
                      title="Check all visible listings for removal"
                      style={{ cursor:'pointer', accentColor:'var(--red)' }}
                    />
                  ) : (
                    <input
                      type="checkbox"
                      checked={allVisibleCandidatesSelected}
                      disabled={selectableUpdateIds.length === 0}
                      onChange={e => setVisibleUpdateSelection(e.target.checked)}
                      title="Check all stale listings in the current filtered view"
                      style={{ cursor: selectableUpdateIds.length ? 'pointer' : 'not-allowed', accentColor:'var(--accent)' }}
                    />
                  )}
                </th>
                {typeColumn && <SortTH col="item_type">Type</SortTH>}
                {blIdColumn && <SortTH col="item_number">Item #</SortTH>}
                {colorColumn && <SortTH col="color_name">Color</SortTH>}
                <SortTH col="description">Description</SortTH>
                <SortTH col="condition" style={{ textAlign:'center' }}>Cond.</SortTH>
                <SortTH col="quantity"  style={{ textAlign:'right' }}>Qty</SortTH>
                <SortTH col="price"     style={{ textAlign:'right' }}>Your Price</SortTH>
                <SortTH col="suggested" style={{ textAlign:'right' }}>Suggested</SortTH>
                <SortTH col="diff"      style={{ textAlign:'right' }}>Diff</SortTH>
                <th style={{ padding:'8px 12px', borderBottom:'1px solid var(--border)', whiteSpace:'nowrap', fontSize:11, textTransform:'uppercase', letterSpacing:'.4px', color:'var(--text2)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(typeGroup => {
                const typeRows = typeGroup.rows.flatMap(g => g.rows);
                const typeQty = typeRows.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
                const typeCollapsed = !!effectiveCollapsed[groupKey('type', typeGroup.type)];
                const tc = typeColor(typeGroup.type);
                return (
                  <React.Fragment key={`type-${typeGroup.type}`}>
                    <tr>
                      <td colSpan={tableColSpan}
                        onClick={() => toggleGroup('type', typeGroup.type)}
                        style={{ padding:'8px 20px', background:'var(--surface2)', borderBottom:'1px solid var(--border)', cursor:'pointer', userSelect:'none' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <span style={{ color:'var(--text3)', fontSize:12, width:12 }}>{typeCollapsed ? '▶' : '▼'}</span>
                          <span style={{ fontWeight:700, color:tc.color }}>{typeLabel(typeGroup.type)}</span>
                          <span style={{ fontSize:11, color:'var(--text3)' }}>{typeRows.length} listing{typeRows.length !== 1 ? 's' : ''} · {typeQty} item{typeQty !== 1 ? 's' : ''}</span>
                        </div>
                      </td>
                    </tr>
                    {!typeCollapsed && typeGroup.rows.map(categoryGroup => {
                      const categoryKey = `${typeGroup.type}:${categoryGroup.category}`;
                      const categoryCollapsed = !!effectiveCollapsed[groupKey('category', categoryKey)];
                      const categoryQty = categoryGroup.rows.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
                      return (
                        <React.Fragment key={`category-${categoryKey}`}>
                          <tr>
                            <td style={{ padding:'6px 10px', background:'rgba(0,0,0,.03)', borderBottom:'1px solid var(--border)', textAlign:'center', width:34 }}
                              onClick={e => e.stopPropagation()}>
                              {removeMode ? (
                                <input type="checkbox"
                                  checked={categoryGroup.rows.length > 0 && categoryGroup.rows.every(l => selectedRemoveIds.has(l.inventory_id))}
                                  onChange={e => {
                                    setSelectedRemoveIds(prev => {
                                      const next = new Set(prev);
                                      categoryGroup.rows.forEach(l => e.target.checked ? next.add(l.inventory_id) : next.delete(l.inventory_id));
                                      return next;
                                    });
                                  }}
                                  title={`Check all in ${categoryGroup.category} for removal`}
                                  style={{ cursor:'pointer', accentColor:'var(--red)' }}
                                />
                              ) : (
                                <input type="checkbox"
                                  checked={categoryGroup.rows.filter(isUpdateCandidate).length > 0 && categoryGroup.rows.filter(isUpdateCandidate).every(l => selectedUpdateIds.has(l.inventory_id))}
                                  disabled={categoryGroup.rows.filter(isUpdateCandidate).length === 0}
                                  onChange={e => {
                                    setSelectedUpdateIds(prev => {
                                      const next = new Set(prev);
                                      categoryGroup.rows.filter(isUpdateCandidate).forEach(l => e.target.checked ? next.add(l.inventory_id) : next.delete(l.inventory_id));
                                      return next;
                                    });
                                  }}
                                  title={`Check all stale in ${categoryGroup.category}`}
                                  style={{ cursor: categoryGroup.rows.filter(isUpdateCandidate).length ? 'pointer' : 'not-allowed', accentColor:'var(--accent)' }}
                                />
                              )}
                            </td>
                            <td colSpan={tableColSpan - 1}
                              onClick={() => toggleGroup('category', categoryKey)}
                              style={{ padding:'6px 20px 6px 10px', background:'rgba(0,0,0,.03)', borderBottom:'1px solid var(--border)', cursor:'pointer', userSelect:'none' }}>
                              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                                <span style={{ color:'var(--text3)', fontSize:11, width:12 }}>{categoryCollapsed ? '▶' : '▼'}</span>
                                <span style={{ fontWeight:600, color:'var(--text2)' }}>{categoryGroup.category}</span>
                                <span style={{ fontSize:11, color:'var(--text3)' }}>{categoryGroup.rows.length} listing{categoryGroup.rows.length !== 1 ? 's' : ''} · {categoryQty} item{categoryQty !== 1 ? 's' : ''}</span>
                              </div>
                            </td>
                          </tr>
                          {!categoryCollapsed && categoryGroup.rows.map((listing, idx) => {
                const mp     = marketPrices[listing.inventory_id];
                const us     = updateState[listing.inventory_id];
                const diff   = priceDiff(listing);
                const dc     = diffColor(diff);
                const pending = pendingPrices[listing.inventory_id];
                const { bg, color } = typeColor(listing.item_type);
                const meta = hiddenMeta(listing);
                const listingColor = colorLabel(listing);
                const canBatchUpdate = isUpdateCandidate(listing);
                const discrepancy = discrepancyLevel(listing);
                const rowBackground = discrepancy === 'wide'
                  ? 'rgba(231,76,76,.14)'
                  : discrepancy === 'stale'
                    ? 'rgba(246,199,0,.09)'
                    : idx%2===0 ? 'transparent' : 'rgba(0,0,0,.025)';

                // Match against local inventory
                const localItem = matchingLocalItem(listing);

                return (
                  <tr key={listing.inventory_id}
                    style={{
                      background: rowBackground,
                      borderBottom:'1px solid var(--border)',
                      boxShadow: discrepancy === 'wide' ? 'inset 3px 0 0 var(--red)' : discrepancy === 'stale' ? 'inset 3px 0 0 var(--accent)' : undefined,
                      cursor: localItem ? 'pointer' : 'default',
                    }}
                    onClick={() => { if (localItem) setDetailItem(localItem); }}>

                    <td style={{ padding:'8px 10px', textAlign:'center', whiteSpace:'nowrap' }} onClick={e => e.stopPropagation()}>
                      {removeMode ? (
                        <input
                          type="checkbox"
                          checked={selectedRemoveIds.has(listing.inventory_id)}
                          onChange={e => {
                            setSelectedRemoveIds(prev => {
                              const next = new Set(prev);
                              e.target.checked ? next.add(listing.inventory_id) : next.delete(listing.inventory_id);
                              return next;
                            });
                          }}
                          title="Mark for removal from BrickLink store"
                          style={{ cursor:'pointer', accentColor:'var(--red)' }}
                        />
                      ) : (
                        <input
                          type="checkbox"
                          checked={canBatchUpdate && selectedUpdateIds.has(listing.inventory_id)}
                          disabled={!canBatchUpdate || bulkStatus === 'running'}
                          onChange={e => toggleUpdateSelection(listing.inventory_id, e.target.checked)}
                          title={canBatchUpdate ? 'Include this listing in the checked batch update' : 'Load guide values first; only stale prices can be checked'}
                          style={{ cursor: canBatchUpdate && bulkStatus !== 'running' ? 'pointer' : 'not-allowed', accentColor:'var(--accent)' }}
                        />
                      )}
                    </td>

                    {/* Type badge */}
                    {typeColumn && (
                    <td style={{ padding:'8px 12px', whiteSpace:'nowrap' }}>
                      <span style={{ fontSize:10, fontWeight:600, padding:'2px 6px', borderRadius:4, background:bg, color }}>{typeLabel(listing.item_type)}</span>
                    </td>
                    )}

                    {/* Item # */}
                    {blIdColumn && (
                    <td style={{ padding:'8px 12px', whiteSpace:'nowrap' }}>
                      <a href={bricklinkUrl({ type: listing.item_type, itemNumber: listing.item_number })}
                        target="_blank" rel="noopener"
                        style={{ color:'var(--accent)', textDecoration:'none', fontWeight:500 }}>
                        {listing.item_number}
                      </a>
                      {localItem && (
                        <span title="In your inventory" style={{ marginLeft:5, fontSize:10, color:'var(--green)', opacity:.8 }}>●</span>
                      )}
                    </td>
                    )}

                    {/* Color */}
                    {colorColumn && (
                    <td style={{ padding:'8px 12px', color:'var(--text2)', whiteSpace:'nowrap' }}>
                      {listingColor || <span style={{ color:'var(--text3)' }}>—</span>}
                    </td>
                    )}

                    {/* Description */}
                    <td style={{ padding:'8px 12px', color:'var(--text2)', maxWidth:280, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      <span style={{ color: typeColumn ? 'var(--text2)' : color, fontWeight: typeColumn ? 400 : 600 }}>
                        {listing.description || <span style={{ color:'var(--text3)' }}>—</span>}
                      </span>
                      {localItem && !blIdColumn && (
                        <span title="In your inventory" style={{ marginLeft:5, fontSize:10, color:'var(--green)', opacity:.8 }}>●</span>
                      )}
                      {meta && (
                        <>
                          <br />
                          <span style={{ fontSize:11, color:'var(--text3)' }}>{meta}</span>
                        </>
                      )}
                    </td>

                    {/* Condition */}
                    <td style={{ padding:'8px 12px', textAlign:'center', whiteSpace:'nowrap' }}>
                      <span style={{ fontSize:11, fontWeight:600, color: listing.condition==='N' ? 'var(--blue)' : 'var(--text2)' }}>
                        {listing.condition === 'N' ? 'New' : 'Used'}
                      </span>
                    </td>

                    {/* Qty */}
                    <td style={{ padding:'8px 12px', textAlign:'right', fontWeight:600 }}>{listing.quantity}</td>

                    {/* Your price — editable */}
                    <td style={{ padding:'8px 6px', textAlign:'right', whiteSpace:'nowrap' }}>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', gap:4 }}>
                        <span style={{ fontWeight:600 }}>{currency(listing.price)}</span>
                      </div>
                    </td>

                    {/* Suggested price */}
                    <td style={{ padding:'8px 12px', textAlign:'right', whiteSpace:'nowrap' }}>
                      {!mp || mp.status === 'idle' ? (
                        <button className="btn btn-secondary btn-sm"
                          style={{ fontSize:10, padding:'2px 7px' }}
                          onClick={() => loadPriceGuideValue(listing)}>
                          Price Guide
                        </button>
                      ) : mp.status === 'loading' ? (
                        <span style={{ fontSize:11, color:'var(--text3)' }}>…</span>
                      ) : mp.status === 'error' ? (
                        <span style={{ fontSize:11, color:'var(--red)' }} title={mp.error}>err</span>
                      ) : mp.suggested != null ? (
                        <div title={[
                          mp.soldMedian != null ? `Sold median: ${currency(mp.soldMedian)}${mp.soldQty != null ? ` (${mp.soldQty} sold)` : ''}` : null,
                          mp.activeMedian != null ? `Active median: ${currency(mp.activeMedian)}${mp.activeQty != null ? ` (${mp.activeQty} listed)` : ''}` : null,
                          mp.activeAvg != null ? `Active avg: ${currency(mp.activeAvg)}` : null,
                        ].filter(Boolean).join('\n')}>
                          <div style={{ fontWeight:600, color:'var(--accent)' }}>{currency(mp.suggested)}</div>
                          <div style={{ fontSize:10, color:'var(--text3)' }}>guide</div>
                        </div>
                      ) : (
                        <span style={{ fontSize:11, color:'var(--text3)' }}>—</span>
                      )}
                    </td>

                    {/* Price diff */}
                    <td style={{ padding:'8px 12px', textAlign:'right', whiteSpace:'nowrap' }}>
                      {diff != null ? (
                        <div>
                          <span style={{ fontWeight:700, color:dc, fontSize:12 }}>
                            {diff >= 0 ? '+' : ''}{currency(diff)}
                          </span>
                          {discrepancy === 'wide' && (
                            <div style={{ fontSize:10, color:'var(--red)', fontWeight:700, marginTop:2 }}>wide</div>
                          )}
                        </div>
                      ) : (
                        <span style={{ color:'var(--text3)', fontSize:11 }}>—</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td style={{ padding:'8px 12px', whiteSpace:'nowrap' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder={mp?.suggested != null ? mp.suggested.toFixed(2) : listing.price.toFixed(2)}
                          value={pending ?? ''}
                          onChange={e => setPendingPrices(prev => ({ ...prev, [listing.inventory_id]: e.target.value }))}
                          style={{ width:72, fontSize:12, padding:'3px 6px', textAlign:'right' }}
                          title="New BrickLink price" />
                        {mp?.suggested != null && (
                          <button className="btn btn-secondary btn-sm"
                            style={{ fontSize:11, padding:'3px 7px', whiteSpace:'nowrap' }}
                            onClick={() => setPendingPrices(prev => ({ ...prev, [listing.inventory_id]: mp.suggested.toFixed(2) }))}
                            title="Use suggested Price Guide value">
                            Use
                          </button>
                        )}
                        <button
                          className="btn btn-primary btn-sm"
                          style={{ fontSize:11, padding:'3px 8px', whiteSpace:'nowrap' }}
                          disabled={us?.status === 'updating' || us?.status === 'removing'}
                          onClick={() => {
                            const val = parseFloat(pending ?? (mp?.suggested ?? '')) ;
                            if (!val || val <= 0) { alert('Enter a valid price, or load Price Guide and click Use.'); return; }
                            updatePrice(listing.inventory_id, val);
                          }}>
                          {us?.status === 'updating' ? '…' : 'Update'}
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          style={{ fontSize:11, padding:'3px 8px', whiteSpace:'nowrap' }}
                          disabled={us?.status === 'updating' || us?.status === 'removing'}
                          onClick={() => removeListing(listing)}
                          title="Remove this item from BrickLink store inventory">
                          {us?.status === 'removing' ? '…' : 'Remove'}
                        </button>
                        {us?.status === 'done' && (
                          <span style={{ fontSize:11, color:'var(--green)', fontWeight:600 }}>✓ Updated</span>
                        )}
                        {us?.status === 'error' && (
                          <span style={{ fontSize:11, color:'var(--red)' }} title={us.error}>⚠ Failed</span>
                        )}
                        {/* No action needed — price is close */}
                        {mp?.suggested != null && Math.abs(diff) < 0.50 && !pending && us?.status !== 'done' && (
                          <span style={{ fontSize:11, color:'var(--text3)' }}>✓ On target</span>
                        )}
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
          </>
        )}

        {activeTab === 'orders' && ordersLoadState === 'done' && orders?.length > 0 && (
          <div style={{ padding:'12px 20px 20px' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ background:'var(--surface2)', position:'sticky', top:0, zIndex:1 }}>
                  <th style={{ padding:'8px 12px', borderBottom:'1px solid var(--border)', textAlign:'left' }}>Order</th>
                  <th style={{ padding:'8px 12px', borderBottom:'1px solid var(--border)', textAlign:'left' }}>Buyer</th>
                  <th style={{ padding:'8px 12px', borderBottom:'1px solid var(--border)', textAlign:'left' }}>Status</th>
                  <th style={{ padding:'8px 12px', borderBottom:'1px solid var(--border)', textAlign:'right' }}>Lines</th>
                  <th style={{ padding:'8px 12px', borderBottom:'1px solid var(--border)', textAlign:'right' }}>Total</th>
                  <th style={{ padding:'8px 12px', borderBottom:'1px solid var(--border)', textAlign:'left' }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order, idx) => {
                  const expanded = !!expandedOrders[order.orderId];
                  const preview = orderImportPreview(order);
                  const orderState = orderActionState[order.orderId];
                  return (
                    <React.Fragment key={order.orderId}>
                      <tr
                        onClick={() => toggleOrderExpanded(order.orderId)}
                        style={{ cursor:'pointer', background: idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,.025)', borderBottom:'1px solid var(--border)' }}>
                        <td style={{ padding:'10px 12px', fontWeight:600 }}>
                          <span style={{ color:'var(--text3)', display:'inline-block', width:16 }}>{expanded ? '▼' : '▶'}</span>
                          #{order.orderId}
                        </td>
                        <td style={{ padding:'10px 12px' }}>
                          <div>{order.buyerName || '—'}</div>
                          {order.buyerEmail && <div style={{ fontSize:11, color:'var(--text3)' }}>{order.buyerEmail}</div>}
                        </td>
                        <td style={{ padding:'10px 12px' }}>
                          <div>{order.status || '—'}</div>
                          {order.paymentStatus && <div style={{ fontSize:11, color:'var(--text3)' }}>{order.paymentStatus}</div>}
                        </td>
                        <td style={{ padding:'10px 12px', textAlign:'right' }}>{order.uniqueCount || order.items?.length || 0}</td>
                        <td style={{ padding:'10px 12px', textAlign:'right', fontWeight:600 }}>{currency(order.grandTotal)}</td>
                        <td style={{ padding:'10px 12px', color:'var(--text2)' }}>
                          {order.dateOrdered ? new Date(order.dateOrdered).toLocaleString() : '—'}
                        </td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={6} style={{ padding:'0 12px 12px 28px', borderBottom:'1px solid var(--border)', background:'rgba(0,0,0,.03)' }}>
                            {order.detailError ? (
                              <div style={{ paddingTop:10, fontSize:12, color:'var(--red)' }}>{order.detailError}</div>
                            ) : (
                              <>
                                <div style={{ padding:'10px 0 8px', fontSize:11, color:'var(--text3)', display:'flex', gap:16, flexWrap:'wrap' }}>
                                  <span>Subtotal: {currency(order.subtotal)}</span>
                                  {order.shippingCost != null && <span>Shipping: {currency(order.shippingCost)}</span>}
                                  {order.paymentMethod && <span>Payment: {order.paymentMethod}</span>}
                                  <span>Matched: {preview.matchedCount}/{preview.rows.length}</span>
                                  {preview.unmatchedCount > 0 && <span style={{ color:'var(--orange)', fontWeight:600 }}>{preview.unmatchedCount} unmatched</span>}
                                </div>
                                <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:10 }}>
                                  <button className="btn btn-primary btn-sm"
                                    onClick={() => convertOrderToSoldLot(order)}
                                    disabled={!preview.importRows.length || orderState?.status === 'working'}>
                                    {orderState?.status === 'working' ? 'Converting…' : `Convert to Sold Lot (${preview.importRows.length})`}
                                  </button>
                                  <button className="btn btn-secondary btn-sm" onClick={() => printOrderPickList(order)}>
                                    Print 4x6 Pick List
                                  </button>
                                  {orderState?.message && (
                                    <span style={{ fontSize:11, color: orderState.status === 'done' ? 'var(--green)' : 'var(--red)' }}>
                                      {orderState.message}
                                    </span>
                                  )}
                                </div>
                                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                                  <thead>
                                    <tr>
                                      <th style={{ padding:'6px 8px', borderBottom:'1px solid var(--border)', textAlign:'left' }}>Item</th>
                                      <th style={{ padding:'6px 8px', borderBottom:'1px solid var(--border)', textAlign:'left' }}>Type</th>
                                      <th style={{ padding:'6px 8px', borderBottom:'1px solid var(--border)', textAlign:'left' }}>Color</th>
                                      <th style={{ padding:'6px 8px', borderBottom:'1px solid var(--border)', textAlign:'right' }}>Qty</th>
                                      <th style={{ padding:'6px 8px', borderBottom:'1px solid var(--border)', textAlign:'right' }}>Unit</th>
                                      <th style={{ padding:'6px 8px', borderBottom:'1px solid var(--border)', textAlign:'left' }}>Local Match</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {preview.rows.map((item, itemIdx) => (
                                      <tr key={`${order.orderId}-${item.itemNumber}-${itemIdx}`} style={{ borderTop:'1px solid var(--border)' }}>
                                        <td style={{ padding:'6px 8px' }}>
                                          <div style={{ fontWeight:600 }}>{item.name || item.itemNumber}</div>
                                          <div style={{ fontSize:11, color:'var(--text3)' }}>{item.itemNumber}</div>
                                        </td>
                                        <td style={{ padding:'6px 8px', color:'var(--text2)' }}>{typeLabel(item.itemType)}</td>
                                        <td style={{ padding:'6px 8px', color:'var(--text2)' }}>{item.colorName || '—'}</td>
                                        <td style={{ padding:'6px 8px', textAlign:'right' }}>{item.quantity}</td>
                                        <td style={{ padding:'6px 8px', textAlign:'right', fontWeight:600 }}>{currency(item.unitPrice)}</td>
                                        <td style={{ padding:'6px 8px' }}>
                                          {item.allocations?.length ? (
                                            <>
                                              <div style={{ color:'var(--green)', fontWeight:600 }}>Matched {item.matchedQty}/{item.quantity}</div>
                                              <div style={{ fontSize:11, color:'var(--text3)' }}>
                                                {item.allocations.map(allocation => `${allocation.item.itemNumber} ×${allocation.qtySold}`).join(', ')}
                                              </div>
                                              {item.unmatchedQty > 0 && <div style={{ fontSize:11, color:'var(--orange)' }}>{item.unmatchedQty} unmatched</div>}
                                            </>
                                          ) : (
                                            <span style={{ color:'var(--red)', fontWeight:600 }}>No local match</span>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Legend / footer ── */}
      {activeTab === 'inventory' && loadState === 'done' && listings?.length > 0 && (
        <div style={{ padding:'8px 20px', borderTop:'1px solid var(--border)', fontSize:11, color:'var(--text3)', display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
          <span><span style={{ color:'var(--green)', fontWeight:600 }}>+diff</span> = saved guide price is higher than your price (you could charge more)</span>
          <span><span style={{ color:'var(--red)',   fontWeight:600 }}>−diff</span> = saved guide price is lower than your price (you may be overpriced)</span>
          <span><span style={{ color:'var(--green)', fontSize:10 }}>●</span> = item is in your local inventory (click row to open)</span>
          <span style={{ marginLeft:'auto' }}>Suggested = BL sold median ⅓ + active median ⅔</span>
        </div>
      )}

      {detailItem && (
        <ListingDetailModal
          item={inventoryItems.find(i => i.id === detailItem.id) || detailItem}
          onClose={() => setDetailItem(null)}
          onSave={(updated) => {
            if (updateItems) updateItems(prev => prev.map(i => i.id === updated.id ? { ...i, ...updated, updatedAt: new Date().toISOString() } : i));
            setDetailItem(null);
          }}
          setSellItem={setSellItem}
          updateItems={updateItems}
          blConfigured={blConfigured}
          ebayConfigured={ebayConfigured}
          settings={settings}
          setPage={setPage}
          setPricingSearch={setPricingSearch}
          setEditItem={setEditItem}
          setModal={setModal}
        />
      )}
    </div>
  );
}
