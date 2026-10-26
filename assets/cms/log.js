// imsi magazine CMS — 작업 기록 (어드민): 누가 언제 어떤 글에 무엇을 했는지. DB 트리거가 남긴다.
(function () {
  "use strict";
  const CMS = window.CMS;
  if (!CMS || CMS.broken) return;
  const { esc } = CMS;
  const PAGE_SIZE = 50;
  const ACTION = { create: "작성", receive: "외부에서 들어옴", edit: "내용 수정", state: "상태 변경", reassign: "담당자 변경", delete: "삭제" };
  const stateLabel = (s) => (s && CMS.STATES[s] ? CMS.STATES[s].label : s || "");

  async function viewLog() {
    CMS.loading();
    const page = Math.max(1, Number(CMS.query().get("page")) || 1);
    const from = (page - 1) * PAGE_SIZE;
    const { data, count, error } = await CMS.db.from("article_events")
      .select("*", { count: "exact" }).order("at", { ascending: false }).range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(/article_events/.test(error.message) ? "DB 변경(003) SQL이 아직 적용되지 않았어요." : error.message);

    const rows = (data || []).map((e) => {
      const change = e.action === "state" || (e.from_state && e.to_state && e.from_state !== e.to_state)
        ? ` (${esc(stateLabel(e.from_state))} → ${esc(stateLabel(e.to_state))})`
        : e.to_state && (e.action === "create" || e.action === "receive") ? ` (${esc(stateLabel(e.to_state))})` : "";
      const title = esc(e.article_title || "(제목 없음)");
      return `<tr>
        <td>${esc(CMS.fmtKst(e.at))}</td>
        <td>${esc(e.actor_name || "")}</td>
        <td>${esc(ACTION[e.action] || e.action)}${change}</td>
        <td>${e.action === "delete" ? title : `<a href="#/edit/${esc(e.article_id)}">${title}</a>`}</td>
      </tr>`;
    }).join("");
    const pages = Math.max(1, Math.ceil((count || 0) / PAGE_SIZE));

    CMS.page("작업 기록", "누가 언제 어떤 글을 쓰고, 고치고, 발행하고, 지웠는지 최근 순으로 보여줘요. 지운 글도 기록은 남아요.", `
      ${rows ? `<div class="table-wrap"><table class="log"><thead><tr><th>시각</th><th>누가</th><th>무엇을</th><th>글</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="empty-box">아직 기록이 없어요. 글을 쓰거나 고치면 여기에 남아요.</p>`}
      <nav class="pager">
        ${page > 1 ? `<a class="btn ghost sm" href="#/log?page=${page - 1}">← 최근</a>` : ""}
        <span class="muted">${page} / ${pages} 쪽 · ${count || 0}건</span>
        ${page < pages ? `<a class="btn ghost sm" href="#/log?page=${page + 1}">이전 기록 →</a>` : ""}
      </nav>`);
  }

  CMS.route(/^\/log$/, viewLog, { admin: true });
})();
