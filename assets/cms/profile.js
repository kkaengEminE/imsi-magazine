// imsi magazine CMS — 내 정보(이름·비밀번호)와 도움말(용어·권한·흐름).
(function () {
  "use strict";
  const CMS = window.CMS;
  if (!CMS || CMS.broken) return;
  const { esc } = CMS;

  function viewMe() {
    const p = CMS.profile;
    CMS.page("내 정보", "내 이름(기자명 기본값)과 비밀번호를 바꿔요. 역할은 어드민만 바꿀 수 있어요.", `
      <dl class="specs box">
        <dt>이메일</dt><dd>${esc(p.email || CMS.user.email)}</dd>
        <dt>역할</dt><dd>${CMS.ROLES[p.role]} — ${p.role === "admin" ? "모든 글·계정·설정을 관리해요." : "내가 쓴 글과 나에게 맡겨진 글만 관리해요."}</dd>
      </dl>
      <form class="box grid-form" id="name">
        <h2>이름</h2>
        <label class="field">이름 <span class="hint">새 글의 기자명에 기본으로 들어가요</span><input name="display_name" value="${esc(p.display_name || "")}" required></label>
        <button class="btn primary sm" type="submit">이름 저장</button>
      </form>
      <form class="box grid-form" id="password">
        <h2>비밀번호 변경</h2>
        <label class="field">새 비밀번호 <span class="hint">8자 이상</span><input name="pw" type="password" minlength="8" autocomplete="new-password" required></label>
        <label class="field">새 비밀번호 확인<input name="pw2" type="password" minlength="8" autocomplete="new-password" required></label>
        <button class="btn primary sm" type="submit">비밀번호 바꾸기</button>
      </form>`);

    document.getElementById("name").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = new FormData(e.target).get("display_name").trim();
      const { error } = await CMS.db.from("editors").update({ display_name: name }).eq("user_id", CMS.user.id);
      if (error) return CMS.toast("저장하지 못했어요: " + error.message, true);
      CMS.profile.display_name = name;
      CMS.toast("이름을 바꿨어요.");
      CMS.render();
    });
    document.getElementById("password").addEventListener("submit", async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(e.target));
      if (v.pw !== v.pw2) return CMS.toast("두 비밀번호가 달라요.", true);
      const { error } = await CMS.db.auth.updateUser({ password: v.pw });
      if (error) return CMS.toast("바꾸지 못했어요: " + error.message, true);
      e.target.reset();
      CMS.toast("비밀번호를 바꿨어요. 다음 로그인부터 새 비밀번호를 쓰세요.");
    });
  }

  function viewHelp() {
    const st = Object.entries(CMS.STATES).map(([k, v]) => `<tr><td>${CMS.pill(k)}</td><td>${esc(v.desc)}</td></tr>`).join("");
    CMS.page("도움말", "이 CMS의 용어, 권한, 글이 사이트에 올라가는 흐름이에요.", `
      <section class="box">
        <h2>이 CMS는</h2>
        <p>imsi magazine 사이트의 글을 쓰고, 고치고, 올리고, 내리는 곳이에요. 글은 두 가지 길로 기사함에 들어와요.</p>
        <ul>
          <li><b>직접 작성</b> — [새 글 쓰기]에서 써요.</li>
          <li><b>외부 API</b> — Hydra·Nessus 같은 다른 서비스가 보내요. 보내는 쪽 설정에 따라 초안으로 쌓이거나 바로 발행돼요.</li>
        </ul>
        <p>사이트에는 <b>발행</b> 상태이고 발행 시각이 지난 글만 보여요.</p>
      </section>
      <section class="box">
        <h2>글 상태</h2>
        <table class="plain"><tbody>${st}
          <tr><td><span class="pill">삭제</span></td><td>글을 완전히 지워요. 되돌릴 수 없어요. 작업 기록에는 남아요.</td></tr>
        </tbody></table>
      </section>
      <section class="box">
        <h2>글이 사이트에 올라가는 흐름</h2>
        <ol>
          <li>[새 글 쓰기]에서 제목·본문·대표 이미지를 넣고 <b>초안 저장</b>. (외부 API 글은 여기까지 자동)</li>
          <li>글을 열어 내용을 확인하고 고쳐요.</li>
          <li>발행 시각 시간표에서 빈 칸을 누르고 <b>예약</b>, 또는 바로 <b>지금 발행</b>.</li>
          <li>그 시각이 되면 사이트에 올라가요. 내리려면 <b>비공개로</b>.</li>
        </ol>
        <p class="hint">한 번이라도 CMS에서 고친 외부 API 글은, 보낸 쪽이 같은 글을 다시 보내도 덮어쓰지 않아요.</p>
      </section>
      <section class="box">
        <h2>권한</h2>
        <table class="plain"><thead><tr><th>할 수 있는 일</th><th>에디터</th><th>어드민</th></tr></thead><tbody>
          <tr><td>글쓰기·이미지 넣기</td><td>✅</td><td>✅</td></tr>
          <tr><td>글 수정·초안·예약·발행·비공개·삭제</td><td>자기 글만</td><td>모든 글</td></tr>
          <tr><td>외부 API로 들어온 글</td><td>담당자로 지정된 글만</td><td>✅</td></tr>
          <tr><td>다른 사람 글 보기</td><td>❌ (일정표에 '다른 글 예약'으로만)</td><td>✅</td></tr>
          <tr><td>계정 관리·설정·작업 기록</td><td>❌</td><td>✅</td></tr>
          <tr><td>내 정보(이름·비밀번호)</td><td>✅</td><td>✅</td></tr>
        </tbody></table>
        <p class="hint">권한은 화면뿐 아니라 DB에서도 막아요. 에디터가 다른 사람 글을 열거나 고칠 수 없어요.</p>
      </section>`);
  }

  CMS.route(/^\/me$/, viewMe);
  CMS.route(/^\/help$/, viewHelp);
})();
