// ─── Reddit r/legomarket Page ───
// Fetches the 20 most recent posts, digs into each one's body to extract
// individual set listings, enriches with catalog data, and displays as a table.

const REDDIT_IGNORE_KEY = 'brickvault_reddit_ignored';
const IGNORE_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

function loadIgnored() {
  try {
    const raw = JSON.parse(localStorage.getItem(REDDIT_IGNORE_KEY)) || {};
    const now = Date.now();
    // Prune expired entries on load
    const pruned = {};
    for (const [id, expiresAt] of Object.entries(raw)) {
      if (expiresAt > now) pruned[id] = expiresAt;
    }
    if (Object.keys(pruned).length !== Object.keys(raw).length) {
      localStorage.setItem(REDDIT_IGNORE_KEY, JSON.stringify(pruned));
    }
    return pruned;
  } catch { return {}; }
}

function saveIgnored(ignored) {
  try { localStorage.setItem(REDDIT_IGNORE_KEY, JSON.stringify(ignored)); } catch {}
}

function RedditMarketPage({ items, setModal, setEditItem, settings }) {
  const [listings,    setListings]    = React.useState([]);
  const [posts,       setPosts]       = React.useState([]);
  const [status,      setStatus]      = React.useState('idle'); // idle|loading|done|error
  const [errorMsg,    setErrorMsg]    = React.useState('');
  const [fetchDetail, setFetchDetail] = React.useState('');
  const [search,       setSearch]       = React.useState('');
  const [themeFilter,  setThemeFilter]  = React.useState('all');
  const [sellerFilter, setSellerFilter] = React.useState('all');
  const [typeFilter,   setTypeFilter]   = React.useState('all');
  const [conditionFilter, setConditionFilter] = React.useState('all');
  const [flairFilter,  setFlairFilter]  = React.useState('all');
  const [dealOnly,     setDealOnly]     = React.useState(false);
  const [minAsk,       setMinAsk]       = React.useState('');
  const [maxAsk,       setMaxAsk]       = React.useState('');
  const [matchOnly,    setMatchOnly]    = React.useState(false);
  const [showIgnored,  setShowIgnored]  = React.useState(false);
  const [ignored,      setIgnored]      = React.useState(loadIgnored);
  const [sortCol,      setSortCol]      = React.useState('posted');
  const [sortDir,      setSortDir]      = React.useState('desc');
  // priceCache: { ["set:75192" | "minifig:sw0001"]: { blSold, blSoldQty, blActive, blActiveQty, suggested, fetching, error } }
  const [priceCache,  setPriceCache]  = React.useState({});
  // imageCache: non-persistent, lives only in this render session
  // { ["set:75192" | "minifig:sw0001"]: url | 'error' }
  const imageCacheRef = React.useRef({});
  // Track which price entries are newly fetched and need to be persisted
  const pendingPriceSaveRef = React.useRef({});
  const priceSaveTimerRef   = React.useRef(null);

  // ─── Ignore helpers ───────────────────────────────────────────────────────
  const ignorePost = React.useCallback((postId) => {
    setIgnored(prev => {
      const next = { ...prev, [postId]: Date.now() + IGNORE_DURATION_MS };
      saveIgnored(next);
      return next;
    });
  }, []);

  const unignorePost = React.useCallback((postId) => {
    setIgnored(prev => {
      const next = { ...prev };
      delete next[postId];
      saveIgnored(next);
      return next;
    });
  }, []);

  const clearAllIgnored = () => {
    setIgnored({});
    saveIgnored({});
  };

  const ignoredCount = Object.keys(ignored).length;

  // Build a map of item numbers → inventory item for matching + images
  const inventoryMap = React.useMemo(() => {
    if (!items?.length) return {};
    const map = {};
    for (const item of items) {
      const num = (item.itemNumber || '').replace(/-1$/, '').toLowerCase();
      if (num) map[num] = item;
    }
    return map;
  }, [items]);

  // Open item detail: edit if in inventory, add-prefilled if not
  const openItem = (row) => {
    if (!setModal || !setEditItem) return;
    if (row.inInventory) {
      const invItem = inventoryMap[row.itemNum.toLowerCase()];
      setEditItem(invItem);
      setModal('edit');
    } else if (row.itemNum) {
      setEditItem({ type: row.itemType || 'set', itemNumber: row.itemNum, name: row.name, theme: row.theme });
      setModal('add');
    }
  };

  // Returns the best image URL for an item (inventory first, then BL CDN)
  const getItemImageUrl = (itemNum, itemType, invImageUrl) => {
    if (invImageUrl) return invImageUrl;
    if (!itemNum) return null;
    if (itemType === 'minifig') {
      return `https://img.bricklink.com/ItemImage/MN/0/${itemNum}.png`;
    }
    // Sets: stored as "{setNum}-1"
    const key = itemNum.includes('-') ? itemNum : `${itemNum}-1`;
    return `https://img.bricklink.com/ItemImage/SN/0/${key}.png`;
  };

  // ─── Parsing helpers ───────────────────────────────────────────────────────

  const parsePrice = (text) => {
    if (!text) return null;
    // Try in order of specificity to avoid false matches on set numbers
    // 1. $85 or $85.00
    let m = text.match(/\$\s*(\d+(?:\.\d+)?)/);
    if (m) return parseFloat(m[1]);
    // 2. 85 USD or 85$
    m = text.match(/(\d+(?:\.\d+)?)\s*(?:USD|\$)/i);
    if (m) return parseFloat(m[1]);
    // 3. Bare number after unambiguous separator: tab, 2+ spaces, dash+space, colon+space
    m = text.match(/(?:[\t]|[ ]{2,}|[-–]\s+|:\s+)(\d+(?:\.\d+)?)(?:\s|$)/);
    if (m) return parseFloat(m[1]);
    return null;
  };

  const extractSetNumbers = (text) => {
    if (!text) return [];
    const found = new Set();
    // Match 4-6 digit numbers, optionally preceded by # or "set"
    // and optionally followed by -1 (BrickLink suffix)
    // Lookahead also allows $ (price immediately after) and - (BL suffix)
    const matches = text.matchAll(/(?:^|[\s#,|(\-])(\d{4,6})(?:-\d+)?(?=[\s,|)\].:$\-]|$)/gm);
    for (const m of matches) {
      const n = m[1];
      // Skip years, prices (already captured by $ prefix elsewhere), zip codes
      if (n.startsWith('20') || n.startsWith('19') || n.startsWith('18')) continue;
      if (n.length < 4 || n.length > 6) continue;
      found.add(n);
    }
    return [...found];
  };

  // Match BrickLink minifig item numbers: 2-4 letter prefix + 3-4 digits
  // e.g. sw0001, col015, hp001, cas001, tlm001, idea001
  const extractMinifigNumbers = (text) => {
    if (!text) return [];
    const found = new Set();
    const matches = text.matchAll(/(?:^|[\s,|(])([a-z]{2,4}\d{3,4})(?=[\s,|)\].:\/\-]|$)/gim);
    for (const m of matches) {
      const n = m[1].toLowerCase();
      // Must start with letters and end with digits — skip things like "lego" or "used"
      if (!/^[a-z]{2,4}\d{3,4}$/.test(n)) continue;
      found.add(n);
    }
    return [...found];
  };

  const parseCondition = (line) => {
    const lc = line.toLowerCase();
    if (/\bnib\b|\bnisb\b|\bnew in (sealed )?box\b/.test(lc)) return 'New (Sealed)';
    if (/\bnew\b/.test(lc))        return 'New';
    if (/\bincomplete\b/.test(lc)) return 'Used (Incomplete)';
    if (/\bcomplete\b/.test(lc))   return 'Used (Complete)';
    if (/\bused\b|\bopen(ed)?\b/.test(lc)) return 'Used';
    return '';
  };

  const makeRow = (post, num, itemType, price, cond, lineText, idx) => {
    const invItem = num ? inventoryMap[num.toLowerCase()] : null;
    return {
      id:          `${post.id}-${num || 'x'}-${idx}`,
      postId:      post.id,
      itemNum:     num,
      itemType:    itemType || 'set',
      name:        invItem?.name || '',
      theme:       invItem?.theme || '',
      imageUrl:    invItem?.imageUrl || '',
      price,
      condition:   cond,
      line:        lineText.length > 140 ? lineText.slice(0, 140) + '…' : lineText,
      author:      post.author,
      flair:       post.flair,
      permalink:   post.permalink,
      created_utc: post.created_utc,
      inInventory: !!invItem,
    };
  };

  // Returns true if the line is entirely struck through (~~whole line~~)
  const isLineStruck = (line) => /^~~.+~~$/.test(line.trim());

  // Returns true if a specific set number is inside a ~~...~~ span on this line
  const isNumStruck = (line, num) => {
    // Find all ~~...~~ regions and check if the number falls inside one
    const struck = [];
    let re = /~~([\s\S]+?)~~/g, m;
    while ((m = re.exec(line)) !== null) struck.push(m[1]);
    return struck.some(s => s.includes(num));
  };

  // ─── Table-cell price extractor ───────────────────────────────────────────
  // Given a cell string (already trimmed, pipes removed), return a price if the
  // cell looks like a price: optional $, a number, optional trailing text.
  const parseCellPrice = (cell) => {
    if (!cell) return null;
    const m = cell.match(/^\$?\s*(\d+(?:\.\d+)?)(?:\s|$)/);
    return m ? parseFloat(m[1]) : null;
  };

  // Returns true if a table row is a separator row (e.g. |---|---|)
  const isTableSeparator = (line) => /^\|[\s\-:|]+\|/.test(line);

  // Returns true if a table row looks like a header (no set numbers, has words)
  const isTableHeader = (line, cells) =>
    cells.every(c => !/\d{4,6}/.test(c)) && cells.some(c => /^[a-z]/i.test(c.trim()));

  // Returns true if a line is purely a price line (e.g. "**$100 shipped**", "$45")
  // with no set/minifig numbers on it
  const isPriceLine = (line) => {
    const stripped = line.replace(/[*_~`]/g, '').trim();
    return parsePrice(stripped) != null && extractSetNumbers(stripped).length === 0 && extractMinifigNumbers(stripped).length === 0;
  };

  const parseListings = (post) => {
    const results = [];

    // First try the body text line by line
    const bodyText = (post.selftext || '').trim();
    if (bodyText && bodyText !== '[removed]' && bodyText !== '[deleted]') {
      // Keep blank lines as paragraph separators for context, then strip them for processing
      // but track original paragraph structure so we can do neighbour lookups.
      const allLines    = bodyText.split(/\r?\n/).map(l => l.trim());
      const availableLines = allLines.filter(l => l && !isLineStruck(l));
      const allBodyNums = extractSetNumbers(availableLines.join('\n'));

      // Pre-parse every line so we can do neighbour lookups in one pass
      const parsed = availableLines.map(line => ({
        line,
        setNums:     extractSetNumbers(line).filter(n => !isNumStruck(line, n)),
        minifigNums: extractMinifigNumbers(line).filter(n => !isNumStruck(line, n)),
        price:       parsePrice(line.replace(/[*_~`]/g, '')),
        cond:        parseCondition(line),
        isTable:     /^\|.+\|/.test(line),
        isPriceOnly: isPriceLine(line),
      }));

      for (let i = 0; i < parsed.length; i++) {
        const p = parsed[i];

        // ── Markdown table row ────────────────────────────────────────────
        if (p.isTable) {
          if (isTableSeparator(p.line)) continue;
          const cells = p.line.split('|').map(c => c.trim()).filter((_, ci, a) => ci > 0 && ci < a.length - 1);
          if (isTableHeader(p.line, cells)) continue;

          const fullLine = cells.join(' ');
          const setNums     = extractSetNumbers(fullLine).filter(n => !isNumStruck(p.line, n));
          const minifigNums = extractMinifigNumbers(fullLine).filter(n => !isNumStruck(p.line, n));
          const cond        = parseCondition(fullLine);
          let   price       = parsePrice(fullLine);
          if (price == null) {
            for (const cell of cells) {
              const cp = parseCellPrice(cell);
              if (cp != null && cp > 0 && cp < 10000) { price = cp; break; }
            }
          }
          for (const num of setNums)     results.push(makeRow(post, num, 'set',     price, cond, p.line, results.length));
          for (const num of minifigNums) results.push(makeRow(post, num, 'minifig', price, cond, p.line, results.length));
          continue;
        }

        // ── Price-only line — skip (will be consumed by neighbour lookup) ──
        if (p.isPriceOnly) continue;

        // ── Regular line ──────────────────────────────────────────────────
        if (p.setNums.length === 0 && p.minifigNums.length === 0) continue;

        // Resolve price: use this line's price, or look at immediate neighbours
        // (within 2 lines in either direction) for a price-only line.
        let price = p.price;
        if (price == null) {
          // Look forward up to 2 lines
          for (let d = 1; d <= 2 && i + d < parsed.length; d++) {
            const nb = parsed[i + d];
            if (nb.isPriceOnly) { price = nb.price; break; }
            if (nb.setNums.length > 0 || nb.minifigNums.length > 0) break; // hit next item
          }
        }
        if (price == null) {
          // Look backward up to 2 lines
          for (let d = 1; d <= 2 && i - d >= 0; d++) {
            const nb = parsed[i - d];
            if (nb.isPriceOnly) { price = nb.price; break; }
            if (nb.setNums.length > 0 || nb.minifigNums.length > 0) break;
          }
        }

        for (const num of p.setNums)     results.push(makeRow(post, num, 'set',     price, p.cond, p.line, results.length));
        for (const num of p.minifigNums) results.push(makeRow(post, num, 'minifig', price, p.cond, p.line, results.length));
      }

      // If body had no per-line numbers but we found set numbers in the full body,
      // emit one row per set number using the title price/condition
      if (results.length === 0 && allBodyNums.length > 0) {
        const titlePrice = parsePrice(post.title);
        const titleCond  = parseCondition(post.title);
        for (const num of allBodyNums) {
          results.push(makeRow(post, num, 'set', titlePrice, titleCond, post.title, results.length));
        }
      }
    }

    // Always fall back to title parsing if nothing found yet
    if (results.length === 0) {
      if (isLineStruck(post.title)) return []; // whole title struck = entire post sold
      const titleSetNums    = extractSetNumbers(post.title).filter(n => !isNumStruck(post.title, n));
      const titleMinifigNums = extractMinifigNumbers(post.title).filter(n => !isNumStruck(post.title, n));
      const titlePrice = parsePrice(post.title);
      const titleCond  = parseCondition(post.title);
      if (titleSetNums.length > 0 || titleMinifigNums.length > 0) {
        for (const num of titleSetNums)    results.push(makeRow(post, num, 'set',     titlePrice, titleCond, post.title, results.length));
        for (const num of titleMinifigNums) results.push(makeRow(post, num, 'minifig', titlePrice, titleCond, post.title, results.length));
      } else {
        // No item number anywhere — still show the post so it's not silently dropped
        results.push(makeRow(post, '', 'set', titlePrice, titleCond, post.title, 0));
      }
    }

    return results;
  };

  // ─── Catalog enrichment ────────────────────────────────────────────────────

  const enrichFromCatalog = async (rawListings) => {
    // Collect unique items that don't already have a name, grouped by type
    const toSets     = [...new Set(rawListings.filter(l => l.itemNum && !l.name && l.itemType !== 'minifig').map(l => l.itemNum))];
    const toMinifigs = [...new Set(rawListings.filter(l => l.itemNum && !l.name && l.itemType === 'minifig').map(l => l.itemNum))];

    if (!toSets.length && !toMinifigs.length) return rawListings;

    const items = [
      ...toSets.map(n     => ({ type: 'set',     itemNumber: n })),
      ...toMinifigs.map(n => ({ type: 'minifig', itemNumber: n })),
    ];

    try {
      const resp = await fetch('/api/catalog/batch', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ items }),
      });
      if (!resp.ok) return rawListings;
      const catalog = await resp.json(); // { "75192": { found, name, theme }, "sw0001": { found, name, theme }, … }

      return rawListings.map(l => {
        if (!l.itemNum || l.name) return l;
        const hit = catalog[l.itemNum.toUpperCase()] || catalog[l.itemNum];
        if (hit?.found) {
          return { ...l, name: hit.name, theme: hit.theme };
        }
        return l;
      });
    } catch(e) {
      return rawListings;
    }
  };

  // ─── Persist price cache to backend (debounced) ────────────────────────────

  const flushPriceCache = React.useCallback(() => {
    const toSave = pendingPriceSaveRef.current;
    if (!Object.keys(toSave).length) return;
    pendingPriceSaveRef.current = {};
    fetch('/api/reddit/price-cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toSave),
    }).catch(() => {});
  }, []);

  const schedulePriceSave = React.useCallback((setNum, entry) => {
    pendingPriceSaveRef.current[setNum] = entry;
    clearTimeout(priceSaveTimerRef.current);
    priceSaveTimerRef.current = setTimeout(flushPriceCache, 2000);
  }, [flushPriceCache]);

  // Flush on unmount
  React.useEffect(() => () => {
    clearTimeout(priceSaveTimerRef.current);
    flushPriceCache();
  }, [flushPriceCache]);

  // ─── Fetch ─────────────────────────────────────────────────────────────────

  const fetchAll = React.useCallback(async () => {
    setStatus('loading');
    setErrorMsg('');
    setListings([]);
    setPosts([]);
    setFetchDetail('Loading cached posts…');

    try {
      // ── Step 1: Load persisted post cache for instant display ──────────────
      let cachedPostMap = {};
      try {
        const cResp = await fetch('/api/reddit/cached-posts');
        const cData = cResp.ok ? await cResp.json() : { posts: [] };
        for (const p of (cData.posts || [])) cachedPostMap[p.id] = p;
      } catch(e) { /* non-fatal */ }

      // ── Step 2: Load persisted BL price cache ─────────────────────────────
      try {
        const prResp = await fetch('/api/reddit/price-cache');
        const prData = prResp.ok ? await prResp.json() : {};
        if (Object.keys(prData).length) {
          // Strip internal cached_at field before storing in UI state
          const cleaned = {};
          for (const [k, v] of Object.entries(prData)) {
            const { cached_at, ...rest } = v;
            cleaned[k] = rest;
          }
          setPriceCache(prev => ({ ...prev, ...cleaned }));
        }
      } catch(e) { /* non-fatal */ }

      // ── Step 3: If we have cached posts, render them immediately ───────────
      if (Object.keys(cachedPostMap).length) {
        const cachedPostList = Object.values(cachedPostMap).sort((a, b) => b.created_utc - a.created_utc);
        const cachedListings = [];
        for (const post of cachedPostList) {
          cachedListings.push(...parseListings(post));
        }
        const cachedEnriched = await enrichFromCatalog(cachedListings);
        setListings(cachedEnriched);
        setPosts(cachedPostList);
        setStatus('done');
        setFetchDetail('Refreshing from Reddit…');
      }

      // ── Step 4: Fetch fresh post list from Reddit ──────────────────────────
      const resp = await fetch('/api/reddit/legomarket?sort=new&limit=20');
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error || 'Failed to fetch posts');

      const rawPosts = data.posts || [];
      setPosts(rawPosts);

      const allListings = [];
      // Track which posts needed a fresh detail fetch (truly new ones)
      let newPostCount = 0;
      for (let i = 0; i < rawPosts.length; i++) {
        const post = rawPosts[i];

        let fullPost = post;
        const isCached = post.cached === true; // backend already has a full body from a prior detail fetch

        // Fetch full post body if: not cached by backend AND (no body, or body looks truncated)
        // The listing endpoint often returns empty/stub selftext — always fetch for non-cached posts
        if (!isCached) {
          newPostCount++;
          setFetchDetail(`Fetching post ${newPostCount}: u/${post.author}`);
          try {
            const dr = await fetch(`/api/reddit/post/${post.id}`);
            const dd = await dr.json();
            if (!dd.error) fullPost = { ...post, ...dd };
          } catch(e) { /* use title/stub only */ }
          if (newPostCount > 1) await new Promise(r => setTimeout(r, 300));
        }

        const parsed = parseListings(fullPost);
        allListings.push(...parsed);
      }

      // ── Step 5: Enrich with catalog data ──────────────────────────────────
      setFetchDetail('Looking up set names…');
      const enriched = await enrichFromCatalog(allListings);

      setListings(enriched);
      setFetchDetail('');
      setStatus('done');

      // ── Step 6: Seed price cache from inventory for matched items ─────────
      const seedCache = {};
      for (const l of enriched) {
        if (!l.itemNum) continue;
        const cacheKey = `${l.itemType}:${l.itemNum}`;
        if (seedCache[cacheKey]) continue;
        const inv = inventoryMap[l.itemNum.toLowerCase()];
        if (inv && (inv.bricklinkPrice != null || inv.bricklinkActive != null)) {
          seedCache[cacheKey] = {
            blSold:      inv.bricklinkPrice       ?? null,
            blSoldQty:   inv.bricklinkSoldQty     ?? null,
            blActive:    inv.bricklinkActive      ?? null,
            blActiveQty: inv.bricklinkActiveQty   ?? null,
            suggested:   suggestedPrice(inv)      ?? null,
          };
        }
      }
      if (Object.keys(seedCache).length) setPriceCache(prev => ({ ...prev, ...seedCache }));

      // ── Step 7: Auto-fetch BL prices only for items not already in any cache
      const allItems = [...new Map(
        enriched.filter(l => l.itemNum).map(l => [`${l.itemType}:${l.itemNum}`, { itemNum: l.itemNum, itemType: l.itemType }])
      ).values()];
      setPriceCache(currentCache => {
        const toFetch = allItems.filter(({ itemNum, itemType }) => {
          const k = `${itemType}:${itemNum}`;
          return !seedCache[k] && !currentCache[k];
        });
        if (toFetch.length) {
          setFetchDetail(`Fetching BL prices for ${toFetch.length} items…`);
          setPriceCache(prev => {
            const next = { ...prev };
            for (const { itemNum, itemType } of toFetch) {
              const k = `${itemType}:${itemNum}`;
              next[k] = { ...next[k], fetching: true, error: null };
            }
            return next;
          });
          (async () => {
            for (let i = 0; i < toFetch.length; i += 5) {
              const batch = toFetch.slice(i, i + 5);
              await Promise.all(batch.map(({ itemNum, itemType }) => fetchPricesForItem(itemNum, itemType)));
              if (i + 5 < toFetch.length) await new Promise(r => setTimeout(r, 350));
            }
            setFetchDetail('');
          })();
        }
        return currentCache;
      });

    } catch(e) {
      // If we already rendered cached posts, keep them visible but show a persistent warning
      setStatus(prev => {
        if (prev === 'done') {
          setFetchDetail(`⚠ Reddit fetch failed: ${e.message}`);
          return 'done'; // leave the detail visible — user must dismiss manually
        }
        setErrorMsg(e.message);
        return 'error';
      });
    }
  }, [inventoryMap]);

  // Shared: fetch BL prices for an item (set or minifig) and store in priceCache
  const fetchPricesForItem = async (itemNum, itemType = 'set') => {
    const cacheKey = `${itemType}:${itemNum}`;
    setPriceCache(prev => ({ ...prev, [cacheKey]: { ...prev[cacheKey], fetching: true, error: null } }));
    try {
      const countryCode = settings?.blCountryCode !== undefined ? settings.blCountryCode : 'US';
      const [soldResp, activeResp] = await Promise.all([
        fetch(`/api/bricklink/price?type=${itemType}&itemNumber=${itemNum}&guide=sold&newOrUsed=U&filterOutliers=true&countryCode=${encodeURIComponent(countryCode)}`),
        fetch(`/api/bricklink/price?type=${itemType}&itemNumber=${itemNum}&guide=stock&newOrUsed=U&filterOutliers=true&countryCode=${encodeURIComponent(countryCode)}`),
      ]);
      const sold   = soldResp.ok   ? await soldResp.json()   : {};
      const active = activeResp.ok ? await activeResp.json() : {};
      const blSold      = sold.avg            ?? null;
      const blSoldQty   = sold.unitQuantity   ?? null;
      const blActive    = active.avg          ?? null;
      const blActiveQty = active.unitQuantity ?? null;
      const fakeItem = {
        bricklinkMedian:       sold.median   ?? null,
        bricklinkActiveMedian: active.median ?? null,
        bricklinkActive:       blActive,
        priceHistory:          [],
      };
      const suggested = suggestedPrice(fakeItem);
      const entry = { blSold, blSoldQty, blActive, blActiveQty, suggested, fetching: false, error: null };
      setPriceCache(prev => ({ ...prev, [cacheKey]: entry }));
      schedulePriceSave(cacheKey, { blSold, blSoldQty, blActive, blActiveQty, suggested });
    } catch(e) {
      setPriceCache(prev => ({ ...prev, [cacheKey]: { ...prev[cacheKey], fetching: false, error: e.message } }));
    }
  };

  // On-demand fetch triggered by the "Fetch prices" button
  const fetchPriceForItem = (itemNum, itemType) => {
    const cacheKey = `${itemType}:${itemNum}`;
    if (!itemNum || priceCache[cacheKey]?.fetching || priceCache[cacheKey]?.blSold != null) return;
    fetchPricesForItem(itemNum, itemType);
  };

  React.useEffect(() => { fetchAll(); }, []);

  // ─── Filtering & sorting ────────────────────────────────────────────────────

  const themeOptions = React.useMemo(() => {
    const seen = new Set();
    for (const l of listings) { if (l.theme) seen.add(l.theme); }
    return [...seen].sort();
  }, [listings]);

  const sellerOptions = React.useMemo(() => {
    const seen = new Set();
    for (const l of listings) { if (l.author) seen.add(l.author); }
    return [...seen].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }, [listings]);

  const typeOptions = React.useMemo(() => {
    const seen = new Set();
    for (const l of listings) { if (l.itemType) seen.add(l.itemType); }
    return [...seen].sort((a, b) => itemTypeLabel(a).localeCompare(itemTypeLabel(b)));
  }, [listings]);

  const conditionOptions = React.useMemo(() => {
    const seen = new Set();
    for (const l of listings) { if (l.condition) seen.add(l.condition); }
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [listings]);

  const flairOptions = React.useMemo(() => {
    const seen = new Set();
    for (const l of listings) { if (l.flair) seen.add(l.flair); }
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [listings]);

  const FLAIR_COLORS = {
    '[S]':  { bg: 'rgba(76,200,100,.15)',  color: 'var(--green)'  },
    '[W]':  { bg: 'rgba(231,138,76,.15)',  color: 'var(--orange)' },
    '[T]':  { bg: 'rgba(156,108,231,.15)', color: 'var(--purple)' },
    '[H]':  { bg: 'rgba(76,140,231,.15)',  color: 'var(--blue)'   },
    '[ID]': { bg: 'rgba(200,200,200,.1)',  color: 'var(--text2)'  },
  };
  const flairStyle = (flair) => {
    if (!flair) return { bg: 'transparent', color: 'var(--text2)' };
    for (const [key, style] of Object.entries(FLAIR_COLORS)) {
      if (flair.includes(key)) return style;
    }
    return { bg: 'rgba(200,200,200,.1)', color: 'var(--text2)' };
  };

  const isFiltered = search || themeFilter !== 'all' || sellerFilter !== 'all' ||
    typeFilter !== 'all' || conditionFilter !== 'all' || flairFilter !== 'all' ||
    dealOnly || minAsk || maxAsk || matchOnly;

  const clearFilters = () => {
    setSearch('');
    setThemeFilter('all');
    setSellerFilter('all');
    setTypeFilter('all');
    setConditionFilter('all');
    setFlairFilter('all');
    setDealOnly(false);
    setMinAsk('');
    setMaxAsk('');
    setMatchOnly(false);
  };

  const listingPriceForRow = (row) => {
    if (!row?.itemNum) return null;
    const cacheKey = `${row.itemType}:${row.itemNum}`;
    const pc = priceCache[cacheKey];
    return pc?.suggested ?? null;
  };

  const dealInfoForRow = (row) => {
    const listPrice = listingPriceForRow(row);
    if (!(row?.price > 0) || !(listPrice > 0)) return null;
    const ratio = row.price / listPrice;
    return ratio < 0.75 ? { listPrice, ratio } : null;
  };

  const filtered = React.useMemo(() => {
    let rows = listings;
    // Only show rows where an ask price was parsed from the post
    rows = rows.filter(r => r.price != null);
    // Filter ignored posts (unless showIgnored is on)
    if (!showIgnored) {
      rows = rows.filter(r => !ignored[r.postId]);
    } else {
      rows = rows.filter(r => !!ignored[r.postId]);
    }
    if (matchOnly) rows = rows.filter(r => r.inInventory);
    if (typeFilter !== 'all') rows = rows.filter(r => r.itemType === typeFilter);
    if (themeFilter !== 'all') rows = rows.filter(r => r.theme === themeFilter);
    if (conditionFilter !== 'all') rows = rows.filter(r => r.condition === conditionFilter);
    if (flairFilter !== 'all') rows = rows.filter(r => r.flair === flairFilter);
    if (sellerFilter !== 'all') rows = rows.filter(r => r.author === sellerFilter);
    if (dealOnly) rows = rows.filter(r => !!dealInfoForRow(r));
    const minAskValue = parseFloat(minAsk);
    const maxAskValue = parseFloat(maxAsk);
    if (!Number.isNaN(minAskValue)) rows = rows.filter(r => r.price >= minAskValue);
    if (!Number.isNaN(maxAskValue)) rows = rows.filter(r => r.price <= maxAskValue);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(r =>
        (r.itemNum || '').toLowerCase().includes(q) ||
        (r.name  || '').toLowerCase().includes(q) ||
        (r.theme || '').toLowerCase().includes(q) ||
        (r.author || '').toLowerCase().includes(q) ||
        (r.line  || '').toLowerCase().includes(q)
      );
    }
    return [...rows].sort((a, b) => {
      const ad = dealInfoForRow(a);
      const bd = dealInfoForRow(b);
      if (!!ad !== !!bd) return ad ? -1 : 1;
      if (ad && bd && ad.ratio !== bd.ratio) return ad.ratio - bd.ratio;
      let av, bv;
      if      (sortCol === 'price')   { av = a.price   ?? -Infinity; bv = b.price   ?? -Infinity; }
      else if (sortCol === 'itemNum') { av = a.itemNum; bv = b.itemNum; }
      else if (sortCol === 'name')    { av = a.name;    bv = b.name;   }
      else if (sortCol === 'theme')  { av = a.theme;  bv = b.theme;  }
      else if (sortCol === 'author') { av = a.author; bv = b.author; }
      else /* posted */              { av = a.created_utc; bv = b.created_utc; }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ?  1 : -1;
      return 0;
    });
  }, [listings, matchOnly, typeFilter, themeFilter, conditionFilter, flairFilter, sellerFilter, dealOnly, minAsk, maxAsk, search, sortCol, sortDir, priceCache, ignored, showIgnored]);

  const timeAgo = (utc) => {
    const diff = Date.now() / 1000 - utc;
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir(col === 'posted' ? 'desc' : 'asc'); }
  };

  const SortTH = ({ col, children, style }) => (
    <th onClick={() => handleSort(col)} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', ...style }}>
      {children}
      {sortCol === col && <span className="sort-arrow">{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ paddingBottom: 40 }}>
      <div className="header">
        <h1>Available on r/legomarket</h1>
        <div className="header-actions">
          <button className="btn btn-secondary" onClick={fetchAll} disabled={status === 'loading'}>
            {status === 'loading' ? '🔄 Loading…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Progress / persistent error banner */}
      {(status === 'loading' || fetchDetail) && (
        <div style={{ margin: '0 24px 12px', padding: '8px 14px', borderRadius: 8, fontSize: 12,
          display: 'flex', alignItems: 'center', gap: 8,
          background: fetchDetail?.startsWith('⚠') ? 'rgba(231,76,76,.1)' : 'var(--surface2)',
          border:     fetchDetail?.startsWith('⚠') ? '1px solid rgba(231,76,76,.3)' : '1px solid transparent',
          color:      fetchDetail?.startsWith('⚠') ? 'var(--red)' : 'var(--text2)' }}>
          {!fetchDetail?.startsWith('⚠') && <span>🔄</span>}
          <span style={{ flex: 1 }}>{fetchDetail || 'Loading…'}</span>
          {fetchDetail?.startsWith('⚠') && (
            <button onClick={() => setFetchDetail('')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 14, padding: 0, lineHeight: 1 }}>✕</button>
          )}
        </div>
      )}

      {/* Hard error (no cached data at all) */}
      {status === 'error' && (
        <div style={{ margin: '0 24px 12px', padding: '10px 14px', background: 'rgba(231,76,76,.1)', border: '1px solid rgba(231,76,76,.3)', borderRadius: 8, fontSize: 13, color: 'var(--red)' }}>
          ✗ {errorMsg}
        </div>
      )}

      <div className="table-wrap">
        {/* Toolbar */}
        <div className="table-toolbar">
          <button className="btn-icon" onClick={clearFilters} title="Clear search and filters"
            style={{ opacity: isFiltered ? 1 : 0.35, flexShrink: 0 }}>
            {Icons.x}
          </button>

          <input
            className="search-box"
            placeholder="Search set #, name, theme, seller…"
            value={search}
            onChange={e => setSearch(e.target.value)} />

          {typeOptions.length > 0 && (
            <select className="filter-select" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              <option value="all">All Types</option>
              {typeOptions.map(t => <option key={t} value={t}>{itemTypeLabel(t)}</option>)}
            </select>
          )}

          {themeOptions.length > 0 && (
            <select className="filter-select" value={themeFilter} onChange={e => setThemeFilter(e.target.value)}>
              <option value="all">All Themes</option>
              {themeOptions.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}

          {conditionOptions.length > 0 && (
            <select className="filter-select" value={conditionFilter} onChange={e => setConditionFilter(e.target.value)}>
              <option value="all">All Conditions</option>
              {conditionOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}

          {flairOptions.length > 0 && (
            <select className="filter-select" value={flairFilter} onChange={e => setFlairFilter(e.target.value)}>
              <option value="all">All Flairs</option>
              {flairOptions.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          )}

          {sellerOptions.length > 0 && (
            <select className="filter-select" value={sellerFilter} onChange={e => setSellerFilter(e.target.value)}>
              <option value="all">All Sellers</option>
              {sellerOptions.map(s => <option key={s} value={s}>u/{s}</option>)}
            </select>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <input
              className="filter-select"
              type="number"
              min="0"
              step="1"
              placeholder="Min $"
              value={minAsk}
              onChange={e => setMinAsk(e.target.value)}
              style={{ width: 76 }} />
            <input
              className="filter-select"
              type="number"
              min="0"
              step="1"
              placeholder="Max $"
              value={maxAsk}
              onChange={e => setMaxAsk(e.target.value)}
              style={{ width: 76 }} />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text2)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={dealOnly} onChange={e => setDealOnly(e.target.checked)} />
            Deals only
          </label>

          {items?.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text2)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={matchOnly} onChange={e => setMatchOnly(e.target.checked)} />
              Inventory matches only
            </label>
          )}

          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
            {status === 'done' && `${filtered.length} listing${filtered.length !== 1 ? 's' : ''} from ${posts.length} posts`}
          </span>

          {ignoredCount > 0 && (
            <button
              className="btn btn-secondary btn-sm"
              style={{ fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0, opacity: showIgnored ? 1 : 0.7 }}
              onClick={() => setShowIgnored(v => !v)}
              title={showIgnored ? 'Back to active listings' : 'Show ignored posts'}>
              {showIgnored ? '← Active' : `🚫 Ignored (${ignoredCount})`}
            </button>
          )}
          {showIgnored && ignoredCount > 0 && (
            <button
              className="btn btn-secondary btn-sm"
              style={{ fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0, color: 'var(--red)' }}
              onClick={clearAllIgnored}
              title="Remove all posts from the ignore list">
              Clear all
            </button>
          )}
        </div>

        {status !== 'loading' && status === 'done' && filtered.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text3)', padding: 60, fontSize: 14 }}>
            No listings found.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 44 }}></th>
                  <SortTH col="itemNum" style={{ width: 75 }}>Item #</SortTH>
                  <SortTH col="name">Name</SortTH>
                  <SortTH col="theme" style={{ width: 120 }}>Theme</SortTH>
                  <th style={{ width: 110 }}>Condition</th>
                  <SortTH col="price" style={{ width: 75 }}>Ask</SortTH>
                  <th style={{ width: 85 }}>BL Sold</th>
                  <th style={{ width: 85 }}>BL Active</th>
                  <th style={{ width: 85 }}>Suggested</th>
                  <th style={{ width: 60 }}>Flair</th>
                  <SortTH col="author" style={{ width: 110 }}>Seller</SortTH>
                  <SortTH col="posted" style={{ width: 75 }}>Posted</SortTH>
                  <th style={{ width: 55 }}>Link</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(row => {
                  const deal = dealInfoForRow(row);
                  const rowStyle = deal
                    ? { background: 'rgba(76,200,100,.12)', boxShadow: 'inset 3px 0 0 var(--green)' }
                    : row.inInventory ? { background: 'rgba(76,140,231,.05)' } : {};
                  return (
                    <tr key={row.id} style={rowStyle}>

                      {/* Thumbnail */}
                      <td>
                        <div className="item-thumb" onClick={() => openItem(row)} style={{ cursor: row.itemNum ? 'pointer' : 'default' }}>
                          {(() => {
                            const url = getItemImageUrl(row.itemNum, row.itemType, row.imageUrl);
                            const cacheKey = `${row.itemType}:${row.itemNum}`;
                            const cached = imageCacheRef.current[cacheKey];
                            if (cached === 'error' || !url) {
                              return <span style={{ fontSize: 18 }}>{row.itemType === 'minifig' ? '🧑' : row.itemNum ? '📦' : '🧱'}</span>;
                            }
                            return (
                              <img src={url} alt=""
                                onLoad={() => { imageCacheRef.current[cacheKey] = url; }}
                                onError={e => { imageCacheRef.current[cacheKey] = 'error'; e.target.style.display = 'none'; }} />
                            );
                          })()}
                        </div>
                      </td>

                      {/* Item number */}
                      <td className="item-id">
                        {row.itemNum
                          ? <span onClick={() => openItem(row)}
                              style={{ fontWeight: 600, color: row.itemType === 'minifig' ? 'var(--orange)' : 'var(--accent)', cursor: 'pointer' }}>
                              {row.itemNum}
                            </span>
                          : <span style={{ color: 'var(--text3)' }}>—</span>}
                        {row.itemType === 'minifig' && row.itemNum && (
                          <span style={{ display: 'block', fontSize: 10, color: 'var(--orange)', marginTop: 1 }}>fig</span>
                        )}
                        {row.inInventory && (
                          <span title="In your inventory" style={{ display: 'block', fontSize: 10, color: 'var(--blue)', marginTop: 1 }}>📦 owned</span>
                        )}
                      </td>

                      {/* Name */}
                      <td>
                        <div onClick={() => openItem(row)}
                          style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', marginBottom: 2, cursor: row.itemNum ? 'pointer' : 'default' }}
                          onMouseOver={e => { if (row.itemNum) e.currentTarget.style.color = 'var(--accent)'; }}
                          onMouseOut={e => e.currentTarget.style.color = 'var(--text)'}>
                          {row.name || <span style={{ color: 'var(--text3)', fontWeight: 400, fontStyle: 'italic' }}>Unknown</span>}
                        </div>
                        {row.line && row.line !== row.name && (
                          <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.4 }}>
                            {row.line}
                          </div>
                        )}
                      </td>

                      {/* Theme */}
                      <td style={{ fontSize: 12, color: 'var(--text2)' }}>
                        {row.theme || '—'}
                      </td>

                      {/* Condition */}
                      <td style={{ fontSize: 12, color: 'var(--text2)' }}>
                        {row.condition || '—'}
                      </td>

                      {/* Ask price */}
                      <td style={{ fontWeight: 700, color: row.price != null ? 'var(--green)' : 'var(--text3)', fontSize: 13 }}>
                        {row.price != null ? `$${row.price.toFixed(2)}` : '—'}
                        {deal && (
                          <div
                            title={`Ask is ${Math.round(deal.ratio * 100)}% of suggested $${deal.listPrice.toFixed(2)}`}
                            style={{ marginTop: 3, display: 'inline-block', fontSize: 10, fontWeight: 800, padding: '1px 5px', borderRadius: 4, background: 'rgba(76,200,100,.18)', color: 'var(--green)', letterSpacing: '.3px', whiteSpace: 'nowrap' }}>
                            DEAL {Math.round((1 - deal.ratio) * 100)}% off
                          </div>
                        )}
                      </td>

                      {/* BL Sold / BL Active / Suggested */}
                      {(() => {
                        const cacheKey = row.itemNum ? `${row.itemType}:${row.itemNum}` : null;
                        const pc  = cacheKey ? priceCache[cacheKey] : null;
                        const fmt = (v) => v != null ? `$${v.toFixed(2)}` : null;
                        const blUrl = row.itemNum ? (() => {
                          if (row.itemType === 'minifig')
                            return `https://www.bricklink.com/v2/catalog/catalogitem.page?M=${encodeURIComponent(row.itemNum)}#T=P`;
                          const id = row.itemNum.includes('-') ? row.itemNum : row.itemNum + '-1';
                          return `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${encodeURIComponent(id)}#T=P`;
                        })() : null;
                        const PriceCell = ({ val, qty, color }) => (
                          <td style={{ fontSize: 12 }}>
                            {val != null
                              ? <>
                                  {blUrl
                                    ? <a href={blUrl} target="_blank" rel="noopener" style={{ fontWeight: 600, color, textDecoration: 'none' }}
                                        onMouseOver={e => e.target.style.textDecoration = 'underline'}
                                        onMouseOut={e => e.target.style.textDecoration = 'none'}>
                                        {fmt(val)}
                                      </a>
                                    : <span style={{ fontWeight: 600, color }}>{fmt(val)}</span>}
                                  {qty != null && <div style={{ fontSize: 10, color: 'var(--text3)' }}>{qty.toLocaleString()} {color === 'var(--blue)' ? 'sales' : 'listings'}</div>}
                                </>
                              : <span style={{ color: 'var(--text3)' }}>—</span>}
                          </td>
                        );
                        if (!row.itemNum) return <><td>—</td><td>—</td><td>—</td></>;
                        if (pc?.fetching) return <><td colSpan={3} style={{ fontSize: 11, color: 'var(--text3)' }}>⏳ fetching…</td></>;
                        if (pc?.blSold != null || pc?.blActive != null) {
                          return <>
                            <PriceCell val={pc.blSold}    qty={pc.blSoldQty}   color="var(--blue)"   />
                            <PriceCell val={pc.blActive}  qty={pc.blActiveQty} color="var(--purple)" />
                            <PriceCell val={pc.suggested} qty={null}           color="var(--accent)" />
                          </>;
                        }
                        return <><td colSpan={3}>
                          <button
                            onClick={() => fetchPriceForItem(row.itemNum, row.itemType)}
                            style={{ fontSize: 11, padding: '2px 7px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text2)', cursor: 'pointer' }}>
                            Fetch prices
                          </button>
                        </td></>;
                      })()}

                      {/* Flair */}
                      <td>
                        {row.flair && (() => { const fs = flairStyle(row.flair); return (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 5px', borderRadius: 4, background: fs.bg, color: fs.color, whiteSpace: 'nowrap' }}>
                            {row.flair}
                          </span>
                        ); })()}
                      </td>

                      {/* Seller */}
                      <td style={{ fontSize: 12, color: 'var(--text2)' }}>
                        u/{row.author}
                      </td>

                      {/* Posted */}
                      <td style={{ fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
                        {timeAgo(row.created_utc)}
                      </td>

                      {/* Link */}
                      <td>
                        <a href={`https://reddit.com${row.permalink}`} target="_blank" rel="noopener"
                          style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>
                          View →
                        </a>
                      </td>

                      {/* Ignore / Unignore */}
                      <td>
                        {ignored[row.postId]
                          ? <button
                              onClick={() => unignorePost(row.postId)}
                              title="Remove from ignore list"
                              style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text2)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                              ↩ Show
                            </button>
                          : <button
                              onClick={() => ignorePost(row.postId)}
                              title="Ignore this post for 1 week"
                              style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text3)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                              🚫
                            </button>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
