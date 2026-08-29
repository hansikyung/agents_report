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

let lastDownloadUrl = null;

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

function resetForNewRun(sections) {
  clearError();
  results.innerHTML = "";
  results.classList.add("hidden");
  downloadSection.classList.add("hidden");
  if (lastDownloadUrl) {
    URL.revokeObjectURL(lastDownloadUrl);
    lastDownloadUrl = null;
  }
  progressSection.classList.remove("hidden");
  // The whole report now generates in a single request (no per-section polling —
  // that requires state shared across requests, which a serverless deployment
  // can't provide), so this is an indeterminate "still working" indicator rather
  // than a real percentage.
  progressBar.style.width = "100%";
  progressLabel.textContent = `${sections}개 섹션 보고서를 작성하는 중입니다... (몇 분 정도 걸릴 수 있어요)`;
  submitBtn.disabled = true;
}

function renderSections(sections) {
  if (!sections || sections.length === 0) return;
  results.classList.remove("hidden");

  sections.forEach((section, i) => {
    const colors = PALETTE[i % PALETTE.length];

    const card = document.createElement("article");
    card.className = `section-card bg-white border-4 border-ink ${colors.border} rounded-3xl shadow-pop-sm p-6`;

    const imageHtml = section.image_base64
      ? `<img src="data:image/png;base64,${section.image_base64}" alt="${section.title}"
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
  });
}

// Turns the base64 .docx the server returned into a downloadable blob: URL —
// no second request, so this works the same whether the server wrote nothing
// to disk (serverless) or could have (local dev).
function setDownload(reportBase64, filename) {
  const byteChars = atob(reportBase64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  const blob = new Blob([new Uint8Array(byteNumbers)], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  lastDownloadUrl = URL.createObjectURL(blob);
  downloadLink.href = lastDownloadUrl;
  downloadLink.download = filename || "report.docx";
  downloadSection.classList.remove("hidden");
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

  resetForNewRun(sections);

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, sections }),
    });

    // A serverless timeout (504) or gateway error comes back as an HTML page, not
    // JSON — detect that before trying to parse it, so the message stays useful.
    if (res.status === 504) {
      progressSection.classList.add("hidden");
      showError("요청 시간이 너무 오래 걸려 시간 초과되었습니다. 섹션 수를 줄여서 다시 시도해 주세요.");
      return;
    }

    let data;
    try {
      data = await res.json();
    } catch (parseErr) {
      progressSection.classList.add("hidden");
      showError(`서버 응답을 처리할 수 없습니다 (HTTP ${res.status}).`);
      return;
    }

    if (!res.ok) {
      progressSection.classList.add("hidden");
      showError(data.error || "요청을 처리할 수 없습니다.");
      return;
    }

    progressSection.classList.add("hidden");
    renderSections(data.sections);
    setDownload(data.report_base64, data.filename);
  } catch (err) {
    progressSection.classList.add("hidden");
    showError("서버에 연결할 수 없습니다.");
  } finally {
    submitBtn.disabled = false;
  }
});
