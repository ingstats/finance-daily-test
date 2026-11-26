# 검증된 지표 원천 (indicators.json에 그대로 복사)

상태: 운영 = AX Daily에서 매일 쓰는 원천 / 시험 확인 = 교육 준비 시험에서 값 대조 완료 / 미확인 = 넣기 전에 2절 대조 필수

```json
{"id":"kr3y","label":"국고채 3년","group":"금리","unit":"%","decimals":3,"change":"bp","source":"한국은행 경제통계시스템(ECOS)","fetch":{"type":"ecos","table":"817Y002","item":"010200000","cycle":"D"},"lo":0.1,"hi":15,"jump":0.5}
{"id":"cd91","label":"CD 91일","group":"금리","unit":"%","decimals":2,"change":"bp","source":"한국은행 경제통계시스템(ECOS)","fetch":{"type":"ecos","table":"817Y002","item":"010502000","cycle":"D"},"lo":0.1,"hi":15,"jump":0.5}
{"id":"usdkrw","label":"원/달러 환율","group":"환율","unit":"원","decimals":1,"change":"abs","source":"한국은행 경제통계시스템(ECOS)","fetch":{"type":"ecos","table":"731Y001","item":"0000001","cycle":"D"},"lo":500,"hi":3000,"jump_pct":5}
{"id":"kospi","label":"KOSPI","group":"주가","unit":"","decimals":2,"change":"pct","source":"한국은행 경제통계시스템(ECOS)","fetch":{"type":"ecos","table":"802Y001","item":"0001000","cycle":"D"},"lo":100,"hi":100000,"jump_pct":20}
{"id":"kosdaq","label":"KOSDAQ","group":"주가","unit":"","decimals":2,"change":"pct","source":"한국은행 경제통계시스템(ECOS)","fetch":{"type":"ecos","table":"802Y001","item":"0089000","cycle":"D"},"lo":50,"hi":100000,"jump_pct":20}
{"id":"nasdaq","label":"NASDAQ","group":"주가","unit":"","decimals":2,"change":"pct","source":"Yahoo Finance","fetch":{"type":"yahoo","symbol":"^IXIC"},"lo":1000,"hi":1000000,"jump_pct":15}
```

| id | 지표 | 원천 | 상태 |
|---|---|---|---|
| kr3y | 국고채 3년 | ECOS 817Y002 / 010200000 | 운영 |
| cd91 | CD 91일 | ECOS 817Y002 / 010502000 | 운영 |
| usdkrw | 원/달러 | ECOS 731Y001 / 0000001 | 운영 |
| kospi | KOSPI | ECOS 802Y001 / 0001000 | 운영 |
| kosdaq | KOSDAQ | ECOS 802Y001 / 0089000 | 운영 |
| nasdaq | NASDAQ | Yahoo ^IXIC | 운영 |
| aa3y | 회사채 3년(AA-) | ECOS 817Y002 / 010300000 | 미확인 |
| kr10y | 국고채 10년 | ECOS 817Y002 / 010210000 | 미확인 |
| wti | WTI 유가(달러) | Yahoo CL=F | 미확인 |
| cpi | 소비자물가지수 | ECOS 901Y009 / 0 (월간 M) | 미확인 |

여전채(AA-)·하나캐피탈 발행금리는 금융투자협회 원천이라 이 수집기에 아직 없다. AX Daily 수집기를 옮겨야 하므로 TFT에 요청한다.
