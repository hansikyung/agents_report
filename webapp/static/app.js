const form = document.getElementById("report-form");
const topicInput = document.getElementById("topic");
const sectionsInput = document.getElementById("sections");
const sectionMinus = document.getElementById("section-minus");
const sectionPlus = document.getElementById("section-plus");
const submitBtn = document.getElementById("submit-btn");
const formError = document.getElementById("form-error");

const progressSection = document.getElementById("progress-section");
const progressLabel = document.getElementById("progress-label");
const progressBar = document.getElementById("progress-bar");

const results = document.getElementById("results");
const downloadSection = document.getElementById("download-section");
const downloadLink = document.getElementById("download-link");

// Cycle through the Memphis palette for each section card's accent color.
const PALETTE = [
  { border: "border-pink", chip: "bg-pink" },
  { border: "border-violet", chip: "bg-violet" },
  { border: "border-teal", chip: "bg-teal" },
  { border: "border-orange", chip: "bg-orange" },
  { border: "border-sky", chip: "bg-sky" },
];

let pollTimer = null;
let renderedCount = 0;

function clampSections(value) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return 3;
  return Math.min(10, Math.max(1, n));
}

sectionMinus.addEventListener("click", () => {
  sectionsInput.value = clampSections(sectionsInput.value) - 1 || 1;
  sectionsInput.value = clampSections(sectionsInput.value);
});
sectionPlus.addEventListener("click", () => {
  sectionsInput.value = clampSections(sectionsInput.value) + 1;
  sectionsInput.value = clampSections(sectionsInput.value);
});
sectionsInput.addEventListener("change", () => {
  sectionsInput.value = clampSections(sectionsInput.value);
});

function showError(message) {
  formError.textContent = message;
  formError.classList.remove("hidden");
}

function clearError() {
  formError.classList.add("hidden");
  formError.textContent = "";
}

function resetForNewRun() {
  clearError();
  renderedCount = 0;
  results.innerHTML = "";
  results.classList.add("hidden");
  downloadSection.classList.add("hidden");
  progressSection.classList.remove("hidden");
  progressBar.style.width = "5%";
  progressLabel.textContent = "에이전트 팀을 소집하는 중...";
  submitBtn.disabled = true;
}

function renderSections(sections) {
  if (!sections || sections.length === 0) return;
  results.classList.remove("hidden");

  for (let i = renderedCount; i < sections.length; i++) {
    const section = sections[i];
    const colors = PALETTE[i % PALETTE.length];

    const card = document.createElement("article");
    card.className = `section-card bg-white border-4 border-ink ${colors.border} rounded-3xl shadow-pop-sm p-6`;

    const imageHtml = section.image
      ? `<img src="/api/image/${section.image}" alt="${section.title}"
             class="w-full sm:w-48 h-48 object-cover rounded-2xl border-4 border-ink shrink-0" />`
      : `<div class="w-full sm:w-48 h-48 flex items-center justify-center rounded-2xl border-4 border-ink
                     bg-cream text-ink/40 font-display font-semibold shrink-0">이미지 없음</div>`;

    card.innerHTML = `
      <div class="flex flex-col sm:flex-row gap-5">
        ${imageHtml}
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-2">
            <span class="w-3 h-3 rounded-full ${colors.chip} border-2 border-ink"></span>
            <h3 class="font-display font-bold text-xl">${section.title}</h3>
          </div>
          <p class="content-scroll text-ink/80 leading-relaxed max-h-40 overflow-y-auto pr-2 whitespace-pre-wrap">${section.content}</p>
        </div>
      </div>
    `;
    results.appendChild(card);
  }
  renderedCount = sections.length;
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function pollStatus(jobId) {
  try {
    const res = await fetch(`/api/status/${jobId}`);
    const job = await res.json();

    if (!res.ok) {
      stopPolling();
      progressLabel.textContent = "오류가 발생했어요";
      showError(job.error || "상태를 확인할 수 없습니다.");
      submitBtn.disabled = false;
      return;
    }

    const total = job.total_sections || 1;
    const done = job.sections ? job.sections.length : 0;
    const pct = Math.max(5, Math.min(100, Math.round((done / total) * 100)));
    progressBar.style.width = `${pct}%`;

    renderSections(job.sections);

    if (job.status === "running") {
      progressLabel.textContent = `${Math.min(job.current_section, total)} / ${total} 섹션 작성 중...`;
    } else if (job.status === "done") {
      stopPolling();
      progressBar.style.width = "100%";
      progressLabel.textContent = "완성! 🎉";
      downloadLink.href = `/api/download/${jobId}`;
      downloadSection.classList.remove("hidden");
      submitBtn.disabled = false;
    } else if (job.status === "error") {
      stopPolling();
      progressLabel.textContent = "오류가 발생했어요";
      showError(job.error || "보고서 생성 중 오류가 발생했습니다.");
      submitBtn.disabled = false;
    }
  } catch (err) {
    stopPolling();
    progressLabel.textContent = "오류가 발생했어요";
    showError("서버에 연결할 수 없습니다.");
    submitBtn.disabled = false;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();

  const topic = topicInput.value.trim();
  const sections = clampSections(sectionsInput.value);
  if (!topic) {
    showError("보고서 주제를 입력해 주세요.");
    return;
  }

  resetForNewRun();

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, sections }),
    });
    const data = await res.json();

    if (!res.ok) {
      progressSection.classList.add("hidden");
      submitBtn.disabled = false;
      showError(data.error || "요청을 처리할 수 없습니다.");
      return;
    }

    stopPolling();
    pollTimer = setInterval(() => pollStatus(data.job_id), 1500);
    pollStatus(data.job_id);
  } catch (err) {
    progressSection.classList.add("hidden");
    submitBtn.disabled = false;
    showError("서버에 연결할 수 없습니다.");
  }
});
