// imsi magazine CMS — 기사 목록 (첫 화면). 에디터는 자기 글만, 어드민은 모든 글.
(function () {
  "use strict";
  const CMS = window.CMS;
  if (!CMS || CMS.broken) return;
  const { esc } = CMS;
  const PAGE_SIZE = 20;
  const TABS = ["all", "draft", "scheduled", "published", "pending"];
  const COLS = "id, title, status, published_at, updated_at, origin, display_name, author_id, author:editors!articles_author_id_fkey(display_name, email)";

  // 상태 탭 조건 (예약·발행은 같은 status 를 발행 시각으로 나눈다)
  function applyState(q, tab, nowIso) {
    if (tab === "draft" || tab === "pending") return q.eq("status", tab);
    if (tab === "scheduled") return q.eq("status", "published").gt("published_at", nowIso);
    if (tab === "published") return q.eq("status", "published").lte("published_at", nowIso);
    return q;
  }

  function applyFilters(q, f) {
    if (!CMS.isAdmin()) q = q.eq("author_id", CMS.user.id);
    else if (f.author === "none") q = q.is("author_id", null);
    else if (f.author) q = q.eq("author_id", f.author);
    if (f.origin) q = q.eq("origin", f.origin);
    if (f.q) q = q.ilike("title", `%${f.q.replace(/[%_]/g, "")}%`);
    return q;
  }

  async function viewList() {
    CMS.loading();
    const qs = CMS.query();
    const f = {
      tab: TABS.includes(qs.get("state")) ? qs.get("state") : "all",
      q: (qs.get("q") || "").trim(),
      author: qs.get("author") || "",
      origin: qs.get("origin") || "",
      page: Math.max(1, Number(qs.get("page")) || 1),
    };
    const nowIso = new Date().toISOString();
    const db = CMS.db;

    const counts = await Promise.all(TABS.map(async (tab) => {
      const { count } = await applyFilters(applyState(db.from("articles").select("id", { count: "exact", head: true }), tab, nowIso), f);
      return [tab, count || 0];
    }));
    const countOf = Object.fromEntries(counts);

    let q = applyFilters(applyState(db.from("articles").select(COLS, { count: "exact" }), f.tab, nowIso), f);
    q = f.tab === "scheduled" ? q.order("published_at", { ascending: true }) : q.order("updated_at", { ascending: false });
    const from = (f.page - 1) * PAGE_SIZE;
    const { data: rows, count, error } = await q.range(from, from + PAGE_SIZE - 1);
    if (error) throw error;

    let authors = [];
    if (CMS.isAdmin()) {
      const { data } = await db.from("editors").select("user_id, display_name, email").order("display_name");
      authors = data || [];
    }

    const link = (patch) => {
      const p = new URLSearchParams({ state: f.tab, q: f.q, author: f.author, origin: f.origin, page: String(f.page), ...patch });
      [...p.keys()].forEach((k) => { if (!p.get(k) || (k === "state" && p.get(k) === "all") || (k === "page" && p.get(k) === "1")) p.delete(k); });
      const s = p.toString();
      return "#/" + (s ? "?" + s : "");
    };

    const tabLabel = (t) => (t === "all" ? "전체" : CMS.STATES[t].label);
    const tabs = TABS.map((t) =>
      `<a href="${link({ state: t, page: "1" })}"${t === f.tab ? ' aria-current="page"' : ""}>${tabLabel(t)} <b>${countOf[t]}</b></a>`).join("");
    const desc = f.tab === "all" ? (CMS.isAdmin() ? "모든 사람의 글과 외부 API로 들어온 글이에요." : "내가 쓴 글과 나에게 맡겨진 글이에요.") : CMS.STATES[f.tab].desc;

    const now = Date.now();
    const items = (rows || []).map((a) => {
      const st = CMS.stateOf(a, now);
      const when = st === "scheduled" ? `${CMS.fmtKst(a.published_at)} 예약`
        : st === "published" ? `${CMS.fmtKst(a.published_at)} 발행`
        : `${CMS.fmtKst(a.updated_at)} 수정`;
      const who = a.author ? (a.author.display_name || a.author.email) : "담당자 없음";
      return `<li><a href="#/edit/${esc(a.id)}">
        ${CMS.pill(st)}
        <span class="title">${esc(a.title)}</span>
        <span class="meta">${esc(when)} · ${esc(who)} · ${esc(CMS.ORIGINS[a.origin] || a.origin)}</span>
      </a></li>`;
    }).join("");

    const pages = Math.max(1, Math.ceil((count || 0) / PAGE_SIZE));
    const pager = pages > 1 ? `<nav class="pager">
      ${f.page > 1 ? `<a class="btn ghost sm" href="${link({ page: String(f.page - 1) })}">← 이전</a>` : ""}
      <span class="muted">${f.page} / ${pages} 쪽 · ${count}건</span>
      ${f.page < pages ? `<a class="btn ghost sm" href="${link({ page: String(f.page + 1) })}">다음 →</a>` : ""}
    </nav>` : `<p class="muted">${count || 0}건</p>`;

    const adminFilters = CMS.isAdmin() ? `
      <label class="field inline">담당자
        <select name="author">
          <option value="">전체</option>
          <option value="none"${f.author === "none" ? " selected" : ""}>담당자 없음 (외부 API 글)</option>
          ${authors.map((u) => `<option value="${esc(u.user_id)}"${f.author === u.user_id ? " selected" : ""}>${esc(u.display_name || u.email)}</option>`).join("")}
        </select></label>` : "";

    CMS.page("기사",
      CMS.isAdmin()
        ? "모든 글을 보고 관리해요. 글을 누르면 고치거나 발행할 수 있어요. 새 글은 [새 글 쓰기]로 써요."
        : "내 글을 보고 관리해요. 글을 누르면 고치거나 발행할 수 있어요. 새 글은 [새 글 쓰기]로 써요.",
      `<nav class="tabs">${tabs}</nav>
      <p class="state-desc">${esc(desc)}</p>
      <form class="filters" id="filters">
        <label class="field inline grow">제목 검색<input name="q" value="${esc(f.q)}" placeholder="제목 일부"></label>
        ${adminFilters}
        <label class="field inline">들어온 곳
          <select name="origin">
            <option value="">전체</option>
            <option value="cms"${f.origin === "cms" ? " selected" : ""}>직접 작성</option>
            <option value="api"${f.origin === "api" ? " selected" : ""}>외부 API</option>
          </select></label>
        <button class="btn sm" type="submit">찾기</button>
      </form>
      ${items ? `<ul class="list">${items}</ul>` : `<p class="empty-box">${emptyText(f)}</p>`}
      ${pager}`,
      `<a class="btn primary" href="#/new">새 글 쓰기</a>`);

    document.getElementById("filters").addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      CMS.go(link({ q: String(fd.get("q") || "").trim(), author: String(fd.get("author") || ""), origin: String(fd.get("origin") || ""), page: "1" }));
    });
  }

  function emptyText(f) {
    if (f.q || f.author || f.origin) return "조건에 맞는 글이 없어요. 검색어나 필터를 바꿔 보세요.";
    switch (f.tab) {
      case "draft": return "초안이 없어요. [새 글 쓰기]에서 '초안 저장'을 누르거나, 외부 API(Hydra 등)가 초안으로 보내면 여기에 쌓여요.";
      case "scheduled": return "예약된 글이 없어요. 글을 열어 발행 시각을 정하고 '예약'을 누르면 여기에 보여요.";
      case "published": return "발행된 글이 없어요.";
      case "pending": return "비공개 글이 없어요. 발행한 글을 내리면 여기로 와요.";
      default: return "아직 글이 없어요. 오른쪽 위 [새 글 쓰기]로 첫 글을 써 보세요.";
    }
  }

  CMS.route(/^\/$/, viewList);
})();
