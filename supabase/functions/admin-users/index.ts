// imsi magazine — 계정 관리 함수 (CMS 어드민 전용)
// 로그인 계정 생성·비밀번호 초기화·사용 중지·삭제는 관리자 키(service role)로만 할 수 있어서 함수로 둔다.
// 배포: Supabase 대시보드 > Edge Functions > 새 함수 "admin-users" 에 index.ts 와 logic.ts 두 파일.
//       JWT 검증(Verify JWT)은 켜 둔다 — CMS 로그인 세션으로 부르고, 안에서 어드민인지 다시 확인한다.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { leavesNoAdmin, validate } from "./logic.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });

// 로그인 막기: 아주 긴 정지 기간 / 풀기: none
const BAN_FOREVER = "876000h";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  // 부른 사람이 사용 중인 어드민인지
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: caller } = await db.auth.getUser(token);
  if (!caller?.user) return json(401, { error: "로그인이 필요해요." });
  const { data: me } = await db.from("editors").select("role, active").eq("user_id", caller.user.id).maybeSingle();
  if (!me || !me.active || me.role !== "admin") return json(403, { error: "어드민만 할 수 있어요." });

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json(400, { error: "잘못된 요청이에요." }); }
  const action = String(b.action ?? "");
  const invalid = validate(action, b);
  if (invalid) return json(400, { error: invalid });

  const s = (k: string) => String(b[k] ?? "").trim();

  if (action === "status") {
    // 설정 화면용: 외부 API 키가 Secrets 에 들어 있는지만 (값은 보내지 않는다)
    return json(200, { publish_key_set: !!Deno.env.get("PUBLISH_API_KEY") });
  }

  const { data: accounts, error: listErr } = await db
    .from("editors").select("user_id, email, display_name, role, active, created_at").order("created_at");
  if (listErr) return json(500, { error: listErr.message });

  if (action === "list") {
    const { data: counts } = await db.from("articles").select("author_id").not("author_id", "is", null);
    const byAuthor: Record<string, number> = {};
    (counts ?? []).forEach((r: { author_id: string }) => { byAuthor[r.author_id] = (byAuthor[r.author_id] ?? 0) + 1; });
    return json(200, { accounts: accounts.map((a) => ({ ...a, articles: byAuthor[a.user_id] ?? 0 })) });
  }

  if (action === "create") {
    const { data: created, error } = await db.auth.admin.createUser({
      email: s("email"), password: s("password"), email_confirm: true,
    });
    if (error || !created.user) {
      const msg = /already/i.test(error?.message ?? "") ? "이미 있는 이메일이에요." : `계정을 만들지 못했어요: ${error?.message}`;
      return json(400, { error: msg });
    }
    const { error: insErr } = await db.from("editors").insert({
      user_id: created.user.id, email: s("email"), display_name: s("display_name"), role: s("role"), active: true,
    });
    if (insErr) {
      await db.auth.admin.deleteUser(created.user.id);
      return json(500, { error: `편집자 등록에 실패했어요: ${insErr.message}` });
    }
    return json(200, { ok: true, user_id: created.user.id });
  }

  const target = accounts.find((a) => a.user_id === s("user_id"));
  if (!target) return json(404, { error: "계정을 찾지 못했어요." });

  if (action === "update") {
    const patch: Record<string, unknown> = {};
    if ("display_name" in b) patch.display_name = s("display_name");
    if ("role" in b) patch.role = s("role");
    if ("active" in b) patch.active = b.active;
    if (leavesNoAdmin(accounts, target.user_id, { role: patch.role as string, active: patch.active as boolean })) {
      return json(400, { error: "사용 중인 어드민이 최소 한 명은 있어야 해요." });
    }
    const { error } = await db.from("editors").update(patch).eq("user_id", target.user_id);
    if (error) return json(500, { error: error.message });
    if ("active" in patch) {
      await db.auth.admin.updateUserById(target.user_id, { ban_duration: patch.active ? "none" : BAN_FOREVER });
    }
    return json(200, { ok: true });
  }

  if (action === "reset_password") {
    const { error } = await db.auth.admin.updateUserById(target.user_id, { password: s("password") });
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true });
  }

  if (action === "delete") {
    if (target.user_id === caller.user.id) return json(400, { error: "자기 계정은 지울 수 없어요." });
    if (leavesNoAdmin(accounts, target.user_id, { remove: true })) {
      return json(400, { error: "사용 중인 어드민이 최소 한 명은 있어야 해요." });
    }
    const heir = accounts.find((a) => a.user_id === s("transfer_to"));
    if (!heir) return json(400, { error: "글을 넘겨받을 계정을 찾지 못했어요." });
    const { error: moveErr } = await db.from("articles").update({ author_id: heir.user_id }).eq("author_id", target.user_id);
    if (moveErr) return json(500, { error: `글을 넘기지 못했어요: ${moveErr.message}` });
    const { error } = await db.auth.admin.deleteUser(target.user_id);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true });
  }

  return json(400, { error: "알 수 없는 요청이에요." });
});
