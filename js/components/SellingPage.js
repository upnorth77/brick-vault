function SellingPage({ items, stats, settings, setEditItem, setModal, setSellItem, setLotSaleOpen, updateItems, blConfigured, ebayConfigured, setPage, setPricingSearch }) {
  const typeColumn = !!settings?.typeColumn;
  const defaultPlatforms = [
    { id: 'bricklink', name: 'BrickLink' },
    { id: 'ebay',      name: 'eBay' },
    { id: 'reddit',    name: 'Reddit' },
    { id: 'facebook',  name: 'Facebook' },
  ];
  const sellingPlatforms = (settings?.platforms?.length ? settings.platforms : defaultPlatforms)
    .filter(p => (p.name || '').trim());
  const [tab,             setTab]             = React.useState('listed');
  const [search,          setSearch]          = React.useState('');
  const [typeFilter,      setTypeFilter]      = React.useState('all');
  const [themeFilter,     setThemeFilter]     = React.useState('all');
  const [conditionFilter, setConditionFilter] = React.useState('all');
  const [detailItem,      setDetailItem]      = React.useState(null);
  const [selectedIds,     setSelectedIds]     = React.useState(new Set());
  const [availableSelectedIds, setAvailableSelectedIds] = React.useState(new Set());
  const [availableThreshold, setAvailableThreshold] = React.useState('10');
  const [redditDraft,     setRedditDraft]     = React.useState(null); // null | { title, body }
  const [collapsedGroups, setCollapsedGroups] = React.useState({});
  const [bulkUnderTenState, setBulkUnderTenState] = React.useState({ status: 'idle', message: '' });
  const [blOrderOpen, setBlOrderOpen] = React.useState(false);
  const [blOrdersState, setBlOrdersState] = React.useState({ status: 'idle', orders: [], error: '' });
  const [blOrderIdInput, setBlOrderIdInput] = React.useState('');
  const [blOrderDetailState, setBlOrderDetailState] = React.useState({ status: 'idle', order: null, error: '' });
  const [blOrderImportState, setBlOrderImportState] = React.useState({ status: 'idle', message: '' });
  const [blShippingInput, setBlShippingInput] = React.useState('');

  // Reset filters when switching tabs
  const switchTab = (t) => { setTab(t); setSearch(''); setTypeFilter('all'); setThemeFilter('all'); setConditionFilter('all'); };

  const availableBase = React.useMemo(
    () => items.filter(i => i.sellStatus === 'available' || !i.sellStatus),
    [items]
  );
  const soldBase = React.useMemo(
    () => items.filter(i => i.sellStatus === 'sold'),
    [items]
  );
  const collectionBase = React.useMemo(
    () => items.filter(i => i.sellStatus === 'collection'),
    [items]
  );

  const [collectionSelectedIds, setCollectionSelectedIds] = React.useState(new Set());
  const toggleCollectionSelect = (id) => setCollectionSelectedIds(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  const clearCollectionSelection = () => setCollectionSelectedIds(new Set());

  const listSelectedCollection = () => {
    if (!collectionSelectedIds.size || !updateItems) return;
    const ids = collectionSelectedIds;
    const today = new Date().toISOString().slice(0, 10);
    updateItems(prev => prev.map(item =>
      ids.has(item.id)
        ? { ...item, sellStatus: 'listed', dateListed: item.dateListed || today, updatedAt: new Date().toISOString() }
        : item
    ));
    clearCollectionSelection();
  };

  // Theme and condition options are derived from whichever base set is active
  const activeBase = tab === 'sold' ? soldBase : tab === 'collection' ? collectionBase : availableBase;
  const themeOptions = React.useMemo(
    () => [...new Set(activeBase.map(i => i.theme || '').filter(Boolean))].sort(),
    [activeBase]
  );
  const conditionOptions = React.useMemo(() => {
    const used = new Set(activeBase.map(i => i.condition || '').filter(Boolean));
    return Object.entries(CONDITION_LABELS).filter(([k]) => used.has(k));
  }, [activeBase]);

  const list = React.useMemo(() => {
    if (tab === 'listed') return items.filter(i => i.sellStatus === 'listed');
    const base = tab === 'sold' ? soldBase : tab === 'collection' ? collectionBase : availableBase;
    let result = base;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(i => i.name?.toLowerCase().includes(q) || i.itemNumber?.toLowerCase().includes(q) || i.theme?.toLowerCase().includes(q) || (i.keywords || []).some(k => k.toLowerCase().includes(q)));
    }
    if (typeFilter      !== 'all') result = result.filter(i => i.type === typeFilter);
    if (themeFilter     !== 'all') result = result.filter(i => (i.theme || '') === themeFilter);
    if (conditionFilter !== 'all') result = result.filter(i => (i.condition || '') === conditionFilter);
    return result;
  }, [tab, items, availableBase, soldBase, collectionBase, search, typeFilter, themeFilter, conditionFilter]);

  const isFiltered = search || typeFilter !== 'all' || themeFilter !== 'all' || conditionFilter !== 'all';
  const clearAll = () => { setSearch(''); setTypeFilter('all'); setThemeFilter('all'); setConditionFilter('all'); };
  const groupedList = React.useMemo(() => groupItemsByTypeCategory(list), [list]);
  const groupKey = (kind, value) => `${kind}:${value || 'blank'}`;
  const toggleGroup = (kind, value) => {
    const key = groupKey(kind, value);
    setCollapsedGroups(prev => ({ ...prev, [key]: !(key in prev ? prev[key] : true) }));
  };
  const expandAll  = () => {
    const all = {};
    groupedList.forEach(tg => {
      all[groupKey('type', tg.type)] = false;
      tg.rows.forEach(({ category }) => { all[groupKey('category', `${tg.type}:${category}`)] = false; });
    });
    setCollapsedGroups(all);
  };
  const collapseAll = () => setCollapsedGroups({});
  const allExpanded = React.useMemo(() => {
    if (!groupedList.length) return false;
    return groupedList.every(tg =>
      collapsedGroups[groupKey('type', tg.type)] === false &&
      tg.rows.every(({ category }) => collapsedGroups[groupKey('category', `${tg.type}:${category}`)] === false)
    );
  }, [groupedList, collapsedGroups]);

  const effectiveCollapsed = React.useMemo(() => {
    if (isFiltered) return {};
    const defaults = {};
    groupedList.forEach(typeGroup => {
      const typeKey = groupKey('type', typeGroup.type);
      defaults[typeKey] = typeKey in collapsedGroups ? collapsedGroups[typeKey] : true;
      typeGroup.rows.forEach(({ category }) => {
        const catKey = groupKey('category', `${typeGroup.type}:${category}`);
        defaults[catKey] = catKey in collapsedGroups ? collapsedGroups[catKey] : true;
      });
    });
    return defaults;
  }, [isFiltered, groupedList, collapsedGroups]);
  const tableColSpan = (tab === 'available' || tab === 'collection' ? 7 : 8) + (typeColumn ? 1 : 0);

  const listedItems = React.useMemo(() => items.filter(i => i.sellStatus === 'listed'), [items]);
  const visibleAvailableItems = React.useMemo(
    () => tab === 'available' ? list : [],
    [tab, list]
  );

  const suggestedForListing = (item) => {
    const value = suggestedPrice(item) ?? item.estimatedValue ?? 0;
    return value > 0 ? Math.round(value * 100) / 100 : 0;
  };

  const availableListingCandidates = React.useMemo(
    () => visibleAvailableItems
      .map(item => ({ item, suggested: suggestedForListing(item) }))
      .filter(row => row.suggested > 0),
    [visibleAvailableItems]
  );

  const selectedAvailableTargets = React.useMemo(
    () => availableListingCandidates.filter(({ item }) => availableSelectedIds.has(item.id)),
    [availableListingCandidates, availableSelectedIds]
  );

  const selectAvailableUnderThreshold = () => {
    const threshold = parseFloat(availableThreshold);
    if (!(threshold > 0)) { alert('Enter a value greater than 0.'); return; }
    setAvailableSelectedIds(new Set(
      availableListingCandidates
        .filter(({ suggested }) => suggested < threshold)
        .map(({ item }) => item.id)
    ));
  };

  const clearAvailableSelection = () => setAvailableSelectedIds(new Set());

  const toggleAvailableSelect = (id) => setAvailableSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const listSelectedAvailableOnBrickLink = async () => {
    if (!selectedAvailableTargets.length || !updateItems) return;
    if (!blConfigured) { alert('Configure BrickLink API credentials first.'); return; }
    const count = selectedAvailableTargets.length;
    if (!confirm(`Create ${count} BrickLink store listing${count !== 1 ? 's' : ''} for selected available item${count !== 1 ? 's' : ''}?`)) return;
    const typeMap = { set: 'SET', minifig: 'MINIFIG', part: 'PART' };
    const listings = selectedAvailableTargets.map(({ item, suggested }) => ({
      client_id: item.id,
      item_type: typeMap[item.type] || 'SET',
      item_number: item.itemNumber,
      color_id: item.blColorId || '',
      quantity: item.quantity || 1,
      price: suggested,
      condition: (item.condition === 'new_sealed' || item.condition === 'new_open') ? 'N' : 'U',
      completeness: item.type === 'set' ? (item.condition === 'new_sealed' ? 'S' : 'C') : undefined,
      description: item.name || '',
      remarks: item.notes || '',
    }));

    setBulkUnderTenState({ status: 'listing', message: `Creating ${count} BrickLink listing${count !== 1 ? 's' : ''}…` });
    try {
      const resp = await fetch('/api/bricklink/store/create-listings-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listings }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error || 'Bulk BrickLink listing failed.');

      const pricesById = new Map(selectedAvailableTargets.map(({ item, suggested }) => [item.id, suggested]));
      const inventoryById = new Map((data.created || []).map(row => [row.client_id, row.inventory_id]));
      const now = new Date().toISOString();
      updateItems(prev => prev.map(item => {
        if (!inventoryById.has(item.id)) return item;
        const price = pricesById.get(item.id);
        return {
          ...item,
          sellStatus: 'listed',
          platform: String(item.platform || '').toLowerCase().replace(/\s+/g, '').includes('bricklink')
            ? item.platform
            : [item.platform, 'BrickLink'].filter(Boolean).join(', '),
          listPrice: price,
          platformPrices: {
            ...(item.platformPrices || {}),
            bricklink: price,
          },
          bricklinkInventoryId: inventoryById.get(item.id) || item.bricklinkInventoryId,
          updatedAt: now,
        };
      }));

      const createdCount = (data.created || []).length;
      const createdIds = new Set((data.created || []).map(row => row.client_id));
      setAvailableSelectedIds(prev => new Set([...prev].filter(id => !createdIds.has(id))));
      const failed = data.failed || [];
      setBulkUnderTenState({
        status: failed.length ? 'error' : 'done',
        message: failed.length
          ? `${createdCount} listed, ${failed.length} failed. ${failed[0]?.error || ''}`
          : `${createdCount} listed on BrickLink.`,
      });
      if (createdCount && !failed.length) setTab('listed');
    } catch(e) {
      setBulkUnderTenState({ status: 'error', message: e.message });
    }
  };

  const platformAliases = {
    bricklink: ['bricklink', 'brick link', 'bl'],
    ebay: ['ebay', 'e-bay'],
    reddit: ['reddit', 'legomarket', 'r/legomarket'],
    facebook: ['facebook', 'fb', 'marketplace', 'facebook marketplace'],
  };

  const platformInitials = (platform) => {
    const name = platform.name || platform.id || '?';
    if ((platform.id || '').toLowerCase() === 'bricklink') return 'BL';
    if ((platform.id || '').toLowerCase() === 'ebay') return 'eB';
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || name.slice(0, 2).toUpperCase();
  };

  const platformColor = (platform) => {
    const id = (platform.id || platform.name || '').toLowerCase();
    if (id.includes('bricklink')) return 'var(--blue)';
    if (id.includes('ebay')) return 'var(--orange)';
    if (id.includes('reddit')) return 'var(--red)';
    if (id.includes('facebook')) return 'var(--accent)';
    return 'var(--green)';
  };

  const itemPlatformNames = (item) => String(item.platform || '')
    .split(/[,&/;+|]|\band\b/gi)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  const isListedOnPlatform = (item, platform) => {
    const id = (platform.id || '').toLowerCase();
    const name = (platform.name || '').toLowerCase();
    if (id === 'bricklink' && item.bricklinkInventoryId) return true;
    const tokens = itemPlatformNames(item);
    const aliases = [id, name, ...(platformAliases[id] || [])].filter(Boolean);
    return tokens.some(token => aliases.some(alias => token === alias || token.includes(alias)));
  };

  const platformKey = (platform) => platform.id || platform.name;
  const platformPriceRows = (item) => sellingPlatforms
    .filter(platform => isListedOnPlatform(item, platform))
    .map(platform => ({
      platform,
      price: item.platformPrices?.[platformKey(platform)] ?? item.listPrice,
    }))
    .filter(row => row.price != null && row.price !== '' && Number(row.price) > 0);

  const belowRetail = (price, item) => item.retailPrice > 0 && Number(price) < item.retailPrice;

  const ListPriceCell = ({ item }) => {
    const rows = platformPriceRows(item);
    if (!rows.length) return <span style={belowRetail(item.listPrice, item) ? {color:'var(--red)'} : undefined}>{currency(item.listPrice)}</span>;
    if (rows.length === 1) return <span style={belowRetail(rows[0].price, item) ? {color:'var(--red)'} : undefined}>{currency(rows[0].price)}</span>;
    const prices = rows.map(r => Number(r.price));
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return (
      <div title={rows.map(r => `${r.platform.name}: ${currency(r.price)}`).join('\n')}>
        <div style={{fontWeight:600, color: belowRetail(min, item) ? 'var(--red)' : undefined}}>{min === max ? currency(min) : `${currency(min)}-${currency(max)}`}</div>
        <div style={{fontSize:10,color:'var(--text3)'}}>{rows.length} prices</div>
      </div>
    );
  };

  const PlatformBadges = ({ item }) => (
    <div style={{display:'flex',alignItems:'center',gap:4,flexWrap:'wrap'}} aria-label={`Platforms for ${item.name || item.itemNumber}`}>
      {sellingPlatforms.map(platform => {
        const active = isListedOnPlatform(item, platform);
        const color = platformColor(platform);
        return (
          <span key={platform.id || platform.name}
            title={`${platform.name}${active ? ': listed' : ': not listed'}`}
            style={{
              width:22,height:22,borderRadius:'50%',display:'inline-flex',alignItems:'center',justifyContent:'center',
              fontSize:9,fontWeight:700,letterSpacing:0,
              color: active ? '#fff' : 'var(--text3)',
              background: active ? color : 'var(--surface2)',
              border: `1px solid ${active ? color : 'var(--border)'}`,
              opacity: active ? 1 : .45,
              lineHeight:1,
            }}>
            {platformInitials(platform)}
          </span>
        );
      })}
    </div>
  );

  const normaliseTypeNumber = (type, itemNumber) => {
    const raw = String(itemNumber || '').trim().toUpperCase();
    if (!raw) return raw;
    return (type || '').toLowerCase() === 'set' ? raw.replace(/-\d+$/, '') : raw;
  };

  const loadBrickLinkOrders = React.useCallback(async () => {
    setBlOrdersState(prev => ({ ...prev, status: 'loading', error: '' }));
    try {
      const resp = await fetch('/api/bricklink/orders?limit=25');
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error || 'Could not load BrickLink orders.');
      const orders = data.orders || [];
      setBlOrdersState({ status: 'done', orders, error: '' });
      if (!String(blOrderIdInput || '').trim() && orders[0]?.orderId) setBlOrderIdInput(String(orders[0].orderId));
      return orders;
    } catch (e) {
      setBlOrdersState({ status: 'error', orders: [], error: e.message });
      return [];
    }
  }, [blOrderIdInput]);

  const loadBrickLinkOrderDetail = React.useCallback(async (orderId) => {
    const cleanId = String(orderId || '').trim();
    if (!cleanId) return;
    setBlOrderIdInput(cleanId);
    setBlOrderDetailState({ status: 'loading', order: null, error: '' });
    setBlOrderImportState({ status: 'idle', message: '' });
    try {
      const resp = await fetch(`/api/bricklink/orders/${encodeURIComponent(cleanId)}`);
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error || 'Could not load BrickLink order.');
      setBlOrderDetailState({ status: 'done', order: data, error: '' });
    } catch (e) {
      setBlOrderDetailState({ status: 'error', order: null, error: e.message });
    }
  }, []);

  const openBrickLinkOrderModal = async () => {
    setBlOrderOpen(true);
    const orders = await loadBrickLinkOrders();
    const firstId = String(blOrderIdInput || orders[0]?.orderId || '').trim();
    if (firstId) loadBrickLinkOrderDetail(firstId);
  };

  const closeBrickLinkOrderModal = () => {
    setBlOrderOpen(false);
    setBlOrderImportState({ status: 'idle', message: '' });
  };

  const orderImportPreview = React.useMemo(() => {
    const order = blOrderDetailState.order;
    if (!order?.items?.length) return { rows: [], matchedCount: 0, unmatchedCount: 0, importRows: [] };

    const availablePool = items
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

      const itemNumber = String(item.itemNumber || '').trim().toUpperCase();
      const lineNumber = String(line.itemNumber || '').trim().toUpperCase();
      const exactNumber = itemNumber && lineNumber && itemNumber === lineNumber;
      const baseNumber = normaliseTypeNumber(item.type, item.itemNumber) === normaliseTypeNumber(line.itemType, line.itemNumber);
      if (!exactNumber && !baseNumber) return false;

      if (line.itemType === 'part' && line.colorId && line.colorId !== '0') {
        const itemColor = String(item.blColorId || item.colorId || '');
        if (itemColor && itemColor !== String(line.colorId)) return false;
      }

      if (line.inventoryId && item.bricklinkInventoryId && String(item.bricklinkInventoryId) === String(line.inventoryId)) {
        return true;
      }

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
          orderDate: order.dateOrdered,
          buyerName: order.buyerName,
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
  }, [blOrderDetailState.order, items]);

  const importBrickLinkOrder = React.useCallback(() => {
    const order = blOrderDetailState.order;
    if (!order || !orderImportPreview.importRows.length || !updateItems) return;

    const unmatched = orderImportPreview.rows.filter(row => row.unmatchedQty > 0);
    if (unmatched.length) {
      const proceed = confirm(`Import ${orderImportPreview.importRows.length} matched allocation${orderImportPreview.importRows.length !== 1 ? 's' : ''}? ${unmatched.length} order line${unmatched.length !== 1 ? 's are' : ' is'} not fully matched.`);
      if (!proceed) return;
    }

    const now = new Date().toISOString();
    const orderLabel = `BrickLink order #${order.orderId}`;

    // Shipping + fees
    const totalShipping = parseFloat(blShippingInput) || 0;
    const grandTotal    = order.grandTotal ?? 0;
    const totalFees     = Math.round(grandTotal * 0.06 * 100) / 100;
    // Distribute shipping & fees proportionally by each row's (salePrice × qtySold)
    const rowsSubtotal  = orderImportPreview.importRows.reduce((s, r) => s + (Number(r.salePrice) || 0) * r.qtySold, 0);
    const rowShipping   = (row) => rowsSubtotal > 0
      ? Math.round(totalShipping * ((Number(row.salePrice) * row.qtySold) / rowsSubtotal) * 100) / 100
      : 0;
    const rowFees       = (row) => rowsSubtotal > 0
      ? Math.round(totalFees     * ((Number(row.salePrice) * row.qtySold) / rowsSubtotal) * 100) / 100
      : 0;

    const noteParts = [
      orderLabel,
      order.buyerName ? `buyer ${order.buyerName}` : '',
      order.dateOrdered ? new Date(order.dateOrdered).toLocaleString() : '',
      totalShipping > 0 ? `shipping ${currency(totalShipping)}` : '',
      `fees ${currency(totalFees)} (6%)`,
    ].filter(Boolean);

    setBlOrderImportState({ status: 'importing', message: `Importing ${orderLabel}…` });
    updateItems(prev => {
      const soldItems = prev.filter(existing => existing.sellStatus === 'sold');
      const activeMap = new Map(
        prev
          .filter(existing => existing.sellStatus !== 'sold')
          .map(existing => [existing.id, { ...existing }])
      );
      const importedSold = [];

      for (const row of orderImportPreview.importRows) {
        const { item, qtySold, salePrice, platform } = row;
        const fees        = rowFees(row);
        const shippingCost = rowShipping(row);
        const current = activeMap.get(item.id);
        if (!current) continue;
        const total = Number(current.quantity) || 1;
        const soldNotes = [current.notes, noteParts.join(' | ')].filter(Boolean).join(current.notes ? ' | ' : '');
        if (qtySold >= total) {
          activeMap.delete(item.id);
          importedSold.push({
            ...current,
            sellStatus: 'sold',
            salePrice,
            fees,
            shippingCost,
            platform,
            notes: soldNotes,
            bricklinkOrderId: order.orderId,
            updatedAt: now,
          });
        } else {
          activeMap.set(item.id, { ...current, quantity: total - qtySold, updatedAt: now });
          importedSold.push({
            ...current,
            id: genId(),
            quantity: qtySold,
            sellStatus: 'sold',
            salePrice,
            fees,
            shippingCost,
            platform,
            notes: soldNotes,
            bricklinkOrderId: order.orderId,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
      return [...Array.from(activeMap.values()), ...soldItems, ...importedSold];
    });

    setBlOrderImportState({
      status: 'done',
      message: `${orderLabel} imported. ${orderImportPreview.importRows.length} allocation${orderImportPreview.importRows.length !== 1 ? 's' : ''} recorded.`,
    });
  }, [blOrderDetailState.order, orderImportPreview, updateItems, blShippingInput]);

  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const allSelected = listedItems.length > 0 && listedItems.every(i => selectedIds.has(i.id));
  const toggleAll   = () => setSelectedIds(allSelected ? new Set() : new Set(listedItems.map(i => i.id)));

  const listedWithoutPlatforms = React.useMemo(
    () => listedItems.filter(item => !itemPlatformNames(item).length),
    [listedItems]
  );

  const markNoPlatformListedAvailable = () => {
    if (!listedWithoutPlatforms.length || !updateItems) return;
    const count = listedWithoutPlatforms.length;
    if (!confirm(`Mark ${count} listed item${count !== 1 ? 's' : ''} with no platforms as available?`)) return;
    const ids = new Set(listedWithoutPlatforms.map(item => item.id));
    const now = new Date().toISOString();
    updateItems(prev => prev.map(item => ids.has(item.id)
      ? { ...item, sellStatus: 'available', updatedAt: now }
      : item
    ));
    setSelectedIds(prev => new Set([...prev].filter(id => !ids.has(id))));
  };

  const buildRedditPost = () => {
    const sel = listedItems.filter(i => selectedIds.has(i.id));
    if (!sel.length) return;

    const DEFAULT_REDDIT = {
      titlePrefix:  '[S] [US]',
      titleSuffix:  '[W] PayPal',
      openingLine:  'For sale — prices include PayPal G&S fees. Buyer pays shipping.',
      closingLine:  'Comment or DM to purchase. Not looking for trades at this time.',
    };
    const tmpl = { ...DEFAULT_REDDIT, ...(settings?.redditTemplate || {}) };

    const condShort = {
      new_sealed:     'NIB',
      new_open:       'New/Open',
      used_complete:  'Used Complete',
      used_incomplete:'Used Incomplete',
    };

    const names = sel.map(i => i.name || i.itemNumber).filter(Boolean);
    const titleItems = names.length <= 3
      ? names.join(', ')
      : `${names.slice(0, 2).join(', ')} + ${names.length - 2} more`;

    const prefix = tmpl.titlePrefix ? `${tmpl.titlePrefix} ` : '';
    const suffix = tmpl.titleSuffix ? ` ${tmpl.titleSuffix}` : '';
    const title  = `${prefix}[H] ${titleItems}${suffix}`;

    const buildBody = (photosUrl) => [
      tmpl.openingLine ? `**${tmpl.openingLine}**` : '',
      photosUrl ? `[Lego items for sale](${photosUrl})` : '',
      ``,
      `| Item | Price | Condition | Notes |`,
      `|------|-------|-----------|-------|`,
      ...sel.map(item => {
        const num   = item.itemNumber ? `#${item.itemNumber} ` : '';
        const name  = item.name || 'Unknown';
        const qty   = (item.quantity || 1) > 1 ? ` ×${item.quantity}` : '';
        const platformRows = platformPriceRows(item);
        const redditPrice = platformRows.find(r => (r.platform.id || '').toLowerCase() === 'reddit')?.price
          ?? platformRows[0]?.price
          ?? item.listPrice;
        const price = redditPrice ? `$${Number(redditPrice).toFixed(2)}` : 'OBO';
        const cond  = condShort[item.condition] || '';
        const notes = (item.notes || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
        return `| ${num}${name}${qty} | ${price} | ${cond} | ${notes} |`;
      }),
      ``,
      tmpl.closingLine || '',
    ].filter(line => line !== null && line !== undefined)
     .filter((line, i, arr) => !(line === '' && i === arr.length - 1))
     .join('\n');

    setRedditDraft({ title, photosUrl: '', buildBody, body: buildBody('') });
  };

  return (
    <>
      <div className="header">
        <h1>Selling</h1>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-secondary" onClick={openBrickLinkOrderModal} disabled={!blConfigured}
            title={blConfigured ? 'Pull a BrickLink order into sold items' : 'Configure BrickLink API credentials first'}>
            Import BL Order
          </button>
          <button className="btn btn-primary" onClick={()=>setModal('add')}>List New Item</button>
        </div>
      </div>

      <div className="stats-row">
        <div className="stat-card"><div className="label">Currently Listed</div><div className="value blue">{stats.listed}</div></div>
        <div className="stat-card"><div className="label">Total Sold</div><div className="value green">{stats.sold}</div></div>
        <div className="stat-card"><div className="label">Total Revenue</div><div className="value accent">{currency(stats.totalRevenue)}</div></div>
        <div className="stat-card">
          <div className="label">Net Profit</div>
          <div className={`value ${stats.totalProfit>=0?'green':''}`}>{currency(stats.totalProfit)}</div>
          <div className="sub">After fees &amp; shipping</div>
        </div>
      </div>

      <div className="tabs">
        <div className={`tab ${tab==='listed'?'active':''}`}    onClick={()=>switchTab('listed')}>Listed ({items.filter(i=>i.sellStatus==='listed').reduce((s,i)=>s+(i.quantity||1),0)})</div>
        <div className={`tab ${tab==='sold'?'active':''}`}      onClick={()=>switchTab('sold')}>Sold ({soldBase.reduce((s,i)=>s+(i.quantity||1),0)})</div>
        <div className={`tab ${tab==='available'?'active':''}`} onClick={()=>switchTab('available')}>Available ({availableBase.reduce((s,i)=>s+(i.quantity||1),0)})</div>
        <div className={`tab ${tab==='collection'?'active':''}`} onClick={()=>{ switchTab('collection'); clearCollectionSelection(); }}>Collection ({collectionBase.reduce((s,i)=>s+(i.quantity||1),0)})</div>
      </div>

      <div className="table-wrap">
        {tab === 'listed' && (
          <div className="table-toolbar" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn btn-secondary btn-sm" style={{ whiteSpace: 'nowrap' }}
              disabled={!listedWithoutPlatforms.length || !updateItems}
              onClick={markNoPlatformListedAvailable}
              title={listedWithoutPlatforms.length ? 'Move listed items with no platforms back to Available' : 'No listed items are missing platforms'}>
              Mark no-platform as available ({listedWithoutPlatforms.length})
            </button>
            {selectedIds.size > 0 && (
              <>
                <span style={{ fontSize: 12, color: 'var(--text2)' }}>{selectedIds.size} selected</span>
                <button className="btn btn-secondary btn-sm" style={{ whiteSpace: 'nowrap' }}
                  onClick={buildRedditPost}>
                  📝 Post to Reddit
                </button>
              </>
            )}
            {setLotSaleOpen && listedItems.length >= 2 && (
              <button className="btn btn-secondary btn-sm" style={{ whiteSpace: 'nowrap' }}
                onClick={() => setLotSaleOpen(true)}
                title="Record a sale of multiple listed items as a single lot">
                Sell as Lot
              </button>
            )}
          </div>
        )}
        {(tab === 'sold' || tab === 'available' || tab === 'collection') && (
          <div className="table-toolbar">
            <button className="btn-icon" onClick={clearAll} title="Clear search and filters"
              style={{ opacity: isFiltered ? 1 : 0.35, flexShrink: 0 }}>
              {Icons.x}
            </button>
            <input className="search-box"
              placeholder={tab === 'sold' ? 'Search sold items…' : tab === 'collection' ? 'Search collection…' : 'Search available items…'}
              value={search} onChange={e => setSearch(e.target.value)} />
            {!isFiltered && (
              <button className="btn btn-secondary btn-sm" style={{ whiteSpace:'nowrap', flexShrink:0 }}
                onClick={allExpanded ? collapseAll : expandAll}
                title={allExpanded ? 'Collapse all categories' : 'Expand all categories'}>
                {allExpanded ? '⊟ Collapse All' : '⊞ Expand All'}
              </button>
            )}
            <select className="filter-select" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              <option value="all">All Types</option>
              <option value="set">Sets</option>
              <option value="minifig">Minifigures</option>
              <option value="part">Parts</option>
            </select>
            {themeOptions.length > 0 && (
              <select className="filter-select" value={themeFilter} onChange={e => setThemeFilter(e.target.value)}>
                <option value="all">All Themes</option>
                {themeOptions.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
            {conditionOptions.length > 0 && (
              <select className="filter-select" value={conditionFilter} onChange={e => setConditionFilter(e.target.value)}>
                <option value="all">All Conditions</option>
                {conditionOptions.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            )}
            {tab === 'available' && (
              <>
                {bulkUnderTenState.message && (
                  <span style={{
                    marginLeft: 'auto',
                    fontSize: 12,
                    color: bulkUnderTenState.status === 'error' ? 'var(--red)' : bulkUnderTenState.status === 'done' ? 'var(--green)' : 'var(--text2)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: 260,
                  }}>
                    {bulkUnderTenState.message}
                  </span>
                )}
                <span style={{ marginLeft: bulkUnderTenState.message ? 0 : 'auto', fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                  {selectedAvailableTargets.length} selected
                </span>
                <input
                  className="filter-select"
                  type="number"
                  min="0"
                  step="0.01"
                  value={availableThreshold}
                  onChange={e => setAvailableThreshold(e.target.value)}
                  title="Suggested value threshold"
                  style={{ width: 78 }}
                />
                <button className="btn btn-secondary btn-sm"
                  style={{ whiteSpace: 'nowrap' }}
                  onClick={selectAvailableUnderThreshold}
                  title="Select visible available items below this suggested value">
                  Check under
                </button>
                {selectedAvailableTargets.length > 0 && (
                  <button className="btn btn-secondary btn-sm"
                    style={{ whiteSpace: 'nowrap' }}
                    onClick={clearAvailableSelection}>
                    Clear
                  </button>
                )}
                <button className="btn btn-primary btn-sm"
                  style={{ whiteSpace: 'nowrap' }}
                  disabled={!selectedAvailableTargets.length || !updateItems || !blConfigured || bulkUnderTenState.status === 'listing'}
                  onClick={listSelectedAvailableOnBrickLink}
                  title={!blConfigured ? 'Configure BrickLink API credentials first' : selectedAvailableTargets.length ? 'Create BrickLink store listings for checked available items' : 'Check one or more available items first'}>
                  {bulkUnderTenState.status === 'listing' ? 'Listing…' : `List checked on BrickLink (${selectedAvailableTargets.length})`}
                </button>
              </>
            )}
            {tab === 'collection' && (
              <>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                  {collectionSelectedIds.size > 0 ? `${collectionSelectedIds.size} selected` : ''}
                </span>
                {collectionSelectedIds.size > 0 && (
                  <button className="btn btn-secondary btn-sm" style={{ whiteSpace: 'nowrap' }}
                    onClick={clearCollectionSelection}>
                    Clear
                  </button>
                )}
                <button className="btn btn-primary btn-sm"
                  style={{ whiteSpace: 'nowrap' }}
                  disabled={!collectionSelectedIds.size || !updateItems}
                  onClick={listSelectedCollection}
                  title="Move selected collection items to Listed status">
                  List Selected ({collectionSelectedIds.size})
                </button>
              </>
            )}
          </div>
        )}
        {list.length === 0 ? (
          <div className="empty-state">
            <h3>No {tab} items{(tab === 'available' || tab === 'sold' || tab === 'collection') && isFiltered ? ' matching filters' : ''}</h3>
            <p>{tab==='listed' ? 'Mark items as listed to track them here.' : tab==='sold' ? (isFiltered ? 'Try clearing your search or filters.' : 'No sales recorded yet.') : tab==='collection' ? (isFiltered ? 'Try clearing your search or filters.' : 'No collection items yet. Set an item\'s status to Collection to track it here.') : isFiltered ? 'Try clearing your search or filters.' : 'All items are listed or sold.'}</p>
          </div>
        ) : (
          <>
            {!typeColumn && (
              <div style={{display:'flex',gap:16,fontSize:11,color:'var(--text2)',padding:'8px 18px 4px',flexWrap:'wrap'}}>
                <span>Item type: <span style={{color:'var(--accent)'}}>● Set</span> &nbsp;<span style={{color:'var(--orange)'}}>● Minifig</span> &nbsp;<span style={{color:'var(--blue)'}}>● Part</span></span>
              </div>
            )}
          <table>
            <thead>
              <tr>
                {(tab === 'listed' || tab === 'available' || tab === 'collection') && (
                  <th style={{ width: 32, paddingRight: 4 }}>
                    {tab === 'listed' && (
                      <input type="checkbox" checked={allSelected} onChange={toggleAll}
                        title="Select all" style={{ cursor: 'pointer' }} />
                    )}
                    {tab === 'available' && (
                      <input type="checkbox"
                        checked={visibleAvailableItems.length > 0 && visibleAvailableItems.every(i => availableSelectedIds.has(i.id))}
                        onChange={e => setAvailableSelectedIds(
                          e.target.checked ? new Set(visibleAvailableItems.map(i => i.id)) : new Set()
                        )}
                        title="Select all visible" style={{ cursor: 'pointer' }} />
                    )}
                    {tab === 'collection' && (
                      <input type="checkbox"
                        checked={list.length > 0 && list.every(i => collectionSelectedIds.has(i.id))}
                        onChange={e => setCollectionSelectedIds(
                          e.target.checked ? new Set(list.map(i => i.id)) : new Set()
                        )}
                        title="Select all visible" style={{ cursor: 'pointer' }} />
                    )}
                  </th>
                )}
                <th>Item</th>{typeColumn && <th>Type</th>}<th>Qty</th><th>Cost</th>
                {tab==='listed'     && <><th>List Price</th><th>Platform</th><th>Expected Profit</th></>}
                {tab==='sold'       && <><th>Sale Price</th><th>Fees</th><th>Shipping</th><th>Profit</th></>}
                {tab==='available'  && <><th>Sugg. Price</th><th>Potential Profit</th></>}
                {tab==='collection' && <><th>Est. Value</th><th>Potential Profit</th></>}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {groupedList.map(typeGroup => {
                const typeRows = typeGroup.rows.flatMap(g => g.rows);
                const typeQty = typeRows.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
                const typeCollapsed = !!effectiveCollapsed[groupKey('type', typeGroup.type)];
                return (
                  <React.Fragment key={`type-${typeGroup.type}`}>
                    <tr>
                      <td colSpan={tableColSpan}
                        onClick={() => toggleGroup('type', typeGroup.type)}
                        style={{padding:'8px 18px',background:'var(--surface2)',borderBottom:'1px solid var(--border)',cursor:'pointer',userSelect:'none'}}>
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
                            {(tab === 'listed' || tab === 'available' || tab === 'collection') && (
                              <td style={{padding:'6px 4px 6px 18px',background:'rgba(0,0,0,.03)',borderBottom:'1px solid var(--border)',width:32,textAlign:'center'}}
                                onClick={e => e.stopPropagation()}>
                                {tab === 'listed' && (
                                  <input type="checkbox"
                                    checked={categoryIds.length > 0 && categoryIds.every(id => selectedIds.has(id))}
                                    onChange={e => setSelectedIds(prev => {
                                      const next = new Set(prev);
                                      categoryIds.forEach(id => e.target.checked ? next.add(id) : next.delete(id));
                                      return next;
                                    })}
                                    title={`Check all in ${categoryGroup.category}`}
                                    style={{ cursor: 'pointer' }}
                                  />
                                )}
                                {tab === 'available' && (
                                  <input type="checkbox"
                                    checked={categoryIds.length > 0 && categoryIds.every(id => availableSelectedIds.has(id))}
                                    onChange={e => setAvailableSelectedIds(prev => {
                                      const next = new Set(prev);
                                      categoryIds.forEach(id => e.target.checked ? next.add(id) : next.delete(id));
                                      return next;
                                    })}
                                    title={`Check all in ${categoryGroup.category}`}
                                    style={{ cursor: 'pointer' }}
                                  />
                                )}
                                {tab === 'collection' && (
                                  <input type="checkbox"
                                    checked={categoryIds.length > 0 && categoryIds.every(id => collectionSelectedIds.has(id))}
                                    onChange={e => setCollectionSelectedIds(prev => {
                                      const next = new Set(prev);
                                      categoryIds.forEach(id => e.target.checked ? next.add(id) : next.delete(id));
                                      return next;
                                    })}
                                    title={`Check all in ${categoryGroup.category}`}
                                    style={{ cursor: 'pointer' }}
                                  />
                                )}
                              </td>
                            )}
                            <td colSpan={(tab === 'listed' || tab === 'available' || tab === 'collection') ? tableColSpan - 1 : tableColSpan}
                              onClick={() => toggleGroup('category', categoryKey)}
                              style={{padding:'6px 18px 6px 10px',background:'rgba(0,0,0,.03)',borderBottom:'1px solid var(--border)',cursor:'pointer',userSelect:'none'}}>
                              <span style={{color:'var(--text3)',display:'inline-block',width:14}}>{categoryCollapsed ? '▶' : '▼'}</span>
                              <span style={{fontWeight:600,color:'var(--text2)'}}>{categoryGroup.category}</span>
                              <span style={{fontSize:11,color:'var(--text3)',marginLeft:8}}>{categoryGroup.rows.length} listing{categoryGroup.rows.length !== 1 ? 's' : ''} · {categoryQty} item{categoryQty !== 1 ? 's' : ''}</span>
                            </td>
                          </tr>
                          {!categoryCollapsed && categoryGroup.rows.map(item => {
                const qty          = item.quantity || 1;
                const cost         = (item.purchasePrice||0) * qty;
                const profit_sold  = ((item.salePrice||0)*qty) - cost - (item.fees||0) - (item.shippingCost||0);
                const profit_listed= ((item.listPrice||0)*qty) - cost;
                const suggested    = suggestedPrice(item) ?? item.estimatedValue ?? 0;
                const profit_avail = suggested * qty - cost;
                const nameColor    = typeColumn ? undefined : item.type==='set' ? 'var(--accent)' : item.type==='minifig' ? 'var(--orange)' : 'var(--blue)';
                return (
                  <tr key={item.id} style={{cursor:'pointer'}} onClick={() => setDetailItem(item)}>
                    {tab === 'listed' && (
                      <td style={{ paddingRight: 4 }} onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={selectedIds.has(item.id)}
                          onChange={() => toggleSelect(item.id)}
                          style={{ cursor: 'pointer' }} />
                      </td>
                    )}
                    {tab === 'available' && (
                      <td style={{ paddingRight: 4 }} onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={availableSelectedIds.has(item.id)}
                          onChange={() => toggleAvailableSelect(item.id)}
                          title={`List on BrickLink for ${currency(suggested)}`}
                          style={{ cursor: 'pointer' }} />
                      </td>
                    )}
                    {tab === 'collection' && (
                      <td style={{ paddingRight: 4 }} onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={collectionSelectedIds.has(item.id)}
                          onChange={() => toggleCollectionSelect(item.id)}
                          title="Select to list"
                          style={{ cursor: 'pointer' }} />
                      </td>
                    )}
                    <td>
                      <span className="item-name" style={{color: nameColor}}>{item.name}</span>
                      <br/><span className="item-id">{item.itemNumber}</span>
                    </td>
                    {typeColumn && <td><span className={`badge badge-${item.type}`}>{item.type}</span></td>}
                    <td style={{color:'var(--text2)'}}>{qty}</td>
                    <td>{currency(cost)}</td>
                    {tab==='listed' && <>
                      <td style={{fontWeight:600}}><ListPriceCell item={item} /></td>
                      <td><PlatformBadges item={item} /></td>
                      <td className={profit_listed>=0?'profit-pos':'profit-neg'}>{currency(profit_listed)}</td>
                    </>}
                    {tab==='sold' && <>
                      <td style={{fontWeight:600}}>{currency(item.salePrice)}</td>
                      <td style={{color:'var(--text2)'}}>{currency(item.fees)}</td>
                      <td style={{color:'var(--text2)'}}>{currency(item.shippingCost)}</td>
                      <td className={profit_sold>=0?'profit-pos':'profit-neg'} style={{fontWeight:600}}>{currency(profit_sold)}</td>
                    </>}
                    {tab==='available' && <>
                      <td style={{fontWeight:600, color: belowRetail(suggested, item) ? 'var(--red)' : undefined}}>{currency(suggested)}</td>
                      <td className={profit_avail>=0?'profit-pos':'profit-neg'}>{currency(profit_avail)}</td>
                    </>}
                    {tab==='collection' && <>
                      <td style={{fontWeight:600}}>{currency(item.estimatedValue || suggested || 0)}</td>
                      <td className={profit_avail>=0?'profit-pos':'profit-neg'}>{currency(profit_avail)}</td>
                    </>}
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{display:'flex',gap:4}}>
                        {tab==='available' && (
                          <button className="btn btn-primary btn-sm" style={{whiteSpace:'nowrap'}}
                            onClick={() => setDetailItem({...item, sellStatus:'listed'})}
                            title="Open listing detail to set price and platform">
                            List
                          </button>
                        )}
                        {tab==='collection' && (
                          <button className="btn btn-primary btn-sm" style={{whiteSpace:'nowrap'}}
                            onClick={() => setDetailItem({...item, sellStatus:'listed'})}
                            title="Open listing detail to set price and platform">
                            List
                          </button>
                        )}
                        {tab==='listed' && setSellItem && (
                          <button className="btn btn-danger btn-sm" style={{whiteSpace:'nowrap'}}
                            onClick={() => setSellItem(item)}
                            title="Record a sale of this item">
                            Sold
                          </button>
                        )}
                        <button className="btn-icon" onClick={() => setDetailItem(item)} title="Listing detail">{Icons.edit}</button>
                        <a className="btn-icon" href={bricklinkUrl(item)} target="_blank" rel="noopener" style={{textDecoration:'none'}}>{Icons.externalLink}</a>
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
      </div>

      {blOrderOpen && (
        <div className="modal-overlay" onClick={closeBrickLinkOrderModal}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 900 }}>
            <div className="modal-header">
              <h2>Import BrickLink Order</h2>
              <button className="btn-icon" onClick={closeBrickLinkOrderModal}>{Icons.x}</button>
            </div>
            <div className="modal-body" style={{ padding:'16px 20px', display:'flex', flexDirection:'column', gap:16 }}>
              <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
                <input
                  className="search-box"
                  style={{ maxWidth: 180 }}
                  placeholder="Order ID"
                  value={blOrderIdInput}
                  onChange={e => setBlOrderIdInput(e.target.value)}
                />
                <button className="btn btn-secondary btn-sm" onClick={() => loadBrickLinkOrderDetail(blOrderIdInput)}
                  disabled={!String(blOrderIdInput || '').trim() || blOrderDetailState.status === 'loading'}>
                  {blOrderDetailState.status === 'loading' ? 'Loading…' : 'Load Order'}
                </button>
                <button className="btn btn-secondary btn-sm" onClick={loadBrickLinkOrders}
                  disabled={blOrdersState.status === 'loading'}>
                  {blOrdersState.status === 'loading' ? 'Refreshing…' : 'Refresh Recent'}
                </button>
                {blOrderImportState.message && (
                  <span style={{
                    fontSize:12,
                    color: blOrderImportState.status === 'done' ? 'var(--green)' : blOrderImportState.status === 'importing' ? 'var(--text2)' : 'var(--red)',
                  }}>
                    {blOrderImportState.message}
                  </span>
                )}
              </div>

              {blOrdersState.error && (
                <div style={{ fontSize:13, color:'var(--red)' }}>{blOrdersState.error}</div>
              )}

              {!!blOrdersState.orders.length && (
                <div style={{ border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
                  <div style={{ padding:'8px 12px', fontSize:12, color:'var(--text2)', background:'var(--surface2)' }}>Recent incoming orders</div>
                  <div style={{ maxHeight:180, overflowY:'auto' }}>
                    {blOrdersState.orders.map(order => {
                      const active = String(order.orderId) === String(blOrderDetailState.order?.orderId || blOrderIdInput || '');
                      return (
                        <button key={order.orderId}
                          onClick={() => loadBrickLinkOrderDetail(order.orderId)}
                          style={{
                            width:'100%',
                            textAlign:'left',
                            padding:'10px 12px',
                            border:'none',
                            borderTop:'1px solid var(--border)',
                            background: active ? 'rgba(76,140,231,.12)' : 'var(--surface)',
                            color:'var(--text1)',
                            cursor:'pointer',
                          }}>
                          <div style={{ display:'flex', justifyContent:'space-between', gap:10, fontSize:13 }}>
                            <span style={{ fontWeight:600 }}>#{order.orderId} {order.buyerName ? `• ${order.buyerName}` : ''}</span>
                            <span style={{ color:'var(--text2)' }}>{order.grandTotal != null ? currency(order.grandTotal) : '—'}</span>
                          </div>
                          <div style={{ marginTop:3, fontSize:11, color:'var(--text2)' }}>
                            {order.dateOrdered ? new Date(order.dateOrdered).toLocaleString() : '—'} · {order.status || 'Unknown'} · {order.uniqueCount || 0} line{(order.uniqueCount || 0) !== 1 ? 's' : ''}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {blOrderDetailState.error && (
                <div style={{ fontSize:13, color:'var(--red)' }}>{blOrderDetailState.error}</div>
              )}

              {blOrderDetailState.order && (
                <>
                  <div style={{ display:'flex', gap:12, flexWrap:'wrap', fontSize:13, alignItems:'flex-end' }}>
                    <div style={{ padding:'10px 12px', border:'1px solid var(--border)', borderRadius:8, background:'var(--surface2)' }}>
                      <div style={{ fontSize:11, color:'var(--text2)', textTransform:'uppercase' }}>Order</div>
                      <div style={{ fontWeight:700 }}>#{blOrderDetailState.order.orderId}</div>
                    </div>
                    <div style={{ padding:'10px 12px', border:'1px solid var(--border)', borderRadius:8, background:'var(--surface2)' }}>
                      <div style={{ fontSize:11, color:'var(--text2)', textTransform:'uppercase' }}>Buyer</div>
                      <div style={{ fontWeight:700 }}>{blOrderDetailState.order.buyerName || '—'}</div>
                    </div>
                    <div style={{ padding:'10px 12px', border:'1px solid var(--border)', borderRadius:8, background:'var(--surface2)' }}>
                      <div style={{ fontSize:11, color:'var(--text2)', textTransform:'uppercase' }}>Grand Total</div>
                      <div style={{ fontWeight:700 }}>{blOrderDetailState.order.grandTotal != null ? currency(blOrderDetailState.order.grandTotal) : '—'}</div>
                    </div>
                    <div style={{ padding:'10px 12px', border:'1px solid var(--border)', borderRadius:8, background:'var(--surface2)' }}>
                      <div style={{ fontSize:11, color:'var(--text2)', textTransform:'uppercase' }}>Matched</div>
                      <div style={{ fontWeight:700 }}>{orderImportPreview.matchedCount}/{orderImportPreview.rows.length}</div>
                    </div>
                    {/* Shipping input */}
                    <div className="form-group" style={{ marginBottom:0 }}>
                      <label style={{ fontSize:11, textTransform:'uppercase', color:'var(--text2)', letterSpacing:'.4px' }}>Shipping cost ($)</label>
                      <input
                        type="number" step="0.01" min="0" placeholder="0.00"
                        value={blShippingInput}
                        onChange={e => setBlShippingInput(e.target.value)}
                        style={{ width:110, fontSize:13 }}
                      />
                    </div>
                    {/* Auto-calculated fees */}
                    <div style={{ padding:'10px 12px', border:'1px solid var(--border)', borderRadius:8, background:'var(--surface2)' }}>
                      <div style={{ fontSize:11, color:'var(--text2)', textTransform:'uppercase' }}>Fees (6%)</div>
                      <div style={{ fontWeight:700 }}>
                        {blOrderDetailState.order.grandTotal != null
                          ? currency(Math.round(blOrderDetailState.order.grandTotal * 0.06 * 100) / 100)
                          : '—'}
                      </div>
                    </div>
                  </div>

                  <div style={{ border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                      <thead>
                        <tr>
                          <th style={{ padding:'8px 10px', borderBottom:'1px solid var(--border)', textAlign:'left' }}>Order Item</th>
                          <th style={{ padding:'8px 10px', borderBottom:'1px solid var(--border)', textAlign:'left' }}>Qty</th>
                          <th style={{ padding:'8px 10px', borderBottom:'1px solid var(--border)', textAlign:'left' }}>Unit</th>
                          <th style={{ padding:'8px 10px', borderBottom:'1px solid var(--border)', textAlign:'left' }}>Local Match</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orderImportPreview.rows.map((row, idx) => (
                          <tr key={`${row.itemNumber}-${idx}`} style={{ borderTop:'1px solid var(--border)' }}>
                            <td style={{ padding:'8px 10px' }}>
                              <div style={{ fontWeight:600 }}>{row.name || row.itemNumber}</div>
                              <div style={{ fontSize:11, color:'var(--text2)' }}>
                                {row.itemNumber} · {itemTypeLabel(row.itemType)}{row.colorName ? ` · ${row.colorName}` : ''}
                              </div>
                            </td>
                            <td style={{ padding:'8px 10px' }}>{row.quantity}</td>
                            <td style={{ padding:'8px 10px' }}>{row.unitPrice != null ? currency(row.unitPrice) : '—'}</td>
                            <td style={{ padding:'8px 10px' }}>
                              {row.allocations.length ? (
                                <div>
                                  <div style={{ color:'var(--green)', fontWeight:600 }}>
                                    Matched {row.matchedQty}/{row.quantity}
                                  </div>
                                  <div style={{ fontSize:11, color:'var(--text2)' }}>
                                    {row.allocations.map(allocation => `${allocation.item.itemNumber} ×${allocation.qtySold}`).join(', ')}
                                  </div>
                                  {row.unmatchedQty > 0 && (
                                    <div style={{ fontSize:11, color:'var(--orange)', marginTop:2 }}>
                                      {row.unmatchedQty} unmatched
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span style={{ color:'var(--red)', fontWeight:600 }}>No local match</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={closeBrickLinkOrderModal}>Close</button>
              <button className="btn btn-primary" onClick={importBrickLinkOrder}
                disabled={!orderImportPreview.importRows.length || blOrderImportState.status === 'importing'}>
                {blOrderImportState.status === 'importing' ? 'Importing…' : `Import Matched Items (${orderImportPreview.importRows.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {redditDraft && (
        <div className="modal-overlay" onClick={() => setRedditDraft(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 620 }}>
            <div className="modal-header">
              <h2>Reddit Post Draft</h2>
              <button className="btn-icon" onClick={() => setRedditDraft(null)}>{Icons.x}</button>
            </div>
            <div className="modal-body" style={{ padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4 }}>
                  Post Title
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    style={{ flex: 1, fontFamily: 'inherit', fontSize: 13, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text1)' }}
                    value={redditDraft.title}
                    onChange={e => setRedditDraft(d => ({ ...d, title: e.target.value }))} />
                  <button className="btn btn-secondary btn-sm" style={{ whiteSpace: 'nowrap' }}
                    onClick={() => navigator.clipboard?.writeText(redditDraft.title)}>
                    Copy
                  </button>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4 }}>
                  Photos URL
                </div>
                <input
                  style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 13, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text1)' }}
                  placeholder="https://imgur.com/a/… (optional)"
                  value={redditDraft.photosUrl || ''}
                  onChange={e => {
                    const url = e.target.value;
                    setRedditDraft(d => ({ ...d, photosUrl: url, body: d.buildBody(url) }));
                  }} />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 4 }}>
                  Post Body
                </div>
                <textarea
                  rows={12}
                  style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: 12, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text1)', resize: 'vertical' }}
                  value={redditDraft.body}
                  onChange={e => setRedditDraft(d => ({ ...d, body: e.target.value }))} />
              </div>
            </div>
            <div className="modal-footer" style={{ gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => setRedditDraft(null)}>Close</button>
              <a className="btn btn-secondary" href="https://www.reddit.com/r/legomarket/submit?type=self" target="_blank" rel="noopener"
                style={{ textDecoration: 'none' }}>
                Open r/legomarket ↗
              </a>
              <button className="btn btn-primary"
                onClick={() => navigator.clipboard?.writeText(`${redditDraft.title}\n\n${redditDraft.body}`)}>
                Copy All
              </button>
            </div>
          </div>
        </div>
      )}

      {detailItem && (
        <ListingDetailModal
          item={items.find(i => i.id === detailItem.id) || detailItem}
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
    </>
  );
}
