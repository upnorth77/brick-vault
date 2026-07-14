function InventoryPage({ items, allItems, stats, settings, search, setSearch, typeFilter, setTypeFilter, statusFilter, setStatusFilter,
    colorFilter, setColorFilter, themeFilter, setThemeFilter, conditionFilter, setConditionFilter,
    dateAddedFilter, setDateAddedFilter,
    sortCol, sortDir, handleSort, setModal, setEditItem, deleteItem, setPage, setPricingSearch,
    onBulkEdit, onMergeDuplicates, mergeResult,
    exportData, exportCSV, exportBricklinkXML, exportBricklinkWanted, fileInput, importData }) {

  const typeColumn       = !!settings?.typeColumn;
  const blIdColumn       = !!settings?.blIdColumn;
  const colorColumn      = !!settings?.colorColumn;
  const dateAddedColumn = !!settings?.dateAddedColumn;

  const [showExportMenu, setShowExportMenu] = React.useState(false);
  const [collapsedGroups, setCollapsedGroups] = React.useState({});
  const exportMenuRef = React.useRef(null);

  const source = allItems || items;
  const colorOptions   = React.useMemo(() => [...new Set(source.map(i => i.color  || '').filter(c => c && c !== '(Not Applicable)'))].sort(), [source]);
  const themeOptions   = React.useMemo(() => [...new Set(source.map(i => i.theme  || '').filter(Boolean))].sort(), [source]);
  const conditionOptions = React.useMemo(() => {
    const used = new Set(source.map(i => i.condition || '').filter(Boolean));
    return Object.entries(CONDITION_LABELS).filter(([k]) => used.has(k));
  }, [source]);

  React.useEffect(() => {
    const handler = (e) => { if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) setShowExportMenu(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const SortTH = ({ col, children }) => (
    <th onClick={() => handleSort(col)}>
      {children}
      {sortCol === col && <span className="sort-arrow">{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );
  const tableColSpan = 10 + (typeColumn ? 1 : 0) + (blIdColumn ? 1 : 0) + (colorColumn ? 1 : 0) + (dateAddedColumn ? 1 : 0);
  const groupedItems = React.useMemo(() => groupItemsByTypeCategory(items), [items]);
  const groupKey = (kind, value) => `${kind}:${value || 'blank'}`;
  const toggleGroup = (kind, value) => {
    const key = groupKey(kind, value);
    setCollapsedGroups(prev => ({ ...prev, [key]: !(key in prev ? prev[key] : true) }));
  };
  const expandAll  = () => {
    const all = {};
    groupedItems.forEach(tg => {
      all[groupKey('type', tg.type)] = false;
      tg.rows.forEach(({ category }) => { all[groupKey('category', `${tg.type}:${category}`)] = false; });
    });
    setCollapsedGroups(all);
  };
  const collapseAll = () => setCollapsedGroups({});
  const allExpanded = React.useMemo(() => {
    if (!groupedItems.length) return false;
    return groupedItems.every(tg =>
      collapsedGroups[groupKey('type', tg.type)] === false &&
      tg.rows.every(({ category }) => collapsedGroups[groupKey('category', `${tg.type}:${category}`)] === false)
    );
  }, [groupedItems, collapsedGroups]);

  const isFiltered = search || typeFilter !== 'all' || statusFilter !== 'all' || colorFilter !== 'all' || themeFilter !== 'all' || conditionFilter !== 'all' || dateAddedFilter !== 'all';

  // Compute which groups should be collapsed: all collapsed by default,
  // but when filtering/searching, expand everything so results are visible.
  const effectiveCollapsed = React.useMemo(() => {
    if (isFiltered) return {}; // filtered — show everything
    const defaults = {};
    groupedItems.forEach(typeGroup => {
      // Type groups start collapsed
      defaults[groupKey('type', typeGroup.type)] = !(groupKey('type', typeGroup.type) in collapsedGroups)
        ? true  // not yet touched → collapsed
        : collapsedGroups[groupKey('type', typeGroup.type)];
      typeGroup.rows.forEach(({ category }) => {
        const catKey = `${typeGroup.type}:${category}`;
        defaults[groupKey('category', catKey)] = !(groupKey('category', catKey) in collapsedGroups)
          ? true
          : collapsedGroups[groupKey('category', catKey)];
      });
    });
    return defaults;
  }, [isFiltered, groupedItems, collapsedGroups]);

  const menuItem = (onClick, color, label, ext) => (
    <div onClick={onClick}
      style={{padding:'8px 12px',borderRadius:6,cursor:'pointer',fontSize:13,color:'var(--text)',display:'flex',alignItems:'center',gap:8}}
      onMouseEnter={e=>e.currentTarget.style.background='var(--surface2)'}
      onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
      <span style={{color}}>●</span> {label}
      <span style={{marginLeft:'auto',fontSize:11,color:'var(--text2)'}}>{ext}</span>
    </div>
  );

  return (
    <>
      <div className="header">
        <h1>Inventory</h1>
        <div className="header-actions">
          <input type="file" ref={fileInput} style={{display:'none'}} accept=".json,.csv,.xml,.bsx" onChange={importData} />
          <button className="btn btn-secondary" onClick={()=>fileInput.current.click()}>{Icons.upload} Import</button>
          <div style={{position:'relative'}} ref={exportMenuRef}>
            <button className="btn btn-secondary" onClick={()=>setShowExportMenu(v=>!v)}>{Icons.download} Export ▾</button>
            {showExportMenu && (
              <div style={{position:'absolute',top:'100%',right:0,marginTop:6,background:'var(--surface)',border:'1px solid var(--border)',borderRadius:10,padding:6,minWidth:220,zIndex:50,boxShadow:'0 8px 30px rgba(0,0,0,.4)'}}>
                <div style={{padding:'6px 12px',fontSize:11,color:'var(--text2)',textTransform:'uppercase',letterSpacing:'.5px'}}>BrickLink</div>
                {menuItem(()=>{exportBricklinkXML({forSale:false});setShowExportMenu(false);}, 'var(--blue)',   'Inventory XML',  '.xml')}
                {menuItem(()=>{exportBricklinkXML({forSale:true});setShowExportMenu(false);},  'var(--green)',  'For Sale XML',   '.xml')}
                {menuItem(()=>{exportBricklinkWanted();setShowExportMenu(false);},              'var(--orange)', 'Wanted List XML','.xml')}
                <div style={{borderTop:'1px solid var(--border)',margin:'4px 0'}}></div>
                <div style={{padding:'6px 12px',fontSize:11,color:'var(--text2)',textTransform:'uppercase',letterSpacing:'.5px'}}>General</div>
                {menuItem(()=>{exportCSV();setShowExportMenu(false);},    'var(--accent)', 'CSV Spreadsheet', '.csv')}
                {menuItem(()=>{exportData();setShowExportMenu(false);},   'var(--purple)', 'Full Backup JSON', '.json')}
              </div>
            )}
          </div>
          <button className="btn btn-secondary" onClick={onMergeDuplicates}>⊕ Merge Dupes</button>
          <button className="btn btn-secondary" onClick={onBulkEdit}>⚡ Bulk Edit</button>
          <button className="btn btn-primary" onClick={()=>setModal('add')}>{Icons.plus} Add Item</button>
        </div>
      </div>

      {mergeResult && (
        <div style={{margin:'0 0 12px',padding:'10px 16px',background:'rgba(76,231,153,.1)',border:'1px solid rgba(76,231,153,.25)',borderRadius:8,fontSize:13,color:'var(--green)',fontWeight:500}}>
          ✓ Merged {mergeResult.count} duplicate row{mergeResult.count !== 1 ? 's' : ''}
          {mergeResult.skipped > 0 && <span style={{color:'var(--text2)',fontWeight:400}}> · {mergeResult.skipped} group{mergeResult.skipped !== 1 ? 's' : ''} skipped</span>}
          {mergeResult.blStatus === 'syncing' && <span style={{color:'var(--text2)',fontWeight:400}}> · syncing BrickLink…</span>}
          {mergeResult.blStatus === 'done' && mergeResult.blDone > 0 && <span style={{color:'var(--text2)',fontWeight:400}}> · {mergeResult.blDone} BrickLink listing{mergeResult.blDone !== 1 ? 's' : ''} updated</span>}
          {mergeResult.blStatus === 'done' && mergeResult.blFailed > 0 && <span style={{color:'var(--red)',fontWeight:400}}> · {mergeResult.blFailed} BL update{mergeResult.blFailed !== 1 ? 's' : ''} failed</span>}
        </div>
      )}
      <div className="stats-row">
        <div className="stat-card">
          <div className="label">Total Items</div>
          <div className="value">{stats.totalQty}</div>
          <div className="sub">{stats.sets} sets · {stats.minifigs} figs · {stats.parts} parts</div>
        </div>
        <div className="stat-card"><div className="label">Total Cost</div><div className="value blue">{currency(stats.totalCost)}</div></div>
        <div className="stat-card">
          <div className="label">Sugg. Value</div>
          <div className="value accent">{currency(stats.totalValue)}</div>
          {stats.totalCost > 0 && <div className="sub">{pct(((stats.totalValue - stats.totalCost) / stats.totalCost) * 100)} ROI</div>}
        </div>
        <div className="stat-card">
          <div className="label">Profit (Sold)</div>
          <div className={`value ${stats.totalProfit >= 0 ? 'green' : ''}`}>{currency(stats.totalProfit)}</div>
          <div className="sub">{stats.sold} items sold</div>
        </div>
      </div>

      <div className="table-wrap">
        <div className="table-toolbar">
          {(() => {
            const isFiltered = search || typeFilter !== 'all' || statusFilter !== 'all' || colorFilter !== 'all' || themeFilter !== 'all' || conditionFilter !== 'all' || dateAddedFilter !== 'all';
            const clearAll = () => { setSearch(''); setTypeFilter('all'); setStatusFilter('all'); setColorFilter('all'); setThemeFilter('all'); setConditionFilter('all'); setDateAddedFilter('all'); };
            return (
              <button className="btn-icon" onClick={clearAll} title="Clear search and filters"
                style={{ opacity: isFiltered ? 1 : 0.35, flexShrink: 0 }}>
                {Icons.x}
              </button>
            );
          })()}
          <input className="search-box" placeholder="Search items..." value={search} onChange={e => setSearch(e.target.value)} />
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
          <select className="filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">All Statuses</option>
            <option value="available">Available</option>
            <option value="collection">Collection</option>
            <option value="listed">Listed</option>
          </select>
          {colorOptions.length > 0 && (
            <select className="filter-select" value={colorFilter} onChange={e => setColorFilter(e.target.value)}>
              <option value="all">All Colors</option>
              {colorOptions.map(c => <option key={c} value={c}>{c}</option>)}
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
              {conditionOptions.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          )}
          <select className="filter-select" value={dateAddedFilter} onChange={e => setDateAddedFilter(e.target.value)}>
            <option value="all">All Dates Added</option>
            <option value="7d">Added: last 7 days</option>
            <option value="30d">Added: last 30 days</option>
            <option value="90d">Added: last 90 days</option>
            <option value="1y">Added: last year</option>
          </select>
        </div>
        {items.length === 0 ? (
          <div className="empty-state">
            {Icons.box}
            <h3>No items yet</h3>
            <p>Add your first LEGO item to start tracking your collection.</p>
            <button className="btn btn-primary" onClick={()=>setModal('add')}>{Icons.plus} Add Item</button>
          </div>
        ) : (
          <div style={{overflowX:'auto'}}>
            {!typeColumn && (
              <div style={{display:'flex',gap:16,fontSize:11,color:'var(--text2)',padding:'8px 18px 0',flexWrap:'wrap'}}>
                <span>Item type: <span style={{color:'var(--accent)'}}>● Set</span> &nbsp;<span style={{color:'var(--orange)'}}>● Minifig</span> &nbsp;<span style={{color:'var(--blue)'}}>● Part</span></span>
              </div>
            )}
            <table>
              <thead>
                <tr>
                  <th style={{width:50}}></th>
                  {typeColumn && <SortTH col="type">Type</SortTH>}
                  {blIdColumn && <SortTH col="itemNumber">BL ID</SortTH>}
                  <SortTH col="name">Name</SortTH>
                  {colorColumn && <SortTH col="color">Color</SortTH>}
                  <SortTH col="theme">Theme</SortTH>
                  <SortTH col="condition">Condition</SortTH>
                  <SortTH col="quantity">Qty</SortTH>
                  <SortTH col="estimatedValue">Price</SortTH>
                  <th title="Suggested price from Price Guide (BrickLink + eBay data)">Sugg. Value</th>
                  <th>Prices</th>
                  {dateAddedColumn && <SortTH col="dateAdded">Date Added</SortTH>}
                  <SortTH col="sellStatus">Status</SortTH>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {groupedItems.map(typeGroup => {
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
                        return (
                          <React.Fragment key={`category-${categoryKey}`}>
                            <tr>
                              <td colSpan={tableColSpan}
                                onClick={() => toggleGroup('category', categoryKey)}
                                style={{padding:'6px 18px 6px 40px',background:'rgba(0,0,0,.03)',borderBottom:'1px solid var(--border)',cursor:'pointer',userSelect:'none'}}>
                                <span style={{color:'var(--text3)',display:'inline-block',width:14}}>{categoryCollapsed ? '▶' : '▼'}</span>
                                <span style={{fontWeight:600,color:'var(--text2)'}}>{categoryGroup.category}</span>
                                <span style={{fontSize:11,color:'var(--text3)',marginLeft:8}}>{categoryGroup.rows.length} listing{categoryGroup.rows.length !== 1 ? 's' : ''} · {categoryQty} item{categoryQty !== 1 ? 's' : ''}</span>
                              </td>
                            </tr>
                            {!categoryCollapsed && categoryGroup.rows.map(item => (
                  <tr key={item.id}>
                    <td>
                      <div className="item-thumb" onClick={()=>{setEditItem(item);setModal('edit');}} style={{cursor:'pointer'}}>
                        {item.imageUrl
                          ? <img src={item.imageUrl} alt="" />
                          : (item.type==='set' ? '📦' : item.type==='minifig' ? '🧑' : '🧱')}
                      </div>
                    </td>
                    {typeColumn && <td><span className={`badge badge-${item.type}`}>{item.type}</span></td>}
                    {blIdColumn && <td className="item-id">{item.itemNumber}</td>}
                    <td onClick={()=>{setEditItem(item);setModal('edit');}} style={{cursor:'pointer'}}>
                      <span className="item-name" style={{color:typeColumn?undefined:item.type==='set'?'var(--accent)':item.type==='minifig'?'var(--orange)':'var(--blue)'}}>
                        {item.blLookupFailed && <span title="Not found on BrickLink" style={{color:'var(--orange)',marginRight:4,verticalAlign:'middle',display:'inline-flex',width:16,height:16}}>{Icons.caution}</span>}
                        {item.name}
                      </span>
                      {!blIdColumn && (
                        <><br /><span className="item-id">
                          {item.itemNumber}
                          {!colorColumn && item.color && item.color !== '(Not Applicable)' && <> · {item.color}</>}
                        </span></>
                      )}
                      {blIdColumn && !colorColumn && item.color && item.color !== '(Not Applicable)' && (
                        <><br /><span className="item-id">{item.color}</span></>
                      )}
                    </td>
                    {colorColumn && (
                      <td style={{color:'var(--text2)',fontSize:12}}>
                        {item.color && item.color !== '(Not Applicable)' ? (
                          <div style={{display:'flex',alignItems:'center',gap:5}}>
                            {item.colorHex && (
                              <span style={{display:'inline-block',width:10,height:10,borderRadius:2,background:item.colorHex,border:'1px solid rgba(255,255,255,.2)',flexShrink:0}} />
                            )}
                            {item.color}
                          </div>
                        ) : '—'}
                      </td>
                    )}
                    <td style={{color:'var(--text2)'}}>{item.theme || '—'}</td>
                    <td style={{fontSize:12,color:'var(--text2)'}}>{CONDITION_LABELS[item.condition] || '—'}</td>
                    <td>{item.quantity || 1}</td>
                    <td style={{color:'var(--text2)'}}>
                      {item.estimatedValue != null && item.estimatedValue > 0
                        ? currency(item.estimatedValue)
                        : <span style={{color:'var(--text3)'}}>—</span>}
                    </td>
                    <td style={{fontWeight:600}}>
                      {(() => {
                        const suggested = suggestedPrice(item);
                        const canNav = setPage && setPricingSearch && item.itemNumber;
                        const handleClick = canNav ? () => { setPricingSearch(item.itemNumber); setPage('pricing'); } : undefined;
                        return suggested != null
                          ? <span
                              onClick={handleClick}
                              title={canNav ? 'Open in Price Guide' : 'Suggested price from Price Guide'}
                              style={canNav ? {cursor:'pointer', color:'var(--accent)', borderBottom:'1px dashed var(--text3)'} : {color:'var(--accent)'}}>
                              {currency(suggested)}
                            </span>
                          : <span
                              onClick={handleClick}
                              title={canNav ? 'Open in Price Guide to fetch prices' : 'No price data yet — run a price check in the Price Guide'}
                              style={canNav ? {cursor:'pointer', color:'var(--text3)', borderBottom:'1px dashed var(--text3)'} : {color:'var(--text3)'}}>
                              —
                            </span>;
                      })()}
                    </td>
                    <td>
                      <div className="price-links">
                        <a className="price-link bl" href={bricklinkPriceUrl(item)} target="_blank" rel="noopener">BL</a>
                        <a className="price-link eb" href={ebaySearchUrl(item)}     target="_blank" rel="noopener">eBay</a>
                      </div>
                    </td>
                    {dateAddedColumn && (
                      <td style={{fontSize:12,color:'var(--text2)',whiteSpace:'nowrap'}}>
                        {item.dateAdded || <span style={{color:'var(--text3)'}}>—</span>}
                      </td>
                    )}
                    <td><span className={`badge badge-${item.sellStatus||'available'}`}>{item.sellStatus||'available'}</span></td>
                    <td>
                      <div style={{display:'flex',gap:4}}>
                        <button className="btn-icon" title="Edit"   onClick={()=>{setEditItem(item);setModal('edit');}}>{Icons.edit}</button>
                        <button className="btn-icon" title="Delete" onClick={()=>deleteItem(item.id)}>{Icons.trash}</button>
                      </div>
                    </td>
                  </tr>
                            ))}
                          </React.Fragment>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
