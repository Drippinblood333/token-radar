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
    var state = { view: 'board', slug: null, q: '', cat: '', chain: '', wl: false, sort: 'r', dir: 1 };
    if (h.indexOf('/p/') === 0) {
      state.view = 'detail';
      state.slug = decodeURIComponent(h.slice(3));
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
      'The multiple is the median market-cap/TVL of launched ' + esc(row.cat || '') + ' protocols, shrunk toward the global median of ' + DATA.global_multiple.toFixed(2) + 'x.</p></section>' +
      '<section class="detail"><h2>Farm plan</h2><ol class="steps">' + steps + '</ol>' +
      '<p class="note">No step here promises a token or an airdrop: the plan builds the usage record a launch would most plausibly reward, at a cost and pace a person can actually keep.</p></section>' +
      footer();
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
    else renderBoard(state);
  }
  window.addEventListener('hashchange', render);
  render();
})();
