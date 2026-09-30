# 📊 Google Sheets 연동 회계장부 대시보드 프로젝트

> **구글 시트(Google Sheets)로 관리하는 회계 데이터를 GitHub Actions를 통해 자동으로 수집/정제하고, GitHub Pages로 시각화하여 함께 조회하는 대시보드 웹 서비스**

---

## 📌 프로젝트 개요

- **목적:** 팀/동아리/프로젝트의 구글 시트 회계장부를 별도의 서버 비용 없이 GitHub Pages 웹 대시보드로 실시간 동기화하여 투명하고 직관적으로 열람
- **아키텍처:**
  - **Data Source:** Google Sheets (회계장부 원본)
  - **CI/CD & Automation:** GitHub Actions (주기적 데이터 동기화 및 자동 빌드/배포)
  - **Frontend / Hosting:** HTML/CSS/JS (or Vite + React) & GitHub Pages

---

## 🔗 프로젝트 공용 구글 시트 링크

모든 팀원이 공통으로 사용하고 조회하는 회계장부 원본 링크입니다:

- 📊 **[구글 시트 웹 열람 페이지 (HTML)](https://docs.google.com/spreadsheets/d/e/2PACX-1vRJDia7EcGbs_WAAbeOoNHvGXuOKbGNS2G7JhmUKuPfUeVQQ_4ol4j6lygrmByCkg9D6VnSLShSqddI/pubhtml)**
- 📥 **[실시간 CSV 데이터 엔드포인트](https://docs.google.com/spreadsheets/d/e/2PACX-1vRJDia7EcGbs_WAAbeOoNHvGXuOKbGNS2G7JhmUKuPfUeVQQ_4ol4j6lygrmByCkg9D6VnSLShSqddI/pub?gid=0&single=true&output=csv)**

> [!NOTE]
> 위 링크는 "웹에 게시"된 공개 엔드포인트이므로, 팀원 누구나 브라우저에서 바로 열람하거나 스크립트/API로 CSV 데이터를 불러올 수 있습니다.

---

## 🏗️ 전체 시스템 흐름도

```mermaid
flowchart LR
    A["📄 Google Sheets<br/>(회계장부 원본)"] -->|Sheets API / CSV Export| B["⚙️ GitHub Actions<br/>(데이터 수집 & 전처리)"]
    B -->|정제된 JSON 데이터 생성| C["🌐 GitHub Pages<br/>(웹 대시보드 호스팅)"]
    C -->|시각화 / 조회| D["👥 사용자 & 팀원"]
```

---

## 👥 3인 업무 분담 요약

각 팀원의 상세 업무 명세서 및 가이드는 아래 링크된 문서에서 확인하실 수 있습니다.

| 역할 | 담당 팀원 | 핵심 업무 요약 | 상세 가이드 문서 |
| :--- | :--- | :--- | :--- |
| **Data & CI/CD** | **팀원 A** | 구글 시트 데이터 추출 스크립트 개발, 데이터 전처리(JSON화), GitHub Actions 자동 배포 파이프라인 구축 | [팀원 A 상세 가이드](docs/roles/01_member_A_data_pipeline.md) |
| **Frontend UI** | **팀원 B** | 대시보드 화면 설계, 수입/지출 요약 카드, 차트 시각화(월별/카테고리별), 필터 및 검색 기능 구현 | [팀원 B 상세 가이드](docs/roles/02_member_B_frontend.md) |
| **Schema & Ops/QA**| **팀원 C** | 구글 시트 입력 스키마 정의/유효성 검사, GCP API 및 GitHub Secrets 보안 설정, 배포 환경 세팅, 테스트/문서화 | [팀원 C 상세 가이드](docs/roles/03_member_C_infrastructure_qa.md) |

👉 전체 마일스톤 및 협업 규칙은 [ROLES.md](ROLES.md)를 참고하세요.

---

## 🚀 빠른 시작 가이드 (진행 순서)

1. **[Step 1] 팀원 C:** 구글 시트 기본 양식(열 구조) 정의 및 템플릿 생성, GCP 인증 키 발급
2. **[Step 2] 팀원 B:** 목업 데이터(`mock_data.json`)를 기반으로 프론트엔드 대시보드 UI 개발 착수
3. **[Step 3] 팀원 A:** 팀원 C의 시트 양식을 바탕으로 데이터 추출 스크립트 작성 및 GitHub Actions 워크플로우 구성
4. **[Step 4] 다함께:** 데이터 파이프라인과 프론트엔드 연동 테스트, GitHub Pages 배포 확인 및 QA
