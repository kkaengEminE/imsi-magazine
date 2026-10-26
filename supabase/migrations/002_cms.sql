-- imsi magazine — CMS 변경 (002)
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전.
-- 지금 사이트·받는 함수와 호환된다(기존 기사는 그대로 공개). 사이트·함수 수정본보다 먼저 실행한다.

begin;

-- 1) 상태에 보류(pending) 추가: draft(초안) / published(발행, 시각이 미래면 예약) / pending(보류)
alter table public.articles drop constraint if exists articles_status_check;
alter table public.articles
  add constraint articles_status_check check (status in ('draft', 'published', 'pending'));

-- 2) 칸 추가: 기자명, 편집 메모, 마지막 수정자
alter table public.articles add column if not exists display_name text;
alter table public.articles add column if not exists editor_note  text;
alter table public.articles add column if not exists updated_by   uuid references auth.users (id) on delete set null;

create index if not exists articles_status_published_at_idx on public.articles (status, published_at);

-- 3) 고칠 때마다 updated_at 자동 갱신
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists articles_touch_updated_at on public.articles;
create trigger articles_touch_updated_at
  before update on public.articles
  for each row execute function public.touch_updated_at();

-- 4) 편집자 목록: 여기 등록된 로그인 계정만 CMS 에서 초안·예약·보류를 보고 고칠 수 있다
create table if not exists public.editors (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now()
);
alter table public.editors enable row level security;

create or replace function public.is_editor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.editors where user_id = auth.uid());
$$;
revoke all on function public.is_editor() from public;
grant execute on function public.is_editor() to anon, authenticated;

drop policy if exists "editors read self" on public.editors;
create policy "editors read self" on public.editors
  for select to authenticated
  using (user_id = auth.uid());

-- 5) 공개 조건: 발행 상태이고 발행 시각이 지난 기사만 (예약 기사는 시간이 되면 자동 공개)
drop policy if exists "public read published" on public.articles;
create policy "public read published" on public.articles
  for select to anon, authenticated
  using (status = 'published' and published_at <= now());

-- 6) 편집자 권한: 전체 읽기·쓰기 (받는 함수는 service role 이라 이 정책과 무관)
drop policy if exists "editors read all" on public.articles;
create policy "editors read all" on public.articles
  for select to authenticated
  using (public.is_editor());

drop policy if exists "editors insert" on public.articles;
create policy "editors insert" on public.articles
  for insert to authenticated
  with check (public.is_editor());

drop policy if exists "editors update" on public.articles;
create policy "editors update" on public.articles
  for update to authenticated
  using (public.is_editor())
  with check (public.is_editor());

drop policy if exists "editors delete" on public.articles;
create policy "editors delete" on public.articles
  for delete to authenticated
  using (public.is_editor());

commit;

-- ─────────────────────────────────────────────────────────────
-- 편집자 등록 (Authentication > Users 에서 계정을 만든 뒤, 이메일을 바꿔서 따로 실행)
--
-- insert into public.editors (user_id, display_name)
-- select id, '표시할 이름' from auth.users where email = '편집자@이메일'
-- on conflict (user_id) do update set display_name = excluded.display_name;
