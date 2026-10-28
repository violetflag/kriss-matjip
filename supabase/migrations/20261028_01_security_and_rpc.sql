-- 2026-10-28 보안 강화 + 집계 함수 (기존 앱과 호환되는 추가 변경)
create extension if not exists pgcrypto with schema extensions;

-- 1) 권한 판별 함수를 API에 노출되지 않는 private 스키마로 옮긴다
create schema if not exists private;
grant usage on schema private to anon, authenticated;

alter table public.profiles add column if not exists rejected boolean not null default false;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((auth.jwt() ->> 'email') = 'admin@kriss-matjip.local', false)
$$;
create or replace function private.is_approved() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles
                 where id = (select auth.uid()) and approved and not banned and not rejected)
$$;
revoke all on function private.is_admin(), private.is_approved() from public;
grant execute on function private.is_admin(), private.is_approved() to anon, authenticated;

-- 2) RLS 정책 재작성: (select auth.uid()) 사용, 명령별 정책 1개씩
drop policy if exists "profiles read" on public.profiles;
drop policy if exists "profiles self insert" on public.profiles;
drop policy if exists "profiles admin update" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));
create policy "profiles self insert" on public.profiles for insert to authenticated
  with check (id = (select auth.uid()) and approved = false and banned = false and rejected = false);
create policy "profiles admin update" on public.profiles for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

drop policy if exists "fav self" on public.favorites;
drop policy if exists "fav admin read" on public.favorites;
drop policy if exists "fav admin delete" on public.favorites;
create policy "fav read" on public.favorites for select to authenticated
  using ((user_id = (select auth.uid()) and (select private.is_approved())) or (select private.is_admin()));
create policy "fav insert" on public.favorites for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_approved()));
create policy "fav delete" on public.favorites for delete to authenticated
  using ((user_id = (select auth.uid()) and (select private.is_approved())) or (select private.is_admin()));

drop policy if exists "settings admin insert" on public.settings;
drop policy if exists "settings admin update" on public.settings;
-- "settings read" / "visits approved read" 는 새 앱 배포 뒤 02 마이그레이션에서 제거

-- 3) 가입 트리거: 관리자 판별을 이메일 기준으로, 직접 호출 불가
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare uname text;
begin
  uname := coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1));
  insert into public.profiles(id, username, approved)
  values (new.id, uname, new.email = 'admin@kriss-matjip.local')
  on conflict (id) do nothing;
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- 4) 접속 비밀번호: bcrypt 해시, 서버에서만 비교
-- gate_bcrypt가 아직 없으면 예전 SHA-256 값(gate_hash)과 비교한다
create or replace function public.check_gate(pw text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when exists (select 1 from public.settings where key = 'gate_bcrypt')
    then exists (select 1 from public.settings
                 where key = 'gate_bcrypt' and value = extensions.crypt(coalesce(pw, ''), value))
    else exists (select 1 from public.settings
                 where key = 'gate_hash' and value = encode(extensions.digest(coalesce(pw, ''), 'sha256'), 'hex'))
  end
$$;
create or replace function public.set_gate_password(pw text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'admin only'; end if;
  if length(coalesce(pw, '')) < 6 then raise exception 'password too short'; end if;
  insert into public.settings(key, value) values ('gate_bcrypt', extensions.crypt(pw, extensions.gen_salt('bf')))
  on conflict (key) do update set value = excluded.value;
end $$;

-- 5) 방문 기록 집계 함수 (승인 회원만)
create or replace function private.require_member() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_approved() or private.is_admin()) then raise exception 'not approved'; end if;
end $$;
revoke all on function private.require_member() from public;
grant execute on function private.require_member() to authenticated;

-- 소속·이름 자동완성 목록 (이름, 방문 횟수)
create or replace function public.visit_names(kind text) returns table(name text, n int)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_member();
  if kind = 'group' then
    return query select v.grp, count(*)::int from public.visits v where v.grp <> '' group by v.grp order by 2 desc, 1;
  else
    return query select x.nm, count(*)::int from public.visits v, jsonb_array_elements_text(v.people) x(nm)
                 group by x.nm order by 2 desc, 1;
  end if;
end $$;

-- 소속/이름으로 방문한 식당별·월별 횟수
create or replace function public.match_visits(kind text, q text, exact boolean) returns table(place_id int, ym text, n int)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_member();
  if coalesce(q, '') = '' then return; end if;
  return query
    select v.place_id, to_char(v.d, 'YYYY-MM'), count(*)::int from public.visits v
    where case when kind = 'group' then (case when exact then v.grp = q else strpos(v.grp, q) > 0 end)
               else (case when exact then v.people ? q
                          else exists (select 1 from jsonb_array_elements_text(v.people) x(nm) where strpos(x.nm, q) > 0) end) end
    group by 1, 2;
end $$;

-- 한 식당의 방문 기록 (상세 패널용)
create or replace function public.place_visits(pid int) returns table(d date, grp text, people jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_member();
  return query select v.d, v.grp, v.people from public.visits v where v.place_id = pid order by v.d desc;
end $$;

revoke all on function public.check_gate(text), public.set_gate_password(text), public.visit_names(text),
  public.match_visits(text, text, boolean), public.place_visits(int) from public;
grant execute on function public.check_gate(text) to anon, authenticated;
grant execute on function public.set_gate_password(text), public.visit_names(text),
  public.match_visits(text, text, boolean), public.place_visits(int) to authenticated;

-- 5-1) 관리자가 바로잡은 업체 위치 (앱이 data.json 위에 덮어씀)
create table if not exists public.place_fixes (
  place_id int primary key,
  name text not null, addr text not null, lat double precision not null, lng double precision not null,
  cat text, sub text, merge_into int, note text,
  updated_at timestamptz not null default now()
);
alter table public.place_fixes enable row level security;
drop policy if exists "fixes read" on public.place_fixes;
drop policy if exists "fixes admin insert" on public.place_fixes;
drop policy if exists "fixes admin update" on public.place_fixes;
drop policy if exists "fixes admin delete" on public.place_fixes;
create policy "fixes read" on public.place_fixes for select to anon, authenticated using (true);
create policy "fixes admin insert" on public.place_fixes for insert to authenticated with check ((select private.is_admin()));
create policy "fixes admin update" on public.place_fixes for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "fixes admin delete" on public.place_fixes for delete to authenticated using ((select private.is_admin()));

-- 6) 쓰지 않는 테이블 권한 회수 (TRUNCATE 등)
revoke all on public.profiles, public.favorites, public.settings, public.visits from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, delete on public.favorites to authenticated;
revoke all on public.place_fixes from anon, authenticated;
grant select on public.place_fixes to anon, authenticated;
grant insert, update, delete on public.place_fixes to authenticated;
-- 기존 앱 호환용 임시 권한 (02에서 회수)
grant select on public.settings to anon, authenticated;
grant select on public.visits to authenticated;

-- 7) 테스트 계정 정지 (관리자 화면에서 복구 가능)
update public.profiles set banned = true where username = 'test';

select '완료' as result;
