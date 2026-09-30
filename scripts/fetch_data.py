"""구글 시트 회계장부를 읽어 프론트엔드용 JSON(accounting_data.json)으로 변환한다.

데이터 소스 (둘 중 하나):
  1) Google Sheets API  — 환경변수 GCP_SA_KEY, SPREADSHEET_ID, SHEET_NAME 사용
  2) 로컬 CSV 파일       — `--csv 경로` 옵션 (시크릿 없이 로컬 개발/테스트용)

사용 예:
  python scripts/fetch_data.py                                   # 시트에서 읽기
  python scripts/fetch_data.py --csv data/sample_transactions.csv  # CSV에서 읽기
  python scripts/fetch_data.py --output public/accounting_data.json
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

KST = timezone(timedelta(hours=9))
DEFAULT_OUTPUT = Path("data/accounting_data.json")
SHEETS_SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]

# 시트 헤더(팀원 C 스키마) -> JSON 필드명
COLUMN_MAP = {
    "일자": "date",
    "구분": "type",
    "카테고리": "category",
    "항목명": "item",
    "금액": "amount",
    "결제수단": "pay_method",
    "작성자": "writer",
    "비고": "note",
}
REQUIRED_COLUMNS = ["일자", "구분", "카테고리", "항목명", "금액"]
VALID_TYPES = {"수입", "지출"}
DEFAULT_CATEGORY = "미분류"


class SchemaError(Exception):
    """시트 헤더가 약속된 스키마와 다를 때 발생."""


# ---------------------------------------------------------------------------
# 1. 데이터 가져오기
# ---------------------------------------------------------------------------
def load_rows_from_sheet() -> list[list[str]]:
    """Google Sheets API로 시트의 모든 셀 값을 2차원 리스트로 가져온다."""
    import gspread  # 로컬 CSV 모드에서는 설치하지 않아도 되도록 지연 import

    spreadsheet_id = os.environ.get("SPREADSHEET_ID", "").strip()
    sheet_name = os.environ.get("SHEET_NAME", "").strip()
    sa_key = os.environ.get("GCP_SA_KEY", "").strip()

    if not spreadsheet_id:
        raise RuntimeError("환경변수 SPREADSHEET_ID 가 설정되지 않았습니다.")

    if sa_key:
        try:
            credentials = json.loads(sa_key)
        except json.JSONDecodeError as exc:
            raise RuntimeError("GCP_SA_KEY 가 올바른 JSON 문자열이 아닙니다.") from exc
        client = gspread.service_account_from_dict(credentials, scopes=SHEETS_SCOPES)
    elif os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
        client = gspread.service_account(
            filename=os.environ["GOOGLE_APPLICATION_CREDENTIALS"], scopes=SHEETS_SCOPES
        )
    else:
        raise RuntimeError(
            "인증 정보가 없습니다. GCP_SA_KEY(JSON 문자열) 또는 "
            "GOOGLE_APPLICATION_CREDENTIALS(키 파일 경로)를 설정하세요."
        )

    spreadsheet = client.open_by_key(spreadsheet_id)
    worksheet = spreadsheet.worksheet(sheet_name) if sheet_name else spreadsheet.sheet1
    return worksheet.get_all_values()


def load_rows_from_csv(path: str | Path) -> list[list[str]]:
    # utf-8-sig: 엑셀/구글시트에서 내보낸 CSV의 BOM 제거
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.reader(f))


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


def clean_rows(rows: list[list[str]]) -> tuple[list[dict], list[str]]:
    """원본 행을 정제된 거래 목록으로 변환한다.

    Returns:
        (transactions, warnings) — 문제가 있는 행은 건너뛰고 사유를 warnings 에 담는다.
    """
    if not rows:
        raise SchemaError("시트가 비어 있습니다 (헤더 행 없음).")

    header = [h.strip() for h in rows[0]]
    missing = [c for c in REQUIRED_COLUMNS if c not in header]
    if missing:
        raise SchemaError(f"필수 컬럼이 없습니다: {', '.join(missing)} (현재 헤더: {header})")
    index = {name: header.index(name) for name in COLUMN_MAP if name in header}

    transactions: list[dict] = []
    warnings: list[str] = []

    for row_no, row in enumerate(rows[1:], start=2):  # 시트 기준 행 번호
        cells = {name: (row[i].strip() if i < len(row) else "") for name, i in index.items()}
        if not any(cells.values()):
            continue  # 완전히 빈 행은 조용히 건너뜀

        problems = []
        tx_date = parse_date(cells["일자"])
        if tx_date is None:
            problems.append(f"일자 '{cells['일자']}' 형식 오류")
        tx_type = cells["구분"]
        if tx_type not in VALID_TYPES:
            problems.append(f"구분 '{tx_type}' 은 수입/지출 이 아님")
        amount = parse_amount(cells["금액"])
        if amount is None:
            problems.append(f"금액 '{cells['금액']}' 숫자 아님")
        elif amount < 0:
            problems.append(f"금액 '{cells['금액']}' 음수")

        if problems:
            warnings.append(f"{row_no}행 건너뜀: " + ", ".join(problems))
            continue

        transactions.append(
            {
                "date": tx_date,
                "type": tx_type,
                "category": cells["카테고리"] or DEFAULT_CATEGORY,
                "item": cells["항목명"],
                "amount": amount,
                "pay_method": cells.get("결제수단", ""),
                "writer": cells.get("작성자", ""),
                "note": cells.get("비고", ""),
            }
        )

    # 최신 거래가 먼저 오도록 정렬 (같은 날짜는 시트 입력 순서 유지) 후 id 부여
    transactions.sort(key=lambda t: t["date"], reverse=True)
    for i, tx in enumerate(transactions, start=1):
        tx["id"] = i
    transactions = [{"id": tx.pop("id"), **tx} for tx in transactions]
    return transactions, warnings


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


def build_payload(transactions: list[dict], now: datetime | None = None) -> dict:
    now = now or datetime.now(KST)
    return {
        "last_updated": now.strftime("%Y-%m-%d %H:%M:%S"),
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
    parser.add_argument("--output", "-o", type=Path, default=DEFAULT_OUTPUT, help="출력 JSON 경로")
    parser.add_argument(
        "--strict", action="store_true", help="건너뛴 행이 하나라도 있으면 실패(exit 1) 처리"
    )
    args = parser.parse_args(argv)

    try:
        rows = load_rows_from_csv(args.csv) if args.csv else load_rows_from_sheet()
        transactions, warnings = clean_rows(rows)
    except (RuntimeError, SchemaError, OSError) as exc:
        print(f"[오류] {exc}", file=sys.stderr)
        return 1

    for w in warnings:
        _warn(w)

    payload = build_payload(transactions)
    write_json(payload, args.output)

    s = payload["summary"]
    print(
        f"완료: 거래 {len(transactions)}건 (건너뜀 {len(warnings)}건) -> {args.output}\n"
        f"  총 수입 {s['total_income']:,}원 / 총 지출 {s['total_expense']:,}원 / 잔액 {s['balance']:,}원"
    )
    return 1 if (args.strict and warnings) else 0


if __name__ == "__main__":
    sys.exit(main())
