// imsi magazine CMS — 글쓰기·수정. 본문 편집기(Quill), 이미지 올리기, 발행 시각 고르기, 상태 버튼.
(function () {
  "use strict";
  const CMS = window.CMS;
  if (!CMS || CMS.broken) return;
  const { esc } = CMS;
  const BUCKET = "article-images";

  // 이미지 올리기 → 공개 주소
  CMS.uploadImage = async (file) => {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error("JPG·PNG·WEBP·GIF 이미지만 올릴 수 있어요.");
    if (file.size > 10 * 1024 * 1024) throw new Error("이미지는 10MB 이하만 올릴 수 있어요.");
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const d = new Date();
    const path = `${d.getUTCFullYear()}/${CMS.pad(d.getUTCMonth() + 1)}/${crypto.randomUUID()}.${ext}`;
    const { error } = await CMS.db.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw new Error(/bucket/i.test(error.message) ? "이미지 저장소가 없어요. DB 변경(003) SQL을 먼저 실행해 주세요." : `이미지를 올리지 못했어요: ${error.message}`);
    return CMS.db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  };

  const pickFile = () => new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp,image/gif";
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });

  // 버튼: 누르면 사이트에 어떻게 되는지 함께 적는다
  const ACTIONS = {
    draft:    { label: "초안 저장",    hint: "사이트에 안 보이게 저장만 해요.", cls: "" },
    schedule: { label: "예약",         hint: "정한 발행 시각에 사이트에 올라가요.", cls: "primary" },
    now:      { label: "지금 발행",    hint: "바로 사이트에 올라가요.", cls: "primary" },
    save:     { label: "변경 저장",    hint: "내용만 저장하고 상태는 그대로 둬요.", cls: "" },
    pending:  { label: "비공개로",     hint: "사이트에서 내려요. 나중에 다시 발행할 수 있어요.", cls: "ghost" },
    delete:   { label: "삭제",         hint: "글을 완전히 지워요. 되돌릴 수 없어요.", cls: "danger" },
  };

  function actionsFor(isNew, st) {
    if (isNew) return ["draft", "schedule", "now"];
    const list = ["save"];
    if (st !== "draft") list.push("draft");
    list.push("schedule", "now");
    if (st === "published" || st === "scheduled") list.push("pending");
    list.push("delete");
    return list.filter((a, i, arr) => arr.indexOf(a) === i);
  }

  async function viewEdit(id) {
    CMS.loading();
    const isNew = !id;
    const settings = await CMS.settings();
    let a = { title: "", summary: "", body_html: "", tags: [], category: null, thumbnail_url: "", thumbnail_alt: "",
      display_name: CMS.profile.display_name || "", source_name: "", source_url: "", editor_note: "", status: "draft",
      published_at: null, origin: "cms", author_id: CMS.user.id };

    if (!isNew) {
      const { data, error } = await CMS.db.from("articles")
        .select("*, author:editors!articles_author_id_fkey(display_name, email)").eq("id", id).maybeSingle();
      if (error) throw error;
      if (!data) {
        return CMS.page("글을 열 수 없어요", "", `<p class="error">없는 글이거나, 내 글이 아니라서 열 수 없어요. 에디터는 자기 글만 열 수 있어요.</p><a href="#/">← 기사 목록</a>`);
      }
      a = data;
    }

    let authors = [];
    if (CMS.isAdmin()) {
      const { data } = await CMS.db.from("editors").select("user_id, display_name, email, active").order("display_name");
      authors = data || [];
    }

    const st = isNew ? "draft" : CMS.stateOf(a);
    const cats = Array.isArray(settings.categories) ? settings.categories : [];
    const who = a.author ? (a.author.display_name || a.author.email) : (isNew ? CMS.profile.display_name : "담당자 없음");
    const info = isNew ? "" : `<div class="info-line">${CMS.pill(st)}
      <span>${esc(CMS.ORIGINS[a.origin] || a.origin)}</span>
      <span>담당 ${esc(who)}</span>
      ${st === "scheduled" || st === "published" ? `<span>${esc(CMS.fmtKst(a.published_at))} ${st === "scheduled" ? "예약" : "발행"}</span>` : ""}
      <span>마지막 수정 ${esc(CMS.fmtKst(a.updated_at))}</span>
      ${a.origin === "api" ? `<span>외부 번호 ${esc(a.external_id)}</span>` : ""}
      ${st === "published" ? `<a href="${esc(CMS.articleUrl(a.id))}" target="_blank" rel="noopener">사이트에서 보기 ↗</a>` : ""}
    </div>
    <p class="state-desc">${esc(CMS.STATES[st].desc)}</p>`;

    const acts = actionsFor(isNew, st).map((k) =>
      `<div class="act"><button class="btn ${ACTIONS[k].cls}" type="button" data-act="${k}">${ACTIONS[k].label}</button><span>${ACTIONS[k].hint}</span></div>`).join("");

    CMS.page(isNew ? "새 글 쓰기" : "글 수정",
      isNew ? "글을 쓰고 아래 버튼으로 초안 저장, 예약, 지금 발행 중 하나를 골라요. 별표(*)는 꼭 채워야 해요."
            : "내용을 고치고 아래 버튼으로 저장하거나 상태를 바꿔요. 버튼마다 사이트에 어떻게 되는지 적혀 있어요.",
      `<a href="#/">← 기사 목록</a>
      ${info}
      <form class="edit" id="edit" autocomplete="off">
        <label class="field">제목 *<input id="f-title" value="${esc(a.title)}" maxlength="200" required></label>
        <label class="field">요약 <span class="hint">목록·카드에 보이는 한두 줄 소개</span><textarea id="f-summary" rows="2">${esc(a.summary)}</textarea></label>
        <div class="two">
          <label class="field">카테고리
            <select id="f-category">
              <option value="">자동 (태그로 분류)</option>
              ${cats.map((c) => `<option value="${esc(c.key)}"${a.category === c.key ? " selected" : ""}>${esc(c.ko)}</option>`).join("")}
            </select></label>
          <label class="field">기자명 <span class="hint">기사에 표시할 이름</span><input id="f-byline" value="${esc(a.display_name)}"></label>
        </div>
        <label class="field">태그 <span class="hint">쉼표로 구분, 예: 음악, 신곡</span><input id="f-tags" value="${esc((a.tags || []).join(", "))}"></label>

        <fieldset class="box">
          <legend>대표 이미지</legend>
          <div class="thumb-row">
            <div class="thumb-preview" id="thumb-preview">${a.thumbnail_url ? `<img src="${esc(a.thumbnail_url)}" alt="">` : "<span>없음</span>"}</div>
            <div class="thumb-fields">
              <button class="btn sm" type="button" id="thumb-upload">이미지 올리기</button>
              <label class="field">또는 이미지 주소<input id="f-thumb" value="${esc(a.thumbnail_url)}" placeholder="https://"></label>
              <label class="field">이미지 설명 <span class="hint">사진 설명·출처</span><input id="f-thumb-alt" value="${esc(a.thumbnail_alt)}"></label>
            </div>
          </div>
        </fieldset>

        <div class="field">
          <div class="field-head">본문 * <span class="hint">위 도구로 소제목·굵게·링크·목록·이미지를 넣어요. 이미지 버튼을 누르면 파일을 골라 올려요.</span>
            <button class="btn ghost sm" type="button" id="toggle-html">HTML로 보기</button></div>
          <div id="editor"></div>
          <textarea id="f-html" rows="16" hidden></textarea>
        </div>

        <details class="box"${a.source_name || a.source_url ? " open" : ""}>
          <summary>출처 (선택)</summary>
          <div class="two">
            <label class="field">출처 이름<input id="f-source-name" value="${esc(a.source_name)}"></label>
            <label class="field">출처 주소<input id="f-source-url" value="${esc(a.source_url)}" placeholder="https://"></label>
          </div>
        </details>

        <label class="field">편집 메모 <span class="hint">사이트에 안 보여요. 함께 일하는 사람에게 남기는 메모</span><textarea id="f-note" rows="2">${esc(a.editor_note)}</textarea></label>

        ${CMS.isAdmin() ? `<label class="field">담당자 <span class="hint">이 글을 관리할 사람. 에디터는 자기가 담당인 글만 열 수 있어요.</span>
          <select id="f-author">
            <option value="">담당자 없음 (어드민만 관리)</option>
            ${authors.map((u) => `<option value="${esc(u.user_id)}"${a.author_id === u.user_id ? " selected" : ""}>${esc(u.display_name || u.email)}${u.active ? "" : " (사용 중지)"}</option>`).join("")}
          </select></label>` : ""}

        <fieldset class="box">
          <legend>발행 시각 (한국 시간)</legend>
          <p class="hint">'예약'을 누를 때 쓰는 시각이에요. 아래 시간표에서 빈 칸을 누르거나 직접 입력하세요. 채워진 칸은 이미 다른 글이 잡혀 있는 시각이에요.</p>
          <input type="datetime-local" id="f-when" value="${esc(st === "scheduled" || st === "published" ? CMS.toLocalInput(a.published_at) : "")}">
          <div id="picker"></div>
        </fieldset>

        <div class="actions">${acts}</div>
      </form>`);

    // 본문 편집기
    const quill = new window.Quill("#editor", {
      theme: "snow",
      placeholder: "본문을 쓰세요.",
      modules: {
        toolbar: {
          container: [[{ header: [2, 3, false] }], ["bold", "italic", "underline", "link"], ["blockquote", { list: "ordered" }, { list: "bullet" }], ["image"], ["clean"]],
          handlers: {
            image: async () => {
              const file = await pickFile();
              if (!file) return;
              CMS.toast("이미지를 올리는 중…");
              try {
                const url = await CMS.uploadImage(file);
                const range = quill.getSelection(true);
                quill.insertEmbed(range ? range.index : quill.getLength(), "image", url, "user");
                CMS.toast("이미지를 넣었어요.");
              } catch (e) { CMS.toast(e.message, true); }
            },
          },
        },
      },
    });
    if (a.body_html) quill.clipboard.dangerouslyPasteHTML(CMS.sanitize(a.body_html));

    // Quill 2.0.3 의 getSemanticHTML 은 띄어쓰기를 &nbsp; 로 바꿔서 사이트 줄바꿈이 깨진다 → 되돌린다
    const semantic = () => quill.getSemanticHTML().replace(/&nbsp;/g, " ");
    let htmlMode = false;
    const $html = document.getElementById("f-html");
    const $toggle = document.getElementById("toggle-html");
    $toggle.onclick = () => {
      htmlMode = !htmlMode;
      if (htmlMode) { $html.value = semantic(); }
      else { quill.setContents([]); quill.clipboard.dangerouslyPasteHTML(CMS.sanitize($html.value)); }
      $html.hidden = !htmlMode;
      document.querySelector(".ql-toolbar").hidden = htmlMode;
      document.getElementById("editor").hidden = htmlMode;
      $toggle.textContent = htmlMode ? "편집기로 보기" : "HTML로 보기";
    };
    const bodyHtml = () => {
      const html = htmlMode ? $html.value : semantic();
      const clean = CMS.sanitize(html).trim();
      return clean === "<p></p>" || clean === "<p><br></p>" ? "" : clean;
    };

    // 대표 이미지
    const $thumb = document.getElementById("f-thumb");
    const showThumb = () => {
      const v = $thumb.value.trim();
      document.getElementById("thumb-preview").innerHTML = v ? `<img src="${esc(v)}" alt="">` : "<span>없음</span>";
    };
    $thumb.addEventListener("change", showThumb);
    document.getElementById("thumb-upload").onclick = async () => {
      const file = await pickFile();
      if (!file) return;
      CMS.toast("이미지를 올리는 중…");
      try { $thumb.value = await CMS.uploadImage(file); showThumb(); CMS.toast("대표 이미지를 올렸어요."); }
      catch (e) { CMS.toast(e.message, true); }
    };

    // 발행 시각 고르기
    CMS.slotPicker(document.getElementById("picker"), document.getElementById("f-when"), a.published_at, isNew ? null : a.id);

    document.querySelectorAll("button[data-act]").forEach((b) => b.addEventListener("click", () => save(b.dataset.act)));

    async function save(act) {
      const val = (sel) => { const el = document.getElementById(sel); return el ? el.value : ""; };
      const fields = {
        title: val("f-title").trim(),
        summary: val("f-summary").trim() || null,
        category: val("f-category") || null,
        display_name: val("f-byline").trim() || null,
        tags: val("f-tags").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20),
        thumbnail_url: val("f-thumb").trim() || null,
        thumbnail_alt: val("f-thumb-alt").trim() || null,
        body_html: bodyHtml(),
        source_name: val("f-source-name").trim() || null,
        source_url: val("f-source-url").trim() || null,
        editor_note: val("f-note").trim() || null,
        updated_by: CMS.user.id,
      };
      if (CMS.isAdmin()) fields.author_id = val("f-author") || null;

      if (act === "delete") {
        if (!confirm(`'${a.title}' 글을 지울까요? 되돌릴 수 없어요.`)) return;
        const { error } = await CMS.db.from("articles").delete().eq("id", a.id);
        if (error) return CMS.toast("지우지 못했어요: " + error.message, true);
        CMS.toast("글을 지웠어요.");
        return CMS.go("#/");
      }

      if (!fields.title) return CMS.toast("제목을 입력해 주세요.", true);
      if (act !== "draft" && act !== "save" && act !== "pending" && !fields.body_html) return CMS.toast("본문을 입력해 주세요. 발행·예약하려면 본문이 있어야 해요.", true);

      const when = CMS.fromLocalInput(val("f-when"));
      if (act === "schedule") {
        if (!when) return CMS.toast("발행 시각을 정해 주세요. 시간표에서 빈 칸을 누르면 들어가요.", true);
        if (Date.parse(when) <= Date.now()) return CMS.toast("예약은 지금보다 뒤 시각이어야 해요. 바로 올리려면 '지금 발행'을 누르세요.", true);
        Object.assign(fields, { status: "published", published_at: when });
      } else if (act === "now") {
        Object.assign(fields, { status: "published", published_at: new Date().toISOString() });
      } else if (act === "draft" || act === "pending") {
        fields.status = act;
        if (when) fields.published_at = when;
      }

      let res;
      if (isNew) {
        // 새 글은 기본으로 쓴 사람이 담당. 어드민은 다른 담당자를 고를 수 있다.
        fields.author_id = CMS.isAdmin() && fields.author_id ? fields.author_id : CMS.user.id;
        res = await CMS.db.from("articles").insert({ ...fields, origin: "cms", status: fields.status || "draft" }).select("id").single();
      } else {
        res = await CMS.db.from("articles").update(fields).eq("id", a.id).select("id").single();
      }
      if (res.error) return CMS.toast("저장하지 못했어요: " + res.error.message, true);

      const msg = { draft: "초안으로 저장했어요.", schedule: `${CMS.fmtKst(fields.published_at)}에 예약했어요.`, now: "발행했어요. 사이트에 올라갔어요.", save: "저장했어요.", pending: "비공개로 바꿨어요. 사이트에서 내려갔어요." }[act];
      CMS.toast(msg);
      if (isNew) CMS.go(`#/edit/${res.data.id}`); else CMS.render();
    }
  }

  CMS.route(/^\/new$/, () => viewEdit(null));
  CMS.route(/^\/edit\/([\w-]+)$/, (id) => viewEdit(id));
})();
