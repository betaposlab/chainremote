#!/usr/bin/env python3
"""인스톨러 .iss 의 중괄호 수지 검사.

Inno Setup 은 `{` 만 `{{` 로 이스케이프한다. `}` 는 이스케이프가 없다 —
공식 문서 그대로 "You do not need to double } characters."
그래서 PowerShell 블록을 `{{ ... }}` 로 감싸면 **닫는 괄호가 하나 더** 나가고,
PowerShell 은 파싱 단계에서 죽는다. `-Command` 전체가 통째로 실행되지 않는다.

★이게 왜 무서운가: 실패가 조용하다. 2026-08-20 에 두 인스톨러에서 12줄이 이 상태로
발견됐는데, 서비스 중지·시작 같은 항목은 코어 --silent-install 이 대신 해줘서 몇 달간
아무도 몰랐다. 유일하게 드러난 건 대신해 줄 것이 없던 SELFTEST 뿐이었고, 그것도
"코드는 있는데 로그가 0건"이라는 모양으로만 보였다.

사람 눈으로는 `{{ }}` 가 짝이 맞아 보인다. 그래서 기계가 센다.
"""
import re
import sys
from pathlib import Path


def emitted(line: str) -> str:
    """Inno 가 실제로 내보내는 문자열 — {{ 만 { 로 줄고 } 는 그대로."""
    return line.replace("{{", "\x01").replace("\x01", "{")


def main() -> int:
    bad = []
    for path in sorted(Path(__file__).parent.glob("*.iss")):
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if "{{" not in line:
                continue
            out = emitted(line)
            balance = out.count("{") - out.count("}")
            if balance != 0:
                bad.append((path.name, n, balance, re.sub(r"\s+", " ", line)[:90]))

    if not bad:
        print("    ✓ .iss 중괄호 수지 정상")
        return 0
    print("✗ ERROR — .iss 중괄호 수지가 안 맞습니다. PowerShell 이 파싱에서 죽습니다:", file=sys.stderr)
    for name, n, balance, snippet in bad:
        sign = "닫는 괄호 과다" if balance < 0 else "여는 괄호 과다"
        print(f"    {name}:{n}  수지 {balance:+d} ({sign})", file=sys.stderr)
        print(f"      {snippet}", file=sys.stderr)
    print("  `}}` 를 `}` 로 고치세요 — Inno 는 } 를 겹치지 않습니다.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
