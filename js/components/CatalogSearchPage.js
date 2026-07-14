// ─── Catalog Search Page ───
// Lets you search the local BrickLink catalog to look up or price sets,
// minifigs, and parts without adding them to your inventory.

const CATALOG_TYPE_OPTIONS = [
  { value: 'all',     label: 'All Types' },
  { value: 'set',     label: 'Sets' },
  { value: 'minifig', label: 'Minifigs' },
  { value: 'part',    label: 'Parts' },
];

const TYPE_BADGE_STYLE = {
  set:     { background: 'rgba(246,199,0,.12)',  color: 'var(--accent)'  },
  minifig: { background: 'rgba(231,138,76,.15)', color: 'var(--orange)'  },
  part:    { background: 'rgba(76,140,231,.15)', color: 'var(--blue)'    },
};

function CatalogSearchPage({ blConfigured, ebayConfigured, settings, setEditItem, setModal, setOnItemSaved, setOnPriceFetched, catalog, data, setData }) {
  const [query,      setQuery]      = React.useState('');
  const [typeFilter, setTypeFilter] = React.useState('all');
  const [results,    setResults]    = React.useState([]);
  const [total,      setTotal]      = React.useState(0);
  const [loading,    setLoading]    = React.useState(false);
  const [searched,   setSearched]   = React.useState(false);
  const [offset,     setOffset]     = React.useState(0);
  const [priceItem,  setPriceItem]  = React.useState(null); // item being priced inline
  const [priceData,  setPriceData]  = React.useState({});  // itemNumber → { bl, ebay, loading, error }
  const [addedItems, setAddedItems] = React.useState(new Set());

  const PAGE_SIZE = 100;
  const inputRef  = React.useRef(null);

  // Focus search on mount
  React.useEffect(() => { inputRef.current?.focus(); }, []);

  const doSearch = React.useCallback(async (q, type, off = 0) => {
    setLoading(true);
    setSearched(true);
    try {
      const params = new URLSearchParams({ q, type, limit: PAGE_SIZE, offset: off });
      const resp   = await fetch(`/api/catalog/search?${params}`);
      const data   = resp.ok ? await resp.json() : { results: [], total: 0 };
      if (off === 0) {
        setResults(data.results || []);
      } else {
        setResults(prev => [...prev, ...(data.results || [])]);
      }
      setTotal(data.total || 0);
      setOffset(off);
    } catch (e) {
      setResults([]);
      setTotal(0);
    }
    setLoading(false);
  }, []);

  // Debounced search on query / filter change
  React.useEffect(() => {
    if (!catalog?.loaded) return;
    const t = setTimeout(() => doSearch(query, typeFilter, 0), 300);
    return () => clearTimeout(t);
  }, [query, typeFilter, catalog?.loaded]);

  const loadMore = () => doSearch(query, typeFilter, offset + PAGE_SIZE);

  // ─── Inline BrickLink price fetch ───
  // Fetches sold + active medians for both U and N conditions, runs suggestedPrice()
  // for a consistent result. Falls back to opposite condition if primary returns nothing.
  const fetchPrice = React.useCallback(async (item) => {
    const key = `${item.type}:${item.itemNumber}`;
    if (priceData[key]?.loading) return;
    setPriceData(prev => ({ ...prev, [key]: { loading: true } }));
    try {
      const countryCode = settings?.blCountryCode !== undefined ? settings.blCountryCode : 'US';
      const baseParams = { type: item.type, itemNumber: item.itemNumber, filterOutliers: 'true', countryCode };

      const fetchGuide = async (guide, newOrUsed) => {
        const resp = await fetch(`/api/bricklink/price?${new URLSearchParams({ ...baseParams, guide, newOrUsed })}`);
        const data = await resp.json();
        return (!resp.ok || data.error || data.avg == null) ? null : data;
      };

      // Try used first, then new as fallback for sold; parallel fetch active listings
      let [sold, active] = await Promise.all([
        fetchGuide('sold', 'U'),
        fetchGuide('stock', 'U'),
      ]);

      let priceEstimated = null;

      // Fallback: if no used sold data, try new and scale down
      if (!sold) {
        const soldNew = await fetchGuide('sold', 'N');
        if (soldNew) {
          sold = {
            ...soldNew,
            median: soldNew.median != null ? Math.round(soldNew.median * 0.6 * 100) / 100 : null,
            avg:    soldNew.avg    != null ? Math.round(soldNew.avg    * 0.6 * 100) / 100 : null,
          };
          priceEstimated = 'used_from_new';
        }
      }

      // Fallback for active: try new if used has nothing
      if (!active) {
        active = await fetchGuide('stock', 'N');
      }

      if (!sold && !active) {
        setPriceData(prev => ({ ...prev, [key]: { loading: false, error: true } }));
        return;
      }

      // Build a synthetic item shaped like an inventory item so suggestedPrice() works
      const syntheticItem = {
        bricklinkMedian:         sold?.median   ?? null,
        bricklinkActiveMedian:   active?.median ?? null,
        bricklinkActive:         active?.avg    ?? null,
        bricklinkPriceEstimated: priceEstimated,
        priceHistory: [],
      };
      const suggested = suggestedPrice(syntheticItem);

      setPriceData(prev => ({
        ...prev,
        [key]: {
          loading: false,
          suggested,
          soldMedian:   sold?.median   ?? null,
          activeMedian: active?.median ?? null,
          estimated:    priceEstimated,
        },
      }));
    } catch {
      setPriceData(prev => ({ ...prev, [key]: { loading: false, error: true } }));
    }
  }, [priceData, settings]);

  // ─── Open BrickLink page for an item ───
  const openBrickLink = (item) => {
    const typeCode = { set: 'S', minifig: 'M', part: 'P' }[item.type] || 'S';
    const url = `https://www.bricklink.com/v2/catalog/catalogitem.page?${item.type === 'set' ? 'S' : item.type === 'minifig' ? 'M' : 'P'}=${encodeURIComponent(item.itemNumber)}`;
    window.open(url, '_blank');
  };

  // ─── Add to inventory shortcut ───
  const addToInventory = (item) => {
    const key = `${item.type}:${item.itemNumber}`;
    setEditItem({ type: item.type, itemNumber: item.itemNumber, name: item.name, theme: item.theme });
    // Fire when Save is clicked
    setOnItemSaved(() => () => {
      setAddedItems(prev => new Set([...prev, key]));
    });
    // When modal fetches prices, write result back into our priceData so the
    // "Get price" button is replaced by the chip without needing a separate fetch.
    setOnPriceFetched(() => (priceResult) => {
      setPriceData(prev => ({ ...prev, [key]: priceResult }));
    });
    setModal('add');
  };

  // ─── Render price chip ───
  const renderPriceChip = (item) => {
    const key  = `${item.type}:${item.itemNumber}`;
    const data = priceData[key];
    if (!data) return null;
    if (data.loading) return React.createElement('span', { style: { color: 'var(--text3)', fontSize: 11 } }, '…');
    if (data.error)   return React.createElement('span', { style: { color: 'var(--red)',   fontSize: 11 } }, 'n/a');
    if (data.suggested == null) return React.createElement('span', { style: { color: 'var(--text3)', fontSize: 11 } }, '—');
    const tooltipParts = [
      data.soldMedian   != null ? `Sold median: $${data.soldMedian.toFixed(2)}`     : null,
      data.activeMedian != null ? `Active median: $${data.activeMedian.toFixed(2)}` : null,
      data.estimated === 'used_from_new' ? 'No used sales — estimated from new ×0.6' : null,
    ].filter(Boolean);
    return React.createElement('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
      React.createElement('span', {
        style: { fontWeight: 600, color: 'var(--accent)', fontSize: 13 },
        title: tooltipParts.join(' · ') || undefined,
      }, `$${data.suggested.toFixed(2)}`),
      data.estimated && React.createElement('span', {
        title: data.estimated === 'used_from_new' ? 'No used sales — estimated from new ×0.6' : 'Estimated price',
        style: { color: 'var(--orange)', fontSize: 12, lineHeight: 1, cursor: 'default' },
      }, '⚠'),
    );
  };

  // ─── No catalog loaded state ───
  if (!catalog?.loaded) {
    return React.createElement('div', null,
      React.createElement('div', { className: 'header' },
        React.createElement('h1', null, 'Catalog Search')
      ),
      React.createElement('div', {
        style: {
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', padding: 48, textAlign: 'center',
        }
      },
        React.createElement('div', { style: { fontSize: 40, marginBottom: 16 } }, '📦'),
        React.createElement('div', { style: { fontSize: 16, fontWeight: 600, marginBottom: 8 } }, 'No catalog loaded'),
        React.createElement('div', { style: { color: 'var(--text2)', fontSize: 14, maxWidth: 400, margin: '0 auto' } },
          'Load a BrickLink catalog XML in the Configuration page to enable catalog search.'
        )
      )
    );
  }

  // ─── Main render ───
  return React.createElement('div', null,

    // Header
    React.createElement('div', { className: 'header' },
      React.createElement('h1', null, 'Catalog Search'),
      React.createElement('div', { style: { fontSize: 13, color: 'var(--text2)' } },
        `${(catalog.counts?.sets || 0).toLocaleString()} sets · `,
        `${(catalog.counts?.minifigs || 0).toLocaleString()} minifigs · `,
        `${(catalog.counts?.parts || 0).toLocaleString()} parts`
      )
    ),

    // Search bar + filters
    React.createElement('div', {
      style: {
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', padding: '16px 20px',
        display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap',
      }
    },
      React.createElement('button', {
        className: 'btn-icon',
        title: 'Clear search and filters',
        style: { opacity: (query || typeFilter !== 'all') ? 1 : 0.35, flexShrink: 0 },
        onClick: () => { setQuery(''); setTypeFilter('all'); setResults([]); setSearched(false); setTotal(0); },
      }, Icons.x),
      React.createElement('div', { style: { position: 'relative', flex: 1, minWidth: 220 } },
        React.createElement('div', {
          style: {
            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--text2)', pointerEvents: 'none', width: 16, height: 16,
          }
        }, Icons.search),
        React.createElement('input', {
          ref: inputRef,
          className: 'search-box',
          style: { width: '100%', paddingLeft: 38 },
          placeholder: 'Search by name, set number, or theme…',
          value: query,
          onChange: e => setQuery(e.target.value),
          onKeyDown: e => e.key === 'Escape' && setQuery(''),
        })
      ),
      React.createElement('select', {
        className: 'filter-select',
        value: typeFilter,
        onChange: e => setTypeFilter(e.target.value),
      },
        ...CATALOG_TYPE_OPTIONS.map(opt =>
          React.createElement('option', { key: opt.value, value: opt.value }, opt.label)
        )
      ),
    ),

    // Results
    React.createElement('div', { className: 'table-wrap' },

      // Toolbar / result count
      React.createElement('div', { className: 'table-toolbar' },
        loading
          ? React.createElement('span', { style: { color: 'var(--text2)', fontSize: 13 } }, 'Searching…')
          : searched
            ? React.createElement('span', { style: { color: 'var(--text2)', fontSize: 13 } },
                total > 0
                  ? `${total.toLocaleString()} result${total !== 1 ? 's' : ''}${results.length < total ? ` (showing ${results.length})` : ''}`
                  : 'No results found'
              )
            : React.createElement('span', { style: { color: 'var(--text2)', fontSize: 13 } }, 'Start typing to search the catalog'),
        React.createElement('span', { style: { marginLeft: 'auto', fontSize: 12, color: 'var(--text3)' } },
          blConfigured ? '' : '(BrickLink not configured — prices unavailable)'
        )
      ),

      // Table
      results.length > 0 && React.createElement('table', null,
        React.createElement('thead', null,
          React.createElement('tr', null,
            React.createElement('th', null, 'Item #'),
            React.createElement('th', null, 'Name'),
            React.createElement('th', null, 'Theme / Category'),
            React.createElement('th', null, 'Type'),
            blConfigured && React.createElement('th', null, 'Sugg. Price'),
            React.createElement('th', { style: { width: 160, textAlign: 'right' } }, 'Actions'),
          )
        ),
        React.createElement('tbody', null,
          ...results.map((item) => {
            const key      = `${item.type}:${item.itemNumber}`;
            const badgeSty = TYPE_BADGE_STYLE[item.type] || {};
            const wasAdded = addedItems.has(key);
            return React.createElement('tr', { key },
              React.createElement('td', null,
                React.createElement('code', {
                  style: { fontSize: 12, color: 'var(--accent)', background: 'rgba(246,199,0,.08)', padding: '2px 6px', borderRadius: 4 }
                }, item.itemNumber)
              ),
              React.createElement('td', { style: { fontWeight: 500 } }, item.name || '—'),
              React.createElement('td', { style: { color: 'var(--text2)', fontSize: 13 } }, item.theme || '—'),
              React.createElement('td', null,
                React.createElement('span', {
                  style: { ...badgeSty, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, textTransform: 'capitalize' }
                }, item.type)
              ),
              blConfigured && React.createElement('td', null,
                priceData[key]
                  ? renderPriceChip(item)
                  : React.createElement('button', {
                      className: 'btn btn-secondary btn-sm',
                      style: { fontSize: 11, padding: '2px 8px' },
                      onClick: () => fetchPrice(item),
                    }, 'Get price')
              ),
              React.createElement('td', { style: { textAlign: 'right' } },
                React.createElement('div', { style: { display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' } },
                  React.createElement('button', {
                    className: 'btn btn-secondary btn-sm',
                    style: { fontSize: 11, padding: '2px 8px' },
                    title: 'Open on BrickLink',
                    onClick: () => openBrickLink(item),
                  }, 'BL ↗'),
                  data && setData && React.createElement(AddToWantedListButton, { item, data, setData }),
                  React.createElement('button', {
                    className: wasAdded ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm',
                    style: { fontSize: 11, padding: '2px 8px', opacity: wasAdded ? 0.6 : 1 },
                    title: wasAdded ? 'Already opened add dialog' : 'Add to inventory',
                    onClick: () => !wasAdded && addToInventory(item),
                  }, wasAdded ? '✓ Added' : '+ Add'),
                )
              ),
            );
          })
        )
      ),

      // Load more
      results.length > 0 && results.length < total && React.createElement('div', {
        style: { padding: '16px 18px', borderTop: '1px solid var(--border)', textAlign: 'center' }
      },
        React.createElement('button', {
          className: 'btn btn-secondary',
          onClick: loadMore,
          disabled: loading,
        }, loading ? 'Loading…' : `Load more (${total - results.length} remaining)`)
      ),

      // Empty state when no results
      searched && !loading && results.length === 0 && React.createElement('div', {
        style: { padding: '48px 24px', textAlign: 'center', color: 'var(--text2)' }
      },
        React.createElement('div', { style: { fontSize: 32, marginBottom: 12 } }, '🔍'),
        React.createElement('div', { style: { fontSize: 14 } }, `No ${typeFilter === 'all' ? 'items' : typeFilter + 's'} matched "${query}"`)
      ),
    )
  );
}
