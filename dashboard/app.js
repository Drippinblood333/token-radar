// Launch Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, its filters, and a detail view for every protocol with the model's
// own inputs and the protocol's farm plan. No network: every byte it shows is in data.js.
// Views live in the hash: #/ is the board, #/?q=&cat=&chain=&wl=1 is a filtered board, and
// #/p/<slug> is one protocol's detail view, so each view can be linked and screenshotted.
(function () {
  'use strict';
  var DATA = window.RADAR;
  var main = document.getElementById('board');

  function esc(x) {
    return String(x).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(x) {
    if (x >= 1e9) return '$' + (x / 1e9).toFixed(2) + 'B';
    if (x >= 1e6) return '$' + (x / 1e6).toFixed(1) + 'M';
    if (x >= 1e3) return '$' + (x / 1e3).toFixed(0) + 'K';
    return '$' + x;
  }
  function pct(x) {
    if (x === null || x === undefined) return '<span class="flat">n/a</span>';
    var cls = x > 0 ? 'up' : x < 0 ? 'down' : 'flat';
    return '<span class="' + cls + '">' + (x > 0 ? '+' : '') + x.toFixed(1) + '%</span>';
  }
  function ageText(days) {
    if (days === null || days === undefined) return 'not recorded';
    if (days < 90) return days + ' days';
    return (days / 365).toFixed(1) + ' yrs (' + days + 'd)';
  }

  function parseHash() {
    var h = location.hash.replace(/^#/, '');
    var state = { view: 'board', slug: null, q: '', cat: '', chain: '', wl: false, sort: 'r', dir: 1, sb: null };
    if (h.indexOf('/p/') === 0) {
      state.view = 'detail';
      state.slug = decodeURIComponent(h.slice(3));
      return state;
    }
    if (h.indexOf('/sandbox') === 0) {
      state.view = 'sandbox';
      state.sb = sandboxParams(h.indexOf('?') >= 0 ? h.slice(h.indexOf('?') + 1) : '');
      return state;
    }
    var qm = h.indexOf('?');
    if (qm >= 0) {
      var params = new URLSearchParams(h.slice(qm + 1));
      state.q = params.get('q') || '';
      state.cat = params.get('cat') || '';
      state.chain = params.get('chain') || '';
      state.wl = params.get('wl') === '1';
      state.sort = params.get('sort') || 'r';
      state.dir = params.get('dir') === '-1' ? -1 : 1;
    }
    return state;
  }
  function boardHash(state) {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.cat) p.set('cat', state.cat);
    if (state.chain) p.set('chain', state.chain);
    if (state.wl) p.set('wl', '1');
    if (state.sort && state.sort !== 'r') p.set('sort', state.sort);
    if (state.dir === -1) p.set('dir', '-1');
    var s = p.toString();
    return '#/' + (s ? '?' + s : '');
  }

  // --- Model sandbox: the same pricing, re-run live with different weights. ---
  // Defaults (s=8, mw=0.6, ma=0.35, bb=0.03) are the board's own model; moving a slider
  // re-prices every row from its snapshot figures and re-ranks the board, so a reader can
  // see which calls the ranking actually rests on. The $1B+ size dampener stays fixed.
  var SB_DEFAULT = { s: 8, mw: 0.6, ma: 0.35, bb: 0.03 };
  function sandboxParams(qs) {
    var p = { s: SB_DEFAULT.s, mw: SB_DEFAULT.mw, ma: SB_DEFAULT.ma, bb: SB_DEFAULT.bb };
    if (!qs) return p;
    var q = new URLSearchParams(qs);
    var num = function (k, lo, hi, dflt) {
      var v = parseFloat(q.get(k) || '');
      return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;
    };
    p.s = num('s', 0, 40, SB_DEFAULT.s);
    p.mw = num('mw', 0, 1.2, SB_DEFAULT.mw);
    p.ma = num('ma', 0, 0.8, SB_DEFAULT.ma);
    p.bb = num('bb', 0, 0.06, SB_DEFAULT.bb);
    return p;
  }
  function sandboxHash(p) {
    return '#/sandbox?s=' + p.s + '&mw=' + p.mw + '&ma=' + p.ma + '&bb=' + p.bb;
  }
  function clampNum(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
  function recompute(row, p) {
    var multiple = clampNum((row.cn * row.cm + p.s * DATA.global_multiple) / (row.cn + p.s), 0.05, 8);
    var momentum = row.c7 === null ? 1 : 1 + (clampNum(row.c7, -25, 40) / 100) * p.mw;
    var maturity = row.age === null ? 0.9 : 0.8 + p.ma * (1 - Math.exp(-(row.age / 365) / 2.5));
    var breadth = 1 + p.bb * Math.min(Math.max(row.ch.length - 1, 0), 5);
    var size = row.t > 1e9 ? Math.pow(1e9 / row.t, 0.08) : 1;
    return Math.max(1, Math.round(row.t * multiple * momentum * maturity * breadth * size));
  }
  function sandboxRows(p) {
    return DATA.rows.map(function (row) {
      return { row: row, v: recompute(row, p) };
    }).sort(function (a, b) {
      return b.v - a.v || b.row.t - a.row.t || (a.row.s < b.row.s ? -1 : 1);
    });
  }

  function masthead() {
    return (
      '<div class="masthead"><div><div class="logo">Launch<span class="dot"> </span>Radar<span class="dot">.</span></div>' +
      '<div class="tagline">Protocols that record no token yet, ranked by what their launch would be worth — and how to farm each one before it happens.</div></div>' +
      '<div class="stats">' +
      '<div class="stat"><b>' + DATA.scanned + '</b><span>protocols scanned</span></div>' +
      '<div class="stat"><b>' + DATA.watchlist_size + '</b><span>on the watchlist</span></div>' +
      '<div class="stat"><b>' + DATA.rows.length + '</b><span>ranked here</span></div>' +
      '<div class="stat"><b>' + esc(DATA.as_of) + '</b><span>snapshot date</span></div>' +
      '</div></div>'
    );
  }
  function footer() {
    return (
      '<footer>Built from a sealed snapshot of DefiLlama protocol data fetched on ' + esc(DATA.as_of) +
      '. "Records no token" is what that record shows, not a guarantee a token does not exist. Implied values are this board\'s own estimates, ' +
      'worked out in the open above; they are not a prediction that any protocol will issue a token, and none of this is financial advice.</footer>'
    );
  }

  function filtered(state) {
    var rows = DATA.rows.filter(function (row) {
      if (state.wl && row.w !== 1) return false;
      if (state.cat && row.cat !== state.cat) return false;
      if (state.chain && row.ch.indexOf(state.chain) < 0) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        if (row.n.toLowerCase().indexOf(q) < 0 && row.s.indexOf(q) < 0) return false;
      }
      return true;
    });
    var key = state.sort;
    var val = function (row) {
      if (key === 'n') return row.n.toLowerCase();
      if (key === 't') return row.t;
      if (key === 'c7') return row.c7 === null ? -Infinity : row.c7;
      if (key === 'v') return row.v;
      if (key === 'ratio') return row.v / row.t;
      return row.r;
    };
    rows.sort(function (a, b) {
      var x = val(a), y = val(b);
      if (x < y) return -1 * state.dir;
      if (x > y) return 1 * state.dir;
      return a.r - b.r;
    });
    return rows;
  }

  function renderBoard(state) {
    var cats = {}, chains = {};
    DATA.rows.forEach(function (row) {
      if (row.cat) cats[row.cat] = 1;
      row.ch.forEach(function (c) { chains[c] = 1; });
    });
    var catOpts = '<option value="">All categories</option>' + Object.keys(cats).sort().map(function (c) {
      return '<option' + (state.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var chainOpts = '<option value="">All chains</option>' + Object.keys(chains).sort().map(function (c) {
      return '<option' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var rows = filtered(state);
    var heads = [
      ['r', 'Rank', ''], ['n', 'Protocol', ''], ['cat', 'Category', ''], ['t', 'TVL', 'num'],
      ['c7', '7d %', 'num'], ['v', 'Implied value', 'num'], ['ratio', 'Value / TVL', 'num'],
    ];
    var thead = heads.map(function (h) {
      var arrow = state.sort === h[0] ? ' <span class="dir">' + (state.dir === 1 ? '▲' : '▼') + '</span>' : '';
      return '<th class="' + h[2] + '" data-sort="' + h[0] + '">' + h[1] + arrow + '</th>';
    }).join('');
    var body = rows.map(function (row) {
      return (
        '<tr data-slug="' + esc(row.s) + '"' + (row.r <= 10 ? ' class="top"' : '') + '>' +
        '<td class="rank">' + row.r + '</td>' +
        '<td class="name">' + esc(row.n) + (row.w === 1 ? '<span class="wl">watchlist</span>' : '') + '</td>' +
        '<td class="cat">' + esc(row.cat || '—') + '</td>' +
        '<td class="num">' + money(row.t) + '</td>' +
        '<td class="num">' + pct(row.c7) + '</td>' +
        '<td class="num value">' + money(row.v) + '</td>' +
        '<td class="num">' + (row.v / row.t).toFixed(2) + 'x</td></tr>'
      );
    }).join('');
    var peers = DATA.live.map(function (p) {
      return '<tr><td class="name">' + esc(p.n) + '</td><td class="num">' + money(p.mcap) + '</td><td class="num">' + money(p.t) + '</td><td class="num">' + p.m.toFixed(2) + 'x</td></tr>';
    }).join('');
    main.innerHTML =
      masthead() +
      '<section class="method"><b>How the board prices a launch.</b> Protocols that already have a token are the comparables: ' +
      'in each category their market cap over TVL gives a peer multiple (the global median is <span class="formula">' + DATA.global_multiple.toFixed(2) + 'x</span>), ' +
      'shrunk toward that median where a category is thin. A pre-token protocol starts at <span class="formula">TVL × peer multiple</span>, then three adjustments from its own record: ' +
      '<b>7-day TVL momentum</b>, <b>years live with no token</b>, and <b>chains live on</b>, with a dampener on the very largest. ' +
      'Bridge entries (denominations of other protocols\' assets, not protocols awaiting a launch), exchange shelves, and products whose name marks them as a wrapped or staked claim on a token that already trades are set aside, as are later versions of protocols that already launched. ' +
      'Every one of the ' + DATA.watchlist_size + ' watchlist protocols (TVL at or above ' + money(DATA.floor_usd) + ', no token recorded) is on the board; the rest earned their place below that floor.</section>' +
      '<div class="controls">' +
      '<input type="search" id="q" placeholder="Search name or slug" value="' + esc(state.q) + '" aria-label="Search protocols">' +
      '<select id="cat" aria-label="Filter by category">' + catOpts + '</select>' +
      '<select id="chain" aria-label="Filter by chain">' + chainOpts + '</select>' +
      '<label class="check"><input type="checkbox" id="wl"' + (state.wl ? ' checked' : '') + '> Watchlist only</label>' +
      '<a class="sandbox-link" href="#/sandbox">Model sandbox: re-price the board →</a>' +
      '<span class="count">Showing ' + rows.length + ' of ' + DATA.rows.length + '</span></div>' +
      '<table aria-label="Pre-token protocols ranked by implied value"><thead><tr>' + thead + '</tr></thead><tbody>' +
      (body || '<tr><td colspan="7" class="empty">No protocol matches those filters.</td></tr>') +
      '</tbody></table>' +
      '<section class="peers"><h2>Already launched: the comparables</h2>' +
      '<p>These protocols have their token and trade today. The board never ranks them; it reads their market cap over TVL, category by category, to price the ones still to come.</p>' +
      '<table aria-label="Launched protocols used as comparables"><thead><tr><th>Protocol</th><th class="num">Market cap</th><th class="num">TVL</th><th class="num">Mcap / TVL</th></tr></thead><tbody>' +
      peers + '</tbody></table></section>' +
      footer();
    main.removeAttribute('aria-busy');
    wire(state);
  }

  function wire(state) {
    var go = function () {
      var next = {
        view: 'board', slug: null,
        q: document.getElementById('q').value.trim(),
        cat: document.getElementById('cat').value,
        chain: document.getElementById('chain').value,
        wl: document.getElementById('wl').checked,
        sort: state.sort, dir: state.dir,
      };
      location.hash = boardHash(next);
    };
    document.getElementById('q').addEventListener('input', go);
    document.getElementById('cat').addEventListener('change', go);
    document.getElementById('chain').addEventListener('change', go);
    document.getElementById('wl').addEventListener('change', go);
    Array.prototype.forEach.call(main.querySelectorAll('th[data-sort]'), function (th) {
      th.addEventListener('click', function () {
        var key = th.getAttribute('data-sort');
        var next = Object.assign({}, state, {
          sort: key,
          dir: state.sort === key ? (state.dir === 1 ? -1 : 1) : (key === 'n' || key === 'cat' ? 1 : -1),
        });
        location.hash = boardHash(next);
      });
    });
    Array.prototype.forEach.call(main.querySelectorAll('tbody tr[data-slug]'), function (tr) {
      tr.addEventListener('click', function () {
        location.hash = '#/p/' + encodeURIComponent(tr.getAttribute('data-slug'));
      });
    });
  }

  function factor(label, x) {
    var pctWidth = Math.max(2, Math.min(100, ((x - 0.4) / 1.2) * 100));
    return '<div class="factor"><span class="fname">' + label + '</span><span class="bar"><i style="width:' + pctWidth.toFixed(0) + '%"></i></span><span class="fval">×' + x.toFixed(2) + '</span></div>';
  }

  function renderDetail(state) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.s === state.slug) row = r; });
    if (!row) { renderBoard(parseHash()); return; }
    var base = row.t * row.m;
    var steps = row.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    // Same-category peers, priced the same way: where this protocol sits among the
    // pre-token names it is actually competing with for a launch.
    var peers = DATA.rows.filter(function (r) { return r.cat === row.cat; }).sort(function (a, b) { return b.v - a.v; });
    var inCat = 0;
    peers.forEach(function (r, i) { if (r.s === row.s) inCat = i + 1; });
    var shown = peers.slice(0, 8);
    if (inCat > 8) shown.push(row);
    var peerRows = shown.map(function (r, i) {
      var gap = i === shown.length - 1 && inCat > 8 && r.s === row.s;
      return (gap ? '<tr><td colspan="6" class="empty">…</td></tr>' : '') +
        '<tr' + (r.s === row.s ? ' class="me"' : '') + ' data-slug="' + esc(r.s) + '">' +
        '<td class="rank">' + r.r + '</td><td class="name">' + esc(r.n) + (r.s === row.s ? ' ← this protocol' : '') + '</td>' +
        '<td class="num">' + money(r.t) + '</td><td class="num">' + r.m.toFixed(2) + 'x</td>' +
        '<td class="num value">' + money(r.v) + '</td><td class="num">' + (r.v / r.t).toFixed(2) + 'x</td></tr>';
    }).join('');
    var peerSection =
      '<section class="detail peers"><h2>Same-category peers: ' + esc(row.cat || 'Uncategorised') + '</h2>' +
      '<p>' + esc(row.n) + ' sits #' + inCat + ' of ' + peers.length + ' pre-token ' + esc(row.cat || '') + ' protocols on this board, priced with the same category multiple and the same adjustments. The launched names below are the comparables that multiple was read from.</p>' +
      '<table aria-label="Pre-token peers in the same category"><thead><tr><th>Rank</th><th>Protocol</th><th class="num">TVL</th><th class="num">Multiple</th><th class="num">Implied value</th><th class="num">Value / TVL</th></tr></thead><tbody>' +
      peerRows + '</tbody></table></section>';
    var launched = (DATA.catLive && DATA.catLive[row.cat || '(none)']) || [];
    var launchedSection = '';
    if (launched.length) {
      var launchedRows = launched.map(function (p) {
        return '<tr><td class="name">' + esc(p.n) + '</td><td class="num">' + money(p.mcap) + '</td><td class="num">' + money(p.t) + '</td><td class="num">' + p.m.toFixed(2) + 'x</td></tr>';
      }).join('');
      launchedSection =
        '<section class="detail peers"><h2>Launched comparables in ' + esc(row.cat || 'this category') + '</h2>' +
        '<p>The category multiple of ' + row.m.toFixed(2) + 'x (raw median ' + row.cm.toFixed(2) + 'x across ' + row.cn + ' launched names, shrunk toward the global ' + DATA.global_multiple.toFixed(2) + 'x) is read from names like these — not from a fixed list.</p>' +
        '<table aria-label="Launched comparables in this category"><thead><tr><th>Protocol</th><th class="num">Market cap</th><th class="num">TVL</th><th class="num">Mcap / TVL</th></tr></thead><tbody>' +
        launchedRows + '</tbody></table></section>';
    }
    main.innerHTML =
      '<a class="back" href="#/">← Back to the board</a>' +
      '<div class="detail-head"><div><h1>' + esc(row.n) + (row.w === 1 ? '<span class="wl">watchlist</span>' : '') + '</h1>' +
      '<div class="note">Rank #' + row.r + ' of ' + DATA.rows.length + ' · ' + esc(row.cat || 'Uncategorised') + ' · ' + esc(row.ch.join(', ') || 'chain not recorded') + '</div></div>' +
      '<div class="big"><span>implied launch value</span>' + money(row.v) + '</div></div>' +
      '<div class="grid">' +
      '<div class="card"><span>Total value locked</span><b>' + money(row.t) + '</b></div>' +
      '<div class="card"><span>TVL change, 7 days</span><b>' + (row.c7 === null ? 'n/a' : (row.c7 > 0 ? '+' : '') + row.c7.toFixed(1) + '%') + '</b></div>' +
      '<div class="card"><span>Time with no token</span><b>' + ageText(row.age) + '</b></div>' +
      '<div class="card"><span>Peer multiple (' + esc(row.cat || 'all') + ')</span><b>' + row.m.toFixed(2) + 'x</b></div>' +
      '<div class="card"><span>Base value (TVL × multiple)</span><b>' + money(Math.round(base)) + '</b></div>' +
      '<div class="card"><span>Implied value / TVL</span><b>' + (row.v / row.t).toFixed(2) + 'x</b></div>' +
      '</div>' +
      '<section class="detail"><h2>How the model moves it</h2>' +
      factor('7-day momentum', row.f[0]) + factor('Years live, no token', row.f[1]) + factor('Chain breadth', row.f[2]) +
      '<p class="note">Base value ' + money(Math.round(base)) + ' is adjusted by the three factors above (and a size dampener past $1B of TVL) to the implied value of ' + money(row.v) + '. ' +
      'The multiple is the median market-cap/TVL of launched ' + esc(row.cat || '') + ' protocols, shrunk toward the global median of ' + DATA.global_multiple.toFixed(2) + 'x. ' +
      '<a href="#/sandbox">Re-price it yourself in the model sandbox →</a></p></section>' +
      peerSection + launchedSection +
      '<section class="detail"><h2>Farm plan</h2><ol class="steps">' + steps + '</ol>' +
      '<p class="note">No step here promises a token or an airdrop: the plan builds the usage record a launch would most plausibly reward, at a cost and pace a person can actually keep.</p></section>' +
      footer();
    Array.prototype.forEach.call(main.querySelectorAll('tr[data-slug]'), function (tr) {
      tr.addEventListener('click', function () {
        location.hash = '#/p/' + encodeURIComponent(tr.getAttribute('data-slug'));
      });
    });
    main.removeAttribute('aria-busy');
    window.scrollTo(0, 0);
  }

  function sliderRow(id, label, min, max, step, value, unit, hint) {
    return '<div class="slider-row"><label for="' + id + '">' + label + ' <b id="' + id + '-val">' + value + unit + '</b></label>' +
      '<input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '">' +
      '<span class="hint">' + hint + '</span></div>';
  }

  function renderSandbox(state) {
    var p = state.sb;
    main.innerHTML =
      masthead() +
      '<a class="back" href="#/">← Back to the board</a>' +
      '<section class="detail sandbox"><h1>Model sandbox</h1>' +
      '<p class="note">The board prices every protocol as TVL × category multiple × momentum × maturity × breadth, with a dampener past $1B of TVL. ' +
      'Move a slider and the whole board re-prices from the same snapshot figures — the ranking below is live, not a picture. ' +
      'Defaults are the board\'s own model (shrinkage 8, momentum weight 0.6, maturity 0.35, breadth 0.03); the size dampener stays fixed. ' +
      'Sandbox values are the model\'s raw recomputation; the published board then shaves $1 where two rows would tie, so ranks stay strictly ordered.</p>' +
      '<div class="sliders">' +
      sliderRow('sb-s', 'Multiple shrinkage (blend weight toward the global median)', 0, 40, 1, p.s, '', '0 = raw category median, 40 = nearly the global 0.21x for every category') +
      sliderRow('sb-mw', 'Momentum weight (7-day TVL change)', 0, 1.2, 0.05, p.mw, '', '0 = ignore the last 7 days, 1.2 = let a hot week move the price') +
      sliderRow('sb-ma', 'Maturity amplitude (years live with no token)', 0, 0.8, 0.05, p.ma, '', '0 = age counts for nothing, 0.8 = old and tokenless is worth much more') +
      sliderRow('sb-bb', 'Breadth bonus (per extra chain, up to 5)', 0, 0.06, 0.005, p.bb, '', '0 = chains don\'t matter, 0.06 = multi-chain counts double') +
      '</div>' +
      '<div class="sandbox-actions"><a class="sandbox-link" href="#/sandbox">Reset to the board\'s model</a> <span class="hint" id="sb-share">Shareable: these settings live in the page address.</span></div>' +
      '<div id="sb-summary" class="note"></div>' +
      '<table aria-label="Board re-priced with sandbox settings"><thead><tr><th>New rank</th><th>Protocol</th><th class="num">Implied value</th><th class="num">Board rank</th><th class="num">Rank change</th><th class="num">Value change</th></tr></thead><tbody id="sb-body"></tbody></table>' +
      '</section>' +
      footer();
    var draw = function () {
      var cur = {
        s: parseFloat(document.getElementById('sb-s').value),
        mw: parseFloat(document.getElementById('sb-mw').value),
        ma: parseFloat(document.getElementById('sb-ma').value),
        bb: parseFloat(document.getElementById('sb-bb').value),
      };
      document.getElementById('sb-s-val').textContent = cur.s;
      document.getElementById('sb-mw-val').textContent = cur.mw.toFixed(2);
      document.getElementById('sb-ma-val').textContent = cur.ma.toFixed(2);
      document.getElementById('sb-bb-val').textContent = cur.bb.toFixed(3);
      var ranked = sandboxRows(cur);
      var moved = 0, top = ranked.slice(0, 15);
      ranked.slice(0, 10).forEach(function (it, i) { if (it.row.r !== i + 1) moved++; });
      document.getElementById('sb-summary').textContent =
        'Top 10 under these settings: ' + moved + ' of 10 changed rank against the published board. ' +
        'Biggest mover in the top 15: ' + top.map(function (it) { return Math.abs(it.row.r - (ranked.indexOf(it) + 1)); }).reduce(function (a, b) { return Math.max(a, b); }, 0) + ' places.';
      document.getElementById('sb-body').innerHTML = top.map(function (it, i) {
        var dRank = it.row.r - (i + 1);
        var dVal = ((it.v - it.row.v) / it.row.v * 100);
        return '<tr data-slug="' + esc(it.row.s) + '"' + (i < 3 ? ' class="top"' : '') + '>' +
          '<td class="rank">' + (i + 1) + '</td><td class="name">' + esc(it.row.n) + '</td>' +
          '<td class="num value">' + money(it.v) + '</td><td class="num">' + it.row.r + '</td>' +
          '<td class="num">' + (dRank > 0 ? '+' + dRank : dRank) + '</td>' +
          '<td class="num">' + (dVal > 0 ? '+' : '') + dVal.toFixed(1) + '%</td></tr>';
      }).join('');
      Array.prototype.forEach.call(document.querySelectorAll('#sb-body tr[data-slug]'), function (tr) {
        tr.addEventListener('click', function () {
          location.hash = '#/p/' + encodeURIComponent(tr.getAttribute('data-slug'));
        });
      });
      history.replaceState(null, '', sandboxHash(cur));
    };
    ['sb-s', 'sb-mw', 'sb-ma', 'sb-bb'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', draw);
    });
    draw();
    main.removeAttribute('aria-busy');
    window.scrollTo(0, 0);
  }

  function render() {
    var state = parseHash();
    if (!DATA) {
      main.innerHTML = '<p class="empty">The radar data did not load: data.js is missing beside this page.</p>';
      return;
    }
    if (state.view === 'detail') renderDetail(state);
    else if (state.view === 'sandbox') renderSandbox(state);
    else renderBoard(state);
  }
  window.addEventListener('hashchange', render);
  render();
})();
