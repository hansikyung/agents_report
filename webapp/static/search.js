const form = document.getElementById("search-form");
const queryInput = document.getElementById("query");
const maxResultsInput = document.getElementById("max-results");
const maxResultsMinus = document.getElementById("max-results-minus");
const maxResultsPlus = document.getElementById("max-results-plus");
const submitBtn = document.getElementById("submit-btn");
const formError = document.getElementById("form-error");

const loadingSection = document.getElementById("loading-section");
const rawResults = document.getElementById("raw-results");
const tavilyList = document.getElementById("tavily-list");
const serperList = document.getElementById("serper-list");

const analysisSection = document.getElementById("analysis-section");
const overlapChips = document.getElementById("overlap-chips");
const domainChart = document.getElementById("domain-chart");
const keywordChart = document.getElementById("keyword-chart");
const viewToggle = document.getElementById("view-toggle");

let lastAnalysis = null;
let viewMode = "chart"; // "chart" | "table"
let serperAvailable = true;

function clampMaxResults(value) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return 5;
  return Math.min(10, Math.max(1, n));
}

maxResultsMinus.addEventListener("click", () => {
  maxResultsInput.value = clampMaxResults(clampMaxResults(maxResultsInput.value) - 1);
});
maxResultsPlus.addEventListener("click", () => {
  maxResultsInput.value = clampMaxResults(clampMaxResults(maxResultsInput.value) + 1);
});
maxResultsInput.addEventListener("change", () => {
  maxResultsInput.value = clampMaxResults(maxResultsInput.value);
});

function showError(message) {
  formError.textContent = message;
  formError.classList.remove("hidden");
}
function clearError() {
  formError.classList.add("hidden");
  formError.textContent = "";
}

function renderResultCard(item) {
  const card = document.createElement("a");
  card.href = item.url || "#";
  card.target = "_blank";
  card.rel = "noopener noreferrer";
  card.className = "block rounded-2xl border-2 border-ink/20 hover:border-ink p-4 transition";
  card.innerHTML = `
    <p class="font-display font-semibold text-sm mb-1 truncate">${item.title || "(제목 없음)"}</p>
    <p class="text-xs text-ink/50 mb-2 truncate">${item.url || ""}</p>
    <p class="text-sm text-ink/70 line-clamp-3">${item.snippet || ""}</p>
  `;
  return card;
}

function renderResultLists(results, serperAvailable) {
  tavilyList.innerHTML = "";
  serperList.innerHTML = "";

  const tavilyItems = results.filter((r) => r.source === "tavily");
  const serperItems = results.filter((r) => r.source === "serper");

  if (tavilyItems.length === 0) {
    tavilyList.innerHTML = `<p class="text-sm text-ink/40">결과가 없습니다.</p>`;
  } else {
    tavilyItems.forEach((item) => tavilyList.appendChild(renderResultCard(item)));
  }

  if (!serperAvailable) {
    serperList.innerHTML = `<p class="text-sm text-ink/40">SERPER_API_KEY가 .env에 없어 이번 검색에서는 사용하지 않았어요.</p>`;
  } else if (serperItems.length === 0) {
    serperList.innerHTML = `<p class="text-sm text-ink/40">결과가 없습니다.</p>`;
  } else {
    serperItems.forEach((item) => serperList.appendChild(renderResultCard(item)));
  }

  rawResults.classList.remove("hidden");
}

function renderOverlapChips(domains) {
  overlapChips.innerHTML = "";
  if (!serperAvailable) {
    overlapChips.innerHTML = `<span class="text-sm text-ink/40">Serper를 사용하지 않아 비교할 대상이 없어요 (Tavily만 사용).</span>`;
    return;
  }
  if (!domains || domains.length === 0) {
    overlapChips.innerHTML = `<span class="text-sm text-ink/40">겹치는 도메인이 없습니다.</span>`;
    return;
  }
  domains.forEach((domain) => {
    const chip = document.createElement("span");
    chip.className =
      "inline-block text-sm font-display font-semibold bg-yellow border-2 border-ink rounded-full px-3 py-1";
    chip.textContent = domain;
    overlapChips.appendChild(chip);
  });
}

// data: array of [label, count]. Renders either a horizontal bar chart or a
// plain table, per the shared viewMode toggle (the table is the accessibility
// twin of the chart, per the dataviz guidance this UI follows).
function renderRankedBars(container, data, colorClass, unitLabel) {
  container.innerHTML = "";

  if (!data || data.length === 0) {
    container.innerHTML = `<p class="text-sm text-ink/40">데이터가 없습니다.</p>`;
    return;
  }

  if (viewMode === "table") {
    const table = document.createElement("table");
    table.className = "w-full text-sm";
    const rows = data
      .map(
        ([label, count], i) => `
        <tr class="${i % 2 === 0 ? "bg-cream/60" : ""}">
          <td class="py-2 px-3 font-body">${label}</td>
          <td class="py-2 px-3 font-display font-semibold text-right tabular-nums">${count}</td>
        </tr>`
      )
      .join("");
    table.innerHTML = `
      <thead>
        <tr class="text-left text-ink/60 font-display font-semibold text-xs uppercase">
          <th class="py-2 px-3">${unitLabel}</th>
          <th class="py-2 px-3 text-right">횟수</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    `;
    container.appendChild(table);
    return;
  }

  const maxCount = Math.max(...data.map(([, count]) => count));
  const list = document.createElement("div");
  list.className = "space-y-2";

  data.forEach(([label, count]) => {
    const pct = Math.max(4, Math.round((count / maxCount) * 100));
    const row = document.createElement("div");
    row.className = "grid grid-cols-[6rem_1fr_2rem] sm:grid-cols-[9rem_1fr_2rem] items-center gap-3";
    row.innerHTML = `
      <span class="text-sm font-body text-ink/80 truncate" title="${label}">${label}</span>
      <div class="h-6 ${colorClass} rounded-r-[4px]" style="width: ${pct}%" title="${label}: ${count}"></div>
      <span class="text-sm font-display font-semibold tabular-nums text-right">${count}</span>
    `;
    list.appendChild(row);
  });

  container.appendChild(list);
}

function renderAnalysis(analysis) {
  lastAnalysis = analysis;
  renderOverlapChips(analysis.overlapping_domains);
  renderRankedBars(domainChart, analysis.top_domains, "bg-violet", "도메인");
  renderRankedBars(keywordChart, analysis.top_keywords, "bg-pink", "키워드");
  analysisSection.classList.remove("hidden");
}

viewToggle.addEventListener("click", () => {
  viewMode = viewMode === "chart" ? "table" : "chart";
  viewToggle.textContent = viewMode === "chart" ? "📋 표로 보기" : "📊 차트로 보기";
  if (lastAnalysis) renderAnalysis(lastAnalysis);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();

  const query = queryInput.value.trim();
  const maxResults = clampMaxResults(maxResultsInput.value);
  if (!query) {
    showError("검색어를 입력해 주세요.");
    return;
  }

  submitBtn.disabled = true;
  loadingSection.classList.remove("hidden");
  rawResults.classList.add("hidden");
  analysisSection.classList.add("hidden");

  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, max_results: maxResults }),
    });
    const data = await res.json();

    if (!res.ok) {
      showError(data.error || "요청을 처리할 수 없습니다.");
      return;
    }

    serperAvailable = Boolean(data.serper_available);
    renderResultLists(data.results, serperAvailable);
    renderAnalysis(data.analysis);
  } catch (err) {
    showError("서버에 연결할 수 없습니다.");
  } finally {
    loadingSection.classList.add("hidden");
    submitBtn.disabled = false;
  }
});
