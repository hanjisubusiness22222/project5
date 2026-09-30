# 👤 팀원 A: 데이터 파이프라인 & CI/CD (Data Pipeline & CI/CD)

> **핵심 미션:** 구글 시트 원본 데이터를 정제하여 프론트엔드가 바로 사용할 수 있는 JSON 데이터로 변환하고, 이를 주기적/수동으로 자동 실행하는 GitHub Actions 워크플로우를 구축합니다.

---

## 🛠️ 권장 기술 스택
- **언어:** Python 3.10+ (또는 Node.js 18+)
- **핵심 라이브러리 (Python 기준):**
  - `gspread` 또는 `google-api-python-client` (시트 연동)
  - `pandas` (데이터 클렌징 및 요약 집계)
- **CI/CD:** GitHub Actions (Ubuntu 최신 환경)

---

## 📋 세부 업무 및 태스크 목록

### 1. 데이터 추출 및 전처리 스크립트 개발 (`scripts/fetch_data.py`)

- **연동 대상 시트 CSV 엔드포인트:**
  `https://docs.google.com/spreadsheets/d/e/2PACX-1vRJDia7EcGbs_WAAbeOoNHvGXuOKbGNS2G7JhmUKuPfUeVQQ_4ol4j6lygrmByCkg9D6VnSLShSqddI/pub?gid=0&single=true&output=csv`
- [x] 시트 CSV URL을 통한 원본 데이터 수집 (표준 라이브러리만 사용, 설치 불필요)
- [x] 데이터 정제 및 유효성 검사
  - 날짜 형식 통일 (`YYYY-MM-DD`) — `2026. 3. 5`, `2026/03/05`, `2026년 3월 5일` 등 지원
  - 금액 콤마 제거 및 정수형 변환 (`10,000`, `₩10,000`, `10000원` -> `10000`)
  - 빈 행은 무시, 날짜/구분/금액이 잘못된 행은 건너뛰고 몇 번째 행인지 경고 출력
  - 헤더 별칭 지원 (`날짜`, `분류`, `내역`, `담당자` 등 — `js/app.js`와 동일)
- [x] 사전 집계 데이터 생성
  - 총 수입, 총 지출, 현재 잔액 계산
  - 월별 수입/지출 추이 데이터 집계
  - 카테고리별 지출 합계 집계 (금액 큰 순)
- [x] 프론트엔드용 JSON 파일 내보내기 (`data/accounting_data.json`)
  - 시트에 유효한 행이 없으면 `data/mock_data.json`으로 대체 (`"source": "mock"`)
  - 시트 접속 실패 시에는 실패 처리 → 기존 배포본 유지
- [x] 단위 테스트 (`tests/test_fetch_data.py`)

#### ▶️ 실행 방법
```bash
python scripts/fetch_data.py                     # 공용 시트에서 수집
python scripts/fetch_data.py --csv 파일.csv       # 로컬 CSV로 테스트
python scripts/fetch_data.py --strict            # 잘못된 행이 있으면 실패 처리
python -m unittest discover -s tests             # 테스트 실행
```

#### 📄 최종 출력 JSON 스키마 예시
```json
{
  "last_updated": "2026-09-30 16:00:00",
  "summary": {
    "total_income": 3500000,
    "total_expense": 1820000,
    "balance": 1680000
  },
  "monthly_stats": [
    { "month": "2026-01", "income": 1000000, "expense": 500000 },
    { "month": "2026-02", "income": 1200000, "expense": 620000 }
  ],
  "category_stats": {
    "식비": 650000,
    "비품": 320000,
    "교통비": 150000
  },
  "transactions": [
    {
      "id": 1,
      "date": "2026-02-15",
      "type": "지출",
      "category": "식비",
      "item": "팀 회식",
      "amount": 120000,
      "pay_method": "법인카드",
      "note": "프로젝트 킥오프"
    }
  ]
}
```

---

### 2. GitHub Actions 워크플로우 구성 (`.github/workflows/deploy.yml`)
- [x] 트리거 설정:
  - `schedule`: 매 6시간마다 실행 (`cron: '0 */6 * * *'`, KST 03/09/15/21시)
  - `workflow_dispatch`: GitHub 저장소 Actions 탭에서 버튼 클릭 시 즉시 수동 실행
  - `push` (main 브랜치 코드 수정 시)
  - `pull_request` (main 대상 PR: 테스트 + 데이터 수집만, 배포 안 함)
- [x] 파이프라인 단계:
  1. 저장소 Checkout
  2. Python 환경 세팅 (외부 의존성 없음 — 공개 CSV 사용으로 Secrets 불필요)
  3. 단위 테스트 실행
  4. `fetch_data.py` 실행 → `data/accounting_data.json` 갱신
  5. 저장소 루트(정적 대시보드) 그대로 GitHub Pages 배포 (`actions/deploy-pages@v4`)

---

## 🤝 협업 포인트
- **팀원 C와 협의:** 시트 ID, 서비스 계정 권한 확인 및 Secrets 키 명칭 통일
- **팀원 B와 협의:** 프론트엔드에서 렌더링하기 편한 JSON 구조 사전 조율
