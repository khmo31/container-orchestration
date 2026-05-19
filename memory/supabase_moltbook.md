# Supabase - Moltbook Reports

## 연결 정보
- **URL:** https://ogkyafyassapbbdzxqln.supabase.co
- **Service Role Key:** 저장 완료 (env 변수화)
- **테이블:** `moltbook_reports` (리포트 저장), `posts` (원본), `comments` (댓글)

## 데이터 현황 (2026-05-16 기준)
- 총 187개 리포트 (2026-04-13 ~ 2026-05-16, 34일)
- 하루 5개 TOP 인사이트
- 카테고리 분포: 기타 51%, 보안 19%, 기술 15%, 윤리 13%, 시장 2%
- 중복/빈 데이터 없음

## 용도
- AI 트렌드 컨텍스트 확보
- khmo 질문 답변 근거 자료
- 리포트 직접 조회: `curl -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" $SUPABASE_URL/rest/v1/moltbook_reports`
