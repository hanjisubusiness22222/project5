/**
 * 회계장부 통합 웹 대시보드 스크립트 (팀원 B 전담 개발)
 * - Google Sheets CSV 실시간 파싱 및 폴백 목업 지원
 * - 기간 프리셋 필터, 카테고리/구분 필터, 실시간 검색
 * - 엑셀 호환 UTF-8 BOM CSV 내보내기
 * - 다크 모드 & Chart.js 테마 반응형 차트
 * - 정렬, 페이지네이션 및 카테고리 랭킹 바
 */

// 1. Google Sheets CSV 및 목업 URL
const GOOGLE_SHEETS_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRJDia7EcGbs_WAAbeOoNHvGXuOKbGNS2G7JhmUKuPfUeVQQ_4ol4j6lygrmByCkg9D6VnSLShSqddI/pub?output=csv";
const FALLBACK_MOCK_DATA_URL = "./data/mock_data.json";

// 전역 상태
let allTransactions = [];
let filteredTransactions = [];
let monthlyChart = null;
let categoryChart = null;

// 필터 및 페이지네이션 상태
let currentPeriod = "ALL";
let currentPage = 1;
const ITEMS_PER_PAGE = 10;
let sortField = "date"; // 'date' | 'amount'
let sortOrder = "desc"; // 'asc' | 'desc'

// DOM 요소 캐싱
const totalIncomeEl = document.getElementById("totalIncome");
const totalExpenseEl = document.getElementById("totalExpense");
const totalBalanceEl = document.getElementById("totalBalance");
const incomeCountEl = document.getElementById("incomeCount");
const expenseCountEl = document.getElementById("expenseCount");
const balanceRatioEl = document.getElementById("balanceRatio");
const syncStatusEl = document.getElementById("syncStatus");
const noticeBannerEl = document.getElementById("noticeBanner");
const noticeTextEl = document.getElementById("noticeText");
const refreshBtn = document.getElementById("refreshBtn");
const transactionTbody = document.getElementById("transactionTbody");
const emptyTableState = document.getElementById("emptyTableState");
const typeFilter = document.getElementById("typeFilter");
const categoryFilter = document.getElementById("categoryFilter");
const resetFilterBtn = document.getElementById("resetFilterBtn");
const searchInput = document.getElementById("searchInput");
const filteredCountEl = document.getElementById("filteredCount");
const pageRangeEl = document.getElementById("pageRange");
const lastUpdatedEl = document.getElementById("lastUpdated");
const categoryRankingList = document.getElementById("categoryRankingList");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const currentPageIndicator = document.getElementById("currentPageIndicator");
const exportCsvBtn = document.getElementById("exportCsvBtn");
const themeToggleBtn = document.getElementById("themeToggleBtn");
const openGuideBtn = document.getElementById("openGuideBtn");
const closeGuideBtn = document.getElementById("closeGuideBtn");
const confirmGuideBtn = document.getElementById("confirmGuideBtn");
const guideModal = document.getElementById("guideModal");
const emptyResetBtn = document.getElementById("emptyResetBtn");
const sortDateHeader = document.getElementById("sortDate");
const sortAmountHeader = document.getElementById("sortAmount");

// 앱 초기화
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  setupEventListeners();
  loadData();
});

/**
 * 테마 초기화 (다크 모드 감지 및 적용)
 */
function initTheme() {
  const savedTheme = localStorage.getItem("theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (savedTheme === "dark" || (!savedTheme && prefersDark)) {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

/**
 * 이벤트 리스너 등록
 */
function setupEventListeners() {
  // 테마 토글
  themeToggleBtn.addEventListener("click", () => {
    const isDark = document.documentElement.classList.toggle("dark");
    localStorage.setItem("theme", isDark ? "dark" : "light");
    if (window.lucide) lucide.createIcons();
    updateCharts(); // 다크모드 차트 색상 재적용
  });

  // 새로고침 버튼
  refreshBtn.addEventListener("click", () => {
    refreshBtn.classList.add("animate-spin");
    loadData().finally(() => {
      setTimeout(() => refreshBtn.classList.remove("animate-spin"), 600);
    });
  });

  // 가이드 모달
  openGuideBtn.addEventListener("click", () => guideModal.classList.remove("hidden"), guideModal.classList.add("flex"));
  closeGuideBtn.addEventListener("click", () => guideModal.classList.add("hidden"), guideModal.classList.remove("flex"));
  confirmGuideBtn.addEventListener("click", () => guideModal.classList.add("hidden"), guideModal.classList.remove("flex"));
  guideModal.addEventListener("click", (e) => {
    if (e.target === guideModal) guideModal.classList.add("hidden");
  });

  // 필터 이벤트
  typeFilter.addEventListener("change", () => { currentPage = 1; applyFilters(); });
  categoryFilter.addEventListener("change", () => { currentPage = 1; applyFilters(); });
  searchInput.addEventListener("input", () => { currentPage = 1; applyFilters(); });

  // 기간 버튼 이벤트
  document.querySelectorAll(".period-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      document.querySelectorAll(".period-btn").forEach(b => {
        b.className = "period-btn px-2.5 py-1 rounded-md text-slate-600 dark:text-slate-300 hover:text-slate-900";
      });
      e.target.className = "period-btn px-2.5 py-1 rounded-md bg-indigo-600 text-white";
      currentPeriod = e.target.getAttribute("data-period");
      currentPage = 1;
      applyFilters();
    });
  });

  // 초기화 버튼
  const resetAllFilters = () => {
    typeFilter.value = "ALL";
    categoryFilter.value = "ALL";
    searchInput.value = "";
    currentPeriod = "ALL";
    document.querySelectorAll(".period-btn").forEach(b => {
      b.className = b.getAttribute("data-period") === "ALL" 
        ? "period-btn px-2.5 py-1 rounded-md bg-indigo-600 text-white"
        : "period-btn px-2.5 py-1 rounded-md text-slate-600 dark:text-slate-300 hover:text-slate-900";
    });
    currentPage = 1;
    applyFilters();
  };
  resetFilterBtn.addEventListener("click", resetAllFilters);
  emptyResetBtn.addEventListener("click", resetAllFilters);

  // 정렬 헤더
  sortDateHeader.addEventListener("click", () => {
    if (sortField === "date") {
      sortOrder = sortOrder === "asc" ? "desc" : "asc";
    } else {
      sortField = "date";
      sortOrder = "desc";
    }
    applyFilters();
  });

  sortAmountHeader.addEventListener("click", () => {
    if (sortField === "amount") {
      sortOrder = sortOrder === "asc" ? "desc" : "asc";
    } else {
      sortField = "amount";
      sortOrder = "desc";
    }
    applyFilters();
  });

  // 페이지네이션
  prevPageBtn.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      renderTable();
    }
  });

  nextPageBtn.addEventListener("click", () => {
    const maxPage = Math.ceil(filteredTransactions.length / ITEMS_PER_PAGE) || 1;
    if (currentPage < maxPage) {
      currentPage++;
      renderTable();
    }
  });

  // CSV 추출
  exportCsvBtn.addEventListener("click", exportToCSV);
}

/**
 * 데이터 로드 (구글 시트 -> 목업 폴백)
 */
async function loadData() {
  updateSyncStatus("loading", "시트 연동 확인 중...");
  
  try {
    const timestamp = Date.now();
    const response = await fetch(`${GOOGLE_SHEETS_CSV_URL}&_t=${timestamp}`);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const csvText = await response.text();
    
    // 내용이 비어있는지 확인
    if (!csvText || csvText.trim().length === 0) {
      console.warn("구글 시트가 비어있어 샘플 모드로 로드합니다.");
      await loadMockData(true, "구글 시트가 비어 있어 샘플(데모) 데이터로 표시 중입니다. 시트에 행을 입력하고 새로고침을 누르세요.");
      return;
    }

    // CSV 파싱
    Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      complete: function(results) {
        const parsed = parseRawSheetData(results.data);
        if (!parsed || parsed.length === 0) {
          loadMockData(true, "시트에 유효한 데이터 행이 없어 샘플 데이터로 표시 중입니다.");
        } else {
          allTransactions = parsed;
          onDataLoaded(false);
        }
      },
      error: function(err) {
        console.error("CSV 파싱 에러:", err);
        loadMockData(true, "시트 데이터 해석 중 오류가 발생하여 샘플 모드로 전환되었습니다.");
      }
    });

  } catch (err) {
    console.error("구글 시트 Fetch 오류:", err);
    await loadMockData(true, "구글 시트 통신 오류로 인해 샘플 모드로 동작 중입니다.");
  }
}

/**
 * 샘플 목업 데이터 로드 (내장 더미 데이터 백업 포함)
 */
async function loadMockData(showBanner = false, message = "") {
  try {
    const res = await fetch(FALLBACK_MOCK_DATA_URL);
    if (!res.ok) throw new Error("mock file not found");
    const data = await res.json();
    allTransactions = data;
    onDataLoaded(showBanner, message);
  } catch (error) {
    console.warn("로컬 fetch 제한 또는 네트워크 오류로 내장 더미 데이터를 로드합니다:", error);
    // 내장 기본 더미 데이터 (CORS나 로컬 file:// 실행 시에도 완벽 보장)
    allTransactions = [
      { id: 1, date: "2026-01-05", type: "수입", category: "지원금", item: "2026년 1학기 학과 연구 프로젝트 지원금", amount: 2500000, pay_method: "계좌이체", author: "김연구", note: "학과 사무실 입금" },
      { id: 2, date: "2026-01-08", type: "지출", category: "비품", item: "연구실 공용 듀얼 모니터 및 거치대", amount: 340000, pay_method: "법인카드", author: "이학생", note: "쿠팡 로켓배송" },
      { id: 3, date: "2026-01-15", type: "지출", category: "식비", item: "1월 착수 회의 및 식대", amount: 92000, pay_method: "법인카드", author: "김연구", note: "팀원 4인" },
      { id: 4, date: "2026-01-22", type: "지출", category: "도서/인쇄", item: "AI 및 클라우드 전문 서적 3권", amount: 88000, pay_method: "체크카드", author: "박개발", note: "교보문고" },
      { id: 5, date: "2026-02-02", type: "수입", category: "회비", item: "프로젝트 팀원 상반기 회비", amount: 400000, pay_method: "계좌이체", author: "최총무", note: "8명 완납" },
      { id: 6, date: "2026-02-10", type: "지출", category: "소프트웨어", item: "GitHub Team & 도메인 1년 갱신", amount: 145000, pay_method: "법인카드", author: "박개발", note: "해외결제" },
      { id: 7, date: "2026-02-14", type: "지출", category: "식비", item: "스프린트 개발 다과 및 커피", amount: 42000, pay_method: "개인카드", author: "이학생", note: "스타벅스" },
      { id: 8, date: "2026-02-20", type: "지출", category: "교통비", item: "개발자 세미나 참석 대중교통비", amount: 26000, pay_method: "개인카드", author: "박개발", note: "KTX 증빙" },
      { id: 9, date: "2026-03-03", type: "수입", category: "지원금", item: "산학협력 혁신인재 장려금 1차", amount: 1200000, pay_method: "계좌이체", author: "김연구", note: "산학협력단" },
      { id: 10, date: "2026-03-08", type: "지출", category: "식비", item: "1학기 개강 및 킥오프 회식", amount: 165000, pay_method: "법인카드", author: "김연구", note: "6인 회식" },
      { id: 11, date: "2026-03-12", type: "지출", category: "소프트웨어", item: "OpenAI API 크레딧 충전 ($50)", amount: 69000, pay_method: "법인카드", author: "박개발", note: "모델 테스트" },
      { id: 12, date: "2026-03-16", type: "지출", category: "도서/인쇄", item: "중간 보고서 제본 인쇄", amount: 54000, pay_method: "체크카드", author: "이학생", note: "교내 복사실" },
      { id: 13, date: "2026-03-25", type: "지출", category: "비품", item: "연구실 무선 멀티탭 및 정리함", amount: 31000, pay_method: "법인카드", author: "최총무", note: "다이소" },
      { id: 14, date: "2026-04-02", type: "수입", category: "기타수입", item: "교내 아이디어 공모전 장려상 상금", amount: 300000, pay_method: "계좌이체", author: "김연구", note: "공용 통장" },
      { id: 15, date: "2026-04-06", type: "지출", category: "식비", item: "공모전 수상 기념 피자 파티", amount: 78000, pay_method: "법인카드", author: "최총무", note: "팀 축하" }
    ];
    onDataLoaded(showBanner, message || "샘플(데모) 회계 데이터가 활성화되었습니다.");
  }
}

/**
 * 원본 시트 데이터 정제 (다양한 헤더 명칭 호환)
 */
function parseRawSheetData(rows) {
  return rows.map((row, index) => {
    // 키 정규화
    const getVal = (...keys) => {
      for (const k of keys) {
        if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== "") {
          return String(row[k]).trim();
        }
      }
      return "";
    };

    const date = getVal("일자", "날짜", "거래일자", "일시", "Date", "date");
    const rawType = getVal("구분", "종류", "Type", "type");
    const category = getVal("카테고리", "분류", "항목분류", "Category", "category") || "기타";
    const item = getVal("항목명", "내역", "적요", "항목", "내용", "Item", "item") || "미지정 내역";
    
    let rawAmount = getVal("금액", "비용", "출금액", "입금액", "Amount", "amount");
    rawAmount = rawAmount.replace(/[^0-9.-]+/g, "");
    const amount = Number(rawAmount) || 0;

    const payMethod = getVal("결제수단", "결제방법", "수단", "지불방법") || "-";
    const author = getVal("작성자", "담당자", "기록자") || "-";
    const note = getVal("비고", "메모", "비고사항", "Note", "note") || "";

    const type = rawType.includes("수입") || rawType.toLowerCase() === "income" ? "수입" : "지출";

    return {
      id: index + 1,
      date,
      type,
      category,
      item,
      amount,
      pay_method: payMethod,
      author,
      note
    };
  }).filter(t => t.date && t.amount > 0);
}

/**
 * 데이터 로드 완료 콜백
 */
function onDataLoaded(isDemo = false, bannerMsg = "") {
  if (isDemo) {
    noticeBannerEl.classList.remove("hidden");
    if (bannerMsg) noticeTextEl.textContent = bannerMsg;
    updateSyncStatus("demo", "샘플 데이터 모드");
  } else {
    noticeBannerEl.classList.add("hidden");
    updateSyncStatus("live", "구글 시트 실시간 연결");
  }

  populateCategoryFilter();
  applyFilters();

  const now = new Date();
  lastUpdatedEl.textContent = `최종 갱신: ${now.toLocaleTimeString("ko-KR")}`;
  if (window.lucide) lucide.createIcons();
}

/**
 * 카테고리 필터 옵션 구성
 */
function populateCategoryFilter() {
  const currentVal = categoryFilter.value;
  const categories = Array.from(new Set(allTransactions.map(t => t.category))).filter(Boolean);
  
  categoryFilter.innerHTML = '<option value="ALL">모든 카테고리</option>';
  categories.forEach(cat => {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    categoryFilter.appendChild(opt);
  });

  if (categories.includes(currentVal)) {
    categoryFilter.value = currentVal;
  }
}

/**
 * 필터 적용 및 데이터 가공
 */
function applyFilters() {
  const selectedType = typeFilter.value;
  const selectedCat = categoryFilter.value;
  const searchQuery = searchInput.value.toLowerCase().trim();

  // 날짜 기준 계산
  const now = new Date();
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const currentYear = `${now.getFullYear()}`;

  // 최근 3개월 시작월
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(now.getMonth() - 2);
  const threeMonthsStr = `${threeMonthsAgo.getFullYear()}-${String(threeMonthsAgo.getMonth() + 1).padStart(2, "0")}`;

  filteredTransactions = allTransactions.filter(item => {
    // 구분 필터
    if (selectedType !== "ALL" && item.type !== selectedType) return false;

    // 카테고리 필터
    if (selectedCat !== "ALL" && item.category !== selectedCat) return false;

    // 기간 프리셋 필터
    if (currentPeriod === "THIS_MONTH") {
      if (!item.date.startsWith(currentYearMonth)) return false;
    } else if (currentPeriod === "LAST_3_MONTHS") {
      const itemMonth = item.date.substring(0, 7);
      if (itemMonth < threeMonthsStr || itemMonth > currentYearMonth) return false;
    } else if (currentPeriod === "THIS_YEAR") {
      if (!item.date.startsWith(currentYear)) return false;
    }

    // 검색어 필터
    if (searchQuery) {
      const match = item.item.toLowerCase().includes(searchQuery) ||
                    item.note.toLowerCase().includes(searchQuery) ||
                    item.author.toLowerCase().includes(searchQuery) ||
                    item.category.toLowerCase().includes(searchQuery) ||
                    item.pay_method.toLowerCase().includes(searchQuery);
      if (!match) return false;
    }

    return true;
  });

  // 정렬 적용
  filteredTransactions.sort((a, b) => {
    if (sortField === "amount") {
      return sortOrder === "asc" ? a.amount - b.amount : b.amount - a.amount;
    }
    // 기본 date
    const dateComp = new Date(b.date) - new Date(a.date);
    return sortOrder === "asc" ? -dateComp : dateComp;
  });

  // 정렬 헤더 화살표 표기
  sortDateHeader.textContent = `일자 ${sortField === "date" ? (sortOrder === "asc" ? "▲" : "▼") : "↕"}`;
  sortAmountHeader.textContent = `금액 ${sortField === "amount" ? (sortOrder === "asc" ? "▲" : "▼") : "↕"}`;

  updateKPICards();
  updateCharts();
  renderCategoryRanking();
  renderTable();
}

/**
 * KPI 요약 카드 계산 & 갱신
 */
function updateKPICards() {
  let income = 0;
  let expense = 0;
  let incCount = 0;
  let expCount = 0;

  // 전체 거래 기준 (혹은 필터 기준 선택 가능하나 보통 전체 자금 흐름을 표시)
  allTransactions.forEach(t => {
    if (t.type === "수입") {
      income += t.amount;
      incCount++;
    } else {
      expense += t.amount;
      expCount++;
    }
  });

  const balance = income - expense;
  const ratio = income > 0 ? ((expense / income) * 100).toFixed(1) : 0;

  animateValue(totalIncomeEl, income);
  animateValue(totalExpenseEl, expense);
  animateValue(totalBalanceEl, balance);

  incomeCountEl.textContent = `총 ${incCount}건의 수입 내역`;
  expenseCountEl.textContent = `총 ${expCount}건의 지출 내역`;
  balanceRatioEl.textContent = `수입 대비 지출 소진율 ${ratio}%`;

  if (balance < 0) {
    totalBalanceEl.className = "text-2xl sm:text-3xl font-extrabold text-rose-600 dark:text-rose-400 tracking-tight";
  } else {
    totalBalanceEl.className = "text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight";
  }
}

/**
 * 숫자 애니메이션 카운트업
 */
function animateValue(element, endVal, duration = 400) {
  const startVal = 0;
  const startTime = performance.now();

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const current = Math.floor(startVal + (endVal - startVal) * progress);
    element.textContent = `${current.toLocaleString("ko-KR")}원`;
    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      element.textContent = `${endVal.toLocaleString("ko-KR")}원`;
    }
  }
  requestAnimationFrame(update);
}

/**
 * Chart.js 차트 렌더링
 */
function updateCharts() {
  const isDark = document.documentElement.classList.contains("dark");
  const textColor = isDark ? "#94a3b8" : "#64748b";
  const gridColor = isDark ? "#334155" : "#f1f5f9";

  // 1. 월별 수입/지출 집계
  const monthlyData = {};
  allTransactions.forEach(t => {
    const month = t.date.substring(0, 7) || "기타";
    if (!monthlyData[month]) {
      monthlyData[month] = { income: 0, expense: 0 };
    }
    if (t.type === "수입") {
      monthlyData[month].income += t.amount;
    } else {
      monthlyData[month].expense += t.amount;
    }
  });

  const sortedMonths = Object.keys(monthlyData).sort();
  const incomeList = sortedMonths.map(m => monthlyData[m].income);
  const expenseList = sortedMonths.map(m => monthlyData[m].expense);

  const monthlyCtx = document.getElementById("monthlyChart").getContext("2d");
  if (monthlyChart) monthlyChart.destroy();

  monthlyChart = new Chart(monthlyCtx, {
    type: "bar",
    data: {
      labels: sortedMonths,
      datasets: [
        {
          label: "수입",
          data: incomeList,
          backgroundColor: "#10b981",
          borderRadius: 6,
          barPercentage: 0.6
        },
        {
          label: "지출",
          data: expenseList,
          backgroundColor: "#f43f5e",
          borderRadius: 6,
          barPercentage: 0.6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "top",
          labels: { color: textColor, boxWidth: 12, font: { family: "Pretendard" } }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${Number(ctx.raw).toLocaleString()}원`
          }
        }
      },
      scales: {
        y: {
          ticks: {
            color: textColor,
            callback: (val) => val >= 10000 ? `${(val / 10000).toLocaleString()}만원` : `${val}원`
          },
          grid: { color: gridColor }
        },
        x: {
          ticks: { color: textColor },
          grid: { display: false }
        }
      }
    }
  });

  // 2. 카테고리별 지출 비율 집계
  const categoryMap = {};
  allTransactions.filter(t => t.type === "지출").forEach(t => {
    categoryMap[t.category] = (categoryMap[t.category] || 0) + t.amount;
  });

  const catLabels = Object.keys(categoryMap);
  const catValues = Object.values(categoryMap);
  const categoryCtx = document.getElementById("categoryChart").getContext("2d");

  if (categoryChart) categoryChart.destroy();

  const palette = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#14b8a6", "#f97316"];

  categoryChart = new Chart(categoryCtx, {
    type: "doughnut",
    data: {
      labels: catLabels,
      datasets: [
        {
          data: catValues,
          backgroundColor: palette.slice(0, catLabels.length),
          borderWidth: 2,
          borderColor: isDark ? "#1e293b" : "#ffffff"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${Number(ctx.raw).toLocaleString()}원`
          }
        }
      },
      cutout: "70%"
    }
  });
}

/**
 * 카테고리 지출 순위 랭킹 바 렌더링
 */
function renderCategoryRanking() {
  categoryRankingList.innerHTML = "";
  
  const categoryMap = {};
  let totalExpense = 0;

  allTransactions.filter(t => t.type === "지출").forEach(t => {
    categoryMap[t.category] = (categoryMap[t.category] || 0) + t.amount;
    totalExpense += t.amount;
  });

  const sortedCats = Object.entries(categoryMap).sort((a, b) => b[1] - a[1]);

  if (sortedCats.length === 0) {
    categoryRankingList.innerHTML = '<p class="text-xs text-slate-400 text-center py-2">지출 내역이 없습니다.</p>';
    return;
  }

  const colors = ["bg-indigo-500", "bg-pink-500", "bg-amber-500", "bg-emerald-500", "bg-blue-500"];

  sortedCats.forEach(([cat, amount], idx) => {
    const percent = totalExpense > 0 ? ((amount / totalExpense) * 100).toFixed(1) : 0;
    const color = colors[idx % colors.length];

    const row = document.createElement("div");
    row.className = "text-xs space-y-1";
    row.innerHTML = `
      <div class="flex justify-between items-center text-slate-700 dark:text-slate-300">
        <span class="font-medium">${cat}</span>
        <span class="text-slate-500 dark:text-slate-400">${Number(amount).toLocaleString()}원 (${percent}%)</span>
      </div>
      <div class="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
        <div class="${color} h-1.5 rounded-full transition-all duration-500" style="width: ${percent}%"></div>
      </div>
    `;
    categoryRankingList.appendChild(row);
  });
}

/**
 * 테이블 렌더링 (페이지네이션 적용)
 */
function renderTable() {
  transactionTbody.innerHTML = "";
  const totalCount = filteredTransactions.length;
  filteredCountEl.textContent = totalCount;

  if (totalCount === 0) {
    emptyTableState.classList.remove("hidden");
    pageRangeEl.textContent = "0-0";
    currentPageIndicator.textContent = "0 / 0";
    prevPageBtn.disabled = true;
    nextPageBtn.disabled = true;
    return;
  }
  emptyTableState.classList.add("hidden");

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);
  if (currentPage > totalPages) currentPage = totalPages;

  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, totalCount);
  const currentRows = filteredTransactions.slice(startIndex, endIndex);

  pageRangeEl.textContent = `${startIndex + 1}-${endIndex}`;
  currentPageIndicator.textContent = `${currentPage} / ${totalPages}`;
  prevPageBtn.disabled = currentPage === 1;
  nextPageBtn.disabled = currentPage === totalPages;

  currentRows.forEach(t => {
    const isIncome = t.type === "수입";
    const tr = document.createElement("tr");
    tr.className = "hover:bg-slate-50/80 dark:hover:bg-slate-750 transition duration-100";

    const badgeColor = isIncome 
      ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800" 
      : "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800";

    const amountColor = isIncome 
      ? "text-emerald-600 dark:text-emerald-400 font-semibold" 
      : "text-rose-600 dark:text-rose-400 font-semibold";

    const amountPrefix = isIncome ? "+" : "-";

    tr.innerHTML = `
      <td class="px-5 py-3.5 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400 font-mono">${t.date}</td>
      <td class="px-4 py-3.5 whitespace-nowrap">
        <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${badgeColor}">
          ${t.type}
        </span>
      </td>
      <td class="px-4 py-3.5 whitespace-nowrap text-xs font-medium text-slate-700 dark:text-slate-200">
        <span class="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
          ${t.category}
        </span>
      </td>
      <td class="px-5 py-3.5 text-xs text-slate-800 dark:text-slate-100 font-medium">${escapeHtml(t.item)}</td>
      <td class="px-5 py-3.5 whitespace-nowrap text-xs text-right font-mono ${amountColor}">
        ${amountPrefix}${Number(t.amount).toLocaleString()}원
      </td>
      <td class="px-4 py-3.5 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">${escapeHtml(t.pay_method)}</td>
      <td class="px-4 py-3.5 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">${escapeHtml(t.author)}</td>
      <td class="px-5 py-3.5 text-xs text-slate-400 dark:text-slate-500 max-w-xs truncate" title="${escapeHtml(t.note)}">
        ${escapeHtml(t.note) || "-"}
      </td>
    `;
    transactionTbody.appendChild(tr);
  });

  if (window.lucide) lucide.createIcons();
}

/**
 * 현재 필터링된 데이터를 UTF-8 BOM CSV로 내보내기
 */
function exportToCSV() {
  if (filteredTransactions.length === 0) {
    alert("내보낼 데이터가 없습니다.");
    return;
  }

  const headers = ["일자", "구분", "카테고리", "항목명", "금액", "결제수단", "작성자", "비고"];
  const rows = filteredTransactions.map(t => [
    `"${t.date}"`,
    `"${t.type}"`,
    `"${t.category}"`,
    `"${t.item.replace(/"/g, '""')}"`,
    t.amount,
    `"${t.pay_method}"`,
    `"${t.author}"`,
    `"${(t.note || '').replace(/"/g, '""')}"`
  ]);

  const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(r => r.join(","))].join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement("a");
  const today = new Date().toISOString().substring(0, 10);
  link.setAttribute("href", url);
  link.setAttribute("download", `회계장부_추출_${today}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * 상태 배지 업데이트
 */
function updateSyncStatus(status, text) {
  if (status === "loading") {
    syncStatusEl.className = "inline-flex items-center px-2.5 py-1.5 rounded-lg font-medium bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800";
    syncStatusEl.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-blue-500 mr-1.5 animate-ping"></span>${text}`;
  } else if (status === "live") {
    syncStatusEl.className = "inline-flex items-center px-2.5 py-1.5 rounded-lg font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800";
    syncStatusEl.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5"></span>${text}`;
  } else if (status === "demo") {
    syncStatusEl.className = "inline-flex items-center px-2.5 py-1.5 rounded-lg font-medium bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800";
    syncStatusEl.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1.5"></span>${text}`;
  } else {
    syncStatusEl.className = "inline-flex items-center px-2.5 py-1.5 rounded-lg font-medium bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800";
    syncStatusEl.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-rose-500 mr-1.5"></span>${text}`;
  }
}

/**
 * HTML Escape
 */
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
