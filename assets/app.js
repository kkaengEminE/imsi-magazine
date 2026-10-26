(() => {
  "use strict";

  // ── 카테고리(메뉴) — 태그로도 자동 분류. 서비스명 'imsi magazine' 은 번역하지 않음 ──
  const CATEGORIES = [
    { key: "new", ko: "새 소식", en: "New" },
    { key: "music", ko: "음악", en: "Music", match: ["music", "album", "single", "mv", "chart", "record", "release", "음악", "앨범", "신곡", "차트"] },
    { key: "live", ko: "공연·투어", en: "Live & Tour", match: ["live", "tour", "concert", "festival", "fes", "공연", "투어", "페스티벌", "내한"] },
    { key: "screen", ko: "영화·드라마", en: "Film & Drama", match: ["film", "movie", "drama", "cinema", "ott", "영화", "드라마"] },
    { key: "anime", ko: "애니·OST", en: "Anime & OST", match: ["anime", "ost", "tie-up", "theme song", "애니", "주제가"] },
    { key: "korea", ko: "한국 연결", en: "Korea", match: ["korea", "korean", "seoul", "한국", "서울", "k-pop", "kpop"] },
  ];

  const I18N = {
    ko: {
      menu: "메뉴", read: "기사 보기", all: "전체 기사", related: "관련 기사", tags: "태그", body: "본문",
      category: "카테고리", date: "날짜", source: "출처", language: "언어", original: "원문 보기",
      empty: "아직 기사가 없습니다.", notFound: "기사를 찾을 수 없습니다.", tag: "태그",
      count: (n) => `${n}개의 기사`, demo: "데모 모드 — 샘플 기사를 표시 중입니다",
      footer: "Hydra 뉴스룸 테스트용 임시 매거진입니다.", loading: "불러오는 중…", error: "기사를 불러오지 못했습니다.",
      langName: { ko: "한국어", en: "영어", ja: "일본어" },
    },
    en: {
      menu: "Menu", read: "Read story", all: "All stories", related: "Related", tags: "Tags", body: "Story",
      category: "Category", date: "Date", source: "Source", language: "Language", original: "Original article",
      empty: "No stories yet.", notFound: "Story not found.", tag: "Tag",
      count: (n) => `${n} ${n === 1 ? "story" : "stories"}`, demo: "Demo mode — showing sample stories",
      footer: "A temporary magazine for testing the Hydra newsroom.", loading: "Loading…", error: "Could not load stories.",
      langName: { ko: "Korean", en: "English", ja: "Japanese" },
    },
  };

  const cfg = window.IMSI_CONFIG || {};
  const DEMO = !(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);

  let lang = readLang();
  let articles = null; // 최신순
  const app = document.getElementById("app");
  const header = document.getElementById("header");

  // ── utils ──
  function readLang() {
    try { const v = localStorage.getItem("imsi-lang"); if (v === "ko" || v === "en") return v; } catch (_) {}
    return (navigator.language || "ko").startsWith("ko") ? "ko" : "en";
  }
  function saveLang(v) { try { localStorage.setItem("imsi-lang", v); } catch (_) {} }
  const t = (k, ...a) => { const v = I18N[lang][k]; return typeof v === "function" ? v(...a) : v; };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const enc = encodeURIComponent;
  const catLabel = (key) => { const c = CATEGORIES.find((x) => x.key === key); return c ? c[lang] : ""; };
  const title = (a) => (lang === "en" && a.title_en) || a.title;
  const body = (a) => (lang === "en" && a.body_html_en) || a.body_html;
  const fmtDate = (iso) => {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return lang === "ko"
      ? `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`
      : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  };

  function categoryOf(a) {
    if (a.category && CATEGORIES.some((c) => c.key === a.category)) return a.category;
    const hay = (a.tags || []).join(" ").toLowerCase();
    const hit = CATEGORIES.find((c) => c.match && c.match.some((m) => hay.includes(m)));
    return hit ? hit.key : "music";
  }

  // ── data ──
  async function load() {
    if (articles) return articles;
    if (DEMO) {
      articles = window.IMSI_SAMPLE.slice();
    } else {
      // 예약 기사(발행 시각이 미래)는 시간이 될 때까지 숨긴다. DB 권한에서도 같은 조건으로 막는다.
      const nowIso = encodeURIComponent(new Date().toISOString());
      const url = `${cfg.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/articles?select=*&status=eq.published&published_at=lte.${nowIso}&order=published_at.desc&limit=300`;
      const res = await fetch(url, { headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: `Bearer ${cfg.SUPABASE_ANON_KEY}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      articles = await res.json();
    }
    articles.forEach((a) => { a._cat = categoryOf(a); a.tags = a.tags || []; });
    articles.sort((x, y) => new Date(y.published_at) - new Date(x.published_at));
    return articles;
  }

  // ── views ──
  function card(a) {
    return `<a class="card" href="#/a/${enc(a.id)}">
      <div class="thumb">${a.thumbnail_url ? `<img loading="lazy" src="${esc(a.thumbnail_url)}" alt="${esc(a.thumbnail_alt || title(a))}">` : ""}</div>
      <div class="meta"><span>${esc(catLabel(a._cat))}</span><span>${esc(fmtDate(a.published_at))}</span></div>
      <h3>${esc(title(a))}</h3>
      ${a.summary ? `<p>${esc(a.summary)}</p>` : ""}
    </a>`;
  }
  const grid = (list) => `<div class="grid">${list.map(card).join("")}</div>`;

  function viewHome(list) {
    if (!list.length) return `<div class="empty">${t("empty")}</div>`;
    const [lead, ...rest] = list;
    let html = `<section class="hero">
      ${lead.thumbnail_url ? `<img src="${esc(lead.thumbnail_url)}" alt="${esc(lead.thumbnail_alt || "")}">` : ""}
      <div class="hero-body">
        <div class="eyebrow"><span>imsi magazine</span><span>No.${list.length}</span><span>${esc(catLabel(lead._cat))}</span></div>
        <h1>${esc(title(lead))}</h1>
        ${lead.summary ? `<p>${esc(lead.summary)}</p>` : ""}
        <a class="u-link" href="#/a/${enc(lead.id)}">${t("read")}</a>
      </div>
      <div class="hero-count">${String(list.length).padStart(2, "0")}</div>
    </section>`;

    html += `<section class="section"><div class="section-head"><h2>${esc(catLabel("new"))}</h2><a class="u-link" href="#/c/new">${t("all")}</a></div>${grid(rest.slice(0, 6))}</section>`;

    CATEGORIES.filter((c) => c.key !== "new").forEach((c, i) => {
      const items = list.filter((a) => a._cat === c.key).slice(0, 3);
      if (!items.length) return;
      html += `<section class="section${i % 2 === 0 ? " band" : ""}"><div class="section-head"><h2>${esc(c[lang])}</h2><a class="u-link" href="#/c/${c.key}">${t("all")}</a></div>${grid(items)}</section>`;
    });
    return html;
  }

  function viewList(eyebrow, heading, items) {
    return `<section class="page-title"><div class="eyebrow"><span>${esc(eyebrow)}</span><span>${t("count", items.length)}</span></div><h1>${esc(heading)}</h1></section>
      ${items.length ? grid(items) : `<div class="empty">${t("empty")}</div>`}`;
  }

  function viewArticle(a, list) {
    if (!a) return `<div class="empty">${t("notFound")}</div>`;
    const tagSet = new Set(a.tags.map((x) => x.toLowerCase()));
    const related = list
      .filter((x) => x.id !== a.id)
      .map((x) => ({ x, score: x.tags.filter((tg) => tagSet.has(tg.toLowerCase())).length + (x._cat === a._cat ? 0.5 : 0) }))
      .filter((r) => r.score > 0)
      .sort((p, q) => q.score - p.score || new Date(q.x.published_at) - new Date(p.x.published_at))
      .slice(0, 3)
      .map((r) => r.x);
    const shownLang = lang === "en" && a.body_html_en ? "en" : a.language || "ko";

    return `<article>
      <div class="article-top">
        <div>
          <div class="eyebrow"><span>imsi magazine</span><span>${esc(catLabel(a._cat))}</span></div>
          <h1>${esc(title(a))}</h1>
          <dl class="specs">
            <dt>${t("category")}</dt><dd><a href="#/c/${a._cat}">${esc(catLabel(a._cat))}</a></dd>
            <dt>${t("date")}</dt><dd>${esc(fmtDate(a.published_at))}</dd>
            ${a.source_name ? `<dt>${t("source")}</dt><dd>${esc(a.source_name)}</dd>` : ""}
            <dt>${t("language")}</dt><dd>${esc(t("langName")[shownLang] || shownLang)}</dd>
          </dl>
          ${a.summary ? `<p class="summary">${esc(a.summary)}</p>` : ""}
        </div>
        ${a.thumbnail_url ? `<figure class="article-figure"><img src="${esc(a.thumbnail_url)}" alt="${esc(a.thumbnail_alt || "")}">${a.thumbnail_alt ? `<figcaption>${esc(a.thumbnail_alt)}</figcaption>` : ""}</figure>` : "<div></div>"}
      </div>
      <div class="article-body"><div class="label">${t("body")}</div>${body(a)}</div>
      ${a.tags.length ? `<div class="tags"><div class="label">${t("tags")}</div>${a.tags.map((tg) => `<a href="#/tag/${enc(tg)}">#${esc(tg)}</a>`).join("")}</div>` : ""}
      ${a.source_url ? `<p class="source-line">${t("source")} · <a href="${esc(a.source_url)}" target="_blank" rel="noopener">${esc(a.source_name || t("original"))}</a></p>` : ""}
    </article>
    ${related.length ? `<section class="section"><div class="section-head"><h2>${t("related")}</h2></div>${grid(related)}</section>` : ""}`;
  }

  // ── router ──
  async function render() {
    const hash = location.hash.replace(/^#/, "") || "/";
    const parts = hash.split("/").filter(Boolean).map(decodeURIComponent);
    applyStatic(parts[0] === "c" ? parts[1] : null);
    app.innerHTML = `<div class="empty">${t("loading")}</div>`;

    let list;
    try { list = await load(); } catch (e) {
      console.error(e);
      app.innerHTML = `<div class="empty">${t("error")}</div>`;
      return;
    }

    let isHome = false;
    if (parts[0] === "a") {
      const a = list.find((x) => String(x.id) === parts[1]);
      app.innerHTML = viewArticle(a, list);
      document.title = a ? `${title(a)} — imsi magazine` : "imsi magazine";
    } else if (parts[0] === "c") {
      const key = parts[1];
      const items = key === "new" ? list : list.filter((a) => a._cat === key);
      app.innerHTML = viewList("imsi magazine", catLabel(key) || key, items);
      document.title = `${catLabel(key)} — imsi magazine`;
    } else if (parts[0] === "tag") {
      const tg = parts[1] || "";
      const items = list.filter((a) => a.tags.some((x) => x.toLowerCase() === tg.toLowerCase()));
      app.innerHTML = viewList(t("tag"), `#${tg}`, items);
      document.title = `#${tg} — imsi magazine`;
    } else {
      isHome = true;
      app.innerHTML = viewHome(list);
      document.title = "imsi magazine";
    }
    header.dataset.home = isHome && list.length ? "1" : "";
    onScroll();
    window.scrollTo(0, 0);
  }

  // ── chrome: header(섹션 메뉴 + 언어) ──
  function applyStatic(activeCat) {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll(".lang button").forEach((b) => b.classList.toggle("active", b.dataset.lang === lang));
    document.getElementById("catNav").innerHTML = CATEGORIES.map((c) =>
      `<a href="#/c/${c.key}"${c.key === activeCat ? ' class="active" aria-current="page"' : ""}>${esc(c[lang])}</a>`).join("");
    let banner = document.querySelector(".demo-banner");
    if (DEMO) {
      if (!banner) { banner = document.createElement("div"); banner.className = "demo-banner"; document.body.appendChild(banner); }
      banner.textContent = t("demo");
    }
  }
  function onScroll() {
    const overHero = header.dataset.home === "1" && window.scrollY < window.innerHeight - 80;
    header.classList.toggle("on-hero", overHero);
    header.classList.toggle("solid", !overHero);
  }
  document.querySelectorAll(".lang button").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.lang === lang) return;
    lang = b.dataset.lang; saveLang(lang); render();
  }));
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("hashchange", render);
  render();
})();
