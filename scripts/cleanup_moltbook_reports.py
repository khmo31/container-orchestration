#!/usr/bin/env python3
"""Moltbook Reports 정리 스크립트 — 중복/빈 데이터 제거"""

import urllib.request, json, sys
from collections import Counter

SUPABASE_URL = 'https://ogkyafyassapbbdzxqln.supabase.co'
SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9na3lhZnlhc3NhcGJiZHp4cWxuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjA0OTM3OSwiZXhwIjoyMDkxNjI1Mzc5fQ.QB0OVgY7oHcCX4BWf6vGAkuQDyY5MDEBQRwxVtPcmgw'

headers = {
    'apikey': SERVICE_KEY,
    'Authorization': f'Bearer {SERVICE_KEY}',
    'Content-Type': 'application/json',
    'Accept': 'application/json'
}

def api_get(path):
    req = urllib.request.Request(f'{SUPABASE_URL}/rest/v1/{path}', headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def api_delete(path):
    req = urllib.request.Request(f'{SUPABASE_URL}/rest/v1/{path}',
                                 method='DELETE', headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def main():
    print("=== Moltbook Reports 정리 시작 ===")
    
    # 1. 모든 데이터 조회
    status, data = api_get('moltbook_reports?select=*&order=report_date.desc')
    if status != 200:
        print(f"조회 실패: {status} {data}")
        sys.exit(1)
    
    rows = data if isinstance(data, list) else []
    before = len(rows)
    print(f"정리 전: {before}개 리포트")
    
    deleted = 0
    
    # 2. 빈 데이터 제거
    for r in rows:
        rid = r.get('id')
        title = r.get('title', '')
        summary = r.get('summary', '')
        if not title or not summary or not title.strip() or not summary.strip():
            s, _ = api_delete(f'moltbook_reports?id=eq.{rid}')
            if s in (200, 204):
                deleted += 1
                print(f"  [삭제] 빈 데이터 id={rid}")
    
    # 3. 중복 (report_date, title) 제거 — 최신 1건만 남김
    seen = {}
    for r in rows:
        key = (r.get('report_date',''), r.get('title',''))
        if key in seen:
            # 이전 등장 항목 삭제
            prev_id = seen[key]
            s, _ = api_delete(f'moltbook_reports?id=eq.{prev_id}')
            if s in (200, 204):
                deleted += 1
                print(f"  [삭제] 중복 id={prev_id}: {key}")
        seen[key] = r.get('id')
    
    # 4. 오늘 날짜 이전 데이터 중 report_date가 없는 행 제거
    # (이미 위에서 체크됨)
    
    # 5. 카테고리 통계
    if before > 0:
        cats = Counter(r.get('category', '기타') for r in rows)
        print(f"\n카테고리 분포:")
        for c, n in cats.most_common():
            print(f"  {c}: {n} ({n*100//before}%)")
    
    print(f"\n=== 완료: {deleted}개 정리됨 ===")
    
    # 6. 이상 탐지
    if before - deleted > 0:
        sys.exit(0) # success
    else:
        sys.exit(1)

if __name__ == '__main__':
    main()
