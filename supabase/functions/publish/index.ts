// imsi magazine — External Publish API v1.1 수신 함수 (docs/PUBLISH_API.md)
// 배포: Supabase 대시보드 > Edge Functions > "publish" 에 index.ts 와 logic.ts 두 파일을 올리거나,
//       CLI 로 `supabase functions deploy publish --no-verify-jwt`.
// Secrets 에 PUBLISH_API_KEY 등록. JWT 검증(Verify JWT)은 끈다 — 자체 키로 인증.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { articleUrl, buildRow, displayStatus, editedInCms, queueRange } from "./logic.ts";

const SITE_URL = Deno.env.get("SITE_URL") ?? "https://kkaengemine.github.io/imsi-magazine/";
const API_KEY = Deno.env.get("PUBLISH_API_KEY") ?? "";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

async function defaultOwner(): Promise<string | null> {
  const { data } = await db.from("site_settings").select("value").eq("key", "api").maybeSingle();
  const id = data?.value?.default_owner_id;
  if (typeof id !== "string" || !id) return null;
  const { data: ed } = await db.from("editors").select("user_id").eq("user_id", id).eq("active", true).maybeSingle();
  return ed ? id : null;
}

Deno.serve(async (req) => {
  if (!API_KEY) return json(500, { error: "PUBLISH_API_KEY not configured" });
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${API_KEY}`) return json(401, { error: "invalid api key" });

  const url = new URL(req.url);
  const now = new Date();

  // 예약·초안 목록: GET ?list=queue&from=&to=
  if (req.method === "GET" && url.searchParams.get("list") === "queue") {
    const range = queueRange(url.searchParams, now);
    if ("error" in range) return json(400, range);

    const cols = "id, external_id, title, status, published_at, display_name, updated_at";
    const [scheduled, waiting] = await Promise.all([
      db.from("articles").select(cols).eq("status", "published")
        .gt("published_at", range.from).lte("published_at", range.to).order("published_at"),
      db.from("articles").select(cols).in("status", ["draft", "pending"]).order("updated_at", { ascending: false }).limit(200),
    ]);
    if (scheduled.error) return json(500, { error: scheduled.error.message });
    if (waiting.error) return json(500, { error: waiting.error.message });

    const items = [...(scheduled.data ?? []), ...(waiting.data ?? [])].map((a) => ({
      ...a,
      state: displayStatus(a.status, a.published_at, now),
    }));
    return json(200, { from: range.from, to: range.to, items });
  }

  if (req.method === "DELETE") {
    const externalId = url.searchParams.get("external_id");
    if (!externalId) return json(400, { error: "external_id required" });
    // CMS 에서 직접 쓴 글은 외부 API 로 지울 수 없다.
    const { data, error } = await db.from("articles").delete().eq("external_id", externalId).eq("origin", "api").select("id");
    if (error) return json(500, { error: error.message });
    return data && data.length ? json(200, { deleted: true }) : json(404, { error: "not found" });
  }

  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  let p: Record<string, unknown>;
  try {
    p = await req.json();
  } catch {
    return json(400, { error: "invalid json" });
  }

  const built = buildRow(p, now);
  if (built.error || !built.row) return json(400, { error: built.error });
  const row = built.row;

  const existing = await db.from("articles").select("id, updated_by, origin").eq("external_id", row.external_id).maybeSingle();
  if (existing.error) return json(500, { error: existing.error.message });
  if (editedInCms(existing.data)) {
    return json(409, { error: "edited in CMS — not overwritten", id: existing.data!.id, url: articleUrl(SITE_URL, existing.data!.id) });
  }

  // 새로 들어온 글: 설정의 기본 담당자(에디터)가 있으면 그 사람 글로 둔다. 없으면 어드민만 관리.
  if (!existing.data) {
    const owner = await defaultOwner();
    if (owner) row.author_id = owner;
  }

  const { data, error } = await db
    .from("articles")
    .upsert(row, { onConflict: "external_id" })
    .select("id, status, published_at")
    .single();
  if (error) return json(500, { error: error.message });

  return json(200, {
    id: data.id,
    url: articleUrl(SITE_URL, data.id),
    status: displayStatus(data.status, data.published_at, now),
    published_at: data.published_at,
  });
});
