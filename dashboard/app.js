// Token Radar dashboard: renders window.RADAR (written by main.ts as data.js).
// No network: every byte the page needs is in data.js. State lives in the URL hash
// (#detail=<slug>, #cat=<category>, #status=<all|watchlist|early>, #q=<text>,
// #sort=<rank|tvl|change|name>) so a view can be linked and screenshotted directly.
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D || !Array.isArray(D.rows)) {
    document.getElementById('rows').innerHTML =
      '<tr><td colspan="7">No radar data was loaded. Run main.ts first so it writes data.js.</td></tr>';
    return;
  }
  // A row is a watchlist row when its slug is one of the 40 the snapshot named;
  // data.js carries that list in D.watchlist.
  var watchSet = {};
  (D.watchlist || []).forEach(function (s) { watchSet[s] = true; });

  function $(id) { return document.getElementById(id); }
  function money(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + String(n);
  }
  function pct(v) {
    if (v === null || v === undefined) return { t: '—', c: 'flat' };
    var s = (v > 0 ? '+' : '') + v.toFixed(2) + '%';
    return { t: s, c: v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'flat' };
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function chains(r) { return (r.chains || []).slice(0, 3).join(', ') + ((r.chains || []).length > 3 ? ' +' + ((r.chains || []).length - 3) : ''); }

  // ---- header stats -------------------------------------------------------
  $('asof').textContent = D.as_of;
  var top = D.rows[0];
  $('stats').innerHTML =
    '<div><dt>Board rows</dt><dd>' + D.board_size + '</dd></div>' +
    '<div><dt>Watchlist</dt><dd>' + D.watchlist_size + '</dd></div>' +
    '<div><dt>Early finds</dt><dd>' + D.early_size + '</dd></div>' +
    '<div><dt>Top implied value</dt><dd>' + money(top ? top.implied_value_usd : 0) + '</dd></div>' +
    '<div><dt>Already trading</dt><dd>' + D.live_size + '</dd></div>';

  // ---- category filter ----------------------------------------------------
  var cats = [];
  D.rows.forEach(function (r) { if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category); });
  cats.sort();
  var catSel = $('cat');
  cats.forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c;
    catSel.appendChild(o);
  });

  // ---- hash state ---------------------------------------------------------
  function readHash() {
    var h = {};
    (location.hash || '').replace(/^#/, '').split('&').forEach(function (kv) {
      var p = kv.split('=');
      if (p[0]) h[p[0]] = decodeURIComponent(p[1] || '');
    });
    return h;
  }
  function writeHash(h) {
    var parts = [];
    ['detail', 'cat', 'status', 'q', 'sort'].forEach(function (k) {
      if (h[k]) parts.push(k + '=' + encodeURIComponent(h[k]));
    });
    var next = parts.length ? '#' + parts.join('&') : '#';
    if (location.hash !== next) history.replaceState(null, '', next);
  }
  var state = readHash();
  if (!state.status) state.status = 'all';
  if (!state.sort) state.sort = 'rank';

  var qEl = $('q'), statusEl = $('status'), sortEl = $('sort');
  qEl.value = state.q || '';
  catSel.value = state.cat || '';
  statusEl.value = state.status;
  sortEl.value = state.sort;

  // ---- board --------------------------------------------------------------
  function filtered() {
    var q = (state.q || '').toLowerCase();
    var rows = D.rows.filter(function (r) {
      if (state.cat && r.category !== state.cat) return false;
      if (state.status === 'watchlist' && !watchSet[r.slug]) return false;
      if (state.status === 'early' && watchSet[r.slug]) return false;
      if (q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    var s = state.sort;
    rows.sort(function (a, b) {
      if (s === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (s === 'change') return (b.change_7d === null ? -Infinity : b.change_7d) - (a.change_7d === null ? -Infinity : a.change_7d);
      if (s === 'name') return a.name.localeCompare(b.name);
      return a.rank - b.rank;
    });
    return rows;
  }

  function render() {
    var rows = filtered();
    $('count').textContent = rows.length + ' of ' + D.board_size + ' protocols';
    $('empty').hidden = rows.length > 0;
    var html = rows.map(function (r) {
      var ch = pct(r.change_7d);
      var badge = watchSet[r.slug]
        ? '<span class="badge watch">WATCHLIST</span>'
        : '<span class="badge early">EARLY</span>';
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.detail === r.slug ? ' class="selected"' : '') + '>' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' + badge +
        '<span class="sub">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(chains(r)) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num"><span class="' + ch.c + '">' + ch.t + '</span></td>' +
        '<td class="num"><strong>' + money(r.implied_value_usd) + '</strong></td></tr>';
    }).join('');
    $('rows').innerHTML = html;
    renderDetail();
  }

  function renderDetail() {
    var box = $('detail');
    var r = null;
    if (state.detail) {
      for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === state.detail) { r = D.rows[i]; break; }
    }
    if (!r) { box.hidden = true; box.innerHTML = ''; return; }
    var ch = pct(r.change_7d);
    var base = Math.round(r.tvl_usd * D.model.base_multiple);
    var steps = (r.farm_steps || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    box.innerHTML =
      '<button class="close" id="close-detail" type="button">Close</button>' +
      '<h2>#' + r.rank + ' &middot; ' + esc(r.name) + '</h2>' +
      '<p class="meta">' + esc(r.category || 'No category recorded') + ' &middot; ' + esc(chains(r)) +
      ' &middot; listed ' + esc(r.listed_at || 'date not recorded') +
      (r.age_days === null ? '' : ' (' + r.age_days + ' days ago)') +
      ' &middot; ' + (watchSet[r.slug] ? 'on the watchlist' : 'an early find below the watchlist floor') + '</p>' +
      '<div class="model-grid">' +
      '<div><dt>Implied value</dt><dd>' + money(r.implied_value_usd) + '</dd></div>' +
      '<div><dt>TVL &times; 0.30</dt><dd>' + money(base) + '</dd></div>' +
      '<div><dt>7-day change</dt><dd><span class="' + ch.c + '">' + ch.t + '</span></dd></div>' +
      '<div><dt>Growth multiplier</dt><dd>' + r.growth_multiplier.toFixed(2) + '&times;</dd></div>' +
      '<div><dt>Maturity multiplier</dt><dd>' + r.maturity_multiplier.toFixed(2) + '&times;</dd></div>' +
      '</div>' +
      '<h3>How to farm it</h3><ol class="farm">' + steps + '</ol>' +
      '<p class="caveat">This protocol records no token. That is the snapshot&rsquo;s record, not proof it has none &mdash; and no step above pays to claim anything.</p>';
    box.hidden = false;
    $('close-detail').addEventListener('click', function () {
      state.detail = '';
      writeHash(state);
      render();
    });
  }

  // ---- live table ---------------------------------------------------------
  $('live-rows').innerHTML = (D.live || []).map(function (r) {
    var ch = pct(r.change_7d);
    return '<tr><td><span class="pname">' + esc(r.name) + '</span><span class="sub">' + esc(r.slug) + '</span></td>' +
      '<td>' + esc(r.category || '—') + '</td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td class="num"><strong>' + money(r.mcap_usd) + '</strong></td>' +
      '<td class="num"><span class="' + ch.c + '">' + ch.t + '</span></td></tr>';
  }).join('');

  // ---- events -------------------------------------------------------------
  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (!tr) return;
    state.detail = tr.getAttribute('data-slug');
    writeHash(state);
    render();
    $('detail').scrollIntoView({ behavior: 'instant', block: 'nearest' });
  });
  document.querySelectorAll('th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      state.sort = th.getAttribute('data-sort');
      sortEl.value = state.sort;
      writeHash(state);
      render();
    });
  });
  var deb = null;
  qEl.addEventListener('input', function () {
    clearTimeout(deb);
    deb = setTimeout(function () { state.q = qEl.value; writeHash(state); render(); }, 120);
  });
  catSel.addEventListener('change', function () { state.cat = catSel.value; writeHash(state); render(); });
  statusEl.addEventListener('change', function () { state.status = statusEl.value; writeHash(state); render(); });
  sortEl.addEventListener('change', function () { state.sort = sortEl.value; writeHash(state); render(); });
  window.addEventListener('hashchange', function () {
    state = readHash();
    render();
    if (state.detail) {
      var box = $('detail');
      if (box && !box.hidden) box.scrollIntoView();
    }
  });

  render();
  // A link straight to a protocol opens on its detail view, so a screenshot of
  // #detail=<slug> shows the detail panel, not the top of the board.
  if (state.detail) {
    var box = $('detail');
    if (box && !box.hidden) box.scrollIntoView();
  }
})();
