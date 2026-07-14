function AnalyticsPage({ items, stats }) {
  const byTheme = React.useMemo(() => {
    const map = {};
    items.forEach(i => {
      const t = i.theme || 'Unthemed';
      if (!map[t]) map[t] = { count:0, value:0, cost:0 };
      map[t].count += (i.quantity||1);
      map[t].value += (i.estimatedValue||0) * (i.quantity||1);
      map[t].cost  += (i.purchasePrice||0)  * (i.quantity||1);
    });
    return Object.entries(map).sort((a,b) => b[1].value - a[1].value);
  }, [items]);

  const topItems = React.useMemo(() =>
    [...items].sort((a,b) => (b.estimatedValue||0) - (a.estimatedValue||0)).slice(0,10),
  [items]);

  const recentSales = React.useMemo(() =>
    items.filter(i => i.sellStatus==='sold')
      .sort((a,b) => (b.updatedAt||'').localeCompare(a.updatedAt||''))
      .slice(0,10),
  [items]);

  return (
    <>
      <div className="header"><h1>Analytics</h1></div>

      <div className="stats-row">
        <div className="stat-card"><div className="label">Collection Value</div><div className="value accent">{currency(stats.totalValue)}</div></div>
        <div className="stat-card"><div className="label">Total Invested</div><div className="value blue">{currency(stats.totalCost)}</div></div>
        <div className="stat-card">
          <div className="label">Unrealized Gain</div>
          <div className={`value ${stats.totalValue-stats.totalCost>=0?'green':''}`}>{currency(stats.totalValue-stats.totalCost)}</div>
        </div>
        <div className="stat-card">
          <div className="label">Realized Profit</div>
          <div className={`value ${stats.totalProfit>=0?'green':''}`}>{currency(stats.totalProfit)}</div>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
        <div className="table-wrap">
          <div style={{padding:'14px 18px',borderBottom:'1px solid var(--border)',fontWeight:600}}>Value by Theme</div>
          {byTheme.length===0
            ? <div className="empty-state" style={{padding:30}}><p>No data yet</p></div>
            : <table>
                <thead><tr><th>Theme</th><th>Items</th><th>Cost</th><th>Value</th></tr></thead>
                <tbody>
                  {byTheme.slice(0,15).map(([theme,d]) => (
                    <tr key={theme}>
                      <td className="item-name">{theme}</td>
                      <td>{d.count}</td>
                      <td>{currency(d.cost)}</td>
                      <td style={{fontWeight:600,color:'var(--accent)'}}>{currency(d.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
          }
        </div>

        <div className="table-wrap">
          <div style={{padding:'14px 18px',borderBottom:'1px solid var(--border)',fontWeight:600}}>Most Valuable Items</div>
          {topItems.length===0
            ? <div className="empty-state" style={{padding:30}}><p>No data yet</p></div>
            : <table>
                <thead><tr><th>Item</th><th>Type</th><th>Value</th></tr></thead>
                <tbody>
                  {topItems.map(item => (
                    <tr key={item.id}>
                      <td><span className="item-name">{item.name}</span><br/><span className="item-id">{item.itemNumber}</span></td>
                      <td><span className={`badge badge-${item.type}`}>{item.type}</span></td>
                      <td style={{fontWeight:600,color:'var(--accent)'}}>{currency(item.estimatedValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
          }
        </div>
      </div>

      {recentSales.length > 0 && (
        <div className="table-wrap" style={{marginTop:20}}>
          <div style={{padding:'14px 18px',borderBottom:'1px solid var(--border)',fontWeight:600}}>Recent Sales</div>
          <table>
            <thead><tr><th>Item</th><th>Sale Price</th><th>Cost</th><th>Fees + Ship</th><th>Net Profit</th></tr></thead>
            <tbody>
              {recentSales.map(item => {
                const cost   = (item.purchasePrice||0)*(item.quantity||1);
                const profit = (item.salePrice||0)*(item.quantity||1) - cost - (item.fees||0) - (item.shippingCost||0);
                return (
                  <tr key={item.id}>
                    <td className="item-name">{item.name}</td>
                    <td style={{fontWeight:600}}>{currency(item.salePrice)}</td>
                    <td>{currency(cost)}</td>
                    <td style={{color:'var(--text2)'}}>{currency((item.fees||0)+(item.shippingCost||0))}</td>
                    <td className={profit>=0?'profit-pos':'profit-neg'} style={{fontWeight:600}}>{currency(profit)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
