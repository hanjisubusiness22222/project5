import contextlib
import io
import json
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).resolve().parent / "fixtures"
sys.path.insert(0, str(ROOT / "scripts"))

import fetch_data as fd  # noqa: E402

HEADER = ["일자", "구분", "카테고리", "항목명", "금액", "결제수단", "작성자", "비고"]
TX_FIELDS = ["id", "date", "type", "category", "item", "amount", "pay_method", "author", "note"]


class ParseDateTest(unittest.TestCase):
    def test_formats(self):
        for raw in ["2026-03-05", "2026.3.5", "2026. 3. 5", "2026. 3. 5.", "2026/03/05",
                    "2026년 3월 5일", "20260305", "2026-03-05 13:20:00"]:
            with self.subTest(raw=raw):
                self.assertEqual(fd.parse_date(raw), "2026-03-05")

    def test_invalid(self):
        for raw in ["", "2026-02-30", "3월 5일", "abc"]:
            with self.subTest(raw=raw):
                self.assertIsNone(fd.parse_date(raw))


class ParseAmountTest(unittest.TestCase):
    def test_formats(self):
        self.assertEqual(fd.parse_amount("10,000"), 10000)
        self.assertEqual(fd.parse_amount("₩10,000"), 10000)
        self.assertEqual(fd.parse_amount("10000원"), 10000)
        self.assertEqual(fd.parse_amount("10000.0"), 10000)

    def test_invalid(self):
        for raw in ["", "만원", "100.5"]:
            with self.subTest(raw=raw):
                self.assertIsNone(fd.parse_amount(raw))


class CleanRowsTest(unittest.TestCase):
    def test_missing_required_column(self):
        with self.assertRaises(fd.SchemaError):
            fd.clean_rows([["일자", "카테고리", "금액"]])

    def test_empty_sheet(self):
        with self.assertRaises(fd.SchemaError):
            fd.clean_rows([])

    def test_header_only_gives_no_transactions(self):
        self.assertEqual(fd.clean_rows([HEADER]), ([], []))

    def test_skips_bad_and_blank_rows(self):
        rows = [
            HEADER,
            ["2026-01-01", "수입", "회비", "회비", "1,000", "", "", ""],
            ["", "", "", "", "", "", "", ""],
            ["2026-01-02", "지출", "식비", "점심", "-500", "", "", ""],
            ["2026-01-03", "환불", "식비", "점심", "500", "", "", ""],
            ["2026-01-04", "지출", "식비", "점심", "0", "", "", ""],
        ]
        txs, warnings = fd.clean_rows(rows)
        self.assertEqual(len(txs), 1)
        self.assertEqual(len(warnings), 3)
        self.assertIn("4행", warnings[0])

    def test_defaults_for_optional_columns_and_short_rows(self):
        rows = [["일자", "구분", "금액"], ["2026-01-01", "지출", "1000"]]
        txs, _ = fd.clean_rows(rows)
        self.assertEqual(txs[0]["category"], "기타")
        self.assertEqual(txs[0]["item"], "미지정 항목")
        self.assertEqual(txs[0]["pay_method"], "-")
        self.assertEqual(txs[0]["author"], "-")
        self.assertEqual(txs[0]["note"], "")

    def test_header_aliases_match_frontend(self):
        rows = [["날짜", "종류", "분류", "내역", "비용", "결제방법", "담당자", "메모"],
                ["2026-01-01", "지출", "식비", "점심", "9,000", "현금", "홍길동", "메모"]]
        txs, warnings = fd.clean_rows(rows)
        self.assertEqual(warnings, [])
        self.assertEqual(txs[0], {"id": 1, "date": "2026-01-01", "type": "지출", "category": "식비",
                                  "item": "점심", "amount": 9000, "pay_method": "현금",
                                  "author": "홍길동", "note": "메모"})

    def test_sorted_latest_first_with_ids(self):
        rows = [
            HEADER,
            ["2026-01-01", "지출", "식비", "a", "1", "", "", ""],
            ["2026-03-01", "지출", "식비", "b", "1", "", "", ""],
            ["2026-02-01", "지출", "식비", "c", "1", "", "", ""],
        ]
        txs, _ = fd.clean_rows(rows)
        self.assertEqual([t["item"] for t in txs], ["b", "c", "a"])
        self.assertEqual([t["id"] for t in txs], [1, 2, 3])
        self.assertEqual(list(txs[0]), TX_FIELDS)


class PayloadTest(unittest.TestCase):
    def test_fixture_csv_matches_schema(self):
        rows = fd.load_rows_from_csv(FIXTURES / "sample_transactions.csv")
        txs, warnings = fd.clean_rows(rows)
        payload = fd.build_payload(txs, now=datetime(2026, 9, 30, 16, 0, 0), source="csv")

        self.assertEqual(len(warnings), 3)
        self.assertEqual(payload["last_updated"], "2026-09-30 16:00:00")
        self.assertEqual(set(payload), {"last_updated", "source", "summary", "monthly_stats",
                                        "category_stats", "transactions"})
        s = payload["summary"]
        self.assertEqual(s["total_income"], 3_500_000)
        self.assertEqual(s["total_expense"], 1_202_000)
        self.assertEqual(s["balance"], s["total_income"] - s["total_expense"])

        months = payload["monthly_stats"]
        self.assertEqual([m["month"] for m in months], ["2026-01", "2026-02", "2026-03"])
        self.assertEqual(sum(m["expense"] for m in months), s["total_expense"])
        self.assertEqual(sum(payload["category_stats"].values()), s["total_expense"])
        self.assertEqual(next(iter(payload["category_stats"])), "식비")  # 금액 큰 순
        json.dumps(payload, ensure_ascii=False)  # 직렬화 가능해야 함

    def test_team_sample_csv_has_no_bad_rows(self):
        rows = fd.load_rows_from_csv(ROOT / "data" / "sample_accounting_data.csv")
        txs, warnings = fd.clean_rows(rows)
        self.assertEqual(warnings, [])
        self.assertEqual(len(txs), len(rows) - 1)


class MainTest(unittest.TestCase):
    def run_main(self, csv_text):
        with tempfile.TemporaryDirectory() as tmp:
            src, out = Path(tmp) / "in.csv", Path(tmp) / "out.json"
            src.write_text(csv_text, encoding="utf-8")
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                code = fd.main(["--csv", str(src), "--output", str(out)])
            return code, (json.loads(out.read_text(encoding="utf-8")) if out.exists() else None)

    def test_empty_sheet_falls_back_to_mock(self):
        for text in ["", ",".join(HEADER) + "\n"]:
            with self.subTest(text=text):
                code, payload = self.run_main(text)
                self.assertEqual(code, 0)
                self.assertEqual(payload["source"], "mock")
                self.assertEqual(len(payload["transactions"]), len(fd.load_mock_transactions()))
                self.assertEqual(list(payload["transactions"][0]), TX_FIELDS)

    def test_schema_error_fails_without_output(self):
        code, payload = self.run_main("이름,나이\n홍길동,20\n")
        self.assertEqual(code, 1)
        self.assertIsNone(payload)


if __name__ == "__main__":
    unittest.main()
