/**
 * Houma — property table + multi-property owners, from Terrebonne Parish Assessor public data
 * (sharded in data/houma-parcels/ by scope, lazy-loaded; built by scripts/fetch_houma_parcels.py).
 */
(function () {
  "use strict";
  var data = null, loading = null;
  var GRP0 = "both"; try { GRP0 = localStorage.getItem("hp-grp") || "both"; } catch (e) {}
  var st = { grp: /^(biz|ind|both)$/.test(GRP0) ? GRP0 : "both", pg: { biz: 0, ind: 0 }, opg: { biz: 0, ind: 0 }, view: "world", scope: "houma", oscope: "houma", zip: "", kind: "", q: "", sort: "owner", dir: 1, page: 0, per: 100, oq: "", ofilter: "all", opage: 0 };
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
  var SCOPES = { city: ["city"], houma: ["city", "houma-zip"], parish: ["city", "houma-zip", "parish"] };
  var metaP = null, partP = {}, ownersT = null;
  function get(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error("parcels " + r.status); return r.json(); }); }
  function getMeta() {
    return metaP || (metaP = get("data/houma-parcels/meta.json?v=3").then(function (meta) {
      if (!meta.partList) { meta.partList = []; for (var i = 0; i < meta.parts; i++) meta.partList.push({ file: "part-" + i + ".json", scope: "houma-zip" }); }
      data = data || { meta: meta, parcels: [], owners: [] }; window.HoumaParcels = data; return meta;
    }));
  }
  function addPart(part) {
    part.rows.forEach(function (r) {
      var o = {}; part.fields.forEach(function (k, j) { o[k] = r[j]; });
      o.city = o.city || "HOUMA AREA"; o.kind = o.kind || "real property";
      o._s = norm([o.owner, o.site, o.street, o.mail, o.id, o.subdiv, o.city, o.zip, o.kind, o.cls].join(" | ")); o.biz = isBiz(o.owner);
      data.parcels.push(o);
    });
    rowsCache = null; buildOwners();
    clearTimeout(evT); evT = setTimeout(function () { try { window.dispatchEvent(new CustomEvent("houma-parcels", { detail: data })); } catch (e) {} }, 300); // let the 3D world / GPS pick up newly loaded shards
  }
  var evT = null;
  function buildOwners() {
    var g = {};
    data.parcels.forEach(function (p) { if (p.owner) (g[p.owner] = g[p.owner] || []).push(p); });
    data.owners = Object.keys(g).map(function (k) {
      var ps = g[k], tot = 0; ps.forEach(function (p) { tot += p.assessed || 0; });
      return { owner: k, parcels: ps, n: ps.length, biz: isBiz(k), total: tot, _s: null };
    }).filter(function (o) { return o.n >= 2 || o.biz; })
      .sort(function (a, b) { return b.n - a.n || b.total - a.total || a.owner.localeCompare(b.owner); });
  }
  // Lazy: only fetch the shards a scope needs; onPart fires as each arrives so the table renders progressively.
  function ensure(scope, onPart) {
    return getMeta().then(function (meta) {
      var want = SCOPES[scope] || SCOPES.houma;
      return Promise.all(meta.partList.filter(function (pt) { return want.indexOf(pt.scope) >= 0; }).map(function (pt) {
        if (!partP[pt.file]) partP[pt.file] = get("data/houma-parcels/" + pt.file + "?v=3").then(addPart);
        return partP[pt.file].then(function () { if (onPart) onPart(); });
      })).then(function () { return data; });
    });
  }
  function inScope(p, scope) {
    if (scope === "city") return p.city === "HOUMA";
    if (scope === "houma") return p.city === "HOUMA" || p.city === "HOUMA AREA";
    return true;
  }
  function load() { return ensure("houma"); }
  var COLS = [["owner", "Owner"], ["street", "Street"], ["site", "Site address"], ["mail", "Mailing address"], ["id", "Parcel #"],
    ["kind", "Type"], ["zip", "ZIP"], ["city", "Area"], ["acres", "Acres"], ["units", "Units"], ["sqft", "Bldg sqft"], ["land", "Land assmt"], ["bldg", "Bldg assmt"], ["assessed", "Total assmt"], ["subdiv", "Subdivision"], ["book", "Book/Page"]];
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
    var r = data.parcels.filter(function (p) { return inScope(p, st.scope) && (!st.zip || p.zip === st.zip) && (!st.kind || p.kind === st.kind) && q.every(function (w) { return p._s.indexOf(w) >= 0; }); });
    r.sort(cmp(st.sort, st.dir));
    return (rowsCache = { biz: r.filter(function (p) { return p.biz; }), ind: r.filter(function (p) { return !p.biz; }) });
  }
  function cell(p, k) {
    if (k === "acres") return p.acres == null ? "" : p.acres.toFixed(2);
    if (k === "sqft") return p.sqft ? Math.round(p.sqft).toLocaleString() : "";
    if (k === "land" || k === "bldg" || k === "assessed") return money(p[k]);
    if (k === "book") return esc(p.book + (p.page ? "/" + p.page : ""));
    if (k === "site") return p.site ? '<a href="#houma" class="hp-go" data-go="' + esc(p.id) + '" title="Walk there in the Houma world">' + esc(p.site) + "</a>" : "";
    if (k === "city") return p.city === "HOUMA" ? "City" : p.city === "HOUMA AREA" ? "Houma ZIP" : "Parish";
    if (k === "units") return p.units == null ? "" : esc(p.units);
    if (k === "kind") return esc(p.kind) + (p.cls ? '<br><small>' + esc(p.cls) + "</small>" : "") + (p.note ? '<br><small>' + esc(p.note) + "</small>" : "") + (p.src && p.src !== "export" ? '<br><small class="hp-src">' + esc(p.src) + "</small>" : "");
    if (k === "owner") return p.owner ? esc(p.owner) + (p.biz ? ' <span class="hp-biz">biz</span>' : "") + bizLinks(p.owner) : "<i>(no owner listed)</i>";
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
    return data.owners.map(function (o) {
      var ps = o.parcels.filter(function (p) { return inScope(p, st.oscope); }), tot = 0;
      ps.forEach(function (p) { tot += p.assessed || 0; });
      return { owner: o.owner, parcels: ps, n: ps.length, biz: o.biz, total: tot, base: o };
    }).filter(function (o) {
      if (!o.n || (o.n < 2 && !o.biz)) return false;
      if (st.ofilter === "biz" && !o.biz) return false;
      if (st.ofilter === "multi" && o.n < 2) return false;
      if (st.ofilter === "bizmulti" && !(o.biz && o.n >= 2)) return false;
      if (!q.length) return true;
      var b = o.base; if (!b._s) b._s = norm(b.owner + " | " + b.parcels.map(function (p) { return p._s; }).join(" | "));
      return q.every(function (w) { return b._s.indexOf(w) >= 0; });
    }).sort(function (a, b) { return b.n - a.n || b.total - a.total || a.owner.localeCompare(b.owner); });
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
    refresh();
  }
  var rT = null;
  function refresh() {
    var v = st.view; if (v === "world") return;
    var scope = v === "table" ? st.scope : st.oscope;
    var paint = function (done) {
      var m = data.meta, c = m.counts && m.counts.scope, n = 0;
      data.parcels.forEach(function (p) { if (inScope(p, scope)) n++; });
      var txt = n.toLocaleString() + (done ? "" : " (loading more…)") + " records in " + ({ city: "Houma city limits", houma: "Houma (city + Houma ZIPs)", parish: "all of Terrebonne Parish" })[scope] +
        (c ? " · parish total " + m.count.toLocaleString() : "") + " · Terrebonne Parish Assessor public map · fetched " + m.fetched + " · owners only (tenants are not public) · informational, as-is";
      $("hp-meta").textContent = txt; $("hp-meta2").textContent = txt;
      fillSelects();
      if (st.view === "table") renderTable(); else if (st.view === "owners") renderOwners();
    };
    ensure(scope, function () { if (!rT) rT = setTimeout(function () { rT = null; paint(false); }, 120); })
      .then(function () { clearTimeout(rT); rT = null; paint(true); })
      .catch(function (e) { $("hp-meta").textContent = "Could not load parcels: " + e.message; });
  }
  var filled = false;
  function fillSelects() {
    if (filled || !data || !data.meta) return; var m = data.meta; filled = true;
    var z = $("hp-zip"), k = $("hp-kind");
    if (z) (m.zips || []).forEach(function (v) { var o = document.createElement("option"); o.value = v; o.textContent = v + ((m.houmaZips || []).indexOf(v) >= 0 ? " (Houma)" : ""); z.appendChild(o); });
    if (k && m.counts) Object.keys(m.counts.kind).forEach(function (v) { var o = document.createElement("option"); o.value = v; o.textContent = v + " (" + m.counts.kind[v].toLocaleString() + " parish-wide)"; k.appendChild(o); });
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
    var onSel = function (id, key, view) { var el = $(id); if (el) el.addEventListener("change", function () { st[key] = el.value; st.pg = { biz: 0, ind: 0 }; st.opg = { biz: 0, ind: 0 }; rowsCache = null; if (key === "zip" && el.value && st.scope !== "parish" && (data.meta.houmaZips || []).indexOf(el.value) < 0) { st.scope = "parish"; $("hp-scope").value = "parish"; } refresh(); }); };
    onSel("hp-scope", "scope"); onSel("hp-zip", "zip"); onSel("hp-kind", "kind"); onSel("hp-oscope", "oscope");
    document.getElementById("panel-houma").addEventListener("click", function (e) {
      var gb = e.target.closest("[data-grp]"); if (gb) { setGrp(gb.dataset.grp); return; }
      var b = e.target.closest("[data-pg]"); if (!b || b.disabled) return;
      var w = b.closest("[data-pager]").dataset.pager.split("-"), n = +b.dataset.pg, sec;
      if (w[0] === "t") { st.pg[w[1]] = n; renderTable(); } else { st.opg[w[1]] = n; renderOwners(); }
      sec = document.querySelector((w[0] === "t" ? "#hp-table-wrap" : "#hp-owners-list") + " .hp-sec-" + w[1]); if (sec) sec.scrollIntoView({ block: "start" });
    });
  }
  window.HoumaProps = { load: load, ensure: ensure, isBiz: isBiz, setView: setView };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
