#!/usr/bin/env python3
"""발행된 호로 카카오톡 발송용 메시지를 만들고 점검합니다.

사용법:
  python3 kit/scripts/kakao.py data/issues/2026-11-27.json
  python3 kit/scripts/kakao.py data/issues/2026-11-27.json --test   (정식호·날짜 검사 생략, 시험용)

입력: 뉴스레터 페이지에서 받은 발행호 JSON
생성물: work/kakao-<날짜>.json, work/kakao-<날짜>.draft.txt (Gmail 초안 본문: "AXKAKAO1 " + JSON의 base64 한 줄)
  {schema, date, issue_no, issue_label, text, text_chars, link_url, short_url, button_title, template_object}
  template_object는 카카오 '텍스트 템플릿' 그대로이며, Google Apps Script 발송기(kit/apps-script/Code.gs)가
  이 값을 받아 '친구에게 보내기'·'나에게 보내기' API로 보냅니다. (daily-run 스킬)
점검: 정식 발행호·오늘 날짜, 본문 200자 이하(카카오 텍스트 템플릿 한도), 링크 주소가 허용 도메인인지,
      제외어(newsletter.yaml guardrails.exclude_terms) 없음. 문제가 있으면 한국어로 알리고 종료 코드 1.
"""
import base64
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

import yaml

ROOT = Path(__file__).resolve().parents[2]
KST = timezone(timedelta(hours=9))
WEEKDAYS = "월화수목금토일"
MAX_TEXT = 200          # 카카오 텍스트 템플릿 text 최대 길이
BUTTON_TITLE = "오늘 호 보기"
DRAFT_MARK = "AXKAKAO1"  # 초안 본문 머리표


def build_text(head: str, points: list[str], tail: str) -> str:
    return "\n".join([head, ""] + [f"· {p}" for p in points] + ["", tail])


def fit(head: str, points: list[str], tail: str) -> tuple[str, list[str]]:
    """200자를 넘으면 가장 긴 줄부터 끝을 줄여 '…'을 붙인다. 문장 자체는 바꾸지 않는다."""
    notes: list[str] = []
    pts = list(points)
    if len(build_text(head, pts, tail)) <= MAX_TEXT:
        return build_text(head, pts, tail), notes
    while pts:
        avail = MAX_TEXT - len(build_text(head, [""] * len(pts), tail))
        # 줄마다 같은 상한(cap)을 두고, 넘는 줄만 cap-1자 + '…'로 줄인다 (긴 줄부터 고르게)
        for cap in range(max(len(p) for p in pts), 19, -1):
            if sum(min(len(p), cap) for p in pts) <= avail:
                out = [p if len(p) <= cap else p[: cap - 1].rstrip(" ,·") + "…" for p in pts]
                notes.append("200자 한도에 맞추려 주요 소식 일부를 '…'로 줄였습니다.")
                return build_text(head, out, tail), notes
        notes.append(f"주요 소식 {len(pts)}번째 줄을 뺐습니다(200자 한도).")
        pts.pop()
    return build_text(head, points[:1], tail), notes


def main() -> int:
    args = sys.argv[1:]
    test = "--test" in args
    args = [a for a in args if a != "--test"]
    if len(args) != 1:
        print(__doc__)
        return 2

    issue = json.loads(Path(args[0]).read_text(encoding="utf-8"))
    meta = yaml.safe_load((ROOT / "newsletter.yaml").read_text(encoding="utf-8"))
    errors: list[str] = []

    today = datetime.now(KST).date().isoformat()
    if issue.get("status") != "final" and not test:
        errors.append(f"정식 발행호가 아닙니다(status={issue.get('status')}). 시범호는 보내지 않습니다.")
    if issue.get("issue_date") != today and not test:
        errors.append(f"오늘({today}) 호가 아닙니다: {issue.get('issue_date')}")

    d = date.fromisoformat(issue["issue_date"])
    no = issue.get("issue_no")
    label = f"제{no}호" if no else "시범호"
    name = meta.get("name", "팀 데일리")
    head = f"[{name}] {d.month}.{d.day}.({WEEKDAYS[d.weekday()]}) {label}"
    if test:
        head = "[시험] " + head

    link_url = (meta.get("site_url") or "").rstrip("/") + "/"
    short_url = link_url   # 카톡 본문·버튼은 카카오 앱에 등록한 사이트 주소만 (단축 링크는 팀원 안내·QR용)
    ALLOWED_HOSTS = {urlparse(link_url).hostname or ""}
    short_disp = short_url.replace("https://", "").replace("http://", "")
    tail = f"전체 보기 ▶ {short_disp}"

    points = [p.strip() for p in issue.get("key_points", []) if p.strip()]
    if not points:
        errors.append("key_points(주요 소식)가 비어 있습니다.")
    text, notes = fit(head, points, tail)

    for u, what in ((link_url, "site_url"),):
        host = urlparse(u).hostname or ""
        if urlparse(u).scheme != "https" or host not in ALLOWED_HOSTS:
            errors.append(f"newsletter.yaml {what}({u})가 허용 도메인({', '.join(sorted(ALLOWED_HOSTS))})의 https 주소가 아닙니다.")
    if len(text) > MAX_TEXT:
        errors.append(f"본문이 {len(text)}자로 카카오 한도({MAX_TEXT}자)를 넘습니다.")
    for term in meta.get("guardrails", {}).get("exclude_terms", []):
        if term in text:
            errors.append(f"제외어 '{term}'가 메시지에 들어 있습니다.")

    if errors:
        print("카카오톡 메시지 점검 실패:")
        for e in errors:
            print(" -", e)
        return 1

    msg = {
        "schema": "ax-kakao/1",
        "date": issue["issue_date"],
        "issue_no": no,
        "issue_label": label,
        "text": text,
        "text_chars": len(text),
        "link_url": link_url,
        "short_url": short_url,
        "button_title": BUTTON_TITLE,
        "template_object": {
            "object_type": "text",
            "text": text,
            "link": {"web_url": link_url, "mobile_web_url": link_url},
            "button_title": BUTTON_TITLE,
        },
    }
    out = ROOT / "work"
    out.mkdir(exist_ok=True)
    p = out / f"kakao-{issue['issue_date']}.json"
    raw = json.dumps(msg, ensure_ascii=False)
    p.write_text(raw, encoding="utf-8")
    # Gmail 초안 본문용: 링크가 바뀌지 않도록 base64로 감싼 한 줄 (발송기 Code.gs가 풀어 씀)
    b = out / f"kakao-{issue['issue_date']}.draft.txt"
    b.write_text(DRAFT_MARK + " " + base64.b64encode(raw.encode("utf-8")).decode("ascii"), encoding="ascii")
    print(f"통과: {p.relative_to(ROOT)} ({len(text)}자), 초안 본문: {b.relative_to(ROOT)}")
    for n in notes:
        print(" 참고:", n)
    print("-" * 30)
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
