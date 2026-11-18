const chapters = [...document.querySelectorAll(".chapter")];
const chapterLinks = [...document.querySelectorAll(".chapter-links a")];
const chapterFooter = document.querySelector(".chapter-footer");
const previousChapter = document.querySelector("#prev-chapter");
const nextChapter = document.querySelector("#next-chapter");
const progressUi = document.querySelector(".progress-ui");
const progressBar = progressUi.querySelector("progress");
const progressLabel = document.querySelector("#progress-label");
const completeButton = document.querySelector(".complete-button");
const completionKey = "hollow-valley-guide.completed.v1";
let activeChapter = chapters[0];

function loadCompletion() {
  try {
    const saved = JSON.parse(localStorage.getItem(completionKey) || "[]");
    if (Array.isArray(saved)) {
      return new Set(chapters.map((chapter) => chapter.id).filter((id) => saved.includes(id)));
    }
  } catch {
    // Keep the guide usable in browsers where storage is unavailable.
  }
  return new Set();
}

const completed = loadCompletion();

function renderProgress() {
  const isComplete = completed.has(activeChapter.id);
  completeButton.setAttribute("aria-pressed", String(isComplete));
  completeButton.querySelector("span").textContent = isComplete ? "Chapter complete" : "Mark chapter complete";

  progressBar.value = completed.size;
  const label = completed.size + " of " + chapters.length + " complete";
  if (progressLabel.textContent !== label) progressLabel.textContent = label;

  for (const link of chapterLinks) {
    const isDone = completed.has(link.hash.slice(1));
    link.classList.toggle("is-complete", isDone);
    if (isDone) link.setAttribute("aria-label", link.querySelector("span").textContent + " (complete)");
    else link.removeAttribute("aria-label");
  }
}

function renderChapter(chapter) {
  activeChapter = chapter;
  const index = chapters.indexOf(chapter);

  for (const item of chapters) item.hidden = item !== chapter;
  for (const link of chapterLinks) {
    if (link.hash === "#" + chapter.id) link.setAttribute("aria-current", "step");
    else link.removeAttribute("aria-current");
  }

  const previous = chapters[index - 1];
  previousChapter.hidden = !previous;
  if (previous) previousChapter.href = "#" + previous.id;

  const next = chapters[index + 1];
  nextChapter.href = next ? "#" + next.id : "#more-tools";
  nextChapter.querySelector("span").textContent = next
    ? "Next: " + next.querySelector("h2").textContent
    : "More player tools";
  renderProgress();
}

function openHash({ move = false, focus = false } = {}) {
  const id = location.hash.slice(1);
  const target = document.getElementById(id);
  const chapter = target?.closest(".chapter");

  if (chapter) renderChapter(chapter);
  else if (!id) renderChapter(chapters[0]);

  if (move && target && (chapter || id === "more-tools")) {
    const heading = target.querySelector("h2");
    if (focus && heading) heading.focus({ preventScroll: true });
    target.scrollIntoView({ block: "start" });
  }
}

completeButton.addEventListener("click", () => {
  if (completed.has(activeChapter.id)) completed.delete(activeChapter.id);
  else completed.add(activeChapter.id);

  try {
    localStorage.setItem(completionKey, JSON.stringify([...completed]));
  } catch {
    // Progress remains available while the page is open.
  }
  renderProgress();
});

window.addEventListener("hashchange", () => openHash({ move: true, focus: true }));

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[href^='#']");
  if (link && link.hash === location.hash) openHash({ move: true, focus: true });
});

renderChapter(chapters[0]);
openHash();
if (location.hash) requestAnimationFrame(() => openHash({ move: true }));
progressUi.hidden = false;
chapterFooter.hidden = false;
