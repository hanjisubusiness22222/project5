"""회계장부 데이터 수집 및 정제 스크립트 (팀원 A 담당 파이프라인)

구글 시트 "웹에 게시" CSV 엔드포인트에서 데이터를 받아 정제·집계한 뒤
프론트엔드용 JSON(data/accounting_data.json)으로 저장한다.

사용 예:
  python scripts/fetch_data.py                                  # 공용 시트 CSV URL 에서 읽기
  python scripts/fetch_data.py --csv tests/fixtures/sample_transactions.csv  # 로컬 CSV (개발/테스트용)
  python scripts/fetch_data.py --strict                         # 잘못된 행이 있으면 실패 처리

환경변수:
  SHEETS_CSV_URL  기본 시트 대신 읽을 CSV URL (선택)
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import sys
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KST = timezone(timedelta(hours=9))

# 팀원 공유 구글 시트 실시간 CSV 엔드포인트
SHEETS_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRJDia7EcGbs_WAAbeOoNHvGXuOKbGNS2G7JhmUKuPfUeVQQ_4ol4j6lygrmByCkg9D6VnSLShSqddI/pub?gid=0&single=true&output=csv"
OUTPUT_JSON_PATH = ROOT / "data" / "accounting_data.json"
MOCK_DATA_PATH = ROOT / "data" / "mock_data.json"

# JSON 필드명 -> 시트 헤더 후보 (앞쪽이 팀원 C 표준 스키마, 뒤는 js/app.js 와 동일한 호환 별칭)
COLUMN_ALIASES = {
    "date": ["일자", "날짜", "거래일자", "일시", "Date", "date"],
    "type": ["구분", "종류", "Type", "type"],
    "category": ["카테고리", "분류", "항목분류", "Category", "category"],
    "item": ["항목명", "내역", "적요", "항목", "내용", "Item", "item"],
    "amount": ["금액", "비용", "Amount", "amount"],
    "pay_method": ["결제수단", "결제방법", "수단", "지불방법"],
    "author": ["작성자", "담당자", "기록자"],
    "note": ["비고", "메모", "비고사항", "Note", "note"],
}
REQUIRED_FIELDS = ["date", "type", "amount"]
VALID_TYPES = {"수입", "지출"}
DEFAULTS = {"category": "기타", "item": "미지정 항목", "pay_method": "-", "author": "-", "note": ""}


class SchemaError(Exception):
    """시트 헤더가 약속된 스키마와 다를 때 발생."""


# ---------------------------------------------------------------------------
# 1. 데이터 가져오기
# ---------------------------------------------------------------------------
def fetch_csv_text(url: str, timeout: int = 30) -> str:
    """구글 시트 게시 CSV 엔드포인트에서 원본 텍스트를 다운로드한다."""
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (accounting-dashboard)"})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return response.read().decode("utf-8-sig")


def parse_csv_text(text: str) -> list[list[str]]:
    return list(csv.reader(io.StringIO(text)))


def load_rows_from_csv(path: str | Path) -> list[list[str]]:
    # utf-8-sig: 엑셀/구글시트에서 내보낸 CSV의 BOM 제거
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.reader(f))


def load_mock_transactions(path: Path = MOCK_DATA_PATH) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# 2. 값 정제
# ---------------------------------------------------------------------------
_DATE_PATTERN = re.compile(r"^\s*(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?\s*\.?\s*$")
_COMPACT_DATE_PATTERN = re.compile(r"^\s*(\d{4})(\d{2})(\d{2})\s*$")


def parse_date(value: str) -> str | None:
    """여러 날짜 표기를 YYYY-MM-DD 로 통일한다. 해석 불가하면 None.

    지원: 2026-03-15, 2026.3.15, 2026. 3. 15, 2026/03/15, 2026년 3월 15일, 20260315,
          2026-03-15 13:00:00 (시간은 버림)
    """
    text = (value or "").strip()
    if not text:
        return None
    text = re.split(r"\s+\d{1,2}:\d{2}", text)[0]  # 시간 부분 제거
    match = _DATE_PATTERN.match(text) or _COMPACT_DATE_PATTERN.match(text)
    if not match:
        return None
    try:
        return date(*(int(g) for g in match.groups())).isoformat()
    except ValueError:  # 2026-02-30 같은 존재하지 않는 날짜
        return None


def parse_amount(value: str) -> int | None:
    """'10,000', '₩10,000', '10000원', '10000.0' -> 10000. 해석 불가하면 None."""
    text = re.sub(r"[,\s원₩]", "", (value or "").strip())
    if not text:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    if number != int(number):
        return None  # 원 단위 소수점 금액은 입력 오류로 간주
    return int(number)


def resolve_columns(header: list[str]) -> dict[str, int]:
    """헤더 행에서 각 JSON 필드에 해당하는 열 번호를 찾는다."""
    header = [h.strip() for h in header]
    index = {}
    for field, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            if alias in header:
                index[field] = header.index(alias)
                break
    missing = [COLUMN_ALIASES[f][0] for f in REQUIRED_FIELDS if f not in index]
    if missing:
        raise SchemaError(f"필수 컬럼이 없습니다: {', '.join(missing)} (현재 헤더: {header})")
    return index


def clean_rows(rows: list[list[str]]) -> tuple[list[dict], list[str]]:
    """원본 행을 정제된 거래 목록으로 변환한다.

    Returns:
        (transactions, warnings) — 문제가 있는 행은 건너뛰고 사유를 warnings 에 담는다.
    """
    if not rows:
        raise SchemaError("시트가 비어 있습니다 (헤더 행 없음).")
    index = resolve_columns(rows[0])

    transactions: list[dict] = []
    warnings: list[str] = []

    for row_no, row in enumerate(rows[1:], start=2):  # 시트 기준 행 번호
        cells = {f: (row[i].strip() if i < len(row) else "") for f, i in index.items()}
        if not any(cells.values()):
            continue  # 완전히 빈 행은 조용히 건너뜀

        problems = []
        tx_date = parse_date(cells["date"])
        if tx_date is None:
            problems.append(f"일자 '{cells['date']}' 형식 오류")
        if cells["type"] not in VALID_TYPES:
            problems.append(f"구분 '{cells['type']}' 은 수입/지출 이 아님")
        amount = parse_amount(cells["amount"])
        if amount is None:
            problems.append(f"금액 '{cells['amount']}' 숫자 아님")
        elif amount <= 0:
            problems.append(f"금액 '{cells['amount']}' 0 이하")

        if problems:
            warnings.append(f"{row_no}행 건너뜀: " + ", ".join(problems))
            continue

        tx = {field: cells.get(field) or default for field, default in DEFAULTS.items()}
        tx.update(date=tx_date, type=cells["type"], amount=amount)
        transactions.append(tx)

    return number_transactions(transactions), warnings


def number_transactions(transactions: list[dict]) -> list[dict]:
    """최신 거래가 먼저 오도록 정렬(같은 날짜는 입력 순서 유지)하고 id 를 1부터 다시 매긴다."""
    ordered = sorted(transactions, key=lambda t: t["date"], reverse=True)
    fields = ["date", "type", "category", "item", "amount", "pay_method", "author", "note"]
    return [{"id": i, **{f: t.get(f, DEFAULTS.get(f, "")) for f in fields}}
            for i, t in enumerate(ordered, start=1)]


# ---------------------------------------------------------------------------
# 3. 사전 집계
# ---------------------------------------------------------------------------
def build_summary(transactions: list[dict]) -> dict:
    total_income = sum(t["amount"] for t in transactions if t["type"] == "수입")
    total_expense = sum(t["amount"] for t in transactions if t["type"] == "지출")
    return {
        "total_income": total_income,
        "total_expense": total_expense,
        "balance": total_income - total_expense,
    }


def build_monthly_stats(transactions: list[dict]) -> list[dict]:
    monthly: dict[str, dict[str, int]] = defaultdict(lambda: {"income": 0, "expense": 0})
    for t in transactions:
        key = "income" if t["type"] == "수입" else "expense"
        monthly[t["date"][:7]][key] += t["amount"]
    return [{"month": m, **monthly[m]} for m in sorted(monthly)]


def build_category_stats(transactions: list[dict]) -> dict[str, int]:
    """카테고리별 지출 합계 (금액 큰 순)."""
    totals: dict[str, int] = defaultdict(int)
    for t in transactions:
        if t["type"] == "지출":
            totals[t["category"]] += t["amount"]
    return dict(sorted(totals.items(), key=lambda kv: kv[1], reverse=True))


def build_payload(transactions: list[dict], now: datetime | None = None, source: str = "sheet") -> dict:
    now = now or datetime.now(KST)
    return {
        "last_updated": now.strftime("%Y-%m-%d %H:%M:%S"),
        "source": source,  # "sheet" | "csv" | "mock" — 프론트에서 샘플 모드 배너 표시용
        "summary": build_summary(transactions),
        "monthly_stats": build_monthly_stats(transactions),
        "category_stats": build_category_stats(transactions),
        "transactions": transactions,
    }


# ---------------------------------------------------------------------------
# 4. 실행
# ---------------------------------------------------------------------------
def write_json(payload: dict, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")


def _warn(message: str) -> None:
    # GitHub Actions 에서는 ::warning:: 으로 출력하면 실행 요약에 경고로 표시된다
    prefix = "::warning::" if os.environ.get("GITHUB_ACTIONS") == "true" else "[경고] "
    print(prefix + message, file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="구글 시트 회계장부 -> JSON 변환")
    parser.add_argument("--csv", help="시트 대신 읽을 로컬 CSV 경로 (개발/테스트용)")
    parser.add_argument("--url", default=os.environ.get("SHEETS_CSV_URL") or SHEETS_CSV_URL,
                        help="구글 시트 게시 CSV URL")
    parser.add_argument("--output", "-o", type=Path, default=OUTPUT_JSON_PATH, help="출력 JSON 경로")
    parser.add_argument("--strict", action="store_true",
                        help="건너뛴 행이 하나라도 있으면 실패(exit 1) 처리")
    args = parser.parse_args(argv)

    # 네트워크 오류는 실패로 처리한다: 워크플로우가 멈추고 기존 배포본이 유지되므로
    # 일시적 장애 때문에 실데이터가 샘플 데이터로 덮어써지는 일이 없다.
    try:
        if args.csv:
            rows, source = load_rows_from_csv(args.csv), "csv"
        else:
            print(f"[*] 구글 시트 데이터 수집: {args.url}")
            rows, source = parse_csv_text(fetch_csv_text(args.url)), "sheet"
    except OSError as exc:
        print(f"[오류] 데이터를 가져오지 못했습니다: {exc}", file=sys.stderr)
        return 1

    try:
        transactions, warnings = clean_rows(rows) if rows else ([], [])
    except SchemaError as exc:
        print(f"[오류] {exc}", file=sys.stderr)
        return 1

    for w in warnings:
        _warn(w)

    # 시트에 유효한 행이 하나도 없으면(빈 시트) 목업 데이터로 대체
    if not transactions:
        _warn(f"유효한 거래가 없어 {MOCK_DATA_PATH.name} 샘플 데이터로 대체합니다.")
        transactions, source = number_transactions(load_mock_transactions()), "mock"

    payload = build_payload(transactions, source=source)
    write_json(payload, args.output)

    s = payload["summary"]
    print(
        f"완료: 거래 {len(transactions)}건 (건너뜀 {len(warnings)}건, 출처 {source}) -> {args.output}\n"
        f"  총 수입 {s['total_income']:,}원 / 총 지출 {s['total_expense']:,}원 / 잔액 {s['balance']:,}원"
    )
    return 1 if (args.strict and warnings) else 0


if __name__ == "__main__":
    sys.exit(main())
