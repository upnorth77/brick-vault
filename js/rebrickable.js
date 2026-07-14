// ─── Rebrickable API ───

async function lookupItem(type, itemNumber, apiKey) {
  if (!apiKey)           throw new Error('No API key. Add your Rebrickable API key in Settings.');
  if (!itemNumber.trim()) throw new Error('Enter an item number first.');

  const num     = itemNumber.trim();
  const headers = { Authorization: `key ${apiKey}`, Accept: 'application/json' };

  if (type === 'set') {
    const setNum = num.includes('-') ? num : num + '-1';
    const res = await fetch(`https://rebrickable.com/api/v3/lego/sets/${encodeURIComponent(setNum)}/`, { headers });
    if (!res.ok) {
      if (res.status === 404) throw new Error(`Set "${setNum}" not found. Try adding -1 suffix (e.g. 75192-1).`);
      throw new Error(`API error: ${res.status}`);
    }
    const d = await res.json();
    return { name: d.name || '', imageUrl: d.set_img_url || '', year: d.year || '', numParts: d.num_parts || 0 };
  }

  if (type === 'minifig') {
    const res = await fetch(`https://rebrickable.com/api/v3/lego/minifigs/${encodeURIComponent(num)}/`, { headers });
    if (!res.ok) {
      if (res.status === 404) throw new Error(`Minifig "${num}" not found. Check the ID (e.g. sw0001).`);
      throw new Error(`API error: ${res.status}`);
    }
    const d = await res.json();
    return { name: d.name || '', imageUrl: d.set_img_url || '' };
  }

  if (type === 'part') {
    const res = await fetch(`https://rebrickable.com/api/v3/lego/parts/${encodeURIComponent(num)}/`, { headers });
    if (!res.ok) {
      if (res.status === 404) throw new Error(`Part "${num}" not found. Check the part number.`);
      throw new Error(`API error: ${res.status}`);
    }
    const d = await res.json();
    return { name: d.name || '', imageUrl: d.part_img_url || '' };
  }

  throw new Error('Unknown item type.');
}

// Batch: fetch names for every item that is missing one (~1 req/sec to respect rate limits)
async function batchLookupNames(items, apiKey, onProgress) {
  if (!apiKey) throw new Error('No API key. Add your Rebrickable API key in Settings.');
  const needLookup = items.filter(i => i.itemNumber && (!i.name || i.name.trim() === ''));
  const results = [];
  let done = 0;

  for (const item of needLookup) {
    try {
      const info = await lookupItem(item.type, item.itemNumber, apiKey);
      results.push({ id: item.id, name: info.name, imageUrl: info.imageUrl || item.imageUrl });
      await new Promise(r => setTimeout(r, 1100));
    } catch(e) {
      results.push({ id: item.id, error: e.message });
    }
    done++;
    if (onProgress) onProgress(done, needLookup.length);
  }
  return results;
}
