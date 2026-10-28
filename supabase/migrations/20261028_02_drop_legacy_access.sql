-- 새 앱 배포 뒤: 방문 기록·설정 테이블 직접 조회를 막고 옛 함수 제거
drop policy if exists "settings read" on public.settings;
drop policy if exists "visits approved read" on public.visits;
revoke all on public.settings, public.visits from anon, authenticated;
delete from public.settings where key = 'gate_hash';
drop function if exists public.is_admin();
drop function if exists public.is_approved();
