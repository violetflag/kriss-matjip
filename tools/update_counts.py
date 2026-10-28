"""data.json의 방문 집계(n, last, m)를 Supabase visits 테이블 기준으로 다시 맞춘다.

1. Supabase SQL 편집기에서 아래 쿼리를 실행하고 결과(JSON 한 칸)를 counts.json으로 저장
     select json_object_agg(place_id, j)::text from (
       select place_id, json_build_object('n', count(*), 'last', max(d),
              'm', (select json_object_agg(ym, c) from (select to_char(d, 'YYMM') ym, count(*) c
                    from visits v2 where v2.place_id = v.place_id group by 1) x)) j
       from visits v group by place_id) t;
2. python3 tools/update_counts.py counts.json
3. index.html의 APP_VER를 올리고 커밋
새 회의비 내역을 넣을 때는 visits에 행을 추가하고 새 업체는 data.json places에 추가한 뒤 이 스크립트를 돌린다.
"""
import json, sys, datetime

counts = json.load(open(sys.argv[1], encoding="utf-8"))
if isinstance(counts, str):
    counts = json.loads(counts)
d = json.load(open("data.json", encoding="utf-8"))
for p in d["places"]:
    c = counts.get(str(p["id"]), {"n": 0, "last": "", "m": {}})
    p["n"], p["last"], p["m"] = c["n"], c["last"], dict(sorted((c["m"] or {}).items()))
d["places"].sort(key=lambda p: -p["n"])
alld = [k for p in d["places"] for k in p["m"]]
d["meta"].update(built=datetime.date.today().isoformat(), places=len(d["places"]),
                 visits=sum(p["n"] for p in d["places"]),
                 to=max((p["last"] for p in d["places"] if p["last"]), default=d["meta"]["to"]))
json.dump(d, open("data.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("updated", len(d["places"]), "places,", d["meta"]["visits"], "visits")
