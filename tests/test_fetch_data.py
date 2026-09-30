import json
import sys
import unittest
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import fetch_data as fd  # noqa: E402

HEADER = ["일자", "구분", "카테고리", "항목명", "금액", "결제수단", "작성자", "비고"]


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
            fd.clean_rows([["일자", "구분", "금액"]])

    def test_empty_sheet(self):
        with self.assertRaises(fd.SchemaError):
            fd.clean_rows([])

    def test_skips_bad_and_blank_rows(self):
        rows = [
            HEADER,
            ["2026-01-01", "수입", "회비", "회비", "1,000", "", "", ""],
            ["", "", "", "", "", "", "", ""],
            ["2026-01-02", "지출", "식비", "점심", "-500", "", "", ""],
            ["2026-01-03", "환불", "식비", "점심", "500", "", "", ""],
        ]
        txs, warnings = fd.clean_rows(rows)
        self.assertEqual(len(txs), 1)
        self.assertEqual(len(warnings), 2)
        self.assertIn("4행", warnings[0])

    def test_optional_columns_and_short_rows(self):
        rows = [["일자", "구분", "카테고리", "항목명", "금액"], ["2026-01-01", "지출", "", "펜", "1000"]]
        txs, _ = fd.clean_rows(rows)
        self.assertEqual(txs[0]["category"], fd.DEFAULT_CATEGORY)
        self.assertEqual(txs[0]["pay_method"], "")
        self.assertEqual(txs[0]["note"], "")

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
        self.assertEqual(list(txs[0])[0], "id")


class PayloadTest(unittest.TestCase):
    def test_sample_csv_matches_schema(self):
        rows = fd.load_rows_from_csv(ROOT / "data" / "sample_transactions.csv")
        txs, warnings = fd.clean_rows(rows)
        payload = fd.build_payload(txs, now=datetime(2026, 9, 30, 16, 0, 0))

        self.assertEqual(len(warnings), 3)
        self.assertEqual(payload["last_updated"], "2026-09-30 16:00:00")
        self.assertEqual(set(payload), {"last_updated", "summary", "monthly_stats",
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


if __name__ == "__main__":
    unittest.main()
