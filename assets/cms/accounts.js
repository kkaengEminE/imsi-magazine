// imsi magazine CMS — 계정 관리 (어드민). 계정 추가·이름·역할·비밀번호 초기화·사용 중지·삭제.
// 실제 처리는 계정 관리 함수(admin-users)가 관리자 키로 한다.
(function () {
  "use strict";
  const CMS = window.CMS;
  if (!CMS || CMS.broken) return;
  const { esc } = CMS;

  const roleSelect = (name, value) => `<select name="${name}">
    <option value="editor"${value === "editor" ? " selected" : ""}>에디터 — 자기 글만 관리</option>
    <option value="admin"${value === "admin" ? " selected" : ""}>어드민 — 모든 글·계정·설정 관리</option>
  </select>`;

  async function viewAccounts() {
    CMS.loading();
    let accounts;
    try { accounts = (await CMS.adminApi("list")).accounts; }
    catch (e) {
      return CMS.page("계정 관리", "", `<p class="error">${esc(e.message)}</p>
        <p class="muted">계정 관리 함수는 Supabase 대시보드 > Edge Functions 에서 'admin-users' 라는 이름으로 배포해야 해요 (README 참고).</p>`);
    }

    const rows = accounts.map((u) => `
      <li class="account${u.active ? "" : " off"}" data-id="${esc(u.user_id)}">
        <div class="account-head">
          <b>${esc(u.display_name || "(이름 없음)")}</b>
          <span class="role ${u.role}">${CMS.ROLES[u.role]}</span>
          ${u.active ? "" : `<span class="pill pending">사용 중지</span>`}
          ${u.user_id === CMS.user.id ? `<span class="muted">(나)</span>` : ""}
        </div>
        <div class="muted">${esc(u.email || "")} · 담당 글 ${u.articles}건 · ${esc(CMS.fmtKst(u.created_at))} 생성</div>
        <div class="account-actions">
          <button class="btn ghost sm" type="button" data-do="edit">이름·역할 수정</button>
          <button class="btn ghost sm" type="button" data-do="password">비밀번호 초기화</button>
          ${u.user_id === CMS.user.id ? "" : `<button class="btn ghost sm" type="button" data-do="toggle">${u.active ? "사용 중지" : "다시 사용"}</button>
          <button class="btn danger sm" type="button" data-do="delete">삭제</button>`}
        </div>
        <div class="account-form" hidden></div>
      </li>`).join("");

    CMS.page("계정 관리",
      "CMS에 로그인할 계정을 만들고 관리해요. 에디터는 자기 글만, 어드민은 모든 글과 계정·설정을 관리해요. 사용 중인 어드민은 항상 한 명 이상 있어야 해요.",
      `<details class="box" id="add-box">
        <summary>계정 추가</summary>
        <form class="grid-form" id="add">
          <label class="field">이메일 *<input name="email" type="email" required></label>
          <label class="field">이름 * <span class="hint">기자명 기본값으로도 쓰여요</span><input name="display_name" required></label>
          <label class="field">임시 비밀번호 * <span class="hint">8자 이상. 본인에게 전달하고, 로그인 후 '내 정보'에서 바꾸게 하세요</span><input name="password" type="text" minlength="8" required></label>
          <label class="field">역할${roleSelect("role", "editor")}</label>
          <button class="btn primary" type="submit">계정 만들기</button>
        </form>
      </details>
      <ul class="accounts">${rows}</ul>`);

    document.getElementById("add").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      try { await CMS.adminApi("create", fd); CMS.toast(`${fd.email} 계정을 만들었어요.`); CMS.render(); }
      catch (err) { CMS.toast(err.message, true); }
    });

    document.querySelectorAll(".account").forEach((li) => {
      const u = accounts.find((x) => x.user_id === li.dataset.id);
      const form = li.querySelector(".account-form");
      const open = (html, onSubmit) => {
        form.innerHTML = `<form class="grid-form">${html}<div class="row"><button class="btn primary sm" type="submit">확인</button><button class="btn ghost sm" type="button" data-cancel>취소</button></div></form>`;
        form.hidden = false;
        form.querySelector("[data-cancel]").onclick = () => { form.hidden = true; };
        form.querySelector("form").onsubmit = async (e) => {
          e.preventDefault();
          try { await onSubmit(Object.fromEntries(new FormData(e.target))); } catch (err) { CMS.toast(err.message, true); }
        };
      };
      li.querySelectorAll("[data-do]").forEach((b) => b.addEventListener("click", async () => {
        const action = b.dataset.do;
        if (action === "edit") {
          open(`<label class="field">이름<input name="display_name" value="${esc(u.display_name || "")}" required></label>
                <label class="field">역할${roleSelect("role", u.role)}</label>`, async (v) => {
            await CMS.adminApi("update", { user_id: u.user_id, display_name: v.display_name, role: v.role });
            CMS.toast("수정했어요.");
            if (u.user_id === CMS.user.id) location.reload(); else CMS.render();
          });
        } else if (action === "password") {
          open(`<label class="field">새 임시 비밀번호 <span class="hint">8자 이상. 본인에게 전달하세요</span><input name="password" type="text" minlength="8" required></label>`, async (v) => {
            await CMS.adminApi("reset_password", { user_id: u.user_id, password: v.password });
            CMS.toast(`${u.display_name || u.email}의 비밀번호를 바꿨어요.`);
            form.hidden = true;
          });
        } else if (action === "toggle") {
          const next = !u.active;
          if (!confirm(next ? `${u.display_name}을(를) 다시 사용하게 할까요?` : `${u.display_name}을(를) 사용 중지할까요? 로그인만 막히고 글은 그대로 남아요.`)) return;
          try { await CMS.adminApi("update", { user_id: u.user_id, active: next }); CMS.toast(next ? "다시 사용하게 했어요." : "사용 중지했어요."); CMS.render(); }
          catch (err) { CMS.toast(err.message, true); }
        } else if (action === "delete") {
          const others = accounts.filter((x) => x.user_id !== u.user_id && x.active);
          open(`<p>${esc(u.display_name)} 계정을 완전히 지워요. 되돌릴 수 없어요. 담당 글 ${u.articles}건은 아래 사람에게 넘어가요.</p>
                <label class="field">글을 넘겨받을 사람
                  <select name="transfer_to" required>${others.map((x) => `<option value="${esc(x.user_id)}"${x.user_id === CMS.user.id ? " selected" : ""}>${esc(x.display_name || x.email)} (${CMS.ROLES[x.role]})</option>`).join("")}</select></label>`, async (v) => {
            if (!confirm(`정말 ${u.display_name} 계정을 지울까요?`)) return;
            await CMS.adminApi("delete", { user_id: u.user_id, transfer_to: v.transfer_to });
            CMS.toast("계정을 지우고 글을 넘겼어요.");
            CMS.render();
          });
        }
      }));
    });
  }

  CMS.route(/^\/accounts$/, viewAccounts, { admin: true });
})();
