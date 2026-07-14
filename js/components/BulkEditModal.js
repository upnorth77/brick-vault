// ─── Bulk Edit Modal ───
// Lets the user filter items by any combination of type/theme/condition/status/search
// then set one or more fields on all matching items at once.

function BulkEditModal({ allItems, updateItems, onClose }) {

  // ── Filter state ──
  const [filterType,      setFilterType]      = React.useState('all');
  const [filterTheme,     setFilterTheme]      = React.useState('all');
  const [filterCondition, setFilterCondition]  = React.useState('all');
  const [filterStatus,    setFilterStatus]     = React.useState('all');
  const [filterSearch,    setFilterSearch]     = React.useState('');

  // ── Update fields state ──
  // Each field can be toggled on/off independently
  const [setCondition, setSetCondition] = React.useState(false);
  const [newCondition, setNewCondition] = React.useState('new_sealed');
  const [setStatus,    setSetStatus]    = React.useState(false);
  const [newStatus,    setNewStatus]    = React.useState('available');
  const [setTheme,     setSetTheme]     = React.useState(false);
  const [newTheme,     setNewTheme]     = React.useState('');
  const [setNotes,     setSetNotes]     = React.useState(false);
  const [notesMode,    setNotesMode]    = React.useState('replace'); // replace | append
  const [newNotes,     setNewNotes]     = React.useState('');

  const [confirmed,    setConfirmed]    = React.useState(false);
  const [done,         setDone]         = React.useState(false);

  // ── Derived options from non-sold items ──
  const activeItems = React.useMemo(() => (allItems || []).filter(i => i.sellStatus !== 'sold'), [allItems]);
  const themeOptions = React.useMemo(() => [...new Set(activeItems.map(i => i.theme || '').filter(Boolean))].sort(), [activeItems]);

  // ── Items matching current filters ──
  const matchingItems = React.useMemo(() => {
    const q = filterSearch.trim().toLowerCase();
    return activeItems.filter(item => {
      if (filterType !== 'all' && item.type !== filterType) return false;
      if (filterTheme !== 'all' && (item.theme || '') !== filterTheme) return false;
      if (filterCondition !== 'all' && (item.condition || '') !== filterCondition) return false;
      if (filterStatus !== 'all' && (item.sellStatus || 'available') !== filterStatus) return false;
      if (q) {
        const match =
          (item.name || '').toLowerCase().includes(q) ||
          (item.itemNumber || '').toLowerCase().includes(q) ||
          (item.theme || '').toLowerCase().includes(q) ||
          (item.notes || '').toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [activeItems, filterType, filterTheme, filterCondition, filterStatus, filterSearch]);

  // ── Validation: at least one field must be set ──
  const anyFieldEnabled = setCondition || setStatus || setTheme || setNotes;

  const applyChanges = () => {
    const ids = new Set(matchingItems.map(i => i.id));
    const now = new Date().toISOString();
    updateItems(prev => prev.map(item => {
      if (!ids.has(item.id)) return item;
      const updates = { updatedAt: now };
      if (setCondition) updates.condition = newCondition;
      if (setStatus)    updates.sellStatus = newStatus;
      if (setTheme)     updates.theme = newTheme;
      if (setNotes) {
        if (notesMode === 'append') {
          updates.notes = [item.notes, newNotes].filter(Boolean).join(' ');
        } else {
          updates.notes = newNotes;
        }
      }
      return { ...item, ...updates };
    }));
    setDone(true);
  };

  const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 4, display: 'block' };
  const sectionStyle = { marginBottom: 16 };
  const rowStyle = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 };
  const checkboxLabelStyle = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', userSelect: 'none' };

  if (done) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <div className="modal-title">Bulk Edit Complete</div>
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
          <div style={{ padding: '24px 24px 8px', textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
              Updated {matchingItems.length} item{matchingItems.length !== 1 ? 's' : ''}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 24 }}>Changes have been saved.</div>
            <button className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">Bulk Edit Inventory</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: '0 24px 24px' }}>

          {/* ── Step 1: Filters ── */}
          <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12, marginTop: 20 }}>
              Step 1 — Filter items to update
            </div>

            <div style={sectionStyle}>
              <label style={labelStyle}>Type</label>
              <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ fontSize: 13, padding: '5px 8px', minWidth: 140 }}>
                <option value="all">All types</option>
                <option value="set">Set</option>
                <option value="minifig">Minifig</option>
                <option value="part">Part</option>
                <option value="gear">Gear</option>
                <option value="book">Book</option>
              </select>
            </div>

            <div style={sectionStyle}>
              <label style={labelStyle}>Theme</label>
              <select value={filterTheme} onChange={e => setFilterTheme(e.target.value)} style={{ fontSize: 13, padding: '5px 8px', minWidth: 200 }}>
                <option value="all">All themes</option>
                {themeOptions.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div style={sectionStyle}>
              <label style={labelStyle}>Condition</label>
              <select value={filterCondition} onChange={e => setFilterCondition(e.target.value)} style={{ fontSize: 13, padding: '5px 8px', minWidth: 200 }}>
                <option value="all">All conditions</option>
                {Object.entries(CONDITION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>

            <div style={sectionStyle}>
              <label style={labelStyle}>Status</label>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ fontSize: 13, padding: '5px 8px', minWidth: 200 }}>
                <option value="all">All statuses</option>
                <option value="available">Available</option>
                <option value="listed">Listed</option>
              </select>
            </div>

            <div style={sectionStyle}>
              <label style={labelStyle}>Name / Item # search</label>
              <input
                placeholder="e.g. Luke Skywalker, 7140, Star Wars…"
                value={filterSearch}
                onChange={e => setFilterSearch(e.target.value)}
                style={{ fontSize: 13, padding: '5px 10px', width: '100%', boxSizing: 'border-box' }}
              />
            </div>

            {/* Match preview */}
            <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--surface2)', borderRadius: 6, fontSize: 12, color: matchingItems.length ? 'var(--text)' : 'var(--text3)' }}>
              {matchingItems.length === 0
                ? 'No items match the current filters.'
                : <><span style={{ fontWeight: 700, color: 'var(--accent)' }}>{matchingItems.length}</span> item{matchingItems.length !== 1 ? 's' : ''} match{matchingItems.length === 1 ? 'es' : ''} — these will be updated.</>}
              {matchingItems.length > 0 && matchingItems.length <= 5 && (
                <ul style={{ margin: '6px 0 0', padding: '0 0 0 16px', color: 'var(--text2)' }}>
                  {matchingItems.map(i => <li key={i.id}>{i.name || i.itemNumber || i.id}</li>)}
                </ul>
              )}
              {matchingItems.length > 5 && (
                <div style={{ marginTop: 4, color: 'var(--text2)' }}>
                  e.g. {matchingItems.slice(0, 3).map(i => i.name || i.itemNumber).join(', ')}…
                </div>
              )}
            </div>
          </div>

          {/* ── Step 2: Fields to set ── */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>
              Step 2 — Choose fields to update
            </div>

            {/* Condition */}
            <div style={{ ...sectionStyle, padding: '10px 12px', background: setCondition ? 'rgba(76,140,231,.08)' : 'var(--surface2)', borderRadius: 8, border: `1px solid ${setCondition ? 'var(--blue)' : 'transparent'}` }}>
              <label style={checkboxLabelStyle}>
                <input type="checkbox" checked={setCondition} onChange={e => setSetCondition(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
                <span style={{ fontWeight: 600 }}>Set condition</span>
              </label>
              {setCondition && (
                <div style={{ marginTop: 8 }}>
                  <select value={newCondition} onChange={e => setNewCondition(e.target.value)} style={{ fontSize: 13, padding: '5px 8px', minWidth: 200 }}>
                    {Object.entries(CONDITION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              )}
            </div>

            {/* Status */}
            <div style={{ ...sectionStyle, padding: '10px 12px', background: setStatus ? 'rgba(76,140,231,.08)' : 'var(--surface2)', borderRadius: 8, border: `1px solid ${setStatus ? 'var(--blue)' : 'transparent'}` }}>
              <label style={checkboxLabelStyle}>
                <input type="checkbox" checked={setStatus} onChange={e => setSetStatus(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
                <span style={{ fontWeight: 600 }}>Set sell status</span>
              </label>
              {setStatus && (
                <div style={{ marginTop: 8 }}>
                  <select value={newStatus} onChange={e => setNewStatus(e.target.value)} style={{ fontSize: 13, padding: '5px 8px', minWidth: 200 }}>
                    <option value="available">Available</option>
                    <option value="listed">Listed</option>
                  </select>
                </div>
              )}
            </div>

            {/* Theme */}
            <div style={{ ...sectionStyle, padding: '10px 12px', background: setTheme ? 'rgba(76,140,231,.08)' : 'var(--surface2)', borderRadius: 8, border: `1px solid ${setTheme ? 'var(--blue)' : 'transparent'}` }}>
              <label style={checkboxLabelStyle}>
                <input type="checkbox" checked={setTheme} onChange={e => setSetTheme(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
                <span style={{ fontWeight: 600 }}>Set theme</span>
              </label>
              {setTheme && (
                <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    list="bulk-theme-options"
                    value={newTheme}
                    onChange={e => setNewTheme(e.target.value)}
                    placeholder="e.g. Star Wars"
                    style={{ fontSize: 13, padding: '5px 10px', width: 200 }}
                  />
                  <datalist id="bulk-theme-options">
                    {themeOptions.map(t => <option key={t} value={t} />)}
                  </datalist>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>Leave blank to clear theme</span>
                </div>
              )}
            </div>

            {/* Notes */}
            <div style={{ ...sectionStyle, padding: '10px 12px', background: setNotes ? 'rgba(76,140,231,.08)' : 'var(--surface2)', borderRadius: 8, border: `1px solid ${setNotes ? 'var(--blue)' : 'transparent'}` }}>
              <label style={checkboxLabelStyle}>
                <input type="checkbox" checked={setNotes} onChange={e => setSetNotes(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
                <span style={{ fontWeight: 600 }}>Update notes</span>
              </label>
              {setNotes && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: 'flex', gap: 12, marginBottom: 6 }}>
                    <label style={{ ...checkboxLabelStyle, fontSize: 12 }}>
                      <input type="radio" name="notesMode" value="replace" checked={notesMode === 'replace'} onChange={() => setNotesMode('replace')} />
                      Replace
                    </label>
                    <label style={{ ...checkboxLabelStyle, fontSize: 12 }}>
                      <input type="radio" name="notesMode" value="append" checked={notesMode === 'append'} onChange={() => setNotesMode('append')} />
                      Append
                    </label>
                  </div>
                  <input
                    value={newNotes}
                    onChange={e => setNewNotes(e.target.value)}
                    placeholder={notesMode === 'append' ? 'Text to add to existing notes…' : 'New notes text (blank to clear)…'}
                    style={{ fontSize: 13, padding: '5px 10px', width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* ── Confirm ── */}
          {!confirmed ? (
            <button
              className="btn btn-primary"
              style={{ width: '100%' }}
              disabled={matchingItems.length === 0 || !anyFieldEnabled}
              onClick={() => setConfirmed(true)}>
              Preview & Confirm ({matchingItems.length} item{matchingItems.length !== 1 ? 's' : ''})
            </button>
          ) : (
            <div style={{ background: 'rgba(231,76,76,.1)', border: '1px solid var(--red)', borderRadius: 8, padding: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--red)', marginBottom: 6 }}>Confirm bulk update</div>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 12 }}>
                This will update <strong>{matchingItems.length} item{matchingItems.length !== 1 ? 's' : ''}</strong>:
                {setCondition && <div>· Condition → <strong>{CONDITION_LABELS[newCondition]}</strong></div>}
                {setStatus    && <div>· Sell status → <strong>{newStatus}</strong></div>}
                {setTheme     && <div>· Theme → <strong>{newTheme || '(cleared)'}</strong></div>}
                {setNotes     && <div>· Notes → <strong>{notesMode === 'append' ? `append "${newNotes}"` : (newNotes || '(cleared)')}</strong></div>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-danger" style={{ flex: 1 }} onClick={applyChanges}>Apply Changes</button>
                <button className="btn btn-secondary" onClick={() => setConfirmed(false)}>Go Back</button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
