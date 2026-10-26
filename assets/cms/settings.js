// imsi magazine CMS — 설정 (어드민): 카테고리, 발행 시간대, 메인 고정 기사, 외부 API.
(function () {
  "use strict";
  const CMS = window.CMS;
  if (!CMS || CMS.broken) return;
  const { esc } = CMS;

  const catRow = (c = {}) => `<div class="cat-row">
    <input name="key" value="${esc(c.key || "")}" placeholder="영문 키 (예: music)" pattern="[a-z0-9-]+" required>
    <input name="ko" value="${esc(c.ko || "")}" placeholder="한국어 이름" required>
    <input name="en" value="${esc(c.en || "")}" placeholder="영어 이름">
    <button class="btn ghost sm" type="button" data-remove>빼기</button></div>`;

  async function viewSettings() {
    CMS.loading();
    const s = await CMS.settings(true);
    const [{ data: published }, { data: editors }] = await Promise.all([
      CMS.db.from("articles").select("id, title, published_at").eq("status", "published")
        .lte("published_at", new Date().toISOString()).order("published_at", { ascending: false }).limit(50),
      CMS.db.from("editors").select("user_id, display_name, email, role, active").order("display_name"),
    ]);
    let keySet = null;
    try { keySet = (await CMS.adminApi("status")).publish_key_set; } catch (_) { keySet = null; }
    const endpoint = `${CMS.cfg.SUPABASE_URL.replace(/\/$/, "")}/functions/v1/publish`;
    const cats = Array.isArray(s.categories) ? s.categories : [];

    CMS.page("설정", "사이트와 CMS 전체에 적용되는 값을 정해요. 칸마다 따로 저장해요.", `
      <form class="box" id="cats">
        <h2>카테고리</h2>
        <p class="hint">사이트 위쪽 메뉴와 글쓰기 화면의 카테고리 목록이에요. 영문 키는 주소에 쓰이니 한 번 정하면 바꾸지 않는 게 좋아요. 글에 카테고리를 안 고르면 태그로 자동 분류해요.</p>
        <div id="cat-rows">${cats.map(catRow).join("")}</div>
        <div class="row"><button class="btn ghost sm" type="button" id="cat-add">카테고리 추가</button><button class="btn primary sm" type="submit">카테고리 저장</button></div>
      </form>

      <form class="box" id="slots">
        <h2>발행 시간대</h2>
        <p class="hint">'발행 일정'과 글쓰기 화면의 시간표 칸이에요. 이 시간대 밖에도 직접 입력하면 예약할 수 있어요.</p>
        <div class="three">
          <label class="field">시작<input type="time" name="start" value="${esc(s.slots.start)}" required></label>
          <label class="field">끝<input type="time" name="end" value="${esc(s.slots.end)}" required></label>
          <label class="field">간격(분)<input type="number" name="step_minutes" min="5" max="240" step="5" value="${esc(String(s.slots.step_minutes))}" required></label>
        </div>
        <button class="btn primary sm" type="submit">시간대 저장</button>
      </form>

      <form class="box" id="featured">
        <h2>메인 고정 기사</h2>
        <p class="hint">사이트 첫 화면 맨 위 큰 기사예요. '자동'이면 가장 최근 발행 글이 올라가요. 고른 글을 비공개로 바꾸거나 지우면 다시 자동으로 돌아가요.</p>
        <label class="field">기사
          <select name="featured">
            <option value="">자동 (가장 최근 발행 글)</option>
            ${(published || []).map((a) => `<option value="${esc(a.id)}"${s.featured_article_id === a.id ? " selected" : ""}>${esc(CMS.fmtKst(a.published_at))} · ${esc(a.title)}</option>`).join("")}
          </select></label>
        <button class="btn primary sm" type="submit">메인 기사 저장</button>
      </form>

      <form class="box" id="api">
        <h2>외부 API (Hydra·Nessus 등)</h2>
        <p class="hint">다른 서비스가 이 주소로 글을 보내면 CMS 기사함에 쌓여요. 초안으로 쌓을지 바로 발행할지는 보내는 쪽(Hydra 캠페인의 '발행 상태', Nessus 발행처 규칙)에서 정해요.</p>
        <dl class="specs">
          <dt>받는 주소</dt><dd><code>${esc(endpoint)}</code></dd>
          <dt>API 키</dt><dd>${keySet === null ? "확인 못 함 (계정 관리 함수가 배포되면 보여요)" : keySet ? "설정됨" : "설정 안 됨 — Supabase > Edge Functions > Secrets 에 PUBLISH_API_KEY 를 넣어 주세요"}
            <span class="hint">키 값은 보안상 CMS에 보이지 않아요. 바꾸려면 Supabase Secrets 에서 바꾸고 보내는 쪽에도 같은 값을 넣어요.</span></dd>
        </dl>
        <label class="field">들어온 글의 기본 담당자 <span class="hint">'담당자 없음'이면 어드민만 관리해요. 에디터를 고르면 들어온 글이 그 사람 글이 돼요.</span>
          <select name="owner">
            <option value="">담당자 없음 (어드민만 관리)</option>
            ${(editors || []).filter((u) => u.active).map((u) => `<option value="${esc(u.user_id)}"${s.api.default_owner_id === u.user_id ? " selected" : ""}>${esc(u.display_name || u.email)} (${CMS.ROLES[u.role]})</option>`).join("")}
          </select></label>
        <button class="btn primary sm" type="submit">외부 API 저장</button>
      </form>`);

    const rowsBox = document.getElementById("cat-rows");
    const bindRemove = () => rowsBox.querySelectorAll("[data-remove]").forEach((b) => { b.onclick = () => b.parentElement.remove(); });
    bindRemove();
    document.getElementById("cat-add").onclick = () => { rowsBox.insertAdjacentHTML("beforeend", catRow()); bindRemove(); };

    const submit = (id, fn) => document.getElementById(id).addEventListener("submit", async (e) => {
      e.preventDefault();
      try { await fn(e.target); CMS.toast("저장했어요."); } catch (err) { CMS.toast("저장하지 못했어요: " + err.message, true); }
    });

    submit("cats", async () => {
      const list = [...rowsBox.querySelectorAll(".cat-row")].map((r) => ({
        key: r.querySelector('[name="key"]').value.trim(),
        ko: r.querySelector('[name="ko"]').value.trim(),
        en: r.querySelector('[name="en"]').value.trim() || r.querySelector('[name="ko"]').value.trim(),
      }));
      const keys = list.map((c) => c.key);
      if (keys.some((k, i) => keys.indexOf(k) !== i)) throw new Error("영문 키가 겹쳐요.");
      await CMS.saveSetting("categories", list);
    });
    submit("slots", async (f) => {
      const v = Object.fromEntries(new FormData(f));
      if (v.start >= v.end) throw new Error("끝 시각이 시작보다 뒤여야 해요.");
      await CMS.saveSetting("slots", { start: v.start, end: v.end, step_minutes: Number(v.step_minutes) });
    });
    submit("featured", async (f) => { await CMS.saveSetting("featured_article_id", new FormData(f).get("featured") || null); });
    submit("api", async (f) => { await CMS.saveSetting("api", { ...s.api, default_owner_id: new FormData(f).get("owner") || null }); });
  }

  CMS.route(/^\/settings$/, viewSettings, { admin: true });
})();
