// imsi magazine — 받는 함수의 순수 로직 (index.ts 가 사용). Node/Deno 어디서나 테스트할 수 있게 분리.

export const CATEGORIES = ["music", "live", "screen", "anime", "korea"];
export const STATUSES = ["draft", "published", "pending"];

// 본문 정화 — 스크립트·스타일·iframe·이벤트 속성·javascript: 링크 제거.
export function sanitize(html: string): string {
  return html
    .replace(/<(script|style|iframe|object|embed|form)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|style|iframe|object|embed|form|link|meta)\b[^>]*\/?>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');
}

export function articleUrl(siteUrl: string, id: string) {
  return `${siteUrl.replace(/\/?$/, "/")}#/a/${id}`;
}

// 화면·응답용 상태: 발행인데 시각이 미래면 "scheduled"(예약).
export function displayStatus(status: string, publishedAt: string, now: Date): string {
  if (status === "published" && Date.parse(publishedAt) > now.getTime()) return "scheduled";
  return status;
}

type Payload = Record<string, unknown>;

// 요청 본문(External Publish API v1.1) → articles 행. 문제가 있으면 { error }.
export function buildRow(p: Payload, now: Date): { row?: Record<string, unknown>; error?: string } {
  const str = (k: string) =>
    typeof p[k] === "string" && (p[k] as string).trim() !== "" ? (p[k] as string).trim() : null;

  const externalId = str("external_id");
  const title = str("title");
  const body = str("body_html");
  if (!externalId || !title || !body) return { error: "external_id, title, body_html are required" };

  const status = STATUSES.includes(p.status as string) ? (p.status as string) : "published";
  const category = str("category");
  const tags = Array.isArray(p.tags)
    ? (p.tags as unknown[]).filter((t) => typeof t === "string" && t.trim()).map((t) => (t as string).trim()).slice(0, 20)
    : [];
  const source = (p.source ?? {}) as Record<string, unknown>;
  const publishedAt = str("published_at");
  if (publishedAt && isNaN(Date.parse(publishedAt))) return { error: "published_at must be ISO 8601" };

  return {
    row: {
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
      display_name: str("display_name"),
      published_at: publishedAt ?? now.toISOString(),
      updated_at: now.toISOString(),
    },
  };
}

// CMS 에서 편집자가 고친 기사는 보내는 쪽이 다시 보내도 덮어쓰지 않는다.
export function editedInCms(existing: { updated_by?: string | null } | null): boolean {
  return !!(existing && existing.updated_by);
}

// 예약·초안 목록 조회 범위 (기본: 지금부터 3일)
export function queueRange(params: URLSearchParams, now: Date): { from: string; to: string } | { error: string } {
  const from = params.get("from") ?? now.toISOString();
  const to = params.get("to") ?? new Date(now.getTime() + 3 * 86400_000).toISOString();
  if (isNaN(Date.parse(from)) || isNaN(Date.parse(to))) return { error: "from/to must be ISO 8601" };
  return { from, to };
}
