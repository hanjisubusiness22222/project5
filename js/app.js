/**
 * 회계장부 웹 대시보드 스크립트 (팀원 B)
 */

// 1. 구글 시트 웹 게시 CSV 링크
const GOOGLE_SHEETS_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRJDia7EcGbs_WAAbeOoNHvGXuOKbGNS2G7JhmUKuPfUeVQQ_4ol4j6lygrmByCkg9D6VnSLShSqddI/pub?output=csv";
const FALLBACK_MOCK_DATA_URL = "./data/mock_data.json";

// 전역 상태
let allTransactions = [];
let filteredTransactions = [];
let monthlyChart = null;
let categoryChart = null;

// DOM 요소
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
const lastUpdatedEl = document.getElementById("lastUpdated");

// 초기 실행
document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) lucide.createIcons();
  loadData();
  setupEventListeners();
});

// 이벤트 리스너 설정
function setupEventListeners() {
  refreshBtn.addEventListener("click", () => {
    refreshBtn.classList.add("animate-spin");
    loadData().finally(() => {
      setTimeout(() => refreshBtn.classList.remove("animate-spin"), 600);
    });
  });

  typeFilter.addEventListener("change", applyFilters);
  categoryFilter.addEventListener("change", applyFilters);
  searchInput.addEventListener("input", applyFilters);
  resetFilterBtn.addEventListener("click", () => {
    typeFilter.value = "ALL";
    categoryFilter.value = "ALL";
    searchInput.value = "";
    applyFilters();
  });
}

/**
 * 데이터 로드 (구글 시트 CSV 시도 -> 비어있으면 목업 JSON 로드)
 */
async function loadData() {
  updateSyncStatus("loading", "동기화 중...");
  
  try {
    // 1. Google Sheets CSV 가져오기 시도 (캐시 방지 타임스탬프)
    const timestamp = new Date().getTime();
    const response = await fetch(`${GOOGLE_SHEETS_CSV_URL}&_t=${timestamp}`);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const csvText = await response.text();
    
    // 시트가 비어있는지 확인 (공백 제거 후 길이 체크)
    if (!csvText || csvText.trim().length === 0) {
      console.warn("구글 시트 내용이 비어있어 샘플 데이터를 사용합니다.");
      await loadMockData(true, "구글 시트가 현재 비어있어 미리보기용 샘플 데이터를 표시 중입니다. 시트에 행을 입력하면 실시간으로 반영됩니다.");
      return;
    }

    // 2. CSV 파싱
    Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      complete: function(results) {
        const parsed = parseRawSheetData(results.data);
        if (parsed.length === 0) {
          loadMockData(true, "구글 시트에 유효한 데이터 행이 없어 샘플 데이터를 표시합니다.");
        } else {
          allTransactions = parsed;
          onDataLoaded(false);
        }
      },
      error: function(err) {
        console.error("CSV 파싱 에러:", err);
        loadMockData(true, "시트 파싱 중 오류가 발생하여 샘플 데이터를 로드했습니다.");
      }
    });

  } catch (err) {
    console.error("구글 시트 fetch 실패:", err);
    await loadMockData(true, "구글 시트 연동 실패로 인해 샘플 모드로 전환되었습니다.");
  }
}

/**
 * 샘플 목업 데이터 로드
 */
async function loadMockData(showBanner = false, message = "") {
  try {
    const res = await fetch(FALLBACK_MOCK_DATA_URL);
    const data = await res.json();
    allTransactions = data;
    onDataLoaded(showBanner, message);
  } catch (error) {
    console.error("목업 데이터 로드 실패:", error);
    updateSyncStatus("error", "데이터 로드 실패");
  }
}

/**
 * 원본 시트 데이터 정제 (열 이름 매핑 및 형식 표준화)
 */
function parseRawSheetData(rows) {
  return rows.map((row, index) => {
    // 다양한 열 헤더 명칭 허용 (일자, 날짜, Date 등)
    const date = row["일자"] || row["날짜"] || row["Date"] || row["date"] || "";
    const type = (row["구분"] || row["Type"] || row["type"] || "지출").trim();
    const category = (row["카테고리"] || row["분류"] || row["Category"] || "기타").trim();
    const item = row["항목명"] || row["내역"] || row["적요"] || row["항목"] || row["Item"] || "미지정 항목";
    
    // 금액 정제: 쉼표, 원, 공백 제거 후 숫자로 변환
    let rawAmount = row["금액"] || row["Amount"] || row["amount"] || 0;
    if (typeof rawAmount === "string") {
      rawAmount = rawAmount.replace(/[^0-9.-]+/g, "");
    }
    const amount = Number(rawAmount) || 0;

    const payMethod = row["결제수단"] || row["결제방법"] || row["수단"] || "-";
    const author = row["작성자"] || row["담당자"] || "-";
    const note = row["비고"] || row["메모"] || "";

    return {
      id: index + 1,
      date: date.trim(),
      type: type.includes("수입") ? "수입" : "지출",
      category,
      item: item.trim(),
      amount,
      pay_method: payMethod.trim(),
      author: author.trim(),
      note: note.trim()
    };
  }).filter(item => item.date && item.amount > 0); // 일자와 금액이 있는 유효 행만 필터링
}

/**
 * 데이터 로드 완료 후 화면 갱신
 */
function onDataLoaded(isDemo = false, bannerMsg = "") {
  if (isDemo) {
    noticeBannerEl.classList.remove("hidden");
    if (bannerMsg) noticeTextEl.textContent = bannerMsg;
    updateSyncStatus("demo", "샘플 데이터 모드");
  } else {
    noticeBannerEl.classList.add("hidden");
    updateSyncStatus("live", "구글 시트 동기화 완료");
  }

  // 카테고리 필터 옵션 동적 생성
  populateCategoryFilter();

  // 필터 적용 및 렌더링
  applyFilters();

  // 최종 업데이트 시간 갱신
  const now = new Date();
  lastUpdatedEl.textContent = `최종 업데이트: ${now.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}

/**
 * 카테고리 필터 드롭다운 항목 생성
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
 * 필터 적용
 */
function applyFilters() {
  const selectedType = typeFilter.value;
  const selectedCat = categoryFilter.value;
  const searchQuery = searchInput.value.toLowerCase().trim();

  filteredTransactions = allTransactions.filter(item => {
    const matchesType = (selectedType === "ALL") || (item.type === selectedType);
    const matchesCat = (selectedCat === "ALL") || (item.category === selectedCat);
    const matchesSearch = !searchQuery || 
      item.item.toLowerCase().includes(searchQuery) ||
      item.note.toLowerCase().includes(searchQuery) ||
      item.author.toLowerCase().includes(searchQuery) ||
      item.category.toLowerCase().includes(searchQuery);

    return matchesType && matchesCat && matchesSearch;
  });

  // 날짜 내림차순 정렬 (최신순)
  filteredTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));

  // 1. KPI 요약 카드 업데이트
  updateKPICards();

  // 2. 차트 업데이트
  updateCharts();

  // 3. 테이블 목록 렌더링
  renderTable();
}

/**
 * KPI 요약 카드 계산 및 렌더링
 */
function updateKPICards() {
  // 전체 거래 기준 집계
  let income = 0;
  let expense = 0;
  let incCount = 0;
  let expCount = 0;

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

  totalIncomeEl.textContent = formatKRW(income);
  totalExpenseEl.textContent = formatKRW(expense);
  totalBalanceEl.textContent = formatKRW(balance);

  incomeCountEl.textContent = `총 ${incCount}건의 수입 내역`;
  expenseCountEl.textContent = `총 ${expCount}건의 지출 내역`;
  balanceRatioEl.textContent = `수입 대비 지출 ${ratio}%`;

  // 잔액에 따른 색상 스타일
  if (balance < 0) {
    totalBalanceEl.classList.remove("text-slate-900");
    totalBalanceEl.classList.add("text-rose-600");
  } else {
    totalBalanceEl.classList.remove("text-rose-600");
    totalBalanceEl.classList.add("text-slate-900");
  }
}

/**
 * 차트 렌더링 (월별 수입/지출 + 카테고리별 지출)
 */
function updateCharts() {
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
          borderRadius: 6
        },
        {
          label: "지출",
          data: expenseList,
          backgroundColor: "#f43f5e",
          borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "top", labels: { boxWidth: 12, font: { family: "Pretendard" } } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${formatKRW(ctx.raw)}`
          }
        }
      },
      scales: {
        y: {
          ticks: {
            callback: (val) => val >= 10000 ? `${(val / 10000).toLocaleString()}만원` : `${val}원`
          },
          grid: { color: "#f1f5f9" }
        },
        x: {
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

  categoryChart = new Chart(categoryCtx, {
    type: "doughnut",
    data: {
      labels: catLabels,
      datasets: [
        {
          data: catValues,
          backgroundColor: [
            "#3b82f6", "#6366f1", "#ec4899", "#f59e0b", "#10b981", "#8b5cf6", "#14b8a6"
          ],
          borderWidth: 2,
          borderColor: "#ffffff"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 10, font: { family: "Pretendard", size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${formatKRW(ctx.raw)}`
          }
        }
      },
      cutout: "68%"
    }
  });
}

/**
 * 테이블 내역 렌더링
 */
function renderTable() {
  transactionTbody.innerHTML = "";
  filteredCountEl.textContent = filteredTransactions.length;

  if (filteredTransactions.length === 0) {
    emptyTableState.classList.remove("hidden");
    return;
  }
  emptyTableState.classList.add("hidden");

  filteredTransactions.forEach(t => {
    const isIncome = t.type === "수입";
    const tr = document.createElement("tr");
    tr.className = "hover:bg-slate-50/80 transition duration-100";

    const badgeColor = isIncome 
      ? "bg-emerald-50 text-emerald-700 border-emerald-200" 
      : "bg-rose-50 text-rose-700 border-rose-200";

    const amountColor = isIncome ? "text-emerald-600 font-semibold" : "text-rose-600 font-semibold";
    const amountPrefix = isIncome ? "+" : "-";

    tr.innerHTML = `
      <td class="px-5 py-3.5 whitespace-nowrap text-xs text-slate-500 font-mono">${t.date}</td>
      <td class="px-4 py-3.5 whitespace-nowrap">
        <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${badgeColor}">
          ${t.type}
        </span>
      </td>
      <td class="px-4 py-3.5 whitespace-nowrap text-xs font-medium text-slate-700">
        <span class="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
          ${t.category}
        </span>
      </td>
      <td class="px-5 py-3.5 text-xs text-slate-800 font-medium">${escapeHtml(t.item)}</td>
      <td class="px-5 py-3.5 whitespace-nowrap text-xs text-right font-mono ${amountColor}">
        ${amountPrefix}${formatKRW(t.amount)}
      </td>
      <td class="px-4 py-3.5 whitespace-nowrap text-xs text-slate-500">${escapeHtml(t.pay_method)}</td>
      <td class="px-4 py-3.5 whitespace-nowrap text-xs text-slate-500">${escapeHtml(t.author)}</td>
      <td class="px-5 py-3.5 text-xs text-slate-400 max-w-xs truncate" title="${escapeHtml(t.note)}">
        ${escapeHtml(t.note) || "-"}
      </td>
    `;
    transactionTbody.appendChild(tr);
  });

  if (window.lucide) lucide.createIcons();
}

/**
 * 상태 배지 업데이트
 */
function updateSyncStatus(status, text) {
  if (status === "loading") {
    syncStatusEl.className = "inline-flex items-center px-2.5 py-1 rounded-full font-medium bg-blue-50 text-blue-700 border border-blue-200";
    syncStatusEl.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-blue-500 mr-1.5 animate-ping"></span>${text}`;
  } else if (status === "live") {
    syncStatusEl.className = "inline-flex items-center px-2.5 py-1 rounded-full font-medium bg-emerald-50 text-emerald-700 border border-emerald-200";
    syncStatusEl.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5"></span>${text}`;
  } else if (status === "demo") {
    syncStatusEl.className = "inline-flex items-center px-2.5 py-1 rounded-full font-medium bg-amber-50 text-amber-700 border border-amber-200";
    syncStatusEl.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1.5"></span>${text}`;
  } else {
    syncStatusEl.className = "inline-flex items-center px-2.5 py-1 rounded-full font-medium bg-rose-50 text-rose-700 border border-rose-200";
    syncStatusEl.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-rose-500 mr-1.5"></span>${text}`;
  }
}

/**
 * 원화 포맷팅 함수
 */
function formatKRW(val) {
  return `${Number(val || 0).toLocaleString("ko-KR")}원`;
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
