#!/usr/bin/env python3
"""발행물 검사 + 사이트 자료(data/) 갱신.  (AX Daily Report scripts/build.py를 교육용으로 줄인 것)

사용법
  python3 kit/scripts/build.py data/issues/2026-11-27.json   검사 통과 시 data/index.json·data/meta.json 갱신
  python3 kit/scripts/build.py --meta                         newsletter.yaml → data/meta.json 만 갱신

검사: 규격(kit/schema/issue.schema.json), 제외어·금지 표현(newsletter.yaml guardrails), 기사 수, 중복 링크,
      지난 호와 같은 기사, 수집 기간 밖 기사, 'MM.DD.(요일)' 요일 오류, '주요 내용' 필수, 형광펜 규칙.
문제가 있으면 고칠 내용을 한국어로 알리고 종료 코드 1. 검사를 끄거나 우회하지 않는다.
"""
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
WEEKDAYS = "월화수목금토일"
DATE_MARK = re.compile(r"(?<![\d.])(\d{1,2})\.(\d{1,2})\.\(([월화수목금토일])\)")
META_KEYS = ["id", "name", "cover_word", "description", "frequency_label", "category", "team",
             "news_title", "data_tab", "kakao_api", "contact_email"]


def parse_dt(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def visible_texts(issue: dict):
    yield "title", issue.get("title", "")
    yield "preheader", issue.get("preheader", "")
    for i, k in enumerate(issue.get("key_points", [])):
        yield f"key_points[{i}]", k
    for s in issue.get("sections", []):
        yield f"{s['id']}.title", s["title"]
        yield f"{s['id']}.empty_note", s.get("empty_note", "")
        for it in s["items"]:
            yield f"{s['id']} 제목", it["headline"]
            for p in it["points"]:
                yield f"{s['id']} ({p['label']})", p["text"]
    for i, n in enumerate(issue.get("notes", [])):
        yield f"notes[{i}]", n


def check(issue: dict, meta: dict) -> tuple[list[str], list[str]]:
    errors, warnings = [], []
    schema = json.loads((ROOT / "kit/schema/issue.schema.json").read_text(encoding="utf-8"))
    v = Draft202012Validator(schema, format_checker=FormatChecker())
    for e in sorted(v.iter_errors(issue), key=lambda e: list(e.path)):
        loc = "/".join(str(p) for p in e.path) or "(최상위)"
        errors.append(f"규격 위반 [{loc}]: {e.message}")
    if errors:
        return errors, warnings

    if issue["newsletter_id"] != meta["id"]:
        errors.append(f"newsletter_id가 newsletter.yaml의 id({meta['id']})와 다릅니다.")
    if not issue["title"].startswith(f"[{meta['name']}] "):
        errors.append(f"제목은 '[{meta['name']}] '로 시작해야 합니다: {issue['title'][:30]}…")

    guard = meta.get("guardrails", {}) or {}
    # 제외어는 기사 자체(제목·기관·출처·시사점 외 항목)와 excluded_note에서만 찾는다.
    # 시사점에 자사 이름을 쓰는 것은 허용(예: 하나캐피탈 조달 비용 관점).
    probe = json.loads(json.dumps(issue))
    for sec in probe["sections"]:
        for it in sec["items"]:
            it["points"] = [pt for pt in it["points"] if pt["label"] != "시사점"]
    probe.pop("generated_by", None)
    blob = json.dumps(probe, ensure_ascii=False)
    for t in guard.get("exclude_terms", []) or []:
        if t and t in blob:
            errors.append(f"제외어 '{t}'가 들어 있습니다. 해당 기사를 빼 주세요. (excluded_note에도 쓰지 말 것)")
    for where, text in visible_texts(issue):
        for b in guard.get("banned_phrases", []) or []:
            if b and b in text:
                errors.append(f"금지 표현 '{b}' 사용 [{where}]: {text[:40]}…")

    items = [it for s in issue["sections"] for it in s["items"]]
    if not items:
        errors.append("기사가 한 건도 없습니다. 발행하지 않습니다.")
    if len(items) > guard.get("max_items", 99):
        errors.append(f"기사가 {len(items)}건입니다. 최대 {guard['max_items']}건으로 줄여 주세요.")

    seen = set()
    for it in items:
        if not any(p["label"] == "주요 내용" for p in it["points"]):
            errors.append(f"'주요 내용' 항목이 없습니다: {it['headline']}")
        marks = [p for p in it["points"] if p.get("mark")]
        if len(marks) > 2:
            errors.append(f"형광펜 표시는 기사당 2곳까지입니다: {it['headline']}")
        for p in marks:
            m = p["mark"]
            if p["label"] == "시사점":
                errors.append(f"'시사점'에는 형광펜 표시를 하지 않습니다: {it['headline']}")
            if p["text"].count(m) != 1:
                errors.append(f"형광펜 구절이 문장 안에 그대로 한 번 있어야 합니다: '{m}' ← ({p['label']}) {p['text'][:30]}…")
            elif len(m) >= len(p["text"]) * 0.8:
                errors.append(f"형광펜은 문장 전체가 아니라 핵심 구절에만 칠합니다: '{m}'")
        if not marks:
            warnings.append(f"형광펜 표시가 없습니다(권장 1곳): {it['headline']}")
        for s in it["sources"]:
            if s["url"] in seen:
                errors.append(f"같은 원문 링크가 두 번 쓰였습니다: {s['url']}")
            seen.add(s["url"])

    prev_dir = DATA / "issues"
    if prev_dir.exists():
        for f in prev_dir.glob("*.json"):
            if f.stem == issue["issue_date"]:
                continue
            prev = json.loads(f.read_text(encoding="utf-8"))
            if prev.get("newsletter_id") != meta["id"]:
                continue                     # 템플릿 시범호 등 다른 뉴스레터 자료는 비교하지 않음
            prev_urls = {s["url"] for sec in prev["sections"] for it in sec["items"] for s in it["sources"]}
            for u in seen & prev_urls:
                errors.append(f"{f.stem} 호에 이미 실린 기사입니다: {u}")

    win = issue.get("collection_window")
    if win:
        w_from, w_to = parse_dt(win["from"]), parse_dt(win["to"])
        for it in items:
            for s in it["sources"]:
                try:
                    p = parse_dt(s["published_at"])
                except ValueError:
                    errors.append(f"게재 시각 형식 오류({s['published_at']}): 예) 2026-11-17T15:59+09:00")
                    continue
                if p.tzinfo is None:
                    errors.append(f"게재 시각에 시간대(+09:00)가 없습니다: {s['published_at']}")
                elif not (w_from <= p <= w_to):
                    errors.append(f"수집 기간 밖 기사: '{it['headline']}' ({s['outlet']} {s['published_at']})")

    issue_d = date.fromisoformat(issue["issue_date"])
    for where, text in visible_texts(issue):
        for m in DATE_MARK.finditer(text):
            mm, dd, wd = int(m.group(1)), int(m.group(2)), m.group(3)
            year = issue_d.year - (1 if mm - issue_d.month > 2 else 0)
            try:
                real = WEEKDAYS[date(year, mm, dd).weekday()]
            except ValueError:
                errors.append(f"존재하지 않는 날짜 {m.group(0)} [{where}]")
                continue
            if real != wd:
                errors.append(f"요일 오류 {m.group(0)} → ({real}) [{where}]")
    return errors, warnings


def write_meta(meta: dict) -> None:
    m = {k: meta.get(k) for k in META_KEYS if meta.get(k) is not None}
    m["web_url"] = meta.get("site_url", "")
    m["hub_url"] = ""
    (DATA / "meta.json").write_text(json.dumps(m, ensure_ascii=False, indent=1), encoding="utf-8")


def write_index(issue: dict, meta: dict) -> None:
    idx_path = DATA / "index.json"
    issues = json.loads(idx_path.read_text(encoding="utf-8"))["issues"] if idx_path.exists() else []
    # 템플릿 시범호(다른 뉴스레터 id)는 목록에서 뺌
    keep = []
    for i in issues:
        f = DATA / "issues" / f"{i['date']}.json"
        try:
            if json.loads(f.read_text(encoding="utf-8")).get("newsletter_id") != meta["id"]:
                continue
        except (OSError, ValueError):
            pass
        if i["date"] != issue["issue_date"]:
            keep.append(i)
    keep.append({"date": issue["issue_date"], "status": issue["status"], "issue_no": issue.get("issue_no", 0), "title": issue["title"]})
    keep.sort(key=lambda i: i["date"], reverse=True)
    idx_path.write_text(json.dumps({"issues": keep}, ensure_ascii=False, indent=1), encoding="utf-8")


def main() -> int:
    meta = yaml.safe_load((ROOT / "newsletter.yaml").read_text(encoding="utf-8"))
    if sys.argv[1:] == ["--meta"]:
        write_meta(meta)
        print("✅ data/meta.json 갱신")
        return 0
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    path = Path(sys.argv[1])
    issue = json.loads(path.read_text(encoding="utf-8"))
    errors, warnings = check(issue, meta)
    for w in warnings:
        print("⚠️ ", w)
    if errors:
        print(f"\n❌ 발행 불가 — 고칠 것 {len(errors)}건")
        for e in errors:
            print("   -", e)
        return 1
    target = DATA / "issues" / f"{issue['issue_date']}.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    if path.resolve() != target.resolve():
        target.write_text(json.dumps(issue, ensure_ascii=False, indent=1), encoding="utf-8")
    write_index(issue, meta)
    write_meta(meta)
    n = sum(len(s["items"]) for s in issue["sections"])
    print(f"✅ 검사 통과 · 기사 {n}건 · data/issues/{issue['issue_date']}.json, data/index.json, data/meta.json 갱신")
    return 0


if __name__ == "__main__":
    sys.exit(main())
