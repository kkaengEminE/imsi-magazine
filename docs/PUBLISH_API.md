# External Publish API — v1.1

> v1.1 추가 사항(v1과 호환): `status` 에 `pending`, `display_name`(기자명), 미래 `published_at` = 예약,
> 예약·초안 목록 조회(`GET ?list=queue`), CMS 에서 고친 기사 보호(`409`).

Hydra 의 **외부 API 발행 채널**이 기사를 보내는 규격입니다. 이 규격대로 받는 엔드포인트를 만들면
어떤 사이트든 Hydra 에서 기사를 받아 게시할 수 있습니다. imsi magazine 은 이 규격의 참조 구현입니다
(`supabase/functions/publish`).

## 인증

모든 요청은 HTTPS 로 보내며 헤더에 발행 키를 담습니다. 발행 키는 받는 쪽이 정해서 Hydra 캠페인
설정에 입력합니다.

```
Authorization: Bearer <PUBLISH_API_KEY>
Content-Type: application/json
```

키가 틀리면 `401` 을 돌려줍니다.

## 1. 기사 생성·갱신 — `POST {endpoint}`

`external_id` 가 같은 기사가 이미 있으면 **갱신**합니다(멱등). Hydra 가 네트워크 오류로 같은 기사를 다시
보내도 중복 게시되지 않게 하기 위한 규칙입니다.

```json
{
  "external_id": "hydra-story-uuid",
  "status": "published",
  "language": "ko",
  "title": "기사 제목",
  "title_en": "Optional English title",
  "summary": "한두 문장 요약",
  "body_html": "<p>본문 HTML</p>",
  "body_html_en": "<p>Optional English body</p>",
  "thumbnail_url": "https://...jpg",
  "thumbnail_alt": "이미지 설명",
  "category": "music",
  "tags": ["BE:FIRST", "Live", "Japan"],
  "source": { "name": "音楽ナタリー", "url": "https://natalie.mu/music/news/..." },
  "published_at": "2026-10-15T09:00:00Z"
}
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `external_id` | ✓ | 보내는 쪽 기사 ID. 갱신·삭제의 기준 |
| `title` | ✓ | 제목 |
| `body_html` | ✓ | 본문 HTML. `<p> <h2> <h3> <blockquote> <ul> <ol> <li> <figure> <img> <figcaption> <a> <strong> <em> <br>` 만 쓰는 것을 권장 |
| `status` |  | `published`(기본), `draft`(저장만, 비공개), `pending`(보류, 비공개) |
| `display_name` |  | 기자명 |
| `language` |  | 본문 언어. ISO 639-1 (`ko`, `en`, `ja`) |
| `title_en`, `body_html_en` |  | 영문판이 있을 때 |
| `summary` |  | 목록·공유용 요약 |
| `thumbnail_url`, `thumbnail_alt` |  | 대표 이미지 |
| `category` |  | 받는 쪽 카테고리 키. 모르면 생략 — 받는 쪽이 태그로 분류 |
| `tags` |  | 문자열 배열. 관련 기사 연결에 사용 |
| `source` |  | 원문 출처 `{name, url}` |
| `published_at` |  | ISO 8601. 생략하면 받은 시각. **미래 시각이면 예약** — 그 시각이 되면 사이트에 공개 |

### 응답 `200` / `201`

```json
{ "id": "받는 쪽 기사 ID", "url": "https://공개 주소", "status": "scheduled", "published_at": "2026-10-24T00:00:00Z" }
```

`status` 는 `published` / `scheduled`(예약) / `draft` / `pending`.

CMS 에서 편집자가 고친 기사는 다시 보내도 덮어쓰지 않고 `409` 를 돌려준다.

Hydra 는 `id` 와 `url` 을 저장해 두고 발행 이력에 링크로 보여줍니다.

## 2. 예약·초안 목록 — `GET {endpoint}?list=queue&from=<ISO>&to=<ISO>`

`from`~`to` 사이 예약 기사(기본: 지금부터 3일)와 초안·보류 기사(최근 200건)를 돌려준다. 보내는 쪽이
빈 시간대를 고를 때 쓴다.

```json
{ "from": "...", "to": "...", "items": [
  { "id": "...", "external_id": "...", "title": "...", "status": "published", "state": "scheduled",
    "published_at": "2026-10-24T00:00:00Z", "display_name": "TelloWoo" }
] }
```

## 3. 기사 삭제 — `DELETE {endpoint}?external_id=<id>`

응답 `200 {"deleted": true}`. 없는 기사면 `404`.

## 오류

| 코드 | 의미 | Hydra 동작 |
|---|---|---|
| `400` | 필수 필드 누락·형식 오류 (`{"error": "..."}`) | 재시도하지 않고 실패 표시 |
| `401` | 키 오류 | 재시도하지 않음 |
| `409` | 받는 쪽에서 거부(중복 제목, CMS 에서 고친 기사 등) | 재시도하지 않음 |
| `5xx`, 타임아웃 | 일시 오류 | 같은 `external_id` 로 재시도 (멱등이라 안전) |

## 받는 쪽 구현 체크리스트

1. `Authorization` 키 확인
2. `external_id` 기준 upsert (생성/갱신)
3. `body_html` 은 받은 쪽에서 한 번 더 정화(sanitize)해서 저장 — 스크립트 태그·이벤트 속성 제거
4. 응답에 공개 주소(`url`) 포함
