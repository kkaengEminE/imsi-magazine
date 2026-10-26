-- imsi magazine — Supabase 스키마 (처음 만들 때: 이 파일 → migrations/002_cms.sql 순서로 실행)
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 Run.

create table if not exists public.articles (
  id            uuid primary key default gen_random_uuid(),
  external_id   text not null unique,
  status        text not null default 'published' check (status in ('draft', 'published', 'pending')),
  language      text not null default 'ko',
  title         text not null,
  title_en      text,
  summary       text,
  body_html     text not null,
  body_html_en  text,
  thumbnail_url text,
  thumbnail_alt text,
  category      text,
  tags          text[] not null default '{}',
  source_name   text,
  source_url    text,
  display_name  text,
  editor_note   text,
  updated_by    uuid references auth.users (id) on delete set null,
  published_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists articles_published_at_idx on public.articles (published_at desc);
create index if not exists articles_category_idx on public.articles (category);
create index if not exists articles_tags_idx on public.articles using gin (tags);

-- 사이트(anon 키)는 공개 기사 읽기만. 쓰기는 Edge Function(service role)만.
alter table public.articles enable row level security;

drop policy if exists "public read published" on public.articles;
create policy "public read published" on public.articles
  for select to anon, authenticated
  using (status = 'published' and published_at <= now());

-- CMS(편집자 표, 편집자 권한, updated_at 트리거)는 migrations/002_cms.sql 참고.
