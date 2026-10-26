// imsi magazine CMS — 로그인(Supabase Auth) 후 기사 상태(초안·예약·발행·보류) 관리.
// 쓰기 권한은 DB(편집자 표 + RLS)가 막는다. 이 파일에는 공개(anon) 키만 쓴다.
(function () {
  "use strict";

  const cfg = window.IMSI_CONFIG || {};
  const $main = document.getElementById("cms");
  const $user = document.getElementById("user");

  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase) {
    $main.innerHTML = `<p class="error">Supabase 연결 정보가 없어요 (config.js).</p>`;
    return;
  }

  const db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const LIST_COLS = "id, external_id, title, status, published_at, display_name, updated_at, thumbnail_url";
  const STATE_LABEL = { scheduled: "예약", draft: "초안", pending: "보류", published: "발행" };
  // 시간대 캘린더: 08:00~23:30, 정각·30분 (allkpop 발행창과 같게)
  const SLOT_START = 8 * 60, SLOT_END = 23 * 60 + 30, SLOT_STEP = 30;
  const KST = 9 * 3600 * 1000;

  let me = null;

  // ── utils ──
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const stateOf = (a, now = Date.now()) => (a.status === "published" && Date.parse(a.published_at) > now ? "scheduled" : a.status);
  const pad = (n) => String(n).padStart(2, "0");

  // UTC ISO ↔ 한국 시간 (서머타임 없음)
  function kstParts(iso) {
    const d = new Date(Date.parse(iso) + KST);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
  }
  const fmtKst = (iso) => { const p = kstParts(iso); return `${pad(p.m)}/${pad(p.d)} ${pad(p.hh)}:${pad(p.mm)}`; };
  const toLocalInput = (iso) => { const p = kstParts(iso); return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.hh)}:${pad(p.mm)}`; };
  function fromLocalInput(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v || "");
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - KST).toISOString();
  }
  function kstDayStartUtc(offsetDays) {
    const p = kstParts(new Date().toISOString());
    return Date.UTC(p.y, p.m - 1, p.d + offsetDays) - KST;
  }

  function flash(msg, isError) {
    const el = document.getElementById("flash");
    if (el) { el.textContent = msg; el.className = isError ? "error" : "notice"; el.hidden = !msg; }
  }

  // ── auth ──
  async function boot() {
    const { data } = await db.auth.getSession();
    me = data.session ? data.session.user : null;
    db.auth.onAuthStateChange((_e, session) => { me = session ? session.user : null; render(); });
    window.addEventListener("hashchange", render);
    render();
  }

  function viewLogin() {
    $user.innerHTML = "";
    $main.innerHTML = `
      <h1>로그인</h1>
      <form class="login" id="login">
        <label class="field">이메일<input type="email" id="email" autocomplete="username" required></label>
        <label class="field">비밀번호<input type="password" id="password" autocomplete="current-password" required></label>
        <button class="btn primary" type="submit">로그인</button>
        <p id="flash" hidden></p>
      </form>`;
    document.getElementById("login").addEventListener("submit", async (e) => {
      e.preventDefault();
      const { error } = await db.auth.signInWithPassword({
        email: document.getElementById("email").value.trim(),
        password: document.getElementById("password").value,
      });
      if (error) flash("로그인하지 못했어요: " + error.message, true);
    });
  }

  async function editorName() {
    const { data, error } = await db.from("editors").select("display_name").eq("user_id", me.id).maybeSingle();
    if (error || !data) return null;
    return data.display_name || me.email;
  }

  // ── router ──
  async function render() {
    if (!me) return viewLogin();

    const name = await editorName();
    $user.innerHTML = `<span>${esc(name || me.email)}</span><button class="btn ghost" id="logout" type="button">로그아웃</button>`;
    document.getElementById("logout").onclick = () => db.auth.signOut();

    if (!name) {
      $main.innerHTML = `<p class="error">편집자로 등록되지 않은 계정이에요. editors 표에 등록해 주세요.</p>`;
      return;
    }

    const hash = location.hash.replace(/^#/, "") || "/";
    const m = /^\/edit\/([\w-]+)$/.exec(hash);
    if (m) return viewEdit(m[1]);
    const tab = (/^\/list\/(\w+)$/.exec(hash) || [])[1] || "scheduled";
    return viewList(tab);
  }

  // ── list + slots ──
  async function fetchArticles() {
    const since = new Date(Date.now() - 3 * 86400_000).toISOString();
    const [recent, waiting] = await Promise.all([
      db.from("articles").select(LIST_COLS).eq("status", "published").gte("published_at", since).order("published_at", { ascending: false }).limit(300),
      db.from("articles").select(LIST_COLS).in("status", ["draft", "pending"]).order("updated_at", { ascending: false }).limit(200),
    ]);
    if (recent.error) throw recent.error;
    if (waiting.error) throw waiting.error;
    return [...recent.data, ...waiting.data];
  }

  function slotBoard(articles, pickable) {
    const now = Date.now();
    const taken = new Map();
    articles.filter((a) => a.status === "published").forEach((a) => {
      const t = Math.floor(Date.parse(a.published_at) / 60000) * 60000;
      taken.set(t, a);
    });

    return [0, 1].map((offset) => {
      const day = kstDayStartUtc(offset);
      const p = kstParts(new Date(day).toISOString());
      let cells = "";
      for (let min = SLOT_START; min <= SLOT_END; min += SLOT_STEP) {
        const t = day + min * 60000;
        const a = taken.get(t);
        const label = `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
        const past = t <= now;
        if (a) cells += `<a class="slot taken" href="#/edit/${esc(a.id)}" title="${esc(a.title)}">${label}</a>`;
        else if (pickable && !past) cells += `<button type="button" class="slot free" data-slot="${new Date(t).toISOString()}">${label}</button>`;
        else cells += `<span class="slot${past ? " past" : ""}">${label}</span>`;
      }
      const filled = [...taken.keys()].filter((t) => t >= day + SLOT_START * 60000 && t <= day + SLOT_END * 60000).length;
      const total = (SLOT_END - SLOT_START) / SLOT_STEP + 1;
      return `<div class="slot-day"><h2>${offset === 0 ? "오늘" : "내일"} ${pad(p.m)}/${pad(p.d)} <span class="muted">${filled}/${total} 슬롯</span></h2><div class="slot-grid">${cells}</div></div>`;
    }).join("");
  }

  async function viewList(tab) {
    $main.innerHTML = `<p class="muted">불러오는 중…</p>`;
    let articles;
    try { articles = await fetchArticles(); } catch (e) { $main.innerHTML = `<p class="error">불러오지 못했어요: ${esc(e.message)}</p>`; return; }

    const now = Date.now();
    const groups = { scheduled: [], draft: [], pending: [], published: [] };
    articles.forEach((a) => groups[stateOf(a, now)].push(a));
    groups.scheduled.sort((x, y) => Date.parse(x.published_at) - Date.parse(y.published_at));

    const tabs = Object.keys(groups).map((k) =>
      `<a href="#/list/${k}"${k === tab ? ' aria-current="page"' : ""}>${STATE_LABEL[k]} ${groups[k].length}</a>`).join("");

    const items = (groups[tab] || []).map((a) => {
      const st = stateOf(a, now);
      const when = st === "scheduled" || st === "published" ? fmtKst(a.published_at) : "수정 " + fmtKst(a.updated_at);
      return `<li><a href="#/edit/${esc(a.id)}">
        <span class="pill ${st}">${STATE_LABEL[st]}</span>
        <span class="title">${esc(a.title)}</span>
        <span class="meta">${esc(when)}${a.display_name ? " · " + esc(a.display_name) : ""}</span>
      </a></li>`;
    }).join("");

    $main.innerHTML = `
      <h1>기사</h1>
      <section class="slots">${slotBoard(articles, false)}</section>
      <nav class="tabs">${tabs}</nav>
      ${items ? `<ul class="list">${items}</ul>` : `<p class="muted">이 상태의 기사가 없어요.</p>`}
      <p class="muted">발행 탭은 최근 3일만 보여요. 시간은 한국 시간이에요.</p>`;
  }

  // ── edit ──
  async function viewEdit(id) {
    $main.innerHTML = `<p class="muted">불러오는 중…</p>`;
    const [{ data: a, error }, list] = await Promise.all([
      db.from("articles").select("*").eq("id", id).maybeSingle(),
      fetchArticles().catch(() => []),
    ]);
    if (error || !a) { $main.innerHTML = `<p class="error">기사를 찾지 못했어요.</p><a href="#/">← 목록</a>`; return; }

    const st = stateOf(a);
    $main.innerHTML = `
      <a href="#/list/${st}">← 목록</a>
      <div><span class="pill ${st}">${STATE_LABEL[st]}</span>
        <span class="muted">${st === "scheduled" || st === "published" ? fmtKst(a.published_at) + " 발행" : ""} · 보낸 쪽 번호 ${esc(a.external_id)}</span></div>
      <p id="flash" hidden></p>
      <form class="edit" id="edit">
        <label class="field">제목<input id="f-title" value="${esc(a.title)}" required></label>
        <label class="field">요약<textarea id="f-summary" rows="2">${esc(a.summary)}</textarea></label>
        <div class="two">
          <label class="field">기자명<input id="f-byline" value="${esc(a.display_name)}"></label>
          <label class="field">대표 이미지 주소<input id="f-thumb" value="${esc(a.thumbnail_url)}"></label>
        </div>
        <label class="field">태그 (쉼표로 구분)<input id="f-tags" value="${esc((a.tags || []).join(", "))}"></label>
        <label class="field">본문 HTML<textarea id="f-body" rows="12">${esc(a.body_html)}</textarea></label>
        <iframe class="preview" id="preview" sandbox="" title="본문 미리보기"></iframe>
        <label class="field">편집 메모 (사이트에 안 보임)<textarea id="f-note" rows="2">${esc(a.editor_note)}</textarea></label>

        <label class="field">발행 시각 (한국 시간)<input type="datetime-local" id="f-when" value="${esc(toLocalInput(a.published_at))}"></label>
        <section class="slots">${slotBoard(list, true)}</section>
        <p class="muted">빈 슬롯을 누르면 발행 시각에 들어가요.</p>

        <div class="actions">
          <button class="btn" type="button" data-act="save">저장</button>
          <button class="btn primary" type="button" data-act="schedule">이 시각에 예약</button>
          <button class="btn" type="button" data-act="now">지금 발행</button>
          <button class="btn ghost" type="button" data-act="draft">초안으로</button>
          <button class="btn ghost" type="button" data-act="pending">보류</button>
        </div>
      </form>`;

    const $body = document.getElementById("f-body");
    const $preview = document.getElementById("preview");
    const refresh = () => { $preview.srcdoc = $body.value; };
    $body.addEventListener("input", refresh);
    refresh();

    $main.querySelectorAll("button[data-slot]").forEach((b) =>
      b.addEventListener("click", () => { document.getElementById("f-when").value = toLocalInput(b.dataset.slot); }));

    $main.querySelectorAll("button[data-act]").forEach((b) =>
      b.addEventListener("click", () => save(a, b.dataset.act)));
  }

  async function save(a, act) {
    const val = (id) => document.getElementById(id).value;
    const fields = {
      title: val("f-title").trim(),
      summary: val("f-summary").trim() || null,
      display_name: val("f-byline").trim() || null,
      thumbnail_url: val("f-thumb").trim() || null,
      tags: val("f-tags").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20),
      body_html: val("f-body"),
      editor_note: val("f-note").trim() || null,
      updated_by: me.id,
    };
    if (!fields.title || !fields.body_html.trim()) return flash("제목과 본문은 비울 수 없어요.", true);

    const when = fromLocalInput(val("f-when"));
    if (act === "schedule") {
      if (!when) return flash("발행 시각을 정해 주세요.", true);
      if (Date.parse(when) <= Date.now()) return flash("예약은 지금보다 뒤 시각이어야 해요. 바로 내보내려면 '지금 발행'을 눌러 주세요.", true);
      Object.assign(fields, { status: "published", published_at: when });
    } else if (act === "now") {
      Object.assign(fields, { status: "published", published_at: new Date().toISOString() });
    } else if (act === "draft" || act === "pending") {
      fields.status = act;
      if (when) fields.published_at = when;
    } else if (when) {
      fields.published_at = when;
    }

    const { error } = await db.from("articles").update(fields).eq("id", a.id);
    if (error) return flash("저장하지 못했어요: " + error.message, true);

    const msg = { save: "저장했어요.", schedule: `예약했어요 (${fmtKst(fields.published_at)}).`, now: "발행했어요.", draft: "초안으로 돌렸어요.", pending: "보류했어요." }[act];
    await viewEdit(a.id);
    flash(msg);
  }

  boot();
})();
