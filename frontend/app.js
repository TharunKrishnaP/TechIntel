// TechIntel — Interactive Cyber-Radar & Plain-English Controller

const state = {
  theme: localStorage.getItem('techintel_theme') || 'nebula',
  activeTab: 'feed',
  audienceMode: 'simple', // Default to Simple Mode for non-tech friendliness!
  readingDepth: 'standard', // 'quick', 'standard', 'deep'
  selectedCategory: 'All',
  selectedImportance: 'All',
  searchQuery: '',
  // Historical browsing window. `days` = trailing N days; 'all' disables the filter.
  // Defaults to the full 30-day trail: the point of this view is the history, so
  // opening on "today only" would hide the very thing it was built to show.
  timeWindow: localStorage.getItem('techintel_time_window') || '30',
  dateFrom: '',
  dateTo: '',
  dayFocus: '', // Set when the user clicks a single heatmap bar.
  events: [],
  technologies: [],
  timeline: null,
  evolutionCache: new Map(),
  selectedForCompare: new Set(['gamma-app', 'beautiful-ai', 'slidesai']),
  upvotedEvents: new Set(JSON.parse(localStorage.getItem('techintel_upvotes') || '[]')),
  trackedTechnologies: new Set(JSON.parse(localStorage.getItem('techintel_tracked') || '[]'))
};

// DOM Elements
const elements = {
  themeChips: document.querySelectorAll('.theme-chip'),
  welcomeBanner: document.getElementById('welcomeBanner'),
  btnDismissBanner: document.getElementById('btnDismissBanner'),

  tabButtons: document.querySelectorAll('.tab-btn'),
  tabViews: document.querySelectorAll('.tab-view'),
  eventsContainer: document.getElementById('eventsContainer'),
  categoryFilters: document.getElementById('categoryFilters'),
  importanceSelect: document.getElementById('importanceSelect'),
  depthPills: document.querySelectorAll('.depth-btn'),
  btnModeTech: document.getElementById('btnModeTech'),
  btnModeSimple: document.getElementById('btnModeSimple'),
  btnRefreshFeed: document.getElementById('btnRefreshFeed'),
  globalSearchInput: document.getElementById('globalSearchInput'),
  btnClearSearch: document.getElementById('btnClearSearch'),

  // Historical browsing
  timePills: document.querySelectorAll('.time-btn'),
  dateFromInput: document.getElementById('dateFromInput'),
  dateToInput: document.getElementById('dateToInput'),
  btnApplyRange: document.getElementById('btnApplyRange'),
  btnClearRange: document.getElementById('btnClearRange'),
  activityHeatmap: document.getElementById('activityHeatmap'),
  heatmapLegend: document.getElementById('heatmapLegend'),
  feedSummaryText: document.getElementById('feedSummaryText'),
  summarySpinner: document.getElementById('summarySpinner'),

  // Finder
  toolFinderInput: document.getElementById('toolFinderInput'),
  btnFindTools: document.getElementById('btnFindTools'),
  checkFreeOnly: document.getElementById('checkFreeOnly'),
  skillLevelSelect: document.getElementById('skillLevelSelect'),
  requirementsInspectionCard: document.getElementById('requirementsInspectionCard'),
  requirementsChips: document.getElementById('requirementsChips'),
  recommendationsContainer: document.getElementById('recommendationsContainer'),

  // Compare
  compareCheckboxGroup: document.getElementById('compareCheckboxGroup'),
  btnExecuteCompare: document.getElementById('btnExecuteCompare'),
  compareTableContainer: document.getElementById('compareTableContainer'),

  // Directory
  directoryContainer: document.getElementById('directoryContainer'),
  directoryCatSelect: document.getElementById('directoryCatSelect'),

  // Stats
  statTotalEvents: document.getElementById('statTotalEvents'),
  statSecEvents: document.getElementById('statSecEvents'),
  statAiEvents: document.getElementById('statAiEvents'),
  statNewToday: document.getElementById('statNewToday'),
  statNewWeek: document.getElementById('statNewWeek'),
  statNewMonth: document.getElementById('statNewMonth'),
  newCountBadge: document.getElementById('newCountBadge'),

  // Modal
  sourcesModal: document.getElementById('sourcesModal'),
  modalTierBadge: document.getElementById('modalTierBadge'),
  modalEventTitle: document.getElementById('modalEventTitle'),
  modalVerificationSummary: document.getElementById('modalVerificationSummary'),
  modalSourcesCount: document.getElementById('modalSourcesCount'),
  modalCitationsList: document.getElementById('modalCitationsList'),
  btnModalClose: document.getElementById('btnModalClose'),

  // Evolution Modal
  evolutionModal: document.getElementById('evolutionModal'),
  evolutionTitle: document.getElementById('evolutionTitle'),
  evolutionBadge: document.getElementById('evolutionBadge'),
  evolutionLoading: document.getElementById('evolutionLoading'),
  evolutionContent: document.getElementById('evolutionContent'),
  evolutionSummary: document.getElementById('evolutionSummary'),
  versionTrail: document.getElementById('versionTrail'),
  evolutionBreakdown: document.getElementById('evolutionBreakdown'),
  evolutionTimeline: document.getElementById('evolutionTimeline'),
  btnEvolutionClose: document.getElementById('btnEvolutionClose')
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  initCyberRadarCanvas();
  applyTheme(state.theme);
  checkBannerStatus();
  setupEventListeners();
  applyTimeWindowToUI();
  fetchStats();
  fetchEvents();
  fetchTechnologies();
  fetchTimeline();
});

// Interactive 3D Cyber-Radar Canvas with Perspective Grid & Particles
function initCyberRadarCanvas() {
  const canvas = document.getElementById('radarMeshCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let width = canvas.width = window.innerWidth;
  let height = canvas.height = window.innerHeight;

  let mouse = { x: width / 2, y: height / 2, active: false };

  window.addEventListener('resize', () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  });

  window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.active = true;
  });

  window.addEventListener('mouseleave', () => {
    mouse.active = false;
  });

  // Floating Star/Data Nodes
  const nodeCount = Math.floor((width * height) / 28000);
  const nodes = [];
  for (let i = 0; i < Math.max(35, nodeCount); i++) {
    nodes.push({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      radius: Math.random() * 2.2 + 1,
      baseAlpha: Math.random() * 0.6 + 0.25,
      color: Math.random() > 0.4 ? '6, 182, 212' : '99, 102, 241'
    });
  }

  let gridOffset = 0;
  let radarAngle = 0;

  function render() {
    ctx.clearRect(0, 0, width, height);

    // 1. Draw 3D Perspective Cyber-Grid on the bottom floor
    const horizonY = height * 0.68;
    const gridDepth = height - horizonY;
    gridOffset = (gridOffset + 0.4) % 40;

    ctx.save();
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.12)';
    ctx.lineWidth = 1;

    // Horizontal receding lines
    for (let y = horizonY; y < height; y += (y - horizonY) * 0.28 + 6) {
      const alpha = Math.min(0.22, (y - horizonY) / gridDepth * 0.25);
      ctx.strokeStyle = `rgba(6, 182, 212, ${alpha})`;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Perspective converging vertical lines
    const numVanishingLines = 26;
    for (let i = 0; i <= numVanishingLines; i++) {
      const bottomX = (width / numVanishingLines) * i + (gridOffset * 0.5);
      const topX = width * 0.5 + (bottomX - width * 0.5) * 0.15;
      ctx.beginPath();
      ctx.moveTo(topX, horizonY);
      ctx.lineTo(bottomX, height);
      ctx.stroke();
    }
    ctx.restore();

    // 2. Radar Sweep Beam from Top Center
    radarAngle += 0.015;
    const rcx = width * 0.5;
    const rcy = height * 0.35;
    const radarRadius = Math.min(width, height) * 0.45;

    ctx.save();
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(rcx, rcy, radarRadius * 0.4, 0, Math.PI * 2);
    ctx.arc(rcx, rcy, radarRadius * 0.8, 0, Math.PI * 2);
    ctx.arc(rcx, rcy, radarRadius, 0, Math.PI * 2);
    ctx.stroke();

    // Sweep cone
    const sweepGradient = ctx.createRadialGradient(rcx, rcy, 0, rcx, rcy, radarRadius);
    sweepGradient.addColorStop(0, 'rgba(6, 182, 212, 0.08)');
    sweepGradient.addColorStop(1, 'rgba(6, 182, 212, 0)');
    ctx.fillStyle = sweepGradient;
    ctx.beginPath();
    ctx.moveTo(rcx, rcy);
    ctx.arc(rcx, rcy, radarRadius, radarAngle, radarAngle + 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 3. Connect floating constellation particles
    ctx.lineWidth = 0.8;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 140) {
          const alpha = (1 - dist / 140) * 0.2;
          ctx.strokeStyle = `rgba(99, 102, 241, ${alpha})`;
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.stroke();
        }
      }
    }

    // 4. Update and draw nodes with gentle mouse interaction
    for (const node of nodes) {
      if (mouse.active) {
        const mdx = node.x - mouse.x;
        const mdy = node.y - mouse.y;
        const mdist = Math.sqrt(mdx * mdx + mdy * mdy);
        if (mdist < 120) {
          const force = (1 - mdist / 120) * 2;
          node.x += (mdx / mdist) * force;
          node.y += (mdy / mdist) * force;
        }
      }

      node.x += node.vx;
      node.y += node.vy;

      if (node.x < 0) node.x = width;
      if (node.x > width) node.x = 0;
      if (node.y < 0) node.y = height;
      if (node.y > height) node.y = 0;

      ctx.fillStyle = `rgba(${node.color}, ${node.baseAlpha})`;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    requestAnimationFrame(render);
  }

  render();
}

// 4-Theme Management
function applyTheme(themeName) {
  state.theme = themeName;
  document.documentElement.setAttribute('data-theme', themeName);
  document.body.className = `theme-${themeName}`;
  localStorage.setItem('techintel_theme', themeName);

  elements.themeChips.forEach(chip => {
    chip.classList.toggle('active', chip.dataset.theme === themeName);
  });
}

function checkBannerStatus() {
  if (localStorage.getItem('techintel_banner_dismissed') === 'true') {
    elements.welcomeBanner.style.display = 'none';
  }
}

function setupEventListeners() {
  // Theme Chips
  elements.themeChips.forEach(chip => {
    chip.addEventListener('click', () => {
      applyTheme(chip.dataset.theme);
    });
  });

  // Dismiss Banner
  elements.btnDismissBanner.addEventListener('click', () => {
    elements.welcomeBanner.style.display = 'none';
    localStorage.setItem('techintel_banner_dismissed', 'true');
  });

  // Navigation Tabs
  elements.tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });

  // Reading Depth Slider
  elements.depthPills.forEach(btn => {
    btn.addEventListener('click', () => {
      elements.depthPills.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.readingDepth = btn.dataset.depth;
      renderEvents();
    });
  });

  // Audience Mode Switch (Technical vs Simple)
  elements.btnModeTech.addEventListener('click', () => setAudienceMode('tech'));
  elements.btnModeSimple.addEventListener('click', () => setAudienceMode('simple'));

  // Initialize active button state for audience mode
  elements.btnModeTech.classList.toggle('active', state.audienceMode === 'tech');
  elements.btnModeSimple.classList.toggle('active', state.audienceMode === 'simple');

  // Category Filters
  elements.categoryFilters.addEventListener('click', (e) => {
    if (e.target.classList.contains('cat-chip')) {
      document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
      e.target.classList.add('active');
      state.selectedCategory = e.target.dataset.cat;
      renderEvents();
    }
  });

  // Importance Filter
  elements.importanceSelect.addEventListener('change', (e) => {
    state.selectedImportance = e.target.value;
    renderEvents();
  });

  // Time Window Presets (Today / 7 Days / 30 Days / All Time)
  elements.timePills.forEach(btn => {
    btn.addEventListener('click', () => {
      elements.timePills.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.timeWindow = btn.dataset.days;
      state.dateFrom = '';
      state.dateTo = '';
      state.dayFocus = '';
      elements.dateFromInput.value = '';
      elements.dateToInput.value = '';
      localStorage.setItem('techintel_time_window', state.timeWindow);
      fetchEvents();
    });
  });

  // Custom Date Range
  elements.btnApplyRange.addEventListener('click', () => {
    const from = elements.dateFromInput.value;
    const to = elements.dateToInput.value;
    if (!from && !to) {
      setFeedSummary('Pick at least one boundary date, or use a preset window.', true);
      return;
    }
    elements.timePills.forEach(b => b.classList.remove('active'));
    state.timeWindow = 'custom';
    state.dateFrom = from;
    state.dateTo = to;
    // Only call it a "day focus" when both bounds collapse to the same date.
    state.dayFocus = (from && from === to) ? from : '';
    localStorage.setItem('techintel_time_window', 'custom');
    fetchEvents();
  });

  elements.btnClearRange.addEventListener('click', () => {
    state.dateFrom = '';
    state.dateTo = '';
    state.dayFocus = '';
    elements.dateFromInput.value = '';
    elements.dateToInput.value = '';
    state.timeWindow = '30';
    localStorage.setItem('techintel_time_window', '30');
    applyTimeWindowToUI();
    fetchEvents();
  });

  // Global Search
  elements.globalSearchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.toLowerCase().trim();
    elements.btnClearSearch.style.display = state.searchQuery ? 'block' : 'none';
    if (state.activeTab === 'feed') renderEvents();
    if (state.activeTab === 'directory') renderDirectory();
  });

  elements.btnClearSearch.addEventListener('click', () => {
    elements.globalSearchInput.value = '';
    state.searchQuery = '';
    elements.btnClearSearch.style.display = 'none';
    if (state.activeTab === 'feed') renderEvents();
    if (state.activeTab === 'directory') renderDirectory();
  });

  // Sync / Refresh Feed
  elements.btnRefreshFeed.addEventListener('click', async () => {
    elements.btnRefreshFeed.classList.add('loading');
    elements.btnRefreshFeed.disabled = true;
    try {
      await fetch('/api/refresh-feed', { method: 'POST' });
      await fetchStats();
      await fetchEvents();
      await fetchTimeline();
    } catch (err) {
      console.error("Failed to sync feeds:", err);
    } finally {
      elements.btnRefreshFeed.classList.remove('loading');
      elements.btnRefreshFeed.disabled = false;
    }
  });

  // Tool Finder Actions
  elements.btnFindTools.addEventListener('click', executeToolSearch);

  // Compare Actions
  elements.btnExecuteCompare.addEventListener('click', executeCompare);

  // Directory Category Select
  elements.directoryCatSelect.addEventListener('change', () => {
    renderDirectory();
  });

  // Modal Close
  elements.btnModalClose.addEventListener('click', () => {
    elements.sourcesModal.style.display = 'none';
  });
  elements.btnEvolutionClose.addEventListener('click', () => {
    elements.evolutionModal.style.display = 'none';
  });
  window.addEventListener('click', (e) => {
    if (e.target === elements.sourcesModal) {
      elements.sourcesModal.style.display = 'none';
    }
    if (e.target === elements.evolutionModal) {
      elements.evolutionModal.style.display = 'none';
    }
  });
}

// Reflect the persisted time window in the UI on page load
function applyTimeWindowToUI() {
  elements.timePills.forEach(b => {
    b.classList.toggle('active', b.dataset.days === state.timeWindow);
  });
}

window.filterBySearch = function(keyword) {
  elements.globalSearchInput.value = keyword;
  state.searchQuery = keyword.toLowerCase();
  elements.btnClearSearch.style.display = 'block';
  switchTab('feed');
  renderEvents();
  window.scrollTo({ top: 320, behavior: 'smooth' });
};

window.selectQuickGoal = function(queryText) {
  elements.toolFinderInput.value = queryText;
  executeToolSearch();
  window.scrollTo({ top: 400, behavior: 'smooth' });
};

window.switchTab = function(tabId) {
  state.activeTab = tabId;
  elements.tabButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  elements.tabViews.forEach(view => {
    view.classList.toggle('active', view.id === `tab-${tabId}`);
  });

  if (tabId === 'compare' && elements.compareCheckboxGroup.children.length === 0) {
    renderCompareSelector();
    executeCompare();
  }
};

function setAudienceMode(mode) {
  state.audienceMode = mode;
  elements.btnModeTech.classList.toggle('active', mode === 'tech');
  elements.btnModeSimple.classList.toggle('active', mode === 'simple');
  renderEvents();
}

// Fetch Stats from Backend
async function fetchStats() {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) return;
    const stats = await res.json();
    elements.statTotalEvents.textContent = stats.total_events;
    elements.statSecEvents.textContent = stats.critical_security_count;
    elements.statAiEvents.textContent = stats.ai_updates_count;
    elements.statNewToday.textContent = stats.new_today;
    elements.statNewWeek.textContent = stats.new_this_week;
    elements.statNewMonth.textContent = stats.new_this_month;
    elements.newCountBadge.textContent = `+${stats.new_today}`;
  } catch (err) {
    console.error("Error fetching stats:", err);
  }
}

// Build the query string for the currently selected time window
function buildTimeWindowParams() {
  const params = new URLSearchParams();
  if (state.dateFrom) params.set('date_from', state.dateFrom);
  if (state.dateTo) params.set('date_to', state.dateTo);
  if (state.timeWindow && state.timeWindow !== 'all' && state.timeWindow !== 'custom' && !state.dateFrom && !state.dateTo) {
    params.set('days', state.timeWindow);
  }
  return params;
}

// Human-readable label for the active window, used in the summary line
function describeTimeWindow() {
  if (state.timeWindow === 'all') return 'all time';
  if (state.timeWindow === 'custom') {
    const parts = [];
    if (state.dateFrom) parts.push(`from ${state.dateFrom}`);
    if (state.dateTo) parts.push(`until ${state.dateTo}`);
    return parts.join(' ') || 'custom range';
  }
  if (state.timeWindow === '1') return 'the last 24 hours';
  return `the last ${state.timeWindow} days`;
}

function setFeedSummary(text, isWarning = false) {
  if (!elements.feedSummaryText) return;
  elements.feedSummaryText.textContent = text;
  elements.feedSummaryText.style.color = isWarning ? 'var(--accent-amber)' : '';
  if (elements.summarySpinner) elements.summarySpinner.style.display = 'none';
}

// Fetch Events from Backend, honouring the active historical time window
async function fetchEvents() {
  if (elements.summarySpinner) elements.summarySpinner.style.display = 'inline-block';
  setFeedSummary('Loading feed…');
  try {
    const params = buildTimeWindowParams();
    const qs = params.toString();
    const res = await fetch(`/api/feed?limit=100${qs ? `&${qs}` : ''}`);
    if (!res.ok) throw new Error('Feed request failed');
    state.events = await res.json();
    renderEvents();
  } catch (err) {
    console.error("Error fetching events:", err);
    elements.eventsContainer.innerHTML = `<div class="empty-state"><p>Could not load events feed. Is the backend running?</p></div>`;
    setFeedSummary('Failed to load the feed.', true);
  }
}

// Fetch the 30-day activity heatmap series
async function fetchTimeline() {
  try {
    const res = await fetch('/api/timeline?days=30');
    if (!res.ok) return;
    state.timeline = await res.json();
    renderHeatmap();
  } catch (err) {
    console.error("Error fetching timeline:", err);
  }
}

// Render the interactive 30-day release-activity heatmap
function renderHeatmap() {
  if (!state.timeline || !elements.activityHeatmap) return;
  const { series, peak } = state.timeline;

  elements.activityHeatmap.innerHTML = series.map(p => {
    const ratio = peak > 0 ? p.count / peak : 0;
    // Bucket into 5 intensity levels so the bar colour is meaningful.
    const level = p.count === 0 ? 0 : ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1;
    const short = p.date.slice(5); // MM-DD
    const isToday = p.date === series[series.length - 1].date;
    return `
      <div class="heat-bar-cell level-${level} ${isToday ? 'is-today' : ''}"
           data-date="${p.date}" data-count="${p.count}"
           title="${p.date}: ${p.count} release${p.count === 1 ? '' : 's'}">
        <div class="heat-bar-fill" style="height:${Math.max(6, ratio * 100)}%"></div>
        <span class="heat-bar-label">${short}</span>
      </div>`;
  }).join('');

  elements.activityHeatmap.querySelectorAll('.heat-bar-cell').forEach(cell => {
    cell.addEventListener('click', () => selectHeatmapDay(cell.dataset.date));
  });

  if (elements.heatmapLegend) {
    elements.heatmapLegend.innerHTML = `
      <span class="legend-label">Less</span>
      <span class="legend-swatch level-0"></span>
      <span class="legend-swatch level-1"></span>
      <span class="legend-swatch level-2"></span>
      <span class="legend-swatch level-3"></span>
      <span class="legend-swatch level-4"></span>
      <span class="legend-label">More</span>
      <span class="legend-peak">Peak: <strong>${peak}</strong>/day</span>`;
  }
}

// Clicking a heatmap bar filters the feed down to that single day
function selectHeatmapDay(date) {
  elements.timePills.forEach(b => b.classList.remove('active'));
  state.timeWindow = 'custom';
  state.dateFrom = date;
  state.dateTo = date;
  state.dayFocus = date;
  elements.dateFromInput.value = date;
  elements.dateToInput.value = date;
  fetchEvents();
  window.scrollTo({ top: 300, behavior: 'smooth' });
}

// Fetch Technologies from Backend
async function fetchTechnologies() {
  try {
    const res = await fetch('/api/tools');
    if (!res.ok) return;
    state.technologies = await res.json();
    renderDirectory();
    renderCompareSelector();
  } catch (err) {
    console.error("Error fetching tools:", err);
  }
}

// Render Events (Live Feed) with Non-Tech Friendly Explanations & Analogies
function renderEvents() {
  const container = elements.eventsContainer;
  const filtered = state.events.filter(evt => {
    if (state.selectedCategory !== 'All' && evt.category !== state.selectedCategory) return false;
    if (state.selectedImportance !== 'All' && evt.importance !== state.selectedImportance) return false;
    if (state.searchQuery) {
      const q = state.searchQuery;
      const match = evt.title.toLowerCase().includes(q) ||
                    evt.summary_tldr.toLowerCase().includes(q) ||
                    evt.technology_name.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  // Reflect the active window + result count so the user always knows what
  // slice of history they are looking at. A heatmap day-focus wins, because it
  // carries context (which day, and how busy it was) the generic line can't add.
  if (filtered.length > 0) {
    if (state.dayFocus) {
      const c = filtered.length;
      setFeedSummary(`📅 Showing ${c} release${c === 1 ? '' : 's'} from ${state.dayFocus} only.`);
    } else {
      const windowLabel = describeTimeWindow();
      const oldestEvent = filtered[filtered.length - 1];
      setFeedSummary(
        `Showing ${filtered.length} of ${state.events.length} event${state.events.length === 1 ? '' : 's'} from ${windowLabel} ` +
        `(oldest: ${relativeAge(oldestEvent.verified_at)}).`
      );
    }
  }

  if (filtered.length === 0) {
    const window = describeTimeWindow();
    // Offer an escape hatch whenever the window is narrower than the full history.
    const canWiden = state.timeWindow !== 'all' && state.timeWindow !== '30';
    container.innerHTML = `
      <div class="empty-state">
        <p>No technology events found matching the selected filters${canWiden ? ` within ${escapeHtml(window)}` : ''}.</p>
        ${canWiden ? `<button class="btn-secondary" onclick="widenTimeWindow()" style="margin-top:14px;">📆 Widen to the full 30-day history</button>` : ''}
      </div>`;
    setFeedSummary(`0 events matched in ${window}.`);
    return;
  }

  container.innerHTML = filtered.map(evt => {
    const isTechMode = state.audienceMode === 'tech';

    // Extract analogy if present in explanation_simple
    let analogyText = "";
    let simpleExplanationClean = evt.explanation_simple;
    if (evt.explanation_simple.includes("Everyday Analogy:")) {
      const parts = evt.explanation_simple.split("Everyday Analogy:");
      analogyText = parts[1].trim();
      simpleExplanationClean = parts[0].replace("💡", "").trim();
    }

    const badgeClass = `badge-${evt.importance}`;
    let importanceLabel = evt.importance.toUpperCase();
    if (evt.importance === 'critical') importanceLabel = '🔴 CRITICAL (MUST KNOW)';
    else if (evt.importance === 'major') importanceLabel = '🟠 MAJOR RELEASE';
    else if (evt.importance === 'significant') importanceLabel = '🟡 FEATURE UPDATE';
    else importanceLabel = '🔵 ROUTINE UPDATE';

    const previousList = evt.what_changed.previous_state.map(s => `<li>${escapeHtml(s)}</li>`).join('');
    const newList = evt.what_changed.new_state.map(s => `<li>${escapeHtml(s)}</li>`).join('');
    const personaPills = evt.impact_audiences.map(p => `<span class="persona-pill">${escapeHtml(p)}</span>`).join('');

    let tierFriendlyLabel = "Tier 1 • Official Creator";
    if (evt.primary_source_tier === 2) tierFriendlyLabel = "Tier 2 • Tech Press";
    if (evt.primary_source_tier === 3) tierFriendlyLabel = "Tier 3 • Community";

    const isUpvoted = state.upvotedEvents.has(evt.id);
    const isTracked = state.trackedTechnologies.has(evt.technology_id || evt.technology_name);

    // Reading Depth Adaptations
    const showDelta = state.readingDepth !== 'quick';
    const showAnalogy = state.readingDepth !== 'quick' && analogyText;
    const showDeepCitations = state.readingDepth === 'deep';

    return `
      <article class="event-card ${evt.importance}">
        <div class="event-header">
          <div class="badge-row">
            <span class="badge ${badgeClass}">${importanceLabel}</span>
            <span class="tech-tag">${escapeHtml(evt.technology_name)}</span>
            <span class="badge badge-normal">${evt.category}</span>
            ${ageBadge(evt.verified_at)}
          </div>

          <div class="source-verification-badge" title="Verified official documentation or technical release">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
            <span>${tierFriendlyLabel}</span>
          </div>
        </div>

        <h3 class="event-title">${escapeHtml(evt.title)}</h3>
        <p class="event-tldr">${escapeHtml(evt.summary_tldr)}</p>

        <!-- Everyday Analogy Box for Non-Tech Visitors -->
        ${showAnalogy ? `
        <div class="analogy-box">
          <span class="analogy-icon">💡</span>
          <div class="analogy-text">
            <strong>In Simple Terms (Everyday Analogy)</strong>
            <p>${escapeHtml(analogyText)}</p>
          </div>
        </div>
        ` : ''}

        <!-- What Changed Delta Box (Plain English Before vs Now) -->
        ${showDelta ? `
        <div class="delta-box">
          <div class="delta-header">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            <span>What Changed? (Old Limitation vs. New Capability)</span>
          </div>
          <div class="delta-columns">
            <div class="delta-column col-previous">
              <h5>❌ Old Limitation (Before)</h5>
              <ul>${previousList}</ul>
            </div>
            <div class="delta-column col-new">
              <h5>✅ New Superpower (Now You Can)</h5>
              <ul>${newList}</ul>
            </div>
          </div>
        </div>
        ` : ''}

        <!-- Active Mode Explanation Box -->
        ${isTechMode ? `
        <div class="explanation-block mode-tech">
          <span class="exp-label">🛠️ Technical Architecture & Under-The-Hood Delta:</span>
          <p>${escapeHtml(evt.explanation_technical)}</p>
        </div>
        ` : `
        <div class="explanation-block mode-simple">
          <span class="exp-label">🌟 What This Means For You:</span>
          <p>${escapeHtml(simpleExplanationClean || evt.explanation_simple)}</p>
        </div>
        `}

        <!-- Collapsible Developer Specs (Available for developers without cluttering non-tech users) -->
        ${!isTechMode && evt.explanation_technical ? `
        <details class="tech-details-drawer">
          <summary>🛠️ Software Engineers & Architects: View Technical Specifications</summary>
          <div class="tech-details-content">
            ${escapeHtml(evt.explanation_technical)}
          </div>
        </details>
        ` : ''}

        <!-- Why Use This Tool? — Benefit vs Alternatives Section -->
        ${(() => {
          const tech = state.technologies.find(t => t.id === evt.technology_id);
          if (!tech || !tech.strengths || tech.strengths.length === 0) return '';
          const benefitIcons = ['🚀', '⚡', '🛡️', '🎯', '💡'];
          const topBenefits = tech.strengths.slice(0, 3);
          const benefitItems = topBenefits.map((s, i) =>
            `<div class="why-benefit-item">
              <span class="why-benefit-icon">${benefitIcons[i % benefitIcons.length]}</span>
              <span>${escapeHtml(s)}</span>
            </div>`
          ).join('');
          // Build standout note from limitations comparison
          const standoutNote = tech.limitations && tech.limitations.length > 0
            ? `Compared to alternatives, <strong>${escapeHtml(tech.name)}</strong> ${escapeHtml(tech.tagline || 'stands out for its unique approach')}. Key tradeoff: ${escapeHtml(tech.limitations[0])}.`
            : `<strong>${escapeHtml(tech.name)}</strong> ${escapeHtml(tech.tagline || 'is a top choice in its category')}.`;
          return `
          <div class="why-use-box">
            <div class="why-use-header">
              <span>🔍 Why use</span>
              <span class="why-tool-name">${escapeHtml(tech.name)}</span>
              <span>? What makes it better?</span>
            </div>
            <div class="why-use-benefits">
              ${benefitItems}
            </div>
            <div class="why-standout-note">${standoutNote}</div>
          </div>
          `;
        })()}

        <!-- Deep Dive Extra Citations (Deep mode only) -->
        ${showDeepCitations ? `
        <div style="background: var(--bg-subtle); padding: 14px 18px; border-radius: 10px; margin-bottom: 18px; font-size: 0.84rem;">
          <strong style="color: var(--accent-cyan); display:block; margin-bottom: 8px;">🔬 Primary Verified Citations:</strong>
          ${evt.sources.slice(0, 3).map(s => `<div>• <a href="${s.url}" target="_blank" style="color: var(--accent-cyan); font-weight: 700;">${escapeHtml(s.title)}</a> <span style="color:var(--text-dim);">(${escapeHtml(s.publisher)})</span></div>`).join('')}
        </div>
        ` : ''}

        <!-- Interactive Footer -->
        <div class="event-footer">
          <div class="footer-left">
            <div class="persona-impact">
              <span class="persona-label">Who should care:</span>
              ${personaPills}
            </div>
          </div>

          <div class="footer-actions">
            <!-- Interactive Upvote -->
            <button class="btn-react ${isUpvoted ? 'active' : ''}" onclick="toggleUpvote('${evt.id}', this)" title="Upvote this verified update">
              <span>🔥</span>
              <span class="upvote-count">${isUpvoted ? 'Upvoted' : 'Helpful'}</span>
            </button>

            <!-- Track Tech Button -->
            <button class="btn-react ${isTracked ? 'active' : ''}" onclick="toggleTrack('${evt.technology_id || evt.technology_name}', this)" title="Track this technology">
              <span>${isTracked ? '✓' : '🔖'}</span>
              <span>${isTracked ? 'Tracking' : 'Track'}</span>
            </button>

            <!-- Evolution History (only for tools that exist in the directory) -->
            ${evt.technology_id ? `
            <button class="btn-react evolution-trigger" onclick="openEvolutionModal('${evt.technology_id}')" title="See how this tool has evolved over the past month">
              <span>🧬</span>
              <span>History</span>
            </button>
            ` : ''}

            <!-- Sources Trigger -->
            <button class="sources-trigger-btn" onclick="openSourcesModal('${evt.id}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              <span>${evt.sources_count} Sources</span>
            </button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

window.toggleUpvote = function(eventId, btn) {
  if (state.upvotedEvents.has(eventId)) {
    state.upvotedEvents.delete(eventId);
    btn.classList.remove('active');
    btn.querySelector('.upvote-count').textContent = 'Helpful';
  } else {
    state.upvotedEvents.add(eventId);
    btn.classList.add('active');
    btn.querySelector('.upvote-count').textContent = 'Upvoted';
  }
  localStorage.setItem('techintel_upvotes', JSON.stringify(Array.from(state.upvotedEvents)));
};

window.toggleTrack = function(techId, btn) {
  if (state.trackedTechnologies.has(techId)) {
    state.trackedTechnologies.delete(techId);
    btn.classList.remove('active');
    btn.innerHTML = `<span>🔖</span><span>Track</span>`;
  } else {
    state.trackedTechnologies.add(techId);
    btn.classList.add('active');
    btn.innerHTML = `<span>✓</span><span>Tracking</span>`;
  }
  localStorage.setItem('techintel_tracked', JSON.stringify(Array.from(state.trackedTechnologies)));
};

// Modal Sources Viewer
window.openSourcesModal = function(eventId) {
  const evt = state.events.find(e => e.id === eventId);
  if (!evt) return;

  elements.modalEventTitle.textContent = evt.title;
  elements.modalTierBadge.textContent = `Primary: Tier ${evt.primary_source_tier} Verified`;
  elements.modalSourcesCount.textContent = evt.sources.length;

  elements.modalVerificationSummary.innerHTML = `
    <div style="background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.3); padding: 14px; border-radius: 8px; margin-bottom: 18px;">
      <p style="font-size: 0.88rem; color: var(--accent-emerald); font-weight: 700; margin-bottom: 4px;">✓ Confirmed Technology Event</p>
      <p style="font-size: 0.84rem; color: var(--text-main);">Clustered from ${evt.sources_count} independent reports, official release notes, and changelogs. Highest verification recorded at ${evt.verified_at}.</p>
    </div>
  `;

  elements.modalCitationsList.innerHTML = evt.sources.map(src => `
    <div class="citation-item">
      <div class="citation-header">
        <span class="citation-publisher">${escapeHtml(src.publisher)}</span>
        <span class="citation-tier">${escapeHtml(src.tier_label)}</span>
      </div>
      <div class="citation-title">
        <a href="${src.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(src.title)} ↗</a>
      </div>
      <div class="citation-time">Published: ${escapeHtml(src.published_at)}</div>
    </div>
  `).join('');

  elements.sourcesModal.style.display = 'flex';
};

// Escape a narrow window when the feed comes back empty
window.widenTimeWindow = function(days = 30) {
  elements.timePills.forEach(b => b.classList.toggle('active', b.dataset.days === String(days)));
  state.timeWindow = String(days);
  state.dateFrom = '';
  state.dateTo = '';
  state.dayFocus = '';
  elements.dateFromInput.value = '';
  elements.dateToInput.value = '';
  localStorage.setItem('techintel_time_window', String(days));
  fetchEvents();
};

// ---------------------------------------------------------------------------
// Evolution History Modal — "how did this tool get here?"
// ---------------------------------------------------------------------------
window.openEvolutionModal = async function(toolId) {
  const tech = state.technologies.find(t => t.id === toolId);

  elements.evolutionModal.style.display = 'flex';
  elements.evolutionLoading.style.display = 'block';
  elements.evolutionContent.style.display = 'none';
  elements.evolutionTitle.textContent = tech ? `${tech.name} — Evolution History` : 'Tool Evolution History';
  elements.versionTrail.innerHTML = '';
  elements.evolutionBreakdown.innerHTML = '';
  elements.evolutionTimeline.innerHTML = '';

  try {
    let data = state.evolutionCache.get(toolId);
    if (!data) {
      const res = await fetch(`/api/tools/${toolId}/evolution?days=30`);
      if (!res.ok) throw new Error('evolution request failed');
      data = await res.json();
      state.evolutionCache.set(toolId, data);
    }

    // Drop the modal if the user closed it while the fetch was in flight.
    if (elements.evolutionModal.style.display !== 'flex') return;

    // Take the name from the payload rather than only from `state.technologies`:
    // a click can land before /api/tools resolves, and the API always knows it.
    elements.evolutionTitle.textContent = `${data.technology.name} — Evolution History`;
    elements.evolutionBadge.textContent = `🧬 ${data.technology.name} EVOLUTION`;

    renderEvolutionContent(data);
    elements.evolutionLoading.style.display = 'none';
    elements.evolutionContent.style.display = 'block';
  } catch (err) {
    console.error('Error loading evolution history:', err);
    elements.evolutionLoading.innerHTML = `
      <p style="color:var(--accent-rose);">Could not load the evolution history for this tool.</p>`;
  }
};

function renderEvolutionContent(data) {
  const { summary, version_timeline, recent_events, event_breakdown, period_days, technology } = data;

  // 1. Summary stat cards
  const statCards = [
    { label: 'Tracked Events', value: summary.total_events, icon: '📋' },
    { label: 'Version Releases', value: summary.version_releases, icon: '🧬' },
    { label: 'Feature Updates', value: summary.feature_updates, icon: '✨' },
    { label: 'Security Patches', value: summary.security_patches, icon: '🛡️' },
    { label: 'Critical', value: summary.critical_events, icon: '🔴' },
    { label: 'Pricing Changes', value: summary.pricing_changes, icon: '💰' }
  ];

  elements.evolutionSummary.innerHTML = `
    <div class="evo-intro">
      <strong>${escapeHtml(technology.name)}</strong> is currently at
      <span class="evo-current-version">${escapeHtml(technology.current_version)}</span>.
      Here is everything we logged for it over the last ${period_days} days.
    </div>
    <div class="evo-stat-grid">
      ${statCards.map(c => `
        <div class="evo-stat">
          <span class="evo-stat-icon">${c.icon}</span>
          <span class="evo-stat-value">${c.value}</span>
          <span class="evo-stat-label">${c.label}</span>
        </div>`).join('')}
    </div>`;

  // 2. Version trail (oldest → newest) as a connected stepper
  if (version_timeline && version_timeline.length > 0) {
    elements.versionTrail.innerHTML = version_timeline.map((v, i) => `
      <div class="trail-step">
        <div class="trail-dot ${v.importance === 'critical' ? 'crit' : v.importance === 'major' ? 'major' : ''}"></div>
        <div class="trail-body">
          <div class="trail-version">${escapeHtml(v.version)}</div>
          <div class="trail-title">${escapeHtml(v.title)}</div>
          <div class="trail-meta">
            ${ageBadge(v.date)} <span class="trail-date">${escapeHtml(v.date)}</span>
          </div>
        </div>
      </div>`).join('');
  } else {
    elements.versionTrail.innerHTML = `<p class="evo-muted">No version-tagged releases logged in this window.</p>`;
  }

  // 3. Event-type breakdown as proportional bars
  const TYPE_META = {
    major_upgrade: { label: '🧬 Major Upgrades', color: 'var(--accent-cyan)' },
    feature_update: { label: '✨ Feature Updates', color: 'var(--accent-emerald)' },
    security_patch: { label: '🛡️ Security Patches', color: 'var(--accent-rose)' },
    pricing_change: { label: '💰 Pricing Changes', color: 'var(--accent-amber)' },
    deprecation: { label: '⚠️ Deprecations', color: 'var(--text-dim)' }
  };
  const bdEntries = Object.entries(event_breakdown).filter(([, v]) => v > 0);
  const bdTotal = bdEntries.reduce((sum, [, v]) => sum + v, 0);

  elements.evolutionBreakdown.innerHTML = bdTotal === 0
    ? `<p class="evo-muted">No events logged in this window.</p>`
    : bdEntries.map(([key, count]) => {
        const meta = TYPE_META[key] || { label: key, color: 'var(--primary)' };
        const pct = Math.round((count / bdTotal) * 100);
        return `
          <div class="bd-row">
            <span class="bd-label">${meta.label}</span>
            <div class="bd-track">
              <div class="bd-fill" style="width:${pct}%; background:${meta.color};"></div>
            </div>
            <span class="bd-count">${count} (${pct}%)</span>
          </div>`;
      }).join('');

  // 4. Full chronological event trail
  const TYPE_PILL = {
    major_upgrade: '🧬 Release', feature_update: '✨ Feature', ai_model: '🧠 AI Model',
    security_patch: '🛡️ Security', pricing_change: '💰 Pricing', deprecation: '⚠️ Deprecation',
    new_tool: '🆕 New Tool'
  };

  elements.evolutionTimeline.innerHTML = recent_events.length === 0
    ? `<p class="evo-muted">No history for this period. Try widening the window to 30 days.</p>`
    : recent_events.map(evt => `
      <div class="evo-event-row ${evt.importance}">
        <div class="evo-event-marker"></div>
        <div class="evo-event-body">
          <div class="evo-event-top">
            <span class="evo-type-pill">${TYPE_PILL[evt.type] || escapeHtml(evt.type)}</span>
            ${ageBadge(evt.date)}
          </div>
          <div class="evo-event-title">${escapeHtml(evt.title)}</div>
          <div class="evo-event-summary">${escapeHtml(evt.summary)}</div>
          <div class="evo-event-date">${escapeHtml(evt.date)}</div>
        </div>
      </div>`).join('');
}

// Purpose-Based Tool Search
async function executeToolSearch() {
  const query = elements.toolFinderInput.value.trim();
  if (!query) return;

  elements.btnFindTools.disabled = true;
  elements.btnFindTools.innerHTML = `<span>Analyzing Requirements...</span>`;

  try {
    const payload = {
      query: query,
      user_skill_level: elements.skillLevelSelect.value,
      force_free_only: elements.checkFreeOnly.checked
    };

    const res = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error('Search failed');
    const data = await res.json();
    renderRecommendations(data);
  } catch (err) {
    elements.recommendationsContainer.innerHTML = `<div class="empty-state"><p>Error extracting tool recommendations. Try again.</p></div>`;
  } finally {
    elements.btnFindTools.disabled = false;
    elements.btnFindTools.innerHTML = `
      <span>Find Best Tools</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
    `;
  }
}

function renderRecommendations(data) {
  elements.requirementsInspectionCard.style.display = 'block';
  elements.requirementsChips.innerHTML = `
    <span class="req-chip"><strong>🎯 Purpose:</strong> ${escapeHtml(data.requirements.purpose)}</span>
    <span class="req-chip"><strong>📁 Category:</strong> ${escapeHtml(data.requirements.category)}</span>
    <span class="req-chip"><strong>💰 Budget:</strong> ${escapeHtml(data.requirements.budget)}</span>
    <span class="req-chip"><strong>👤 Skill Level:</strong> ${escapeHtml(data.requirements.skill_level)}</span>
    ${data.requirements.open_source_preferred ? '<span class="req-chip" style="color:var(--accent-emerald); font-weight:700;">★ Open Source Preferred</span>' : ''}
  `;

  if (data.recommendations.length === 0) {
    elements.recommendationsContainer.innerHTML = `<div class="empty-state"><p>No tools matched these exact criteria.</p></div>`;
    return;
  }

  elements.recommendationsContainer.innerHTML = data.recommendations.map(rec => {
    const t = rec.technology;
    const pros = t.strengths.slice(0, 3).map(s => `<li>${escapeHtml(s)}</li>`).join('');
    const cons = rec.tradeoffs.map(c => `<li>${escapeHtml(c)}</li>`).join('');

    return `
      <div class="recommendation-card">
        <div class="rec-top-row">
          <div class="rec-title-group">
            <h3>${escapeHtml(t.name)}</h3>
            <div class="rec-tagline">${escapeHtml(t.tagline)}</div>
          </div>
          <div class="suitability-gauge">
            <div class="gauge-score">${rec.suitability_score}%</div>
            <div class="gauge-label">Suitability Match</div>
          </div>
        </div>

        <!-- Why This Tool Highlight Box -->
        <div class="why-this-tool-box">
          <div class="why-header">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
            <span>Why This Tool Matches Your Exact Goal</span>
          </div>
          <p class="why-text">${escapeHtml(rec.why_this_tool)}</p>
        </div>

        <!-- Specifications Grid -->
        <div class="specs-grid">
          <div class="spec-item">
            <span class="spec-key">Pricing Model</span>
            <span class="spec-val">${escapeHtml(t.pricing_model)}</span>
          </div>
          <div class="spec-item">
            <span class="spec-key">Free Tier Status</span>
            <span class="spec-val">${t.has_free_tier ? '✅ Free Tier Available' : '❌ Paid Subscription'}</span>
          </div>
          <div class="spec-item">
            <span class="spec-key">License</span>
            <span class="spec-val">${escapeHtml(t.license)}</span>
          </div>
          <div class="spec-item">
            <span class="spec-key">API Support</span>
            <span class="spec-val">${t.has_api ? '✅ Supported' : '❌ No API'}</span>
          </div>
          <div class="spec-item">
            <span class="spec-key">Latest Version</span>
            <span class="spec-val">${escapeHtml(t.current_version)}</span>
          </div>
        </div>

        <!-- Pros vs Tradeoffs -->
        <div class="rec-tradeoffs-row">
          <div class="tradeoff-col pros">
            <h5>Key Strengths</h5>
            <ul>${pros}</ul>
          </div>
          <div class="tradeoff-col cons">
            <h5>Tradeoffs & Limitations to Know</h5>
            <ul>${cons}</ul>
          </div>
        </div>

        <!-- Actions -->
        <div class="rec-actions">
          <button class="btn-secondary" onclick="compareSpecificTool('${t.id}')">⚖️ Compare Specs</button>
          <a class="btn-secondary" href="${t.official_url}" target="_blank" rel="noopener noreferrer">Visit Official Website ↗</a>
        </div>
      </div>
    `;
  }).join('');
}

// Side-by-Side Compare Feature
function renderCompareSelector() {
  elements.compareCheckboxGroup.innerHTML = state.technologies.map(t => {
    const isSelected = state.selectedForCompare.has(t.id);
    return `
      <label class="compare-check-label ${isSelected ? 'selected' : ''}">
        <input type="checkbox" value="${t.id}" ${isSelected ? 'checked' : ''} onchange="toggleCompareSelection('${t.id}', this.checked)">
        <span>${escapeHtml(t.name)}</span>
      </label>
    `;
  }).join('');
}

window.toggleCompareSelection = function(toolId, isChecked) {
  if (isChecked) {
    state.selectedForCompare.add(toolId);
  } else {
    state.selectedForCompare.delete(toolId);
  }
  renderCompareSelector();
};

window.compareSpecificTool = function(toolId) {
  state.selectedForCompare.add(toolId);
  switchTab('compare');
  renderCompareSelector();
  executeCompare();
};

async function executeCompare() {
  const toolIds = Array.from(state.selectedForCompare);
  if (toolIds.length < 2) {
    elements.compareTableContainer.innerHTML = `<div class="empty-state"><p>Please select at least 2 technologies above to compare.</p></div>`;
    return;
  }

  try {
    const res = await fetch('/api/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool_ids: toolIds })
    });
    if (!res.ok) throw new Error('Compare failed');
    const data = await res.json();
    renderCompareTable(data);
  } catch (err) {
    elements.compareTableContainer.innerHTML = `<div class="empty-state"><p>Error generating comparison table.</p></div>`;
  }
}

function renderCompareTable(data) {
  if (!data.tools || data.tools.length === 0) return;

  const headerCells = data.tools.map(t => `<th>${escapeHtml(t.name)}</th>`).join('');

  const rowHtml = data.matrix.map(row => {
    const valueCells = data.tools.map(t => {
      const val = row.values[t.name] || '—';
      return `<td>${escapeHtml(val)}</td>`;
    }).join('');

    return `
      <tr>
        <td class="criteria-label">${escapeHtml(row.criterion)}</td>
        ${valueCells}
      </tr>
    `;
  }).join('');

  elements.compareTableContainer.innerHTML = `
    <table class="compare-matrix-table">
      <thead>
        <tr>
          <th>Evaluation Criteria</th>
          ${headerCells}
        </tr>
      </thead>
      <tbody>
        ${rowHtml}
      </tbody>
    </table>

    <div class="verdict-box">
      <strong>Comparative Suitability Verdict:</strong> ${escapeHtml(data.verdict)}
    </div>
  `;
}

// Tech Directory
function renderDirectory() {
  const cat = elements.directoryCatSelect.value;
  const filtered = state.technologies.filter(t => {
    if (cat !== 'All' && t.category !== cat) return false;
    if (state.searchQuery) {
      const q = state.searchQuery;
      return t.name.toLowerCase().includes(q) || t.tagline.toLowerCase().includes(q);
    }
    return true;
  });

  elements.directoryContainer.innerHTML = filtered.map(t => `
    <div class="dir-card">
      <div>
        <div class="dir-top">
          <h4 class="dir-name">${escapeHtml(t.name)}</h4>
          <span class="dir-ver">${escapeHtml(t.current_version)}</span>
        </div>
        <p class="dir-tagline">${escapeHtml(t.tagline)}</p>
        <div class="dir-meta">
          <span class="dir-meta-tag">${escapeHtml(t.category)}</span>
          <span class="dir-meta-tag">${escapeHtml(t.pricing_model)}</span>
          <span class="dir-meta-tag">${t.has_api ? 'API Ready' : 'No API'}</span>
          <span class="dir-meta-tag">${escapeHtml(t.license)}</span>
        </div>
      </div>

      <div class="dir-bottom">
        <span class="dir-events-badge">● ${t.recent_events_count} Updates (30d)</span>
        <div class="dir-actions">
          <button class="btn-secondary btn-evolution" onclick="openEvolutionModal('${t.id}')" title="Browse the ${escapeHtml(t.name)} release trail">
            🧬 History
          </button>
          <button class="btn-secondary" onclick="compareSpecificTool('${t.id}')">⚖️ Compare</button>
        </div>
      </div>
    </div>
  `).join('');
}

// Utility: escape HTML
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Parse the DB timestamp format: "YYYY-MM-DD HH:MM UTC"
function parseDbDate(str) {
  if (!str) return null;
  const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
}

// Render "3h ago" style relative age, so a month of history reads naturally.
function relativeAge(str) {
  const d = parseDbDate(str);
  if (!d) return '';
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

// Compact badge: how long ago an event was verified
function ageBadge(str) {
  const rel = relativeAge(str);
  if (!rel) return '';
  const cls = rel.includes('m ago') || rel.includes('just now') ? 'fresh'
            : rel.includes('h ago') || rel === 'yesterday' ? 'recent'
            : 'historic';
  return `<span class="age-badge ${cls}" title="Verified ${escapeHtml(str)}">🕒 ${escapeHtml(rel)}</span>`;
}
