/**
 * Houma — property table + multi-property owners, from Terrebonne Parish Assessor public data
 * (cached in data/houma-parcels.json by scripts/fetch_houma_parcels.py).
 */
(function () {
  "use strict";
  var data = null, loading = null;
  var GRP0 = "both"; try { GRP0 = localStorage.getItem("hp-grp") || "both"; } catch (e) {}
  var st = { grp: /^(biz|ind|both)$/.test(GRP0) ? GRP0 : "both", pg: { biz: 0, ind: 0 }, opg: { biz: 0, ind: 0 }, view: "world", q: "", sort: "owner", dir: 1, page: 0, per: 100, oq: "", ofilter: "all", opage: 0 };
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function money(n) { return n == null ? "" : "$" + Math.round(n).toLocaleString(); }
  function norm(s) { return String(s || "").toUpperCase().replace(/[.,#]/g, " ").replace(/\s+/g, " "); }
  var CORP = /(^|[\s,.(])(L\.?\s?L\.?\s?C|P\.?\s?L\.?\s?L\.?\s?C|L\.?\s?L\.?\s?P|I\.?\s?N\.?\s?C|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|BANK|N\.?\s?A)\.?(?=$|[\s,.)])/i;
  var BTR = /\b(BUSINESS TRUST|ACQUISITION TRUST|LOAN TRUST|MORTGAGE|FINANCING AUTHORITY|PUBLIC TRUST|TRUST \d{4}-|CREDIT UNION)\b/i;
  var ORG = /\b(L\.?P|PARTNERSHIP|PARTNERS|HOLDINGS?|PROPERTIES|PROPERTY|INVESTMENTS?|ENTERPRISES?|ASSOCIATES|CHURCH|MINISTRY|MINISTRIES|PARISH|ASSOCIATION|ASSN|FOUNDATION|GROUP|DEVELOPMENT|REALTY|RENTALS?|AUTHORITY|DISTRICT|SCHOOLS?|CITY OF|TOWN OF|VILLAGE OF|STATE OF|UNITED STATES|U\.?\s?S\.?\s?A|HOUSING|VENTURES|MANAGEMENT|FUND|SERVICES?|CONSOLIDATED|GOVERNMENT|HOSPITAL|HOTEL|MOTEL|APARTMENTS|INSTITUTE|UNIVERSITY|COLLEGE|ACADEMY|CLUB|LODGE|COUNCIL|BOARD|COMMISSION|AGENCY|SOCIETY|SUPPLY|MARINE|LEVEE|CEMETERY|TEMPLE|MOSQUE|DIOCESE|ARCHDIOCESE|CONGREGATION|FELLOWSHIP|TABERNACLE|NATION|COOPERATIVE|CO-OP|CREDIT UNION|INDUSTRIES|PIPELINE|LEASING|CONSTRUCTION|HOMES|FARMS?|CENTER|TRUST COMPANY)\b/i;
  var PERS = /\b(FAMILY TRUST|REVOCABLE|LIVING TRUST|IRREVOCABLE|SUCCESSION|ESTATE OF|USUFRUCT|TESTAMENTARY)\b|\bTRUST\b|TRUSTEE/i;
  function isBiz(o) {
    o = String(o || "").replace(/\s+\d+\/\d+.*$|\s+T\/S\b.*$/, "");
    if (CORP.test(o) || BTR.test(o)) return true;
    if (PERS.test(o)) return false; // personal/family trusts, successions, estates
    var m = o.match(/^[A-Z'\-]+,\s*(.*)$/i); // "SURNAME, FIRST ...": ignore the surname (e.g. BOARD, TEMPLE)
    return ORG.test(m ? m[1] : o);
  }
  var SITES = [];
  fetch("data/houma-biz-sites.json?v=1").then(function (r) { return r.ok ? r.json() : { sites: [] }; }).then(function (d) { SITES = d.sites || []; rowsCache = null; if (data) { try { renderTable(); renderOwners(); } catch (e) {} } }).catch(function () {});
  // Organizations only: personal/family trusts named after individuals never get links.
  function isOrg(o) { o = String(o || "").toUpperCase(); if (!isBiz(o)) return false; if (/TRUST/.test(o) && !/\b(L\.?L\.?C|INC|CORP|BANK|COMPANY|CO\.)\b/.test(o)) return false; return true; }
  function bizName(o) { return String(o).replace(/\s+(\d+\/\d+|T\/S)(\s.*)?$/, "").replace(/,?\s*THE$/, "").trim(); }
  function bizLinks(o) {
    if (!isOrg(o)) return "";
    var n = bizName(o), q = encodeURIComponent(n), up = n.toUpperCase(), site = "";
    for (var i = 0; i < SITES.length; i++) if (up.indexOf(SITES[i][0]) === 0) { site = SITES[i][1]; break; }
    return '<span class="hp-links">' + (site ? '<a href="' + esc(site) + '" target="_blank" rel="noopener" title="Official website">site</a>' : "") +
      '<a href="https://coraweb.sos.la.gov/commercialsearch/CommercialSearch.aspx" target="_blank" rel="noopener" data-copy="' + esc(n) + '" title="Louisiana Secretary of State business search (name copied to clipboard)">LA SOS</a>' +
      '<a href="https://opencorporates.com/companies/us_la?q=' + q + '" target="_blank" rel="noopener" title="Louisiana registry record (OpenCorporates)">registry</a>' +
      '<a href="https://duckduckgo.com/?q=' + encodeURIComponent('"' + n + '" Louisiana') + '" target="_blank" rel="noopener" title="Web search">web</a></span>';
  }
  document.addEventListener("click", function (e) { var a = e.target.closest && e.target.closest("a[data-copy]"); if (a && navigator.clipboard) navigator.clipboard.writeText(a.getAttribute("data-copy")).catch(function () {}); }, true);
  function load() {
    if (loading) return loading;
    var get = function (u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error("parcels " + r.status); return r.json(); }); };
    loading = get("data/houma-parcels/meta.json?v=1").then(function (meta) {
      var parts = [], i;
      for (i = 0; i < meta.parts; i++) parts.push(get("data/houma-parcels/part-" + i + ".json?v=1"));
      return Promise.all(parts).then(function (ps) {
        var all = [];
        ps.forEach(function (part) {
          part.rows.forEach(function (r) { var o = {}; part.fields.forEach(function (k, j) { o[k] = r[j]; }); all.push(o); });
        });
        return { meta: meta, parcels: all };
      });
    })
      .then(function (d) {
        d.parcels.forEach(function (p) { p._s = norm([p.owner, p.site, p.street, p.mail, p.id, p.subdiv, p.city, p.zip].join(" | ")); p.biz = isBiz(p.owner); });
        var g = {};
        d.parcels.forEach(function (p) { (g[p.owner] = g[p.owner] || []).push(p); });
        d.owners = Object.keys(g).map(function (k) {
          var ps = g[k], tot = 0; ps.forEach(function (p) { tot += p.assessed || 0; });
          return { owner: k, parcels: ps, n: ps.length, biz: isBiz(k), total: tot, _s: norm(k + " | " + ps.map(function (p) { return p._s; }).join(" | ")) };
        }).filter(function (o) { return o.n >= 2 || o.biz; })
          .sort(function (a, b) { return b.n - a.n || b.total - a.total || a.owner.localeCompare(b.owner); });
        data = d; window.HoumaParcels = d; return d;
      });
    return loading;
  }
  var COLS = [["owner", "Owner"], ["street", "Street"], ["site", "Site address"], ["mail", "Mailing address"], ["id", "Parcel #"],
    ["acres", "Acres"], ["sqft", "Bldg sqft"], ["land", "Land assmt"], ["bldg", "Bldg assmt"], ["assessed", "Total assmt"], ["subdiv", "Subdivision"], ["book", "Book/Page"]];
  function cmp(k, dir) {
    return function (a, b) {
      var x = a[k], y = b[k];
      if (k === "street") { var s = String(x || "").localeCompare(String(y || "")); if (s) return s * dir; x = parseInt(a.site, 10) || 0; y = parseInt(b.site, 10) || 0; return (x - y) * dir; }
      if (typeof x === "number" || typeof y === "number") return ((x || 0) - (y || 0)) * dir;
      return String(x || "").localeCompare(String(y || "")) * dir;
    };
  }
  var rowsCache = null;
  function rows() {
    if (rowsCache) return rowsCache;
    var q = norm(st.q).trim().split(" ").filter(Boolean);
    var r = data.parcels.filter(function (p) { return q.every(function (w) { return p._s.indexOf(w) >= 0; }); });
    r.sort(cmp(st.sort, st.dir));
    return (rowsCache = { biz: r.filter(function (p) { return p.biz; }), ind: r.filter(function (p) { return !p.biz; }) });
  }
  function cell(p, k) {
    if (k === "acres") return p.acres == null ? "" : p.acres.toFixed(2);
    if (k === "sqft") return p.sqft ? Math.round(p.sqft).toLocaleString() : "";
    if (k === "land" || k === "bldg" || k === "assessed") return money(p[k]);
    if (k === "book") return esc(p.book + (p.page ? "/" + p.page : ""));
    if (k === "site") return p.site ? '<a href="#houma" class="hp-go" data-go="' + esc(p.id) + '" title="Walk there in the Houma world">' + esc(p.site) + "</a>" : "";
    if (k === "owner") return esc(p.owner) + (p.biz ? ' <span class="hp-biz">biz</span>' : "") + bizLinks(p.owner);
    return esc(p[k]);
  }
  function pager(cur, total, per, id) {
    var pages = Math.max(1, Math.ceil(total / per));
    return '<div class="hp-pager" data-pager="' + id + '"><button data-pg="0"' + (cur <= 0 ? " disabled" : "") + '>«</button><button data-pg="' + (cur - 1) + '"' + (cur <= 0 ? " disabled" : "") + '>‹</button><span>Page ' + (cur + 1) + " / " + pages + " · " + total.toLocaleString() + ' rows</span><button data-pg="' + (cur + 1) + '"' + (cur >= pages - 1 ? " disabled" : "") + '>›</button><button data-pg="' + (pages - 1) + '"' + (cur >= pages - 1 ? " disabled" : "") + ">»</button></div>";
  }
  var GL = { biz: "Businesses", ind: "Individuals" };
  function grpKeys() { return st.grp === "both" ? ["biz", "ind"] : [st.grp]; }
  function seg() {
    return '<div class="hp-seg" role="group" aria-label="Show businesses or individuals">' + [["biz", "Businesses"], ["ind", "Individuals"], ["both", "Both"]].map(function (g) {
      return '<button type="button" data-grp="' + g[0] + '" aria-pressed="' + (st.grp === g[0]) + '" class="' + (st.grp === g[0] ? "on" : "") + '">' + g[1] + "</button>";
    }).join("") + "</div>";
  }
  function setGrp(g) { st.grp = g; try { localStorage.setItem("hp-grp", g); } catch (e) {} st.pg = { biz: 0, ind: 0 }; st.opg = { biz: 0, ind: 0 }; if (st.view === "table") renderTable(); else if (st.view === "owners") renderOwners(); }
  function renderTable() {
    var all = rows();
    // Owner A→Z / Z→A button: in the Owner header on desktop, in a small bar above the cards on mobile
    var azOn = st.sort === "owner", azNext = azOn && st.dir > 0 ? "Z→A" : "A→Z";
    var az = function (cls) { return '<button type="button" class="hp-az ' + cls + (azOn ? " on" : "") + '" data-az="1" title="Sort owners ' + azNext + '" aria-label="Sort by owner name ' + azNext + '">' + azNext + "</button>"; };
    var h = seg() + grpKeys().map(function (g) {
      var r = all[g], pages = Math.max(1, Math.ceil(r.length / st.per));
      if (st.pg[g] >= pages) st.pg[g] = pages - 1;
      var slice = r.slice(st.pg[g] * st.per, (st.pg[g] + 1) * st.per);
      return '<section class="hp-sec hp-sec-' + g + '"><h3 class="hp-sec-h">' + GL[g] + ' <span>' + r.length.toLocaleString() + "</span></h3>" +
        '<div class="hp-az-bar">Owner ' + az("m") + '</div><table class="hp-table"><thead><tr>' + COLS.map(function (c) {
        return '<th data-sort="' + c[0] + '" class="' + (st.sort === c[0] ? (st.dir > 0 ? "asc" : "desc") : "") + '">' + c[1] + (c[0] === "owner" ? " " + az("d") : "") + "</th>";
      }).join("") + "</tr></thead><tbody>" + (slice.map(function (p) {
        return "<tr>" + COLS.map(function (c) { return '<td data-l="' + c[1] + '">' + cell(p, c[0]) + "</td>"; }).join("") + "</tr>";
      }).join("") || '<tr><td colspan="' + COLS.length + '" class="hp-empty">No matches.</td></tr>') + "</tbody></table>" + pager(st.pg[g], r.length, st.per, "t-" + g) + "</section>";
    }).join("");
    $("hp-table-wrap").innerHTML = h;
    $("hp-table-pager").innerHTML = "";
    $("hp-sort").value = st.sort + ":" + st.dir;
  }
  function ownersList() {
    var q = norm(st.oq).trim().split(" ").filter(Boolean);
    return data.owners.filter(function (o) {
      if (st.ofilter === "biz" && !o.biz) return false;
      if (st.ofilter === "multi" && o.n < 2) return false;
      if (st.ofilter === "bizmulti" && !(o.biz && o.n >= 2)) return false;
      return q.every(function (w) { return o._s.indexOf(w) >= 0; });
    });
  }
  function renderOwners() {
    var l = ownersList(), per = 50;
    $("hp-owners-list").innerHTML = seg() + grpKeys().map(function (g) {
      var gl = l.filter(function (o) { return g === "biz" ? o.biz : !o.biz; }), pages = Math.max(1, Math.ceil(gl.length / per));
      if (st.opg[g] >= pages) st.opg[g] = pages - 1;
      return '<section class="hp-sec hp-sec-' + g + '"><h3 class="hp-sec-h">' + GL[g] + ' <span>' + gl.length.toLocaleString() + " owners</span></h3>" + (gl.slice(st.opg[g] * per, (st.opg[g] + 1) * per).map(function (o) {
      return '<details class="hp-owner"><summary><span class="hp-cnt">' + o.n + '</span><span class="hp-on">' + esc(o.owner) + "</span>" + (o.biz ? '<span class="hp-biz">biz</span>' : "") + bizLinks(o.owner) +
        '<span class="hp-tot">' + money(o.total) + " assessed</span></summary><ul>" + o.parcels.slice().sort(cmp("street", 1)).map(function (p) {
          return "<li><b>" + esc(p.site || "(no site address)") + "</b> · #" + esc(p.id) + (p.acres != null ? " · " + p.acres.toFixed(2) + " ac" : "") + " · " + money(p.assessed) + (p.subdiv ? " · " + esc(p.subdiv) : "") + "</li>";
        }).join("") + "</ul></details>";
      }).join("") || '<p class="hp-empty">No matches.</p>') + pager(st.opg[g], gl.length, per, "o-" + g) + "</section>";
    }).join("");
    $("hp-owners-pager").innerHTML = "";
  }
  function setView(v) {
    st.view = v;
    if (v === "world" && document.activeElement && document.activeElement.blur) document.activeElement.blur();
    ["world", "table", "owners"].forEach(function (k) {
      var b = document.querySelector('[data-hpview="' + k + '"]'); if (b) b.classList.toggle("active", k === v);
    });
    $("hm-stage").hidden = v !== "world";
    $("hp-table-view").hidden = v !== "table";
    $("hp-owners-view").hidden = v !== "owners";
    if (v === "world") { window.dispatchEvent(new Event("resize")); return; }
    load().then(function () {
      $("hp-meta").textContent = data.meta.count.toLocaleString() + " Houma parcels · Terrebonne Parish Assessor public map · fetched " + data.meta.fetched + " · informational only, as-is";
      $("hp-meta2").textContent = $("hp-meta").textContent;
      if (v === "table") renderTable(); else renderOwners();
    }).catch(function (e) { $("hp-meta").textContent = "Could not load parcels: " + e.message; });
  }
  function deb(fn) { var t; return function () { clearTimeout(t); t = setTimeout(fn, 160); }; }
  function init() {
    if (!$("hp-tabs")) return;
    $("hp-tabs").addEventListener("click", function (e) { var b = e.target.closest("[data-hpview]"); if (b) setView(b.dataset.hpview); });
    $("hp-q").addEventListener("input", deb(function () { st.q = $("hp-q").value; st.pg = { biz: 0, ind: 0 }; rowsCache = null; renderTable(); }));
    $("hp-sort").addEventListener("change", function () { var v = $("hp-sort").value.split(":"); st.sort = v[0]; st.dir = +v[1]; rowsCache = null; renderTable(); });
    $("hp-table-wrap").addEventListener("click", function (e) {
      var go = e.target.closest("[data-go]");
      if (go) { e.preventDefault(); setView("world"); setTimeout(function () { if (!(window.Houma && window.Houma.goTo(go.dataset.go))) alert("That parcel is outside the drivable world area (or the world is still loading)."); }, 50); return; }
      if (e.target.closest("[data-az]")) { e.stopPropagation(); st.dir = st.sort === "owner" && st.dir > 0 ? -1 : 1; st.sort = "owner"; st.pg = { biz: 0, ind: 0 }; rowsCache = null; renderTable(); return; }
      var th = e.target.closest("th[data-sort]"); if (!th) return;
      var k = th.dataset.sort; st.dir = st.sort === k ? -st.dir : 1; st.sort = k; st.pg = { biz: 0, ind: 0 }; rowsCache = null; renderTable();
    });
    $("hp-oq").addEventListener("input", deb(function () { st.oq = $("hp-oq").value; st.opg = { biz: 0, ind: 0 }; renderOwners(); }));
    $("hp-ofilter").addEventListener("change", function () { st.ofilter = $("hp-ofilter").value; st.opg = { biz: 0, ind: 0 }; renderOwners(); });
    document.getElementById("panel-houma").addEventListener("click", function (e) {
      var gb = e.target.closest("[data-grp]"); if (gb) { setGrp(gb.dataset.grp); return; }
      var b = e.target.closest("[data-pg]"); if (!b || b.disabled) return;
      var w = b.closest("[data-pager]").dataset.pager.split("-"), n = +b.dataset.pg, sec;
      if (w[0] === "t") { st.pg[w[1]] = n; renderTable(); } else { st.opg[w[1]] = n; renderOwners(); }
      sec = document.querySelector((w[0] === "t" ? "#hp-table-wrap" : "#hp-owners-list") + " .hp-sec-" + w[1]); if (sec) sec.scrollIntoView({ block: "start" });
    });
  }
  window.HoumaProps = { load: load, isBiz: isBiz, setView: setView };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
