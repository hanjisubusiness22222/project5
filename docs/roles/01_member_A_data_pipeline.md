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
- [ ] Google Sheets API 연동 인증 로직 구현 (환경변수로 전달된 서비스 계정 JSON 로드)
- [ ] 시트 내 원본 데이터 가져오기
- [ ] 데이터 정제 및 유효성 검사
  - 날짜 형식 통일 (`YYYY-MM-DD`)
  - 금액 콤마 제거 및 정수형 변환 (`10,000` -> `10000`)
  - 빈 행 및 결측값 예외 처리
- [ ] 사전 집계 데이터 생성
  - 총 수입, 총 지출, 현재 잔액 계산
  - 월별 수입/지출 추이 데이터 집계
  - 카테고리별 지출 비율 집계
- [ ] 프론트엔드용 JSON 파일 내보내기 (`data/accounting_data.json`)

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
- [ ] 트리거 설정:
  - `schedule`: 매일 자정 또는 매 6시간마다 실행 (`cron: '0 0 * * *'`)
  - `workflow_dispatch`: GitHub 저장소 Actions 탭에서 버튼 클릭 시 즉시 수동 실행
  - `push` (main 브랜치 코드 수정 시)
- [ ] 파이프라인 단계:
  1. 저장소 Checkout
  2. Python/Node.js 환경 세팅 및 의존성 캐싱
  3. `fetch_data.py` 실행 (Secrets 주입)
  4. 프론트엔드 정적 파일 빌드 (필요시)
  5. GitHub Pages 배포 (`actions/deploy-pages@v4` 활용)

---

## 🤝 협업 포인트
- **팀원 C와 협의:** 시트 ID, 서비스 계정 권한 확인 및 Secrets 키 명칭 통일
- **팀원 B와 협의:** 프론트엔드에서 렌더링하기 편한 JSON 구조 사전 조율
