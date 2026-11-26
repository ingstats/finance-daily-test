# 하나캐피탈 팀 데일리 키트 (AX추진TFT)

Claude에게 "데일리 뉴스 사이트 만들어 줘"(프롬프트 카드 P1) 한 마디로 시작해, 팀 맞춤 뉴스 사이트(GitHub Pages)와
평일 08:00 카카오톡 '나와의 채팅' 배포까지 만드는 교육용 키트입니다. AX Daily Report(axdaily.site)를 일반화했습니다.

| 폴더 | 내용 |
|---|---|
| skills/ | Claude 스킬 8종 — daily-start(전체 진행), daily-design, daily-github, daily-kakao, daily-market, daily-run, daily-schedule, daily-extend(시연) |
| scripts/ | build.py(발행 검사), kakao.py(카톡 문구), bundle.py(사이트 반영 묶음) |
| apps-script/ | Code.gs(카톡 발송), Site.gs(GitHub 반영), Market.gs(지표 수집) — Apps Script 템플릿 프로젝트와 같은 코드 |
| prompts/ | 프롬프트 카드 P1~P7 |
| schema/ | 발행물 규격 v2 |

- 템플릿 저장소: https://github.com/ingstats/daily-template
- Apps Script 템플릿 프로젝트: (TFT 공유 링크 — 설치 시험 후 기입)

평일 흐름: 06:20 Apps Script 지표 수집·커밋 → 07:10 Claude 예약 작업(작성·검사·Gmail 초안) → 즉시 Apps Script 사이트 반영 → 08:00 Apps Script 카톡 발송 → 08:05 Claude 결과 확인.
