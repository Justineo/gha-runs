import "./style.css";
import { inject } from "@vercel/analytics";

inject();

// Constants
const MAX_DURATION = 12 * 60 * 60; // 12 hours in seconds
const REPO_CONFIG = {
  "Kong/konnect-ui-apps": {
    branch: "main",
  },
  "Kong/public-ui-components": {
    branch: "main",
  },
  "Kong/shared-ui-components": {
    branch: "main",
  },
  "Kong/kongponents": {
    branch: "main",
    workflow: "Publish",
  },
  "Kong/kong-admin": {
    branch: "master",
    workflow: "Build, Test & Release",
  },
  "Kong/kong-manager": {
    branch: "main",
  },
};

// Gloabal
let GITHUB_TOKEN = "";

// DOM Elements
const chartContainer = document.getElementById("chart-container");
const mainElement = document.querySelector("main");
const statusFilters = {
  success: document.getElementById("filter-success"),
  failure: document.getElementById("filter-failure"),
  cancelled: document.getElementById("filter-cancelled"),
  pending: document.getElementById("filter-pending"),
  in_progress: document.getElementById("filter-in-progress"),
};
const attemptOneOnlyCheckbox = document.getElementById("attempt-one-only");
const countLimitInput = document.getElementById("count-limit");
const showStripesCheckbox = document.getElementById("show-stripes");
const repositorySelect = document.getElementById("repository-select");
const refreshButton = document.getElementById("refresh-button");
const searchInput = document.getElementById("search-input");
const updateTimeElement = document.getElementById("update-time");
const failureRateElement = document.getElementById("failure-rate");

// State variables
let repository = repositorySelect.value;
let data = [];
let showStatus = {
  success: statusFilters.success.checked,
  failure: statusFilters.failure.checked,
  cancelled: statusFilters.cancelled.checked,
  pending: statusFilters.pending.checked,
  in_progress: statusFilters.in_progress.checked,
};
let attemptOneOnly = attemptOneOnlyCheckbox.checked;
let showStripes = showStripesCheckbox.checked;
let runsToShow = parseInt(countLimitInput.value, 10) || 100;
let searchRegExp = null;

// Utility Functions
function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  seconds = Math.floor(seconds % 60);
  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);
  return parts.join(" ");
}

function buildHeaders() {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

const tokenInput = document.getElementById("github-token-input");
const dialog = document.getElementById("pat");
const controlsForm = document.getElementById("controls-form");

const cachedRuns = {};
let updateTime = null;

function setLoading(loading) {
  if (loading) {
    document.body.classList.add("loading");
    controlsForm.disabled = true;
  } else {
    document.body.classList.remove("loading");
    controlsForm.disabled = false;
  }
}

async function fetchRuns(force = false) {
  if (!force && cachedRuns[repository]) {
    return cachedRuns[repository];
  }

  setLoading(true);

  const baseUrl = `https://api.github.com/repos/${repository}/actions/runs`;
  const config = REPO_CONFIG[repository];
  const params = new URLSearchParams({
    branch: config.branch,
    event: "push",
    per_page: "100",
  });
  const pages = [1, 2, 3, 4, 5, 6];

  async function fetchPage(page) {
    params.set("page", page.toString());
    const url = `${baseUrl}?${params.toString()}`;
    const response = await fetch(url, {
      headers: buildHeaders(),
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Error fetching page ${page}: ${response.statusText}`);
    }
    const data = await response.json();
    return data.workflow_runs || [];
  }

  async function fetchAllPages() {
    const results = await Promise.all(pages.map(fetchPage));
    const runs = results.flat();
    if (config.workflow) {
      return runs.filter((run) => run.name === config.workflow);
    }
    return runs;
  }

  async function getTokenAndFetch() {
    return new Promise((resolve) => {
      dialog.showModal();

      async function handleClose() {
        dialog.removeEventListener("close", handleClose);
        if (tokenInput && tokenInput.value) {
          GITHUB_TOKEN = tokenInput.value;
          localStorage.setItem("GITHUB_TOKEN", GITHUB_TOKEN);

          try {
            const runs = await fetchAllPages();
            const data = {
              runs,
              updateTime: new Date().toISOString(),
            };
            cachedRuns[repository] = data;
            resolve(data);
            setLoading(false);
          } catch (error) {
            console.error("Error fetching data:", error);
            resolve(await getTokenAndFetch());
          }
        } else {
          resolve([]);
          setLoading(false);
        }
      }
      dialog.addEventListener("close", handleClose);
    });
  }

  GITHUB_TOKEN = localStorage.getItem("GITHUB_TOKEN") || "";

  if (!GITHUB_TOKEN) {
    return getTokenAndFetch();
  }

  try {
    const runs = await fetchAllPages();
    const data = {
      runs,
      updateTime: new Date().toLocaleString(),
    };
    cachedRuns[repository] = data;
    setLoading(false);
    return data;
  } catch (error) {
    console.error("Error fetching data:", error);
    return await getTokenAndFetch();
  }
}

function extractRunData(run) {
  const id = run.id;
  const url = run.html_url;
  const startTime = new Date(run.run_started_at);
  const endTime = new Date(run.updated_at);
  const duration = (endTime - startTime) / 1000;
  const attempt = run.run_attempt;
  const status = run.conclusion || run.status;
  const symbolMap = {
    success: "✅",
    failure: "❌",
    pending: "⏳",
    in_progress: "🔄",
    cancelled: "🚫",
  };
  const symbol = symbolMap[status] || "❔";

  const urlParams = new URLSearchParams(window.location.search);
  const mark =
    urlParams.get("compare") === "true" &&
    (run.id === 10918116942 || run.id === 10860108600);

  const title = run.display_title;

  const start = new Date(2018, 10, 13);
  start.setHours(0, 0, 0, 0);
  const days = Math.floor((startTime - start) / (1000 * 60 * 60 * 24));

  return {
    id,
    title,
    url,
    duration,
    attempt,
    status,
    mark,
    symbol,
    startTime,
    days,
  };
}

async function refresh(force) {
  const { updateTime: ut, runs } = await fetchRuns(force);
  data = runs.map(extractRunData).sort((a, b) => b.startTime - a.startTime);
  updateTime = ut;
  render();
}

function filterData() {
  let filteredData = data.filter((item) => item.duration <= MAX_DURATION);

  if (searchRegExp) {
    filteredData = filteredData.filter((item) => searchRegExp.test(item.title));
  }

  filteredData = filteredData.map((item) => {
    const result = { ...item, show: true, valid: true };
    if (
      !showStatus[result.status] ||
      (attemptOneOnly && result.attempt !== 1)
    ) {
      result.valid = false;
      result.show = result.mark;
    }
    return result;
  });

  return filteredData
    .filter((item) => item.show)
    .slice(0, runsToShow || undefined);
}

function render() {
  if (!document.startViewTransition) {
    updateView();
    return;
  }

  document.startViewTransition(() => updateView());
}

function updateView() {
  chartContainer.innerHTML = "";
  const filteredData = filterData();
  const maxDuration = Math.max(...filteredData.map((item) => item.duration));

  const successCount = filteredData.filter(
    (item) => item.status === "success"
  ).length;
  const successRerunCount = filteredData.filter(
    (item) => item.status === "success" && item.attempt !== 1
  ).length;
  const failureCount = filteredData.filter(
    (item) => item.status === "failure"
  ).length;
  const failureRate =
    showStatus.success &&
    showStatus.failure &&
    successCount + failureCount !== 0
      ? (failureCount + successRerunCount) / (successCount + failureCount)
      : null;

  let lastDays = null;
  let count = 0;
  filteredData.forEach((item) => {
    const bar = document.createElement("a");
    bar.classList.add("bar", item.status.replace("_", "-"));
    bar.title = item.title;
    bar.href = item.url;
    bar.target = "_blank";
    if (item.valid) {
      bar.classList.add("valid");
    } else {
      bar.classList.add("invalid");
    }
    if (item.attempt === 1) {
      bar.classList.add("attempt-1");
    }
    if (item.mark) {
      bar.classList.add("mark");
    }
    if (item.days !== lastDays) {
      count++;
    }
    lastDays = item.days;
    if (count % 2) {
      bar.classList.add("odd");
    }
    bar.style.viewTransitionName = `bar-${item.id}`;

    const barInner = document.createElement("div");
    barInner.classList.add("bar-inner");
    barInner.style.height = `${(item.duration / maxDuration) * 96}%`;

    const tooltip = document.createElement("div");
    tooltip.classList.add("tooltip");
    tooltip.innerHTML = `
ID: ${item.id}<br>
Start Time: ${item.startTime.toLocaleString()}<br>
Duration: ${formatDuration(item.duration)}<br>
Attempt: ${item.attempt}<br>
${item.status} ${item.symbol}
`;

    bar.appendChild(barInner);
    bar.appendChild(tooltip);
    chartContainer.appendChild(bar);
  });

  updateTimeElement.textContent = updateTime;

  failureRateElement.textContent = `${
    failureRate == null ? "N/A" : `${(failureRate * 100).toFixed(1)}%`
  }`;

  updateStripes();
}

function updateStripes() {
  if (showStripes) {
    mainElement.classList.add("stripes");
  } else {
    mainElement.classList.remove("stripes");
  }
}

// Event Listeners
function setupEventListeners() {
  Object.keys(statusFilters).forEach((status) => {
    statusFilters[status].addEventListener("change", () => {
      showStatus[status] = statusFilters[status].checked;
      render();
    });
  });

  attemptOneOnlyCheckbox.addEventListener("change", () => {
    attemptOneOnly = attemptOneOnlyCheckbox.checked;
    render();
  });

  countLimitInput.addEventListener("input", () => {
    runsToShow = parseInt(countLimitInput.value, 10) || 0;
    render();
  });

  showStripesCheckbox.addEventListener("change", () => {
    showStripes = showStripesCheckbox.checked;
    updateStripes();
  });

  repositorySelect.addEventListener("change", () => {
    repository = repositorySelect.value;
    refresh();
  });

  refreshButton.addEventListener("click", () => {
    refresh(true);
  });

  searchInput.addEventListener("input", () => {
    const query = searchInput.value;
    try {
      searchRegExp = query ? new RegExp(query) : null;
    } catch (error) {
      searchRegExp = null;
    }
    render();
  });

  document.addEventListener("keydown", (e) => {
    if (e.code === "Escape") {
      e.preventDefault();
    }
  });
}

// Initialize
setupEventListeners();
refresh();
