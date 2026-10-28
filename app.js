/* KRISS 맛집로드 - app.js */
(() => {
const C = window.APP_CONFIG;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const FOOD_CATS = ["전체", "한식", "양식", "중식", "일식", "아시아음식", "패스트푸드", "기타"];
const RANDOM_CATS = ["한식", "양식", "중식", "일식", "아시아음식", "패스트푸드", "기타", "카페"];
const ALL_CATS = ["한식", "양식", "중식", "일식", "아시아음식", "패스트푸드", "기타", "카페"];

const S = {            // 앱 상태
  data: null, places: [], byId: new Map(), alias: new Map(), fixes: [],
  sb: null, user: null, profile: null, favs: new Set(),
  view: "rank-food", cat: "전체", q: "", shown: 60,
  period: "all", month: "", local: true, sort: "n", cnt: new Map(), inP: () => true,
  map: null, overlays: [], mapKind: "food", miniMap: null, miniMarker: null,
  smap: null, soverlays: [], searchMode: "place", searchQ: "", searchList: [], searchCount: null, searchKind: "food", searchRows: null, searchSeq: 0,
  names: { group: [], person: [] }, pv: new Map(),
  detail: null, lastFocus: null, lastRandom: null, randomCat: null, kakaoReady: false, moreKind: null,
};

/* ---------- 유틸 ---------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDist = (m) => m < 1000 ? `${m}m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)}km`;
const toast = (msg) => { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2600); };
const emailOf = (id) => `${id.toLowerCase()}@${C.EMAIL_DOMAIN}`;
const isAdmin = () => !!(S.user && S.user.email === emailOf(C.ADMIN_ID));
const canSee = () => !!(S.profile && (isAdmin() || (S.profile.approved && !S.profile.banned && !S.profile.rejected)));
const hav = (a, b) => { const R = 6371000, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2; return Math.round(2 * R * Math.asin(Math.sqrt(h))); };
const countBy = (arr) => { const m = new Map(); for (const k of arr) m.set(k, (m.get(k) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
const ymKey = (d) => d.slice(2, 4) + d.slice(5, 7);           // "2025-03-14" → "2503"
const isLocal = (p) => /^(대전|세종)/.test(p.addr);
const norm = (s) => String(s || "").normalize("NFKC").replace(/\(주\)|주식회사|유한회사|㈜/g, "").replace(/[\s\W_]/g, "").toLowerCase();
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
const asButton = (el, fn) => { el.tabIndex = 0; el.setAttribute("role", "button"); el.onclick = fn;
  el.onkeydown = (e) => { if (e.target === el && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); fn(e); } }; };

/* ---------- 초기화 ---------- */
async function init() {
  try { S.sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON); } catch (e) { console.warn("supabase init 실패", e); }
  try {
    const res = await fetch("data.json?v=" + (window.APP_VER || "1"), { cache: "no-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    S.data = await res.json();
  } catch (e) {
    $("#gate").classList.add("hidden"); $("#loadErr").classList.remove("hidden");
    $("#loadErrMsg").textContent = "데이터를 불러오지 못했습니다. 네트워크를 확인하고 다시 시도하세요."; return;
  }
  S.places = S.data.places; S.places.forEach(p => { p.m = p.m || {}; S.byId.set(p.id, p); });
  await applyFixes();
  S.local = store.get("local", true); S.sort = store.get("sort", "n");
  const per = store.get("period", "all"); S.period = per.p || "all"; S.month = per.m || "";
  recount();
  $("#dataInfo").textContent = `데이터 ${S.data.meta.from} ~ ${S.data.meta.to} · 업체 ${S.places.length.toLocaleString()} · 방문 ${S.data.meta.visits.toLocaleString()}건`;
  bindGate(); bindAuth(); bindApp(); bindFilters();
  if (sessionStorage.getItem("gate") === "1") { $("#gate").classList.add("hidden"); await afterGate(); }
}

/* ---------- 위치 수정(관리자가 바로잡은 업체) 반영 ---------- */
async function applyFixes() {
  if (!S.sb) return;
  let rows = [];
  try { const { data, error } = await S.sb.from("place_fixes").select("*"); if (!error && data) rows = data; } catch (e) {}
  S.fixes = rows;
  const K = { lat: S.data.meta.kriss[0], lng: S.data.meta.kriss[1] };
  for (const f of rows) {
    const p = S.byId.get(f.place_id); if (!p) continue;
    p.orig0 = p.orig0 || { name: p.name, addr: p.addr };
    const t = f.merge_into && S.byId.get(f.merge_into);
    if (t && t !== p) {           // 같은 업체가 이미 있으면 합친다
      for (const [k, v] of Object.entries(p.m)) t.m[k] = (t.m[k] || 0) + v;
      t.n += p.n; if ((p.last || "") > (t.last || "")) t.last = p.last;
      t.orig = [...new Set([...t.orig, ...p.orig])]; t.merged = [...(t.merged || []), p.id];
      p.hidden = true; S.alias.set(p.id, t.id);
    } else {
      Object.assign(p, { name: f.name, addr: f.addr, lat: f.lat, lng: f.lng, cat: f.cat || p.cat, sub: f.sub ?? p.sub });
      p.dist = hav(K, p); p.daejeon = p.addr.startsWith("대전");
    }
  }
  S.places = S.places.filter(p => !p.hidden).sort((a, b) => b.n - a.n);
}

/* ---------- 기간 ---------- */
function periodTest() {
  if (S.period === "all") return () => true;
  if (S.period === "12m") {
    const to = S.data.meta.to; let y = +to.slice(0, 4), m = +to.slice(5, 7) - 11; if (m <= 0) { m += 12; y--; }
    const from = String(y).slice(2) + String(m).padStart(2, "0"); return (k) => k >= from;
  }
  const Y = S.period.slice(2); return S.month ? (k) => k === Y + S.month : (k) => k.startsWith(Y);
}
function recount() {
  S.inP = periodTest(); S.cnt = new Map();
  for (const p of S.places) { let c = 0; for (const k in p.m) if (S.inP(k)) c += p.m[k]; S.cnt.set(p.id, c); }
}
const cnt = (p) => S.cnt.get(p.id) || 0;
const lastIn = (p) => { const ks = Object.keys(p.m).filter(S.inP).sort(); return ks.length ? ks[ks.length - 1] : ""; };
function periodLabel() {
  if (S.period === "all") return `전체 기간`;
  if (S.period === "12m") return "최근 12개월";
  return S.month ? `${S.period}년 ${+S.month}월` : `${S.period}년`;
}
function bindFilters() {
  const y0 = +S.data.meta.from.slice(0, 4), y1 = +S.data.meta.to.slice(0, 4), years = [];
  for (let y = y1; y >= y0; y--) years.push(String(y));
  $("#fPeriod").innerHTML = `<option value="all">전체 기간</option><option value="12m">최근 12개월</option>` + years.map(y => `<option value="${y}">${y}년</option>`).join("");
  $("#fMonth").innerHTML = `<option value="">1~12월</option>` + Array.from({ length: 12 }, (_, i) => `<option value="${String(i + 1).padStart(2, "0")}">${i + 1}월</option>`).join("");
  $("#fPeriod").value = S.period; $("#fMonth").value = S.month; $("#fLocal").checked = S.local; $("#fSort").value = S.sort;
  const changed = () => { store.set("period", { p: S.period, m: S.month }); recount(); syncFilters(); refreshView(); };
  $("#fPeriod").onchange = (e) => { S.period = e.target.value; S.month = ""; $("#fMonth").value = ""; changed(); };
  $("#fMonth").onchange = (e) => { S.month = e.target.value; changed(); };
  $("#fLocal").onchange = (e) => { S.local = e.target.checked; store.set("local", S.local); S.shown = 60; refreshView(); };
  $("#fSort").onchange = (e) => { S.sort = e.target.value; store.set("sort", S.sort); refreshView(); };
  $("#fExport").onclick = exportCurrent;
  syncFilters();
}
function syncFilters() { $("#fMonthWrap").classList.toggle("hidden", !/^\d{4}$/.test(S.period)); }
function placeFilters(view) {
  const bar = $("#filterBar"), target = view.startsWith("rank") ? "rank" : view.startsWith("map") ? "map" : view;
  const slot = target === "map" ? $("#view-map .map-toolbar") : $(`#view-${target} .filter-slot`);
  bar.classList.toggle("hidden", !slot);
  if (slot) slot.appendChild(bar);
  bar.classList.toggle("no-sort", !(target === "rank" || (view === "search")));
  bar.classList.toggle("no-export", !(target === "rank" || view === "search"));
  bar.classList.toggle("no-local", view === "random" || target === "map");
}
function refreshView() {
  const v = S.view;
  if (v.startsWith("rank")) renderRank();
  else if (v.startsWith("map")) drawOverlays();
  else if (v === "search") runSearch(true);
  else if (v === "stats") renderStats();
  else if (v === "random") { if (S.randomCat) pickRandom(S.randomCat); }
  if (S.detail) openDetail(S.detail, true);
}
function sortList(list, c = cnt) {
  const f = S.sort === "dist" ? (a, b) => a.dist - b.dist : S.sort === "last" ? (a, b) => (lastIn(b) || "").localeCompare(lastIn(a) || "") || c(b) - c(a) : (a, b) => c(b) - c(a) || a.dist - b.dist;
  return list.sort(f);
}

/* ---------- 접속 게이트 ---------- */
function bindGate() {
  $("#gateForm").addEventListener("submit", async (e) => {
    e.preventDefault(); const err = $("#gateErr"), btn = $("#gateBtn"); err.textContent = ""; btn.disabled = true;
    try {
      if (!S.sb) throw new Error("no client");
      const { data, error } = await S.sb.rpc("check_gate", { pw: $("#gatePw").value });
      if (error) throw error;
      if (data === true) { sessionStorage.setItem("gate", "1"); $("#gate").classList.add("hidden"); await afterGate(); }
      else err.textContent = "비밀번호가 맞지 않습니다.";
    } catch (e2) { err.textContent = "서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요."; }
    finally { btn.disabled = false; }
  });
}
async function afterGate() {
  let session = null;
  try { session = (await S.sb.auth.getSession()).data.session; } catch (e) {}
  if (session && (await onLogin(session.user)) === "ok") showApp(); else $("#auth").classList.remove("hidden");
}

/* ---------- 로그인 / 회원가입 ---------- */
function bindAuth() {
  $$("#authTabs .tab").forEach(b => b.addEventListener("click", () => {
    $$("#authTabs .tab").forEach(x => x.classList.toggle("active", x === b));
    $("#loginForm").classList.toggle("hidden", b.dataset.tab !== "login");
    $("#signupForm").classList.toggle("hidden", b.dataset.tab !== "signup");
  }));
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault(); const err = $("#loginErr"); err.textContent = "";
    const id = $("#loginId").value.trim(), pw = $("#loginPw").value;
    const { data, error } = await S.sb.auth.signInWithPassword({ email: emailOf(id), password: pw });
    if (error) { err.textContent = "아이디 또는 비밀번호가 맞지 않습니다."; return; }
    const r = await onLogin(data.user);
    if (r === "banned") { err.textContent = "탈퇴 처리된 계정입니다. 관리자에게 문의하세요."; return; }
    if (r === "rejected") { err.textContent = "가입 신청이 거절된 계정입니다. 관리자에게 문의하세요."; return; }
    showApp();
  });
  $("#signupForm").addEventListener("submit", async (e) => {
    e.preventDefault(); const err = $("#signupErr"); err.textContent = "";
    const id = $("#signupId").value.trim(), pw = $("#signupPw").value;
    const { data, error } = await S.sb.auth.signUp({ email: emailOf(id), password: pw, options: { data: { username: id.toLowerCase() } } });
    if (error) {
      err.textContent = /already|registered/i.test(error.message) ? "이미 사용 중인 아이디입니다."
        : /password/i.test(error.message) ? "비밀번호가 너무 약합니다. 더 길거나 복잡하게 정해 주세요." : "가입하지 못했습니다. 잠시 후 다시 시도하세요.";
      return;
    }
    if (!data.session) { err.textContent = "가입 처리 중 문제가 생겼습니다. 관리자에게 문의하세요."; return; }
    await onLogin(data.user); showApp();
    toast(canSee() ? "가입을 환영합니다!" : "가입 신청이 접수됐습니다. 관리자 승인 후 전체 기능을 쓸 수 있습니다.");
  });
  $("#guestBtn").addEventListener("click", () => { S.user = null; S.profile = null; S.favs = new Set(); showApp(); });
}
async function onLogin(user) {
  S.user = user; S.favs = new Set(); S.pv = new Map();
  const { data: prof } = await S.sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
  S.profile = prof || { id: user.id, username: user.user_metadata?.username || user.email.split("@")[0], approved: false };
  if (!prof) await S.sb.from("profiles").insert({ id: user.id, username: S.profile.username }).then(() => {}, () => {});
  const bad = S.profile.banned ? "banned" : S.profile.rejected ? "rejected" : null;
  if (bad) { await S.sb.auth.signOut(); S.user = null; S.profile = null; return bad; }
  if (canSee()) {
    const { data: favs } = await S.sb.from("favorites").select("place_id").eq("user_id", user.id);
    (favs || []).forEach(f => S.favs.add(S.alias.get(f.place_id) || f.place_id));
    loadNames();
  }
  return "ok";
}
async function logout() {
  try { await S.sb.auth.signOut(); } catch (e) {}
  S.user = null; S.profile = null; S.favs = new Set(); S.pv = new Map(); S.names = { group: [], person: [] };
  closeDetail(); $("#app").classList.add("hidden"); $("#auth").classList.remove("hidden");
}

/* ---------- 비공개 방문 기록 (승인 회원만, 서버 집계 함수 사용) ---------- */
async function loadNames() {
  for (const kind of ["group", "person"]) {
    const { data, error } = await S.sb.rpc("visit_names", { kind });
    if (error) { toast("방문 기록을 불러오지 못했습니다."); return; }
    S.names[kind] = (data || []).map(r => r.name);
  }
  if (S.view === "search") setupSearchInput();
}
async function placeVisits(p) {
  if (S.pv.has(p.id)) return S.pv.get(p.id);
  const ids = [p.id, ...(p.merged || [])], all = [];
  for (const pid of ids) {
    const { data, error } = await S.sb.rpc("place_visits", { pid });
    if (error) throw error;
    for (const v of data || []) all.push({ d: v.d, g: v.grp || "", p: Array.isArray(v.people) ? v.people : [] });
  }
  all.sort((a, b) => (a.d < b.d ? 1 : -1)); S.pv.set(p.id, all); return all;
}

/* ---------- 앱 뼈대 / 주소(라우팅) ---------- */
const TITLES = { stats: "통계", "rank-food": "맛집랭킹", search: "검색", "map-food": "맛집지도", "rank-cafe": "카페랭킹", "map-cafe": "카페지도", fav: "즐겨찾기", random: "랜덤 맛집", admin: "관리자" };
function showApp() {
  $("#auth").classList.add("hidden"); $("#app").classList.remove("hidden");
  const name = S.profile ? S.profile.username : "게스트";
  $("#userBtn").textContent = name;
  $("#sideUser").textContent = !S.profile ? "로그인하지 않음 · 식당별 방문 횟수만 표시" : canSee() ? `${name} 님` : `${name} 님 · 관리자 승인 대기 중`;
  $("#logoutBtn").textContent = S.profile ? "로그아웃" : "로그인";
  $$(".admin-only").forEach(el => el.classList.toggle("hidden", !isAdmin()));
  loadKakao(() => { S.kakaoReady = true; if (S.view.startsWith("map")) renderMap(); if (S.view === "search") renderSearchMap(); if (S.detail) renderMiniMap(S.detail); });
  S.view = ""; route();
}
function parseHash() {
  const [v, q] = decodeURIComponent(location.hash.slice(1)).split("?");
  const pid = +(new URLSearchParams(q || "").get("p") || 0);
  return { view: TITLES[v] ? v : "rank-food", pid };
}
function route() {
  if ($("#app").classList.contains("hidden")) return;
  const { view, pid } = parseHash();
  if (view !== S.view) showView(view);
  const p = pid && S.byId.get(S.alias.get(pid) || pid);
  if (p && !p.hidden) { if (!S.detail || S.detail.id !== p.id) openDetail(p); } else if (S.detail) hideDetail();
}
const go = (view) => { if (location.hash.slice(1) !== view) location.hash = view; else route(); };
function bindApp() {
  const side = $("#sidebar"), bd = $("#backdrop");
  const openSide = (o) => { side.classList.toggle("open", o); bd.classList.toggle("show", o); };
  $("#menuBtn").onclick = () => openSide(true); $("#closeSide").onclick = () => openSide(false); bd.onclick = () => openSide(false);
  $$("#sidebar .menu button").forEach(b => b.onclick = () => { go(b.dataset.view); openSide(false); });
  $("#logoutBtn").onclick = logout;
  $("#userBtn").onclick = () => S.profile ? toast(`${S.profile.username} 님으로 로그인 중`) : logout();
  $("#searchBox").addEventListener("input", (e) => { S.q = e.target.value.trim(); S.shown = 60; renderRank(); });
  $$("#searchModes .chip").forEach(b => b.onclick = () => {
    if (b.dataset.mode !== "place" && !canSee()) { toast(S.profile ? "관리자 승인 후 사용할 수 있습니다." : "소속·이름 검색은 로그인 후 사용할 수 있습니다."); return; }
    S.searchMode = b.dataset.mode; S.searchKind = "food"; S.searchRows = null; setupSearchInput(); runSearch(); });
  let st; $("#searchInput").addEventListener("input", (e) => { S.searchQ = e.target.value.trim(); clearTimeout(st); st = setTimeout(runSearch, 250); });
  $$("#searchKind button").forEach(b => b.onclick = () => { S.searchKind = b.dataset.kind; runSearch(true); });
  $("#detailClose").onclick = closeDetail;
  $("#dHeart").onclick = () => S.detail && toggleFav(S.detail.id);
  $("#moreGroups").onclick = () => showMore("groups"); $("#morePeople").onclick = () => showMore("people");
  $("#recenterBtn").onclick = () => S.map && (S.map.setLevel(5), S.map.setCenter(new kakao.maps.LatLng(...S.data.meta.center)));
  $("#randomAgain").onclick = () => pickRandom(S.randomCat);
  $("#gatePwForm").addEventListener("submit", async (e) => {
    e.preventDefault(); const v = $("#newGatePw").value;
    const { error } = await S.sb.rpc("set_gate_password", { pw: v });
    $("#gatePwMsg").textContent = error ? "변경하지 못했습니다: " + error.message : "변경되었습니다. 다음 접속부터 새 비밀번호가 적용됩니다.";
    if (!error) $("#newGatePw").value = "";
  });
  $("#geoScan").onclick = geoScan;
  document.addEventListener("keydown", (e) => e.key === "Escape" && S.detail && closeDetail());
  window.addEventListener("hashchange", route);
}
function showView(view) {
  if (view === "admin" && !isAdmin()) view = "rank-food";
  S.view = view; S.pushed = 0; hideDetail();
  $("#pageTitle").textContent = TITLES[view] || "KRISS 맛집로드";
  document.title = `${TITLES[view]} · KRISS 맛집로드`;
  $$("#sidebar .menu button").forEach(b => { const on = b.dataset.view === view; b.classList.toggle("active", on); b.toggleAttribute("aria-current", on); });
  const target = view.startsWith("rank") ? "rank" : view.startsWith("map") ? "map" : view;
  $$("#main .view").forEach(v => v.classList.toggle("active", v.id === "view-" + target));
  placeFilters(view);
  if (target === "rank") { S.cat = "전체"; S.q = ""; S.shown = 60; $("#searchBox").value = ""; $("#searchBox").placeholder = view === "rank-cafe" ? "카페 이름·주소 검색" : "식당 이름·주소 검색"; renderChips(); renderRank(); }
  if (target === "map") { S.mapKind = view.endsWith("cafe") ? "cafe" : "food"; renderMap(); }
  if (view === "search") { setupSearchInput(); runSearch(); }
  if (view === "stats") renderStats();
  if (view === "fav") renderFav();
  if (view === "random") renderRandom();
  if (view === "admin") renderAdmin();
  $("#main").scrollTop = 0;
}

/* ---------- 랭킹 ---------- */
const pool = (kind) => S.places.filter(p => kind === "cafe" ? p.cat === "카페" : p.cat !== "카페");
const regionOk = (p) => !S.local || isLocal(p);
function renderChips() {
  const el = $("#catChips"); const cafe = S.view === "rank-cafe";
  el.classList.toggle("hidden", cafe); if (cafe) return;
  el.innerHTML = FOOD_CATS.map(c => `<button class="chip ${c === S.cat ? "active" : ""}" data-cat="${c}" aria-pressed="${c === S.cat}">${c}</button>`).join("");
  $$(".chip", el).forEach(b => b.onclick = () => { S.cat = b.dataset.cat; S.shown = 60; renderChips(); renderRank(); });
}
function rankItem(p, rank, c, lbl) {
  const n = c ?? cnt(p), all = S.period !== "all" || c != null;
  return `<li class="rank-item" data-id="${p.id}" tabindex="0" role="button" aria-label="${esc(p.name)}, ${n}회 방문">
    <div class="rank-no ${rank <= 3 ? "top" : ""}">${rank}</div>
    <div class="rank-main"><div class="rank-name">${esc(p.name)}</div>
      <div class="rank-meta"><span class="tag">${esc(p.sub || p.cat)}</span>${esc(p.addr)}</div></div>
    <div class="rank-count"><b>${n}</b><span>${lbl || "회 방문"}</span>${all ? `<span class="tiny">전체 ${p.n}회</span>` : ""}<span class="tiny dist">${fmtDist(p.dist)}</span></div>
    <button class="heart ${S.favs.has(p.id) ? "on" : ""}" data-fav="${p.id}" aria-label="즐겨찾기" aria-pressed="${S.favs.has(p.id)}"></button></li>`;
}
function rankData() {
  const kind = S.view === "rank-cafe" ? "cafe" : "food";
  let list = pool(kind).filter(p => regionOk(p) && cnt(p) > 0);
  if (kind === "food" && S.cat !== "전체") list = list.filter(p => p.cat === S.cat);
  if (S.q) { const q = S.q.toLowerCase(); list = list.filter(p => p.name.toLowerCase().includes(q) || p.orig.some(o => o.toLowerCase().includes(q)) || p.addr.includes(S.q)); }
  return sortList(list);
}
function renderRank() {
  const list = rankData(), el = $("#rankList");
  el.innerHTML = list.slice(0, S.shown).map((p, i) => rankItem(p, i + 1)).join("") +
    (list.length > S.shown ? `<li class="more-li"><button class="btn" id="moreBtn">더 보기 (${list.length - S.shown}곳 남음)</button></li>` : "") +
    (list.length === 0 ? `<li class="muted pad">${S.q ? "검색 결과가 없습니다." : `${periodLabel()}에 방문 기록이 없습니다.`}</li>` : "");
  bindList(el); const mb = $("#moreBtn"); if (mb) mb.onclick = () => { S.shown += 60; renderRank(); };
}
function bindList(el) {
  $$(".rank-item", el).forEach(li => {
    const open = (e) => { if (e.target.closest("[data-fav]")) return; openDetail(S.byId.get(+li.dataset.id)); };
    li.onclick = open; li.onkeydown = (e) => { if (e.target === li && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(e); } };
  });
  $$("[data-fav]", el).forEach(b => b.onclick = (e) => { e.stopPropagation(); toggleFav(+b.dataset.fav); });
}

/* ---------- 엑셀(CSV) 내보내기 ---------- */
function downloadCsv(name, header, rows) {
  const cell = (v) => { v = String(v ?? ""); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const csv = "﻿" + [header, ...rows].map(r => r.map(cell).join(",")).join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `${name}_${periodLabel().replace(/\s/g, "")}.csv`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function exportCurrent() {
  const head = ["순위", "업체명", "분류", "세부분류", "주소", "KRISS 거리(m)", `방문 횟수(${periodLabel()})`, "전체 방문 횟수", "최근 방문"];
  const row = (p, i, c) => [i + 1, p.name, p.cat, p.sub, p.addr, p.dist, c, p.n, p.last];
  if (S.view.startsWith("rank")) {
    const list = rankData(); downloadCsv(S.view === "rank-cafe" ? "카페랭킹" : `맛집랭킹_${S.cat}`, head, list.map((p, i) => row(p, i, cnt(p))));
  } else if (S.view === "search") {
    if (!S.searchList.length) { toast("내보낼 검색 결과가 없습니다."); return; }
    const c = S.searchCount ? (p) => S.searchCount.get(p.id) || 0 : cnt;
    downloadCsv(`검색_${S.searchQ}_${S.searchKind === "cafe" ? "카페" : "식당"}`, head, S.searchList.map((p, i) => row(p, i, c(p))));
  }
}

/* ---------- 즐겨찾기 ---------- */
async function toggleFav(id) {
  if (!S.user) { toast("즐겨찾기는 로그인 후 사용할 수 있습니다."); return; }
  if (!canSee()) { toast("관리자 승인 후 즐겨찾기를 사용할 수 있습니다."); return; }
  const on = S.favs.has(id), p = S.byId.get(id), ids = [id, ...((p && p.merged) || [])];
  if (on) {
    S.favs.delete(id);
    const { error } = await S.sb.from("favorites").delete().eq("user_id", S.user.id).in("place_id", ids);
    if (error) { S.favs.add(id); toast("해제하지 못했습니다. 다시 시도하세요."); }
  } else {
    S.favs.add(id);
    const { error } = await S.sb.from("favorites").insert({ user_id: S.user.id, place_id: id });
    if (error) { S.favs.delete(id); toast("저장하지 못했습니다. 다시 시도하세요."); }
  }
  $$(`[data-fav="${id}"]`).forEach(b => { b.classList.toggle("on", S.favs.has(id)); b.setAttribute("aria-pressed", S.favs.has(id)); });
  if (S.detail && S.detail.id === id) { $("#dHeart").classList.toggle("on", S.favs.has(id)); $("#dHeart").setAttribute("aria-pressed", S.favs.has(id)); }
  if (S.view === "fav") renderFav();
}
function renderFav() {
  const el = $("#favList"), empty = $("#favEmpty");
  if (!S.user) { el.innerHTML = ""; empty.textContent = "로그인하면 즐겨찾기를 저장하고 어디서든 다시 볼 수 있습니다."; return; }
  if (!canSee()) { el.innerHTML = ""; empty.textContent = "관리자 승인 후 즐겨찾기를 사용할 수 있습니다."; return; }
  const list = [...S.favs].map(id => S.byId.get(id)).filter(Boolean).sort((a, b) => b.n - a.n);
  empty.textContent = list.length ? "" : "아직 즐겨찾기가 없습니다. 식당 카드의 ♥를 눌러 보세요.";
  el.innerHTML = list.map((p, i) => rankItem(p, i + 1)).join(""); bindList(el);
}

/* ---------- 막대 그래프 ---------- */
function bars(rows, opt = {}) {          // rows: [[라벨, 값, 키]]
  const max = Math.max(1, ...rows.map(r => r[1]));
  return `<div class="chart ${opt.cls || ""}" role="list">` + rows.map(([l, v, k]) =>
    `<${opt.click ? "button" : "div"} class="col ${opt.active === k ? "active" : ""}" role="listitem" ${opt.click ? `data-k="${esc(k)}" type="button"` : ""} aria-label="${esc(l)} ${v}회">
      <b>${v || ""}</b><i style="height:${Math.round(v / max * 100)}%"></i><span>${esc(l)}</span></${opt.click ? "button" : "div"}>`).join("") + `</div>`;
}
function monthRows(mm) {                  // 선택 기간에 맞는 월별 막대
  let keys;
  if (/^\d{4}$/.test(S.period)) { const Y = S.period.slice(2); keys = Array.from({ length: 12 }, (_, i) => Y + String(i + 1).padStart(2, "0")); }
  else { const to = S.data.meta.to; let y = +to.slice(0, 4), m = +to.slice(5, 7); keys = [];
    for (let i = 0; i < 12; i++) { keys.unshift(String(y).slice(2) + String(m).padStart(2, "0")); if (--m === 0) { m = 12; y--; } } }
  return keys.map(k => [`${+k.slice(2)}월`, mm[k] || 0, k]);
}
function yearRows(mm) {
  const y0 = +S.data.meta.from.slice(0, 4), y1 = +S.data.meta.to.slice(0, 4), out = [];
  for (let y = y0; y <= y1; y++) { const Y = String(y).slice(2); let s = 0; for (const k in mm) if (k.startsWith(Y)) s += mm[k]; out.push([`${String(y).slice(2)}년`, s, String(y)]); }
  return out;
}
const monthTitle = () => /^\d{4}$/.test(S.period) ? `${S.period}년 월별 방문` : `최근 12개월 월별 방문 (${S.data.meta.to.slice(0, 7)}까지)`;
function bindYearClicks(el) {
  $$("[data-k]", el).forEach(b => b.onclick = () => {
    const k = b.dataset.k;
    if (/^\d{4}$/.test(k)) { S.period = S.period === k ? "all" : k; S.month = ""; }
    else { S.period = "20" + k.slice(0, 2); S.month = S.month === k.slice(2) ? "" : k.slice(2); }
    $("#fPeriod").value = S.period; $("#fMonth").value = S.month; store.set("period", { p: S.period, m: S.month }); recount(); syncFilters(); refreshView();
  });
}

/* ---------- 통계 ---------- */
function renderStats() {
  const el = $("#statsBody"), places = S.places.filter(regionOk);
  const mmAll = {}; for (const p of places) for (const [k, v] of Object.entries(p.m)) mmAll[k] = (mmAll[k] || 0) + v;
  const inP = places.filter(p => cnt(p) > 0), total = inP.reduce((s, p) => s + cnt(p), 0);
  const byCat = ALL_CATS.map(c => [c, inP.filter(p => p.cat === c).reduce((s, p) => s + cnt(p), 0)]).filter(r => r[1]).sort((a, b) => b[1] - a[1]);
  const top = (kind, n) => sortList(inP.filter(p => kind === "cafe" ? p.cat === "카페" : p.cat !== "카페")).slice(0, n);
  el.innerHTML = `
    <div class="kpis"><div class="stat"><div class="num">${total.toLocaleString()}</div><div class="lbl">방문 횟수</div></div>
      <div class="stat"><div class="num">${inP.length.toLocaleString()}</div><div class="lbl">방문 업체</div></div>
      <div class="stat"><div class="num">${esc(periodLabel())}</div><div class="lbl">${S.local ? "대전·세종" : "전체 지역"}</div></div></div>
    <section class="card"><h3>연도별 방문 <small class="muted">막대를 누르면 그 해로 바뀝니다</small></h3>${bars(yearRows(mmAll), { click: 1, active: S.period })}</section>
    <section class="card"><h3>${monthTitle()}</h3>${bars(monthRows(mmAll), { click: 1, active: S.month ? S.period.slice(2) + S.month : "" })}</section>
    <section class="card"><h3>분류별 비율</h3><ol class="bar-list">${byCat.map(([c, n]) => `<li><span>${c}</span><b>${n}회 · ${Math.round(n / total * 100)}%</b><div class="bar"><i style="width:${Math.round(n / byCat[0][1] * 100)}%"></i></div></li>`).join("") || `<li class="muted">기록 없음</li>`}</ol></section>
    <section class="card"><h3>맛집 TOP 10</h3><ol class="rank-list compact" id="statsTopFood">${top("food", 10).map((p, i) => rankItem(p, i + 1)).join("")}</ol></section>
    <section class="card"><h3>카페 TOP 5</h3><ol class="rank-list compact" id="statsTopCafe">${top("cafe", 5).map((p, i) => rankItem(p, i + 1)).join("")}</ol></section>
    ${canSee() ? `<p class="muted small pad">소속·사람별 통계는 <a href="#search">검색</a>에서 소속이나 이름을 고르면 볼 수 있습니다.</p>` : ""}`;
  bindYearClicks(el); bindList($("#statsTopFood")); bindList($("#statsTopCafe"));
}

/* ---------- 상세 ---------- */
function openDetail(p, refresh) {
  if (!p) return;
  if (!refresh) {
    const want = `${S.view}?p=${p.id}`;
    if (decodeURIComponent(location.hash.slice(1)) !== want) { S.pushed = (S.pushed || 0) + 1; location.hash = want; return; }
  }
  const first = !S.detail; S.detail = p;
  const d = $("#detail"); d.classList.remove("hidden"); d.setAttribute("aria-hidden", "false");
  if (first && !refresh) { S.lastFocus = document.activeElement; setTimeout(() => $("#detailClose").focus(), 30); }
  $("#dName").textContent = p.name;
  $("#dSub").textContent = `${p.sub || p.cat} · ${p.addr} · KRISS에서 ${fmtDist(p.dist)}`;
  $("#dHeart").classList.toggle("on", S.favs.has(p.id)); $("#dHeart").setAttribute("aria-pressed", S.favs.has(p.id));
  $("#lkKakao").href = `https://map.kakao.com/link/map/${encodeURIComponent(p.name.replace(/,/g, " "))},${p.lat},${p.lng}`;
  $("#lkNaver").href = `https://map.naver.com/p/search/${encodeURIComponent(p.name + " " + p.addr.split(" ").slice(0, 2).join(" "))}`;
  $("#lkGoogle").href = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
  const c = cnt(p), lp = lastIn(p);
  $("#dCount").textContent = c; $("#dCountLbl").textContent = S.period === "all" ? "방문 횟수" : `방문 (${periodLabel()})`;
  $("#dLast").textContent = S.period === "all" ? (p.last || "").slice(2).replace(/-/g, ".") : lp ? `${lp.slice(0, 2)}.${lp.slice(2)}` : "-";
  $("#dTrendTitle").textContent = monthTitle();
  $("#dTrend").innerHTML = bars(monthRows(p.m), { cls: "small" }) + `<div class="years">${yearRows(p.m).filter(r => r[1]).map(r => `<span>${r[0]} <b>${r[1]}</b></span>`).join("")}</div>`;
  $("#dGroups").textContent = "-"; $("#dPrivate").classList.add("hidden"); $("#dMore").classList.add("hidden"); S.moreKind = null;
  const lock = $("#dLocked"); lock.classList.toggle("hidden", canSee());
  lock.textContent = !S.profile ? "방문 그룹·인원 정보는 로그인 후 볼 수 있습니다." : "관리자 승인 후 방문 그룹·인원 정보를 볼 수 있습니다.";
  if (canSee()) fillPrivate(p);
  if (p.cat !== "카페") {
    const cafes = S.places.filter(x => x.cat === "카페").map(x => [x, hav(p, x)]).sort((a, b) => a[1] - b[1]).slice(0, 3);
    $("#dCafes").innerHTML = `<h3>가까운 카페</h3><ul class="cafe-list">` + cafes.map(([x, dd]) => `<li data-cafe="${x.id}"><span class="nm">${esc(x.name)}</span><span class="vn">${x.n}회</span><span class="ds">${fmtDist(dd)}</span></li>`).join("") + `</ul>`;
    $$("[data-cafe]").forEach(li => asButton(li, () => openDetail(S.byId.get(+li.dataset.cafe))));
  } else $("#dCafes").innerHTML = "";
  if (!refresh) $("#detail .detail-body").scrollTop = 0;
  if (S.kakaoReady) renderMiniMap(p);
}
async function fillPrivate(p) {
  let vs;
  try { vs = await placeVisits(p); } catch (e) { $("#dLocked").classList.remove("hidden"); $("#dLocked").textContent = "방문 기록을 불러오지 못했습니다."; return; }
  if (S.detail !== p) return;
  vs = vs.filter(v => S.inP(ymKey(v.d)));
  const groups = countBy(vs.map(v => v.g)), people = countBy(vs.flatMap(v => v.p));
  const bl = (rows) => rows.length ? rows.slice(0, 5).map(([k, n]) => `<li><span>${esc(k)}</span><b>${n}회</b><div class="bar"><i style="width:${Math.round(n / rows[0][1] * 100)}%"></i></div></li>`).join("") : `<li class="muted">${periodLabel()} 기록 없음</li>`;
  $("#dGroups").textContent = groups.length; $("#dPrivate").classList.remove("hidden");
  $("#dTopGroups").innerHTML = bl(groups); $("#dTopPeople").innerHTML = bl(people);
  p._vs = vs; if (S.moreKind) { const k = S.moreKind; S.moreKind = null; showMore(k); }
}
function hideDetail() {
  if (!S.detail) return;
  $("#detail").classList.add("hidden"); $("#detail").setAttribute("aria-hidden", "true"); S.detail = null;
  if (S.lastFocus && document.contains(S.lastFocus)) S.lastFocus.focus(); S.lastFocus = null;
}
function closeDetail() {
  if (!S.detail) return;
  if (S.pushed > 0) { S.pushed--; history.back(); }
  else { history.replaceState(null, "", "#" + S.view); hideDetail(); }
}
function showMore(kind) {
  const p = S.detail; if (!p || !p._vs) return;
  if (S.moreKind === kind) { $("#dMore").classList.add("hidden"); S.moreKind = null; return; }
  S.moreKind = kind;
  const byKey = new Map();
  for (const v of p._vs) for (const k of (kind === "groups" ? [v.g] : v.p)) { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(v.d); }
  const rows = [...byKey.entries()].sort((a, b) => b[1].length - a[1].length);
  $("#dMoreTitle").textContent = kind === "groups" ? `방문 그룹 전체 (${rows.length})` : `방문 인원 전체 (${rows.length})`;
  $("#dMoreTable thead").innerHTML = `<tr><th>${kind === "groups" ? "그룹" : "이름"}</th><th>횟수</th><th>방문일자</th></tr>`;
  $("#dMoreTable tbody").innerHTML = rows.map(([k, ds]) => `<tr><td>${esc(k)}</td><td>${ds.length}</td><td class="muted">${ds.map(x => x.slice(2)).join(", ")}</td></tr>`).join("");
  $("#dMore").classList.remove("hidden"); $("#dMore").scrollIntoView({ behavior: "smooth", block: "start" });
}
function renderMiniMap(p) {
  const pos = new kakao.maps.LatLng(p.lat, p.lng);
  if (!S.miniMap) { S.miniMap = new kakao.maps.Map($("#dMap"), { center: pos, level: 3 }); S.miniMarker = new kakao.maps.Marker({ map: S.miniMap, position: pos }); }
  else { S.miniMap.relayout(); S.miniMap.setLevel(3); S.miniMap.setCenter(pos); S.miniMarker.setPosition(pos); }
  setTimeout(() => { S.miniMap.relayout(); S.miniMap.setCenter(pos); }, 60);
}

/* ---------- 지도 ---------- */
function loadKakao(cb) {
  if (window.kakao && kakao.maps && kakao.maps.Map) return cb();
  if (S.kakaoLoading) return; S.kakaoLoading = true;
  const s = document.createElement("script");
  s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${C.KAKAO_JS_KEY}&autoload=false&libraries=services`;
  s.onload = () => kakao.maps.load(cb);
  s.onerror = () => { S.kakaoLoading = false; console.warn("카카오맵 SDK 로딩 실패 (도메인 등록 확인)"); $$(".map-fail").forEach(x => x.remove());
    for (const el of [$("#map"), $("#searchMap"), $("#dMap")]) el.insertAdjacentHTML("afterend", `<p class="map-fail">지도를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.</p>`); };
  document.head.appendChild(s);
}
function renderMap() {
  if (!S.kakaoReady) return;
  const el = $("#map");
  if (!S.map) {
    S.map = new kakao.maps.Map(el, { center: new kakao.maps.LatLng(...S.data.meta.center), level: 5 });
    S.map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
    kakao.maps.event.addListener(S.map, "idle", drawOverlays);
  }
  setTimeout(() => { S.map.relayout(); drawOverlays(); }, 50);
}
function clearOverlays() { S.overlays.forEach(o => o.setMap(null)); S.overlays = []; }
function drawOverlays() {
  if (!S.map || !S.view.startsWith("map")) return;
  clearOverlays();
  S.overlays = drawOn(S.map, pool(S.mapKind).filter(p => cnt(p) > 0), cnt, $("#mapLegend"));
}
function drawOn(map, list, c, legend) {
  const out = [], level = map.getLevel(), b = map.getBounds();
  const sw = b.getSouthWest(), ne = b.getNorthEast();
  const pad = (ne.getLat() - sw.getLat()) * 0.15, padL = (ne.getLng() - sw.getLng()) * 0.15;
  const inView = list.filter(p => p.lat > sw.getLat() - pad && p.lat < ne.getLat() + pad && p.lng > sw.getLng() - padL && p.lng < ne.getLng() + padL);
  const pinLevel = inView.length <= 40 ? 6 : 4;
  if (level <= pinLevel) {     // 확대: 식당 이름 핀
    inView.sort((a, b) => c(b) - c(a)).slice(0, 400).forEach(p => {
      const div = document.createElement("div"); div.className = `pin ${p.cat === "카페" ? "cafe" : ""}`;
      div.innerHTML = `<span class="lbl">${esc(p.name)}<b>${c(p)}</b></span><span class="tip"></span>`;
      div.setAttribute("aria-label", `${p.name} ${c(p)}회`); asButton(div, () => openDetail(p));
      const ov = new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(p.lat, p.lng), content: div, zIndex: c(p) });
      ov.setMap(map); out.push(ov);
    });
    legend.textContent = `핀 ${Math.min(inView.length, 400)}곳 · 숫자는 방문 횟수 (${periodLabel()})`;
  } else {                      // 축소: 방문횟수 가중 밀도 클러스터
    const proj = map.getProjection(), cell = level >= 8 ? 90 : 70, buckets = new Map();
    for (const p of inView) {
      const pt = proj.containerPointFromCoords(new kakao.maps.LatLng(p.lat, p.lng));
      const k = `${Math.floor(pt.x / cell)}_${Math.floor(pt.y / cell)}`;
      const bk = buckets.get(k) || { n: 0, c: 0, lat: 0, lng: 0 }, w = c(p);
      bk.n += w; bk.c++; bk.lat += p.lat * w; bk.lng += p.lng * w; buckets.set(k, bk);
    }
    const max = Math.max(1, ...[...buckets.values()].map(x => x.n));
    for (const bk of buckets.values()) {
      const size = Math.round(28 + 52 * Math.sqrt(bk.n / max)), ratio = bk.n / max;
      const div = document.createElement("div"); div.className = `cluster ${ratio > .6 ? "hot" : ratio > .3 ? "warm" : ratio > .12 ? "cool" : ""}`;
      div.style.cssText = `width:${size}px;height:${size}px;font-size:${size > 50 ? 14 : 12}px`; div.textContent = bk.n;
      div.title = `${bk.c}곳 · ${bk.n}회 방문`; div.setAttribute("aria-label", `${bk.c}곳 ${bk.n}회 방문, 확대`);
      const pos = new kakao.maps.LatLng(bk.lat / bk.n, bk.lng / bk.n);
      asButton(div, () => { map.setLevel(Math.max(1, level - 2), { anchor: pos }); map.setCenter(pos); });
      const ov = new kakao.maps.CustomOverlay({ position: pos, content: div, zIndex: bk.n });
      ov.setMap(map); out.push(ov);
    }
    legend.innerHTML = `원의 숫자 = 방문 횟수 합 (${esc(periodLabel())}) · <span class="dot hot">●</span> 많음 <span class="dot warm">●</span> 보통 <span class="dot cool">●</span> 적음 <span class="dot">●</span> 드묾 · 확대하면 이름이 보입니다`;
  }
  return out;
}

/* ---------- 검색 ---------- */
function setupSearchInput() {
  const inp = $("#searchInput"), dl = $("#searchList");
  if (S.searchMode !== "place" && !canSee()) S.searchMode = "place";
  $$("#searchModes .chip").forEach(x => { const on = x.dataset.mode === S.searchMode; x.classList.toggle("active", on); x.setAttribute("aria-pressed", on); x.classList.toggle("locked", x.dataset.mode !== "place" && !canSee()); });
  inp.placeholder = { place: "식당·카페 이름이나 주소 검색", group: "소속(그룹) 이름 검색", person: "사람 이름 검색" }[S.searchMode];
  dl.innerHTML = (S.searchMode === "group" ? S.names.group : S.searchMode === "person" ? S.names.person.slice(0, 2000) : []).map(x => `<option value="${esc(x)}">`).join("");
  inp.value = S.searchQ;
}
async function runSearch(keep) {
  const q = S.searchQ, mode = S.searchMode, res = $("#searchResults"), hint = $("#searchHint"), box = $("#searchMapBox"), stats = $("#searchStats");
  S.searchList = []; S.searchCount = null;
  $("#searchKind").classList.add("hidden"); stats.classList.add("hidden");
  if (!q) { res.innerHTML = ""; hint.textContent = { place: "식당이나 카페 이름, 주소를 입력하세요.", group: "소속을 입력하면 그 소속이 자주 간 식당·카페 순서와 연도·월별 추이가 나옵니다.", person: "이름을 입력하면 그 사람이 자주 간 식당·카페 순서와 연도·월별 추이가 나옵니다." }[mode]; box.classList.add("hidden"); return; }
  if (mode === "place") {
    const ql = q.toLowerCase();
    const list = sortList(S.places.filter(p => regionOk(p) && (p.name.toLowerCase().includes(ql) || p.orig.some(o => o.toLowerCase().includes(ql)) || p.addr.includes(q))), (p) => cnt(p));
    S.searchList = list;
    hint.innerHTML = list.length ? `<b>${list.length}</b>곳` : "검색 결과가 없습니다."; box.classList.add("hidden");
    res.innerHTML = list.slice(0, 100).map((p, i) => rankItem(p, i + 1)).join(""); bindList(res); return;
  }
  const names = S.names[mode], exact = names.includes(q), key = `${mode}|${q}|${exact}`;
  if (!keep || !S.searchRows || S.searchRows.key !== key) {
    const seq = ++S.searchSeq; hint.textContent = "찾는 중…";
    const { data, error } = await S.sb.rpc("match_visits", { kind: mode, q, exact });
    if (seq !== S.searchSeq) return;
    if (error) { hint.textContent = "검색하지 못했습니다. 잠시 후 다시 시도하세요."; res.innerHTML = ""; return; }
    const rows = (data || []).map(r => ({ id: S.alias.get(r.place_id) || r.place_id, k: r.ym.slice(2, 4) + r.ym.slice(5, 7), n: r.n }));
    S.searchRows = { key, rows };
  }
  const rows = S.searchRows.rows, cntMap = new Map(), mm = {}, mmFood = {};
  for (const r of rows) {
    const p = S.byId.get(r.id); if (!p || !regionOk(p)) continue;
    mm[r.k] = (mm[r.k] || 0) + r.n;
    if (S.inP(r.k)) cntMap.set(r.id, (cntMap.get(r.id) || 0) + r.n);
  }
  const all = [...cntMap.keys()].map(id => S.byId.get(id));
  S.searchCount = cntMap;
  if (!rows.length) { hint.textContent = "검색 결과가 없습니다."; res.innerHTML = ""; box.classList.add("hidden"); return; }
  const c = (p) => cntMap.get(p.id) || 0;
  const food = sortList(all.filter(p => p.cat !== "카페"), c), cafe = sortList(all.filter(p => p.cat === "카페"), c);
  const sum = (l) => l.reduce((s, p) => s + c(p), 0);
  const seg = $("#searchKind"); seg.classList.remove("hidden");
  $("#segFoodN").textContent = food.length; $("#segCafeN").textContent = cafe.length;
  $$("#searchKind button").forEach(b => b.classList.toggle("active", b.dataset.kind === S.searchKind));
  const list = S.searchKind === "cafe" ? cafe : food; S.searchList = list;
  const label = S.searchKind === "cafe" ? "카페" : "식당";
  hint.innerHTML = `<b>${esc(q)}</b>${exact ? "" : " (부분 일치)"} · ${esc(periodLabel())} · ${label} <b>${list.length}</b>곳 · 방문 <b>${sum(list)}</b>회`;
  // 소속·사람별 통계
  const byCat = ALL_CATS.map(k => [k, all.filter(p => p.cat === k).reduce((s, p) => s + c(p), 0)]).filter(r => r[1]).sort((a, b) => b[1] - a[1]);
  const tot = byCat.reduce((s, r) => s + r[1], 0);
  stats.innerHTML = `<div class="card"><h3>연도별 방문</h3>${bars(yearRows(mm), { click: 1, active: S.period })}</div>
    <div class="card"><h3>${monthTitle()}</h3>${bars(monthRows(mm), { click: 1, active: S.month ? S.period.slice(2) + S.month : "" })}</div>
    <div class="card"><h3>분류별 비율 (${esc(periodLabel())})</h3><ol class="bar-list">${byCat.map(([k, n]) => `<li><span>${k}</span><b>${n}회 · ${Math.round(n / tot * 100)}%</b><div class="bar"><i style="width:${Math.round(n / byCat[0][1] * 100)}%"></i></div></li>`).join("") || `<li class="muted">기록 없음</li>`}</ol></div>`;
  stats.classList.remove("hidden"); bindYearClicks(stats);
  box.classList.toggle("hidden", !list.length);
  res.innerHTML = list.length ? list.slice(0, 150).map((p, i) => rankItem(p, i + 1, c(p), "회 방문")).join("") : `<li class="muted pad">${esc(periodLabel())}에 이 검색어로 방문한 ${label}이 없습니다.</li>`;
  bindList(res);
  renderSearchMap();
}
function renderSearchMap() {
  if (!S.kakaoReady || S.view !== "search") return;
  if (!S.searchList.length || !S.searchCount) { drawSearchOverlays(); return; }
  const el = $("#searchMap");
  if (!S.smap) {
    S.smap = new kakao.maps.Map(el, { center: new kakao.maps.LatLng(...S.data.meta.center), level: 5 });
    S.smap.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
    kakao.maps.event.addListener(S.smap, "idle", drawSearchOverlays);
  }
  S.smap.relayout();
  const bounds = new kakao.maps.LatLngBounds();
  S.searchList.filter(p => p.dist < 30000).forEach(p => bounds.extend(new kakao.maps.LatLng(p.lat, p.lng)));
  if (!bounds.isEmpty()) S.smap.setBounds(bounds, 30); else S.smap.setCenter(new kakao.maps.LatLng(S.searchList[0].lat, S.searchList[0].lng));
  if (S.smap.getLevel() < 3) S.smap.setLevel(3);
  setTimeout(drawSearchOverlays, 80);
}
function drawSearchOverlays() {
  if (!S.smap || S.view !== "search") return;
  S.soverlays.forEach(o => o.setMap(null));
  S.soverlays = S.searchList.length && S.searchCount ? drawOn(S.smap, S.searchList, p => S.searchCount.get(p.id) || 0, $("#searchLegend")) : [];
}

/* ---------- 랜덤 ---------- */
function renderRandom() {
  const el = $("#randomCats");
  el.innerHTML = RANDOM_CATS.map(c => `<button class="chip ${S.randomCat === c ? "active" : ""}" data-cat="${c}" aria-pressed="${S.randomCat === c}">${c}</button>`).join("");
  $$(".chip", el).forEach(b => b.onclick = () => { S.randomCat = b.dataset.cat; renderRandom(); pickRandom(b.dataset.cat); });
  if (!S.randomCat) { $("#randomResult").classList.add("hidden"); $("#randomAgain").classList.add("hidden"); }
}
function pickRandom(cat) {
  const top = S.places.filter(p => isLocal(p) && p.cat === cat && cnt(p) > 0).sort((a, b) => cnt(b) - cnt(a)).slice(0, 30);
  if (!top.length) { toast(`${periodLabel()}에 방문한 대전·세종 ${cat} 업체가 없습니다.`); return; }
  let p; do { p = top[Math.floor(Math.random() * top.length)]; } while (top.length > 1 && p === S.lastRandom);
  S.lastRandom = p; const rank = top.indexOf(p) + 1;
  const r = $("#randomResult"); r.classList.remove("hidden"); $("#randomAgain").classList.remove("hidden");
  r.innerHTML = `<span class="rank-badge">대전·세종 ${cat} ${rank}위</span><div class="big-name">${esc(p.name)}</div>
    <div class="muted">${esc(p.sub || p.cat)} · ${esc(p.addr)}</div><div class="muted small" style="margin-top:8px">${cnt(p)}회 방문 (${esc(periodLabel())}) · KRISS에서 ${fmtDist(p.dist)}</div>
    <div class="muted tiny" style="margin-top:12px">카드를 누르면 상세 정보가 열립니다</div>`;
  asButton(r, () => openDetail(p));
}

/* ---------- 관리자 ---------- */
async function renderAdmin() {
  if (!isAdmin()) { go("rank-food"); return; }
  renderFixes();
  const tb = $("#userTable tbody"); tb.innerHTML = `<tr><td colspan="5" class="muted">불러오는 중…</td></tr>`;
  const { data: users, error } = await S.sb.from("profiles").select("*").order("created_at");
  if (error) { tb.innerHTML = `<tr><td colspan="5" class="err">${esc(error.message)}</td></tr>`; return; }
  const { data: favs } = await S.sb.from("favorites").select("user_id");
  const fc = new Map(); (favs || []).forEach(f => fc.set(f.user_id, (fc.get(f.user_id) || 0) + 1));
  const isAdm = (u) => u.username === C.ADMIN_ID, day = (u) => (u.created_at || "").slice(0, 10);
  const pending = users.filter(u => !u.approved && !u.banned && !u.rejected && !isAdm(u));
  const rejected = users.filter(u => u.rejected && !isAdm(u));
  $("#pendingWrap").classList.toggle("hidden", !pending.length);
  $("#pendingTable tbody").innerHTML = pending.map(u => `<tr><td><b>${esc(u.username)}</b></td><td>${day(u)}</td>
    <td><button class="btn small primary" data-act="approve" data-id="${u.id}">승인</button> <button class="btn small" data-act="reject" data-id="${u.id}">거절</button></td></tr>`).join("");
  $("#rejectedWrap").classList.toggle("hidden", !rejected.length);
  $("#rejectedTable tbody").innerHTML = rejected.map(u => `<tr><td><b>${esc(u.username)}</b></td><td>${day(u)}</td>
    <td><button class="btn small" data-act="approve" data-id="${u.id}">승인</button></td></tr>`).join("");
  tb.innerHTML = users.filter(u => (u.approved || u.banned || isAdm(u)) && !u.rejected).map(u => `<tr><td><b>${esc(u.username)}</b></td><td>${day(u)}</td><td>${fc.get(u.id) || 0}</td>
    <td>${u.banned ? '<span style="color:var(--red)">탈퇴</span>' : isAdm(u) ? "관리자" : "정상"}</td>
    <td>${isAdm(u) ? "" : u.banned ? `<button class="btn small" data-act="unban" data-id="${u.id}">복구</button>` : `<button class="btn small" data-act="ban" data-id="${u.id}">강제탈퇴</button>`}</td></tr>`).join("");
  const upd = async (id, v, msg) => { const { error } = await S.sb.from("profiles").update(v).eq("id", id); toast(error ? "실패: " + error.message : msg); renderAdmin(); };
  $$("#view-admin [data-act]").forEach(b => b.onclick = async () => {
    const id = b.dataset.id;
    if (b.dataset.act === "approve") upd(id, { approved: true, rejected: false }, "승인되었습니다.");
    if (b.dataset.act === "reject") { if (confirm("이 가입 신청을 거절할까요?")) upd(id, { rejected: true, approved: false }, "거절했습니다."); }
    if (b.dataset.act === "unban") upd(id, { banned: false }, "복구했습니다.");
    if (b.dataset.act === "ban") {
      if (!confirm("이 회원을 탈퇴 처리할까요? 즐겨찾기가 삭제됩니다.")) return;
      await S.sb.from("favorites").delete().eq("user_id", id); upd(id, { banned: true }, "처리되었습니다.");
    }
  });
}

/* ---------- 관리자: 식당 위치 점검 ---------- */
function kakaoCat(c, group) {
  const sub = (c || "").split(" > ")[1] || "";
  if (group === "CE7" || sub === "카페" || sub === "간식") return { cat: "카페", sub: sub || "카페" };
  const map = { 한식: "한식", 샤브샤브: "한식", 일식: "일식", 중식: "중식", 아시아음식: "아시아음식", 패스트푸드: "패스트푸드", 양식: "양식", 샐러드: "양식", 패밀리레스토랑: "양식" };
  return { cat: map[sub] || "기타", sub };
}
async function geoScan() {
  if (!S.kakaoReady || !kakao.maps.services) { toast("카카오맵이 아직 준비되지 않았습니다."); return; }
  const fixed = new Set(S.fixes.map(f => f.place_id));
  const targets = S.data.places.filter(p => !p.hidden && !fixed.has(p.id) && p.dist > 30000).sort((a, b) => b.n - a.n);
  const ps = new kakao.maps.services.Places(), loc = new kakao.maps.LatLng(...S.data.meta.kriss);
  const search = (q) => new Promise(r => ps.keywordSearch(q, (d, s) => r(s === kakao.maps.services.Status.OK ? d : []), { location: loc, radius: 20000 }));
  const btn = $("#geoScan"), msg = $("#geoMsg"), found = []; btn.disabled = true;
  for (let i = 0; i < targets.length; i++) {
    const p = targets[i]; msg.textContent = ` ${i + 1} / ${targets.length} 확인 중…`;
    for (const o of p.orig) {
      const q = o.normalize("NFKC").replace(/\(주\)|주식회사|유한회사|㈜/g, "").replace(/[()（）]/g, " ").trim();
      const no = norm(o.replace(/\(.*?\)|（.*?）/g, "")); if (no.length < 2) continue;
      const hit = (await search(q)).find(x => (x.category_group_code === "FD6" || x.category_group_code === "CE7") && (norm(x.place_name).includes(no) || no.includes(norm(x.place_name))));
      if (hit) { found.push({ p, o, hit }); break; }
      await new Promise(r => setTimeout(r, 80));
    }
  }
  btn.disabled = false; msg.textContent = ` 후보 ${found.length}곳`;
  $("#geoTable thead").innerHTML = found.length ? `<tr><th>회의비 상호 (방문)</th><th>지금 연결된 업체</th><th>대전 근처 후보</th><th></th></tr>` : "";
  $("#geoTable tbody").innerHTML = found.map((f, i) => `<tr><td><b>${esc(f.o)}</b> (${f.p.n}회)</td><td>${esc(f.p.name)}<br><span class="muted">${esc(f.p.addr)}</span></td>
    <td>${esc(f.hit.place_name)}<br><span class="muted">${esc(f.hit.road_address_name || f.hit.address_name)} · ${fmtDist(+f.hit.distance)}</span></td>
    <td><button class="btn small primary" data-geo="${i}">적용</button></td></tr>`).join("") +
    (found.length ? `<tr><td colspan="4"><button class="btn small" id="geoAll">모두 적용</button></td></tr>` : "");
  const apply = async (f) => {
    const addr = f.hit.road_address_name || f.hit.address_name, k = kakaoCat(f.hit.category_name, f.hit.category_group_code);
    const same = S.data.places.find(x => x !== f.p && !x.hidden && norm(x.name) === norm(f.hit.place_name) && x.addr === addr);
    const row = { place_id: f.p.id, name: f.hit.place_name, addr, lat: +f.hit.y, lng: +f.hit.x, cat: k.cat, sub: k.sub, merge_into: same ? same.id : null, note: f.o };
    const { error } = await S.sb.from("place_fixes").upsert(row);
    if (error) { toast("저장하지 못했습니다: " + error.message); return false; }
    return true;
  };
  $$("[data-geo]").forEach(b => b.onclick = async () => { b.disabled = true; if (await apply(found[+b.dataset.geo])) { b.textContent = "적용됨"; toast("적용했습니다. 새로고침하면 반영됩니다."); } else b.disabled = false; });
  const all = $("#geoAll"); if (all) all.onclick = async () => { all.disabled = true; let n = 0; for (const f of found) if (await apply(f)) n++; toast(`${n}곳을 적용했습니다. 새로고침하면 반영됩니다.`); };
}
function renderFixes() {
  const tb = $("#fixTable tbody");
  tb.innerHTML = S.fixes.length ? S.fixes.map(f => { const p = S.byId.get(f.place_id), o = (p && p.orig0) || {};
    return `<tr><td>${esc(f.note || "")}<br><span class="muted">${esc(o.name || "")} · ${esc(o.addr || "")}</span></td><td>${esc(f.name)}<br><span class="muted">${esc(f.addr)}${f.merge_into ? " · 기존 업체와 합침" : ""}</span></td>
      <td><button class="btn small" data-unfix="${f.place_id}">되돌리기</button></td></tr>`; }).join("") : `<tr><td colspan="3" class="muted">아직 없습니다.</td></tr>`;
  $$("[data-unfix]").forEach(b => b.onclick = async () => {
    const { error } = await S.sb.from("place_fixes").delete().eq("place_id", +b.dataset.unfix);
    toast(error ? "실패: " + error.message : "되돌렸습니다. 새로고침하면 반영됩니다."); if (!error) b.closest("tr").remove();
  });
}

init();
})();
