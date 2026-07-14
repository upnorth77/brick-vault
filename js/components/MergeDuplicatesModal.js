function MergeDuplicatesModal({ items, onMerge, onClose }) {

  // ─── Find duplicate groups ───────────────────────────────────────────────
  const { autoGroups, conflictGroups } = React.useMemo(() => {
    const groupMap = new Map();
    for (const item of items) {
      if ((item.sellStatus || 'available') === 'sold') continue;
      const key = [
        (item.type       || '').toLowerCase(),
        (item.itemNumber || '').toLowerCase(),
        (item.color      || '').toLowerCase(),
        (item.condition  || '').toLowerCase(),
      ].join('||');
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key).push(item);
    }
    const auto = [], conflicts = [];
    for (const group of groupMap.values()) {
      if (group.length <= 1) continue;
      const uniqueNotes = [...new Set(group.map(i => (i.notes || '').trim()).filter(Boolean))];
      if (uniqueNotes.length <= 1) auto.push(group);
      else conflicts.push(group);
    }
    return { autoGroups: auto, conflictGroups: conflicts };
  }, [items]);

  // Flat list for the preview: auto groups first, then conflict groups
  const allGroups = React.useMemo(() => [
    ...autoGroups.map(g     => ({ group: g, hasConflict: false })),
    ...conflictGroups.map(g => ({ group: g, hasConflict: true  })),
  ], [autoGroups, conflictGroups]);

  const totalGroups = allGroups.length;

  // ─── Preview selection (all checked by default) ───────────────────────────
  const [selected, setSelected] = React.useState(() => new Set(allGroups.map((_, i) => i)));

  const toggleSelect = (i) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });
  const selectAll   = () => setSelected(new Set(allGroups.map((_, i) => i)));
  const deselectAll = () => setSelected(new Set());

  // ─── Phase / step state ───────────────────────────────────────────────────
  // phase: 'preview' | 'conflict'
  const [phase,     setPhase]     = React.useState('preview');
  const [step,      setStep]      = React.useState(0);
  const [decisions, setDecisions] = React.useState([]); // [{ group, notes: string|null }]

  // Conflict groups that were selected in the preview
  const selectedConflictGroups = React.useMemo(() =>
    conflictGroups.filter((_, i) => selected.has(autoGroups.length + i)),
    [conflictGroups, autoGroups, selected]
  );

  const currentGroup = selectedConflictGroups[step] || null;

  const uniqueNotesForCurrent = React.useMemo(() => {
    if (!currentGroup) return [];
    return [...new Set(currentGroup.map(i => (i.notes || '').trim()).filter(Boolean))];
  }, [currentGroup]);

  const [checkedNotes, setCheckedNotes] = React.useState({});
  const [customNote,   setCustomNote]   = React.useState('');

  React.useEffect(() => {
    if (!currentGroup) return;
    const init = {};
    uniqueNotesForCurrent.forEach(n => { init[n] = true; });
    setCheckedNotes(init);
    setCustomNote(uniqueNotesForCurrent.join(' | '));
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCheckNote = (note, checked) => {
    const next = { ...checkedNotes, [note]: checked };
    setCheckedNotes(next);
    setCustomNote(uniqueNotesForCurrent.filter(n => next[n]).join(' | '));
  };

  // ─── Merge helpers ────────────────────────────────────────────────────────
  const mergeOneGroup = (group, notes) => {
    const sorted = [...group].sort((a, b) => {
      const score = i => [i.name, i.theme, i.imageUrl].filter(Boolean).length;
      return score(b) - score(a);
    });
    const primary = { ...sorted[0] };
    let totalQty = 0, minCost = Infinity;
    let maxValue = -Infinity, maxBL = -Infinity, maxEbay = -Infinity, maxList = -Infinity;

    for (const item of sorted) {
      totalQty += (item.quantity     || 1);
      minCost   = Math.min(minCost,  item.purchasePrice  || 0);
      maxValue  = Math.max(maxValue, item.estimatedValue || 0);
      maxBL     = Math.max(maxBL,    item.bricklinkPrice || 0);
      maxEbay   = Math.max(maxEbay,  item.ebayPrice      || 0);
      maxList   = Math.max(maxList,  item.listPrice      || 0);
      if (!primary.imageUrl      && item.imageUrl)      primary.imageUrl      = item.imageUrl;
      if (!primary.theme         && item.theme)         primary.theme         = item.theme;
      if (!primary.platform      && item.platform)      primary.platform      = item.platform;
      if (!primary.rebrickableId && item.rebrickableId) primary.rebrickableId = item.rebrickableId;
      if (!primary.colorHex      && item.colorHex)      primary.colorHex      = item.colorHex;
      if (!primary.blColorId     && item.blColorId)     primary.blColorId     = item.blColorId;
    }

    primary.quantity       = totalQty;
    primary.purchasePrice  = minCost  === Infinity  ? 0 : minCost;
    primary.estimatedValue = maxValue === -Infinity ? 0 : maxValue;
    primary.bricklinkPrice = maxBL    === -Infinity ? 0 : maxBL;
    primary.ebayPrice      = maxEbay  === -Infinity ? 0 : maxEbay;
    primary.listPrice      = maxList  === -Infinity ? 0 : maxList;
    primary.notes          = notes;
    primary.updatedAt      = new Date().toISOString();

    const removeIds = new Set(sorted.slice(1).map(i => i.id));
    return { primary, removeIds };
  };

  const applyAll = (allDecisions) => {
    let nextItems = [...items];
    let mergedCount = 0;
    const blActions = [];

    const processGroup = (group, notes) => {
      // Determine BL actions before merging (we need original bricklinkInventoryId values)
      const sortedForBl = [...group].sort((a, b) => {
        const score = i => [i.name, i.theme, i.imageUrl].filter(Boolean).length;
        return score(b) - score(a);
      });
      const totalQty = group.reduce((sum, i) => sum + (i.quantity || 1), 0);
      const allBlIds = group.map(i => i.bricklinkInventoryId).filter(Boolean);
      const keeperId = sortedForBl[0].bricklinkInventoryId || allBlIds[0] || null;

      if (allBlIds.length > 0) {
        // BL PUT treats quantity as a delta, so send totalQty minus the keeper's current qty
        const keeperItem = group.find(i => i.bricklinkInventoryId === keeperId);
        const keeperQty  = keeperItem?.quantity || 1;
        const delta      = totalQty - keeperQty;
        if (delta !== 0) blActions.push({ action: 'update', inventoryId: keeperId, quantity: delta });
        for (const id of allBlIds) {
          if (id !== keeperId) blActions.push({ action: 'delete', inventoryId: id });
        }
      }

      const { primary, removeIds } = mergeOneGroup(group, notes);
      // Ensure primary ends up with the BL ID we kept (may differ from primary's original)
      if (keeperId) primary.bricklinkInventoryId = keeperId;

      nextItems = nextItems.filter(i => !removeIds.has(i.id));
      const idx = nextItems.findIndex(i => i.id === primary.id);
      if (idx >= 0) nextItems[idx] = primary; else nextItems.push(primary);
      mergedCount += group.length - 1;
    };

    // Only process selected auto groups
    for (let i = 0; i < autoGroups.length; i++) {
      if (!selected.has(i)) continue;
      const group = autoGroups[i];
      const uniqueNotes = [...new Set(group.map(x => (x.notes || '').trim()).filter(Boolean))];
      processGroup(group, uniqueNotes.join(' | '));
    }

    // Process conflict decisions
    for (const { group, notes } of allDecisions) {
      if (notes === null) continue; // skipped
      processGroup(group, notes);
    }

    const skippedCount = allDecisions.filter(d => d.notes === null).length;
    onMerge(nextItems, mergedCount, skippedCount, blActions);
  };

  // Start merge: go to conflict phase if any selected groups have conflicts, else merge directly
  const startMerge = () => {
    if (selectedConflictGroups.length > 0) {
      setPhase('conflict');
      setStep(0);
      setDecisions([]);
    } else {
      applyAll([]);
    }
  };

  const advance = (notes) => {
    const allDecisions = [...decisions, { group: currentGroup, notes }];
    if (step + 1 >= selectedConflictGroups.length) {
      applyAll(allDecisions);
    } else {
      setDecisions(allDecisions);
      setStep(s => s + 1);
    }
  };

  // ─── No duplicates ────────────────────────────────────────────────────────
  if (totalGroups === 0) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={e => e.stopPropagation()} style={{maxWidth:400}}>
          <div className="modal-header">
            <h2>Merge Duplicates</h2>
            <button className="btn-icon" onClick={onClose}>{Icons.x}</button>
          </div>
          <div className="modal-body" style={{padding:'32px 20px',textAlign:'center'}}>
            <div style={{fontSize:36,marginBottom:12}}>✓</div>
            <div style={{fontSize:15,fontWeight:600,marginBottom:6}}>No duplicates found</div>
            <div style={{fontSize:13,color:'var(--text2)'}}>Your inventory is already clean.</div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-primary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Preview phase ────────────────────────────────────────────────────────
  if (phase === 'preview') {
    const selectedCount         = selected.size;
    const selectedConflictCount = selectedConflictGroups.length;

    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={e => e.stopPropagation()} style={{maxWidth:560}}>
          <div className="modal-header">
            <h2>Merge Duplicates</h2>
            <button className="btn-icon" onClick={onClose}>{Icons.x}</button>
          </div>

          <div className="modal-body" style={{padding:0,display:'flex',flexDirection:'column'}}>

            {/* Toolbar */}
            <div style={{
              padding:'10px 20px',borderBottom:'1px solid var(--border)',
              display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0,
            }}>
              <span style={{fontSize:13,color:'var(--text2)'}}>
                {totalGroups} duplicate group{totalGroups !== 1 ? 's' : ''} found
                {selectedCount < totalGroups && selectedCount > 0 &&
                  <span style={{color:'var(--accent)',marginLeft:6}}>{selectedCount} selected</span>}
              </span>
              <div style={{display:'flex',gap:12,fontSize:12}}>
                <button onClick={selectAll}
                  style={{background:'none',border:'none',color:'var(--accent)',cursor:'pointer',padding:0}}>
                  Select all
                </button>
                <button onClick={deselectAll}
                  style={{background:'none',border:'none',color:'var(--text3)',cursor:'pointer',padding:0}}>
                  Deselect all
                </button>
              </div>
            </div>

            {/* Group list */}
            <div style={{overflowY:'auto',maxHeight:'60vh',padding:'12px 16px',display:'flex',flexDirection:'column',gap:8}}>
              {allGroups.map(({ group, hasConflict }, gi) => {
                const primary    = [...group].sort((a, b) => {
                  const score = i => [i.name, i.theme, i.imageUrl].filter(Boolean).length;
                  return score(b) - score(a);
                })[0];
                const label      = primary.name || primary.itemNumber || 'Unknown';
                const totalQty   = group.reduce((s, i) => s + (i.quantity || 1), 0);
                const isSelected = selected.has(gi);

                return (
                  <div key={gi}
                    onClick={() => toggleSelect(gi)}
                    style={{
                      padding:'11px 13px',
                      background: isSelected ? 'var(--surface2)' : 'var(--surface)',
                      borderRadius:8,
                      border:`1px solid ${isSelected
                        ? (hasConflict ? 'rgba(231,180,76,.4)' : 'rgba(76,231,153,.3)')
                        : 'var(--border)'}`,
                      cursor:'pointer',
                      opacity: isSelected ? 1 : 0.45,
                      transition:'all .12s',
                    }}
                  >
                    {/* Group header */}
                    <div style={{display:'flex',alignItems:'flex-start',gap:9,marginBottom:8}}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(gi)}
                        onClick={e => e.stopPropagation()}
                        style={{marginTop:3,accentColor:'var(--accent)',flexShrink:0,cursor:'pointer'}}
                      />
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontWeight:600,fontSize:14,marginBottom:3,
                          whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                          {label}
                        </div>
                        <div style={{fontSize:12,color:'var(--text2)',display:'flex',gap:8,
                          flexWrap:'wrap',alignItems:'center'}}>
                          {primary.itemNumber && primary.name && <span style={{color:'var(--text3)'}}>{primary.itemNumber}</span>}
                          {primary.condition  && <span>{CONDITION_LABELS[primary.condition] || primary.condition}</span>}
                          {primary.type       && <span>{itemTypeLabel(primary.type)}</span>}
                          {primary.color      && <span>{primary.color}</span>}
                          <span style={{color:'var(--text3)'}}>{group.length} rows → qty {totalQty}</span>
                          {hasConflict && (
                            <span style={{
                              fontSize:10,fontWeight:700,padding:'1px 6px',lineHeight:'16px',
                              background:'rgba(231,180,76,.15)',color:'var(--orange)',
                              borderRadius:4,border:'1px solid rgba(231,180,76,.35)',flexShrink:0,
                            }}>NOTE CONFLICT</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Individual items */}
                    <div style={{display:'flex',flexDirection:'column',gap:3,paddingLeft:26}}>
                      {group.map(item => (
                        <div key={item.id} style={{
                          display:'flex',gap:10,alignItems:'baseline',
                          fontSize:12,color:'var(--text2)',padding:'4px 8px',
                          background:'var(--surface)',borderRadius:4,border:'1px solid var(--border)',
                        }}>
                          <span style={{flexShrink:0,minWidth:40}}>
                            Qty <strong style={{color:'var(--text)'}}>{item.quantity || 1}</strong>
                          </span>
                          {item.purchasePrice > 0 && (
                            <span style={{flexShrink:0,color:'var(--text3)'}}>paid {currency(item.purchasePrice)}</span>
                          )}
                          {item.notes
                            ? <span style={{
                                color:'var(--text)',fontStyle:'italic',
                                overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1,
                              }}>"{item.notes}"</span>
                            : <span style={{color:'var(--text3)',flex:1}}>no notes</span>
                          }
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="modal-footer" style={{justifyContent:'space-between'}}>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button
              className="btn btn-primary"
              disabled={selectedCount === 0}
              onClick={startMerge}
            >
              {selectedCount === 0
                ? 'No groups selected'
                : selectedConflictCount > 0
                  ? `Review ${selectedConflictCount} Conflict${selectedConflictCount !== 1 ? 's' : ''} →`
                  : `Merge ${selectedCount} Group${selectedCount !== 1 ? 's' : ''}`
              }
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Conflict resolution phase ────────────────────────────────────────────
  if (!currentGroup) return null;

  const primaryItem = currentGroup[0];
  const itemLabel   = primaryItem.name || primaryItem.itemNumber || 'Unknown item';
  const condLabel   = CONDITION_LABELS[primaryItem.condition] || primaryItem.condition || '';
  const typeLabel   = itemTypeLabel(primaryItem.type || 'set');

  return (
    <div className="modal-overlay">
      <div className="modal" onClick={e => e.stopPropagation()} style={{maxWidth:560}}>
        <div className="modal-header">
          <h2>Conflicting Notes — {step + 1} of {selectedConflictGroups.length}</h2>
          <button className="btn-icon" onClick={onClose}>{Icons.x}</button>
        </div>

        <div className="modal-body" style={{padding:'16px 20px'}}>

          {/* Item identity */}
          <div style={{marginBottom:16,paddingBottom:14,borderBottom:'1px solid var(--border)'}}>
            <div style={{fontWeight:700,fontSize:15,marginBottom:2}}>{itemLabel}</div>
            <div style={{fontSize:12,color:'var(--text2)'}}>
              {primaryItem.itemNumber && <span style={{marginRight:8}}>{primaryItem.itemNumber}</span>}
              <span style={{marginRight:8}}>{condLabel}</span>
              <span>{typeLabel}</span>
              <span style={{marginLeft:8,color:'var(--text3)'}}>· {currentGroup.length} items to merge</span>
            </div>
          </div>

          {/* Items in group */}
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:600,color:'var(--text2)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:8}}>
              Items in this group
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:5}}>
              {currentGroup.map((item) => (
                <div key={item.id} style={{padding:'8px 10px',background:'var(--surface2)',borderRadius:6,border:'1px solid var(--border)'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:item.notes ? 4 : 0}}>
                    <span style={{fontSize:13,color:'var(--text2)'}}>
                      Qty: <strong style={{color:'var(--text)'}}>{item.quantity || 1}</strong>
                    </span>
                    {item.purchasePrice > 0 && (
                      <span style={{fontSize:11,color:'var(--text3)'}}>paid {currency(item.purchasePrice)}</span>
                    )}
                  </div>
                  {item.notes
                    ? <div style={{fontSize:12,color:'var(--text)',fontStyle:'italic'}}>"{item.notes}"</div>
                    : <div style={{fontSize:12,color:'var(--text3)'}}>No notes</div>
                  }
                </div>
              ))}
            </div>
          </div>

          {/* Note checkboxes */}
          <div>
            <div style={{fontSize:11,fontWeight:600,color:'var(--text2)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:8}}>
              Choose notes to keep
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:12}}>
              {uniqueNotesForCurrent.map(note => (
                <label key={note} style={{
                  display:'flex',alignItems:'flex-start',gap:10,cursor:'pointer',
                  padding:'9px 11px',background:'var(--surface2)',borderRadius:6,
                  border:`1px solid ${checkedNotes[note] ? 'var(--accent)' : 'var(--border)'}`,
                  transition:'border-color .12s',
                }}>
                  <input
                    type="checkbox"
                    checked={!!checkedNotes[note]}
                    onChange={e => handleCheckNote(note, e.target.checked)}
                    style={{marginTop:2,accentColor:'var(--accent)',flexShrink:0,cursor:'pointer'}}
                  />
                  <span style={{fontSize:13,lineHeight:1.4}}>{note}</span>
                </label>
              ))}
            </div>

            <div style={{fontSize:11,fontWeight:600,color:'var(--text2)',marginBottom:5}}>
              Final notes — edit freely
            </div>
            <textarea
              rows={2}
              value={customNote}
              onChange={e => setCustomNote(e.target.value)}
              placeholder="Leave blank for no notes"
              style={{width:'100%',boxSizing:'border-box',resize:'vertical'}}
            />
          </div>
        </div>

        <div className="modal-footer" style={{justifyContent:'space-between'}}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <div style={{display:'flex',gap:8}}>
            <button className="btn btn-secondary" onClick={() => advance(null)}
              title="Leave this group as-is and move on">
              Skip
            </button>
            <button className="btn btn-primary" onClick={() => advance(customNote.trim())}>
              {step + 1 < selectedConflictGroups.length ? 'Merge & Next →' : 'Merge & Finish ✓'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
