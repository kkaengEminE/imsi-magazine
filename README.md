# imsi magazine

Hydra 뉴스룸 발행 테스트용 임시 매거진. 정적 사이트(GitHub Pages) + Supabase(저장·수신 API).

- 사이트: `index.html`, `assets/` — 빌드 없이 그대로 배포
- 연결 설정: `config.js` (Supabase URL·anon key, 비우면 샘플 기사 데모 모드)
- DB 스키마: `supabase/schema.sql`
- 기사 수신 API: `supabase/functions/publish/index.ts`
- 발행 API 규격: [`docs/PUBLISH_API.md`](docs/PUBLISH_API.md)

로컬 확인: `python3 -m http.server 8765` 후 http://127.0.0.1:8765

## CMS (초안·예약·발행·보류)

- 화면: `admin.html` (예: https://kkaengemine.github.io/imsi-magazine/admin.html)
- 상태: `draft` 초안 / `published` 발행 (발행 시각이 미래면 **예약** — 그 시각이 되면 사이트에 자동 공개) / `pending` 보류
- 시간대 캘린더: 오늘·내일 08:00~23:30, 정각·30분 슬롯
- 편집자가 CMS 에서 고친 기사는 보내는 쪽(Hydra·Nessus)이 다시 보내도 덮어쓰지 않는다(`409`).

### 처음 설정

1. Supabase SQL Editor 에서 `supabase/migrations/002_cms.sql` 실행
2. Authentication > Users 에서 편집자 계정 생성
3. 파일 맨 아래 주석의 편집자 등록 SQL 실행 (이메일·표시 이름 바꿔서)
4. 받는 함수 수정본 배포: Edge Functions > `publish` 에 `index.ts`, `logic.ts` 두 파일
   (또는 CLI `supabase functions deploy publish --no-verify-jwt`)

### 테스트

```bash
node --test --experimental-strip-types tests/publish_logic.test.ts
```
