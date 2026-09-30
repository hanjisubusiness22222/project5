"""
회계장부 데이터 수집 및 정제 스크립트 (팀원 A 담당 파이프라인)
- Google Sheets 공개 CSV 엔드포인트에서 최신 회계 데이터를 수집합니다.
- 수입/지출 집계, 카테고리별 통계, 월별 통계를 사전 계산하여 JSON 파일로 저장합니다.
"""

import json
import os
import re
import urllib.request
import csv
import io
from datetime import datetime

# 팀원 공유 구글 시트 실시간 CSV 엔드포인트
SHEETS_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRJDia7EcGbs_WAAbeOoNHvGXuOKbGNS2G7JhmUKuPfUeVQQ_4ol4j6lygrmByCkg9D6VnSLShSqddI/pub?output=csv"
OUTPUT_JSON_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "accounting_data.json")
MOCK_DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "mock_data.json")


def fetch_csv_content(url: str) -> str:
    """구글 시트 엔드포인트에서 CSV 원본 텍스트를 다운로드합니다."""
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    )
    with urllib.request.urlopen(req) as response:
        return response.read().decode("utf-8-sig")


def parse_and_clean_data(csv_text: str):
    """CSV 데이터를 파싱하고 숫자, 날짜를 정제합니다."""
    f = io.StringIO(csv_text)
    reader = csv.DictReader(f)
    
    transactions = []
    index = 1

    for row in reader:
        # 키 정규화
        def get_val(*keys, default=""):
            for k in keys:
                if k in row and row[k] and row[k].strip():
                    return row[k].strip()
            return default

        date = get_val("일자", "날짜", "Date", "date")
        raw_type = get_val("구분", "Type", "type", default="지출")
        category = get_val("카테고리", "분류", "Category", default="기타")
        item = get_val("항목명", "내역", "적요", "항목", default="미지정 항목")
        
        raw_amount = get_val("금액", "비용", "Amount", default="0")
        clean_amount = re.sub(r"[^0-9.-]", "", raw_amount)
        try:
            amount = int(float(clean_amount))
        except (ValueError, TypeError):
            amount = 0

        pay_method = get_val("결제수단", "결제방법", "수단", default="-")
        author = get_val("작성자", "담당자", default="-")
        note = get_val("비고", "메모", default="")

        if not date or amount <= 0:
            continue

        item_type = "수입" if "수입" in raw_type else "지출"

        transactions.append({
            "id": index,
            "date": date,
            "type": item_type,
            "category": category,
            "item": item,
            "amount": amount,
            "pay_method": pay_method,
            "author": author,
            "note": note
        })
        index += 1

    return transactions


def generate_statistics(transactions):
    """사전 집계 통계 데이터를 생성합니다."""
    total_income = 0
    total_expense = 0
    category_stats = {}
    monthly_data = {}

    for t in transactions:
        amount = t["amount"]
        month = t["date"][:7] if len(t["date"]) >= 7 else "기타"

        if month not in monthly_data:
            monthly_data[month] = {"month": month, "income": 0, "expense": 0}

        if t["type"] == "수입":
            total_income += amount
            monthly_data[month]["income"] += amount
        else:
            total_expense += amount
            monthly_data[month]["expense"] += amount
            category_stats[t["category"]] = category_stats.get(t["category"], 0) + amount

    monthly_stats = sorted(list(monthly_data.values()), key=lambda x: x["month"])

    return {
        "last_updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "summary": {
            "total_income": total_income,
            "total_expense": total_expense,
            "balance": total_income - total_expense
        },
        "category_stats": category_stats,
        "monthly_stats": monthly_stats,
        "transactions": sorted(transactions, key=lambda x: x["date"], reverse=True)
    }


def main():
    print(f"[*] 구글 시트 데이터 수집 시작: {SHEETS_CSV_URL}")
    
    try:
        csv_text = fetch_csv_content(SHEETS_CSV_URL)
        transactions = parse_and_clean_data(csv_text) if csv_text.strip() else []
    except Exception as e:
        print(f"[!] 시트 수집 오류: {e}")
        transactions = []

    # 구글 시트가 비어있거나 행이 없으면 목업 데이터 활용
    if not transactions:
        print("[!] 시트 데이터가 비어있어 data/mock_data.json 샘플을 기반으로 생성합니다.")
        if os.path.exists(MOCK_DATA_PATH):
            with open(MOCK_DATA_PATH, "r", encoding="utf-8") as f:
                transactions = json.load(f)

    result = generate_statistics(transactions)

    os.makedirs(os.path.dirname(OUTPUT_JSON_PATH), exist_ok=True)
    with open(OUTPUT_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"[+] 성공: {OUTPUT_JSON_PATH} 생성 완료 (총 {len(transactions)}건 집계)")


if __name__ == "__main__":
    main()
