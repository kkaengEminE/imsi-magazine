// imsi magazine — External Publish API v1 수신 함수 (docs/PUBLISH_API.md)
// Supabase 대시보드 > Edge Functions > Deploy a new function > 이름 "publish" 로 붙여넣기.
// Secrets 에 PUBLISH_API_KEY 등록. JWT 검증(Verify JWT)은 끈다 — 자체 키로 인증.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SITE_URL = Deno.env.get("SITE_URL") ?? "https://kkaengemine.github.io/imsi-magazine/";
const API_KEY = Deno.env.get("PUBLISH_API_KEY") ?? "";
const CATEGORIES = ["music", "live", "screen", "anime", "korea"];

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

// 본문 정화 — 스크립트·스타일·iframe·이벤트 속성·javascript: 링크 제거.
function sanitize(html: string): string {
  return html
    .replace(/<(script|style|iframe|object|embed|form)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|style|iframe|object|embed|form|link|meta)\b[^>]*\/?>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');
}

function articleUrl(id: string) {
  return `${SITE_URL.replace(/\/?$/, "/")}#/a/${id}`;
}

Deno.serve(async (req) => {
  if (!API_KEY) return json(500, { error: "PUBLISH_API_KEY not configured" });
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${API_KEY}`) return json(401, { error: "invalid api key" });

  if (req.method === "DELETE") {
    const externalId = new URL(req.url).searchParams.get("external_id");
    if (!externalId) return json(400, { error: "external_id required" });
    const { data, error } = await db.from("articles").delete().eq("external_id", externalId).select("id");
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

  const str = (k: string) => (typeof p[k] === "string" && (p[k] as string).trim() !== "" ? (p[k] as string).trim() : null);
  const externalId = str("external_id");
  const title = str("title");
  const body = str("body_html");
  if (!externalId || !title || !body) {
    return json(400, { error: "external_id, title, body_html are required" });
  }

  const status = p.status === "draft" ? "draft" : "published";
  const category = str("category");
  const tags = Array.isArray(p.tags) ? (p.tags as unknown[]).filter((t) => typeof t === "string" && t.trim()).map((t) => (t as string).trim()).slice(0, 20) : [];
  const source = (p.source ?? {}) as Record<string, unknown>;
  const publishedAt = str("published_at");

  const row = {
    external_id: externalId,
    status,
    language: str("language") ?? "ko",
    title,
    title_en: str("title_en"),
    summary: str("summary"),
    body_html: sanitize(body),
    body_html_en: str("body_html_en") ? sanitize(str("body_html_en")!) : null,
    thumbnail_url: str("thumbnail_url"),
    thumbnail_alt: str("thumbnail_alt"),
    category: category && CATEGORIES.includes(category) ? category : null,
    tags,
    source_name: typeof source.name === "string" ? source.name : null,
    source_url: typeof source.url === "string" ? source.url : null,
    published_at: publishedAt && !isNaN(Date.parse(publishedAt)) ? publishedAt : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await db
    .from("articles")
    .upsert(row, { onConflict: "external_id" })
    .select("id, status")
    .single();
  if (error) return json(500, { error: error.message });

  return json(200, { id: data.id, url: articleUrl(data.id), status: data.status });
});
