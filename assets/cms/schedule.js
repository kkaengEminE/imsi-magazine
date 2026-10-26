// imsi magazine CMS — 발행 일정 (주간 시간표)과 글쓰기 화면의 시각 고르기.
// 남의 글 제목은 에디터에게 안 보인다(DB 함수 taken_slots 가 막는다). 칸이 찼다는 것만 보인다.
(function () {
  "use strict";
  const CMS = window.CMS;
  if (!CMS || CMS.broken) return;
  const { esc, pad } = CMS;

  async function taken(fromMs, toMs) {
    const { data, error } = await CMS.db.rpc("taken_slots", { from_at: new Date(fromMs).toISOString(), to_at: new Date(toMs).toISOString() });
    if (error) throw new Error(/taken_slots/.test(error.message) ? "DB 변경(003) SQL이 아직 적용되지 않았어요." : error.message);
    const map = new Map();
    (data || []).forEach((r) => map.set(Math.floor(Date.parse(r.published_at) / 60000) * 60000, r));
    return map;
  }

  const dayTitle = (dayMs) => { const p = CMS.kstParts(new Date(dayMs).toISOString()); return `${p.m}/${p.d} (${CMS.WEEKDAYS[p.wd]})`; };
  const label = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

  function dayGrid(dayMs, minutes, map, opts) {
    const now = Date.now();
    let filled = 0;
    const cells = minutes.map((min) => {
      const t = dayMs + min * 60000;
      const r = map.get(t);
      const past = t <= now;
      if (r) {
        filled++;
        const name = r.title ? esc(r.title) : "다른 글 예약";
        const cls = `slot taken${r.mine ? " mine" : ""}${opts.currentId && r.article_id === opts.currentId ? " current" : ""}`;
        return r.article_id && opts.links
          ? `<a class="${cls}" href="#/edit/${esc(r.article_id)}" title="${name}"><b>${label(min)}</b><span>${name}</span></a>`
          : `<span class="${cls}" title="${name}"><b>${label(min)}</b><span>${name}</span></span>`;
      }
      if (opts.pick && !past) return `<button type="button" class="slot free" data-slot="${new Date(t).toISOString()}"><b>${label(min)}</b><span>비어 있음</span></button>`;
      return `<span class="slot${past ? " past" : ""}"><b>${label(min)}</b><span>${past ? "지남" : "비어 있음"}</span></span>`;
    }).join("");
    return `<div class="slot-day"><h3>${dayTitle(dayMs)} <span class="muted">${filled}/${minutes.length}칸</span></h3><div class="slot-grid">${cells}</div></div>`;
  }

  const legend = `<p class="legend"><span class="slot taken mine"></span>내 글 <span class="slot taken"></span>다른 글 <span class="slot"></span>비어 있음 <span class="slot past"></span>지난 시간</p>`;

  async function viewSchedule() {
    CMS.loading();
    const week = Number(CMS.query().get("week")) || 0;
    const settings = await CMS.settings();
    const minutes = CMS.slotMinutes(settings.slots);
    const start = CMS.kstDayStart(week * 7);
    const map = await taken(start, start + 7 * 86400000);
    const days = [...Array(7)].map((_, i) => dayGrid(start + i * 86400000, minutes, map, { links: true })).join("");
    CMS.page("발행 일정",
      `오늘부터 7일씩 발행 시간표를 봐요. 칸 하나가 발행 시간대 하나(${esc(settings.slots.start)}~${esc(settings.slots.end)}, ${esc(String(settings.slots.step_minutes))}분 간격)예요. ${CMS.isAdmin() ? "채워진 칸을 누르면 그 글이 열려요." : "내 글은 눌러서 열 수 있고, 다른 사람 글은 '다른 글 예약'으로만 보여요."} 예약은 글쓰기 화면에서 해요.`,
      `<nav class="pager">
        <a class="btn ghost sm" href="#/schedule?week=${week - 1}">← 이전 7일</a>
        ${week !== 0 ? `<a class="btn ghost sm" href="#/schedule">오늘로</a>` : ""}
        <a class="btn ghost sm" href="#/schedule?week=${week + 1}">다음 7일 →</a>
      </nav>
      ${legend}
      <section class="slots">${days}</section>`);
  }

  // 글쓰기 화면: 하루씩 넘기며 빈 칸을 누르면 발행 시각 칸에 들어간다
  CMS.slotPicker = async (box, input, initialIso, currentId) => {
    const settings = await CMS.settings();
    const minutes = CMS.slotMinutes(settings.slots);
    const startFrom = initialIso && Date.parse(initialIso) > Date.now()
      ? Math.floor((Date.parse(initialIso) - CMS.kstDayStart(0)) / 86400000) : 0;
    let offset = Math.max(0, startFrom);
    async function draw() {
      const day = CMS.kstDayStart(offset);
      let map;
      try { map = await taken(day, day + 86400000); } catch (e) { box.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
      box.innerHTML = `<div class="pager">
          <button class="btn ghost sm" type="button" data-nav="-1"${offset === 0 ? " disabled" : ""}>← 전날</button>
          <button class="btn ghost sm" type="button" data-nav="1">다음 날 →</button>
        </div>${dayGrid(day, minutes, map, { pick: true, currentId })}`;
      box.querySelectorAll("[data-nav]").forEach((b) => { b.onclick = () => { offset = Math.max(0, offset + Number(b.dataset.nav)); draw(); }; });
      box.querySelectorAll("button[data-slot]").forEach((b) => {
        b.onclick = () => {
          input.value = CMS.toLocalInput(b.dataset.slot);
          box.querySelectorAll(".slot.picked").forEach((x) => x.classList.remove("picked"));
          b.classList.add("picked");
          CMS.toast(`발행 시각을 ${CMS.fmtKst(b.dataset.slot)}로 정했어요. '예약'을 누르면 저장돼요.`);
        };
      });
    }
    draw();
  };

  CMS.route(/^\/schedule$/, viewSchedule);
})();
