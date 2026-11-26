---
name: daily-schedule
description: 팀 데일리를 매일 자동으로 돌리는 Claude 예약 작업 2개(평일 07:10 발행, 08:05 결과 확인)를 만들고 지금 실행으로 시험할 때 쓴다.
---

# 매일 자동화 (예약 작업 2개)

예약 작업 도구(create_trigger)로 만든다. 예약 작업은 교육생 개인 계정 소속이며, 실행마다 새 세션에서 시작하므로 프롬프트에 필요한 정보를 모두 넣는다.

## 공통 설정
- 커넥터: **Gmail만** (다른 커넥터는 빼서 승인 대기를 줄인다)
- 알림: 휴대폰 푸시 켬
- 시각: `CRON_TZ=Asia/Seoul` (정각을 피한다)

## 1) 「<name> 발행」 — `CRON_TZ=Asia/Seoul 10 7 * * 1-5`
```
「<name>」 오늘 호를 작성해 사이트 반영·카톡 발송 초안을 만들어라. 사용자가 평일 아침 자동 발행을 요청했다.
저장소: https://github.com/<github_repo> (공개). 아래 순서대로 한다.
1. git clone --depth 1 https://github.com/<github_repo> /home/claude/daily
2. /home/claude/daily/kit/skills/daily-run/SKILL.md 를 읽고 1~10단계를 처음부터 끝까지 그대로 따른다.
   ID=<ID>, owner_email=<owner_email>.
3. 무인 실행 규칙을 지킨다: 거절된 단계는 건너뛰고 기록, 검사 우회 금지, [<ID>-…] 초안 외 Gmail 건드리지 않기, 메일 보내지 않기.
4. 마무리 보고(한국어 5줄): 발행 여부·호수, 섹션별 기사 수, 사이트 반영 결과, 실패 사유.
```

## 2) 「<name> 카톡 확인」 — `CRON_TZ=Asia/Seoul 5 8 * * 1-5`
```
「<name>」 오늘 08:00 카톡 발송 결과를 확인해 보고하라.
1. 오늘(KST)이 토·일·한국 공휴일이면 종료.
2. Gmail list_drafts(query subject:"[<ID>-KAKAO] <오늘>")로 오늘 초안 제목을 본다. '대기'면 2분 간격으로 08:20까지 다시 본다.
3. '완료'/'실패'면 본문 끝 RESULT 줄에서 subscribers_ok/subscribers_total, failed(이름·사유)를 읽는다.
4. '완료'인 [<ID>-KAKAO]·[<ID>-SITE] 오늘 초안은 delete_draft로 지운다. 다른 초안은 건드리지 않는다.
5. 보고(한국어 3줄): 발송 여부, 받은 사람/구독자 수, 실패한 사람과 사유. 08:20까지 '대기'면 'Apps Script 발송기 미응답(트리거 확인)'.
```

## 3. 시험
- 만든 뒤 「<name> 발행」을 한 번 실행(fire_trigger 또는 '지금 실행')해 보고를 확인한다. 평일 07:00 이후가 아니면 수집 기간이 짧아 기사가 적을 수 있다고 미리 알린다.
- 교육 시연에서는 1회용(run_once_at)으로 다음 평일 아침을 걸어 두고, 다음 날 결과를 함께 본다.
