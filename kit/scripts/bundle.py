#!/usr/bin/env python3
"""사이트에 올릴 파일을 Gmail 초안 본문 한 줄로 묶는다 (Apps Script Site.gs가 풀어서 GitHub에 커밋).

사용법
  python3 kit/scripts/bundle.py <날짜> <파일> [<파일> ...] [--message "커밋 메시지"]
  예) python3 kit/scripts/bundle.py 2026-11-27 data/issues/2026-11-27.json data/index.json data/meta.json
결과: work/site-<날짜>.draft.txt  = "DAILYSITE1 " + base64(gzip(JSON))
올릴 수 있는 경로: data/*.json, data/issues/*.json, indicators.json, newsletter.yaml, editorial.md, index.html
"""
import base64
import gzip
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ALLOWED = re.compile(r"^(data/[\w.\-/]+\.json|indicators\.json|newsletter\.yaml|editorial\.md|index\.html)$")
LIMIT = 400_000   # 초안 본문 한도(여유 있게)


def main() -> int:
    args = sys.argv[1:]
    msg = "Claude 발행"
    if "--message" in args:
        i = args.index("--message")
        msg = args[i + 1]
        del args[i:i + 2]
    if len(args) < 2 or not re.match(r"^\d{4}-\d{2}-\d{2}$", args[0]):
        print(__doc__)
        return 2
    day, paths = args[0], args[1:]
    files = {}
    for p in paths:
        rel = Path(p).resolve().relative_to(ROOT).as_posix()
        if not ALLOWED.match(rel):
            print(f"❌ 올릴 수 없는 경로: {rel}")
            return 1
        text = (ROOT / rel).read_text(encoding="utf-8")
        if rel.endswith(".json"):
            json.loads(text)                     # 깨진 JSON은 올리지 않음
        files[rel] = text
    raw = json.dumps({"schema": "daily-site/1", "date": day, "message": msg, "files": files}, ensure_ascii=False).encode("utf-8")
    body = "DAILYSITE1 " + base64.b64encode(gzip.compress(raw, 9)).decode("ascii")
    if len(body) > LIMIT:
        print(f"❌ 너무 큽니다({len(body):,}자). 파일 수를 줄이세요.")
        return 1
    out = ROOT / "work"
    out.mkdir(exist_ok=True)
    f = out / f"site-{day}.draft.txt"
    f.write_text(body, encoding="ascii")
    print(f"✅ {f.relative_to(ROOT)} ({len(body):,}자) · 파일 {len(files)}개: {', '.join(files)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
