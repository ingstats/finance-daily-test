---
name: daily-github
description: 팀 데일리 사이트를 GitHub에 개설할 때(템플릿으로 저장소 만들기, GitHub Pages 켜기) 또는 사이트 반영용 GitHub 토큰을 만들 때 쓴다. 브라우저 화면 제어로 진행하며, 교육생은 GitHub 로그인과 토큰 확인만 한다.
---

# GitHub 사이트 개설 (화면 제어)

템플릿 저장소: `https://github.com/ingstats/daily-template` (TFT 공개 템플릿)

## 1. 템플릿으로 저장소 만들기
1. 템플릿 저장소를 연다 → 오른쪽 위 **Use this template** → **Create a new repository**.
2. Owner = 교육생 계정, Repository name = newsletter.yaml의 `id`(예 `finance-daily`). **Public** 선택(무료 GitHub Pages는 공개 저장소만 됨).
3. **Create repository**. 확인: `github.com/<아이디>/<id>`에 index.html·data·kit 폴더가 보임.

## 2. GitHub Pages 켜기
1. 저장소 **Settings → Pages**.
2. Build and deployment: Source **Deploy from a branch**, Branch **main**, 폴더 **/(root)** → **Save**.
3. 1~3분 뒤 `https://<아이디>.github.io/<id>/`를 연다. 샘플 호 화면이 보이면 완료(처음엔 404가 잠깐 날 수 있음, 30초 간격으로 다시 연다).
4. newsletter.yaml에 `site_url`(끝 `/` 없이), `github_repo`(`아이디/id`)를 적는다.

## 3. 사이트 반영용 토큰 (daily-kakao 3단계에서 부름)
매일 아침 Apps Script가 이 저장소 **하나에만** 파일을 올리도록 하는 열쇠다.
1. `https://github.com/settings/personal-access-tokens/new` (Fine-grained token)를 연다. **Confirm access(sudo 모드)** 화면이 나오면 [직접] "패스키(또는 이메일 코드)로 본인 확인해 주세요".
2. Token name `<id>-site`, Expiration **1년(366일)** 또는 회사 정책 최대값, Resource owner = 교육생.
3. Repository access **Only select repositories** → 이 저장소 하나.
4. Permissions → Repository permissions → **Contents: Read and write** (Metadata: Read-only는 자동).
5. 여기까지 Claude가 채운 뒤 멈춘다. [직접] "설정을 확인하고 **Generate token**을 눌러 주세요. 나온 토큰(github_pat_…)을 복사해서 열어 둔 Apps Script 스크립트 속성 GITHUB_TOKEN에 붙여넣어 주세요. 토큰은 다시 볼 수 없으니 바로 붙여넣어 주세요."
6. 만료일을 교육생에게 알려 준다(만료 30일 전 Apps Script가 카톡으로 알림 — 그때 같은 절차로 새로 만든다).

## 주의
- 저장소는 공개다. 사내 자료·개인정보는 올리지 않는다.
- index.html·img·fonts는 교육생 요청 없이는 고치지 않는다.
