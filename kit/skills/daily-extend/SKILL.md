---
name: daily-extend
description: (확장 시연용) 팀 데일리 사이트에 AX Daily '제도·지정 현황' 같은 추적 탭을 추가하거나 화면 색·문구를 바꾸는 장면을 보여 줄 때 쓴다. 기본 교육 범위가 아니다.
---

# 확장 시연 — 추적 탭·디자인

강사가 5분 안에 '이렇게도 할 수 있다'를 보여 주는 용도. 교육생 사이트에 바로 적용하지 않는다(시연용 저장소에서).

## 추적 탭 (예: 자동차금융 규제 추진 현황)
1. AX Daily 사이트(axdaily.site/#data)를 열어 '규제·제도 추진 현황' 표(추진 발표 → 예고·국회 제출 → 확정 → 시행)를 보여 준다.
2. 주제를 받아 공공기관 원문(금융위원회·국회·법제처)을 검색하고, 항목별 단계·일자·출처 링크를 표로 정리한다. 원문을 열지 못한 값은 넣지 않는다.
3. `data/regulation.json`(AX Daily 형식)으로 저장하고 newsletter.yaml `data_tab: true` → build.py `--meta` → bundle.py로 `data/regulation.json data/meta.json`을 올린다.
   (현재 템플릿 화면의 현황 탭은 AX Daily의 혁신금융서비스 그림까지 그리므로, 시연 전 TFT가 표만 그리는 간단한 버전을 준비해 둔다.)

## 디자인 바꾸기
"대표 색을 하나 레드로 바꿔 줘" → index.html의 `--hana`·`--hana-text` 색 값만 바꿔 bundle.py로 `index.html`을 올린다. 바꾼 줄을 보여 주고, 되돌리는 방법(이전 값)도 알려 준다.
