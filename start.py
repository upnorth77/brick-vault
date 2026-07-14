#!/usr/bin/env python3
"""
Brick Vault – local dev server with BrickLink API proxy
Run: python start.py
"""
import sys
import os
import subprocess

# ─── Auto-install dependencies ───
def ensure_deps():
    missing = []
    try:    import flask
    except: missing.append('flask')
    try:    import requests
    except: missing.append('requests')
    try:    from requests_oauthlib import OAuth1
    except: missing.append('requests-oauthlib')
    if missing:
        print(f"Installing required packages: {', '.join(missing)} ...")
        subprocess.check_call([sys.executable, '-m', 'pip', 'install', *missing])
        print("Done!\n")

ensure_deps()

from flask import Flask, request, jsonify, send_from_directory
import requests as req
from requests_oauthlib import OAuth1
import json
import webbrowser
import xml.etree.ElementTree as ET
import unicodedata
import re

import time
from concurrent.futures import ThreadPoolExecutor

PORT              = 8765
BASE_DIR          = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE       = os.path.join(BASE_DIR, 'brickvault-config.json')
IMAGE_CACHE       = os.path.join(BASE_DIR, 'cache', 'images')
REDDIT_POST_CACHE = os.path.join(BASE_DIR, 'cache', 'reddit_posts.json')
REDDIT_PRICE_CACHE= os.path.join(BASE_DIR, 'cache', 'reddit_prices.json')
BRICKSET_MSRP_CACHE = os.path.join(BASE_DIR, 'cache', 'brickset_msrp.json')
BRICKLINK_STORE_CACHE = os.path.join(BASE_DIR, 'cache', 'bricklink_store_inventory.json')
app               = Flask(__name__)


# ─── Reddit cache helpers ───

def _ensure_cache_dir():
    os.makedirs(os.path.join(BASE_DIR, 'cache'), exist_ok=True)

def load_reddit_post_cache():
    """Return { post_id: { ...post_fields, cached_at: float } }"""
    try:
        with open(REDDIT_POST_CACHE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}

def save_reddit_post_cache(cache):
    _ensure_cache_dir()
    with open(REDDIT_POST_CACHE, 'w', encoding='utf-8') as f:
        json.dump(cache, f, ensure_ascii=False)

def load_reddit_price_cache():
    """Return { set_num: { blSold, blSoldQty, blActive, blActiveQty, suggested, cached_at } }"""
    try:
        with open(REDDIT_PRICE_CACHE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}

def save_reddit_price_cache(cache):
    _ensure_cache_dir()
    with open(REDDIT_PRICE_CACHE, 'w', encoding='utf-8') as f:
        json.dump(cache, f, ensure_ascii=False)

def load_brickset_msrp_cache():
    """Return { SET-N: { retailPrice, name, year, pieces, theme, cached_at } }."""
    try:
        with open(BRICKSET_MSRP_CACHE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}

def save_brickset_msrp_cache(cache):
    _ensure_cache_dir()
    with open(BRICKSET_MSRP_CACHE, 'w', encoding='utf-8') as f:
        json.dump(cache, f, ensure_ascii=False)

def load_bricklink_store_cache():
    try:
        with open(BRICKLINK_STORE_CACHE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}

def save_bricklink_store_cache(inventories):
    _ensure_cache_dir()
    payload = {'inventories': inventories, 'total': len(inventories), 'cached_at': time.time()}
    with open(BRICKLINK_STORE_CACHE, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False)
    return payload

# ─── Config helpers ───
def load_config():
    try:
        with open(CONFIG_FILE, 'r') as f:
            return json.load(f)
    except Exception:
        return {}

def save_config(cfg):
    with open(CONFIG_FILE, 'w') as f:
        json.dump(cfg, f, indent=2)

def get_bl_creds():
    """Return BrickLink credentials from config file, or None if incomplete."""
    cfg = load_config()
    bl  = cfg.get('bricklink', {})
    ck  = bl.get('consumerKey', '').strip()
    cs  = bl.get('consumerSecret', '').strip()
    t   = bl.get('token', '').strip()
    ts  = bl.get('tokenSecret', '').strip()
    if ck and cs and t and ts:
        return ck, cs, t, ts
    return None

def missing_bl_credential_fields():
    cfg = load_config()
    bl  = cfg.get('bricklink', {})
    labels = {
        'consumerKey': 'Consumer Key',
        'consumerSecret': 'Consumer Secret',
        'token': 'Token',
        'tokenSecret': 'Token Secret',
    }
    return [label for key, label in labels.items() if not (bl.get(key, '') or '').strip()]

def bl_credentials_error():
    missing = missing_bl_credential_fields()
    detail = f" Missing: {', '.join(missing)}." if missing else ''
    return {'error': f'BrickLink API credentials not configured.{detail}', 'missingFields': missing}

# ─── Static file serving ───
@app.route('/')
def index():
    resp = send_from_directory(BASE_DIR, 'index.html')
    resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    resp.headers['Pragma'] = 'no-cache'
    return resp

@app.route('/<path:path>')
def static_files(path):
    # Don't serve the config file
    if path == 'brickvault-config.json':
        return jsonify({'error': 'Forbidden'}), 403
    resp = send_from_directory(BASE_DIR, path)
    # Disable caching for JS/CSS files so edits are always picked up immediately
    if path.endswith(('.js', '.css', '.html')):
        resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        resp.headers['Pragma'] = 'no-cache'
    return resp

# ─── Image cache ───
def cached_image_url(remote_url, auth):
    """
    Given a remote image URL, download it once and save it under cache/images/.
    Returns a local URL (/api/images/<filename>) on success, or the original URL
    as a fallback if anything goes wrong.
    """
    if not remote_url:
        return remote_url
    # Derive a stable filename from the URL path, e.g. "P/75192-1.jpg"
    # Replace path separators with underscores so it's a flat file.
    from urllib.parse import urlparse
    parsed   = urlparse(remote_url)
    filename = parsed.path.lstrip('/').replace('/', '_')
    if not filename:
        return remote_url

    os.makedirs(IMAGE_CACHE, exist_ok=True)
    local_path = os.path.join(IMAGE_CACHE, filename)

    if not os.path.isfile(local_path):
        try:
            # Use the same OAuth session so BrickLink accepts the request
            img_resp = req.get(remote_url, auth=auth, timeout=15, stream=True)
            if img_resp.status_code == 200:
                with open(local_path, 'wb') as fout:
                    for chunk in img_resp.iter_content(chunk_size=8192):
                        fout.write(chunk)
            else:
                return remote_url   # couldn't fetch — fall back to remote
        except Exception:
            return remote_url       # network error — fall back to remote

    return f'/api/images/{filename}'

@app.route('/api/images/<path:filename>')
def serve_cached_image(filename):
    """Serve a previously-cached image file."""
    return send_from_directory(IMAGE_CACHE, filename)

@app.route('/api/images/clear', methods=['POST'])
def clear_image_cache():
    """Delete all cached image files from disk."""
    count = 0
    if os.path.isdir(IMAGE_CACHE):
        for f in os.listdir(IMAGE_CACHE):
            fpath = os.path.join(IMAGE_CACHE, f)
            if os.path.isfile(fpath):
                try:
                    os.remove(fpath)
                    count += 1
                except Exception:
                    pass
    return jsonify({'cleared': count})

# ─── Config API ───
@app.route('/api/config', methods=['GET'])
def api_config_get():
    """Return current config with secrets masked."""
    cfg = load_config()
    bl  = cfg.get('bricklink', {})
    def mask(v):
        v = v.strip() if v else ''
        return ('*' * 8) if v else ''
    bs_key = cfg.get('brickset', {}).get('apiKey', '').strip()
    return jsonify({
        'bricklink': {
            'consumerKey':    mask(bl.get('consumerKey',    '')),
            'consumerSecret': mask(bl.get('consumerSecret', '')),
            'token':          mask(bl.get('token',          '')),
            'tokenSecret':    mask(bl.get('tokenSecret',    '')),
            'configured':     get_bl_creds() is not None,
            'missingFields':  missing_bl_credential_fields(),
        },
        'brickset': {
            'configured': bool(bs_key),
        }
    })

@app.route('/api/config', methods=['POST'])
def api_config_post():
    """Save credentials to disk. Only updates keys that are provided and non-empty."""
    body = request.get_json(force=True) or {}
    cfg  = load_config()
    bl   = cfg.get('bricklink', {})

    for key in ('consumerKey', 'consumerSecret', 'token', 'tokenSecret'):
        val = (body.get('bricklink') or {}).get(key, '').strip()
        if val and not val.startswith('*'):   # ignore masked placeholders
            bl[key] = val

    cfg['bricklink'] = bl

    # Brickset API key
    bs_key = (body.get('brickset') or {}).get('apiKey', '').strip()
    if bs_key and not bs_key.startswith('*'):
        cfg.setdefault('brickset', {})['apiKey'] = bs_key

    save_config(cfg)
    return jsonify({'ok': True, 'configured': get_bl_creds() is not None})

def bl_price_guide_stats(price_data, filter_outliers=True):
    """
    Given a BrickLink price guide `data` dict (from the API response),
    return (median, avg, min) with outlier filtering — same logic as /api/bricklink/price.
    Returns (None, None, None) if no usable price_detail entries.
    """
    price_detail = price_data.get('price_detail', []) or []
    raw_lots = []
    for entry in price_detail:
        try:
            qty   = int(entry.get('quantity', 1) or 1)
            price = round(float(entry.get('unit_price', 0) or 0), 4)
            if price > 0:
                raw_lots.append((qty, price))
        except (ValueError, TypeError):
            continue

    if not raw_lots:
        return None, None, None

    if filter_outliers:
        raw_expanded = []
        for qty, price in raw_lots:
            raw_expanded.extend([price] * qty)
        raw_expanded.sort()
        mid_r = len(raw_expanded) // 2
        raw_median = raw_expanded[mid_r] if len(raw_expanded) % 2 else (raw_expanded[mid_r - 1] + raw_expanded[mid_r]) / 2
        cutoff = raw_median * 0.50
        lots = [(qty, price) for qty, price in raw_lots if price >= cutoff] or raw_lots
    else:
        lots = raw_lots

    expanded    = []
    total_qty   = 0
    total_value = 0.0
    for qty, price in lots:
        expanded.extend([price] * qty)
        total_qty   += qty
        total_value += qty * price

    expanded.sort()
    mid    = len(expanded) // 2
    median = expanded[mid] if len(expanded) % 2 else (expanded[mid - 1] + expanded[mid]) / 2
    avg    = total_value / total_qty if total_qty else median
    lo     = min(p for _, p in lots)
    return round(median, 2), round(avg, 2), round(lo, 2)


def get_brickset_key():
    """Return Brickset API key from config, or None if not set."""
    cfg = load_config()
    key = cfg.get('brickset', {}).get('apiKey', '').strip()
    return key if key else None

def normalise_set_number(set_number):
    set_number = str(set_number or '').strip().upper()
    if not set_number:
        return ''
    return set_number if re.search(r'-\d+$', set_number) else set_number + '-1'

def brickset_retail_record(s):
    lego_com = s.get('LEGOCom', {}) or {}
    us       = lego_com.get('US', {}) or {}
    retail   = us.get('retailPrice')
    try:
        retail = float(retail) if retail is not None and retail != '' else None
    except (TypeError, ValueError):
        retail = None

    number = s.get('setNumber') or ''
    if not number:
        base = str(s.get('number') or '').strip()
        variant = str(s.get('numberVariant') or '').strip()
        number = f'{base}-{variant}' if base and variant else base
    number = normalise_set_number(number)

    return number, {
        'retailPrice': retail,
        'name':        s.get('name', ''),
        'year':        s.get('year'),
        'pieces':      s.get('pieces'),
        'theme':       s.get('theme', ''),
        'cached_at':   time.time(),
    }

# ─── Brickset API proxy ───
@app.route('/api/brickset/set')
def brickset_set():
    """
    Fetch set details from Brickset, including retail price.
    Query params: setNumber (e.g. '75192-1')
    Returns: { name, retailPrice, year, pieces, theme } or { error }
    """
    set_number = request.args.get('setNumber', '').strip()
    if not set_number:
        return jsonify({'error': 'setNumber is required'}), 400

    api_key = get_brickset_key()
    if not api_key:
        return jsonify({'error': 'Brickset API key not configured. Add it in Configuration.'}), 400

    # Ensure set number has variant suffix (e.g. '75192' → '75192-1')
    set_number = normalise_set_number(set_number)

    try:
        url    = 'https://brickset.com/api/v3.asmx/getSets'
        params = {
            'apiKey':   api_key,
            'userHash': '',
            'params':   json.dumps({'setNumber': set_number}),
        }
        resp = req.get(url, params=params, timeout=10)
        body = resp.json()

        if body.get('status') != 'success':
            return jsonify({'error': body.get('message', 'Brickset API error')}), 400

        sets = body.get('sets', [])
        if not sets:
            return jsonify({'error': f'Set {set_number} not found on Brickset'}), 404

        s = sets[0]
        lego_com = s.get('LEGOCom', {})
        us       = lego_com.get('US', {})
        retail   = us.get('retailPrice')

        # Build keywords from several Brickset fields that may contain useful tags
        keywords = set()

        # subtheme (e.g. "Ultimate Collector Series", "Technic")
        subtheme = (s.get('subtheme') or '').strip()
        if subtheme:
            keywords.add(subtheme)

        # tags — comma-separated string if present
        raw_tags = s.get('tags', '') or ''
        for t in raw_tags.split(','):
            t = t.strip()
            if t:
                keywords.add(t)

        # collections — list of dicts with a 'name' key
        for col in (s.get('collections') or []):
            name = (col.get('name') or col.get('collection') or '').strip()
            if name:
                keywords.add(name)

        # collection — may be a single string or dict
        col = s.get('collection')
        if isinstance(col, str) and col.strip():
            keywords.add(col.strip())
        elif isinstance(col, dict):
            name = (col.get('name') or '').strip()
            if name:
                keywords.add(name)

        keywords = sorted(keywords)

        return jsonify({
            'name':        s.get('name', ''),
            'year':        s.get('year'),
            'pieces':      s.get('pieces'),
            'theme':       s.get('theme', ''),
            'subtheme':    subtheme or None,
            'retailPrice': retail,
            'keywords':    keywords,
            '_debug':      {k: s[k] for k in ('tags', 'subtheme', 'collections', 'collection') if k in s},
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/brickset/msrp-batch', methods=['POST'])
def brickset_msrp_batch():
    """
    Fetch US MSRP for many sets with as few Brickset calls as possible.
    Body: { setNumbers: ["75192", "10305-1"], force: false }
    Returns: { prices: { "75192-1": {...} }, missing: [], cached, fetched, calls }
    """
    body = request.get_json(force=True) or {}
    requested = body.get('setNumbers') or []
    force = bool(body.get('force'))
    set_numbers = []
    seen = set()
    for raw in requested:
        sn = normalise_set_number(raw)
        if sn and sn not in seen:
            seen.add(sn)
            set_numbers.append(sn)

    if not set_numbers:
        return jsonify({'prices': {}, 'missing': [], 'cached': 0, 'fetched': 0, 'calls': 0})

    api_key = get_brickset_key()
    if not api_key:
        return jsonify({'error': 'Brickset API key not configured. Add it in Configuration.'}), 400

    cache = load_brickset_msrp_cache()
    prices = {}
    to_fetch = []
    for sn in set_numbers:
        if not force and sn in cache:
            prices[sn] = cache[sn]
        else:
            to_fetch.append(sn)

    calls = 0
    errors = []
    fetched_keys = set()
    url = 'https://brickset.com/api/v3.asmx/getSets'

    # Brickset accepts comma-separated setNumber filters, so chunk unique misses.
    # If a chunk does not resolve everything, unresolved numbers are retried one at a time.
    def fetch_chunk(chunk):
        nonlocal calls
        calls += 1
        params = {
            'apiKey':   api_key,
            'userHash': '',
            'params':   json.dumps({'setNumber': ','.join(chunk), 'pageSize': len(chunk)}),
        }
        resp = req.get(url, params=params, timeout=20)
        data = resp.json()
        if data.get('status') != 'success':
            raise ValueError(data.get('message', 'Brickset API error'))
        return data.get('sets', []) or []

    for i in range(0, len(to_fetch), 100):
        chunk = to_fetch[i:i + 100]
        try:
            for s in fetch_chunk(chunk):
                sn, record = brickset_retail_record(s)
                if sn:
                    cache[sn] = record
                    prices[sn] = record
                    fetched_keys.add(sn)
        except Exception as e:
            errors.append(str(e))

    unresolved = [sn for sn in to_fetch if sn not in fetched_keys]
    for sn in unresolved:
        try:
            sets = fetch_chunk([sn])
            if not sets:
                cache[sn] = {'retailPrice': None, 'cached_at': time.time(), 'missing': True}
                prices[sn] = cache[sn]
                continue
            for s in sets:
                set_no, record = brickset_retail_record(s)
                if set_no:
                    cache[set_no] = record
                    prices[set_no] = record
                    fetched_keys.add(set_no)
        except Exception as e:
            errors.append(f'{sn}: {e}')

    save_brickset_msrp_cache(cache)

    missing = [sn for sn in set_numbers if prices.get(sn, {}).get('retailPrice') is None]
    return jsonify({
        'prices':  {sn: prices[sn] for sn in set_numbers if sn in prices},
        'missing': missing,
        'cached':  len([sn for sn in set_numbers if sn in prices and sn not in fetched_keys]),
        'fetched': len([sn for sn in set_numbers if sn in fetched_keys]),
        'calls':   calls,
        'errors':  errors,
    })

# ─── Local catalog ───
# In-memory catalog: maps of itemId.upper() → { name, theme }
_catalog = { 'sets': {}, 'minifigs': {}, 'parts': {}, 'loadedAt': None, 'counts': {} }
_catalog_search_cache = {}
_catalog_token_cache = {}
CATALOG_DIR = os.path.join(BASE_DIR, 'catalog')

# In-memory color map: colorId (str) → { name, type, hex }
_colors = {}
COLORS_FILE = os.path.join(CATALOG_DIR, '_colors.xml')

# In-memory category map: categoryId (str) → { name, parentId }
_categories = {}
CATEGORIES_FILE = os.path.join(CATALOG_DIR, '_categories.xml')

def clean_name(s):
    if not s:
        return ''
    s = re.sub(r'&#(\d+);',  lambda m: chr(int(m.group(1))), s)
    s = re.sub(r'&#x([0-9a-fA-F]+);', lambda m: chr(int(m.group(1), 16)), s)
    return ''.join(c for c in s if unicodedata.category(c) not in ('Cc','Cf','Cs','Co','Cn')).strip()

TYPE_MAP = { 'S': 'sets', 'M': 'minifigs', 'P': 'parts' }

def invalidate_catalog_indexes():
    _catalog_search_cache.clear()
    _catalog_token_cache.clear()

def catalog_buckets_for_type(item_type, include_parts_for_all=True):
    if item_type in ('set', 'sets'):
        return [('set', 'sets')]
    if item_type in ('minifig', 'minifigs'):
        return [('minifig', 'minifigs')]
    if item_type in ('part', 'parts'):
        return [('part', 'parts')]
    buckets = [('set', 'sets'), ('minifig', 'minifigs')]
    if include_parts_for_all:
        buckets.append(('part', 'parts'))
    return buckets

def catalog_search_entries(item_type):
    cache_key = item_type if item_type in ('set', 'sets', 'minifig', 'minifigs', 'part', 'parts') else 'all'
    cached = _catalog_search_cache.get(cache_key)
    if cached is not None:
        return cached

    entries = []
    for type_label, bucket_key in catalog_buckets_for_type(item_type):
        for item_id, entry in _catalog[bucket_key].items():
            name = entry.get('name', '')
            theme = entry.get('theme', '')
            entries.append({
                'itemNumber': item_id,
                'name': name,
                'theme': theme,
                'type': type_label,
                '_search': f'{item_id} {name} {theme}'.lower(),
            })
    entries.sort(key=lambda r: r['itemNumber'])
    _catalog_search_cache[cache_key] = entries
    return entries

def tokenise_catalog_text(s):
    return [w for w in re.sub(r"[^a-z0-9 ]", " ", s.lower()).split() if len(w) >= 3 and not w.isdigit()]

def catalog_token_entries(item_type):
    cache_key = item_type if item_type in ('set', 'sets', 'minifig', 'minifigs', 'part', 'parts') else 'all'
    cached = _catalog_token_cache.get(cache_key)
    if cached is not None:
        return cached

    entries = []
    for type_label, bucket_key in catalog_buckets_for_type(item_type, include_parts_for_all=False):
        for item_id, entry in _catalog[bucket_key].items():
            name = entry.get('name', '')
            entries.append({
                'itemNumber': item_id,
                'name': name,
                'theme': entry.get('theme', ''),
                'type': type_label,
                'tokens': set(tokenise_catalog_text(name)),
            })
    _catalog_token_cache[cache_key] = entries
    return entries

def parse_catalog_xml(xml_text, target_map):
    """Parse a BrickLink catalog XML string, merging items into target_map (mutates in place)."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        raise ValueError(f'Invalid XML: {e}')
    for item in root.iter('ITEM'):
        type_code  = (item.findtext('ITEMTYPE') or '').strip().upper()
        item_id    = (item.findtext('ITEMID')   or '').strip().upper()
        name       = clean_name(item.findtext('ITEMNAME') or '')
        cat_id     = (item.findtext('CATEGORYID') or item.findtext('CATEGORY') or '').strip()
        # Prefer local category name → fall back to inline CATEGORYNAME tag
        theme = ''
        if cat_id and cat_id in _categories:
            theme = _categories[cat_id]['name']
        else:
            theme = clean_name(item.findtext('CATEGORYNAME') or '')
        if not item_id or not name:
            continue
        bucket = TYPE_MAP.get(type_code)
        if bucket:
            target_map[bucket][item_id] = {'name': name, 'theme': theme, 'categoryId': cat_id}
    invalidate_catalog_indexes()

def parse_colors_xml(xml_text):
    """Parse BrickLink color XML → dict of colorId → { name, type, hex }"""
    result = {}
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        raise ValueError(f'Invalid color XML: {e}')
    for item in root.iter('ITEM'):
        color_id   = (item.findtext('COLOR') or '').strip()
        color_name = clean_name(item.findtext('COLORNAME') or '')
        color_type = clean_name(item.findtext('COLORTYPE') or '')
        rgb = (item.findtext('COLORRGB') or '').strip()
        if not color_id or not color_name:
            continue
        hex_val = ''
        if len(rgb) == 6:
            try:
                int(rgb, 16)  # validate it's hex
                hex_val = '#' + rgb.lower()
            except ValueError:
                pass
        result[color_id] = {'name': color_name, 'type': color_type, 'hex': hex_val}
    return result

def parse_categories_xml(xml_text):
    """Parse BrickLink category XML → dict of categoryId → { name, parentId }"""
    result = {}
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        raise ValueError(f'Invalid category XML: {e}')
    for item in root.iter('ITEM'):
        cat_id     = (item.findtext('CATEGORY') or '').strip()
        cat_name   = clean_name(item.findtext('CATEGORYNAME') or '')
        parent_id  = (item.findtext('CATEGORYPARENT') or '0').strip()
        if not cat_id or not cat_name:
            continue
        result[cat_id] = {'name': cat_name, 'parentId': parent_id}
    return result

def load_catalog_from_disk():
    """Load all saved catalog XML files from the catalog/ directory on startup."""
    global _catalog, _colors, _categories
    if not os.path.isdir(CATALOG_DIR):
        return
    import datetime
    newest = None

    # Load colors
    if os.path.isfile(COLORS_FILE):
        try:
            with open(COLORS_FILE, 'r', encoding='utf-8', errors='replace') as f:
                _colors = parse_colors_xml(f.read())
            print(f'  Colors loaded: {len(_colors):,} colors')
        except Exception as e:
            print(f'  Warning: could not load colors: {e}')

    # Load categories
    if os.path.isfile(CATEGORIES_FILE):
        try:
            with open(CATEGORIES_FILE, 'r', encoding='utf-8', errors='replace') as f:
                _categories = parse_categories_xml(f.read())
            print(f'  Categories loaded: {len(_categories):,} categories')
        except Exception as e:
            print(f'  Warning: could not load categories: {e}')

    # Load item catalog files (skip reserved filenames)
    reserved = {os.path.basename(COLORS_FILE).lower(), os.path.basename(CATEGORIES_FILE).lower()}
    for fname in os.listdir(CATALOG_DIR):
        if not fname.lower().endswith('.xml'):
            continue
        if fname.lower() in reserved:
            continue
        fpath = os.path.join(CATALOG_DIR, fname)
        try:
            with open(fpath, 'r', encoding='utf-8', errors='replace') as f:
                parse_catalog_xml(f.read(), _catalog)
            mtime = os.path.getmtime(fpath)
            if newest is None or mtime > newest:
                newest = mtime
        except Exception as e:
            print(f'  Warning: could not load catalog file {fname}: {e}')

    if newest:
        _catalog['loadedAt'] = str(datetime.datetime.fromtimestamp(newest).isoformat())
        _catalog['counts']   = {k: len(_catalog[k]) for k in ('sets','minifigs','parts')}
        total = sum(_catalog['counts'].values())
        print(f'  Items loaded: {total:,} ({_catalog["counts"]["sets"]:,} sets, {_catalog["counts"]["minifigs"]:,} minifigs, {_catalog["counts"]["parts"]:,} parts)')

@app.route('/api/catalog/status')
def catalog_status():
    counts = {k: len(_catalog[k]) for k in ('sets','minifigs','parts')}
    return jsonify({
        'loaded':   sum(counts.values()) > 0,
        'counts':   counts,
        'loadedAt': _catalog.get('loadedAt'),
    })

@app.route('/api/catalog/upload', methods=['POST'])
def catalog_upload():
    """Accept one or more catalog XML files, save to disk, and merge into memory."""
    files = request.files.getlist('files')
    if not files:
        return jsonify({'error': 'No files provided'}), 400

    os.makedirs(CATALOG_DIR, exist_ok=True)
    saved, errors = [], []

    for f in files:
        fname = os.path.basename(f.filename or 'catalog.xml')
        if not fname.lower().endswith('.xml'):
            errors.append(f'{fname}: not an XML file')
            continue
        try:
            xml_text = f.read().decode('utf-8', errors='replace')
            parse_catalog_xml(xml_text, _catalog)
            fpath = os.path.join(CATALOG_DIR, fname)
            with open(fpath, 'w', encoding='utf-8') as out:
                out.write(xml_text)
            saved.append(fname)
        except Exception as e:
            errors.append(f'{fname}: {e}')

    import datetime
    _catalog['loadedAt'] = datetime.datetime.now().isoformat()
    counts = {k: len(_catalog[k]) for k in ('sets','minifigs','parts')}
    total  = sum(counts.values())

    return jsonify({
        'ok':      len(saved) > 0,
        'saved':   saved,
        'errors':  errors,
        'counts':  counts,
        'total':   total,
        'loadedAt': _catalog['loadedAt'],
    })

@app.route('/api/catalog/lookup')
def catalog_lookup():
    """Look up a single item in the local catalog."""
    item_type   = request.args.get('type', 'set').lower()
    item_number = request.args.get('itemNumber', '').strip().upper()
    if not item_number:
        return jsonify({'error': 'itemNumber required'}), 400
    bucket = {'set':'sets','minifig':'minifigs','part':'parts'}.get(item_type, 'sets')
    entry  = _catalog[bucket].get(item_number)
    if not entry:
        return jsonify({'found': False})
    return jsonify({'found': True, 'name': entry['name'], 'theme': entry['theme']})

@app.route('/api/catalog/search')
def catalog_search():
    """Search the local catalog by name, item number, or theme."""
    q         = request.args.get('q', '').strip().lower()
    item_type = request.args.get('type', 'all').lower()   # 'set','minifig','part','all'
    limit     = min(int(request.args.get('limit', 100)), 500)
    offset    = int(request.args.get('offset', 0))

    entries = catalog_search_entries(item_type)
    total = 0
    page = []
    page_end = offset + limit
    for entry in entries:
        if q and q not in entry['_search']:
            continue
        if offset <= total < page_end:
            page.append({
                'itemNumber': entry['itemNumber'],
                'name': entry['name'],
                'theme': entry['theme'],
                'type': entry['type'],
            })
        total += 1

    return jsonify({'total': total, 'offset': offset, 'limit': limit, 'results': page})


@app.route('/api/catalog/batch', methods=['POST'])
def catalog_batch():
    """Look up multiple items at once. Body: { "items": [{"type": "set", "itemNumber": "75192"}, ...] }"""
    body  = request.get_json(force=True) or {}
    reqs  = body.get('items', [])
    results = {}
    for r in reqs:
        item_type   = (r.get('type') or 'set').lower()
        item_number = (r.get('itemNumber') or '').strip().upper()
        if not item_number:
            continue
        bucket = {'set': 'sets', 'minifig': 'minifigs', 'part': 'parts'}.get(item_type, 'sets')
        # Try exact match first, then with -1 suffix (sets are stored as e.g. "75192-1")
        entry = _catalog[bucket].get(item_number)
        if not entry and not re.search(r'-\d+$', item_number):
            entry = _catalog[bucket].get(item_number + '-1')
        if entry:
            results[item_number] = {'found': True, 'name': entry['name'], 'theme': entry.get('theme', '')}
        else:
            results[item_number] = {'found': False}
    return jsonify(results)


@app.route('/api/catalog/name-search', methods=['POST'])
def catalog_name_search():
    """
    Given a list of name strings, return the best-matching catalog item for each.
    Body: { "names": ["Detectives Office", "Police Station", ...], "type": "set" }
    Returns: { "Detectives Office": { found, itemNumber, name, theme, type, score } | { found: false }, ... }

    Matching strategy:
      - Tokenise both query and catalog name into words (lower-case, 3+ chars, non-numeric)
      - Score = number of query tokens found in catalog name
      - Only accept if score >= min(2, len(tokens)) AND score/len(tokens) >= 0.5
      - If multiple catalog items tie, the one with more matching tokens wins;
        ties broken by shorter name (more specific match)
    """
    body      = request.get_json(force=True) or {}
    names     = body.get('names', [])
    item_type = body.get('type', 'set').lower()

    catalog_entries = catalog_token_entries(item_type)

    results = {}
    for query_name in names:
        if not query_name or not query_name.strip():
            results[query_name] = {'found': False}
            continue

        q_tokens = tokenise_catalog_text(query_name)
        if not q_tokens:
            results[query_name] = {'found': False}
            continue

        min_required = max(1, min(2, len(q_tokens)))
        threshold    = 0.5

        best      = None
        best_score = 0

        for entry in catalog_entries:
            if not entry['tokens']:
                continue
            matches = sum(1 for t in q_tokens if t in entry['tokens'])
            if matches < min_required:
                continue
            if matches / len(q_tokens) < threshold:
                continue
            # Prefer higher score; tie-break by shorter name (more specific)
            if (matches > best_score or
                    (matches == best_score and best and len(entry['name']) < len(best['name']))):
                best_score = matches
                best = entry

        if best:
            results[query_name] = {
                'found':      True,
                'itemNumber': best['itemNumber'],
                'name':       best['name'],
                'theme':      best['theme'],
                'type':       best['type'],
                'score':      best_score,
            }
        else:
            results[query_name] = {'found': False}

    return jsonify(results)


@app.route('/api/catalog/clear', methods=['POST'])
def catalog_clear():
    """Remove all saved item catalog files and clear the in-memory item catalog."""
    global _catalog
    _catalog = { 'sets': {}, 'minifigs': {}, 'parts': {}, 'loadedAt': None, 'counts': {} }
    invalidate_catalog_indexes()
    if os.path.isdir(CATALOG_DIR):
        reserved = {os.path.basename(COLORS_FILE).lower(), os.path.basename(CATEGORIES_FILE).lower()}
        for fname in os.listdir(CATALOG_DIR):
            if fname.lower() not in reserved and fname.lower().endswith('.xml'):
                os.remove(os.path.join(CATALOG_DIR, fname))
    return jsonify({'ok': True})

# ─── Colors catalog ───
@app.route('/api/colors/status')
def colors_status():
    return jsonify({'loaded': len(_colors) > 0, 'count': len(_colors)})

@app.route('/api/colors/upload', methods=['POST'])
def colors_upload():
    global _colors
    files = request.files.getlist('files')
    if not files:
        return jsonify({'error': 'No files provided'}), 400
    os.makedirs(CATALOG_DIR, exist_ok=True)
    errors = []
    for f in files:
        try:
            xml_text = f.read().decode('utf-8', errors='replace')
            _colors = parse_colors_xml(xml_text)
            with open(COLORS_FILE, 'w', encoding='utf-8') as out:
                out.write(xml_text)
        except Exception as e:
            errors.append(str(e))
    import datetime
    return jsonify({'ok': len(_colors) > 0, 'count': len(_colors), 'errors': errors,
                    'loadedAt': datetime.datetime.now().isoformat()})

@app.route('/api/colors/all')
def colors_all():
    return jsonify(_colors)

@app.route('/api/colors/lookup')
def colors_lookup():
    color_id = request.args.get('colorId', '').strip()
    if not color_id:
        return jsonify({'error': 'colorId required'}), 400
    entry = _colors.get(color_id)
    if not entry:
        return jsonify({'found': False})
    return jsonify({'found': True, **entry})

@app.route('/api/colors/clear', methods=['POST'])
def colors_clear():
    global _colors
    _colors = {}
    if os.path.isfile(COLORS_FILE):
        os.remove(COLORS_FILE)
    return jsonify({'ok': True})

# ─── Categories catalog ───
@app.route('/api/categories/status')
def categories_status():
    return jsonify({'loaded': len(_categories) > 0, 'count': len(_categories)})

@app.route('/api/categories/upload', methods=['POST'])
def categories_upload():
    global _categories
    files = request.files.getlist('files')
    if not files:
        return jsonify({'error': 'No files provided'}), 400
    os.makedirs(CATALOG_DIR, exist_ok=True)
    errors = []
    for f in files:
        try:
            xml_text = f.read().decode('utf-8', errors='replace')
            _categories = parse_categories_xml(xml_text)
            with open(CATEGORIES_FILE, 'w', encoding='utf-8') as out:
                out.write(xml_text)
        except Exception as e:
            errors.append(str(e))
    import datetime
    return jsonify({'ok': len(_categories) > 0, 'count': len(_categories), 'errors': errors,
                    'loadedAt': datetime.datetime.now().isoformat()})

@app.route('/api/categories/all')
def categories_all():
    return jsonify(_categories)

@app.route('/api/categories/lookup')
def categories_lookup():
    cat_id = request.args.get('categoryId', '').strip()
    if not cat_id:
        return jsonify({'error': 'categoryId required'}), 400
    entry = _categories.get(cat_id)
    if not entry:
        return jsonify({'found': False})
    return jsonify({'found': True, **entry})

@app.route('/api/categories/clear', methods=['POST'])
def categories_clear():
    global _categories
    _categories = {}
    if os.path.isfile(CATEGORIES_FILE):
        os.remove(CATEGORIES_FILE)
    return jsonify({'ok': True})

# ─── Item Types catalog ───
_item_types = {}   # typeId (str) → { name }
ITEM_TYPES_FILE = os.path.join(CATALOG_DIR, '_item_types.xml')

def parse_item_types_xml(xml_text):
    result = {}
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        raise ValueError(f'Invalid item types XML: {e}')
    for item in root.iter('ITEM'):
        type_id   = (item.findtext('ITEMTYPE') or '').strip()
        type_name = clean_name(item.findtext('ITEMTYPENAME') or item.findtext('DESCRIPTION') or '')
        if type_id and type_name:
            result[type_id] = {'name': type_name}
    return result

def load_item_types_from_disk():
    global _item_types
    if os.path.isfile(ITEM_TYPES_FILE):
        try:
            with open(ITEM_TYPES_FILE, 'r', encoding='utf-8', errors='replace') as f:
                _item_types = parse_item_types_xml(f.read())
            print(f'  Item types loaded: {len(_item_types):,} types')
        except Exception as e:
            print(f'  Warning: could not load item types: {e}')

@app.route('/api/itemtypes/status')
def itemtypes_status():
    return jsonify({'loaded': len(_item_types) > 0, 'count': len(_item_types)})

@app.route('/api/itemtypes/upload', methods=['POST'])
def itemtypes_upload():
    global _item_types
    files = request.files.getlist('files')
    if not files:
        return jsonify({'error': 'No files provided'}), 400
    os.makedirs(CATALOG_DIR, exist_ok=True)
    errors = []
    for f in files:
        try:
            xml_text = f.read().decode('utf-8', errors='replace')
            _item_types = parse_item_types_xml(xml_text)
            with open(ITEM_TYPES_FILE, 'w', encoding='utf-8') as out:
                out.write(xml_text)
        except Exception as e:
            errors.append(str(e))
    import datetime
    return jsonify({'ok': len(_item_types) > 0, 'count': len(_item_types), 'errors': errors,
                    'loadedAt': datetime.datetime.now().isoformat()})

@app.route('/api/itemtypes/clear', methods=['POST'])
def itemtypes_clear():
    global _item_types
    _item_types = {}
    if os.path.isfile(ITEM_TYPES_FILE):
        os.remove(ITEM_TYPES_FILE)
    return jsonify({'ok': True})

@app.route('/api/itemtypes/all')
def itemtypes_all():
    return jsonify(_item_types)


# ─── BrickLink helpers ───
def normalise_bl_listing_item(item_type, item_number):
    item_type = (item_type or 'SET').upper()
    type_aliases = {
        'S': 'SET', 'SET': 'SET',
        'M': 'MINIFIG', 'MINIFIG': 'MINIFIG',
        'P': 'PART', 'PART': 'PART',
        'G': 'GEAR', 'GEAR': 'GEAR',
        'B': 'BOOK', 'BOOK': 'BOOK',
        'C': 'CATALOG', 'CATALOG': 'CATALOG',
        'I': 'INSTRUCTION', 'INSTRUCTION': 'INSTRUCTION',
    }
    item_type = type_aliases.get(item_type, 'SET')
    item_number = (item_number or '').strip()
    if item_type == 'SET' and item_number and not re.search(r'-\d+$', item_number):
        item_number = f'{item_number}-1'
    return item_type, item_number

def catalog_entry_for_item(item_type, item_number):
    bucket = {'set': 'sets', 'minifig': 'minifigs', 'part': 'parts'}.get((item_type or '').lower())
    if not bucket or not item_number:
        return None
    item_number = str(item_number).strip().upper()
    entry = _catalog[bucket].get(item_number)
    if entry:
        return entry
    if bucket == 'sets':
        if re.search(r'-\d+$', item_number):
            return _catalog[bucket].get(re.sub(r'-\d+$', '', item_number))
        return _catalog[bucket].get(item_number + '-1')
    return None

def build_bl_listing_payload(body):
    item_type, item_number = normalise_bl_listing_item(body.get('item_type', 'SET'), body.get('item_number', ''))
    color_id = body.get('color_id', '')
    try:
        quantity = max(1, int(body.get('quantity', 1)))
    except (TypeError, ValueError):
        return None, 'quantity must be a positive integer', 400
    price = body.get('price')
    condition = body.get('condition', 'U')
    completeness = body.get('completeness', '')
    description = body.get('description', '')
    remarks = body.get('remarks', '')

    if not item_number:
        return None, 'item_number is required', 400
    if price is None:
        return None, 'price is required', 400

    try:
        color_id_value = int(color_id) if str(color_id).strip() else 0
    except (TypeError, ValueError):
        return None, 'color_id must be a BrickLink color id number', 400

    try:
        unit_price = str(round(float(price), 4))
    except (TypeError, ValueError):
        return None, 'price must be a number', 400

    payload = {
        'item': {
            'no': item_number,
            'type': item_type,
        },
        'color_id': color_id_value,
        'quantity': quantity,
        'unit_price': unit_price,
        'new_or_used': condition,
        'bulk': 1,
        'is_retain': False,
        'is_stock_room': False,
        'description': str(description or ''),
        'remarks': str(remarks or ''),
    }
    if item_type == 'SET':
        payload['completeness'] = completeness if completeness in ('C', 'B', 'S') else ('S' if condition == 'N' else 'C')
    return payload, None, None


# ─── BrickLink catalog proxy ───
@app.route('/api/bricklink/catalog')
def bricklink_catalog():
    item_type   = request.args.get('type', 'set')
    item_number = request.args.get('itemNumber', '').strip()
    color_id    = request.args.get('colorId', '').strip()
    if not item_number:
        return jsonify({'error': 'itemNumber is required'}), 400

    creds = get_bl_creds()
    if not creds:
        return jsonify({'error': 'BrickLink API credentials not configured. Add them in Settings.'}), 400

    consumer_key, consumer_secret, token, token_secret = creds
    type_map = {'set': 'SET', 'minifig': 'MINIFIG', 'part': 'PART'}
    bl_type  = type_map.get(item_type.lower(), 'SET')
    url      = f'https://api.bricklink.com/api/store/v1/items/{bl_type}/{item_number}'
    auth     = OAuth1(consumer_key, consumer_secret, token, token_secret)

    try:
        resp = req.get(url, auth=auth, timeout=10)
        body = resp.json()

        meta = body.get('meta', {})
        if resp.status_code != 200 or meta.get('code') != 200:
            msg = meta.get('message') or f'HTTP {resp.status_code}'
            return jsonify({'error': msg}), resp.status_code

        d = body.get('data', {})

        def fix_url(u):
            return ('https:' + u) if u and u.startswith('//') else (u or '')

        image_url     = cached_image_url(fix_url(d.get('image_url', '')),     auth)
        thumbnail_url = cached_image_url(fix_url(d.get('thumbnail_url', '')), auth)

        # Resolve category name — use local catalog first, fall back to API
        category_name = ''
        category_id   = str(d.get('category_id', '') or '')
        if category_id:
            if category_id in _categories:
                category_name = _categories[category_id]['name']
            else:
                try:
                    cat_url  = f'https://api.bricklink.com/api/store/v1/categories/{category_id}'
                    cat_resp = req.get(cat_url, auth=auth, timeout=10)
                    cat_body = cat_resp.json()
                    if cat_resp.status_code == 200:
                        category_name = cat_body.get('data', {}).get('category_name', '')
                except Exception:
                    pass

        # Resolve color name from local colors catalog
        color_id   = str(d.get('color_id', '') or '')
        color_name = _colors.get(color_id, {}).get('name', '') if color_id else ''
        color_hex  = _colors.get(color_id, {}).get('hex', '') if color_id else ''

        # For parts with a known color, fetch the color-specific image.
        # Only do this when the caller explicitly passed a colorId.
        req_color_id = request.args.get('colorId', '').strip()
        if bl_type == 'PART' and req_color_id:
            try:
                img_url = f'https://api.bricklink.com/api/store/v1/items/PART/{item_number}/images/{req_color_id}'
                img_resp = req.get(img_url, auth=auth, timeout=10)
                img_body = img_resp.json()
                if img_resp.status_code == 200 and img_body.get('meta', {}).get('code') == 200:
                    raw_data = img_body.get('data', {})
                    # BrickLink may return data as a list; take the first element if so
                    img_d = raw_data[0] if isinstance(raw_data, list) and raw_data else (raw_data if isinstance(raw_data, dict) else {})
                    raw_thumb_url = img_d.get('thumbnail_url') or img_d.get('thumb_url') or img_d.get('thumbnail') or ''
                    raw_img_url   = img_d.get('image_url') or img_d.get('url') or img_d.get('image') or ''
                    # BrickLink only provides thumbnail_url for color-specific images.
                    # Thumbnail pattern: //img.bricklink.com/P/{colorId}/{no}.jpg
                    # Construct full-size via the newer ItemImage CDN path:
                    #   //img.bricklink.com/ItemImage/PN/{colorId}/{no}.png
                    if not raw_img_url and raw_thumb_url:
                        import re as _re
                        m = _re.search(r'/P/(\d+)/(.+)\.jpg', raw_thumb_url)
                        if m:
                            raw_img_url = f'//img.bricklink.com/ItemImage/PN/{m.group(1)}/{m.group(2)}.png'
                        else:
                            raw_img_url = raw_thumb_url  # fallback to thumbnail
                    color_image     = cached_image_url(fix_url(raw_img_url),   auth) if raw_img_url   else ''
                    color_thumbnail = cached_image_url(fix_url(raw_thumb_url), auth) if raw_thumb_url else ''
                    if color_image:
                        image_url     = color_image
                        thumbnail_url = color_thumbnail or image_url
                    # Also update color info from the image response if available
                    if not color_id and img_d.get('color_id'):
                        color_id   = str(img_d['color_id'])
                        color_name = _colors.get(color_id, {}).get('name', '')
                        color_hex  = _colors.get(color_id, {}).get('hex',  '')
            except Exception:
                pass  # fall back to default image

        return jsonify({
            'name':         clean_name(d.get('name', '')),
            'imageUrl':     image_url,
            'thumbnailUrl': thumbnail_url,
            'yearReleased': d.get('year_released'),
            'theme':        category_name,
            'description':  d.get('description', ''),
            'color':        color_name,
            'colorId':      color_id,
            'colorHex':     color_hex,
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ─── BrickLink price guide proxy ───
def _bl_fetch_price_guide(bl_type, item_number, auth, guide_type, new_or_used,
                           country_code, color_id, filter_outliers):
    """
    Shared helper: fetch one BrickLink price guide (sold or stock) and return a
    normalised dict: { avg, median, min, max, unitQuantity, currencyCode,
                       guideType, newOrUsed, priceDetail, outliersRemoved }
    Raises ValueError on any API or rate-limit error.
    """
    import time as _time, re as _re

    params = {'guide_type': guide_type, 'new_or_used': new_or_used, 'currency_code': 'USD'}
    if country_code:
        params['country_code'] = country_code
    if color_id:
        params['color_id'] = color_id

    def try_fetch(item_id):
        url = f'https://api.bricklink.com/api/store/v1/items/{bl_type}/{item_id}/price'
        for attempt in range(3):
            resp = req.get(url, auth=auth, params=params, timeout=10)
            body = resp.json()
            meta = body.get('meta', {})
            # Retry on rate-limit responses (HTTP 429 or BrickLink RESOURCE_LIMIT_EXCEED code)
            if resp.status_code == 429 or meta.get('code') in (429, 'RESOURCE_LIMIT_EXCEED'):
                if attempt < 2:
                    _time.sleep(5 * (attempt + 1))  # 5s, then 10s
                    continue
                raise ValueError('BrickLink rate limit exceeded — try again in a minute')
            if resp.status_code != 200 or meta.get('code') != 200:
                raise ValueError(meta.get('message') or f'HTTP {resp.status_code}')
            return body
        raise ValueError('BrickLink rate limit exceeded after retries')

    try:
        body = try_fetch(item_number)
    except ValueError as first_err:
        # Retry with '-1' suffix for sets that require it (e.g. '2539' → '2539-1')
        if bl_type == 'SET' and not _re.search(r'-\d+$', item_number):
            body = try_fetch(item_number + '-1')  # raises if this also fails
        else:
            raise first_err

    d = body.get('data', {})
    min_price = float(d.get('min_price', 0) or 0)
    max_price = float(d.get('max_price', 0) or 0)
    currency  = d.get('currency_code', 'USD')

    # Parse price_detail into (qty, price) pairs
    raw_lots = []
    for entry in d.get('price_detail', []):
        try:
            qty   = int(entry.get('quantity', 1) or 1)
            price = round(float(entry.get('unit_price', 0) or 0), 4)
            if price > 0:
                raw_lots.append((qty, price))
        except (ValueError, TypeError):
            continue

    # Outlier filtering: discard lots priced below 50% of the raw median
    outliers_removed = 0
    if filter_outliers and raw_lots:
        raw_expanded = []
        for qty, price in raw_lots:
            raw_expanded.extend([price] * qty)
        raw_expanded.sort()
        mid_r = len(raw_expanded) // 2
        raw_median = raw_expanded[mid_r] if len(raw_expanded) % 2 else (raw_expanded[mid_r - 1] + raw_expanded[mid_r]) / 2
        cutoff = raw_median * 0.50
        filtered_lots = [(qty, price) for qty, price in raw_lots if price >= cutoff]
        outliers_removed = len(raw_lots) - len(filtered_lots)
        lots = filtered_lots if filtered_lots else raw_lots
    else:
        lots = raw_lots

    # Quantity-weighted average and median
    expanded, detail_out = [], []
    total_qty, total_value = 0, 0.0
    for qty, price in lots:
        expanded.extend([price] * qty)
        detail_out.append({'quantity': qty, 'unit_price': price})
        total_qty   += qty
        total_value += qty * price

    avg_price = (total_value / total_qty) if total_qty > 0 else float(d.get('avg_price', 0) or 0)

    if expanded:
        expanded.sort()
        mid = len(expanded) // 2
        median_price = expanded[mid] if len(expanded) % 2 else (expanded[mid - 1] + expanded[mid]) / 2
    else:
        median_price = avg_price

    if lots:
        min_price = min(p for _, p in lots)
        max_price = max(p for _, p in lots)

    return {
        'avg':             round(avg_price, 2),
        'median':          round(median_price, 2),
        'min':             round(min_price, 2),
        'max':             round(max_price, 2),
        'unitQuantity':    total_qty or int(d.get('unit_quantity', 0) or 0),
        'currencyCode':    currency,
        'countryCode':     country_code or 'worldwide',
        'guideType':       guide_type,
        'newOrUsed':       new_or_used,
        'priceDetail':     detail_out,
        'outliersRemoved': outliers_removed,
    }


@app.route('/api/bricklink/price')
def bricklink_price():
    """
    Fetch one price guide (sold or stock) for an item from BrickLink.
    Query params: type (set|minifig|part), itemNumber, guide (sold|stock), newOrUsed (N|U)
    Returns: { avg, median, min, max, unitQuantity, currencyCode, priceDetail, outliersRemoved } or { error }
    """
    item_type       = request.args.get('type', 'set').lower()
    item_number     = request.args.get('itemNumber', '').strip()
    guide_type      = request.args.get('guide', 'sold')
    new_or_used     = request.args.get('newOrUsed', 'U')
    color_id        = request.args.get('colorId', '').strip()
    filter_outliers = request.args.get('filterOutliers', 'false').lower() == 'true'
    country_code    = request.args.get('countryCode', 'US').strip().upper()

    if not item_number:
        return jsonify({'error': 'itemNumber is required'}), 400

    creds = get_bl_creds()
    if not creds:
        missing = missing_bl_credential_fields()
        detail = f" Missing: {', '.join(missing)}." if missing else ''
        return jsonify({'error': f'BrickLink API credentials not configured.{detail}', 'missingFields': missing}), 400

    consumer_key, consumer_secret, token, token_secret = creds
    type_map = {'set': 'SET', 'minifig': 'MINIFIG', 'part': 'PART'}
    bl_type, _ = normalise_bl_listing_item(type_map.get(item_type, 'SET'), item_number)
    auth = OAuth1(consumer_key, consumer_secret, token, token_secret)

    try:
        result = _bl_fetch_price_guide(bl_type, item_number, auth, guide_type,
                                       new_or_used, country_code, color_id, filter_outliers)
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/bricklink/prices')
def bricklink_prices():
    """
    Fetch both sold and active (stock) price guides for an item in a single call.
    Query params: type (set|minifig|part), itemNumber, newOrUsed (N|U),
                  filterOutliers (true|false), countryCode
    Returns: { sold: { avg, median, ... }, active: { avg, median, ... } }
    Either key may be null if that guide returned no data or errored.
    """
    item_type       = request.args.get('type', 'set').lower()
    item_number     = request.args.get('itemNumber', '').strip()
    new_or_used     = request.args.get('newOrUsed', 'U')
    color_id        = request.args.get('colorId', '').strip()
    filter_outliers = request.args.get('filterOutliers', 'false').lower() == 'true'
    country_code    = request.args.get('countryCode', 'US').strip().upper()

    if not item_number:
        return jsonify({'error': 'itemNumber is required'}), 400

    creds = get_bl_creds()
    if not creds:
        missing = missing_bl_credential_fields()
        detail = f" Missing: {', '.join(missing)}." if missing else ''
        return jsonify({'error': f'BrickLink API credentials not configured.{detail}', 'missingFields': missing}), 400

    consumer_key, consumer_secret, token, token_secret = creds
    type_map = {'set': 'SET', 'minifig': 'MINIFIG', 'part': 'PART'}
    bl_type, _ = normalise_bl_listing_item(type_map.get(item_type, 'SET'), item_number)
    auth = OAuth1(consumer_key, consumer_secret, token, token_secret)

    sold_result   = None
    active_result = None
    sold_error    = None
    active_error  = None

    # Sold and active guides are independent BrickLink calls — run them concurrently
    # instead of back-to-back to cut this endpoint's latency roughly in half.
    with ThreadPoolExecutor(max_workers=2) as pool:
        sold_future   = pool.submit(_bl_fetch_price_guide, bl_type, item_number, auth, 'sold',
                                     new_or_used, country_code, color_id, filter_outliers)
        active_future = pool.submit(_bl_fetch_price_guide, bl_type, item_number, auth, 'stock',
                                     new_or_used, country_code, color_id, filter_outliers)
        try:
            sold_result = sold_future.result()
        except Exception as e:
            sold_error = str(e)
        try:
            active_result = active_future.result()
        except Exception as e:
            active_error = str(e)

    # Only hard-fail if both guides errored
    if sold_result is None and active_result is None:
        return jsonify({'error': '; '.join(filter(None, [sold_error, active_error]))}), 500

    return jsonify({
        'sold':        sold_result,
        'active':      active_result,
        'soldError':   sold_error,
        'activeError': active_error,
    })


# ─── BrickLink subsets (minifigs/parts contained in a set) ───
@app.route('/api/bricklink/subsets')
def bricklink_subsets():
    """
    Fetch the contents of a set — returns only minifig entries.
    Query params: itemNumber
    Returns: { minifigs: [{ itemNumber, name, qty }] }
    """
    item_number = request.args.get('itemNumber', '').strip()

    if not item_number:
        return jsonify({'error': 'itemNumber is required'}), 400

    creds = get_bl_creds()
    if not creds:
        return jsonify(bl_credentials_error()), 400

    consumer_key, consumer_secret, token, token_secret = creds
    auth = OAuth1(consumer_key, consumer_secret, token, token_secret)

    # BrickLink set numbers need the -1 suffix
    import re as _re
    bl_number = item_number if _re.search(r'-\d+$', item_number) else item_number + '-1'

    try:
        url  = f'https://api.bricklink.com/api/store/v1/items/SET/{bl_number}/subsets'
        resp = req.get(url, auth=auth, timeout=10)
        body = resp.json()
        meta = body.get('meta', {})
        if resp.status_code != 200 or meta.get('code') != 200:
            return jsonify({'minifigs': []})

        entries = body.get('data', []) or []
        minifigs = []
        for entry in entries:
            for appearance in (entry.get('entries') or []):
                item = appearance.get('item', {})
                if item.get('type', '').upper() != 'MINIFIG':
                    continue
                item_no = item.get('no', '')
                name    = clean_name(item.get('name', ''))
                qty     = appearance.get('quantity', 1)
                if item_no:
                    minifigs.append({'itemNumber': item_no, 'name': name, 'qty': qty})

        minifigs.sort(key=lambda r: r['itemNumber'])
        return jsonify({'minifigs': minifigs})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ─── BrickLink minifig value for a set ───
@app.route('/api/bricklink/minifig-value')
def bricklink_minifig_value():
    """
    For a given set, fetch its minifig list then price each minifig.
    Returns: { minifigs: [{ itemNumber, name, qty, price }], totalValue: float }
    """
    item_number  = request.args.get('itemNumber', '').strip()
    new_or_used  = request.args.get('newOrUsed', 'U')
    country_code = request.args.get('countryCode', 'US').strip().upper()

    if not item_number:
        return jsonify({'error': 'itemNumber is required'}), 400

    creds = get_bl_creds()
    if not creds:
        return jsonify(bl_credentials_error()), 400

    consumer_key, consumer_secret, token, token_secret = creds
    auth    = OAuth1(consumer_key, consumer_secret, token, token_secret)
    import re as _re
    bl_number = item_number if _re.search(r'-\d+$', item_number) else item_number + '-1'

    # Step 1: get minifig list
    try:
        url  = f'https://api.bricklink.com/api/store/v1/items/SET/{bl_number}/subsets'
        resp = req.get(url, auth=auth, timeout=10)
        body = resp.json()
        if resp.status_code != 200 or body.get('meta', {}).get('code') != 200:
            return jsonify({'minifigs': [], 'totalValue': 0})
        entries  = body.get('data', []) or []
        minifigs = []
        for entry in entries:
            for appearance in (entry.get('entries') or []):
                item = appearance.get('item', {})
                if item.get('type', '').upper() != 'MINIFIG':
                    continue
                item_no = item.get('no', '')
                name    = clean_name(item.get('name', ''))
                qty     = appearance.get('quantity', 1)
                if item_no:
                    minifigs.append({'itemNumber': item_no, 'name': name, 'qty': qty, 'price': None})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

    if not minifigs:
        return jsonify({'minifigs': [], 'totalValue': 0})

    # Step 2: price each minifig — fetch both sold and stock guides, compute
    # the same outlier-filtered median used by /api/bricklink/price so the
    # suggested price matches the price guide exactly.
    total_value = 0.0
    base_params = {'new_or_used': new_or_used, 'currency_code': 'USD'}
    if country_code:
        base_params['country_code'] = country_code

    for fig in minifigs:
        price_url   = f'https://api.bricklink.com/api/store/v1/items/MINIFIG/{fig["itemNumber"]}/price'
        sold_median = None
        active_median = None
        active_min  = None

        try:
            sold_resp = req.get(price_url, params={**base_params, 'guide_type': 'sold'}, auth=auth, timeout=10)
            sold_body = sold_resp.json()
            if sold_resp.status_code == 200 and sold_body.get('meta', {}).get('code') == 200:
                sold_median, _, _ = bl_price_guide_stats(sold_body.get('data', {}), filter_outliers=True)
        except Exception:
            pass

        try:
            stock_resp = req.get(price_url, params={**base_params, 'guide_type': 'stock'}, auth=auth, timeout=10)
            stock_body = stock_resp.json()
            if stock_resp.status_code == 200 and stock_body.get('meta', {}).get('code') == 200:
                active_median, _, active_min = bl_price_guide_stats(stock_body.get('data', {}), filter_outliers=True)
        except Exception:
            pass

        fig['soldMedian']   = sold_median
        fig['activeMedian'] = active_median
        fig['activeMin']    = active_min
        fig['price']        = sold_median  # backward compat

        # Compute suggested price using the same formula as the frontend suggestedPrice()
        # so the value shown in the modal matches the price guide.
        # Formula: blend sold median (1/3) + active median (2/3), floor at activeMin * 0.97
        if sold_median or active_median:
            blend = None
            if sold_median and active_median:
                blend = round(sold_median * (1/3) + active_median * (2/3), 2)
            elif active_median:
                blend = active_median
            else:
                blend = sold_median
            if active_min and blend and blend < active_min * 0.97:
                blend = round(active_min * 0.97, 2)
            fig['suggestedPrice'] = blend
            if blend:
                total_value += blend * fig['qty']
        else:
            fig['suggestedPrice'] = None

    return jsonify({'minifigs': minifigs, 'totalValue': round(total_value, 2)})


# ─── BrickLink supersets (which sets contain this item) ───
@app.route('/api/bricklink/supersets')
def bricklink_supersets():
    """
    Fetch the sets that contain a given minifig or part.
    Query params: type (minifig|part), itemNumber
    Returns: { supersets: [{ setNumber, name, qty }] }
    """
    item_type   = request.args.get('type', 'minifig').lower()
    item_number = request.args.get('itemNumber', '').strip()
    color_id    = request.args.get('colorId', '').strip()

    if not item_number:
        return jsonify({'error': 'itemNumber is required'}), 400

    creds = get_bl_creds()
    if not creds:
        return jsonify(bl_credentials_error()), 400

    consumer_key, consumer_secret, token, token_secret = creds
    auth     = OAuth1(consumer_key, consumer_secret, token, token_secret)
    type_map = {'minifig': 'MINIFIG', 'part': 'PART', 'set': 'SET'}
    bl_type  = type_map.get(item_type, 'MINIFIG')

    try:
        url    = f'https://api.bricklink.com/api/store/v1/items/{bl_type}/{item_number}/supersets'
        params = {'color_id': color_id} if color_id else {}
        resp = req.get(url, auth=auth, params=params, timeout=10)
        body = resp.json()
        meta = body.get('meta', {})
        if resp.status_code != 200 or meta.get('code') != 200:
            return jsonify({'supersets': []})  # not found = no supersets, not an error

        entries = body.get('data', []) or []
        result  = []
        for entry in entries:
            for appearance in (entry.get('entries') or []):
                parent = appearance.get('item', {})
                set_no = parent.get('no', '')
                name   = clean_name(parent.get('name', ''))
                qty    = appearance.get('quantity', 1)
                if set_no:
                    result.append({'setNumber': set_no, 'name': name, 'qty': qty})

        # Sort by set number
        result.sort(key=lambda r: r['setNumber'])
        return jsonify({'supersets': result})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ─── BrickLink store inventory price update ───

@app.route('/api/bricklink/store/inventory')
def bl_store_inventory():
    """
    Fetch store inventory for a specific item.
    Query params: type (set|minifig|part), itemNumber, colorId (optional)
    Returns: { inventories: [{inventory_id, item_number, color_id, quantity, price, condition}] }
    """
    item_type   = request.args.get('type', 'set').lower()
    item_number = request.args.get('itemNumber', '').strip()
    color_id    = request.args.get('colorId', '').strip()

    if not item_number:
        return jsonify({'error': 'itemNumber is required'}), 400

    creds = get_bl_creds()
    if not creds:
        return jsonify(bl_credentials_error()), 400

    consumer_key, consumer_secret, token, token_secret = creds
    auth     = OAuth1(consumer_key, consumer_secret, token, token_secret)
    type_map = {'set': 'SET', 'minifig': 'MINIFIG', 'part': 'PART'}
    bl_type  = type_map.get(item_type, 'SET')

    try:
        params = {'item_type': bl_type, 'status': 'Y'}  # Y = for sale
        resp = req.get('https://api.bricklink.com/api/store/v1/inventories', auth=auth, params=params, timeout=10)
        body = resp.json()
        meta = body.get('meta', {})
        if resp.status_code != 200 or meta.get('code') != 200:
            return jsonify({'error': meta.get('message') or f'HTTP {resp.status_code}'}), resp.status_code

        all_inv = body.get('data', []) or []
        # Match item number tolerantly for normal numeric set-number suffixes only.
        # e.g. query "2538" should match store item "2538-1", but collectible
        # minifigure set IDs like "col17-9" must not match "col17-3".
        import re as _re
        def numbers_match(store_no, query_no):
            s = store_no.upper()
            q = query_no.upper()
            if s == q:
                return True
            if bl_type != 'SET':
                return False
            s_base = _re.sub(r'-\d+$', '', s)
            q_base = _re.sub(r'-\d+$', '', q)
            return s_base == q_base and s_base.isdigit()

        # Filter to matching item number (and color if provided)
        matches = []
        for inv in all_inv:
            item = inv.get('item', {})
            if not numbers_match(item.get('no', ''), item_number):
                continue
            if color_id and str(inv.get('color_id', '')) != str(color_id):
                continue
            matches.append({
                'inventory_id': inv.get('inventory_id'),
                'item_number':  item.get('no'),
                'color_id':     inv.get('color_id'),
                'quantity':     inv.get('quantity'),
                'price':        float(inv.get('unit_price', 0) or 0),
                'condition':    inv.get('new_or_used'),  # 'N' or 'U'
                'description':  inv.get('description', ''),
            })

        return jsonify({'inventories': matches})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/bricklink/store/inventory/all')
def bl_store_inventory_all():
    """
    Fetch ALL store inventory items across available, stockroom, unavailable, and reserved statuses.
    Returns: { inventories: [{inventory_id, item_number, item_type, color_id, quantity, price, condition, description}] }
    """
    creds = get_bl_creds()
    if not creds:
        return jsonify(bl_credentials_error()), 400

    consumer_key, consumer_secret, token, token_secret = creds
    auth = OAuth1(consumer_key, consumer_secret, token, token_secret)

    try:
        resp = req.get('https://api.bricklink.com/api/store/v1/inventories',
                       auth=auth, params={'status': 'Y,S,B,C,N,R'}, timeout=30)
        try:
            body = resp.json()
        except ValueError:
            return jsonify({'error': f'BrickLink returned HTTP {resp.status_code}: {resp.text[:200]}'}), resp.status_code
        meta = body.get('meta', {})
        if resp.status_code != 200 or meta.get('code') != 200:
            message = meta.get('message') or f'HTTP {resp.status_code}'
            description = meta.get('description')
            if description and description != message:
                message = f'{message}: {description}'
            return jsonify({'error': message, 'meta': meta}), resp.status_code

        all_inv = body.get('data', []) or []
        result = []
        for inv in all_inv:
            item = inv.get('item', {})
            bl_type = item.get('type', '').upper()
            type_map_rev = {
                'SET': 'set',
                'MINIFIG': 'minifig',
                'PART': 'part',
                'GEAR': 'gear',
                'BOOK': 'book',
                'CATALOG': 'catalog',
                'INSTRUCTION': 'instruction',
            }
            item_type = type_map_rev.get(bl_type, bl_type.lower() or 'set')
            catalog_entry = catalog_entry_for_item(item_type, item.get('no', '')) or {}
            category_id = str(item.get('category_id', '') or catalog_entry.get('categoryId', '') or '')
            category_name = (
                _categories.get(category_id, {}).get('name', '') or
                item.get('category_name', '') or
                catalog_entry.get('theme', '')
            )
            result.append({
                'inventory_id': inv.get('inventory_id'),
                'item_number':  item.get('no', ''),
                'item_type':    item_type,
                'category_id':  category_id,
                'category_name': category_name,
                'color_id':     str(inv.get('color_id', '') or ''),
                'color_name':   inv.get('color_name', '') or _colors.get(str(inv.get('color_id', '') or ''), {}).get('name', ''),
                'quantity':     inv.get('quantity', 1),
                'price':        float(inv.get('unit_price', 0) or 0),
                'condition':    inv.get('new_or_used', 'U'),  # 'N' or 'U'
                'status':       inv.get('status', ''),
                'is_stock_room': bool(inv.get('is_stock_room', False)),
                'stock_room_id': inv.get('stock_room_id', ''),
                'description':  inv.get('description', ''),
            })

        cache_payload = save_bricklink_store_cache(result)
        return jsonify({'inventories': result, 'total': len(result), 'cached_at': cache_payload.get('cached_at'), 'from_cache': False})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/bricklink/store/inventory/cache')
def bl_store_inventory_cache():
    """Return the last successfully fetched BrickLink store inventory."""
    cache = load_bricklink_store_cache()
    return jsonify({
        'inventories': cache.get('inventories', []) or [],
        'total': cache.get('total', len(cache.get('inventories', []) or [])),
        'cached_at': cache.get('cached_at'),
        'from_cache': True,
    })


def _bl_money(value):
    try:
        return round(float(value), 4)
    except (TypeError, ValueError):
        return None


def _bl_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _bl_order_summary(order):
    cost = order.get('cost', {}) or {}
    payment = order.get('payment', {}) or {}
    seller_cost = order.get('seller_cost', {}) or {}
    return {
        'orderId': order.get('order_id'),
        'dateOrdered': order.get('date_ordered'),
        'dateStatusChanged': order.get('date_status_changed'),
        'status': order.get('status', ''),
        'buyerName': order.get('buyer_name', ''),
        'buyerEmail': order.get('buyer_email', ''),
        'totalCount': _bl_int(order.get('total_count'), 0),
        'uniqueCount': _bl_int(order.get('unique_count'), 0),
        'subtotal': _bl_money(cost.get('subtotal')),
        'grandTotal': _bl_money(cost.get('grandtotal')),
        'feeTotal': _bl_money(
            seller_cost.get('final_value_fee')
            or seller_cost.get('fee')
            or seller_cost.get('total')
            or seller_cost.get('grandtotal')
        ),
        'currencyCode': cost.get('currency_code') or payment.get('currency_code') or 'USD',
        'paymentStatus': payment.get('status', ''),
        'paymentMethod': payment.get('method', ''),
        'datePaid': payment.get('date_paid'),
    }


def _bl_order_item_payload(raw_item, batch_index):
    item = raw_item.get('item', {}) or {}
    raw_type = (item.get('type') or raw_item.get('item_type') or '').upper()
    type_map = {
        'SET': 'set',
        'MINIFIG': 'minifig',
        'PART': 'part',
        'GEAR': 'gear',
        'BOOK': 'book',
        'CATALOG': 'catalog',
        'INSTRUCTION': 'instruction',
    }
    item_type = type_map.get(raw_type, raw_type.lower() or 'set')
    color_id = str(raw_item.get('color_id', '') or '')
    color_data = _colors.get(color_id, {}) if color_id else {}
    return {
        'batchIndex': batch_index,
        'inventoryId': raw_item.get('inventory_id'),
        'itemNumber': item.get('no', '') or raw_item.get('item_number', ''),
        'itemType': item_type,
        'name': clean_name(item.get('name', '') or raw_item.get('item_name', '')),
        'categoryId': str(item.get('category_id', '') or raw_item.get('category_id', '') or ''),
        'colorId': color_id,
        'colorName': raw_item.get('color_name', '') or color_data.get('name', ''),
        'colorHex': color_data.get('hex', ''),
        'quantity': max(1, _bl_int(raw_item.get('quantity'), 1)),
        'unitPrice': _bl_money(raw_item.get('unit_price')),
        'condition': raw_item.get('new_or_used', '') or raw_item.get('condition', ''),
        'description': raw_item.get('description', '') or '',
        'remarks': raw_item.get('remarks', '') or '',
    }


@app.route('/api/bricklink/orders')
def bl_orders():
    """Return recent incoming BrickLink orders for quick selection in the UI."""
    creds = get_bl_creds()
    if not creds:
        return jsonify(bl_credentials_error()), 400

    consumer_key, consumer_secret, token, token_secret = creds
    auth = OAuth1(consumer_key, consumer_secret, token, token_secret)
    try:
        limit = max(1, min(100, int(request.args.get('limit', 20) or 20)))
    except (TypeError, ValueError):
        limit = 20

    params = {'direction': 'in'}
    status = request.args.get('status', '').strip()
    if status:
        params['status'] = status

    try:
        resp = req.get('https://api.bricklink.com/api/store/v1/orders', auth=auth, params=params, timeout=20)
        body = resp.json()
        meta = body.get('meta', {})
        if resp.status_code != 200 or meta.get('code') != 200:
            message = meta.get('message') or f'HTTP {resp.status_code}'
            description = meta.get('description')
            if description and description != message:
                message = f'{message}: {description}'
            return jsonify({'error': message, 'meta': meta}), resp.status_code

        orders = body.get('data', []) or []
        orders.sort(key=lambda order: order.get('date_ordered') or '', reverse=True)
        result = [_bl_order_summary(order) for order in orders[:limit]]
        return jsonify({'orders': result, 'total': len(result)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/bricklink/orders/<order_id>')
def bl_order_detail(order_id):
    """Return a normalised BrickLink order detail payload including line items."""
    creds = get_bl_creds()
    if not creds:
        return jsonify(bl_credentials_error()), 400

    consumer_key, consumer_secret, token, token_secret = creds
    auth = OAuth1(consumer_key, consumer_secret, token, token_secret)

    try:
        order_resp = req.get(f'https://api.bricklink.com/api/store/v1/orders/{order_id}', auth=auth, timeout=20)
        order_body = order_resp.json()
        order_meta = order_body.get('meta', {})
        if order_resp.status_code != 200 or order_meta.get('code') != 200:
            message = order_meta.get('message') or f'HTTP {order_resp.status_code}'
            description = order_meta.get('description')
            if description and description != message:
                message = f'{message}: {description}'
            return jsonify({'error': message, 'meta': order_meta}), order_resp.status_code

        items_resp = req.get(f'https://api.bricklink.com/api/store/v1/orders/{order_id}/items', auth=auth, timeout=20)
        items_body = items_resp.json()
        items_meta = items_body.get('meta', {})
        if items_resp.status_code != 200 or items_meta.get('code') != 200:
            message = items_meta.get('message') or f'HTTP {items_resp.status_code}'
            description = items_meta.get('description')
            if description and description != message:
                message = f'{message}: {description}'
            return jsonify({'error': message, 'meta': items_meta}), items_resp.status_code

        batches = items_body.get('data', []) or []
        normalised_items = []
        for batch_index, batch in enumerate(batches):
            if isinstance(batch, dict):
                entries = batch.get('entries') or batch.get('items') or []
            else:
                entries = batch if isinstance(batch, list) else []
            for raw_item in entries:
                if isinstance(raw_item, dict):
                    normalised_items.append(_bl_order_item_payload(raw_item, batch_index))

        order = _bl_order_summary(order_body.get('data', {}) or {})
        order['shippingCost'] = _bl_money(((order_body.get('data', {}) or {}).get('cost', {}) or {}).get('shipping'))
        order['remarks'] = (order_body.get('data', {}) or {}).get('remarks', '') or ''
        order['items'] = normalised_items
        return jsonify(order)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/bricklink/store/create-listing', methods=['POST'])
def bl_store_create_listing():
    """
    Create a new listing in the BrickLink store.
    Body: { item_type, item_number, color_id, quantity, price, condition, description, remarks }
      condition: 'N' or 'U'
    Returns: { ok: true, inventory_id } or { error }
    """
    body        = request.get_json(force=True) or {}
    payload, error, status = build_bl_listing_payload(body)
    if error:
        return jsonify({'error': error}), status

    creds = get_bl_creds()
    if not creds:
        return jsonify(bl_credentials_error()), 400

    consumer_key, consumer_secret, token, token_secret = creds
    auth = OAuth1(consumer_key, consumer_secret, token, token_secret)

    if body.get('dry_run'):
        return jsonify({'ok': True, 'dryRun': True, 'request': payload})

    try:
        resp = req.post(
            'https://api.bricklink.com/api/store/v1/inventories',
            auth=auth,
            headers={'Content-Type': 'application/json'},
            data=json.dumps(payload),
            timeout=10
        )
        data = resp.json()
        meta = data.get('meta', {})
        if resp.status_code not in (200, 201) or meta.get('code') not in (200, 201):
            message = meta.get('message') or f'HTTP {resp.status_code}'
            description = meta.get('description')
            if description and description != message:
                message = f'{message}: {description}'
            return jsonify({'error': message, 'meta': meta, 'request': payload}), resp.status_code
        inventory_id = (data.get('data') or {}).get('inventory_id')
        return jsonify({'ok': True, 'inventory_id': inventory_id})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/bricklink/store/create-listings-bulk', methods=['POST'])
def bl_store_create_listings_bulk():
    """
    Create multiple new BrickLink store listings from one local request.
    Body: { listings: [{ client_id, item_type, item_number, color_id, quantity, price, condition, completeness, description, remarks }] }
    Returns: { ok, created: [{ client_id, inventory_id }], failed: [{ client_id, error }] }
    """
    body = request.get_json(force=True) or {}
    listings = body.get('listings') or []
    if not isinstance(listings, list) or not listings:
        return jsonify({'error': 'listings must be a non-empty array'}), 400

    creds = get_bl_creds()
    if not creds:
        return jsonify(bl_credentials_error()), 400

    consumer_key, consumer_secret, token, token_secret = creds
    auth = OAuth1(consumer_key, consumer_secret, token, token_secret)
    created = []
    failed = []

    for idx, listing in enumerate(listings):
        client_id = listing.get('client_id') or listing.get('id') or str(idx)
        payload, error, _status = build_bl_listing_payload(listing)
        if error:
            failed.append({'client_id': client_id, 'error': error})
            continue

        try:
            resp = req.post(
                'https://api.bricklink.com/api/store/v1/inventories',
                auth=auth,
                headers={'Content-Type': 'application/json'},
                data=json.dumps(payload),
                timeout=10
            )
            data = resp.json()
            meta = data.get('meta', {})
            if resp.status_code not in (200, 201) or meta.get('code') not in (200, 201):
                message = meta.get('message') or f'HTTP {resp.status_code}'
                description = meta.get('description')
                if description and description != message:
                    message = f'{message}: {description}'
                failed.append({'client_id': client_id, 'error': message, 'request': payload})
                continue
            inventory_id = (data.get('data') or {}).get('inventory_id')
            created.append({'client_id': client_id, 'inventory_id': inventory_id})
        except Exception as e:
            failed.append({'client_id': client_id, 'error': str(e)})

    return jsonify({'ok': len(failed) == 0, 'created': created, 'failed': failed})


@app.route('/api/bricklink/store/update-price', methods=['POST'])
def bl_store_update_price():
    """
    Update the price of a store inventory item.
    Body: { inventory_id, price }
    Returns: { ok: true } or { error }
    """
    body         = request.get_json(force=True) or {}
    inventory_id = body.get('inventory_id')
    price        = body.get('price')

    if not inventory_id or price is None:
        return jsonify({'error': 'inventory_id and price are required'}), 400

    creds = get_bl_creds()
    if not creds:
        return jsonify(bl_credentials_error()), 400

    consumer_key, consumer_secret, token, token_secret = creds
    auth = OAuth1(consumer_key, consumer_secret, token, token_secret)

    try:
        url  = f'https://api.bricklink.com/api/store/v1/inventories/{inventory_id}'
        payload = {'unit_price': str(round(float(price), 4))}
        resp = req.put(
            url,
            auth=auth,
            headers={'Content-Type': 'application/json'},
            data=json.dumps(payload),
            timeout=10
        )
        body = resp.json()
        meta = body.get('meta', {})
        if resp.status_code != 200 or meta.get('code') != 200:
            message = meta.get('message') or f'HTTP {resp.status_code}'
            description = meta.get('description')
            if description and description != message:
                message = f'{message}: {description}'
            return jsonify({'error': message, 'meta': meta, 'request': payload}), resp.status_code
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/bricklink/store/stockroom', methods=['POST'])
def bl_store_stockroom():
    """
    Move a store inventory item into or out of the stockroom.
    Body: { inventory_id, stockroom: true|false }
    Returns: { ok: true } or { error }
    """
    body         = request.get_json(force=True) or {}
    inventory_id = body.get('inventory_id')
    stockroom    = body.get('stockroom', True)

    if not inventory_id:
        return jsonify({'error': 'inventory_id is required'}), 400

    creds = get_bl_creds()
    if not creds:
        return jsonify(bl_credentials_error()), 400

    consumer_key, consumer_secret, token, token_secret = creds
    auth = OAuth1(consumer_key, consumer_secret, token, token_secret)

    try:
        url     = f'https://api.bricklink.com/api/store/v1/inventories/{inventory_id}'
        payload = {'is_stock_room': bool(stockroom)}
        resp    = req.put(
            url,
            auth=auth,
            headers={'Content-Type': 'application/json'},
            data=json.dumps(payload),
            timeout=10
        )
        data = resp.json()
        meta = data.get('meta', {})
        if resp.status_code != 200 or meta.get('code') != 200:
            message     = meta.get('message') or f'HTTP {resp.status_code}'
            description = meta.get('description')
            if description and description != message:
                message = f'{message}: {description}'
            return jsonify({'error': message, 'meta': meta}), resp.status_code
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/bricklink/store/remove-listing', methods=['POST'])
def bl_store_remove_listing():
    """
    Remove an inventory item from the BrickLink store.
    Body: { inventory_id }
    Returns: { ok: true } or { error }
    """
    body = request.get_json(force=True) or {}
    inventory_id = body.get('inventory_id')

    if not inventory_id:
        return jsonify({'error': 'inventory_id is required'}), 400

    creds = get_bl_creds()
    if not creds:
        return jsonify(bl_credentials_error()), 400

    consumer_key, consumer_secret, token, token_secret = creds
    auth = OAuth1(consumer_key, consumer_secret, token, token_secret)

    try:
        url = f'https://api.bricklink.com/api/store/v1/inventories/{inventory_id}'
        resp = req.delete(url, auth=auth, timeout=10)
        try:
            body = resp.json()
        except ValueError:
            body = {}
        meta = body.get('meta', {})
        if resp.status_code not in (200, 204) or (meta and meta.get('code') not in (200, 204)):
            message = meta.get('message') or f'HTTP {resp.status_code}'
            description = meta.get('description')
            if description and description != message:
                message = f'{message}: {description}'
            return jsonify({'error': message, 'meta': meta}), resp.status_code
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/bricklink/store/update-quantity', methods=['POST'])
def bl_store_update_quantity():
    """
    Update the quantity of a store inventory item.
    If the new quantity is 0, the listing is deleted entirely.
    Body: { inventory_id, quantity }
    Returns: { ok: true, deleted: bool } or { error }
    """
    body         = request.get_json(force=True) or {}
    inventory_id = body.get('inventory_id')
    quantity     = body.get('quantity')   # delta to send to BL API
    new_quantity = body.get('new_quantity')  # absolute new qty; if <= 0, delete instead

    if not inventory_id or quantity is None:
        return jsonify({'error': 'inventory_id and quantity are required'}), 400

    quantity = int(quantity)
    # Use new_quantity to decide whether to delete; fall back to quantity for backwards compat
    delete_threshold = int(new_quantity) if new_quantity is not None else quantity

    creds = get_bl_creds()
    if not creds:
        return jsonify(bl_credentials_error()), 400

    consumer_key, consumer_secret, token, token_secret = creds
    auth = OAuth1(consumer_key, consumer_secret, token, token_secret)

    url = f'https://api.bricklink.com/api/store/v1/inventories/{inventory_id}'

    try:
        if delete_threshold <= 0:
            # Delete the listing entirely
            resp = req.delete(url, auth=auth, timeout=10)
            try:
                rbody = resp.json()
            except ValueError:
                rbody = {}
            meta = rbody.get('meta', {})
            if resp.status_code not in (200, 204) or (meta and meta.get('code') not in (200, 204)):
                message = meta.get('message') or f'HTTP {resp.status_code}'
                description = meta.get('description')
                if description and description != message:
                    message = f'{message}: {description}'
                return jsonify({'error': message, 'meta': meta}), resp.status_code
            return jsonify({'ok': True, 'deleted': True})
        else:
            # Update quantity in place
            payload = {'quantity': quantity}
            resp = req.put(
                url,
                auth=auth,
                headers={'Content-Type': 'application/json'},
                data=json.dumps(payload),
                timeout=10
            )
            rbody = resp.json()
            meta = rbody.get('meta', {})
            if resp.status_code != 200 or meta.get('code') != 200:
                message = meta.get('message') or f'HTTP {resp.status_code}'
                description = meta.get('description')
                if description and description != message:
                    message = f'{message}: {description}'
                return jsonify({'error': message, 'meta': meta, 'request': payload}), resp.status_code
            return jsonify({'ok': True, 'deleted': False})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ─── eBay Browse API proxy (active listings, OAuth Client Credentials) ───

def get_ebay_creds():
    cfg = load_config()
    eb  = cfg.get('ebay', {})
    app_id  = eb.get('appId',  '').strip()
    cert_id = eb.get('certId', '').strip()
    return (app_id, cert_id) if app_id and cert_id else (None, None)

def get_ebay_app_id():
    app_id, _ = get_ebay_creds()
    return app_id

# Simple in-memory token cache
_ebay_token_cache = {}

def get_ebay_access_token(app_id, cert_id):
    import time, base64
    now = time.time()
    cached = _ebay_token_cache.get('token')
    if cached and _ebay_token_cache.get('expires_at', 0) > now + 60:
        return cached
    credentials = base64.b64encode(f'{app_id}:{cert_id}'.encode()).decode()
    resp = req.post(
        'https://api.ebay.com/identity/v1/oauth2/token',
        headers={'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': f'Basic {credentials}'},
        data='grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
        timeout=10,
    )
    body = resp.json()
    if not resp.ok or 'access_token' not in body:
        raise ValueError(body.get('error_description') or body.get('error') or f'Token error: {resp.status_code}')
    token = body['access_token']
    _ebay_token_cache['token']      = token
    _ebay_token_cache['expires_at'] = now + int(body.get('expires_in', 7200))
    return token

@app.route('/api/ebay/price')
def ebay_price():
    """
    Search eBay active listings for a LEGO item via Browse API.
    Query params: query (search string), limit (default 10)
    Returns: { avg, min, max, count, items: [{title, price, shipping, total, url}] } or { error }
    """
    query = request.args.get('query', '').strip()
    limit = min(int(request.args.get('limit', '10')), 50)

    if not query:
        return jsonify({'error': 'query is required'}), 400

    app_id, cert_id = get_ebay_creds()

    if not app_id or not cert_id:
        return jsonify({'error': 'eBay App ID and Cert ID not configured. Add them in Configuration.'}), 400

    try:
        token = get_ebay_access_token(app_id, cert_id)
    except ValueError as e:
        return jsonify({'error': f'eBay auth failed: {e}'}), 500

    try:
        resp = req.get(
            'https://api.ebay.com/buy/browse/v1/item_summary/search',
            headers={
                'Authorization': f'Bearer {token}',
                'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
                'Content-Type': 'application/json',
            },
            params={
                'q':      query,
                'limit':  limit,
                'filter': 'buyingOptions:{FIXED_PRICE}',
            },
            timeout=10,
        )
        if not resp.ok:
            try:
                err = resp.json()
                msg = err.get('errors', [{}])[0].get('message', '') or f'HTTP {resp.status_code}'
            except Exception:
                msg = f'HTTP {resp.status_code}: {resp.text[:200]}'
            return jsonify({'error': msg}), resp.status_code

        raw_items = resp.json().get('itemSummaries', [])
        prices, items_out = [], []
        for it in raw_items:
            try:
                price = float(it.get('price', {}).get('value', 0) or 0)
                title = it.get('title', '')
                url   = it.get('itemWebUrl', '')
                shipping_cost = 0.0
                shipping_type = ''
                shipping_unknown = False
                for s in it.get('shippingOptions', []):
                    shipping_type = s.get('shippingCostType', '')
                    # CALCULATED = depends on buyer location, API returns 0 but it's not free.
                    # Always read the actual cost value for other types — the API sometimes
                    # reports shippingCostType=FREE while still providing a non-zero cost value.
                    if shipping_type == 'CALCULATED':
                        shipping_unknown = True
                        shipping_cost = 0.0
                    else:
                        shipping_cost = float(s.get('shippingCost', {}).get('value', 0) or 0)
                    break
                total = price + shipping_cost
                if price > 0:
                    prices.append(total)
                    items_out.append({
                        'title': title, 'price': round(price, 2),
                        'shipping': round(shipping_cost, 2),
                        'shippingType': shipping_type,
                        'shippingUnknown': shipping_unknown,
                        'total': round(total, 2), 'url': url,
                    })
            except (ValueError, TypeError):
                continue

        if not prices:
            return jsonify({'avg': None, 'min': None, 'max': None, 'count': 0, 'items': []})

        has_calculated = any(it.get('shippingUnknown') or it.get('shippingType') == 'CALCULATED' for it in items_out)
        item_prices = [it['price'] for it in items_out if it['price'] > 0]
        avg_item_only = round(sum(item_prices) / len(item_prices), 2) if item_prices else None

        return jsonify({
            'avg':           round(sum(prices) / len(prices), 2),
            'avgItemOnly':   avg_item_only,
            'hasCalculated': has_calculated,
            'min':           round(min(prices), 2),
            'max':           round(max(prices), 2),
            'count':         len(prices),
            'items':         items_out,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/config/ebay', methods=['POST'])
def api_config_ebay_post():
    """Save eBay App ID + Cert ID to config."""
    body    = request.get_json(force=True) or {}
    app_id  = (body.get('appId')  or '').strip()
    cert_id = (body.get('certId') or '').strip()
    if not app_id or not cert_id:
        return jsonify({'error': 'appId and certId are required'}), 400
    cfg = load_config()
    cfg['ebay'] = {'appId': app_id, 'certId': cert_id}
    save_config(cfg)
    _ebay_token_cache.clear()
    return jsonify({'ok': True, 'configured': True})

@app.route('/api/config/ebay', methods=['GET'])
def api_config_ebay_get():
    app_id, cert_id = get_ebay_creds()
    return jsonify({'configured': app_id is not None and cert_id is not None})


# ─── Data persistence ───
DATA_FILE = os.path.join(BASE_DIR, 'brickvault-data.json')

@app.route('/api/data/load', methods=['GET'])
def api_data_load():
    """Return saved inventory data, or empty structure if no file exists yet."""
    try:
        if os.path.isfile(DATA_FILE):
            with open(DATA_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
            return jsonify({'ok': True, 'data': data})
        else:
            return jsonify({'ok': True, 'data': None})   # no file yet — frontend uses localStorage
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

@app.route('/api/data/save', methods=['POST'])
def api_data_save():
    """Save inventory data to disk."""
    try:
        body = request.get_json(force=True)
        if body is None:
            return jsonify({'ok': False, 'error': 'No JSON body'}), 400
        with open(DATA_FILE, 'w', encoding='utf-8') as f:
            json.dump(body, f, indent=2, ensure_ascii=False)
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


# ─── Reddit r/legomarket proxy ───

REDDIT_POST_LIMIT     = 20           # number of posts to fetch / display
REDDIT_POST_BODY_TTL  = 2 * 3600    # seconds before a cached post body is considered stale

@app.route('/api/reddit/cached-posts')
def reddit_cached_posts():
    """Return the most recent cached Reddit posts immediately (no network call)."""
    cache = load_reddit_post_cache()
    posts = list(cache.values())
    # Sort newest-first by created_utc, then cap to the same limit used for fresh fetches
    posts.sort(key=lambda p: p.get('created_utc', 0), reverse=True)
    return jsonify({'posts': posts[:REDDIT_POST_LIMIT]})


@app.route('/api/reddit/legomarket')
def reddit_legomarket():
    """Proxy Reddit r/legomarket JSON API, caching post bodies to disk."""
    sort  = request.args.get('sort', 'new').lower()
    limit = min(int(request.args.get('limit', REDDIT_POST_LIMIT)), 100)
    after = request.args.get('after', '').strip()
    q     = request.args.get('q', '').strip()

    if sort not in ('new', 'hot', 'top', 'rising'):
        sort = 'new'

    try:
        if q:
            url_www = 'https://www.reddit.com/r/legomarket/search.json'
            url_old = 'https://old.reddit.com/r/legomarket/search.json'
            params  = {'q': q, 'restrict_sr': 1, 'sort': sort, 'limit': limit, 'raw_json': 1}
        else:
            url_www = f'https://www.reddit.com/r/legomarket/{sort}.json'
            url_old = f'https://old.reddit.com/r/legomarket/{sort}.json'
            params  = {'limit': limit, 'raw_json': 1}

        if after:
            params['after'] = after

        headers = {
            'User-Agent': 'python:BrickVault:1.0 (by /u/brickvault_app)',
            'Accept': 'application/json',
        }

        # Try old.reddit.com first — it's more permissive for unauthenticated JSON requests
        resp = req.get(url_old, params=params, headers=headers, timeout=15)
        if resp.status_code != 200:
            print(f'[Reddit] old.reddit.com returned HTTP {resp.status_code}, retrying via www.reddit.com…')
            resp = req.get(url_www, params=params, headers=headers, timeout=15)

        if resp.status_code != 200:
            print(f'[Reddit] Both endpoints failed. Status: {resp.status_code}. Body: {resp.text[:500]}')
            return jsonify({'error': f'Reddit returned HTTP {resp.status_code}. Reddit\'s unauthenticated API is unreliable — try again in a few minutes.'}), resp.status_code

        try:
            body = resp.json()
        except Exception:
            print(f'[Reddit] Non-JSON response ({resp.status_code}): {resp.text[:500]}')
            return jsonify({'error': f'Reddit returned a non-JSON response (HTTP {resp.status_code})'}), 502

        listing  = body.get('data', {})
        children = listing.get('children', [])
        post_cache = load_reddit_post_cache()
        now = time.time()
        posts    = []
        cache_updated = False

        for child in children:
            d = child.get('data', {})
            post_id  = d.get('id', '')
            selftext = d.get('selftext', '') or ''
            cached   = post_cache.get(post_id)

            # A cached body is only "fresh" if it was fetched within the TTL window
            cached_age = now - cached.get('cached_at', 0) if cached else float('inf')
            has_cached_body = (
                cached is not None and
                cached.get('selftext') and
                cached['selftext'] not in ('[removed]', '[deleted]', '') and
                cached_age < REDDIT_POST_BODY_TTL
            )

            post = {
                'id':           post_id,
                'title':        d.get('title', ''),
                'author':       d.get('author', ''),
                'score':        d.get('score', 0),
                'num_comments': d.get('num_comments', 0),
                'created_utc':  d.get('created_utc', 0),
                'permalink':    d.get('permalink', ''),
                'url':          d.get('url', ''),
                'flair':        d.get('link_flair_text', ''),
                'thumbnail':    d.get('thumbnail', ''),
                'selftext':     cached['selftext'] if has_cached_body else selftext,
                'cached':       has_cached_body,  # hint to frontend: no detail fetch needed
            }

            # Update cache with fresh metadata (score, num_comments) but preserve good selftext
            if post_id:
                entry = {**post, 'cached_at': now}
                if has_cached_body:
                    entry['selftext'] = cached['selftext']
                post_cache[post_id] = entry
                cache_updated = True

            posts.append(post)

        if cache_updated:
            # Trim to most recent 200 posts to avoid unbounded growth
            if len(post_cache) > 200:
                sorted_ids = sorted(post_cache, key=lambda k: post_cache[k].get('created_utc', 0), reverse=True)
                post_cache = {k: post_cache[k] for k in sorted_ids[:200]}
            save_reddit_post_cache(post_cache)

        return jsonify({
            'posts': posts,
            'after': listing.get('after'),
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/reddit/post/<post_id>')
def reddit_post_detail(post_id):
    """Fetch full selftext for a single Reddit post, with TTL-based caching."""
    post_cache = load_reddit_post_cache()
    cached = post_cache.get(post_id)
    cached_age = time.time() - cached.get('cached_at', 0) if cached else float('inf')
    # Serve from cache only if the body is fresh (within TTL) and non-empty
    if (cached and cached.get('selftext') and
            cached['selftext'] not in ('[removed]', '[deleted]', '') and
            cached_age < REDDIT_POST_BODY_TTL):
        return jsonify({**cached, 'from_cache': True})

    try:
        headers = {
            'User-Agent': 'python:BrickVault:1.0 (by /u/brickvault_app)',
            'Accept': 'application/json',
        }
        params  = {'raw_json': 1}
        url_old = f'https://old.reddit.com/r/legomarket/comments/{post_id}.json'
        url_www = f'https://www.reddit.com/r/legomarket/comments/{post_id}.json'
        resp = req.get(url_old, params=params, headers=headers, timeout=15)
        if resp.status_code != 200:
            resp = req.get(url_www, params=params, headers=headers, timeout=15)
        if resp.status_code != 200:
            return jsonify({'error': f'Reddit returned HTTP {resp.status_code}'}), resp.status_code
        try:
            body = resp.json()
        except Exception:
            return jsonify({'error': 'Reddit returned a non-JSON response'}), 502
        if not isinstance(body, list):
            return jsonify({'error': 'Unexpected Reddit response format'}), 502
        d = body[0]['data']['children'][0]['data']
        post = {
            'id':           d.get('id', ''),
            'title':        d.get('title', ''),
            'author':       d.get('author', ''),
            'score':        d.get('score', 0),
            'num_comments': d.get('num_comments', 0),
            'created_utc':  d.get('created_utc', 0),
            'permalink':    d.get('permalink', ''),
            'url':          d.get('url', ''),
            'flair':        d.get('link_flair_text', ''),
            'selftext':     d.get('selftext', '') or '',
        }
        # Cache it
        if post['id'] and post['selftext'] and post['selftext'] not in ('[removed]', '[deleted]'):
            post_cache[post['id']] = {**post, 'cached_at': time.time()}
            save_reddit_post_cache(post_cache)
        return jsonify(post)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/reddit/price-cache', methods=['GET'])
def reddit_price_cache_get():
    """Return the persisted BrickLink price cache for Reddit market sets."""
    return jsonify(load_reddit_price_cache())


@app.route('/api/reddit/price-cache', methods=['POST'])
def reddit_price_cache_post():
    """Merge incoming price entries into the persistent cache."""
    try:
        incoming = request.get_json(force=True) or {}
        cache = load_reddit_price_cache()
        now = time.time()
        for set_num, entry in incoming.items():
            if isinstance(entry, dict):
                cache[set_num] = {**entry, 'cached_at': now}
        save_reddit_price_cache(cache)
        return jsonify({'ok': True, 'count': len(cache)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    configured = get_bl_creds() is not None
    load_catalog_from_disk()
    load_item_types_from_disk()
    print(f"Starting Brick Vault at http://localhost:{PORT}/index.html")
    if configured:
        print("BrickLink API: credentials loaded from brickvault-config.json ✓")
    else:
        print("BrickLink API: no credentials yet — add them in Settings.")
    print("Press Ctrl+C to stop.\n")
    webbrowser.open(f"http://localhost:{PORT}/index.html")
    app.run(port=PORT, debug=False, threaded=True)
