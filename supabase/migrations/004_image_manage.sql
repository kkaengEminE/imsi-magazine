-- imsi magazine — 이미지 지우기 보완 (004). 003 다음에 실행. 여러 번 실행해도 안전.
-- Storage 에서 파일을 지우려면 그 파일을 '찾을' 권한(select)도 있어야 한다. 003 에는 지우기 권한만 있어서
-- CMS 계정이 올린 이미지를 지우지 못했다. 사용 중인 계정에게 이 저장소의 파일 목록 보기 권한을 준다.
-- (이미지는 원래 공개 주소로 누구나 볼 수 있어서, 목록 보기를 열어도 새로 드러나는 것은 없다.)

drop policy if exists "article images read" on storage.objects;
create policy "article images read" on storage.objects
  for select to authenticated
  using (bucket_id = 'article-images' and public.is_editor());
