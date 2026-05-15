import "./style.css";
import { getRelativeTimeString, encodeHTML } from "./utils"

// Constants
const MAX_DURATION = 12 * 60 * 60; // 12 hours in seconds
const TOKEN_MODE_STORAGE_KEY = "GITHUB_TOKEN_MODE";
const TOKEN_MODE_CLASSIC = "classic";
const TOKEN_MODE_FINE_GRAINED = "fine-grained";
const CLASSIC_TOKEN_STORAGE_KEY = "GITHUB_TOKEN";
const FINE_GRAINED_TOKEN_STORAGE_PREFIX = "GITHUB_TOKEN:";
const DURATION_PERCENTILES = [50, 75, 90, 95];
const REPO_CONFIG = {
  "kong-konnect/konnect-ui-apps": {
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
const REPOSITORIES = Object.keys(REPO_CONFIG);
const REPOSITORY_OWNERS = [...new Set(REPOSITORIES.map(getRepositoryOwner))];

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
const tokenSettingsButton = document.getElementById("token-settings-button");
const searchInput = document.getElementById("search-input");
const updateTimeElement = document.getElementById("update-time");
const absoluteUpdateTimeElement = document.getElementById("absolute-update-time");
const relativeUpdateTimeElement = document.getElementById("relative-update-time");
const failureRateElement = document.getElementById("failure-rate");
const durationPercentileElements = Object.fromEntries(
  DURATION_PERCENTILES.map((percentile) => [
    percentile,
    document.getElementById(`duration-p${percentile}`),
  ])
);

// State variables
let tokenMode = getInitialTokenMode();
let repository = repositorySelect.value || REPOSITORIES[0];
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

function calculateDurationPercentiles(items) {
  const durations = items
    .filter((item) => item.valid && Number.isFinite(item.duration))
    .map((item) => item.duration)
    .sort((a, b) => a - b);

  return Object.fromEntries(
    DURATION_PERCENTILES.map((percentile) => {
      if (durations.length === 0) {
        return [percentile, null];
      }

      const index = Math.ceil((percentile / 100) * durations.length) - 1;
      const clampedIndex = Math.min(Math.max(index, 0), durations.length - 1);
      return [percentile, durations[clampedIndex]];
    })
  );
}

function buildHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

const tokenErrorElement = document.getElementById("github-token-error");
const dialog = document.getElementById("pat");
const tokenForm = document.getElementById("token-form");
const tokenModeInputs = {
  [TOKEN_MODE_FINE_GRAINED]: document.getElementById("token-mode-fine-grained"),
  [TOKEN_MODE_CLASSIC]: document.getElementById("token-mode-classic"),
};
const tokenSections = {
  [TOKEN_MODE_FINE_GRAINED]: document.getElementById("fine-grained-token-section"),
  [TOKEN_MODE_CLASSIC]: document.getElementById("classic-token-section"),
};
const tokenCancelButton = document.getElementById("token-cancel-button");
const tokenSaveButton = document.getElementById("token-save-button");
const classicTokenInput = document.getElementById("classic-token-input");
const fineGrainedTokenInputs = {
  "kong-konnect": document.getElementById("kong-konnect-token-input"),
  Kong: document.getElementById("kong-token-input"),
};
const controlsForm = document.getElementById("controls-form");

let cachedRuns = {};
let updateTime = null;

function setLoading(loading) {
  if (loading) {
    document.body.classList.add("loading");
  } else {
    document.body.classList.remove("loading");
  }
}

function getRepositoryOwner(repo) {
  return repo.split("/")[0];
}

function normalizeTokenMode(mode) {
  return mode === TOKEN_MODE_CLASSIC ? TOKEN_MODE_CLASSIC : TOKEN_MODE_FINE_GRAINED;
}

function getInitialTokenMode() {
  const storedMode = localStorage.getItem(TOKEN_MODE_STORAGE_KEY);
  if (storedMode) {
    return normalizeTokenMode(storedMode);
  }
  return localStorage.getItem(CLASSIC_TOKEN_STORAGE_KEY)
    ? TOKEN_MODE_CLASSIC
    : TOKEN_MODE_FINE_GRAINED;
}

function setTokenMode(mode) {
  tokenMode = normalizeTokenMode(mode);
  localStorage.setItem(TOKEN_MODE_STORAGE_KEY, tokenMode);
}

function getFineGrainedTokenStorageKey(owner) {
  return `${FINE_GRAINED_TOKEN_STORAGE_PREFIX}${owner}`;
}

function getClassicToken() {
  return localStorage.getItem(CLASSIC_TOKEN_STORAGE_KEY) || "";
}

function getFineGrainedToken(owner) {
  return localStorage.getItem(getFineGrainedTokenStorageKey(owner)) || "";
}

function storeToken(storageKey, token) {
  if (token) {
    localStorage.setItem(storageKey, token);
  } else {
    localStorage.removeItem(storageKey);
  }
}

function getTokenForRepository(repo) {
  if (!repo) return "";
  if (tokenMode === TOKEN_MODE_CLASSIC) {
    return getClassicToken();
  }
  return getFineGrainedToken(getRepositoryOwner(repo));
}

function clearTokenForRepository(repo) {
  if (tokenMode === TOKEN_MODE_CLASSIC) {
    localStorage.removeItem(CLASSIC_TOKEN_STORAGE_KEY);
    return;
  }
  localStorage.removeItem(
    getFineGrainedTokenStorageKey(getRepositoryOwner(repo))
  );
}

function getAvailableRepositories() {
  if (tokenMode === TOKEN_MODE_CLASSIC) {
    return getClassicToken() ? REPOSITORIES : [];
  }
  return REPOSITORIES.filter((repo) =>
    Boolean(getFineGrainedToken(getRepositoryOwner(repo)))
  );
}

function renderRepositoryOptions() {
  const availableRepositories = getAvailableRepositories();
  repositorySelect.innerHTML = "";

  if (availableRepositories.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No repositories available";
    repositorySelect.appendChild(option);
    repositorySelect.disabled = true;
    refreshButton.disabled = true;
    repository = "";
    return false;
  }

  if (!availableRepositories.includes(repository)) {
    repository = availableRepositories[0];
  }

  availableRepositories.forEach((repo) => {
    const option = document.createElement("option");
    option.value = repo;
    option.textContent = repo;
    option.selected = repo === repository;
    repositorySelect.appendChild(option);
  });

  repositorySelect.disabled = false;
  refreshButton.disabled = false;
  return true;
}

function updateTokenSections() {
  Object.entries(tokenSections).forEach(([mode, section]) => {
    section.hidden = tokenModeInputs[mode].checked === false;
  });
}

function getActiveTokenInputs() {
  if (tokenModeInputs[TOKEN_MODE_CLASSIC].checked) {
    return [classicTokenInput];
  }
  return REPOSITORY_OWNERS.map((owner) => fineGrainedTokenInputs[owner]);
}

function submitTokenDialog() {
  tokenSaveButton.click();
}

function moveToNextTokenInput(currentInput) {
  const tokenInputs = getActiveTokenInputs();
  const currentIndex = tokenInputs.indexOf(currentInput);
  if (currentIndex === -1) return false;

  const nextInput = tokenInputs[currentIndex + 1];
  if (nextInput) {
    nextInput.focus();
    nextInput.select();
  } else {
    submitTokenDialog();
  }
  return true;
}

function populateTokenDialog(errorMessage = "") {
  tokenModeInputs[tokenMode].checked = true;
  classicTokenInput.value = getClassicToken();
  REPOSITORY_OWNERS.forEach((owner) => {
    fineGrainedTokenInputs[owner].value = getFineGrainedToken(owner);
  });
  tokenErrorElement.hidden = !errorMessage;
  tokenErrorElement.textContent = errorMessage;
  updateTokenSections();
}

function saveTokenSettings() {
  const selectedMode = tokenForm.elements["token-mode"].value;
  setTokenMode(selectedMode);
  storeToken(CLASSIC_TOKEN_STORAGE_KEY, classicTokenInput.value.trim());
  REPOSITORY_OWNERS.forEach((owner) => {
    storeToken(
      getFineGrainedTokenStorageKey(owner),
      fineGrainedTokenInputs[owner].value.trim()
    );
  });
  cachedRuns = {};
  renderRepositoryOptions();
}

function openTokenDialog(errorMessage = "") {
  return new Promise((resolve) => {
    populateTokenDialog(errorMessage);

    function handleClose() {
      dialog.removeEventListener("close", handleClose);
      if (dialog.returnValue === "save") {
        saveTokenSettings();
        resolve(true);
      } else {
        resolve(false);
      }
    }

    dialog.addEventListener("close", handleClose);
    dialog.showModal();
  });
}

function emptyRunsData() {
  return {
    runs: [],
    updateTime: new Date(),
  };
}

async function fetchRuns(force = false) {
  if (!repository) {
    const configured = await openTokenDialog(
      "Configure access tokens to choose repositories."
    );
    if (!configured || !renderRepositoryOptions()) {
      return emptyRunsData();
    }
  }

  if (!force && cachedRuns[repository]) {
    return cachedRuns[repository];
  }

  setLoading(true);

  const pages = [1, 2, 3, 4, 5, 6];

  async function fetchPage(repo, page, token, params) {
    params.set("page", page.toString());
    const url = `https://api.github.com/repos/${repo}/actions/runs?${params.toString()}`;
    const response = await fetch(url, {
      headers: buildHeaders(token),
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(
        `Error fetching page ${page}: ${response.status} ${response.statusText}`
      );
    }
    const data = await response.json();
    return data.workflow_runs || [];
  }

  async function fetchAllPages(repo, token) {
    const config = REPO_CONFIG[repo];
    const params = new URLSearchParams({
      branch: config.branch,
      event: "push",
      per_page: "100",
    });
    const results = await Promise.all(
      pages.map((page) => fetchPage(repo, page, token, params))
    );
    const runs = results.flat();
    if (config.workflow) {
      return runs.filter((run) => run.name === config.workflow);
    }
    return runs;
  }

  function createRunsData(runs) {
    return {
      runs,
      updateTime: new Date(),
    };
  }

  try {
    let token = getTokenForRepository(repository);

    while (true) {
      if (!token) {
        const configured = await openTokenDialog(
          `Configure an access token to view ${repository}.`
        );
        if (!configured || !renderRepositoryOptions()) {
          return emptyRunsData();
        }
        token = getTokenForRepository(repository);
      }

      if (!token) {
        return emptyRunsData();
      }

      try {
        const data = createRunsData(await fetchAllPages(repository, token));
        cachedRuns[repository] = data;
        return data;
      } catch (error) {
        console.error("Error fetching data:", error);
        const failedRepository = repository;
        clearTokenForRepository(failedRepository);
        const configured = await openTokenDialog(
          `The saved token could not access ${failedRepository}. Update the token settings and make sure the selected token has read-only Actions access and SSO authorization if required.`
        );
        if (!configured || !renderRepositoryOptions()) {
          return emptyRunsData();
        }
        token = getTokenForRepository(repository);
      }
    }
  } finally {
    setLoading(false);
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
  const maxDuration = Math.max(...filteredData.map((item) => item.duration), 1);

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
  const durationPercentiles = calculateDurationPercentiles(filteredData);

  let lastDays = null;
  let count = 0;
  filteredData.forEach((item) => {
    const bar = document.createElement("a");
    bar.classList.add("bar", item.status.replace("_", "-"));
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
<p class="title">${item.symbol} ${encodeHTML(item.title)}</p>
<dl>
  <dt class="duration">Duration</dt><dd>${formatDuration(item.duration)}</dd>
  <dt class="started-at">Started At</dt><dd>${item.startTime.toLocaleString()}</dd>
  <dt>Attempt</dt><dd>${item.attempt}</dd>
</dl>
`;

    bar.appendChild(barInner);
    bar.appendChild(tooltip);
    chartContainer.appendChild(bar);
  });

  if (updateTime) {
    absoluteUpdateTimeElement.textContent = updateTime.toLocaleString();
    relativeUpdateTimeElement.textContent = `(${getRelativeTimeString(updateTime)})`;
  } else {
    absoluteUpdateTimeElement.textContent = "N/A";
    relativeUpdateTimeElement.textContent = "";
  }

  failureRateElement.textContent = `${
    failureRate == null ? "N/A" : `${(failureRate * 100).toFixed(1)}%`
  }`;
  DURATION_PERCENTILES.forEach((percentile) => {
    const duration = durationPercentiles[percentile];
    durationPercentileElements[percentile].textContent =
      duration == null ? "N/A" : formatDuration(duration);
  });

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

  tokenSettingsButton.addEventListener("click", async () => {
    const saved = await openTokenDialog();
    if (saved) {
      if (repository) {
        refresh(true);
      } else {
        data = [];
        updateTime = null;
        render();
      }
    }
  });

  Object.values(tokenModeInputs).forEach((input) => {
    input.addEventListener("change", updateTokenSections);
  });

  tokenCancelButton.addEventListener("click", () => {
    dialog.close("cancel");
  });

  tokenForm.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;

    if (e.metaKey) {
      e.preventDefault();
      submitTokenDialog();
      return;
    }

    if (e.target instanceof HTMLInputElement && e.target.type === "password") {
      e.preventDefault();
      moveToNextTokenInput(e.target);
    }
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
renderRepositoryOptions();
refresh();

// setup relative time polling
setInterval(() => {
  if (updateTime && !document.body.classList.contains("loading")) {
    relativeUpdateTimeElement.textContent = `(${getRelativeTimeString(updateTime)})`;
  }
}, 1000);
