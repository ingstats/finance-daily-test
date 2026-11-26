---
name: daily-design
description: 팀 데일리 뉴스의 기획 대화 — 독자·섹션·키워드·제외 대상·시사점 관점·지표를 묻고 newsletter.yaml·editorial.md·indicators.json을 만들거나, "○○ 기사는 줄이고 ○○를 늘려 줘"처럼 소식 구성을 바꿀 때 쓴다.
---

# 기획 대화 → 설정 파일

## 1. 프리셋 고르기
교육생 팀에 맞는 `presets/<팀>.md`를 연다(기획팀·재무팀·사업팀·영업팀). 없으면 가장 가까운 것.

## 2. 질문 (한 번에 하나씩, 최대 6개. 프리셋 값을 '예시'로 보여 주고 고르게 한다)
1. 누가 읽나요? (독자)
2. 매일 보고 싶은 소식 2~4가지는? → 섹션
3. 섹션마다 꼭 들어가야 할 회사·제도·단어는? → 검색 키워드
4. 빼고 싶은 기사는? (하나캐피탈 자사 기사 포함 여부를 꼭 묻는다) → 제외
5. 시사점은 어떤 관점으로? (예: 우리 팀 업무 관점)
6. 매일 보고 싶은 숫자 3~6개는? → daily-market 스킬로 원천 확인

## 3. 파일 만들기 (작업 폴더 `/home/claude/daily/`, 템플릿 저장소 파일을 복사해서 시작)
- `newsletter.yaml`: id(영문 소문자, 예 `finance-daily`), name(예 `재무팀 데일리`), cover_word, description, team(`하나캐피탈 ○○팀`), news_title, owner_email, guardrails.exclude_terms.
  site_url·github_repo·kakao_api는 해당 단계에서 채운다.
- `editorial.md`: 템플릿의 1~2절만 채운다(3~5절 공통 규칙은 그대로). 섹션 id는 영문 소문자(`funding`, `rates` 등).
- `indicators.json`: daily-market 스킬로 확인한 지표만 넣는다.

## 4. 보여 주고 확인
섹션 표와 지표 목록을 짧게 보여 주고 "이대로 갈까요?"를 묻는다. 고칠 점을 반영한 뒤 다음 단계로.

## 소식 구성 바꾸기 (P4, 교육 이후)
1. 사이트 저장소를 받아(`git clone --depth 1 https://github.com/<github_repo>`) 최근 3개 호와 editorial.md를 읽는다.
2. 요청을 키워드·섹션·기사 수·제외 규칙 변경안으로 바꿔 **먼저 보여 주고** 승인을 받는다.
3. 승인되면 editorial.md(필요하면 newsletter.yaml)를 고쳐 `python3 kit/scripts/bundle.py <오늘> editorial.md --message "편집 지침 변경"` → Gmail 초안 `[<ID>-SITE] <오늘> 대기`로 올린다(daily-run 8단계와 같음). 다음 날 아침부터 반영.
