function App() {
  const [data,        setData]        = React.useState(loadData);
  const [settings,    setSettings]    = React.useState(loadSettings);
  const [page,        setPage]        = React.useState('inventory');
  const [pricingSearch, setPricingSearch] = React.useState('');
  const [modal,       setModal]       = React.useState(null);
  const [search,      setSearch]      = React.useState('');
  const [typeFilter,      setTypeFilter]      = React.useState('all');
  const [statusFilter,    setStatusFilter]    = React.useState('all');
  const [colorFilter,     setColorFilter]     = React.useState('all');
  const [themeFilter,     setThemeFilter]     = React.useState('all');
  const [conditionFilter, setConditionFilter] = React.useState('all');
  const [dateAddedFilter, setDateAddedFilter] = React.useState('all');
  const [sortCol,     setSortCol]     = React.useState('itemNumber');
  const [sortDir,     setSortDir]     = React.useState('asc');
  const [editItem,    setEditItem]    = React.useState(null);
  const [bulkEditOpen,   setBulkEditOpen]   = React.useState(false);
  const [mergeOpen,      setMergeOpen]      = React.useState(false);
  const [mergeResult,    setMergeResult]    = React.useState(null); // { count, skipped } | null
  const [sellItem,    setSellItem]    = React.useState(null); // item pending a sell-quantity modal
  const [lotSaleOpen, setLotSaleOpen] = React.useState(false); // lot sale modal open
  const [onItemSaved,    setOnItemSaved]    = React.useState(null); // optional callback after a successful add/edit
  const [onPriceFetched, setOnPriceFetched] = React.useState(null); // optional callback when modal fetches prices
  const [catalog,     setCatalog]     = React.useState(null); // { loaded, counts, loadedAt }
  const [colors,      setColors]      = React.useState(null); // { loaded, count }
  const [categories,  setCategories]  = React.useState(null); // { loaded, count }
  const [itemTypes,   setItemTypes]   = React.useState(null); // { loaded, count }
  const [saveStatus,  setSaveStatus]  = React.useState(''); // '', 'saving', 'saved', 'error'
  const fileInput = React.useRef(null);
  const saveTimerRef = React.useRef(null);

  // ─── Persist to disk via Flask ───
  const saveToFile = React.useCallback((dataToSave) => {
    setSaveStatus('saving');
    fetch('/api/data/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dataToSave),
    })
      .then(r => r.json())
      .then(res => {
        if (res.ok) {
          setSaveStatus('saved');
          saveTimerRef.current = setTimeout(() => setSaveStatus(''), 2000);
        } else {
          setSaveStatus('error');
        }
      })
      .catch(() => setSaveStatus('error'));
  }, []);

  // Auto-save to localStorage (existing) + debounced save to disk on every data change
  React.useEffect(() => {
    saveData(data);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveToFile(data), 800);
  }, [data]);

  React.useEffect(() => {
    saveSettings(settings);
    document.body.classList.toggle('light', settings?.theme === 'light');
  }, [settings]);

  // On startup: load from file if it exists, override localStorage data
  React.useEffect(() => {
    fetch('/api/data/load')
      .then(r => r.json())
      .then(res => {
        if (res.ok && res.data && res.data.items) {
          setData(res.data);
        }
      })
      .catch(() => {}); // fall back to localStorage silently

    fetchCatalogStatus().then(s => { if (s) setCatalog(s); });
    fetchColorsStatus().then(s => { if (s) setColors(s); });
    fetchCategoriesStatus().then(s => { if (s) setCategories(s); });
    fetch('/api/itemtypes/status').then(r => r.json()).then(s => { if (s?.loaded) setItemTypes(s); }).catch(() => {});
  }, []);

  const updateItems = React.useCallback((fn) => {
    setData(prev => ({ ...prev, items: fn(prev.items) }));
  }, []);

  // ─── Stats ───
  const stats = React.useMemo(() => {
    let totalQty = 0, totalCost = 0, totalValue = 0, listed = 0, soldQty = 0;
    let totalRevenue = 0, totalProfit = 0, sets = 0, minifigs = 0, parts = 0;

    for (const i of data.items) {
      const qty = i.quantity || 1;
      totalQty += qty;
      totalCost += (i.purchasePrice || 0) * qty;
      totalValue += (suggestedPrice(i) ?? i.estimatedValue ?? 0) * qty;

      if (i.type === 'set') sets++;
      else if (i.type === 'minifig') minifigs++;
      else if (i.type === 'part') parts++;

      if (i.sellStatus === 'listed') listed += qty;
      if (i.sellStatus === 'sold') {
        soldQty += qty;
        const rev  = (i.salePrice || 0) * qty;
        const cost = (i.purchasePrice || 0) * qty + (i.fees || 0) + (i.shippingCost || 0);
        totalRevenue += rev;
        totalProfit += rev - cost;
      }
    }

    return {
      totalItems: data.items.length, totalQty, totalCost, totalValue,
      listed, sold: soldQty, totalRevenue, totalProfit,
      sets, minifigs, parts,
    };
  }, [data.items]);

  const activeItems = React.useMemo(() => data.items.filter(i => i.sellStatus !== 'sold'), [data.items]);
  const listedItems = React.useMemo(() => data.items.filter(i => i.sellStatus === 'listed'), [data.items]);
  const wantedTotalQty = React.useMemo(() => (
    (data.wantedLists || []).reduce((s, l) => s + (l.items || []).reduce((sum, item) => sum + (item.qty || 1), 0), 0)
  ), [data.wantedLists]);

  // ─── Filtered & Sorted Items ───
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const hasSearch = q.length > 0;
    const items = [];

    const now = Date.now();
    const dateAddedCutoff = dateAddedFilter === 'all' ? null
      : dateAddedFilter === '7d'  ? now - 7  * 86400000
      : dateAddedFilter === '30d' ? now - 30 * 86400000
      : dateAddedFilter === '90d' ? now - 90 * 86400000
      : dateAddedFilter === '1y'  ? now - 365 * 86400000
      : null;

    for (const i of activeItems) {
      if (typeFilter !== 'all' && i.type !== typeFilter) continue;
      if (statusFilter !== 'all' && i.sellStatus !== statusFilter) continue;
      if (colorFilter !== 'all' && (i.color || '') !== colorFilter) continue;
      if (themeFilter !== 'all' && (i.theme || '') !== themeFilter) continue;
      if (conditionFilter !== 'all' && (i.condition || '') !== conditionFilter) continue;
      if (dateAddedCutoff !== null) {
        if (!i.dateAdded) continue;
        if (new Date(i.dateAdded).getTime() < dateAddedCutoff) continue;
      }
      if (hasSearch) {
        const matches =
          (i.name || '').toLowerCase().includes(q) ||
          (i.itemNumber || '').toLowerCase().includes(q) ||
          (i.theme || '').toLowerCase().includes(q) ||
          (i.notes || '').toLowerCase().includes(q) ||
          (i.keywords || []).some(k => String(k).toLowerCase().includes(q));
        if (!matches) continue;
      }
      items.push(i);
    }

    return [...items].sort((a,b) => {
      let va = a[sortCol], vb = b[sortCol];
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      va = va ?? ''; vb = vb ?? '';
      if (va < vb) return sortDir==='asc' ? -1 : 1;
      if (va > vb) return sortDir==='asc' ?  1 : -1;
      return 0;
    });
  }, [activeItems, search, typeFilter, statusFilter, colorFilter, themeFilter, conditionFilter, dateAddedFilter, sortCol, sortDir]);

  const handleSort = (col) => {
    if (sortCol===col) setSortDir(d => d==='asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  // ─── CRUD ───
  const addItem    = (item) => { updateItems(items => [...items, { ...item, id: genId(), createdAt: new Date().toISOString() }]); if (onItemSaved) { onItemSaved(item); setOnItemSaved(null); } setModal(null); setEditItem(null); };
  const updateItem = (item) => {
    const existing = data.items.find(i => i.id === item.id);
    const numberChanged = String(existing?.itemNumber || '').trim() !== String(item.itemNumber || '').trim();
    const conditionChanged = (existing?.condition || '') !== (item.condition || '');
    const shouldRefreshPrices = existing && item.itemNumber && item.sellStatus !== 'sold' && (numberChanged || conditionChanged);
    const updatedItem = { ...item, updatedAt: new Date().toISOString() };
    if (shouldRefreshPrices) {
      Object.assign(updatedItem, {
        bricklinkPrice: '',
        bricklinkMedian: null,
        bricklinkSoldQty: null,
        bricklinkSoldOutliers: null,
        bricklinkPriceEstimated: null,
        bricklinkActive: null,
        bricklinkActiveMedian: null,
        bricklinkActiveQty: null,
        bricklinkActiveOutliers: null,
        ebayPrice: '',
        ebayPlusShipping: null,
        ebayMin: null,
        ebayMax: null,
        estimatedValue: 0,
        minifigValue: null,
        minifigList: null,
        priceHistory: [],
        priceSnapshots: {},
      });
    }

    updateItems(items => items.map(i => i.id===item.id ? { ...i, ...updatedItem } : i));
    setModal(null);
    setEditItem(null);
    if (shouldRefreshPrices) refreshPricesForItem(updatedItem);

    // Sync BrickLink store quantity if it changed on a listed item.
    // BL's PUT /inventories/{id} treats `quantity` as a delta, so send the difference.
    const oldQty = existing?.quantity || 1;
    const newQty = item.quantity || 1;
    const qtyDelta = newQty - oldQty;
    if (blConfigured && item.bricklinkInventoryId && item.sellStatus === 'listed' && qtyDelta !== 0) {
      fetch('/api/bricklink/store/update-quantity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inventory_id: item.bricklinkInventoryId, quantity: qtyDelta, new_quantity: newQty }),
      }).catch(() => {});
    }
  };
  const deleteItem = (id)   => { if (confirm('Delete this item?')) updateItems(items => items.filter(i => i.id!==id)); };

  // ─── Record Sale (partial or full quantity) ───
  // qtySold < item.quantity → reduce original qty, create a new sold record for the sold portion
  // qtySold = item.quantity → mark the original item as sold in place
  const recordSale = React.useCallback(({ item, qtySold, salePrice, fees, shippingCost, platform }) => {
    const now  = new Date().toISOString();
    const total = item.quantity || 1;
    updateItems(prev => {
      const next = prev.filter(i => i.id !== item.id);
      if (qtySold >= total) {
        // Full sale — update the original item in place
        next.push({ ...item, sellStatus: 'sold', salePrice, fees, shippingCost, platform, updatedAt: now });
      } else {
        // Partial sale — reduce the original, create a new sold record
        next.push({ ...item, quantity: total - qtySold, updatedAt: now });
        next.push({
          ...item,
          id: genId(),
          quantity: qtySold,
          sellStatus: 'sold',
          salePrice,
          fees,
          shippingCost,
          platform,
          createdAt: now,
          updatedAt: now,
        });
      }
      return next;
    });
    setSellItem(null);
  }, [updateItems]);

  // ─── Record Lot Sale ───
  // Each row: { item, qtySold, salePrice (per unit), fees (share), shippingCost (share), platform }
  // For each row: if qtySold < item.quantity → reduce original + create sold record
  //               if qtySold = item.quantity → mark original as sold
  const recordLotSale = React.useCallback(({ rows }) => {
    const now = new Date().toISOString();
    updateItems(prev => {
      let next = [...prev];
      for (const row of rows) {
        const { item, qtySold, salePrice, fees, shippingCost, platform } = row;
        const total = item.quantity || 1;
        next = next.filter(i => i.id !== item.id);
        if (qtySold >= total) {
          next.push({ ...item, sellStatus: 'sold', salePrice, fees, shippingCost, platform, updatedAt: now });
        } else {
          next.push({ ...item, quantity: total - qtySold, updatedAt: now });
          next.push({ ...item, id: genId(), quantity: qtySold, sellStatus: 'sold', salePrice, fees, shippingCost, platform, createdAt: now, updatedAt: now });
        }
      }
      return next;
    });
    setLotSaleOpen(false);
  }, [updateItems]);

  const handleMergeDuplicates = React.useCallback(() => {
    setMergeOpen(true);
  }, []);

  const handleMergeComplete = React.useCallback(async (nextItems, count, skipped, blActions) => {
    updateItems(() => nextItems);
    setMergeOpen(false);

    if (blConfigured && blActions && blActions.length > 0) {
      setMergeResult({ count, skipped, blStatus: 'syncing' });
      let blDone = 0, blFailed = 0;
      for (const action of blActions) {
        try {
          const endpoint = action.action === 'delete'
            ? '/api/bricklink/store/remove-listing'
            : '/api/bricklink/store/update-quantity';
          const body = action.action === 'delete'
            ? { inventory_id: action.inventoryId }
            : { inventory_id: action.inventoryId, quantity: action.quantity };
          const resp = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const result = await resp.json();
          if (result.ok) blDone++; else blFailed++;
        } catch { blFailed++; }
      }
      setMergeResult({ count, skipped, blStatus: 'done', blDone, blFailed });
      setTimeout(() => setMergeResult(null), 5000);
    } else {
      setMergeResult({ count, skipped });
      setTimeout(() => setMergeResult(null), 4000);
    }
  }, [updateItems, blConfigured]);

  // ─── Import / Export ───
  const downloadBlob = (content, filename, type) => {
    const blob = new Blob([content], { type });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click(); URL.revokeObjectURL(url);
  };
  const exportData = () => downloadBlob(JSON.stringify(data, null, 2), `brickvault-${new Date().toISOString().slice(0,10)}.json`, 'application/json');
  const exportCSV  = () => {
    const headers = ['Type','Item Number','Name','Theme','Condition','Quantity','Purchase Price','Estimated Value','BrickLink Price','eBay Price','Sell Status','List Price','Sale Price','Fees','Shipping Cost','Platform','Notes'];
    const rows    = data.items.map(i => [i.type,i.itemNumber,i.name,i.theme,CONDITION_LABELS[i.condition]||'',i.quantity||1,i.purchasePrice||'',i.estimatedValue||'',i.bricklinkPrice||'',i.ebayPrice||'',i.sellStatus||'available',i.listPrice||'',i.salePrice||'',i.fees||'',i.shippingCost||'',i.platform||'',i.notes||'']);
    const csv     = [headers,...rows].map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    downloadBlob(csv, `brickvault-${new Date().toISOString().slice(0,10)}.csv`, 'text/csv');
  };
  const exportBricklinkXML = (options={}) => {
    const suffix = options.forSale ? '-forsale' : '-inventory';
    downloadBlob(generateBricklinkXML(data.items, options), `bricklink${suffix}-${new Date().toISOString().slice(0,10)}.xml`, 'application/xml');
  };
  const exportBricklinkWanted = () => {
    downloadBlob(generateBricklinkXML(data.items.filter(i=>i.sellStatus!=='sold'), {includePrice:false}), `bricklink-wantedlist-${new Date().toISOString().slice(0,10)}.xml`, 'application/xml');
  };
  const importData = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        if (file.name.endsWith('.json')) {
          const imported = JSON.parse(ev.target.result);
          if (imported.items) { setData(prev => ({...prev, items:[...prev.items,...imported.items.map(i=>({...i,id:genId()}))]})); alert(`Imported ${imported.items.length} items!`); }
        } else if (file.name.endsWith('.xml') || file.name.endsWith('.bsx')) {
          const parsed = parseBricklinkXML(ev.target.result);
          const withColors = await enrichItemsWithColorHex(parsed);
          const newItems = await enrichItemsWithCategory(withColors);
          updateItems(items => [...items, ...newItems]);
          alert(`Imported ${newItems.length} items from BrickLink XML!`);
        } else if (file.name.endsWith('.csv')) {
          const lines   = ev.target.result.split('\n');
          const headers = lines[0].split(',').map(h => h.replace(/"/g,'').trim());
          const newItems = [];
          for (let r=1; r<lines.length; r++) {
            if (!lines[r].trim()) continue;
            const vals = lines[r].match(/(".*?"|[^,]+)/g)?.map(v => v.replace(/^"|"$/g,'').replace(/""/g,'"').trim()) || [];
            const obj  = {}; headers.forEach((h,idx) => { obj[h]=vals[idx]||''; });
            const condKey = Object.entries(CONDITION_LABELS).find(([k,v])=>v===obj['Condition'])?.[0] || 'used_complete';
            newItems.push({ id:genId(), type:obj['Type']||'set', itemNumber:obj['Item Number']||'', name:obj['Name']||'', theme:obj['Theme']||'', condition:condKey, quantity:parseInt(obj['Quantity'])||1, purchasePrice:parseFloat(obj['Purchase Price'])||0, estimatedValue:parseFloat(obj['Estimated Value'])||0, bricklinkPrice:parseFloat(obj['BrickLink Price'])||0, ebayPrice:parseFloat(obj['eBay Price'])||0, sellStatus:obj['Sell Status']||'available', listPrice:parseFloat(obj['List Price'])||0, salePrice:parseFloat(obj['Sale Price'])||0, fees:parseFloat(obj['Fees'])||0, shippingCost:parseFloat(obj['Shipping Cost'])||0, platform:obj['Platform']||'', notes:obj['Notes']||'', createdAt:new Date().toISOString() });
          }
          updateItems(items => [...items,...newItems]);
          alert(`Imported ${newItems.length} items from CSV!`);
        } else {
          const content = ev.target.result.trim();
          if (content.startsWith('<?xml') || content.startsWith('<INVENTORY')) {
            const parsed = parseBricklinkXML(content);
            const withColors = await enrichItemsWithColorHex(parsed);
            const newItems = await enrichItemsWithCategory(withColors);
            updateItems(items => [...items,...newItems]);
            alert(`Imported ${newItems.length} items from BrickLink XML!`);
          } else {
            alert('Unsupported file. Use .json, .csv, .xml, or .bsx.');
          }
        }
      } catch(err) { alert('Error importing: ' + err.message); }
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  // ─── Batch BrickLink Fetch (lives here so it persists across page navigation) ───
  const BATCH_KEY = 'brickvault_batch_pending';

  const [batchStatus,   setBatchStatus]   = React.useState(() => localStorage.getItem(BATCH_KEY) ? 'interrupted' : '');
  const [batchProgress, setBatchProgress] = React.useState('');
  const [batchCounts,   setBatchCounts]   = React.useState(null);
  const [batchCurrent,  setBatchCurrent]  = React.useState('');
  const [blConfigured,       setBlConfigured]       = React.useState(false);
  const [ebayConfigured,     setEbayConfigured]     = React.useState(false);
  const [bricksetConfigured, setBricksetConfigured] = React.useState(false);
  const batchCancelRef = React.useRef(false);

  React.useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(cfg => {
        if (cfg.bricklink?.configured) setBlConfigured(true);
        if (cfg.brickset?.configured) setBricksetConfigured(true);
      })
      .catch(() => {});
    fetch('/api/config/ebay')
      .then(r => r.json())
      .then(cfg => { if (cfg.configured) setEbayConfigured(true); })
      .catch(() => {});
  }, []);

  const cancelBricklinkFetch = React.useCallback(() => {
    batchCancelRef.current = true;
  }, []);

  const runBatch = React.useCallback(async (itemsToProcess, hasCatalog) => {
    batchCancelRef.current = false;
    setBatchStatus('running');
    setBatchProgress(`0 / ${itemsToProcess.length}`);
    setBatchCounts(null);
    setBatchCurrent('');

    // Save pending IDs to localStorage so a refresh can detect the interrupted job
    localStorage.setItem(BATCH_KEY, JSON.stringify(itemsToProcess.map(i => i.id)));

    let updated = 0, skipped = 0, failed = 0;
    const failedIds  = new Set();
    const pendingIds = new Set(itemsToProcess.map(i => i.id));

    for (let i = 0; i < itemsToProcess.length; i++) {
      if (batchCancelRef.current) {
        // Save remaining IDs (not yet processed) so resume knows where to pick up
        const remaining = itemsToProcess.slice(i).map(it => it.id);
        localStorage.setItem(BATCH_KEY, JSON.stringify(remaining));
        setBatchCurrent('');
        setBatchStatus('cancelled');
        setBatchCounts({ updated, skipped, failed });
        if (failedIds.size > 0) {
          updateItems(prev => prev.map(item =>
            failedIds.has(item.id) ? { ...item, blLookupFailed: true, updatedAt: new Date().toISOString() } : item
          ));
        }
        return;
      }

      const item = itemsToProcess[i];
      setBatchProgress(`${i + 1} / ${itemsToProcess.length}`);

      if (!item.itemNumber) { skipped++; setBatchCurrent('skipped: no ID'); pendingIds.delete(item.id); continue; }
      if (item.name && item.theme && item.imageUrl) { skipped++; setBatchCurrent(`skipped: ${item.itemNumber} (already complete)`); pendingIds.delete(item.id); continue; }

      let usedCatalog = false;
      try {
        // Check server catalog first — no BrickLink API call needed if found
        let result;
        if (hasCatalog) {
          setBatchCurrent(`catalog: ${item.itemNumber}…`);
          const params = new URLSearchParams({ type: item.type || 'set', itemNumber: item.itemNumber });
          const catResp = await fetch(`/api/catalog/lookup?${params}`);
          const catData = catResp.ok ? await catResp.json() : { found: false };
          if (catData.found && (catData.name || catData.theme)) {
            result = { name: catData.name, theme: catData.theme, imageUrl: null };
            usedCatalog = true;
          }
        }
        if (!result) {
          setBatchCurrent(`api: ${item.itemNumber}…`);
          const apiResult = await lookupItemBrickLink(item.type || 'set', item.itemNumber, item.blColorId || '');
          result = apiResult;
          usedCatalog = false; // used API, so apply rate limit delay
        }

        const changes = {};
        if (result.name)     changes.name     = result.name;
        if (result.theme)    changes.theme    = result.theme;
        if (result.imageUrl) changes.imageUrl = result.imageUrl;
        if (result.color)    changes.color    = result.color;
        if (result.colorId)  changes.blColorId = result.colorId;
        if (result.colorHex) changes.colorHex  = result.colorHex;

        if (Object.keys(changes).length > 0) {
          // Apply immediately so the row updates in the list as it's found
          updateItems(prev => prev.map(it =>
            it.id === item.id ? { ...it, ...changes, blLookupFailed: false, updatedAt: new Date().toISOString() } : it
          ));
          updated++;
          setBatchCurrent(`found: ${[result.name, result.theme].filter(Boolean).join(', ') || item.itemNumber}`);
        } else {
          skipped++;
          setBatchCurrent(`skipped: ${item.itemNumber} (no new data)`);
        }
      } catch(e) {
        failed++;
        failedIds.add(item.id);
        setBatchCurrent(`failed: ${item.itemNumber}`);
      }

      pendingIds.delete(item.id);
      // Update remaining IDs in localStorage as we go
      localStorage.setItem(BATCH_KEY, JSON.stringify([...pendingIds]));

      // Only throttle if we hit the BrickLink API (catalog lookups need no delay)
      if (!usedCatalog && i < itemsToProcess.length - 1) await new Promise(r => setTimeout(r, 400));
    }

    if (failedIds.size > 0) {
      updateItems(prev => prev.map(item =>
        failedIds.has(item.id) ? { ...item, blLookupFailed: true, updatedAt: new Date().toISOString() } : item
      ));
    }

    localStorage.removeItem(BATCH_KEY);
    setBatchCounts({ updated, skipped, failed });
    setBatchStatus('done');
  }, [updateItems]);

  const fetchBricklinkDetails = React.useCallback(async () => {
    if (!data.items.length) { setBatchStatus('error:No items in inventory.'); return; }
    if (!blConfigured && !catalog?.loaded) { setBatchStatus('error:Configure BrickLink API credentials or load a catalog first.'); return; }
    await runBatch(data.items, catalog?.loaded);
  }, [data.items, blConfigured, catalog, runBatch]);

  const resumeBricklinkFetch = React.useCallback(async () => {
    if (!blConfigured && !catalog?.loaded) { setBatchStatus('error:Configure BrickLink API credentials or load a catalog first.'); return; }
    const savedIds = JSON.parse(localStorage.getItem(BATCH_KEY) || '[]');
    const idSet = new Set(savedIds);
    const itemsToProcess = data.items.filter(i => idSet.has(i.id));
    if (!itemsToProcess.length) { localStorage.removeItem(BATCH_KEY); setBatchStatus(''); return; }
    await runBatch(itemsToProcess, catalog?.loaded);
  }, [data.items, blConfigured, catalog, runBatch]);

  const discardBatch = React.useCallback(() => {
    localStorage.removeItem(BATCH_KEY);
    setBatchStatus('');
  }, []);

  // ─── Image Fetch (persists across navigation, resumable after refresh) ───
  const IMG_KEY = 'brickvault_img_pending';

  const [imgStatus,   setImgStatus]   = React.useState(() => localStorage.getItem(IMG_KEY) ? 'interrupted' : '');
  const [imgProgress, setImgProgress] = React.useState('');
  const [imgCounts,   setImgCounts]   = React.useState(null);
  const [imgCurrent,  setImgCurrent]  = React.useState('');
  const imgCancelRef = React.useRef(false);

  const cancelImageFetch = React.useCallback(() => { imgCancelRef.current = true; }, []);

  const runImageBatch = React.useCallback(async (itemsToProcess) => {
    imgCancelRef.current = false;
    setImgStatus('running');
    setImgProgress(`0 / ${itemsToProcess.length}`);
    setImgCounts(null);
    setImgCurrent('');

    localStorage.setItem(IMG_KEY, JSON.stringify(itemsToProcess.map(i => i.id)));

    let updated = 0, failed = 0;
    const pendingIds = new Set(itemsToProcess.map(i => i.id));

    for (let i = 0; i < itemsToProcess.length; i++) {
      if (imgCancelRef.current) {
        const remaining = itemsToProcess.slice(i).map(it => it.id);
        localStorage.setItem(IMG_KEY, JSON.stringify(remaining));
        setImgStatus('cancelled');
        setImgCounts({ updated, failed });
        setImgCurrent('');
        return;
      }

      const item = itemsToProcess[i];
      setImgProgress(`${i + 1} / ${itemsToProcess.length}`);
      setImgCurrent(`${item.itemNumber}…`);

      try {
        const params = new URLSearchParams({ type: item.type || 'set', itemNumber: item.itemNumber });
        if (item.type === 'part' && item.blColorId) params.set('colorId', item.blColorId);
        const resp = await fetch(`/api/bricklink/catalog?${params}`);
        const result = resp.ok ? await resp.json() : null;
        if (result && !result.error && result.imageUrl) {
          updateItems(prev => prev.map(it =>
            it.id === item.id ? { ...it, imageUrl: result.imageUrl, updatedAt: new Date().toISOString() } : it
          ));
          updated++;
          setImgCurrent(`✓ ${item.itemNumber}`);
        } else {
          failed++;
        }
      } catch(e) {
        failed++;
      }

      pendingIds.delete(item.id);
      localStorage.setItem(IMG_KEY, JSON.stringify([...pendingIds]));

      if (i < itemsToProcess.length - 1) await new Promise(r => setTimeout(r, 400));
    }

    localStorage.removeItem(IMG_KEY);
    setImgCounts({ updated, failed });
    setImgStatus('done');
    setImgCurrent('');
  }, [updateItems]);

  const fetchImages = React.useCallback(async () => {
    const items = data.items.filter(i => i.itemNumber && !i.imageUrl);
    if (!items.length) { setImgStatus('error:All items already have images.'); return; }
    if (!blConfigured) { setImgStatus('error:Configure BrickLink API credentials first.'); return; }
    await runImageBatch(items);
  }, [data.items, blConfigured, runImageBatch]);

  const resumeImageFetch = React.useCallback(async () => {
    if (!blConfigured) { setImgStatus('error:Configure BrickLink API credentials first.'); return; }
    const savedIds = JSON.parse(localStorage.getItem(IMG_KEY) || '[]');
    const idSet = new Set(savedIds);
    const itemsToProcess = data.items.filter(i => idSet.has(i.id));
    if (!itemsToProcess.length) { localStorage.removeItem(IMG_KEY); setImgStatus(''); return; }
    await runImageBatch(itemsToProcess);
  }, [data.items, blConfigured, runImageBatch]);

  const discardImageFetch = React.useCallback(() => {
    localStorage.removeItem(IMG_KEY);
    setImgStatus('');
  }, []);

  const clearImages = React.useCallback(async () => {
    // Clear imageUrl from all items in memory
    updateItems(prev => prev.map(it => ({ ...it, imageUrl: '' })));
    // Clear the disk cache on the server
    try { await fetch('/api/images/clear', { method: 'POST' }); } catch(e) {}
    setImgStatus('');
    setImgCounts(null);
  }, [updateItems]);

  const imgProps = { imgStatus, imgProgress, imgCounts, imgCurrent, fetchImages, cancelImageFetch, resumeImageFetch, discardImageFetch, clearImages };

  // ─── Price Batch (lives here so sidebar shows progress across navigation) ───
  const PRICE_BATCH_KEY = 'brickvault_price_batch_pending';
  const [priceBatchStatus,   setPriceBatchStatus]   = React.useState(() => localStorage.getItem('brickvault_price_batch_pending') ? 'interrupted' : '');
  const [priceBatchProgress, setPriceBatchProgress] = React.useState('');
  const [priceBatchCounts,   setPriceBatchCounts]   = React.useState(null);
  const [priceBatchCurrent,  setPriceBatchCurrent]  = React.useState('');
  const [pendingPriceBatch,  setPendingPriceBatch]  = React.useState('');
  const priceBatchCancelRef  = React.useRef(false);
  // PricingPage registers its fetchPricesForItem here so App can call it
  const priceFetcherRef = React.useRef(null);

  const runPriceBatch = React.useCallback(async (itemsToProcess) => {
    if (!priceFetcherRef.current) return;
    priceBatchCancelRef.current = false;
    setPriceBatchStatus('running');
    setPriceBatchProgress(`0 / ${itemsToProcess.length}`);
    setPriceBatchCounts(null);
    setPriceBatchCurrent('');
    localStorage.setItem(PRICE_BATCH_KEY, JSON.stringify(itemsToProcess.map(i => i.id)));

    let done = 0, failed = 0;
    const pendingIds = new Set(itemsToProcess.map(i => i.id));

    for (let i = 0; i < itemsToProcess.length; i++) {
      if (priceBatchCancelRef.current) {
        const remaining = itemsToProcess.slice(i).map(it => it.id);
        localStorage.setItem(PRICE_BATCH_KEY, JSON.stringify(remaining));
        setPriceBatchCurrent('');
        setPriceBatchStatus('cancelled');
        setPriceBatchCounts({ done, failed });
        return;
      }
      const item = itemsToProcess[i];
      setPriceBatchProgress(`${i + 1} / ${itemsToProcess.length}`);
      setPriceBatchCurrent(item.name || item.itemNumber);
      try {
        await priceFetcherRef.current(item, { batch: true });
        done++;
      } catch(e) {
        failed++;
      }
      pendingIds.delete(item.id);
      localStorage.setItem(PRICE_BATCH_KEY, JSON.stringify([...pendingIds]));
    }

    localStorage.removeItem(PRICE_BATCH_KEY);
    setPriceBatchCounts({ done, failed });
    setPriceBatchStatus('done');
    setPriceBatchCurrent('');
  }, []);

  const priceBatchTargets = React.useCallback((force = false) => {
    const cutoff = Date.now() - 8 * 60 * 60 * 1000; // 8 hours ago
    return data.items.filter(i => {
      if (!i.itemNumber || i.sellStatus === 'sold') return false;
      if (force) return true;
      if (!i.updatedAt) return true;
      return new Date(i.updatedAt).getTime() < cutoff;
    });
  }, [data.items]);

  const fetchAllPrices = React.useCallback(async (options = {}) => {
    const force = !!options.force;
    const targets = priceBatchTargets(force);
    if (!targets.length) { setPriceBatchStatus('error:All items have been updated in the last 8 hours.'); return; }
    await runPriceBatch(targets);
  }, [priceBatchTargets, runPriceBatch]);

  const forceFetchAllPrices = React.useCallback(async () => {
    const targets = priceBatchTargets(true);
    if (!targets.length) { setPriceBatchStatus('error:No active items with item numbers to price.'); return; }
    if (!priceFetcherRef.current) {
      setPendingPriceBatch({ mode: 'force_all' });
      setPriceBatchStatus('queued');
      setPriceBatchProgress(`0 / ${targets.length}`);
      setPriceBatchCounts(null);
      setPriceBatchCurrent('Opening Price Guide…');
      setPage('pricing');
      return;
    }
    await runPriceBatch(targets);
  }, [priceBatchTargets, runPriceBatch]);

  const refreshPricesForItem = React.useCallback(async (item) => {
    if (!item?.id || !item.itemNumber || item.sellStatus === 'sold') return;
    setPricingSearch(item.itemNumber);
    if (!priceFetcherRef.current) {
      setPendingPriceBatch({ mode: 'single', itemId: item.id, item });
      setPriceBatchStatus('queued');
      setPriceBatchProgress('0 / 1');
      setPriceBatchCounts(null);
      setPriceBatchCurrent('Opening Price Guide…');
      setPage('pricing');
      return;
    }
    await runPriceBatch([item]);
  }, [runPriceBatch]);

  React.useEffect(() => {
    if (!pendingPriceBatch || page !== 'pricing') return;
    let attempts = 0;
    const startWhenReady = () => {
      attempts++;
      if (priceFetcherRef.current) {
        const batch = pendingPriceBatch;
        setPendingPriceBatch('');
        const targets = batch.mode === 'single'
          ? [batch.item || data.items.find(i => i.id === batch.itemId)].filter(Boolean)
          : priceBatchTargets(true);
        if (!targets.length) {
          setPriceBatchStatus(batch.mode === 'single'
            ? 'error:Could not find the edited item to price.'
            : 'error:No active items with item numbers to price.');
          setPriceBatchCurrent('');
          return;
        }
        runPriceBatch(targets);
        return;
      }
      if (attempts < 20) setTimeout(startWhenReady, 100);
      else {
        setPendingPriceBatch('');
        setPriceBatchStatus('error:Price Guide did not finish loading. Try again.');
        setPriceBatchCurrent('');
      }
    };
    const timer = setTimeout(startWhenReady, 0);
    return () => clearTimeout(timer);
  }, [pendingPriceBatch, page, data.items, priceBatchTargets, runPriceBatch]);

  const resumePriceFetch = React.useCallback(async () => {
    const savedIds = JSON.parse(localStorage.getItem(PRICE_BATCH_KEY) || '[]');
    const idSet = new Set(savedIds);
    const itemsToProcess = data.items.filter(i => idSet.has(i.id));
    if (!itemsToProcess.length) { localStorage.removeItem(PRICE_BATCH_KEY); setPriceBatchStatus(''); return; }
    await runPriceBatch(itemsToProcess);
  }, [data.items, runPriceBatch]);

  const discardPriceBatch = React.useCallback(() => {
    localStorage.removeItem(PRICE_BATCH_KEY);
    setPriceBatchStatus('');
    setPriceBatchCounts(null);
  }, []);

  const cancelPriceFetch = React.useCallback(() => { priceBatchCancelRef.current = true; }, []);

  const priceBatchProps = { priceBatchStatus, setPriceBatchStatus, priceBatchProgress, priceBatchCounts, priceBatchCurrent, fetchAllPrices, forceFetchAllPrices, resumePriceFetch, discardPriceBatch, cancelPriceFetch, priceFetcherRef };

  const batchProps = { batchStatus, setBatchStatus, batchProgress, batchCounts, batchCurrent, blConfigured, setBlConfigured, ebayConfigured, setEbayConfigured, bricksetConfigured, setBricksetConfigured, fetchBricklinkDetails, cancelBricklinkFetch, resumeBricklinkFetch, discardBatch, catalog, setCatalog, colors, setColors, categories, setCategories, itemTypes, setItemTypes, ...imgProps };

  const sharedExportProps = { exportData, exportCSV, exportBricklinkXML, exportBricklinkWanted, fileInput, importData };

  return (
    <div className="app">
      <div className="sidebar">
        <div className="logo">{Icons.brick} <span>Brick Vault</span></div>
        <div className="nav-section">
          <div className="nav-section-title">Manage</div>
          <div className={`nav-item ${page==='inventory'?'active':''}`} onClick={()=>setPage('inventory')}>
            {Icons.box}<span>Inventory</span><span className="nav-badge">{stats.totalItems}</span>
          </div>
          <div className={`nav-item ${page==='selling'?'active':''}`} onClick={()=>setPage('selling')}>
            {Icons.tag}<span>Selling</span>
            {stats.listed>0 && <span className="nav-badge">{stats.listed}</span>}
          </div>
          <div className={`nav-item ${page==='analytics'?'active':''}`} onClick={()=>setPage('analytics')}>
            {Icons.chart}<span>Analytics</span>
          </div>
          <div className={`nav-item ${page==='wanted'?'active':''}`} onClick={()=>setPage('wanted')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>
            <span>Wanted Lists</span>
            {wantedTotalQty > 0 && <span className="nav-badge">{wantedTotalQty}</span>}
          </div>
          <div className={`nav-item ${page==='salesquotes'?'active':''}`} onClick={()=>setPage('salesquotes')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            <span>Sales Quotes</span>
            {(data.salesQuotes||[]).filter(q => (q.quoteStatus || 'active') === 'active').length > 0 && <span className="nav-badge">{(data.salesQuotes||[]).filter(q => (q.quoteStatus || 'active') === 'active').length}</span>}
          </div>
          <div className={`nav-item ${page==='salesorders'?'active':''}`} onClick={()=>setPage('salesorders')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="12" y2="17"/></svg>
            <span>Sales Orders</span>
            {(data.salesOrders||[]).length > 0 && <span className="nav-badge">{(data.salesOrders||[]).length}</span>}
          </div>
        </div>
        <div className="nav-section">
          <div className="nav-section-title">Tools</div>
          <div className={`nav-item ${page==='store'?'active':''}`} onClick={()=>setPage('store')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            <span>BL Store</span>
          </div>
          <div className={`nav-item ${page==='catalog'?'active':''}`} onClick={()=>setPage('catalog')}>
            {Icons.search}<span>Catalog Search</span>
          </div>
          <div className={`nav-item ${page==='pricing'?'active':''}`} onClick={()=>setPage('pricing')}>
            {Icons.dollar}<span>Price Guide</span>
          </div>
          <div className={`nav-item ${page==='reddit'?'active':''}`} onClick={()=>setPage('reddit')}>
            {Icons.search}<span>r/legomarket</span>
          </div>
          <div className={`nav-item ${page==='settings'?'active':''}`} onClick={()=>setPage('settings')}>
            {Icons.settings}<span>Settings</span>
          </div>
          <div className={`nav-item ${page==='config'?'active':''}`} onClick={()=>setPage('config')}>
            {Icons.settings}<span>Configuration</span>
          </div>
        </div>
        {batchStatus === 'interrupted' && (
          <div style={{margin:'0 12px 10px',padding:'8px 10px',background:'var(--surface2)',borderRadius:8,fontSize:11,lineHeight:1.6}}>
            <div style={{color:'var(--orange)',fontWeight:600,marginBottom:6}}>⚠ Fetch interrupted</div>
            <div style={{color:'var(--text2)',marginBottom:8}}>A BrickLink fetch was in progress when the page was refreshed.</div>
            <div style={{display:'flex',gap:6}}>
              <button className="btn btn-primary btn-sm" style={{fontSize:11,padding:'3px 8px'}} onClick={resumeBricklinkFetch}>Resume</button>
              <button className="btn btn-secondary btn-sm" style={{fontSize:11,padding:'3px 8px'}} onClick={discardBatch}>Discard</button>
            </div>
          </div>
        )}
        {batchStatus === 'running' && (
          <div style={{margin:'0 12px 10px',padding:'8px 10px',background:'var(--surface2)',borderRadius:8,fontSize:11,color:'var(--text2)',lineHeight:1.5}}>
            <div style={{color:'var(--accent)',fontWeight:600,marginBottom:2}}>🔄 Fetching BrickLink… {batchProgress}</div>
            <div style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{batchCurrent}</div>
          </div>
        )}
        {(batchStatus === 'done' || batchStatus === 'cancelled') && batchCounts && (
          <div style={{margin:'0 12px 10px',padding:'8px 10px',background:'var(--surface2)',borderRadius:8,fontSize:11,color:batchStatus==='cancelled'?'var(--text2)':'var(--green)',lineHeight:1.5}}>
            {batchStatus === 'cancelled' ? '⏹ Cancelled' : '✓ Fetch done'} — {batchCounts.updated} updated{batchCounts.failed ? `, ${batchCounts.failed} failed` : ''}
          </div>
        )}
        {imgStatus === 'interrupted' && (
          <div style={{margin:'0 12px 10px',padding:'8px 10px',background:'var(--surface2)',borderRadius:8,fontSize:11,lineHeight:1.6}}>
            <div style={{color:'var(--orange)',fontWeight:600,marginBottom:6}}>⚠ Image fetch interrupted</div>
            <div style={{color:'var(--text2)',marginBottom:8}}>An image fetch was in progress when the page was refreshed.</div>
            <div style={{display:'flex',gap:6}}>
              <button className="btn btn-primary btn-sm" style={{fontSize:11,padding:'3px 8px'}} onClick={resumeImageFetch}>Resume</button>
              <button className="btn btn-secondary btn-sm" style={{fontSize:11,padding:'3px 8px'}} onClick={discardImageFetch}>Discard</button>
            </div>
          </div>
        )}
        {imgStatus === 'running' && (
          <div style={{margin:'0 12px 10px',padding:'8px 10px',background:'var(--surface2)',borderRadius:8,fontSize:11,color:'var(--text2)',lineHeight:1.5}}>
            <div style={{color:'var(--accent)',fontWeight:600,marginBottom:2}}>🖼 Fetching images… {imgProgress}</div>
            <div style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{imgCurrent}</div>
          </div>
        )}
        {(imgStatus === 'done' || imgStatus === 'cancelled') && imgCounts && (
          <div style={{margin:'0 12px 10px',padding:'8px 10px',background:'var(--surface2)',borderRadius:8,fontSize:11,color:imgStatus==='cancelled'?'var(--text2)':'var(--green)',lineHeight:1.5}}>
            {imgStatus === 'cancelled' ? '⏹ Images cancelled' : '✓ Images done'} — {imgCounts.updated} updated{imgCounts.failed ? `, ${imgCounts.failed} failed` : ''}
          </div>
        )}
        {priceBatchStatus === 'interrupted' && (
          <div style={{margin:'0 12px 10px',padding:'8px 10px',background:'var(--surface2)',borderRadius:8,fontSize:11,lineHeight:1.6}}>
            <div style={{color:'var(--orange)',fontWeight:600,marginBottom:6}}>⚠ Price fetch interrupted</div>
            <div style={{color:'var(--text2)',marginBottom:8}}>A price fetch was in progress when the page was refreshed.</div>
            <div style={{display:'flex',gap:6}}>
              <button className="btn btn-primary btn-sm" style={{fontSize:11,padding:'3px 8px'}} onClick={resumePriceFetch}>Resume</button>
              <button className="btn btn-secondary btn-sm" style={{fontSize:11,padding:'3px 8px'}} onClick={discardPriceBatch}>Discard</button>
            </div>
          </div>
        )}
        {priceBatchStatus === 'running' && (
          <div style={{margin:'0 12px 10px',padding:'8px 10px',background:'var(--surface2)',borderRadius:8,fontSize:11,color:'var(--text2)',lineHeight:1.5}}>
            <div style={{color:'var(--accent)',fontWeight:600,marginBottom:2}}>💰 Fetching prices… {priceBatchProgress}</div>
            <div style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{priceBatchCurrent}</div>
            <button className="btn btn-secondary btn-sm" style={{fontSize:11,padding:'3px 8px',marginTop:6}} onClick={cancelPriceFetch}>Stop</button>
          </div>
        )}
        {(priceBatchStatus === 'done' || priceBatchStatus === 'cancelled') && priceBatchCounts && (
          <div style={{margin:'0 12px 10px',padding:'8px 10px',background:'var(--surface2)',borderRadius:8,fontSize:11,lineHeight:1.5}}>
            <div style={{color:priceBatchStatus==='cancelled'?'var(--text2)':'var(--green)'}}>
              {priceBatchStatus === 'cancelled' ? '⏹ Prices stopped' : '✓ Prices done'} — {priceBatchCounts.done} updated{priceBatchCounts.failed ? `, ${priceBatchCounts.failed} failed` : ''}
            </div>
            {priceBatchStatus === 'cancelled' && (
              <div style={{display:'flex',gap:6,marginTop:6}}>
                <button className="btn btn-primary btn-sm" style={{fontSize:11,padding:'3px 8px'}} onClick={resumePriceFetch}>Resume</button>
                <button className="btn btn-secondary btn-sm" style={{fontSize:11,padding:'3px 8px'}} onClick={discardPriceBatch}>Discard</button>
              </div>
            )}
          </div>
        )}
        <div className="sidebar-footer">
          <div className="sidebar-stat"><span>Total Value</span><span>{currency(stats.totalValue)}</span></div>
          <div className="sidebar-stat"><span>Total Profit</span><span>{currency(stats.totalProfit)}</span></div>
          {saveStatus === 'saving' && <div style={{fontSize:11,color:'var(--text3)',textAlign:'center',marginTop:4}}>💾 Saving…</div>}
          {saveStatus === 'saved'  && <div style={{fontSize:11,color:'var(--green)',textAlign:'center',marginTop:4}}>✓ Saved to disk</div>}
          {saveStatus === 'error'  && <div style={{fontSize:11,color:'var(--red)',textAlign:'center',marginTop:4}}>⚠ Save failed</div>}
        </div>
      </div>

      <div className="main">
        {page==='inventory' && <InventoryPage items={filtered} allItems={data.items} stats={stats} settings={settings} search={search} setSearch={setSearch}
          typeFilter={typeFilter} setTypeFilter={setTypeFilter} statusFilter={statusFilter} setStatusFilter={setStatusFilter}
          colorFilter={colorFilter} setColorFilter={setColorFilter}
          themeFilter={themeFilter} setThemeFilter={setThemeFilter}
          conditionFilter={conditionFilter} setConditionFilter={setConditionFilter}
          dateAddedFilter={dateAddedFilter} setDateAddedFilter={setDateAddedFilter}
          sortCol={sortCol} sortDir={sortDir} handleSort={handleSort} setModal={setModal} setEditItem={setEditItem}
          deleteItem={deleteItem} setPage={setPage} setPricingSearch={setPricingSearch}
          onBulkEdit={() => setBulkEditOpen(true)}
          onMergeDuplicates={handleMergeDuplicates}
          mergeResult={mergeResult}
          {...sharedExportProps} />}
        {page==='selling'   && <SellingPage  items={data.items} stats={stats} settings={settings} setEditItem={setEditItem} setModal={setModal} setSellItem={setSellItem} setLotSaleOpen={setLotSaleOpen} updateItems={updateItems} blConfigured={blConfigured} ebayConfigured={ebayConfigured} setPage={setPage} setPricingSearch={setPricingSearch} />}
        {page==='analytics' && <AnalyticsPage items={data.items} stats={stats} />}
        {page==='catalog'   && <CatalogSearchPage catalog={catalog} blConfigured={blConfigured} ebayConfigured={ebayConfigured} settings={settings} setEditItem={setEditItem} setModal={setModal} setOnItemSaved={setOnItemSaved} setOnPriceFetched={setOnPriceFetched} data={data} setData={setData} />}
        {page==='pricing'   && <PricingPage  items={activeItems} updateItems={updateItems} blConfigured={blConfigured} ebayConfigured={ebayConfigured} settings={settings} setEditItem={setEditItem} setModal={setModal} initialSearch={pricingSearch} {...priceBatchProps} />}
        {page==='config'    && <ConfigPage settings={settings} setSettings={setSettings} {...batchProps} />}
        {page==='settings'  && <SettingsPage data={data} setData={setData} settings={settings} setSettings={setSettings} onMergeDuplicates={handleMergeDuplicates} updateItems={updateItems} {...sharedExportProps} {...batchProps} {...priceBatchProps} />}
        {page==='reddit'    && <RedditMarketPage items={data.items} setModal={setModal} setEditItem={setEditItem} settings={settings} />}
        {page==='wanted'       && <WantedListPage data={data} setData={setData} items={data.items} settings={settings} updateItems={updateItems} blConfigured={blConfigured} />}
        {page==='salesquotes'  && <SalesQuotePage data={data} setData={setData} settings={settings} allItems={activeItems} />}
        {page==='salesorders'  && <SalesOrdersPage data={data} setData={setData} />}
        {page==='store'     && <StorePage items={activeItems} blConfigured={blConfigured} settings={settings} updateItems={updateItems}
          setSellItem={setSellItem} ebayConfigured={ebayConfigured} setPage={setPage} setPricingSearch={setPricingSearch} setEditItem={setEditItem} setModal={setModal} />}
      </div>

      {bulkEditOpen && <BulkEditModal allItems={data.items} updateItems={updateItems} onClose={() => setBulkEditOpen(false)} />}
      {mergeOpen    && <MergeDuplicatesModal items={data.items} onMerge={handleMergeComplete} onClose={() => setMergeOpen(false)} />}
      {modal==='add'  && <ItemModal prefill={editItem} onSave={addItem} onPriceFetched={onPriceFetched} onClose={()=>{setModal(null);setEditItem(null);setOnItemSaved(null);setOnPriceFetched(null);}} setPage={setPage} setPricingSearch={setPricingSearch} data={data} setData={setData} />}
      {modal==='edit' && editItem && <ItemModal item={editItem} onSave={updateItem} onClose={()=>{setModal(null);setEditItem(null);}} setPage={setPage} setPricingSearch={setPricingSearch} data={data} setData={setData} />}
      {sellItem && <SellQuantityModal item={sellItem} onConfirm={(sale) => recordSale({ item: sellItem, ...sale })} onClose={() => setSellItem(null)} />}
      {lotSaleOpen && <SellLotModal items={listedItems} onConfirm={recordLotSale} onClose={() => setLotSaleOpen(false)} />}
    </div>
  );
}
