# imsi magazine

Hydra 뉴스룸 발행 테스트용 임시 매거진. 정적 사이트(GitHub Pages) + Supabase(저장·수신 API).

- 사이트: `index.html`, `assets/` — 빌드 없이 그대로 배포
- 연결 설정: `config.js` (Supabase URL·anon key, 비우면 샘플 기사 데모 모드)
- DB 스키마: `supabase/schema.sql`
- 기사 수신 API: `supabase/functions/publish/index.ts`
- 발행 API 규격: [`docs/PUBLISH_API.md`](docs/PUBLISH_API.md)

로컬 확인: `python3 -m http.server 8765` 후 http://127.0.0.1:8765

## CMS

- 화면: `admin.html` (https://kkaengemine.github.io/imsi-magazine/admin.html)
- 용어·권한(어드민·에디터)·화면·처음 설정 순서: [`docs/CMS.md`](docs/CMS.md)
- 상태: 초안 / 예약 / 발행 / 비공개 / 삭제. 직접 쓴 글과 외부 API 글이 같은 기사함에 쌓인다.

### 테스트

```bash
node --test --experimental-strip-types tests/publish_logic.test.ts tests/admin_users_logic.test.ts
```
