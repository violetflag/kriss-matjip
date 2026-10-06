/* KRISS 맛집로드 - app.js */
(() => {
const C = window.APP_CONFIG;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const FOOD_CATS = ["전체", "한식", "양식", "중식", "일식", "아시아음식", "패스트푸드", "기타"];
const RANDOM_CATS = ["한식", "양식", "중식", "일식", "아시아음식", "패스트푸드", "기타", "카페"];

const S = {            // 앱 상태
  data: null, places: [], byId: new Map(),
  sb: null, user: null, profile: null, favs: new Set(),
  view: "rank-food", cat: "전체", q: "", shown: 60,
  map: null, overlays: [], mapKind: "food", miniMap: null, miniMarker: null,
  smap: null, soverlays: [], searchMode: "place", searchQ: "", searchList: [], searchCount: null,
  groups: [], people: [], visits: null, visitsLoading: false,
  detail: null, lastRandom: null, kakaoReady: false,
};

/* ---------- 유틸 ---------- */
const sha256 = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, "0")).join("");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDist = (m) => m < 1000 ? `${m}m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)}km`;
const toast = (msg) => { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2200); };
const emailOf = (id) => `${id.toLowerCase()}@${C.EMAIL_DOMAIN}`;
const isAdmin = () => S.profile && S.profile.username === C.ADMIN_ID;
const canSee = () => !!(S.profile && (S.profile.approved || isAdmin()) && !S.profile.banned);
const hav = (a, b) => { const R = 6371000, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2; return Math.round(2 * R * Math.asin(Math.sqrt(h))); };
const countBy = (arr) => { const m = new Map(); for (const k of arr) m.set(k, (m.get(k) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]); };

/* ---------- 초기화 ---------- */
async function init() {
  try { S.sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON); } catch (e) { console.warn("supabase init 실패", e); }
  const res = await fetch("data.json?v=" + (window.APP_VER || "1")); S.data = await res.json();
  S.places = S.data.places; S.places.forEach(p => S.byId.set(p.id, p));
  S.places.forEach(p => p.visits = []);
  $("#dataInfo").textContent = `데이터 ${S.data.meta.from} ~ ${S.data.meta.to} · 업체 ${S.data.meta.places.toLocaleString()} · 방문 ${S.data.meta.visits.toLocaleString()}건`;
  bindGate(); bindAuth(); bindApp();
  if (sessionStorage.getItem("gate") === "1") { $("#gate").classList.add("hidden"); await afterGate(); }
}

/* ---------- 접속 게이트 ---------- */
async function gateHash() {
  try {
    if (!S.sb) throw 0;
    const { data, error } = await S.sb.from("settings").select("value").eq("key", "gate_hash").maybeSingle();
    if (!error && data && data.value) return data.value;
  } catch (e) {}
  return C.DEFAULT_GATE_HASH;
}
function bindGate() {
  $("#gateForm").addEventListener("submit", async (e) => {
    e.preventDefault(); $("#gateErr").textContent = "";
    const h = await sha256($("#gatePw").value);
    if (h === await gateHash()) { sessionStorage.setItem("gate", "1"); $("#gate").classList.add("hidden"); await afterGate(); }
    else $("#gateErr").textContent = "비밀번호가 맞지 않습니다.";
  });
}
async function afterGate() {
  let session = null;
  try { session = (await S.sb.auth.getSession()).data.session; } catch (e) {}
  if (session) { await onLogin(session.user); showApp(); } else $("#auth").classList.remove("hidden");
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
    const ok = await onLogin(data.user);
    if (!ok) { err.textContent = "탈퇴 처리된 계정입니다. 관리자에게 문의하세요."; return; }
    showApp();
  });
  $("#signupForm").addEventListener("submit", async (e) => {
    e.preventDefault(); const err = $("#signupErr"); err.textContent = "";
    const id = $("#signupId").value.trim(), pw = $("#signupPw").value;
    const { data, error } = await S.sb.auth.signUp({ email: emailOf(id), password: pw, options: { data: { username: id.toLowerCase() } } });
    if (error) { err.textContent = /already|registered/i.test(error.message) ? "이미 사용 중인 아이디입니다." : "가입 실패: " + error.message; return; }
    if (!data.session) { err.textContent = "가입은 됐지만 로그인되지 않았습니다. Supabase에서 이메일 확인 설정을 꺼 주세요."; return; }
    await S.sb.from("profiles").upsert({ id: data.user.id, username: id.toLowerCase() }).then(() => {}, () => {});
    await onLogin(data.user); showApp();
    toast(canSee() ? "가입을 환영합니다!" : "가입 신청이 접수됐습니다. 관리자 승인 후 전체 기능을 쓸 수 있습니다.");
  });
  $("#guestBtn").addEventListener("click", () => { S.user = null; S.profile = null; S.favs = new Set(); showApp(); });
}
async function onLogin(user) {
  S.user = user; S.favs = new Set();
  const { data: prof } = await S.sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
  S.profile = prof || { id: user.id, username: user.user_metadata?.username || user.email.split("@")[0] };
  if (!prof) await S.sb.from("profiles").upsert({ id: user.id, username: S.profile.username });
  if (S.profile.banned) { await S.sb.auth.signOut(); S.user = null; S.profile = null; return false; }
  if (canSee()) {
    const { data: favs } = await S.sb.from("favorites").select("place_id").eq("user_id", user.id);
    (favs || []).forEach(f => S.favs.add(f.place_id));
    loadVisits();
  }
  return true;
}
async function logout() { try { await S.sb.auth.signOut(); } catch (e) {} S.user = null; S.profile = null; S.favs = new Set(); clearVisits(); $("#app").classList.add("hidden"); $("#auth").classList.remove("hidden"); }

/* ---------- 비공개 방문 기록 (승인 회원만) ---------- */
function clearVisits() { S.visits = null; S.groups = []; S.people = []; S.places.forEach(p => p.visits = []); }
async function loadVisits() {
  if (S.visits || S.visitsLoading || !S.sb) return; S.visitsLoading = true;
  const all = []; let from = 0;
  try {
    while (true) {
      const { data, error } = await S.sb.from("visits").select("place_id,d,grp,people").order("id").range(from, from + 999);
      if (error) { toast("방문 기록을 불러오지 못했습니다: " + error.message); break; }
      all.push(...data); if (data.length < 1000) break; from += 1000;
    }
  } finally { S.visitsLoading = false; }
  S.visits = all; S.places.forEach(p => p.visits = []);
  for (const v of all) { const p = S.byId.get(v.place_id); if (p) p.visits.push({ d: v.d, g: v.grp || "", p: Array.isArray(v.people) ? v.people : [] }); }
  S.places.forEach(p => p.visits.sort((a, b) => (a.d < b.d ? 1 : -1)));
  const gs = new Map(), ps = new Map();
  for (const v of all) { if (v.grp) gs.set(v.grp, (gs.get(v.grp) || 0) + 1); for (const n of (v.people || [])) ps.set(n, (ps.get(n) || 0) + 1); }
  S.groups = [...gs.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]);
  S.people = [...ps.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]);
  if (S.view === "search") { setupSearchInput(); runSearch(); }
  if (S.detail) openDetail(S.detail);
}

/* ---------- 앱 뼈대 ---------- */
function showApp() {
  $("#auth").classList.add("hidden"); $("#app").classList.remove("hidden");
  const name = S.profile ? S.profile.username : "게스트";
  $("#userBtn").textContent = name;
  $("#sideUser").textContent = !S.profile ? "로그인하지 않음 · 식당별 방문 횟수만 표시" : canSee() ? `${name} 님` : `${name} 님 · 관리자 승인 대기 중`;
  $("#logoutBtn").textContent = S.profile ? "로그아웃" : "로그인";
  $$(".admin-only").forEach(el => el.classList.toggle("hidden", !isAdmin()));
  loadKakao(() => { S.kakaoReady = true; if (S.view.startsWith("map")) renderMap(); if (S.view === "search") renderSearchMap(); });
  go("rank-food");
}
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
    S.searchMode = b.dataset.mode; $$("#searchModes .chip").forEach(x => x.classList.toggle("active", x === b)); setupSearchInput(); runSearch(); });
  let st; $("#searchInput").addEventListener("input", (e) => { S.searchQ = e.target.value.trim(); clearTimeout(st); st = setTimeout(runSearch, 200); });
  $("#detailClose").onclick = closeDetail;
  $("#dHeart").onclick = () => S.detail && toggleFav(S.detail.id);
  $("#moreGroups").onclick = () => showMore("groups"); $("#morePeople").onclick = () => showMore("people");
  $("#recenterBtn").onclick = () => S.map && (S.map.setLevel(5), S.map.setCenter(new kakao.maps.LatLng(...S.data.meta.center)));
  $("#randomAgain").onclick = () => pickRandom(S.randomCat);
  $("#gatePwForm").addEventListener("submit", async (e) => {
    e.preventDefault(); const v = $("#newGatePw").value;
    const { error } = await S.sb.from("settings").upsert({ key: "gate_hash", value: await sha256(v) });
    $("#gatePwMsg").textContent = error ? "변경 실패: " + error.message : "변경되었습니다. 다음 접속부터 새 비밀번호가 적용됩니다.";
    if (!error) $("#newGatePw").value = "";
  });
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeDetail());
}
const TITLES = { "rank-food": "맛집랭킹", search: "검색", "map-food": "맛집지도", "rank-cafe": "카페랭킹", "map-cafe": "카페지도", fav: "즐겨찾기", random: "랜덤 맛집", admin: "관리자" };
function go(view) {
  S.view = view; closeDetail();
  $("#pageTitle").textContent = TITLES[view] || "KRISS 맛집로드";
  $$("#sidebar .menu button").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  const target = view.startsWith("rank") ? "rank" : view.startsWith("map") ? "map" : view;
  $$("#main .view").forEach(v => v.classList.toggle("active", v.id === "view-" + target));
  if (target === "rank") { S.cat = "전체"; S.q = ""; S.shown = 60; $("#searchBox").value = ""; $("#searchBox").placeholder = view === "rank-cafe" ? "카페 이름 검색" : "식당 이름 검색"; renderChips(); renderRank(); }
  if (target === "map") { S.mapKind = view.endsWith("cafe") ? "cafe" : "food"; renderMap(); }
  if (view === "search") { setupSearchInput(); runSearch(); }
  if (view === "fav") renderFav();
  if (view === "random") renderRandom();
  if (view === "admin") renderAdmin();
  $("#main").scrollTop = 0;
}

/* ---------- 랭킹 ---------- */
const pool = (kind) => S.places.filter(p => kind === "cafe" ? p.cat === "카페" : p.cat !== "카페");
function renderChips() {
  const el = $("#catChips"); const cafe = S.view === "rank-cafe";
  el.classList.toggle("hidden", cafe); if (cafe) return;
  el.innerHTML = FOOD_CATS.map(c => `<button class="chip ${c === S.cat ? "active" : ""}" data-cat="${c}">${c}</button>`).join("");
  $$(".chip", el).forEach(b => b.onclick = () => { S.cat = b.dataset.cat; S.shown = 60; renderChips(); renderRank(); });
}
function rankItem(p, rank, cnt, lbl) {
  const n = cnt ?? p.n, sub = cnt != null ? `<span>${lbl || "회"}</span><span class="tiny">전체 ${p.n}회</span>` : `<span>회 방문</span>`;
  return `<li class="rank-item" data-id="${p.id}">
    <div class="rank-no ${rank <= 3 ? "top" : ""}">${rank}</div>
    <div class="rank-main"><div class="rank-name">${esc(p.name)}</div>
      <div class="rank-meta"><span class="tag">${esc(p.sub || p.cat)}</span>${esc(p.addr)} · KRISS ${fmtDist(p.dist)}</div></div>
    <div class="rank-count"><b>${n}</b>${sub}</div>
    <button class="heart ${S.favs.has(p.id) ? "on" : ""}" data-fav="${p.id}" aria-label="즐겨찾기"></button></li>`;
}
function renderRank() {
  const kind = S.view === "rank-cafe" ? "cafe" : "food";
  let list = pool(kind);
  if (kind === "food" && S.cat !== "전체") list = list.filter(p => p.cat === S.cat);
  if (S.q) { const q = S.q.toLowerCase(); list = list.filter(p => p.name.toLowerCase().includes(q) || p.orig.some(o => o.toLowerCase().includes(q)) || p.addr.includes(S.q)); }
  const el = $("#rankList");
  el.innerHTML = list.slice(0, S.shown).map((p, i) => rankItem(p, i + 1)).join("") +
    (list.length > S.shown ? `<li><button class="btn" id="moreBtn">더 보기 (${list.length - S.shown}곳 남음)</button></li>` : "") +
    (list.length === 0 ? `<li class="muted pad">검색 결과가 없습니다.</li>` : "");
  bindList(el); const mb = $("#moreBtn"); if (mb) mb.onclick = () => { S.shown += 60; renderRank(); };
}
function bindList(el) {
  $$(".rank-item", el).forEach(li => li.onclick = (e) => { if (e.target.dataset.fav) return; openDetail(S.byId.get(+li.dataset.id)); });
  $$("[data-fav]", el).forEach(b => b.onclick = () => toggleFav(+b.dataset.fav));
}

/* ---------- 즐겨찾기 ---------- */
async function toggleFav(id) {
  if (!S.user) { toast("즐겨찾기는 로그인 후 사용할 수 있습니다."); return; }
  if (!canSee()) { toast("관리자 승인 후 즐겨찾기를 사용할 수 있습니다."); return; }
  const on = S.favs.has(id);
  if (on) { S.favs.delete(id); await S.sb.from("favorites").delete().match({ user_id: S.user.id, place_id: id }); }
  else { S.favs.add(id); const { error } = await S.sb.from("favorites").insert({ user_id: S.user.id, place_id: id }); if (error) { S.favs.delete(id); toast("저장 실패: " + error.message); } }
  $$(`[data-fav="${id}"]`).forEach(b => b.classList.toggle("on", S.favs.has(id)));
  if (S.detail && S.detail.id === id) $("#dHeart").classList.toggle("on", S.favs.has(id));
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

/* ---------- 상세 ---------- */
function openDetail(p) {
  S.detail = p; const d = $("#detail"); d.classList.remove("hidden"); d.setAttribute("aria-hidden", "false");
  $("#dName").textContent = p.name;
  $("#dSub").textContent = `${p.sub || p.cat} · ${p.addr} · KRISS에서 ${fmtDist(p.dist)}`;
  $("#dHeart").classList.toggle("on", S.favs.has(p.id));
  $("#lkKakao").href = `https://map.kakao.com/link/map/${encodeURIComponent(p.name)},${p.lat},${p.lng}`;
  $("#lkNaver").href = `https://map.naver.com/p/search/${encodeURIComponent(p.name + " " + p.addr.split(" ").slice(0, 2).join(" "))}`;
  $("#lkGoogle").href = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
  const priv = canSee() && S.visits, groups = countBy(p.visits.map(v => v.g)), people = countBy(p.visits.flatMap(v => v.p));
  $("#dCount").textContent = p.n; $("#dGroups").textContent = priv ? groups.length : "-"; $("#dLast").textContent = (p.last || "").slice(2).replace(/-/g, ".");
  const bars = (rows) => rows.slice(0, 5).map(([k, n]) => `<li><span>${esc(k)}</span><b>${n}회</b><div class="bar"><i style="width:${Math.round(n / rows[0][1] * 100)}%"></i></div></li>`).join("");
  $("#dPrivate").classList.toggle("hidden", !priv); $("#dLocked").classList.toggle("hidden", !!priv);
  $("#dLocked").textContent = !S.profile ? "방문 그룹·인원 정보는 로그인 후 볼 수 있습니다." : S.visits ? "" : canSee() ? "방문 기록을 불러오는 중…" : "관리자 승인 후 방문 그룹·인원 정보를 볼 수 있습니다.";
  if (priv) { $("#dTopGroups").innerHTML = bars(groups); $("#dTopPeople").innerHTML = bars(people); }
  $("#dMore").classList.add("hidden"); S.moreKind = null;
  if (p.cat !== "카페") {
    const cafes = S.places.filter(c => c.cat === "카페").map(c => [c, hav(p, c)]).sort((a, b) => a[1] - b[1]).slice(0, 3);
    $("#dCafes").innerHTML = `<h3>가까운 카페</h3><ul class="cafe-list">` + cafes.map(([c, d]) => `<li data-cafe="${c.id}"><span class="nm">${esc(c.name)}</span><span class="vn">${c.n}회</span><span class="ds">${fmtDist(d)}</span></li>`).join("") + `</ul>`;
    $$("[data-cafe]").forEach(li => li.onclick = () => openDetail(S.byId.get(+li.dataset.cafe)));
  } else $("#dCafes").innerHTML = "";
  $("#detail .detail-body").scrollTop = 0;
  if (S.kakaoReady) renderMiniMap(p);
}
function closeDetail() { $("#detail").classList.add("hidden"); S.detail = null; }
function showMore(kind) {
  const p = S.detail; if (!p) return;
  if (S.moreKind === kind) { $("#dMore").classList.add("hidden"); S.moreKind = null; return; }
  S.moreKind = kind;
  const byKey = new Map();
  for (const v of p.visits) for (const k of (kind === "groups" ? [v.g] : v.p)) { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(v.d); }
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
  const s = document.createElement("script");
  s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${C.KAKAO_JS_KEY}&autoload=false`;
  s.onload = () => kakao.maps.load(cb); s.onerror = () => toast("카카오맵을 불러오지 못했습니다. 도메인 등록을 확인하세요.");
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
  S.overlays = drawOn(S.map, pool(S.mapKind), p => p.n, $("#mapLegend"));
}
function drawOn(map, list, cnt, legend) {
  const out = [], level = map.getLevel(), b = map.getBounds();
  const sw = b.getSouthWest(), ne = b.getNorthEast();
  const pad = (ne.getLat() - sw.getLat()) * 0.15, padL = (ne.getLng() - sw.getLng()) * 0.15;
  const inView = list.filter(p => p.lat > sw.getLat() - pad && p.lat < ne.getLat() + pad && p.lng > sw.getLng() - padL && p.lng < ne.getLng() + padL);
  const pinLevel = inView.length <= 40 ? 6 : 4;
  if (level <= pinLevel) {     // 확대: 식당 이름 핀
    inView.sort((a, b) => cnt(b) - cnt(a)).slice(0, 400).forEach(p => {
      const div = document.createElement("div"); div.className = `pin ${p.cat === "카페" ? "cafe" : ""}`;
      div.innerHTML = `<span class="lbl">${esc(p.name)}<b>${cnt(p)}</b></span><span class="tip"></span>`;
      div.onclick = () => openDetail(p);
      const ov = new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(p.lat, p.lng), content: div, zIndex: cnt(p) });
      ov.setMap(map); out.push(ov);
    });
    legend.textContent = `핀 ${Math.min(inView.length, 400)}곳 · 숫자는 방문 횟수`;
  } else {                      // 축소: 방문횟수 가중 밀도 클러스터
    const proj = map.getProjection(), cell = level >= 8 ? 90 : 70, buckets = new Map();
    for (const p of inView) {
      const pt = proj.containerPointFromCoords(new kakao.maps.LatLng(p.lat, p.lng));
      const k = `${Math.floor(pt.x / cell)}_${Math.floor(pt.y / cell)}`;
      const bk = buckets.get(k) || { n: 0, c: 0, lat: 0, lng: 0 }, w = cnt(p);
      bk.n += w; bk.c++; bk.lat += p.lat * w; bk.lng += p.lng * w; buckets.set(k, bk);
    }
    const max = Math.max(1, ...[...buckets.values()].map(x => x.n));
    for (const bk of buckets.values()) {
      const size = Math.round(28 + 52 * Math.sqrt(bk.n / max)), ratio = bk.n / max;
      const div = document.createElement("div"); div.className = `cluster ${ratio > .6 ? "hot" : ratio > .3 ? "warm" : ratio > .12 ? "cool" : ""}`;
      div.style.cssText = `width:${size}px;height:${size}px;font-size:${size > 50 ? 14 : 12}px`; div.textContent = bk.n;
      div.title = `${bk.c}곳 · ${bk.n}회 방문`;
      const pos = new kakao.maps.LatLng(bk.lat / bk.n, bk.lng / bk.n);
      div.onclick = () => { map.setLevel(Math.max(1, level - 2), { anchor: pos }); map.setCenter(pos); };
      const ov = new kakao.maps.CustomOverlay({ position: pos, content: div, zIndex: bk.n });
      ov.setMap(map); out.push(ov);
    }
    legend.innerHTML = `원의 숫자 = 방문 횟수 합 · <span style="color:#ff8a8a">●</span> 많음 <span style="color:#ffc47a">●</span> 보통 <span style="color:#9ecbf5">●</span> 적음 <span style="color:#c9ccd3">●</span> 드묾 · 확대하면 이름이 보입니다`;
  }
  return out;
}

/* ---------- 검색 ---------- */
function setupSearchInput() {
  const inp = $("#searchInput"), dl = $("#searchList");
  if (S.searchMode !== "place" && !canSee()) S.searchMode = "place";
  $$("#searchModes .chip").forEach(x => { x.classList.toggle("active", x.dataset.mode === S.searchMode); x.classList.toggle("locked", x.dataset.mode !== "place" && !canSee()); });
  inp.placeholder = { place: "식당·카페 이름 검색", group: "소속(그룹) 이름 검색", person: "사람 이름 검색" }[S.searchMode];
  dl.innerHTML = (S.searchMode === "group" ? S.groups : S.searchMode === "person" ? S.people.slice(0, 2000) : []).map(x => `<option value="${esc(x)}">`).join("");
  inp.value = S.searchQ;
}
function runSearch() {
  const q = S.searchQ, mode = S.searchMode, res = $("#searchResults"), hint = $("#searchHint"), box = $("#searchMapBox");
  res.innerHTML = ""; S.searchList = []; S.searchCount = null;
  if (!q) { hint.textContent = { place: "식당이나 카페 이름을 입력하세요.", group: "소속을 입력하면 그 소속이 자주 간 식당·카페 순서로 나옵니다.", person: "이름을 입력하면 그 사람이 자주 간 식당·카페 순서로 나옵니다." }[mode]; box.classList.add("hidden"); return; }
  if (mode === "place") {
    const ql = q.toLowerCase();
    const list = S.places.filter(p => p.name.toLowerCase().includes(ql) || p.orig.some(o => o.toLowerCase().includes(ql)));
    hint.innerHTML = list.length ? `<b>${list.length}</b>곳` : "검색 결과가 없습니다."; box.classList.add("hidden");
    res.innerHTML = list.slice(0, 100).map((p, i) => rankItem(p, i + 1)).join(""); bindList(res); return;
  }
  const exact = (mode === "group" ? S.groups : S.people).includes(q);
  const match = mode === "group" ? (v => exact ? v.g === q : v.g.includes(q)) : (v => exact ? v.p.includes(q) : v.p.some(n => n.includes(q)));
  const cnt = new Map();
  for (const p of S.places) { let c = 0; for (const v of p.visits) if (match(v)) c++; if (c) cnt.set(p.id, c); }
  const list = [...cnt.entries()].map(([id, c]) => S.byId.get(id)).sort((a, b) => cnt.get(b.id) - cnt.get(a.id));
  S.searchList = list; S.searchCount = cnt;
  const total = [...cnt.values()].reduce((a, b) => a + b, 0);
  if (!list.length) { hint.textContent = "검색 결과가 없습니다."; box.classList.add("hidden"); return; }
  hint.innerHTML = `<b>${esc(q)}</b>${exact ? "" : " (부분 일치)"} · 방문 <b>${total}</b>회 · 식당·카페 <b>${list.length}</b>곳`;
  box.classList.remove("hidden");
  res.innerHTML = list.slice(0, 150).map((p, i) => rankItem(p, i + 1, cnt.get(p.id), "회 방문")).join(""); bindList(res);
  renderSearchMap();
}
function renderSearchMap() {
  if (!S.kakaoReady || !S.searchList.length || S.view !== "search") return;
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
  S.soverlays = S.searchList.length ? drawOn(S.smap, S.searchList, p => S.searchCount.get(p.id), $("#searchLegend")) : [];
}

/* ---------- 랜덤 ---------- */
function renderRandom() {
  const el = $("#randomCats");
  el.innerHTML = RANDOM_CATS.map(c => `<button class="chip ${S.randomCat === c ? "active" : ""}" data-cat="${c}">${c}</button>`).join("");
  $$(".chip", el).forEach(b => b.onclick = () => { S.randomCat = b.dataset.cat; renderRandom(); pickRandom(b.dataset.cat); });
  if (!S.randomCat) { $("#randomResult").classList.add("hidden"); $("#randomAgain").classList.add("hidden"); }
}
function pickRandom(cat) {
  const top = S.places.filter(p => p.daejeon && p.cat === cat).slice(0, 30);
  if (!top.length) { toast("해당 분류에 대전 업체가 없습니다."); return; }
  let p; do { p = top[Math.floor(Math.random() * top.length)]; } while (top.length > 1 && p === S.lastRandom);
  S.lastRandom = p; const rank = top.indexOf(p) + 1;
  const r = $("#randomResult"); r.classList.remove("hidden"); $("#randomAgain").classList.remove("hidden");
  r.innerHTML = `<span class="rank-badge">대전 ${cat} ${rank}위</span><div class="big-name">${esc(p.name)}</div>
    <div class="muted">${esc(p.sub || p.cat)} · ${esc(p.addr)}</div><div class="muted small" style="margin-top:8px">${p.n}회 방문 · KRISS에서 ${fmtDist(p.dist)}</div>
    <div class="muted tiny" style="margin-top:12px">카드를 누르면 상세 정보가 열립니다</div>`;
  r.onclick = () => openDetail(p);
}

/* ---------- 관리자 ---------- */
async function renderAdmin() {
  if (!isAdmin()) { go("rank-food"); return; }
  const tb = $("#userTable tbody"); tb.innerHTML = `<tr><td colspan="5" class="muted">불러오는 중…</td></tr>`;
  const { data: users, error } = await S.sb.from("profiles").select("*").order("created_at");
  if (error) { tb.innerHTML = `<tr><td colspan="5" class="err">${esc(error.message)}</td></tr>`; return; }
  const { data: favs } = await S.sb.from("favorites").select("user_id");
  const fc = new Map(); (favs || []).forEach(f => fc.set(f.user_id, (fc.get(f.user_id) || 0) + 1));
  const pending = users.filter(u => !u.approved && !u.banned && u.username !== C.ADMIN_ID);
  $("#pendingWrap").classList.toggle("hidden", !pending.length);
  $("#pendingTable tbody").innerHTML = pending.map(u => `<tr><td><b>${esc(u.username)}</b></td><td>${(u.created_at || "").slice(0, 10)}</td>
    <td><button class="btn small primary" data-approve="${u.id}">승인</button> <button class="btn small" data-ban="${u.id}">거절</button></td></tr>`).join("");
  tb.innerHTML = users.filter(u => u.approved || u.banned || u.username === C.ADMIN_ID).map(u => `<tr><td><b>${esc(u.username)}</b></td><td>${(u.created_at || "").slice(0, 10)}</td><td>${fc.get(u.id) || 0}</td>
    <td>${u.banned ? '<span style="color:var(--red)">탈퇴</span>' : u.username === C.ADMIN_ID ? "관리자" : "정상"}</td>
    <td>${u.username === C.ADMIN_ID ? "" : u.banned ? `<button class="btn small" data-unban="${u.id}">복구</button>` : `<button class="btn small" data-ban="${u.id}">강제탈퇴</button>`}</td></tr>`).join("");
  $$("[data-approve]").forEach(b => b.onclick = async () => {
    const { error } = await S.sb.from("profiles").update({ approved: true }).eq("id", b.dataset.approve);
    toast(error ? "실패: " + error.message : "승인되었습니다."); renderAdmin();
  });
  $$("[data-ban]").forEach(b => b.onclick = async () => {
    if (!confirm("이 회원을 탈퇴 처리할까요? 즐겨찾기가 삭제됩니다.")) return;
    await S.sb.from("favorites").delete().eq("user_id", b.dataset.ban);
    const { error } = await S.sb.from("profiles").update({ banned: true }).eq("id", b.dataset.ban);
    toast(error ? "실패: " + error.message : "처리되었습니다."); renderAdmin();
  });
  $$("[data-unban]").forEach(b => b.onclick = async () => { await S.sb.from("profiles").update({ banned: false, approved: true }).eq("id", b.dataset.unban); renderAdmin(); });
}

init();
})();
