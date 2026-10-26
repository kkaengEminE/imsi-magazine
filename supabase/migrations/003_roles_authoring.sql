-- imsi magazine — CMS 정상화 (003): 역할(어드민·에디터), 직접 작성, 이미지, 작업 기록, 설정
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전.
-- 먼저 002_cms.sql 이 실행돼 있어야 한다. 전체가 begin … commit 이라 중간에 실패하면 아무것도 바뀌지 않는다.
--
-- 용어: 초안(draft) / 예약(published + 미래 시각) / 발행(published) / 비공개(pending) / 삭제
-- 역할: admin(어드민) = 모든 글·계정·설정, editor(에디터) = 자기 글만

begin;

-- ── 1) 계정: 역할·사용 여부·이메일 ──
alter table public.editors add column if not exists role   text not null default 'editor';
alter table public.editors add column if not exists active boolean not null default true;
alter table public.editors add column if not exists email  text;
alter table public.editors drop constraint if exists editors_role_check;
alter table public.editors add constraint editors_role_check check (role in ('admin', 'editor'));

update public.editors e set email = u.email from auth.users u where u.id = e.user_id and e.email is distinct from u.email;

-- 처음 역할: admin@im.si 는 어드민, 나머지는 에디터
update public.editors e set role = 'admin'
  from auth.users u where u.id = e.user_id and u.email = 'admin@im.si';

-- 사용 중인 계정(에디터·어드민)인지 / 어드민인지
create or replace function public.is_editor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.editors where user_id = auth.uid() and active);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.editors where user_id = auth.uid() and active and role = 'admin');
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- 계정 표: 본인과 어드민만 읽기. 이름(display_name)만 본인·어드민이 고칠 수 있다.
-- 계정 추가·역할·사용 중지·삭제는 계정 관리 함수(admin-users, 관리자 키)만 한다.
drop policy if exists "editors read self" on public.editors;
drop policy if exists "editors read" on public.editors;
create policy "editors read" on public.editors
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

revoke insert, update, delete on public.editors from anon, authenticated;
grant select on public.editors to authenticated;
grant update (display_name) on public.editors to authenticated;

drop policy if exists "editors update name" on public.editors;
create policy "editors update name" on public.editors
  for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- ── 2) 기사: 작성자·들어온 곳 ──
alter table public.articles add column if not exists author_id uuid;
alter table public.articles add column if not exists origin    text not null default 'api';
alter table public.articles drop constraint if exists articles_origin_check;
alter table public.articles add constraint articles_origin_check check (origin in ('cms', 'api'));
alter table public.articles drop constraint if exists articles_author_id_fkey;
alter table public.articles add constraint articles_author_id_fkey
  foreign key (author_id) references public.editors (user_id) on delete set null;
-- CMS 에서 직접 쓴 글은 외부 번호를 자동으로 붙인다 (외부 API 글과 겹치지 않게 cms- 로 시작)
alter table public.articles alter column external_id set default ('cms-' || gen_random_uuid()::text);

create index if not exists articles_author_idx on public.articles (author_id);
create index if not exists articles_updated_at_idx on public.articles (updated_at desc);

-- 기사 권한: 어드민은 전부, 에디터는 자기 글만 (작성자를 남으로 바꿀 수도 없다)
drop policy if exists "editors read all" on public.articles;
drop policy if exists "editors insert" on public.articles;
drop policy if exists "editors update" on public.articles;
drop policy if exists "editors delete" on public.articles;
drop policy if exists "cms read" on public.articles;
drop policy if exists "cms insert" on public.articles;
drop policy if exists "cms update" on public.articles;
drop policy if exists "cms delete" on public.articles;

create policy "cms read" on public.articles
  for select to authenticated
  using (public.is_admin() or (public.is_editor() and author_id = auth.uid()));

create policy "cms insert" on public.articles
  for insert to authenticated
  with check (public.is_admin() or (public.is_editor() and author_id = auth.uid() and origin = 'cms'));

create policy "cms update" on public.articles
  for update to authenticated
  using (public.is_admin() or (public.is_editor() and author_id = auth.uid()))
  with check (public.is_admin() or (public.is_editor() and author_id = auth.uid()));

create policy "cms delete" on public.articles
  for delete to authenticated
  using (public.is_admin() or (public.is_editor() and author_id = auth.uid()));

-- 발행 일정: 에디터도 남의 예약 시각은 알아야 겹치지 않게 잡는다. 제목은 자기 글·어드민만.
create or replace function public.taken_slots(from_at timestamptz, to_at timestamptz)
returns table (published_at timestamptz, article_id uuid, title text, mine boolean)
language sql stable security definer set search_path = public as $$
  select a.published_at,
         case when public.is_admin() or a.author_id = auth.uid() then a.id end,
         case when public.is_admin() or a.author_id = auth.uid() then a.title end,
         a.author_id = auth.uid()
  from public.articles a
  where public.is_editor()
    and a.status = 'published'
    and a.published_at >= from_at and a.published_at < to_at
  order by a.published_at;
$$;
revoke all on function public.taken_slots(timestamptz, timestamptz) from public;
grant execute on function public.taken_slots(timestamptz, timestamptz) to authenticated;

-- ── 3) 작업 기록: 누가 언제 무엇을 (글을 지워도 기록은 남는다) ──
create table if not exists public.article_events (
  id            bigint generated always as identity primary key,
  article_id    uuid,
  article_title text,
  actor_id      uuid,
  actor_name    text,
  action        text not null,
  from_state    text,
  to_state      text,
  at            timestamptz not null default now()
);
create index if not exists article_events_at_idx on public.article_events (at desc);
create index if not exists article_events_article_idx on public.article_events (article_id);
alter table public.article_events enable row level security;

drop policy if exists "events read admin" on public.article_events;
create policy "events read admin" on public.article_events
  for select to authenticated using (public.is_admin());
revoke insert, update, delete on public.article_events from anon, authenticated;

create or replace function public.article_state(s text, at timestamptz) returns text
language sql immutable as $$
  select case when s = 'published' and at > now() then 'scheduled' else s end;
$$;

create or replace function public.log_article_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_name  text;
  v_from  text;
  v_to    text;
  v_action text;
begin
  select coalesce(display_name, email) into v_name from public.editors where user_id = v_actor;
  -- 로그인 없이 바뀐 것: 받는 함수(외부 API) 또는 계정 관리 함수의 담당자 넘기기
  if v_actor is null then
    v_name := case when tg_op = 'UPDATE' and old.author_id is distinct from new.author_id
                   then '시스템(계정 정리)' else '외부 API' end;
  end if;

  if tg_op = 'INSERT' then
    v_to := public.article_state(new.status, new.published_at);
    v_action := case when new.origin = 'cms' then 'create' else 'receive' end;
    insert into public.article_events (article_id, article_title, actor_id, actor_name, action, to_state)
      values (new.id, new.title, v_actor, v_name, v_action, v_to);
    return new;
  elsif tg_op = 'UPDATE' then
    v_from := public.article_state(old.status, old.published_at);
    v_to   := public.article_state(new.status, new.published_at);
    v_action := case
      when old.author_id is distinct from new.author_id then 'reassign'
      when v_from is distinct from v_to or old.published_at is distinct from new.published_at then 'state'
      else 'edit' end;
    insert into public.article_events (article_id, article_title, actor_id, actor_name, action, from_state, to_state)
      values (new.id, new.title, v_actor, v_name, v_action, v_from, v_to);
    return new;
  else
    insert into public.article_events (article_id, article_title, actor_id, actor_name, action, from_state)
      values (old.id, old.title, v_actor, v_name, 'delete', public.article_state(old.status, old.published_at));
    return old;
  end if;
end;
$$;

drop trigger if exists articles_log_event on public.articles;
create trigger articles_log_event
  after insert or update or delete on public.articles
  for each row execute function public.log_article_event();

-- ── 4) 설정: 카테고리·발행 시간대·메인 고정 기사·외부 API 기본값 ──
-- 비밀값은 넣지 않는다(사이트가 공개로 읽는 표). 외부 API 키는 Supabase Secrets 에만 둔다.
create table if not exists public.site_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.site_settings enable row level security;

drop policy if exists "settings read" on public.site_settings;
create policy "settings read" on public.site_settings
  for select to anon, authenticated using (true);

drop policy if exists "settings write admin" on public.site_settings;
create policy "settings write admin" on public.site_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.site_settings (key, value) values
  ('categories', '[
     {"key":"music","ko":"음악","en":"Music"},
     {"key":"live","ko":"공연·투어","en":"Live & Tour"},
     {"key":"screen","ko":"영화·드라마","en":"Film & Drama"},
     {"key":"anime","ko":"애니·OST","en":"Anime & OST"},
     {"key":"korea","ko":"한국 연결","en":"Korea"}
   ]'),
  ('slots', '{"start":"08:00","end":"23:30","step_minutes":30}'),
  ('featured_article_id', 'null'),
  ('api', '{"default_owner_id":null}')
on conflict (key) do nothing;

-- ── 5) 이미지 저장소: 공개 읽기, 사용 중인 계정만 올리기, 자기 파일·어드민만 지우기 ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('article-images', 'article-images', true, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set public = true,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "article images upload" on storage.objects;
create policy "article images upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'article-images' and public.is_editor());

drop policy if exists "article images manage" on storage.objects;
create policy "article images manage" on storage.objects
  for delete to authenticated
  using (bucket_id = 'article-images' and (owner_id = auth.uid()::text or public.is_admin()));

commit;

-- 실행 후 확인:
--   select email, role, active, display_name from public.editors order by role, email;
--   select key, value from public.site_settings;
--   select id, public from storage.buckets where id = 'article-images';
