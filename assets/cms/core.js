// imsi magazine CMS — 공통: 연결, 로그인 상태, 용어, 시간 변환, 화면 틀, 라우터.
// 권한은 DB(RLS)가 막는다. 화면은 역할에 맞게 버튼만 숨긴다. 이 파일에는 공개(anon) 키만 쓴다.
(function () {
  "use strict";

  const cfg = window.IMSI_CONFIG || {};
  const CMS = (window.CMS = { routes: [], cfg });
  const $main = document.getElementById("cms");

  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase) {
    $main.innerHTML = `<p class="error">Supabase 연결 정보가 없어요 (config.js).</p>`;
    CMS.broken = true;
    return;
  }

  CMS.db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  CMS.user = null;     // 로그인 계정 (Supabase Auth)
  CMS.profile = null;  // 편집자 표의 내 행 { user_id, email, display_name, role, active }

  // ── 용어 (화면·문서 공통. 이 다섯 개만 쓴다) ──
  CMS.STATES = {
    draft:     { label: "초안",   desc: "저장만 한 글이에요. 사이트에 안 보여요. 외부 API로 들어온 글도 기본은 여기에 쌓여요." },
    scheduled: { label: "예약",   desc: "발행 시각을 정해둔 글이에요. 그 시각이 되면 자동으로 사이트에 올라가요." },
    published: { label: "발행",   desc: "사이트에 올라가 있는 글이에요." },
    pending:   { label: "비공개", desc: "사이트에서 내린 글, 또는 내보내지 않기로 한 글이에요. 다시 발행할 수 있어요." },
  };
  CMS.ORIGINS = { cms: "직접 작성", api: "외부 API" };
  CMS.ROLES = { admin: "어드민", editor: "에디터" };
  CMS.isAdmin = () => !!(CMS.profile && CMS.profile.role === "admin");

  // ── utils ──
  const esc = (CMS.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));
  const pad = (CMS.pad = (n) => String(n).padStart(2, "0"));
  CMS.stateOf = (a, now = Date.now()) => (a.status === "published" && Date.parse(a.published_at) > now ? "scheduled" : a.status);
  CMS.pill = (st) => `<span class="pill ${st}">${esc(CMS.STATES[st] ? CMS.STATES[st].label : st)}</span>`;

  // 한국 시간 (서머타임 없음)
  const KST = 9 * 3600 * 1000;
  CMS.kstParts = (iso) => {
    const d = new Date(Date.parse(iso) + KST);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes(), wd: d.getUTCDay() };
  };
  CMS.fmtKst = (iso) => { if (!iso) return ""; const p = CMS.kstParts(iso); return `${p.y}.${pad(p.m)}.${pad(p.d)} ${pad(p.hh)}:${pad(p.mm)}`; };
  CMS.toLocalInput = (iso) => { if (!iso) return ""; const p = CMS.kstParts(iso); return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.hh)}:${pad(p.mm)}`; };
  CMS.fromLocalInput = (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v || "");
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - KST).toISOString() : null;
  };
  // 오늘(한국) 0시 기준 offset 일 뒤 0시의 UTC ms
  CMS.kstDayStart = (offsetDays) => { const p = CMS.kstParts(new Date().toISOString()); return Date.UTC(p.y, p.m - 1, p.d + offsetDays) - KST; };
  CMS.WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

  // 본문 정화 — 받는 함수와 같은 규칙 (스크립트·iframe·이벤트 속성·javascript: 링크 제거)
  CMS.sanitize = (html) => String(html || "")
    .replace(/<(script|style|iframe|object|embed|form)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|style|iframe|object|embed|form|link|meta)\b[^>]*\/?>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');

  CMS.siteUrl = () => new URL("./", location.href).href;
  CMS.articleUrl = (id) => `${CMS.siteUrl()}#/a/${id}`;

  // 알림 (화면 위쪽 고정 띠)
  let toastTimer = null;
  CMS.toast = (msg, isError) => {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.className = "toast " + (isError ? "error" : "ok");
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 8000 : 3500);
  };

  // 설정 (site_settings) — 화면 여러 곳에서 쓴다
  const DEFAULT_SETTINGS = {
    categories: [],
    slots: { start: "08:00", end: "23:30", step_minutes: 30 },
    featured_article_id: null,
    api: { default_owner_id: null },
  };
  CMS.settings = async (fresh) => {
    if (CMS._settings && !fresh) return CMS._settings;
    const { data } = await CMS.db.from("site_settings").select("key, value");
    const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    (data || []).forEach((r) => { s[r.key] = r.value; });
    return (CMS._settings = s);
  };
  CMS.saveSetting = async (key, value) => {
    const { error } = await CMS.db.from("site_settings").upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) throw error;
    CMS._settings = null;
  };
  const toMin = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + (m || 0); };
  CMS.slotMinutes = (slots) => {
    const out = [];
    const step = Math.max(5, Number(slots.step_minutes) || 30);
    for (let m = toMin(slots.start); m <= toMin(slots.end); m += step) out.push(m);
    return out;
  };

  // 계정 관리 함수 (admin-users) 부르기
  CMS.adminApi = async (action, body = {}) => {
    const { data } = await CMS.db.auth.getSession();
    const token = data.session && data.session.access_token;
    let res;
    try {
      res = await fetch(`${cfg.SUPABASE_URL.replace(/\/$/, "")}/functions/v1/admin-users`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}`, apikey: cfg.SUPABASE_ANON_KEY },
        body: JSON.stringify({ action, ...body }),
      });
    } catch (_) {
      throw new Error("계정 관리 함수(admin-users)에 연결하지 못했어요. 함수가 배포됐는지 확인해 주세요.");
    }
    if (res.status === 404) throw new Error("계정 관리 함수(admin-users)가 아직 배포되지 않았어요.");
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || out.message || `요청이 실패했어요 (${res.status}).`);
    return out;
  };

  // ── 화면 틀 ──
  // title: 화면 이름, intro: "이 화면에서 하는 일" 한 줄, body: 내용
  CMS.page = (title, intro, body, actions = "") => {
    $main.innerHTML = `
      <div class="page-head"><div><h1>${esc(title)}</h1><p class="intro">${intro}</p></div>${actions}</div>
      ${body}`;
  };
  CMS.loading = () => { $main.innerHTML = `<p class="muted">불러오는 중…</p>`; };
  CMS.fail = (e) => { $main.innerHTML = `<p class="error">${esc(e && e.message ? e.message : e)}</p>`; };
  CMS.go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };

  function renderNav() {
    const $nav = document.getElementById("nav");
    const $user = document.getElementById("user");
    if (!CMS.profile) { $nav.innerHTML = ""; $user.innerHTML = ""; return; }
    const items = [
      ["#/", "기사"], ["#/new", "새 글 쓰기"], ["#/schedule", "발행 일정"],
      ...(CMS.isAdmin() ? [["#/accounts", "계정 관리"], ["#/settings", "설정"], ["#/log", "작업 기록"]] : []),
      ["#/me", "내 정보"], ["#/help", "도움말"],
    ];
    const cur = location.hash || "#/";
    $nav.innerHTML = items.map(([h, l]) => {
      const on = h === "#/" ? cur === "#/" || cur === "" || cur.startsWith("#/?") || cur.startsWith("#/edit/") : cur.startsWith(h);
      return `<a href="${h}"${on ? ' aria-current="page"' : ""}>${l}</a>`;
    }).join("");
    $user.innerHTML = `<span>${esc(CMS.profile.display_name || CMS.profile.email)}</span>
      <span class="role ${CMS.profile.role}">${CMS.ROLES[CMS.profile.role] || ""}</span>
      <button class="btn ghost sm" id="logout" type="button">로그아웃</button>`;
    document.getElementById("logout").onclick = () => CMS.db.auth.signOut();
  }

  // ── 로그인 ──
  function viewLogin(message) {
    CMS.page("로그인", "imsi magazine CMS예요. 어드민이 만들어 준 계정으로 로그인하세요.", `
      <form class="login" id="login">
        <label class="field">이메일<input type="email" id="email" autocomplete="username" required></label>
        <label class="field">비밀번호<input type="password" id="password" autocomplete="current-password" required></label>
        <button class="btn primary" type="submit">로그인</button>
        ${message ? `<p class="error">${esc(message)}</p>` : ""}
        <p class="muted">계정이 없거나 비밀번호를 잊었으면 어드민에게 요청하세요. 어드민은 '계정 관리'에서 계정을 만들고 비밀번호를 초기화할 수 있어요.</p>
      </form>`);
    document.getElementById("login").addEventListener("submit", async (e) => {
      e.preventDefault();
      const { error } = await CMS.db.auth.signInWithPassword({
        email: document.getElementById("email").value.trim(),
        password: document.getElementById("password").value,
      });
      if (error) {
        const banned = /banned/i.test(error.message);
        viewLogin(banned ? "사용 중지된 계정이에요. 어드민에게 문의하세요." : "이메일 또는 비밀번호가 맞지 않아요.");
      }
    });
  }

  async function loadProfile() {
    const { data, error } = await CMS.db.from("editors")
      .select("user_id, email, display_name, role, active").eq("user_id", CMS.user.id).maybeSingle();
    if (error) {
      if (/role|active|email/.test(error.message)) throw new Error("DB 변경(003_roles_authoring.sql)이 아직 적용되지 않았어요. SQL을 먼저 실행해 주세요.");
      throw error;
    }
    return data;
  }

  // ── 라우터 ──
  // CMS.route(정규식, 처리함수, { admin: true })
  CMS.route = (re, fn, opts = {}) => CMS.routes.push({ re, fn, admin: !!opts.admin });
  CMS.query = () => new URLSearchParams((location.hash.split("?")[1] || ""));

  let profileFor = null;
  async function render() {
    if (!CMS.user) { CMS.profile = null; renderNav(); return viewLogin(); }
    if (profileFor !== CMS.user.id) {
      try { CMS.profile = await loadProfile(); } catch (e) { CMS.profile = null; renderNav(); return CMS.fail(e); }
      profileFor = CMS.user.id;
    }
    if (!CMS.profile) {
      renderNav();
      CMS.page("권한 없음", "", `<p class="error">이 계정은 CMS 편집자로 등록되어 있지 않아요. 어드민에게 등록을 요청하세요.</p>
        <button class="btn" id="out" type="button">로그아웃</button>`);
      document.getElementById("out").onclick = () => CMS.db.auth.signOut();
      return;
    }
    if (!CMS.profile.active) {
      renderNav();
      return CMS.page("사용 중지된 계정", "", `<p class="error">이 계정은 사용 중지됐어요. 어드민에게 문의하세요.</p>`);
    }
    renderNav();

    const path = (location.hash.replace(/^#/, "") || "/").split("?")[0];
    for (const r of CMS.routes) {
      const m = r.re.exec(path);
      if (!m) continue;
      if (r.admin && !CMS.isAdmin()) return CMS.page("권한 없음", "", `<p class="error">어드민만 볼 수 있는 화면이에요.</p>`);
      window.scrollTo(0, 0);
      try { return await r.fn(...m.slice(1)); } catch (e) { console.error(e); return CMS.fail(e); }
    }
    CMS.page("없는 화면", "", `<a href="#/">← 기사 목록</a>`);
  }
  CMS.render = render;

  CMS.start = async () => {
    const { data } = await CMS.db.auth.getSession();
    CMS.user = data.session ? data.session.user : null;
    CMS.db.auth.onAuthStateChange((evt, session) => {
      const next = session ? session.user : null;
      const changed = (next && next.id) !== (CMS.user && CMS.user.id);
      CMS.user = next;
      if (changed || evt === "SIGNED_OUT") { profileFor = null; render(); }
    });
    window.addEventListener("hashchange", render);
    render();
  };
})();
