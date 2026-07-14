function ConfigPage({ settings, setSettings,
    blConfigured, setBlConfigured,
    catalog, setCatalog,
    colors, setColors, categories, setCategories,
    itemTypes, setItemTypes,
    ebayConfigured, setEbayConfigured,
    bricksetConfigured, setBricksetConfigured }) {

  // ─── BrickLink credentials ───
  const [blFields,     setBlFields]     = React.useState({ consumerKey:'', consumerSecret:'', token:'', tokenSecret:'' });
  const [blSaveStatus, setBlSaveStatus] = React.useState('');
  const [blTestStatus, setBlTestStatus] = React.useState(''); // ''|'testing'|'ok:...'|'error:...'

  // ─── eBay credentials ───
  const [ebayAppId,      setEbayAppId]      = React.useState('');
  const [ebayCertId,     setEbayCertId]     = React.useState('');
  const [ebaySaveStatus, setEbaySaveStatus] = React.useState('');
  const [ebayTestStatus, setEbayTestStatus] = React.useState(''); // ''|'testing'|'ok:...'|'error:...'

  // ─── Brickset credentials ───
  const [bricksetKey,        setBricksetKey]        = React.useState('');
  const [bricksetSaveStatus, setBricksetSaveStatus] = React.useState('');
  const [bricksetTestStatus, setBricksetTestStatus] = React.useState(''); // ''|'testing'|'ok:...'|'error:...'

  const saveBricksetKey = async () => {
    if (!bricksetKey.trim()) { setBricksetSaveStatus('error:Paste your API key first.'); return; }
    setBricksetSaveStatus('saving');
    try {
      const resp = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brickset: { apiKey: bricksetKey.trim() } }),
      });
      const result = await resp.json();
      if (result.ok) {
        setBricksetKey('');
        setBricksetSaveStatus('saved');
        if (setBricksetConfigured) setBricksetConfigured(true);
      } else setBricksetSaveStatus('error:' + (result.error || 'Failed to save.'));
    } catch(e) { setBricksetSaveStatus('error:' + e.message); }
  };

  const testBricksetApi = async () => {
    setBricksetTestStatus('testing');
    try {
      const resp = await fetch('/api/brickset/set?setNumber=75192-1');
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      const price = data.retailPrice != null ? ` — MSRP $${data.retailPrice}` : '';
      setBricksetTestStatus(`ok:✓ Connected — "${data.name || '75192-1'}" found${price}`);
    } catch(e) { setBricksetTestStatus('error:' + e.message); }
  };

  const testBlApi = async () => {
    setBlTestStatus('testing');
    try {
      // Look up a well-known set to verify the API is working
      const resp = await fetch('/api/bricklink/catalog?type=set&itemNumber=75192-1');
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setBlTestStatus(`ok:✓ Connected — "${data.name || '75192-1'}" found`);
    } catch(e) {
      setBlTestStatus('error:' + e.message);
    }
  };

  const testEbayApi = async () => {
    setEbayTestStatus('testing');
    try {
      const resp = await fetch('/api/ebay/price?query=LEGO+75192&limit=3');
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      if (data.count === 0) { setEbayTestStatus('ok:✓ Connected — no listings returned for test query'); return; }
      setEbayTestStatus(`ok:✓ Connected — ${data.count} active listing${data.count !== 1 ? 's' : ''} found, avg $${data.avg?.toFixed(2)}`);
    } catch(e) {
      setEbayTestStatus('error:' + e.message);
    }
  };

  // ─── Per-type catalog state ───
  const [catalogRowStatus, setCatalogRowStatus] = React.useState({}); // key → 'loading'|'ok:...'|'error:...'
  const setsFileInput       = React.useRef(null);
  const minifsFileInput     = React.useRef(null);
  const partsFileInput      = React.useRef(null);
  const colorsFileInput     = React.useRef(null);
  const categoriesFileInput = React.useRef(null);
  const itemTypesFileInput  = React.useRef(null);

  const setRowStatus = (key, val) => setCatalogRowStatus(prev => ({...prev, [key]: val}));

  const handleCatalogRowFile = async (e, key) => {
    const files = [...e.target.files]; if (!files.length) return;
    setRowStatus(key, 'loading');
    try {
      const result = await uploadCatalogFiles(files);
      if (!result.ok) throw new Error(result.errors?.join(', ') || 'Upload failed');
      const { counts, loadedAt } = result;
      setCatalog({ loaded: true, counts, loadedAt });
      const label = key === 'sets' ? `${counts.sets.toLocaleString()} sets`
                  : key === 'minifigs' ? `${counts.minifigs.toLocaleString()} minifigs`
                  : `${counts.parts.toLocaleString()} parts`;
      setRowStatus(key, `ok:${label} loaded`);
      if (result.errors?.length) setRowStatus(key, `ok:${label} loaded — warnings: ${result.errors.join(', ')}`);
    } catch(err) { setRowStatus(key, 'error:' + err.message); }
    e.target.value = '';
  };

  const handleClearCatalog = async () => {
    await clearCatalogServer();
    setCatalog(null);
    setCatalogRowStatus({});
  };

  // ─── Colors upload ───
  const handleColorsFile = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setRowStatus('colors', 'loading');
    try {
      const result = await uploadColorsFile(file);
      if (!result.ok) throw new Error(result.errors?.join(', ') || 'Upload failed');
      setColors({ loaded: true, count: result.count });
      setRowStatus('colors', `ok:${result.count.toLocaleString()} colors loaded`);
    } catch(err) { setRowStatus('colors', 'error:' + err.message); }
    e.target.value = '';
  };

  // ─── Categories upload ───
  const handleCategoriesFile = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setRowStatus('categories', 'loading');
    try {
      const result = await uploadCategoriesFile(file);
      if (!result.ok) throw new Error(result.errors?.join(', ') || 'Upload failed');
      setCategories({ loaded: true, count: result.count });
      setRowStatus('categories', `ok:${result.count.toLocaleString()} categories loaded`);
    } catch(err) { setRowStatus('categories', 'error:' + err.message); }
    e.target.value = '';
  };

  // ─── Item Types upload ───
  const handleItemTypesFile = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setRowStatus('itemTypes', 'loading');
    try {
      const fd = new FormData(); fd.append('files', file);
      const resp = await fetch('/api/itemtypes/upload', { method: 'POST', body: fd });
      if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
      const result = await resp.json();
      if (!result.ok) throw new Error(result.errors?.join(', ') || 'Upload failed');
      if (setItemTypes) setItemTypes({ loaded: true, count: result.count });
      setRowStatus('itemTypes', `ok:${result.count.toLocaleString()} item types loaded`);
    } catch(err) { setRowStatus('itemTypes', 'error:' + err.message); }
    e.target.value = '';
  };

  const saveEbayCredentials = async () => {
    if (!ebayAppId.trim() || !ebayCertId.trim()) { setEbaySaveStatus('error:Paste both your App ID and Cert ID first.'); return; }
    setEbaySaveStatus('saving');
    try {
      const resp = await fetch('/api/config/ebay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: ebayAppId.trim(), certId: ebayCertId.trim() }),
      });
      const result = await resp.json();
      if (result.ok) {
        if (setEbayConfigured) setEbayConfigured(true);
        setEbayAppId('');
        setEbayCertId('');
        setEbaySaveStatus('saved');
      } else {
        setEbaySaveStatus('error:' + (result.error || 'Failed to save eBay credentials.'));
      }
    } catch(e) {
      setEbaySaveStatus('error:' + e.message);
    }
  };

  const saveBlCredentials = async () => {
    const vals = Object.values(blFields).map(v => v.trim());
    if (vals.some(v => !v)) { setBlSaveStatus('error:Fill in all four fields before saving.'); return; }
    setBlSaveStatus('saving');
    try {
      const resp = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bricklink: blFields }),
      });
      const result = await resp.json();
      if (result.ok) {
        setBlConfigured(result.configured);
        setBlFields({ consumerKey:'', consumerSecret:'', token:'', tokenSecret:'' });
        setBlSaveStatus('saved');
      } else {
        setBlSaveStatus('error:Failed to save credentials.');
      }
    } catch(e) {
      setBlSaveStatus('error:' + e.message);
    }
  };

  return (
    <>
      <div className="header"><h1>Configuration</h1></div>

      {/* Rebrickable */}
      <div className="stat-card" style={{marginBottom:20}}>
        <div className="label" style={{marginBottom:12}}>Rebrickable API</div>
        <div style={{fontSize:13,color:'var(--text2)',marginBottom:12,lineHeight:1.6}}>
          Rebrickable integration is not currently active. Your API key is saved here for future use.
          Get a free key at{' '}
          <a href="https://rebrickable.com/api/" target="_blank" rel="noopener" style={{color:'var(--accent)'}}>rebrickable.com/api</a>.
        </div>
        <div style={{display:'flex',gap:10,alignItems:'center'}}>
          <input className="search-box" style={{maxWidth:400}} type="text" placeholder="Paste your Rebrickable API key here..."
            value={settings.rebrickableKey||''}
            onChange={e => setSettings(s => ({...s, rebrickableKey: e.target.value.trim()}))} />
          {settings.rebrickableKey && <span style={{color:'var(--text2)',fontSize:12}}>Saved</span>}
        </div>
      </div>

      {/* Brickset API */}
      <div className="stat-card" style={{marginBottom:20}}>
        <div className="label" style={{marginBottom:12}}>Brickset API</div>
        <div style={{fontSize:13,color:'var(--text2)',marginBottom:14,lineHeight:1.6}}>
          Used to look up retail prices (MSRP) for sets. Get a free API key at{' '}
          <a href="https://brickset.com/tools/webservices/requestkey" target="_blank" rel="noopener" style={{color:'var(--accent)'}}>
            brickset.com → Tools → Web Services
          </a>.
        </div>
        {bricksetConfigured ? (
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
              <p style={{fontSize:13,color:'var(--green)',fontWeight:600}}>✓ API key saved — retail price lookup is active.</p>
              <button className="btn btn-secondary btn-sm" onClick={() => { setBricksetConfigured(false); setBricksetSaveStatus(''); setBricksetTestStatus(''); }}>
                Replace Key
              </button>
              <button className="btn btn-secondary btn-sm" onClick={testBricksetApi} disabled={bricksetTestStatus==='testing'}>
                {bricksetTestStatus==='testing' ? 'Testing…' : '🔌 Test Connection'}
              </button>
            </div>
            {bricksetTestStatus.startsWith('ok:')    && <span style={{fontSize:12,color:'var(--green)'}}>{bricksetTestStatus.slice(3)}</span>}
            {bricksetTestStatus.startsWith('error:') && <span style={{fontSize:12,color:'var(--red)'}}>{bricksetTestStatus.slice(6)}</span>}
          </div>
        ) : (
          <>
            <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',marginBottom:10}}>
              <input className="search-box" style={{maxWidth:400}} type="password" placeholder="Paste your Brickset API key…"
                value={bricksetKey}
                onChange={e => setBricksetKey(e.target.value)} />
              <button className="btn btn-primary" onClick={saveBricksetKey} disabled={bricksetSaveStatus==='saving'}>
                {bricksetSaveStatus==='saving' ? 'Saving…' : '💾 Save Key'}
              </button>
            </div>
            {bricksetSaveStatus === 'saved'          && <span style={{fontSize:12,color:'var(--green)',fontWeight:600}}>✓ Saved!</span>}
            {bricksetSaveStatus.startsWith('error:') && <span style={{fontSize:12,color:'var(--red)'}}>{bricksetSaveStatus.slice(6)}</span>}
          </>
        )}
      </div>

      {/* BrickLink API */}
      <div className="stat-card" style={{marginBottom:20}}>
        <div className="label" style={{marginBottom:12}}>BrickLink API</div>
        <div style={{fontSize:13,color:'var(--text2)',marginBottom:14,lineHeight:1.6}}>
          Used to look up item names, images, and themes directly from BrickLink.
          Credentials are saved to <code style={{background:'var(--surface2)',padding:'1px 5px',borderRadius:4}}>brickvault-config.json</code> on your computer — you only need to enter them once.
          Generate them at{' '}
          <a href="https://www.bricklink.com/v2/api/register_consumer.page" target="_blank" rel="noopener" style={{color:'var(--accent)'}}>
            bricklink.com → My BrickLink → API Settings
          </a>.
        </div>

        {blConfigured ? (
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
              <p style={{fontSize:13,color:'var(--green)',fontWeight:600}}>✓ Credentials saved — item lookup is active.</p>
              <button className="btn btn-secondary btn-sm" onClick={() => { setBlConfigured(false); setBlSaveStatus(''); setBlTestStatus(''); }}>
                Replace Credentials
              </button>
              <button className="btn btn-secondary btn-sm" onClick={testBlApi} disabled={blTestStatus==='testing'}>
                {blTestStatus==='testing' ? 'Testing…' : '🔌 Test Connection'}
              </button>
            </div>
            {blTestStatus.startsWith('ok:')    && <span style={{fontSize:12,color:'var(--green)'}}>{blTestStatus.slice(3)}</span>}
            {blTestStatus.startsWith('error:') && <span style={{fontSize:12,color:'var(--red)'}}>{blTestStatus.slice(6)}</span>}
          </div>
        ) : (
          <>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
              {[
                ['consumerKey',    'Consumer Key'],
                ['consumerSecret', 'Consumer Secret'],
                ['token',          'Token (Access Token)'],
                ['tokenSecret',    'Token Secret'],
              ].map(([key, label]) => (
                <div key={key} style={{marginBottom:0}}>
                  <label style={{fontSize:11,fontWeight:600,color:'var(--text2)',display:'block',marginBottom:4,textTransform:'uppercase',letterSpacing:'.5px'}}>{label}</label>
                  <input className="search-box" style={{width:'100%'}} type="password"
                    placeholder={`Paste ${label}...`}
                    value={blFields[key]}
                    onChange={e => setBlFields(f => ({...f, [key]: e.target.value}))} />
                </div>
              ))}
            </div>
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              <button className="btn btn-primary" onClick={saveBlCredentials}
                disabled={blSaveStatus==='saving'}>
                {blSaveStatus==='saving' ? 'Saving...' : '💾 Save Credentials'}
              </button>
              {blSaveStatus === 'saved' && <span style={{fontSize:12,color:'var(--green)',fontWeight:600}}>✓ Saved!</span>}
              {blSaveStatus.startsWith('error:') && <span style={{fontSize:12,color:'var(--red)'}}>{blSaveStatus.slice(6)}</span>}
            </div>
          </>
        )}
      </div>

      {/* eBay API */}
      <div className="stat-card" style={{marginBottom:20}}>
        <div className="label" style={{marginBottom:12}}>eBay API</div>
        <div style={{fontSize:13,color:'var(--text2)',marginBottom:14,lineHeight:1.6}}>
          Used to fetch active listing prices from eBay for items in your inventory.
          Get credentials at{' '}
          <a href="https://developer.ebay.com/my/keys" target="_blank" rel="noopener" style={{color:'var(--accent)'}}>
            developer.ebay.com → My Account → Application Keys
          </a>.
          Create a <strong>Production</strong> keyset and copy both the <strong>App ID (Client ID)</strong> and the <strong>Cert ID (Client Secret)</strong>.
        </div>
        {ebayConfigured ? (
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
              <p style={{fontSize:13,color:'var(--green)',fontWeight:600}}>✓ eBay credentials saved — price lookup is active.</p>
              <button className="btn btn-secondary btn-sm" onClick={() => { if(setEbayConfigured) setEbayConfigured(false); setEbaySaveStatus(''); setEbayTestStatus(''); }}>
                Replace Credentials
              </button>
              <button className="btn btn-secondary btn-sm" onClick={testEbayApi} disabled={ebayTestStatus==='testing'}>
                {ebayTestStatus==='testing' ? 'Testing…' : '🔌 Test Connection'}
              </button>
            </div>
            {ebayTestStatus.startsWith('ok:')    && <span style={{fontSize:12,color:'var(--green)'}}>{ebayTestStatus.slice(3)}</span>}
            {ebayTestStatus.startsWith('error:') && <span style={{fontSize:12,color:'var(--red)'}}>{ebayTestStatus.slice(6)}</span>}
          </div>
        ) : (
          <>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
              <div>
                <label style={{fontSize:11,fontWeight:600,color:'var(--text2)',display:'block',marginBottom:4,textTransform:'uppercase',letterSpacing:'.5px'}}>App ID (Client ID)</label>
                <input className="search-box" style={{width:'100%'}} type="password"
                  placeholder="Paste App ID…"
                  value={ebayAppId}
                  onChange={e => setEbayAppId(e.target.value)} />
              </div>
              <div>
                <label style={{fontSize:11,fontWeight:600,color:'var(--text2)',display:'block',marginBottom:4,textTransform:'uppercase',letterSpacing:'.5px'}}>Cert ID (Client Secret)</label>
                <input className="search-box" style={{width:'100%'}} type="password"
                  placeholder="Paste Cert ID…"
                  value={ebayCertId}
                  onChange={e => setEbayCertId(e.target.value)} />
              </div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              <button className="btn btn-primary" onClick={saveEbayCredentials}
                disabled={ebaySaveStatus==='saving'}>
                {ebaySaveStatus==='saving' ? 'Saving...' : '💾 Save Credentials'}
              </button>
              {ebaySaveStatus === 'saved' && <span style={{fontSize:12,color:'var(--green)',fontWeight:600}}>✓ Saved!</span>}
              {ebaySaveStatus.startsWith('error:') && <span style={{fontSize:12,color:'var(--red)'}}>{ebaySaveStatus.slice(6)}</span>}
            </div>
          </>
        )}
      </div>

      {/* Selling Platforms */}
      {(() => {
        const DEFAULT_PLATFORMS = [
          { id: 'bricklink', name: 'BrickLink',    pctFee: 3,    flatFee: 0   },
          { id: 'ebay',      name: 'eBay',         pctFee: 13.25, flatFee: 0.30 },
          { id: 'facebook',  name: 'Facebook',     pctFee: 5,    flatFee: 0   },
          { id: 'reddit',    name: 'Reddit',       pctFee: 0,    flatFee: 0   },
          { id: 'private',   name: 'Private Sale', pctFee: 0,    flatFee: 0   },
        ];

        const platforms = settings?.platforms || DEFAULT_PLATFORMS;
        const dragOver  = React.useRef(null);

        const updatePlatform = (id, key, val) => {
          setSettings(s => ({
            ...s,
            platforms: (s.platforms || DEFAULT_PLATFORMS).map(p =>
              p.id === id ? { ...p, [key]: val } : p
            ),
          }));
        };

        const addPlatform = () => {
          const newId = 'custom_' + Date.now();
          setSettings(s => ({
            ...s,
            platforms: [...(s.platforms || DEFAULT_PLATFORMS), { id: newId, name: '', pctFee: 0, flatFee: 0 }],
          }));
        };

        const removePlatform = (id) => {
          setSettings(s => ({
            ...s,
            platforms: (s.platforms || DEFAULT_PLATFORMS).filter(p => p.id !== id),
          }));
        };

        const resetPlatforms = () => {
          setSettings(s => ({ ...s, platforms: DEFAULT_PLATFORMS }));
        };

        const handleDragStart = (e, id) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', id);
        };

        const handleDragOver = (e, id) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          dragOver.current = id;
        };

        const handleDrop = (e, targetId) => {
          e.preventDefault();
          const draggedId = e.dataTransfer.getData('text/plain');
          if (!draggedId || draggedId === targetId) return;
          setSettings(s => {
            const list = [...(s.platforms || DEFAULT_PLATFORMS)];
            const fromIdx = list.findIndex(p => p.id === draggedId);
            const toIdx   = list.findIndex(p => p.id === targetId);
            if (fromIdx < 0 || toIdx < 0) return s;
            const [moved] = list.splice(fromIdx, 1);
            list.splice(toIdx, 0, moved);
            return { ...s, platforms: list };
          });
          dragOver.current = null;
        };

        return (
          <div className="stat-card" style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div className="label" style={{ marginBottom: 0 }}>Selling Platforms</div>
              <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={resetPlatforms}>Reset to Defaults</button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16, lineHeight: 1.6 }}>
              Fee rates used when projecting profit. Percentage fee applies to the sale price; flat fee is charged per transaction.
            </p>

            {/* Header */}
            <div style={{ display: 'grid', gridTemplateColumns: '20px 1fr 110px 110px 32px', gap: 8, alignItems: 'center', padding: '0 0 6px', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
              <div />
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Platform</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.5px', textAlign: 'right' }}>Fee %</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '.5px', textAlign: 'right' }}>Flat Fee ($)</div>
              <div />
            </div>

            {platforms.map((p, i) => (
              <div
                key={p.id}
                draggable
                onDragStart={e => handleDragStart(e, p.id)}
                onDragOver={e => handleDragOver(e, p.id)}
                onDrop={e => handleDrop(e, p.id)}
                style={{ display: 'grid', gridTemplateColumns: '20px 1fr 110px 110px 32px', gap: 8, alignItems: 'center', padding: '7px 0', borderBottom: i < platforms.length - 1 ? '1px solid var(--border)' : undefined }}>
                {/* Drag handle */}
                <div style={{ cursor: 'grab', color: 'var(--text3)', fontSize: 14, textAlign: 'center', userSelect: 'none' }} title="Drag to reorder">⠿</div>
                <input
                  className="search-box"
                  style={{ padding: '6px 10px', fontSize: 13, minWidth: 0 }}
                  placeholder="Platform name"
                  value={p.name}
                  onChange={e => updatePlatform(p.id, 'name', e.target.value)} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                  <input
                    type="number" min="0" max="100" step="0.01"
                    className="search-box"
                    style={{ padding: '6px 6px', fontSize: 13, textAlign: 'right', minWidth: 0, width: '100%' }}
                    defaultValue={p.pctFee}
                    key={`pct-${p.id}`}
                    onBlur={e => updatePlatform(p.id, 'pctFee', parseFloat(e.target.value) || 0)} />
                  <span style={{ fontSize: 13, color: 'var(--text2)', flexShrink: 0 }}>%</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                  <span style={{ fontSize: 13, color: 'var(--text2)', flexShrink: 0 }}>$</span>
                  <input
                    type="number" min="0" step="0.01"
                    className="search-box"
                    style={{ padding: '6px 6px', fontSize: 13, textAlign: 'right', minWidth: 0, width: '100%' }}
                    defaultValue={p.flatFee}
                    key={`flat-${p.id}`}
                    onBlur={e => updatePlatform(p.id, 'flatFee', parseFloat(e.target.value) || 0)} />
                </div>
                <button
                  className="btn-icon"
                  title="Remove platform"
                  style={{ width: 28, height: 28, flexShrink: 0 }}
                  onClick={() => removePlatform(p.id)}>
                  {Icons.x}
                </button>
              </div>
            ))}

            <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={addPlatform}>
              + Add Platform
            </button>
          </div>
        );
      })()}

      {/* Reddit Post Template */}
      {(() => {
        const DEFAULT_REDDIT = {
          titlePrefix:  '[S] [US]',
          titleSuffix:  '[W] PayPal',
          openingLine:  'For sale — prices include PayPal G&S fees. Buyer pays shipping.',
          closingLine:  'Comment or DM to purchase. Not looking for trades at this time.',
        };
        const reddit = { ...DEFAULT_REDDIT, ...(settings?.redditTemplate || {}) };
        const update = (key, val) => setSettings(s => ({
          ...s,
          redditTemplate: { ...(s.redditTemplate || DEFAULT_REDDIT), [key]: val },
        }));
        const previewItems = 'Millennium Falcon, Death Star';
        const previewPrefix = reddit.titlePrefix ? `${reddit.titlePrefix} ` : '';
        const previewSuffix = reddit.titleSuffix ? ` ${reddit.titleSuffix}` : '';
        const titlePreview  = `${previewPrefix}[H] ${previewItems}${previewSuffix}`;
        return (
          <div className="stat-card" style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div className="label" style={{ marginBottom: 0 }}>Reddit Post Template</div>
              <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }}
                onClick={() => setSettings(s => ({ ...s, redditTemplate: DEFAULT_REDDIT }))}>
                Reset to Defaults
              </button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16, lineHeight: 1.6 }}>
              Customize the text used when generating a r/legomarket selling post from the Selling page.
              The <code style={{ background: 'var(--surface2)', padding: '1px 4px', borderRadius: 3 }}>[H]</code> tag and item names are always inserted between the prefix and suffix.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.5px' }}>Title Prefix</label>
                  <input className="search-box" style={{ width: '100%' }}
                    placeholder="[S] [US]"
                    value={reddit.titlePrefix}
                    onChange={e => update('titlePrefix', e.target.value)} />
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.5px' }}>Title Suffix</label>
                  <input className="search-box" style={{ width: '100%' }}
                    placeholder="[W] PayPal"
                    value={reddit.titleSuffix}
                    onChange={e => update('titleSuffix', e.target.value)} />
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                Preview: <code style={{ background: 'var(--surface2)', padding: '1px 4px', borderRadius: 3 }}>{titlePreview}</code>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.5px' }}>Opening Line</label>
                <input className="search-box" style={{ width: '100%' }}
                  placeholder="For sale — prices include PayPal G&S fees. Buyer pays shipping."
                  value={reddit.openingLine}
                  onChange={e => update('openingLine', e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.5px' }}>Closing Line</label>
                <input className="search-box" style={{ width: '100%' }}
                  placeholder="Comment or DM to purchase. Not looking for trades at this time."
                  value={reddit.closingLine}
                  onChange={e => update('closingLine', e.target.value)} />
              </div>
            </div>
          </div>
        );
      })()}

      {/* BrickLink Catalog */}
      <div className="stat-card" style={{marginBottom:20}}>
        <div className="label" style={{marginBottom:12}}>BrickLink Catalog</div>
        <div style={{fontSize:13,color:'var(--text2)',marginBottom:16,lineHeight:1.6}}>
          Load local copies of the BrickLink catalog files to make batch fetches instant — no API calls needed for names and themes.
          Download XML files from{' '}
          <a href="https://www.bricklink.com/catalogDownload.asp" target="_blank" rel="noopener" style={{color:'var(--accent)'}}>
            bricklink.com → Catalog → Download
          </a>{' '}
          (free, no login required).
        </div>

        {/* Catalog rows */}
        {[
          { key: 'sets',       label: 'Sets',       ref: setsFileInput,       count: catalog?.counts?.sets,     loaded: (catalog?.counts?.sets     || 0) > 0 },
          { key: 'minifigs',   label: 'Minifigs',   ref: minifsFileInput,     count: catalog?.counts?.minifigs, loaded: (catalog?.counts?.minifigs || 0) > 0 },
          { key: 'parts',      label: 'Parts',      ref: partsFileInput,      count: catalog?.counts?.parts,    loaded: (catalog?.counts?.parts    || 0) > 0 },
          { key: 'colors',     label: 'Colors',     ref: colorsFileInput,     count: colors?.count,             loaded: colors?.loaded },
          { key: 'categories', label: 'Categories', ref: categoriesFileInput, count: categories?.count,         loaded: categories?.loaded },
          { key: 'itemTypes',  label: 'Item Types', ref: itemTypesFileInput,  count: itemTypes?.count,          loaded: itemTypes?.loaded },
        ].map(({ key, label, ref, count, loaded }, i, arr) => {
          const st = catalogRowStatus[key] || '';
          return (
            <div key={key} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 0',borderTop: i > 0 ? '1px solid var(--border)' : undefined,flexWrap:'wrap'}}>
              <div style={{width:90,fontSize:13,fontWeight:600,color:'var(--text2)',flexShrink:0}}>{label}</div>
              <div style={{flex:1,fontSize:13}}>
                {loaded
                  ? <span style={{color:'var(--green)',fontWeight:600}}>✓ {count?.toLocaleString()} loaded</span>
                  : <span style={{color:'var(--text2)'}}>Not loaded</span>}
                {st === 'loading' && <span style={{color:'var(--text2)',marginLeft:8,fontSize:12}}>Parsing…</span>}
                {st.startsWith('ok:')    && <span style={{color:'var(--green)',marginLeft:8,fontSize:12}}>{st.slice(3)}</span>}
                {st.startsWith('error:') && <span style={{color:'var(--red)',  marginLeft:8,fontSize:12}}>{st.slice(6)}</span>}
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => ref.current.click()}>
                {loaded ? 'Replace' : '📂 Import'}
              </button>
              {loaded && (key === 'sets' || key === 'minifigs' || key === 'parts') && (
                <button className="btn btn-secondary btn-sm" onClick={handleClearCatalog}>Clear All</button>
              )}
              {loaded && key === 'colors' && (
                <button className="btn btn-secondary btn-sm" onClick={async () => { await clearColorsServer(); setColors(null); setRowStatus('colors',''); }}>Clear</button>
              )}
              {loaded && key === 'categories' && (
                <button className="btn btn-secondary btn-sm" onClick={async () => { await clearCategoriesServer(); setCategories(null); setRowStatus('categories',''); }}>Clear</button>
              )}
              {loaded && key === 'itemTypes' && (
                <button className="btn btn-secondary btn-sm" onClick={async () => { await fetch('/api/itemtypes/clear',{method:'POST'}); if(setItemTypes) setItemTypes(null); setRowStatus('itemTypes',''); }}>Clear</button>
              )}
            </div>
          );
        })}

        <input ref={setsFileInput}       type="file" accept=".xml" style={{display:'none'}} onChange={e => handleCatalogRowFile(e, 'sets')} />
        <input ref={minifsFileInput}     type="file" accept=".xml" style={{display:'none'}} onChange={e => handleCatalogRowFile(e, 'minifigs')} />
        <input ref={partsFileInput}      type="file" accept=".xml" style={{display:'none'}} onChange={e => handleCatalogRowFile(e, 'parts')} />
        <input ref={colorsFileInput}     type="file" accept=".xml" style={{display:'none'}} onChange={handleColorsFile} />
        <input ref={categoriesFileInput} type="file" accept=".xml" style={{display:'none'}} onChange={handleCategoriesFile} />
        <input ref={itemTypesFileInput}  type="file" accept=".xml" style={{display:'none'}} onChange={handleItemTypesFile} />
      </div>

    </>
  );
}
