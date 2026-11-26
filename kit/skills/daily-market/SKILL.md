---
name: daily-market
description: 팀 데일리 사이트의 주요 지표를 고르거나 추가·삭제할 때 쓴다 — 교육생이 말한 지표의 공개 원천(한국은행 ECOS·Yahoo Finance)을 찾아 최근 값을 대조하고 indicators.json에 넣는다. "○○ 지표 추가해 줘", "○○은 빼 줘".
---

# 지표 고르기·추가·삭제

값은 Claude가 옮겨 적지 않는다. Claude는 **원천을 찾아 indicators.json에 적고**, 매일 아침 Apps Script 수집기(Market.gs)가 원천에서 직접 받아 사이트에 올린다.

## 1. 원천 찾기
1. `sources.md`(검증된 원천 목록)에 있으면 그 항목을 쓴다.
2. 없으면 검색한다: "<지표 이름> ECOS 통계표 코드", 한국은행 ECOS 통계 검색(ecos.bok.or.kr). Yahoo Finance 기호(예: `CL=F`, `^KS11`).
3. 공개 API가 없는 지표(월간 업계 통계 등)는 지금 넣지 않고 "웹 조회형 — 추후"로 교육생에게 알린다.

## 2. 값 대조 (교육생과 함께 확인)
- ECOS: 브라우저로 아래 주소를 열어 최근 값을 읽는다(시험용 키 `sample`, 10건까지).
  `https://ecos.bok.or.kr/api/StatisticSearch/sample/json/kr/1/10/<통계표>/<D|M>/<시작>/<끝>/<항목>`
  (일간 D: 날짜 YYYYMMDD 최근 2주, 월간 M: YYYYMM 최근 10개월)
- Yahoo: `https://finance.yahoo.com/quote/<기호>/` 화면의 전일 종가.
- 원천 화면과 값·기준일을 나란히 보여 주고 "맞나요?"라고 묻는다. 원천 화면을 열지 못하면 넣지 않는다.

## 3. indicators.json에 쓰기
항목 형식 (sources.md의 예를 복사):
```json
{"id":"kr3y","label":"국고채 3년","group":"금리","unit":"%","decimals":3,"change":"bp",
 "source":"한국은행 경제통계시스템(ECOS)","fetch":{"type":"ecos","table":"817Y002","item":"010200000","cycle":"D"},
 "lo":0.1,"hi":15,"jump":0.5}
```
- id: 영문 소문자·숫자. group: `금리`(왼쪽 칸) 또는 `환율`·`주가`·`원자재`·`물가` 등(오른쪽 칸). 화면 순서 = 목록 순서.
- change: 금리 `bp`, 지수·가격 `pct`, 환율 `abs`. 월간 지표는 `note`에 "월 기준".
- 검사 한도: lo·hi(값 범위), jump(하루 변동 값) 또는 jump_pct(%). 너무 빡빡하면 정상 값도 막히므로 sources.md 값을 따른다.
- 삭제는 항목을 지운다. 다음 수집 때 market.json에서도 빠진다.

## 4. 반영
- 설치 중(첫 호 전): daily-run `--first` 묶음에 indicators.json을 함께 넣는다.
- 교육 이후: `python3 kit/scripts/bundle.py <오늘> indicators.json --message "지표 변경"` → Gmail 초안 `[<ID>-SITE] <오늘> 대기`(daily-run 8단계와 같음).
- 바로 보고 싶으면 Apps Script 편집기에서 `collectMarketNow`를 실행(화면 제어). 아니면 다음 평일 06:20 이후 자동 반영.
- 확인: 사이트 '주요 시장 지표'에 새 지표와 1년 추이가 보이면 완료.
