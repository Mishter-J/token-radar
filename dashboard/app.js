// Token Radar dashboard.
//
// Renders the board from window.RADAR (written by main.ts as data.js),
// recomputes every row's implied value from the raw fields with the
// same formula the builder used, and flags any row where the recomputed
// value does not match the board. When served over HTTP it also
// cross-checks the row count and the first and last rows against
// board.json. No network access beyond that local fetch; no trackers.

(function () {
  "use strict";

  var data = window.RADAR;
  if (!data || !data.rows) {
    document.getElementById("stats").textContent = "No radar data loaded.";
    return;
  }

  var scale = data.scale_usd;
  var rows = data.rows;

  function money(n) {
    return "$" + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function pct(change) {
    if (change === null || change === undefined) return "—";
    return (change >= 0 ? "+" : "") + change.toFixed(2) + "%";
  }

  function growthFactor(change) {
    var c = change === null || change === undefined ? 0 : change;
    c = Math.max(-50, Math.min(150, c));
    return 1 + (c / 100) * 0.5;
  }

  function maturityFactor(ageDays) {
    return 0.6 + (Math.min(ageDays, 1095) / 1095) * 0.4;
  }

  // Same expression order as the builder: scale * (log * growth * maturity).
  function recompute(row) {
    var logTerm = Math.log(1 + row.tvl_usd / 1000000);
    var unit = logTerm * growthFactor(row.change_7d) * maturityFactor(row.age_days);
    return Math.round(scale * unit);
  }

  function el(tag, text, className) {
    var node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  var stats = document.getElementById("stats");
  var watchlistCount = rows.filter(function (r) { return r.is_watchlist; }).length;
  stats.textContent =
    "Snapshot " + data.as_of +
    " · SCALE " + money(scale) + " fitted on " + data.fit_count + " traded protocols" +
    " · Board " + rows.length + " rows (" + watchlistCount + " watchlist)" +
    " · " + data.live.length + " live tokens listed separately";

  var catSelect = document.getElementById("cat");
  var categories = [];
  rows.forEach(function (r) {
    if (r.category && categories.indexOf(r.category) === -1) categories.push(r.category);
  });
  categories.sort();
  categories.forEach(function (c) {
    catSelect.appendChild(el("option", c));
  });

  var qInput = document.getElementById("q");
  var wlBox = document.getElementById("wl");
  var sortSelect = document.getElementById("sort");
  var tbody = document.getElementById("rows");
  var countLine = document.getElementById("count");
  var detail = document.getElementById("detail");
  var detailTitle = document.getElementById("detail-title");
  var detailBody = document.getElementById("detail-body");
  var selectedSlug = null;

  function visibleRows() {
    var q = qInput.value.trim().toLowerCase();
    var cat = catSelect.value;
    var wlOnly = wlBox.checked;
    var out = rows.filter(function (r) {
      if (wlOnly && !r.is_watchlist) return false;
      if (cat && r.category !== cat) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.indexOf(q) === -1) return false;
      return true;
    });
    var sort = sortSelect.value;
    out.sort(function (a, b) {
      if (sort === "implied-asc") return a.implied_value_usd - b.implied_value_usd;
      if (sort === "tvl-desc") return b.tvl_usd - a.tvl_usd;
      if (sort === "name-asc") return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      return b.implied_value_usd - a.implied_value_usd;
    });
    return out;
  }

  function renderBoard() {
    var list = visibleRows();
    tbody.textContent = "";
    list.forEach(function (r) {
      var tr = document.createElement("tr");
      if (r.slug === selectedSlug) tr.className = "selected";
      tr.appendChild(el("td", String(r.rank), "num"));
      var nameCell = document.createElement("td");
      nameCell.appendChild(el("div", r.name));
      nameCell.appendChild(el("div", r.slug, "slug"));
      tr.appendChild(nameCell);
      tr.appendChild(el("td", r.category || "—"));
      tr.appendChild(el("td", money(r.tvl_usd), "num"));
      tr.appendChild(el("td", pct(r.change_7d), "num"));
      tr.appendChild(el("td", money(r.implied_value_usd), "num"));
      var wlCell = document.createElement("td");
      var badge = el("span", r.is_watchlist ? "Yes" : "—", r.is_watchlist ? "badge" : "badge no");
      wlCell.appendChild(badge);
      tr.appendChild(wlCell);
      tr.addEventListener("click", function () { showDetail(r.slug); });
      tbody.appendChild(tr);
    });
    countLine.textContent = list.length + " of " + rows.length + " rows shown.";
  }

  function showDetail(slug) {
    var row = null;
    rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    selectedSlug = slug;
    renderBoard();
    var again = recompute(row);
    var ok = again === row.implied_value_usd;
    detailTitle.textContent = row.name + " — rank " + row.rank;
    detailBody.textContent = "";

    var dl = document.createElement("dl");
    var facts = [
      ["Slug", row.slug],
      ["Category", row.category || "—"],
      ["Chains", row.chains.join(", ")],
      ["TVL", money(row.tvl_usd)],
      ["ln(1 + TVL / $1M)", (Math.log(1 + row.tvl_usd / 1000000)).toFixed(4)],
      ["TVL change, 7d", row.change_7d === null ? "not reported (treated as 0%)" : pct(row.change_7d)],
      ["Growth factor", growthFactor(row.change_7d).toFixed(4)],
      ["Age", row.age_days + " days"],
      ["Maturity factor", maturityFactor(row.age_days).toFixed(4)],
      ["SCALE (fitted)", money(scale)],
      ["Implied value (board)", money(row.implied_value_usd)],
      ["Implied value (recomputed here)", money(again)],
      ["Watchlist", row.is_watchlist ? "Yes" : "No"],
    ];
    facts.forEach(function (pair) {
      dl.appendChild(el("dt", pair[0]));
      dl.appendChild(el("dd", pair[1]));
    });
    detailBody.appendChild(dl);
    var check = el("p", ok ? "Recomputed value matches the board." : "MISMATCH: recomputed value differs from the board.", ok ? "match" : "mismatch");
    detailBody.appendChild(check);

    detailBody.appendChild(el("h3", "Farm plan — 6 steps"));
    var ol = document.createElement("ol");
    row.farm_steps.forEach(function (step) {
      ol.appendChild(el("li", step));
    });
    detailBody.appendChild(ol);
    detail.hidden = false;
    detail.scrollIntoView({ block: "start" });
    try {
      if (window.location.hash !== "#detail=" + slug) {
        window.history.replaceState(null, "", "#detail=" + slug);
      }
    } catch (e) { /* hash update is cosmetic */ }
  }

  function renderLive() {
    var liveBody = document.getElementById("live-rows");
    data.live.forEach(function (r) {
      var tr = document.createElement("tr");
      tr.appendChild(el("td", r.name));
      tr.appendChild(el("td", r.category || "—"));
      tr.appendChild(el("td", money(r.tvl_usd), "num"));
      tr.appendChild(el("td", money(r.mcap_usd), "num"));
      tr.appendChild(el("td", money(r.implied_value_usd), "num"));
      tr.appendChild(el("td", r.mcap_to_implied.toFixed(2) + "x", "num"));
      liveBody.appendChild(tr);
    });
  }

  function renderBacktest() {
    var body = document.getElementById("backtest-rows");
    data.backtest.forEach(function (r) {
      var tr = document.createElement("tr");
      tr.appendChild(el("td", r.model));
      tr.appendChild(el("td", String(r.n), "num"));
      tr.appendChild(el("td", r.median_abs_log_error.toFixed(3), "num"));
      tr.appendChild(el("td", r.within_2x_pct.toFixed(1) + "%", "num"));
      tr.appendChild(el("td", r.within_5x_pct.toFixed(1) + "%", "num"));
      body.appendChild(tr);
    });
  }

  function applyHash() {
    var hash = window.location.hash || "";
    var params = {};
    hash.replace(/^#/, "").split("&").forEach(function (part) {
      var kv = part.split("=");
      if (kv.length === 2) params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]);
    });
    if (params.q) qInput.value = params.q;
    if (params.cat) catSelect.value = params.cat;
    renderBoard();
    if (params.detail) showDetail(params.detail);
  }

  qInput.addEventListener("input", renderBoard);
  catSelect.addEventListener("change", renderBoard);
  wlBox.addEventListener("change", renderBoard);
  sortSelect.addEventListener("change", renderBoard);
  document.getElementById("reset").addEventListener("click", function () {
    qInput.value = "";
    catSelect.value = "";
    wlBox.checked = false;
    sortSelect.value = "implied-desc";
    selectedSlug = null;
    detail.hidden = true;
    try { window.history.replaceState(null, "", window.location.pathname); } catch (e) { /* cosmetic */ }
    renderBoard();
  });
  window.addEventListener("hashchange", applyHash);

  renderBoard();
  renderLive();
  renderBacktest();
  applyHash();

  // Cross-check against board.json when served over HTTP.
  var verify = document.getElementById("verify");
  fetch("../board.json")
    .then(function (resp) { return resp.json(); })
    .then(function (board) {
      var okRows = board.rows && board.rows.length === rows.length;
      var okFirst = okRows && board.rows[0].implied_value_usd === rows[0].implied_value_usd;
      var okLast = okRows && board.rows[board.rows.length - 1].implied_value_usd === rows[rows.length - 1].implied_value_usd;
      if (okRows && okFirst && okLast) {
        verify.textContent = "Checked against board.json: " + board.rows.length + " rows, rank 1 and rank " + board.rows.length + " match.";
      } else {
        verify.textContent = "Board check: board.json disagrees with this page — investigate before trusting it.";
        verify.className = "mismatch";
      }
    })
    .catch(function () {
      verify.textContent = "Board check skipped: serve this page over HTTP to verify against board.json.";
    });
})();
