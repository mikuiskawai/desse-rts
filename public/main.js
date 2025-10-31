"use strict";

const socket = io();
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const startBtn = document.getElementById("startBtn");
const matchStatus = document.getElementById("matchStatus");
const home = document.getElementById("home");
const loader = document.getElementById("loader");
const nicknameInput = document.getElementById("nickname");
// Sub-Commander UI
const scBtn1 = document.getElementById("scBtn1");
const scBtn2 = document.getElementById("scBtn2");
const scBtn3 = document.getElementById("scBtn3");
const scBtn4 = document.getElementById("scBtn4");


const addUnitBtn1 = document.getElementById("addUnitBtn1");
const addUnitBtn2 = document.getElementById("addUnitBtn2");
const addBuildingBtn1 = document.getElementById("addBuildingBtn1");
const addBuildingBtn2 = document.getElementById("addBuildingBtn2");
const addBuildingBtn3 = document.getElementById("addBuildingBtn3");
const addBuildingBtn4 = document.getElementById("addBuildingBtn4");
const addBuildingBtn5 = document.getElementById("addBuildingBtn5");
const resourceBar = document.getElementById("resourceBar");
const gameTimerEl = document.getElementById("gameTimer");


const bp = {
  panel: document.getElementById("buildingPanel"),
  icon: document.getElementById("bpIcon"),
  title: document.getElementById("bpTitle"),
  desc: document.getElementById("bpDesc"),
  queueWrap: document.getElementById("queueWrap"),
  queueList: document.getElementById("queueList"),
};
const build = {
  panel: document.getElementById("buildPanel"),
  icon: document.getElementById("buildIcon"),
  title: document.getElementById("buildTitle"),
  desc: document.getElementById("buildDesc"),
};
const ui = {
  panel: document.getElementById("unitInfo"),
  icon: document.getElementById("unitIcon"),
  name: document.getElementById("unitName"),
  type: document.getElementById("unitType"),
  hpFill: document.getElementById("unitHpFill"),
  hpText: document.getElementById("unitHpText"),
  atk: document.getElementById("unitAtk"),
  armor: document.getElementById("unitArmor"),
  range: document.getElementById("unitRange"),
  period: document.getElementById("unitPeriod"),
  speed: document.getElementById("unitSpeed"),
  multiWrap: document.getElementById("unitMulti"),
  multiCount: document.getElementById("multiCount"),
};

// Safe fallbacks for optional stat elements to prevent null.textContent errors
try {
  ["atk", "armor", "range", "period", "speed"].forEach((k) => {
    if (!ui[k]) ui[k] = { textContent: "" };
  });
} catch (_) { }

const cancelBuildBtn = document.getElementById("cancelBuildBtn");
// Toast helper
const toastEl = document.getElementById("toast");
let toastTimer = null;
function showToast(msg, ms = 2000) {
  try {
    if (!toastEl) { console.warn('toast element missing'); return; }
    toastEl.textContent = String(msg ?? '');
    toastEl.classList.remove('hidden');
    // force reflow to restart transition
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
      // allow transition to finish before hiding
      setTimeout(() => toastEl.classList.add('hidden'), 250);
    }, Math.max(500, ms | 0));
  } catch (_) { }
}
// Override blocking alerts with non-blocking toast
try { window.alert = (m) => showToast(String(m ?? ''), 2000); } catch (_) { }


let mapData = null;
let tileImages = {};
let unitTypes = {};
let buildingTypes = {};
let unitImages = {};
let unitAttackImages = {};
let unitWalkingImages = {};
let unitWorkingImages = {};
let unitWorkingImages2 = {};
let buildingImages = {};
let fogState = null;
const FOG_SETTINGS = {
  defaultUnitVision: 8,
  defaultBuildingVision: 10,
  minVision: 3,
  hiddenColor: "rgba(0,0,0,0.88)",
  exploredColor: "rgba(0,0,0,0.35)",
  extraFogTiles: 1,
  minimapHiddenColor: "rgba(0,0,0,0.85)",
  minimapExploredColor: "rgba(0,0,0,0.5)",
};
const FOG_ENABLED = true;
const FOG_UPDATE_INTERVAL = 1.0; // seconds between fog recomputations

let fogOverlays = [];

let myTeam = "A";
let enemyTeam = "B";
const teamNames = { A: "Player", B: "Enemy", neutral: "중립" };

let playerUnits = [];
let enemyUnits = [];
let playerbuildings = [];
let enemybuildings = [];
let gameClockElapsed = 0;
let gameClockRunning = false;
let hasEverOwnedBuilding = false;
let defeatTriggered = false;
let lastGameTimerSecond = -1;
// Track entities confirmed dead by server to prevent race-based resurrection
const deadUnits = new Set();      // key: `${team}:${id}`
const deadBuildings = new Set();  // key: `${team}:${id}`

let nickname = "";
let enemyNickname = "";
let roomId = null;
let serverAssignedSpawn = null; // {x, y} if server provides a spawn

// Sub-Commander effects (client-side only)
// speed multipliers: 1.0 = baseline
window.subCommander = null; // { key, trainSpeedMult, moveSpeedMult, unitCostMult, startWorkers }
const SUB_COMMANDERS = {
  prod_slow: { key: 'prod_slow', name: '생산 감독관', trainSpeedMult: 1.2, moveSpeedMult: 1.0, unitCostMult: 1.0, startWorkers: 3 },
  move_fast: { key: 'move_fast', name: '기동 지휘관', trainSpeedMult: 1.0, moveSpeedMult: 1.2, unitCostMult: 1.0, startWorkers: 3 },
  cost_discount: { key: 'cost_discount', name: '보급 지원관', trainSpeedMult: 1.0, moveSpeedMult: 1.0, unitCostMult: 0.90, startWorkers: 3 },
  start_worker4: { key: 'start_worker4', name: '추가 인력 파견', trainSpeedMult: 1.0, moveSpeedMult: 1.0, unitCostMult: 1.0, startWorkers: 4 },
};

function bindSubCommanderUI() {
  const btns = [scBtn1, scBtn2, scBtn3, scBtn4].filter(Boolean);
  const select = (key) => {
    window.subCommander = SUB_COMMANDERS[key] || null;
    for (const b of btns) {
      if (!b) continue;
      b.classList.toggle('selected', b.getAttribute('data-key') === key);
    }
  };
  for (const b of btns) {
    b?.addEventListener('click', () => {
      const key = b.getAttribute('data-key');
      select(key);
    });
  }
  // No default selection; user can start with baseline (3 workers)
}
bindSubCommanderUI();
resetGameClock();


let cameraX = 0, cameraY = 0;
let mouseX = 0, mouseY = 0;
let edgeMouseX = 0, edgeMouseY = 0;
let viewW = 0, viewH = 0;

let isDragging = false;
let dragStart = null;
let dragEnd = null;
let dragExtendSelection = false;
let mouseIsDown = false;
let potentialClick = false;
const DRAG_THRESHOLD = 6;

let selectedBuildingId = null;
let inspectedTarget = null;

let buildMode = false;
let currentBuildType = "nexus";
let maptemp = 0;
// Units selected at the moment we enter build mode (used to assign builders)
let buildModeSelectedUnitIds = [];

let isAttackMode = false;
const CURSORS = {
  default: "url('/others/cursor_default.png') 8 8, auto",
  move: "url('/others/cursor_move.png') 8 8, auto",
  attack: "url('/others/cursor_attack.png') 8 8, auto",
  build: "url('/others/cursor_build.png') 8 8, auto",
};
let lastAttackCursor = CURSORS.default;
let activeCanvasCursor = CURSORS.default;
if (canvas) {
  canvas.style.cursor = CURSORS.default;
}
let isRallyPlacementMode = false;

// Helper: cancel build placement mode and clear preview
function cancelBuildMode() {
  if (buildMode) {
    buildMode = false;
    buildModeSelectedUnitIds = [];
    try { window.previewBuilding = null; } catch (_) { }
    updateCanvasCursor();
  }
}

// local resource store and UI bindings
const playerRes = { 401: 500, 402: 0, 403: 0 };
const resElems = {
  401: document.getElementById("res401"),
  402: document.getElementById("res402"),
  403: document.getElementById("res403"),
};
function updateResourceUI() {
  for (const id of [401, 402, 403]) {
    if (resElems[id]) resElems[id].textContent = String(playerRes[id] | 0);
  }
}

function updateGameTimerDisplay(seconds = gameClockElapsed) {
  if (!gameTimerEl) return;
  const total = Math.max(0, Math.floor(seconds));
  if (total === lastGameTimerSecond) return;
  lastGameTimerSecond = total;
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  gameTimerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
}
function resetGameClock() {
  gameClockElapsed = 0;
  gameClockRunning = false;
  lastGameTimerSecond = -1;
  updateGameTimerDisplay(0);
}
function startGameClock() {
  gameClockElapsed = 0;
  gameClockRunning = true;
  lastGameTimerSecond = -1;
  updateGameTimerDisplay(0);
}
function stopGameClock() {
  gameClockRunning = false;
}

// Unit cost helpers (3-resource economy)
function getUnitCost(type) {
  const def = unitTypes[type] || {};
  const c = def.cost;
  if (c == null) return { 401: 0, 402: 0, 403: 0 };
  if (typeof c === "number") return { 401: c | 0, 402: 0, 403: 0 };
  const base = { 401: (c["401"] | 0), 402: (c["402"] | 0), 403: (c["403"] | 0) };
  const mult = (window.subCommander?.unitCostMult) ?? 1.0;
  if (mult === 1.0) return base;
  return {
    401: Math.max(0, Math.floor(base[401] * mult)),
    402: Math.max(0, Math.floor(base[402] * mult)),
    403: Math.max(0, Math.floor(base[403] * mult)),
  };
}
// Building cost helper (3-resource economy)
function getBuildingCost(type) {
  const def = buildingTypes[type] || {};
  const c = def.cost;
  if (c == null) return { 401: 0, 402: 0, 403: 0 };
  if (typeof c === "number") return { 401: c | 0, 402: 0, 403: 0 };
  return {
    401: (c["401"] | 0),
    402: (c["402"] | 0),
    403: (c["403"] | 0),
  };
}
function canAffordCost(cost) {
  return (
    (playerRes[401] | 0) >= (cost[401] | 0) &&
    (playerRes[402] | 0) >= (cost[402] | 0) &&
    (playerRes[403] | 0) >= (cost[403] | 0)
  );
}
function spendCost(cost) {
  playerRes[401] = Math.max(0, (playerRes[401] | 0) - (cost[401] | 0));
  playerRes[402] = Math.max(0, (playerRes[402] | 0) - (cost[402] | 0));
  playerRes[403] = Math.max(0, (playerRes[403] | 0) - (cost[403] | 0));
}
function formatCost(cost) {
  if (cost[402] === 0 && cost[403] === 0) return `M:${cost[401] | 0}`;
  else if (cost[403] === 0) return `M:${cost[401] | 0} P:${cost[402] | 0}`;
  else return `M:${cost[401] | 0} P:${cost[402] | 0} B:${cost[403] | 0}`;
}

// Build menu page state for StarCraft-like category switching
let buildMenuPage = "root"; // 'root' | 'tech1' | 'tech2' | 'tech3' | 'bay' | 'mines'
let wasBuildPanelVisible = false;

function setBuildMenuPage(page) {
  buildMenuPage = page;
  refreshBuildButtons();
}

const TILE_ID_TO_FILE = {
  100: "grass.png",
  101: "grasswithgrass1.png",
  102: "roadcurveeast.png",
  103: "roadcurvenorth.png",
  104: "roadcurvesouth.png",
  105: "roadcurvewest.png",
  106: "roadlefttoptorightbottom.png",
  107: "roadrighttoptoleftbottom.png",
  201: "grasswithrock.png",
  202: "water.png",
  401: "grass.png",
  402: "grass.png",
  403: "grass.png",
};
const TILE_ID_TO_COLOR = {
  100: "#8BDB81",
  101: "#7AD070",
  102: "#A3A3A3",
  103: "#A3A3A3",
  104: "#A3A3A3",
  105: "#A3A3A3",
  106: "#A3A3A3",
  107: "#A3A3A3",
  200: "#374151",
  201: "#475569",
  202: "#3B82F6",
  401: "#CACCCE",
  402: "#000000ff",
  403: "#3ED4BE",
};

const RESOURCE_ID_TO_FILE = {
  401: "magnetite.png",
  402: "petroleum.png",
  403: "beryl.png",
};
let resourceImages = {};
// 5xx: static indestructible obstacles (e.g., trees), rendered like resources
const OBSTACLE_ID_TO_FILE = {
  501: "tree.png",
  502: "trees.png",
  503: "wall.png",
};
let obstacleImages = {};

// Resource-specific extractor (mine) mapping
// 401: Magnetite -> magnetitemine variants
// 402: Petroleum -> oilrig variants
// 403: Beryl     -> berylmine variants
const RESOURCE_TO_MINES = {
  401: ["magnetitemine", "magnetitemine2"],
  402: ["oilrig", "oilrig2"],
  403: ["berylmine", "berylmine2"],
};
const ALL_MINE_TYPES = new Set(Object.values(RESOURCE_TO_MINES).flat());
const BASE_TO_UPGRADE = {
  // Mines only (tech buildings are NOT upgraded anymore)
  magnetitemine: "magnetitemine2",
  oilrig: "oilrig2",
  berylmine: "berylmine2",
};
const BASE_MINE_TYPES = new Set(Object.keys(BASE_TO_UPGRADE));
const UPGRADED_MINE_TYPES = new Set(Object.values(BASE_TO_UPGRADE));

function findResourceBoundToMine(b) {
  if (!mapData || !b) return null;
  const rx = (b._resX != null) ? b._resX : Math.floor(b.x);
  const ry = (b._resY != null) ? b._resY : Math.floor(b.y) + 1;
  return mapData.resources.find(r => Math.floor(r.x) === rx && Math.floor(r.y) === ry) || null;
}

function upgradeMine(b) {
  if (!b || !ALL_MINE_TYPES.has(b.type)) return;
  const up = BASE_TO_UPGRADE[b.type];
  if (!up || !buildingTypes[up]) return;
  // check & spend upgrade cost
  const upCost = getBuildingCost(up);
  if (!canAffordCost(upCost)) {
    alert(`자원이 부족합니다. 필요: ${formatCost(upCost)}`);
    return;
  }
  spendCost(upCost);
  updateResourceUI();
  // start timed upgrade
  b.upgrading = true;
  b.upgradeTarget = up;
  const tgt = buildingTypes[up] || {};
  b.upgradeRemaining = Math.max(0.01, (tgt.upgradeTime ?? tgt.buildTime ?? 5));
  // refresh panels
  renderBuildingPanel?.();
  renderUnitPanel?.();
}

// Return yield per tick for given mine building and resource id
function getMineYieldFor(b, resId) {
  const isUp = UPGRADED_MINE_TYPES.has(b.type);
  if (resId === 401) return isUp ? 15 : 10;   // Magnetite
  if (resId === 402) return isUp ? 6 : 4;   // Petroleum
  if (resId === 403) return isUp ? 3 : 2;   // Beryl (advanced)
  return isUp ? 1 : 1;
}

// primeResourceImagesOnce 함수 동작을 수행
function primeResourceImagesOnce() {
  if (Object.keys(resourceImages).length) return;
  for (const [id, file] of Object.entries(RESOURCE_ID_TO_FILE)) {
    const img = new Image();
    img.src = `/tiles/${file}`;
    resourceImages[id] = img;
  }
}
// Preload obstacle images once
function primeObstacleImagesOnce() {
  if (Object.keys(obstacleImages).length) return;
  for (const [id, file] of Object.entries(OBSTACLE_ID_TO_FILE)) {
    const img = new Image();
    img.src = `/tiles/${file}`;
    obstacleImages[id] = img;
  }
}
const BLOCK_TILE_IDS = new Set([200, 201, 202]);

// resource lookup at tile
function findResourceAtTile(tx, ty) {
  if (!mapData) return null;
  for (const r of (mapData.resources || [])) {
    if ((r.amount | 0) > 0 && Math.floor(r.x) === Math.floor(tx) && Math.floor(r.y) === Math.floor(ty)) {
      return r;
    }
  }
  return null;
}

// isResourceId 함수 동작을 수행
function isResourceId(id) { return Math.floor(id / 100) === 4; }
function isObstacleId(id) { return Math.floor(id / 100) === 5; }

// resourceNameById 함수 동작을 수행
function resourceNameById(id) {
  if (id === 401) return "Magnetite";
  if (id === 402) return "Petroleum";
  if (id === 403) return "Beryl";
  return "Resource";
}


const BUILD_PREREQ = {
  armory: ["nexus"],
  armory2: ["armory"],
  barracks: ["nexus"],
  barracks2: ["barracks"],
  factory: ["nexus"],
  factory2: ["factory"],
  bay: ["nexus"],
  defendtower: ["bay"],
  observe: ["bay"],
  special: ["bay"],
  mine3: ["bay"],
};


// Tech mapping: 2건물은 상위 테크(업그레이드된 건물)에서 두 번째 유닛 생산
// - tech1: armory -> boltaction, armory2 -> quartz
// - tech2: barracks -> shotgun, barracks2 -> niter
// - tech3: factory -> uzi, factory2 -> martensite
const BUILD_PRODUCTION = {
  nexus: ["limestone"],
  // Tech1
  armory: ["boltaction"],
  armory2: ["quartz", "rpg"],
  // Tech2
  barracks: ["shotgun"],
  barracks2: ["niter", "derringer"],
  // Tech3
  factory: ["uzi"],
  factory2: ["martensite", "flamethrower"],
  // Special
};

const BUILD_PRODUCTION_HOTKEYS = ["z", "x", "c", "v", "b"];


// 두 번째 유닛 잠금 해제 조건: 해당 테크 건물을 최소 2채 보유
function countMyBuildingsOf(type) {
  try { return myOwnedBuildings().filter(b => b.type === type).length | 0; } catch (_) { return 0; }
}

// Upgrade path is kept only for mines (see upgradeMine). Tech buildings use build prerequisites instead.


const NEUTRAL = "neutral";

const buildingIdSeq = { A: 0, B: 0, N: 0 };
// Monotonic unit id sequences per faction to avoid id reuse after death
const unitIdSeq = { A: 0, B: 0, N: 0 };
function allocUnitId(team) {
  if (team === "A") return unitIdSeq.A++;
  if (team === "B") return unitIdSeq.B++;
  return unitIdSeq.N++;
}

// clearCombatState 함수 동작을 수행
function clearCombatState(u) {
  // Cancel any ongoing build/attack state and animations
  u._isWorking = false;
  u._workingBuildingId = null;
  u.order = null;
  u._resumeOrder = null;
  u._cd = 0;
  u._attackAnim = 0;
}


function computeBaseCursor() {
  try {
    if (buildMode) return CURSORS.build;
    if (playerUnits.some(u => u.selected)) return CURSORS.move;
  } catch (_) { }
  return CURSORS.default;
}

function updateCanvasCursor() {
  if (!canvas) return;
  const desired = isAttackMode ? CURSORS.attack : computeBaseCursor();
  if (activeCanvasCursor !== desired) {
    canvas.style.cursor = desired;
    activeCanvasCursor = desired;
  }
  if (!isAttackMode) {
    lastAttackCursor = desired;
  }
}


// hasAnyTargetInRange 함수 동작을 수행
function hasAnyTargetInRange(u) {
  const def = unitTypes[u.type] || {};
  const rng = def.range ?? u.range ?? 1.5;
  const foesU = (u.faction === myTeam) ? enemyUnits : playerUnits;
  const foesB = (u.faction === myTeam) ? enemybuildings : playerbuildings;
  const considerFog = FOG_ENABLED && u.faction === myTeam;

  for (const e of foesU) {
    if (considerFog && !isUnitVisibleToPlayer(e)) continue;
    if (Math.hypot(e.x - u.x, e.y - u.y) <= rng + 1e-6) return true;
  }
  for (const b of foesB) {
    if (considerFog && !isBuildingVisibleToPlayer(b)) continue;
    if (distPointToBuilding(u.x, u.y, b) <= rng + 1e-6) return true;
  }
  return false;
}


// configureProductionButtons 함수 동작을 수행
function configureProductionButtons(buildingType) {
  const btns = [addUnitBtn1, addUnitBtn2];
  for (const b of btns) {
    b.classList.add("hidden");
    b.style.display = "none";
    b.textContent = "";
    b.onclick = null;
    b.disabled = false;
    b.style.pointerEvents = "auto";
    if (b && b.dataset) delete b.dataset.hotkey;
  }

  // Special handling for extractor (mine) buildings
  const sel = getSelectedBuilding?.();
  // If building under construction, hide production controls
  if (sel && sel.constructing) {
    return;
  }
  if (sel && ALL_MINE_TYPES.has(sel.type)) {
    // Button 2: show remaining resource amount (readonly)
    const r = findResourceBoundToMine(sel);
    const remain = r ? (r.amount | 0) : 0;
    const infoBtn = addUnitBtn2;
    infoBtn.textContent = `Remain: ${remain}`;
    infoBtn.classList.remove("hidden");
    infoBtn.style.display = "inline-block";
    infoBtn.disabled = true;
    infoBtn.style.pointerEvents = "none";
    if (infoBtn && infoBtn.dataset) delete infoBtn.dataset.hotkey;

    // Button 1: upgrade if base variant
    const up = BASE_TO_UPGRADE[sel.type];
    const upBtn = addUnitBtn1;
    if (up && buildingTypes[up]) {
      const hotkey = BUILD_PRODUCTION_HOTKEYS[0] || "";
      const hotkeyLabel = hotkey ? ` [${hotkey.toUpperCase()}]` : "";
      upBtn.classList.remove("hidden");
      upBtn.style.display = "inline-block";
      const cost = getBuildingCost(up);
      const affordable = canAffordCost(cost);
      const t = buildingTypes[up] || {};
      const timeS = Math.max(0, (t.upgradeTime ?? t.buildTime ?? 5));
      const locked = (sel.upgrading === true) || !affordable;
      try {
        const baseText = sel.upgrading
          ? `Upgrading... (${Math.ceil(sel.upgradeRemaining || timeS)}s)`
          : `Upgrade ${up} (${formatCost(cost)}, ${timeS}s)`;
        upBtn.textContent = `${baseText}${hotkeyLabel}`;
      } catch (e) { upBtn.textContent = `Upgrade${hotkeyLabel}`; }
      if (upBtn && upBtn.dataset) {
        if (hotkey) {
          upBtn.dataset.hotkey = hotkey;
        } else {
          delete upBtn.dataset.hotkey;
        }
      }
      upBtn.disabled = locked;
      upBtn.style.opacity = locked ? 0.6 : 1;
      upBtn.style.cursor = locked ? "not-allowed" : "pointer";
      upBtn.onclick = () => upgradeMine(sel);
    } else {
      // no upgrade available
      upBtn.textContent = "Maxed";
      upBtn.classList.remove("hidden");
      upBtn.style.display = "inline-block";
      upBtn.disabled = true;
      upBtn.style.pointerEvents = "none";
      if (upBtn && upBtn.dataset) delete upBtn.dataset.hotkey;
    }
    return;
  }

  // Default: unit production buttons based on BUILD_PRODUCTION
  const list = BUILD_PRODUCTION[buildingType] || [];
  for (let i = 0; i < Math.min(btns.length, list.length); i++) {
    const unitType = list[i];
    const btn = btns[i];
    const cost = getUnitCost(unitType);
    const selB2 = getSelectedBuilding?.();
    const qLen = selB2 && Array.isArray(selB2._prodQueue) ? selB2._prodQueue.length : 0;
    const hotkey = BUILD_PRODUCTION_HOTKEYS[i] || "";
    const hotkeyLabel = hotkey ? ` [${hotkey.toUpperCase()}]` : "";
    btn.textContent = `${unitType} (${formatCost(cost)}) Q:${qLen}${hotkeyLabel}`;
    if (btn && btn.dataset) {
      if (hotkey) {
        btn.dataset.hotkey = hotkey;
      } else {
        delete btn.dataset.hotkey;
      }
    }
    btn.classList.remove("hidden");
    btn.style.display = "inline-block";
    const affordable = canAffordCost(cost) && !(selB2?.constructing);
    btn.disabled = !affordable;
    btn.style.opacity = affordable ? 1 : 0.6;
    btn.style.cursor = affordable ? "pointer" : "not-allowed";
    btn.onclick = () => { enqueueUnitProduction(unitType); };
  }

  // No tech building upgrades here; mines handle upgrades separately.
}


const minimapWrap = document.getElementById("minimapWrap") || document.querySelector(".minimap");
const minimap = document.getElementById("minimap");
const mctx = minimap.getContext("2d");
if (minimapWrap) minimapWrap.classList.add('hidden');
if (resourceBar) resourceBar.classList.add('hidden');
const MINIMAP_CSS_W = 300;
const MINIMAP_CSS_H = 300;
const MINIMAP_MARGIN_LEFT = 0;
const MINIMAP_MARGIN_RIGHT = 0;
const MINIMAP_MARGIN_TOP = 0;
const MINIMAP_MARGIN_BOTTOM = 0;
let miniDragging = false;


// 미니맵 캔버스 크기와 DPR 설정
function resizeMinimap() {
  const dpr = window.devicePixelRatio || 1;
  minimap.style.width = MINIMAP_CSS_W + "px";
  minimap.style.height = MINIMAP_CSS_H + "px";
  minimap.width = Math.floor(MINIMAP_CSS_W * dpr);
  minimap.height = Math.floor(MINIMAP_CSS_H * dpr);
  mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resizeMinimap();
window.addEventListener("resize", resizeMinimap);



// 화면 좌표 스냅(격자 정렬)
function snap(v, step = 0.8) {
  return Math.round(v / step) * step;
}

function ensureBuildingRallyPointField(b) {
  if (!b || typeof b !== "object") return;
  if (!Object.prototype.hasOwnProperty.call(b, "rallyPoint")) {
    b.rallyPoint = null;
  }
}

function setBuildingRallyPoint(b, worldX, worldY) {
  if (!b) return;
  ensureBuildingRallyPointField(b);
  const [clampedX, clampedY] = clampWorldCoords(worldX, worldY);
  const tileX = Math.floor(clampedX);
  const tileY = Math.floor(clampedY);
  b.rallyPoint = { x: tileX, y: tileY };
  if (b.faction === myTeam) {
    try {
      socket.emit("BuildplayerBuilding", { buildings: playerbuildings.filter(x => x.faction === myTeam), room: roomId });
    } catch (_) { }
  }
  renderBuildingPanel?.();
}

function handlePlayerDefeat() {
  if (defeatTriggered) return;
  defeatTriggered = true;
  gameClockRunning = false;
  showToast?.('패배했습니다.', 5000);
  try { matchStatus.textContent = 'Defeated'; } catch (_) { }
}
function sendUnitToBuildingRally(b, unit) {
  if (!b || !unit) return;
  ensureBuildingRallyPointField(b);
  if (!b.rallyPoint) return;
  const targetX = Math.floor(b.rallyPoint.x);
  const targetY = Math.floor(b.rallyPoint.y);
  const startX = Math.floor(unit.x);
  const startY = Math.floor(unit.y);
  if (startX === targetX && startY === targetY) return;
  const cMap = createCollisionMap();
  if (cMap[startY]) cMap[startY][startX] = 0;
  const path = findPath(startX, startY, targetX, targetY, cMap);
  if (path && path.length) {
    unit.path = path;
  }
  unit.order = { type: "move", tx: targetX, ty: targetY };
}

// 진영 관계를 판정하여 레이블 반환
function relationOf(faction) {
  if (faction === myTeam) return "ally";
  if (faction === enemyTeam) return "enemy";
  return "neutral";
}

function ownerDisplayName(faction) {
  const key = faction == null ? "neutral" : String(faction);
  if (key === NEUTRAL || key === "neutral") return teamNames.neutral;
  if (teamNames[key]) return teamNames[key];
  if (key === myTeam) return nickname || "Player";
  if (key === enemyTeam) return enemyNickname || "Enemy";
  return key;
}


function getUnitEffectiveSpeed(unit, def) {
  if (!unit) return 0;
  const baseDef = def || unitTypes[unit.type] || {};
  const base = (baseDef.speed ?? unit.speed ?? 3);
  let mult = 1;
  if (unit.faction === myTeam) {
    mult *= (window.subCommander?.moveSpeedMult) ?? 1.0;
  }
  return base * mult;
}


// 팀별 건물 ID 증가/할당
function allocBuildingId(team) {
  if (team === "A") return buildingIdSeq.A++;
  if (team === "B") return buildingIdSeq.B++;
  return buildingIdSeq.N++;
}



// 내 진영이 소유한 건물 목록 반환
function myOwnedBuildings() {
  return playerbuildings.filter((b) => b.faction === myTeam);
}



// 특정 건물 보유 여부 확인
function hasBuilding(type, team = myTeam) {
  return myOwnedBuildings().some((b) => b.type === type);
}

// 건설 선행 조건 누락 목록 반환
function missingPrereqs(type, team = myTeam) {
  const reqs = BUILD_PREREQ[type] || [];
  return reqs.filter((r) => !hasBuilding(r, team));
}

// 건설 가능 여부(선행 조건 충족) 판정
function canBuildType(type, team = myTeam) {
  return missingPrereqs(type, team).length === 0;
}



// 유닛/건물 선택 및 관찰 상태 초기화
function clearSelectionAndInspection() {
  selectedBuildingId = null;
  isRallyPlacementMode = false;
  buildModeSelectedUnitIds = playerUnits.filter(u => u.selected && isWorker(u)).map(u => u.id);
  buildModeSelectedUnitIds = playerUnits.filter(u => u.selected && isWorker(u)).map(u => u.id);
  buildModeSelectedUnitIds = playerUnits.filter(u => u.selected && isWorker(u)).map(u => u.id);
  buildModeSelectedUnitIds = playerUnits.filter(u => u.selected && isWorker(u)).map(u => u.id);
  buildModeSelectedUnitIds = playerUnits.filter(u => u.selected && isWorker(u)).map(u => u.id);
  buildModeSelectedUnitIds = playerUnits.filter(u => u.selected && isWorker(u)).map(u => u.id);
  buildModeSelectedUnitIds = playerUnits.filter(u => u.selected && isWorker(u)).map(u => u.id);
  buildModeSelectedUnitIds = playerUnits.filter(u => u.selected && isWorker(u)).map(u => u.id);
  buildModeSelectedUnitIds = playerUnits.filter(u => u.selected && isWorker(u)).map(u => u.id);
  buildModeSelectedUnitIds = playerUnits.filter(u => u.selected && isWorker(u)).map(u => u.id);
  buildModeSelectedUnitIds = playerUnits.filter(u => u.selected && isWorker(u)).map(u => u.id);
  buildModeSelectedUnitIds = playerUnits.filter(u => u.selected && isWorker(u)).map(u => u.id);
  buildModeSelectedUnitIds = playerUnits.filter(u => u.selected && isWorker(u)).map(u => u.id);
  for (let u of playerUnits) u.selected = false;
  inspectedTarget = null;
}

// 화면 좌표로 자원 클릭 판정
function pickResourceAtScreen(mx, my) {
  if (!mapData) return null;
  const { tileWidth, tileHeight } = mapData;
  const centerX = viewW / 2;

  for (const r of (mapData.resources || [])) {
    if ((r.amount | 0) <= 0) continue;


    const sx = (r.x - r.y) * tileWidth / 2 - cameraX + centerX;
    const sy = (r.x + r.y) * tileHeight / 2 - cameraY;

    const img = resourceImages[String(r.id)];

    const targetWidth = tileWidth * 1;
    const aspect = (img && img.naturalWidth) ? (img.naturalHeight / img.naturalWidth) : 1;
    const targetHeight = targetWidth * aspect;
    const xOffsetTiles = 1;
    const drawX = sx - targetWidth / 2 + tileHeight * xOffsetTiles;
    const drawY = sy - targetHeight + tileHeight / 2;

    if (img && img.complete && img.naturalWidth > 0) {

      const inside = (mx >= drawX && mx <= drawX + targetWidth &&
        my >= drawY && my <= drawY + targetHeight);
      if (inside) return r;
    } else {

      const relX = mx - sx;
      const relY = my - sy;
      const insideDiamond = Math.abs(relX / (tileWidth / 2)) + Math.abs(relY / (tileHeight / 2)) <= 1;
      if (insideDiamond) return r;
    }
  }
  return null;
}



async function loadGameData() {
  const [unitRes, buildingRes] = await Promise.all([
    fetch("/data/units.json"),
    fetch("/data/buildings.json"),
  ]);
  const [units, buildings] = await Promise.all([
    unitRes.json(),
    buildingRes.json(),
  ]);

  units.forEach((u) => {
    unitTypes[u.type] = u;
    const img = new Image();
    img.src = u.image;
    unitImages[u.type] = img;
    if (u.attackimage) {
      const aimg = new Image();
      aimg.src = u.attackimage;
      unitAttackImages[u.type] = aimg;
    }
    if (u.walkingimage) {
      const wimg = new Image();
      wimg.src = u.walkingimage;
      unitWalkingImages[u.type] = wimg;
    }
    if (u.workingimage) {
      const work1 = new Image();
      work1.src = u.workingimage;
      unitWorkingImages[u.type] = work1;
    }
    if (u.workingimage2) {
      const work2 = new Image();
      work2.src = u.workingimage2;
      unitWorkingImages2[u.type] = work2;
    }
  });

  buildings.forEach((b) => {
    buildingTypes[b.type] = b;
    const img = new Image();
    img.src = b.image;
    buildingImages[b.type] = img;
  });
}
const CAMERA_PAD_RIGHT_TILES = 2;
const CAMERA_PAD_BOTTOM_TILES = 5;

// 현재 맵 기준 카메라 이동 한계 계산
function cameraBounds() {
  if (!mapData) return { minCamX: 0, maxCamX: 0, minCamY: 0, maxCamY: 0 };
  const { tileWidth, tileHeight, width: mw, height: mh } = mapData;

  const minCamX = -mh * (tileWidth / 2) + viewW / 2;
  const baseMaxCamX = mw * (tileWidth / 2) - viewW / 2;

  const minCamY = -tileHeight / 2;
  const bottomBase = (mw + mh - 2) * (tileHeight / 2);
  const baseMaxCamY = (bottomBase + tileHeight / 2) - viewH;


  const padRightPx = (tileWidth / 2) * CAMERA_PAD_RIGHT_TILES;
  const padBottomPx = (tileHeight / 2) * CAMERA_PAD_BOTTOM_TILES;

  return {
    minCamX,
    maxCamX: baseMaxCamX + padRightPx,
    minCamY,
    maxCamY: baseMaxCamY + padBottomPx,
  };
}




// 타일 ID에 대응하는 이미지 경로 반환
function imageSrcForTileId(id) {
  const file = TILE_ID_TO_FILE[id] || "grass.png";
  return `/tiles/${file}`;
}


// 맵 타일 이미지 캐시 초기화
function primeTileImagesOnce() {
  if (!mapData?.images || Object.keys(tileImages).length) return;
  for (const [key, src] of Object.entries(mapData.images)) {
    const img = new Image();
    img.src = src;
    tileImages[key] = img;
  }
}



// 팀에 따른 유닛 배열 참조 반환

function initFogState(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    fogState = null;
    return;
  }
  fogState = {
    width,
    height,
    visible: Array.from({ length: height }, () => new Uint8Array(width)),
    explored: Array.from({ length: height }, () => new Uint8Array(width)),
  };
}

function resetFogState(options = {}) {
  if (!fogState) return;
  const clearExplored = options.clearExplored ?? false;
  for (let y = 0; y < fogState.height; y++) {
    fogState.visible[y].fill(0);
    if (clearExplored) {
      fogState.explored[y].fill(0);
    }
  }
}

function ensureFogState() {
  if (!mapData) return;
  const w = mapData.width | 0;
  const h = mapData.height | 0;
  if (!fogState || fogState.width !== w || fogState.height !== h) {
    initFogState(w, h);
  }
}

function markTileVisible(tx, ty) {
  if (!fogState) return;
  if (ty < 0 || ty >= fogState.height || tx < 0 || tx >= fogState.width) return;
  fogState.visible[ty][tx] = 1;
  fogState.explored[ty][tx] = 1;
}

function revealCircle(cx, cy, radius) {
  if (!fogState) return;
  if (!Number.isFinite(radius) || radius <= 0) return;
  const minX = Math.max(0, Math.floor(cx - radius - 1));
  const maxX = Math.min(fogState.width - 1, Math.ceil(cx + radius + 1));
  const minY = Math.max(0, Math.floor(cy - radius - 1));
  const maxY = Math.min(fogState.height - 1, Math.ceil(cy + radius + 1));
  const rr = radius * radius;
  for (let y = minY; y <= maxY; y++) {
    const row = fogState.visible[y];
    const rowExplored = fogState.explored[y];
    for (let x = minX; x <= maxX; x++) {
      const dx = (x + 0.5) - cx;
      const dy = (y + 0.5) - cy;
      if (dx * dx + dy * dy <= rr) {
        row[x] = 1;
        rowExplored[x] = 1;
      }
    }
  }
}

function getUnitVisionRadius(unit) {
  const def = unitTypes[unit.type] || {};
  const raw = typeof def.vision === "number" ? def.vision : FOG_SETTINGS.defaultUnitVision;
  const adjusted = raw - (FOG_SETTINGS.extraFogTiles ?? 0);
  return Math.max(FOG_SETTINGS.minVision, adjusted);
}

function getBuildingVisionRadius(building) {
  const def = buildingTypes[building.type] || {};
  const raw = typeof def.vision === "number" ? def.vision : FOG_SETTINGS.defaultBuildingVision;
  const adjusted = raw - (FOG_SETTINGS.extraFogTiles ?? 0);
  return Math.max(FOG_SETTINGS.minVision, adjusted);
}

function updateFogVisibility() {
  if (!FOG_ENABLED) return;
  if (!mapData) return;
  ensureFogState();
  if (!fogState) return;

  for (let y = 0; y < fogState.height; y++) {
    fogState.visible[y].fill(0);
  }

  const revealAround = (cx, cy, radius) => {
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
    revealCircle(cx, cy, radius);
  };

  for (const b of playerbuildings) {
    if (!b || b.faction !== myTeam) continue;
    const bx = Math.floor(b.x);
    const by = Math.floor(b.y);
    const bw = Math.max(1, b.width || 1);
    const bh = Math.max(1, b.height || 1);
    for (let dy = 0; dy < bh; dy++) {
      for (let dx = 0; dx < bw; dx++) {
        markTileVisible(bx + dx, by + dy);
      }
    }
    revealAround(b.x + bw / 2, b.y + bh / 2, getBuildingVisionRadius(b));
  }

  for (const u of playerUnits) {
    if (!u || u.faction !== myTeam) continue;
    revealAround(u.x, u.y, getUnitVisionRadius(u));
  }
}

function isTileVisible(tx, ty) {
  if (!FOG_ENABLED || !fogState) return true;
  if (ty < 0 || ty >= fogState.height || tx < 0 || tx >= fogState.width) return false;
  return fogState.visible[ty][tx] === 1;
}

function isTileExplored(tx, ty) {
  if (!FOG_ENABLED || !fogState) return true;
  if (ty < 0 || ty >= fogState.height || tx < 0 || tx >= fogState.width) return false;
  return fogState.explored[ty][tx] === 1;
}

function isWorldPointVisible(wx, wy) {
  if (!FOG_ENABLED || !fogState) return true;
  if (!Number.isFinite(wx) || !Number.isFinite(wy)) return false;
  const fx = Math.floor(wx);
  const fy = Math.floor(wy);
  if (isTileVisible(fx, fy)) return true;
  const cx = Math.ceil(wx);
  const cy = Math.ceil(wy);
  if (isTileVisible(cx, fy)) return true;
  if (isTileVisible(fx, cy)) return true;
  if (isTileVisible(cx, cy)) return true;
  return false;
}

function isUnitVisibleToPlayer(unit) {
  if (!unit) return false;
  if (!FOG_ENABLED || !fogState) return true;
  if (unit.faction === myTeam) return true;
  return isWorldPointVisible(unit.x, unit.y);
}

function isBuildingVisibleToPlayer(building) {
  if (!building) return false;
  if (!FOG_ENABLED || !fogState) return true;
  if (building.faction === myTeam) return true;
  const bx = Math.floor(building.x);
  const by = Math.floor(building.y);
  const bw = Math.max(1, building.width || 1);
  const bh = Math.max(1, building.height || 1);
  for (let dy = 0; dy < bh; dy++) {
    for (let dx = 0; dx < bw; dx++) {
      if (isTileVisible(bx + dx, by + dy)) return true;
    }
  }
  return false;
}

function getArrayByTeam(team) {
  return team === myTeam ? playerUnits : enemyUnits;
}


// 유닛 객체 생성
function createUnit(type, x, y, team = myTeam) {
  const def = unitTypes[type];
  if (!def) return null;
  return {
    // Use monotonic allocator instead of array length to avoid id reuse
    id: allocUnitId(team),
    type,
    faction: team,
    x: x + 0.5,
    y: y + 0.5,
    maxHp: def.hp ?? 1,
    hp: def.hp ?? 1,
    atk: def.atk ?? 1,
    armor: def.armor ?? 0,
    range: def.range ?? 1.5,
    period: def.period ?? 1.0,
    _cd: 0,
    _attackAnim: 0,
    path: [],
    selected: false,
    order: null,
    _separating: false,
    _walkTimer: 0,
    _walkToggle: false,
    _workTimer: 0,
    _workToggle: false,
    _isWorking: false,
    _workingBuildingId: null,
    facing: 1,
  };
}


// 건물 객체 생성
function createBuilding(type, x, y, team = myTeam) {
  const def = buildingTypes[type];
  if (!def) return null;
  const id = allocBuildingId(team);
  return {
    id,
    type,
    faction: team,
    x: Math.floor(x),
    y: Math.floor(y),
    width: def.footprint?.w ?? 2,
    height: def.footprint?.h ?? 2,
    selected: false,
    maxHp: def.hp ?? 100,
    hp: def.hp ?? 100,
    // construction state
    constructing: true,
    requiresBuilder: true,
    buildTime: def.buildTime ?? 5,
    buildRemaining: def.buildTime ?? 5,
    // unit production queue state
    _prodQueue: [], // {type, remaining}
    _trainActive: false,
    // upgrade state
    upgrading: false,
    upgradeRemaining: 0,
    upgradeTarget: null,
    rallyPoint: null,
  };
}



// 스크린 좌표를 등각 월드 좌표로 변환
function screenToWorld(mx, my) {
  const centerX = viewW / 2;
  const { tileWidth, tileHeight } = mapData;
  const wx =
    ((mx - centerX + cameraX) / (tileWidth / 2) + (my + cameraY) / (tileHeight / 2)) /
    2;
  const wy =
    ((my + cameraY) / (tileHeight / 2) - (mx - centerX + cameraX) / (tileWidth / 2)) /
    2;
  return [wx, wy];
}


// 월드 좌표를 스크린 좌표로 변환
function clampWorldCoords(wx, wy) {
  if (!mapData) return [wx, wy];
  const maxX = Math.max(0, (mapData.width ?? 1) - 1);
  const maxY = Math.max(0, (mapData.height ?? 1) - 1);
  const minY = Math.min(-2, maxY);
  const clampedX = Math.max(0, Math.min(maxX, wx));
  const clampedY = Math.max(minY, Math.min(maxY, wy));
  return [clampedX, clampedY];
}

function worldToScreen(wx, wy) {
  const centerX = viewW / 2;
  const { tileWidth, tileHeight } = mapData;
  const sx = (wx - wy) * (tileWidth / 2) - cameraX + centerX;
  const sy = (wx + wy) * (tileHeight / 2) - cameraY;
  return [sx, sy];
}


const MINIMAP_ROT = Math.PI / 4;


// 카메라 좌표를 경계 내로 보정
function clampCamera() {
  if (!mapData) return;
  const { minCamX, maxCamX, minCamY, maxCamY } = cameraBounds();
  cameraX = Math.max(minCamX, Math.min(cameraX, maxCamX));
  cameraY = Math.max(minCamY, Math.min(cameraY, maxCamY));
}

// 특정 타일 중심으로 카메라 이동
function centerCameraOnTile(wx, wy) {
  if (!mapData) return;
  const { tileWidth, tileHeight } = mapData;
  cameraX = (wx - wy) * (tileWidth / 2);
  cameraY = (wx + wy) * (tileHeight / 2) - viewH / 2;
  clampCamera();
}



// 미니맵 회전 대비 스케일 계산
function miniScaleRot() {
  if (!mapData) return 1;
  const mw = mapData.width, mh = mapData.height;
  const c = Math.abs(Math.cos(MINIMAP_ROT));
  const s = Math.abs(Math.sin(MINIMAP_ROT));
  const paddedW = mw + MINIMAP_MARGIN_LEFT + MINIMAP_MARGIN_RIGHT;
  const paddedH = mh + MINIMAP_MARGIN_TOP + MINIMAP_MARGIN_BOTTOM;

  const sx = MINIMAP_CSS_W / (paddedW * c + paddedH * s);
  const sy = MINIMAP_CSS_H / (paddedW * s + paddedH * c);
  return Math.min(sx, sy);
}



// 미니맵 좌표를 월드 좌표로 변환
function miniToWorldRot(mx, my) {
  if (!mapData) return [0, 0];
  const s = miniScaleRot();
  const cx = MINIMAP_CSS_W / 2;
  const cy = MINIMAP_CSS_H / 2;
  const lx = mx - cx;
  const ly = my - cy;

  const cos = Math.cos(MINIMAP_ROT), sin = Math.sin(MINIMAP_ROT);
  const ux = lx * cos + ly * sin;
  const uy = -lx * sin + ly * cos;
  const paddedW = mapData.width + MINIMAP_MARGIN_LEFT + MINIMAP_MARGIN_RIGHT;
  const paddedH = mapData.height + MINIMAP_MARGIN_TOP + MINIMAP_MARGIN_BOTTOM;

  const wx = (ux + (paddedW * s) / 2) / s - MINIMAP_MARGIN_LEFT;
  const wy = (uy + (paddedH * s) / 2) / s - MINIMAP_MARGIN_TOP;
  return [wx, wy];
}





// 타일/유닛/건물 기반 충돌 맵 생성
function createCollisionMap() {
  if (!mapData) return [];
  const w = mapData.width;
  const h = mapData.height;
  const collisionMap = Array(h)
    .fill(null)
    .map(() => Array(w).fill(0));

  // Mark hard-block tiles directly on their actual cell
  for (let y = 1; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tid = mapData.tiles[y][x];
      if (BLOCK_TILE_IDS.has(tid)) {
        collisionMap[y - 1][x] = 1;
      }
    }
  }

  // Mark 5xx obstacles as blocked (treated like solid decor)
  for (const o of (mapData.obstacles || [])) {
    const rx = Math.floor(o.x), ry = Math.floor(o.y);
    if (rx >= 0 && rx < w && ry >= 1 && ry < h) collisionMap[ry - 1][rx] = 1;
  }

  for (let b of enemybuildings) {
    for (let dy = 0; dy < b.height; dy++) {
      for (let dx = 0; dx < b.width; dx++) {
        const x = Math.floor(b.x) + dx;
        const y = Math.floor(b.y) + dy;
        if (x >= 0 && x < w && y >= 0 && y < h) collisionMap[y][x] = 1;
      }
    }
  }
  for (let b of playerbuildings) {
    for (let dy = 0; dy < b.height; dy++) {
      for (let dx = 0; dx < b.width; dx++) {
        const x = Math.floor(b.x) + dx;
        const y = Math.floor(b.y) + dy;
        if (x >= 0 && x < w && y >= 0 && y < h) collisionMap[y][x] = 1;
      }
    }
  }
  // Reserve bottom row as non-walkable buffer
  for (let x = 0; x < w; x++) {
    if (h > 0) collisionMap[h - 1][x] = 1;
  }

  for (let u of enemyUnits) {
    const x = Math.floor(u.x);
    const y = Math.floor(u.y);
    if (x >= 0 && x < w && y >= 0 && y < h) collisionMap[y][x] = 1;
  }
  // Treat resource tiles with amount > 0 as blocked (offset -1 to align grid)
  for (const r of (mapData.resources || [])) {
    if ((r.amount | 0) <= 0) continue;
    const rx = Math.floor(r.x);
    const ry = Math.floor(r.y);
    if (rx >= 0 && rx < w && ry >= 1 && ry < h) {
      collisionMap[ry - 1][rx] = 1;
    }
  }
  return collisionMap;
}



// 건물 배치 가능 위치인지 확인
function canPlaceBuilding(x, y, wFoot = 2, hFoot = 2, options = {}) {
  if (!mapData) return false;
  const { allowResourceOverlap = false } = options ?? {};
  const w = mapData.width;
  const h = mapData.height;
  const bx = Math.floor(x);
  const by = Math.floor(y);

  // Simple bounds consistent with collision map grid
  if (bx < 0 || by < 0 || bx + wFoot > w || by + hFoot > h) return false;

  if (FOG_ENABLED && fogState) {
    for (let dy = 0; dy < hFoot; dy++) {
      for (let dx = 0; dx < wFoot; dx++) {
        const cx = bx + dx;
        const cy = by + dy;
        if (!isTileVisible(cx, cy)) return false;
      }
    }
  }

  if (!allowResourceOverlap && Array.isArray(mapData?.resources)) {
    const hasBlockingResource = mapData.resources.some((r) => {
      if ((r.amount | 0) <= 0) return false;
      const rx = Math.floor(r.x);
      const ry = Math.floor(r.y) - 1;
      return rx >= bx && rx < bx + wFoot && ry >= by && ry < by + hFoot;
    });
    if (hasBlockingResource) return false;
  }

  // Use collision map for terrain/buildings/enemy units/resources
  const cMap = createCollisionMap();
  let resourceOverlapKeys = null;
  if (allowResourceOverlap && Array.isArray(mapData?.resources)) {
    resourceOverlapKeys = new Set();
    for (const r of mapData.resources) {
      if ((r.amount | 0) <= 0) continue;
      const rx = Math.floor(r.x);
      const ry = Math.floor(r.y) - 1;
      if (rx >= 0 && rx < w && ry >= 0 && ry < h) {
        resourceOverlapKeys.add(`${rx},${ry}`);
      }
    }
  }
  for (let dy = 0; dy < hFoot; dy++) {
    for (let dx = 0; dx < wFoot; dx++) {
      const cx = bx + dx;
      const cy = by + dy;
      if (cMap?.[cy]?.[cx] === 1) {
        if (resourceOverlapKeys?.has(`${cx},${cy}`)) continue;
        return false;
      }
    }
  }
  // Additionally avoid placing over any unit (both sides), since playerUnits are not in cMap
  for (const u of [...playerUnits, ...enemyUnits]) {
    const ux = Math.floor(u.x), uy = Math.floor(u.y);
    if (ux >= bx && ux < bx + wFoot && uy >= by && uy < by + hFoot) return false;
  }
  return true;
}
function canPlaceExtractorAt(type, x, y) {
  const bx = Math.floor(x);
  const by = Math.floor(y) + 1; // resource offset convention
  if (!canPlaceBuilding(bx, by - 1, 1, 1, { allowResourceOverlap: true })) return false;
  if (!ALL_MINE_TYPES.has(type)) return false;
  const res = findResourceAtTile(bx, by);
  if (!res) return false;
  const allow = RESOURCE_TO_MINES[res.id] || [];
  if (!allow.includes(type)) return false;
  // Require proximity to a finished Nexus owned by the player
  try {
    const nearAnyNexus = myOwnedBuildings()
      .filter(b => b.type === "nexus" && !b.constructing)
      .some(nex => distPointToBuilding(bx, by - 1, nex) <= NEXUS_MINE_RANGE);
    if (!nearAnyNexus) return false;
  } catch (_) { }
  // prevent duplicate extractor for same resource tile
  const exists = playerbuildings.some((b) =>
    ALL_MINE_TYPES.has(b.type) &&
    ((b._resX != null && b._resY != null)
      ? (b._resX === bx && b._resY === by)
      : (Math.floor(b.x) === bx && Math.floor(b.y) + 1 === by))
  );
  return !exists;
}

function canPlaceMineAt(x, y) {
  const bx = Math.floor(x), by = Math.floor(y) + 1; // ← 규약 유지
  if (!canPlaceBuilding(bx, by - 1, 1, 1, { allowResourceOverlap: true })) return false;
  // ↑ mine이 실제로 서는 건 (bx, by-1)이므로 충돌 체크는 거기서

  const res = findResourceAtTile(bx, by);
  if (!res) return false;

  // 이미 같은 자원 타일에 바인딩된 mine이 있는지 검사
  const exists = playerbuildings.some(b =>
    b.type === "mine" &&
    ((b._resX != null && b._resY != null)
      ? (b._resX === bx && b._resY === by)
      : (Math.floor(b.x) === bx && Math.floor(b.y) + 1 === by)) // fallback
  );
  return !exists;
}



// 목표 경계에서 도달 가능한 최단 타일 탐색
function nearestReachableAround(targetX, targetY, footprintW, footprintH, map, fromX, fromY) {
  const tiles = [];
  for (let dy = -1; dy <= footprintH; dy++) {
    for (let dx = -1; dx <= footprintW; dx++) {
      const onBorder = dy === -1 || dy === footprintH || dx === -1 || dx === footprintW;
      if (!onBorder) continue;
      const cx = Math.floor(targetX) + dx;
      const cy = Math.floor(targetY) + dy;
      if (cy >= 0 && cy < map.length && cx >= 0 && cx < map[0].length && map[cy][cx] === 0) {
        tiles.push([cx, cy]);
      }
    }
  }
  tiles.sort(
    (a, b) => Math.hypot(fromX - a[0], fromY - a[1]) - Math.hypot(fromX - b[0], fromY - b[1])
  );
  return tiles[0] || [Math.floor(targetX), Math.floor(targetY)];
}



// A* 경로 탐색
function findPath(startX, startY, goalX, goalY, map) {
  const w = map[0].length;
  const h = map.length;
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
  const heuristic = (x1, y1, x2, y2) => Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));

  const neighbors = [
    { dx: 1, dy: 0, cost: 1 },
    { dx: -1, dy: 0, cost: 1 },
    { dx: 0, dy: 1, cost: 1 },
    { dx: 0, dy: -1, cost: 1 },
    { dx: 1, dy: 1, cost: Math.SQRT2 },
    { dx: 1, dy: -1, cost: Math.SQRT2 },
    { dx: -1, dy: 1, cost: Math.SQRT2 },
    { dx: -1, dy: -1, cost: Math.SQRT2 },
  ];

  const cameFrom = Array(h).fill(null).map(() => Array(w).fill(null));
  const gScore = Array(h).fill(null).map(() => Array(w).fill(Infinity));
  const fScore = Array(h).fill(null).map(() => Array(w).fill(Infinity));

  const openSet = [];
  gScore[startY][startX] = 0;
  fScore[startY][startX] = heuristic(startX, startY, goalX, goalY);
  openSet.push({ x: startX, y: startY, f: fScore[startY][startX] });

  let closestNode = { x: startX, y: startY };
  let closestDist = heuristic(startX, startY, goalX, goalY);
  let iteration = 0;
  const maxIterations = 10000;

  while (openSet.length > 0 && iteration < maxIterations) {
    iteration++;
    openSet.sort((a, b) => a.f - b.f);
    const current = openSet.shift();

    if (current.x === goalX && current.y === goalY) {
      return reconstructPath(cameFrom, current.x, current.y);
    }

    const distToGoal = heuristic(current.x, current.y, goalX, goalY);
    if (distToGoal < closestDist) {
      closestDist = distToGoal;
      closestNode = { x: current.x, y: current.y };
    }

    for (let { dx, dy, cost } of neighbors) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (!inBounds(nx, ny) || map[ny][nx] === 1) continue;
      if (dx !== 0 && dy !== 0) {
        if (map[current.y][nx] === 1 || map[ny][current.x] === 1) continue;
      }
      const tentativeG = gScore[current.y][current.x] + cost;
      if (tentativeG < gScore[ny][nx]) {
        cameFrom[ny][nx] = { x: current.x, y: current.y };
        gScore[ny][nx] = tentativeG;
        fScore[ny][nx] = tentativeG + heuristic(nx, ny, goalX, goalY);
        if (!openSet.some((n) => n.x === nx && n.y === ny)) {
          openSet.push({ x: nx, y: ny, f: fScore[ny][nx] });
        }
      }
    }
  }
  return reconstructPath(cameFrom, closestNode.x, closestNode.y);
}


// A* 탐색 결과 경로 재구성
function reconstructPath(cameFrom, x, y) {
  const path = [];
  while (cameFrom[y][x] !== null) {
    path.unshift([x, y]);
    const prev = cameFrom[y][x];
    x = prev.x;
    y = prev.y;
  }
  return path;
}



// 화면 클릭으로 유닛 선택
function pickUnitAtScreen(mx, my, teamFilter = "any") {
  if (!mapData) return null;
  const all = [...playerUnits, ...enemyUnits];
  const R = 28;

  let best = null, bestD = 1e9;
  for (const u of all) {
    const isMine = u.faction === myTeam;
    if (teamFilter === "mine" && !isMine) continue;
    if (teamFilter === "enemy" && isMine) continue;

    const [sx, sy] = worldToScreen(u.x, u.y);
    const d = Math.hypot(mx - sx, my - sy);
    if (d <= R && d < bestD) {
      best = { kind: "unit", data: u };
      bestD = d;
    }
  }
  return best;
}


// 화면 클릭으로 건물 선택
function pickBuildingAtScreen(mx, my, teamFilter = "any") {
  if (!mapData) return null;
  const sets = [...playerbuildings, ...enemybuildings];
  const { tileWidth, tileHeight } = mapData;
  const centerX = viewW / 2;

  for (const b of sets) {
    const isMine = b.faction === myTeam;
    if (teamFilter === "mine" && !isMine) continue;
    if (teamFilter === "enemy" && isMine) continue;

    const tx = Math.floor(b.x), ty = Math.floor(b.y);
    const w = b.width || 2, h = b.height || 2;
    let insideAny = false;

    for (let dy = 0; dy < h && !insideAny; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const tileX = tx + dx, tileY = ty + dy;
        const sx = (tileX - tileY) * tileWidth / 2 - cameraX + centerX;
        const sy = (tileX + tileY) * tileHeight / 2 - cameraY;
        const relX = mx - sx, relY = my - sy;
        const inside =
          Math.abs(relX / (tileWidth / 2)) + Math.abs(relY / (tileHeight / 2)) <= 1;
        if (inside) { insideAny = true; break; }
      }
    }
    if (insideAny) return { kind: "building", data: b };
  }
  return null;
}



// 드래그 박스로 유닛 다중 선택
function selectUnitsInBox(start, end, opts = {}) {
  if (!start || !end || !mapData) return;
  const { tileWidth, tileHeight } = mapData;
  const centerX = viewW / 2;
  const extend = opts.extend === true;

  if (!extend) {
    for (let u of playerUnits) u.selected = false;
  }

  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);

  for (let u of playerUnits) {
    const screenX = (u.x - u.y) * tileWidth / 2 - cameraX + centerX;
    const screenY = (u.x + u.y) * tileHeight / 2 - cameraY;

    if (screenX >= minX && screenX <= maxX && screenY >= minY && screenY <= maxY) {
      u.selected = true;
    }
  }
}



// 게임 캔버스 크기와 컨텍스트 설정
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  viewW = window.innerWidth;
  viewH = window.innerHeight;
  canvas.style.width = viewW + "px";
  canvas.style.height = viewH + "px";
  canvas.width = Math.floor(viewW * dpr);
  canvas.height = Math.floor(viewH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
}

// 마우스 가장자리 기반 카메라 스크롤
function scrollCamera() {
  const edgeSize = 30;
  const speed = 20;

  if (edgeMouseX < edgeSize) cameraX -= speed;
  if (edgeMouseX > viewW - edgeSize) cameraX += speed;
  if (edgeMouseY < edgeSize) cameraY -= speed;
  if (edgeMouseY > viewH - edgeSize) cameraY += speed;


  const { minCamX, maxCamX, minCamY, maxCamY } = cameraBounds();
  cameraX = Math.max(minCamX, Math.min(cameraX, maxCamX));
  cameraY = Math.max(minCamY, Math.min(cameraY, maxCamY));
}



// 등각 타일 다이아몬드 렌더링
function drawDiamondTile(x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y + h / 2);
  ctx.lineTo(x + w / 2, y);
  ctx.lineTo(x + w, y + h / 2);
  ctx.lineTo(x + w / 2, y + h);
  ctx.closePath();
  ctx.fill();
}


// 등각 맵 타일 전체 그리기
function drawIsoMap() {
  if (!mapData) return;
  if (FOG_ENABLED) fogOverlays.length = 0;
  primeTileImagesOnce();

  const { tileWidth, tileHeight, tiles, tileset } = mapData;
  const pushFogOverlay = (tileX, tileY, color) => {
    const screenX = snap((tileX - tileY) * tileWidth / 2 - cameraX + viewW / 2);
    const screenY = snap((tileX + tileY) * tileHeight / 2 - cameraY);
    const fogWidth = tileWidth * 2;
    const fogHeight = tileHeight * 2;
    const fogX = screenX - (fogWidth - tileWidth) / 2;
    const fogY = screenY - (fogHeight - tileHeight) / 2;
    fogOverlays.push({ x: fogX, y: fogY, w: fogWidth, h: fogHeight, color });
  };

  for (let y = 0; y < tiles.length; y++) {
    const row = tiles[y];
    if (!Array.isArray(row)) continue;

    for (let x = 0; x < row.length; x++) {
      const tile = row[x];
      if (tile === undefined) continue;

      const color = tileset[tile.toString()] || "#000";
      const screenX = snap((x - y) * tileWidth / 2 - cameraX + viewW / 2);
      const screenY = snap((x + y) * tileHeight / 2 - cameraY);

      const img = tileImages[tile.toString()];
      if (img?.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, screenX - 1, screenY - tileHeight / 2 - 1, tileWidth + 2, tileHeight + 2);
      } else {
        drawDiamondTile(screenX, screenY, tileWidth, tileHeight, color);
      }

      if (FOG_ENABLED && fogState && !isTileVisible(x, y)) {
        const fogColor = isTileExplored(x, y) ? FOG_SETTINGS.exploredColor : FOG_SETTINGS.hiddenColor;
        pushFogOverlay(x, y, fogColor);
      }
    }
  }

  if (FOG_ENABLED && fogState) {
    const mapWidth = mapData.width | 0;
    const mapHeight = mapData.height | 0;
    const edgeColorFor = (tileX, tileY) => (
      isTileExplored(tileX, tileY) ? FOG_SETTINGS.exploredColor : FOG_SETTINGS.hiddenColor
    );

    for (let y = 0; y < mapHeight; y++) {
      if (!isTileVisible(0, y)) {
        pushFogOverlay(-1, y, edgeColorFor(0, y));
      }
    }

    for (let x = 0; x < mapWidth; x++) {
      if (!isTileVisible(x, 0)) {
        pushFogOverlay(x, -1, edgeColorFor(x, 0));
      }
    }

    if (!isTileVisible(0, 0)) {
      pushFogOverlay(-1, -1, edgeColorFor(0, 0));
    }
  }
}
// 자원 아이콘 등각 렌더링
function drawIsoResource(r) {
  const { tileWidth, tileHeight } = mapData;
  const img = resourceImages[String(r.id)];
  const [sx, sy] = worldToScreen(r.x, r.y);

  const targetWidth = tileWidth * 1;
  const aspect = (img && img.naturalWidth) ? img.naturalHeight / img.naturalWidth : 1;
  const targetHeight = targetWidth * aspect;
  const xOffsetTiles = 1;

  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(
      img,
      sx - targetWidth / 2 + tileHeight * xOffsetTiles,
      sy - targetHeight + tileHeight / 2,
      targetWidth,
      targetHeight
    );
  } else {

    drawDiamondTile(sx - tileWidth * 0.5, sy, tileWidth, tileHeight, "#d97706");
  }
}

// Draw obstacle sprite (same style as resources)
function drawIsoObstacle(o) {
  const { tileWidth, tileHeight } = mapData;
  const img = obstacleImages[String(o.id)];
  const [sx, sy] = worldToScreen(o.x, o.y);

  const targetWidth = tileWidth * 1;
  const aspect = (img && img.naturalWidth) ? img.naturalHeight / img.naturalWidth : 1;
  const targetHeight = targetWidth * aspect;
  const xOffsetTiles = 1;

  if (img && img.complete && img.naturalWidth > 0) {
    ctx.drawImage(
      img,
      sx - targetWidth / 2 + tileHeight * xOffsetTiles,
      sy - targetHeight + tileHeight / 2,
      targetWidth,
      targetHeight
    );
  } else {
    drawDiamondTile(sx - tileWidth * 0.5, sy, tileWidth, tileHeight, "#14532d");
  }
}



// 유닛 스프라이트 및 선택표시 렌더링
function drawIsoUnit(unit) {
  const { tileWidth, tileHeight } = mapData;
  const [screenX, screenY] = [snap((unit.x - unit.y) * tileWidth / 2 - cameraX + viewW / 2),
  snap((unit.x + unit.y) * tileHeight / 2 - cameraY)];

  const def = unitTypes[unit.type] || {};

  const hasAttack = !!unitAttackImages[unit.type];
  const hasWalk = !!unitWalkingImages[unit.type];
  const hasWork1 = !!unitWorkingImages[unit.type];
  const hasWork2 = !!unitWorkingImages2[unit.type];

  const useAttackImage = !unit._isWorking && unit._attackAnim > 0 &&
    hasAttack &&
    unitAttackImages[unit.type].complete &&
    unitAttackImages[unit.type].naturalWidth > 0;


  const isMoving = unit.path && unit.path.length > 0;
  const useWalkingImage = !useAttackImage && !unit._isWorking &&
    isMoving &&
    hasWalk &&
    unit._walkToggle &&
    unitWalkingImages[unit.type].complete &&
    unitWalkingImages[unit.type].naturalWidth > 0;
  const useWorking = unit._isWorking && (hasWork1 || hasWork2);
  let img;
  if (useWorking) {
    if (unit._workToggle && hasWork2 && unitWorkingImages2[unit.type].complete && unitWorkingImages2[unit.type].naturalWidth > 0) {
      img = unitWorkingImages2[unit.type];
    } else if (hasWork1 && unitWorkingImages[unit.type].complete && unitWorkingImages[unit.type].naturalWidth > 0) {
      img = unitWorkingImages[unit.type];
    } else if (hasWork2) {
      img = unitWorkingImages2[unit.type];
    } else {
      img = unitImages[unit.type];
    }
  } else if (useAttackImage) {
    img = unitAttackImages[unit.type];
  } else if (useWalkingImage) {
    img = unitWalkingImages[unit.type];
  } else {
    img = unitImages[unit.type];
  }

  const footY = screenY + tileHeight * 0.5;

  if (unit.selected) {
    const maxHp = unit.maxHp || 1;
    const curHp = Math.max(0, unit.hp ?? maxHp);
    const ratio = Math.max(0, Math.min(1, curHp / maxHp));
    const squash = Math.max(0.35, Math.min(0.9, tileHeight / tileWidth));
    const rX = tileWidth * 0.15;
    const rY = rX * squash;
    const thick = Math.max(2, tileWidth * 0.02);
    let hpColor = "lime";
    if (ratio <= 0.25) hpColor = "#e53935";
    else if (ratio <= 0.5) hpColor = "#fdd835";
    ctx.save();
    ctx.lineWidth = thick;
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(screenX, footY - 10, rX, rY, 0, 0, Math.PI * 2);
    ctx.stroke();
    const startA = -Math.PI / 2;
    const endA = startA + Math.PI * 2 * ratio;
    ctx.strokeStyle = hpColor;
    ctx.beginPath();
    ctx.ellipse(screenX, footY - 10, rX, rY, 0, startA, endA);
    ctx.stroke();
    ctx.restore();
  }
  if (!img || !img.complete || img.naturalWidth === 0) {
    ctx.fillStyle = unit.faction === enemyTeam ? "red" : "blue";
    ctx.beginPath();
    ctx.arc(screenX, screenY, def.radiusPx ?? 10, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const targetW = tileWidth * (def.selectionBox?.w ?? 0.8);
    const aspect = img.naturalHeight / img.naturalWidth;
    const targetH = targetW * aspect;
    const drawY = snap(screenY - targetH + tileHeight * 0.5);

    if (unit.facing === -1) {
      ctx.save();

      ctx.translate(snap(screenX), 0);
      ctx.scale(-1, 1);

      ctx.drawImage(
        img,
        snap(-targetW / 2),
        drawY,
        targetW,
        targetH
      );
      ctx.restore();
    } else {
      ctx.drawImage(
        img,
        snap(screenX - targetW / 2),
        drawY,
        targetW,
        targetH
      );
    }

  }
}



// 선택된 내 유닛 목록 반환
function getSelectedUnits() {
  return playerUnits.filter((u) => u.selected);
}

// 선택된 내 건물 반환
function getSelectedBuilding() {
  if (selectedBuildingId == null) return null;
  const b = playerbuildings.find((b) => b.id === selectedBuildingId && b.faction === myTeam) || null;
  if (b) ensureBuildingRallyPointField(b);
  return b;
}


// 건물 정보 패널 갱신
function renderBuildingPanel() {
  if (inspectedTarget) { bp.panel.classList.add("hidden"); return; }
  const b = getSelectedBuilding();
  if (!b) { bp.panel.classList.add("hidden"); return; }

  const def = buildingTypes[b.type] || {};
  const img = buildingImages[b.type];
  bp.icon.src = (img && img.src) ? img.src : "";
  bp.title.textContent = def.displayName || b.type || "건물";
  bp.panel.classList.remove("hidden");
  // Cancel construction button
  if (cancelBuildBtn) {
    if (b.constructing) {
      const c = getBuildingCost(b.type);
      cancelBuildBtn.classList.remove("hidden");
      cancelBuildBtn.style.display = "inline-block";
      cancelBuildBtn.textContent = `Cancel Build (refund ${formatCost(c)})`;
      cancelBuildBtn.onclick = () => cancelConstruction(b);
    } else {
      cancelBuildBtn.classList.add("hidden");
      cancelBuildBtn.style.display = "none";
      cancelBuildBtn.onclick = null;
    }
  }

  // Queue UI
  if (bp.queueWrap && bp.queueList) {
    const q = Array.isArray(b._prodQueue) ? b._prodQueue : [];
    if (q.length > 0) {
      bp.queueWrap.classList.remove("hidden");
      bp.queueWrap.style.display = "flex";
      // rebuild queue list
      while (bp.queueList.firstChild) bp.queueList.removeChild(bp.queueList.firstChild);
      q.forEach((item, idx) => {
        const el = document.createElement("div");
        el.style.display = "flex";
        el.style.alignItems = "center";
        el.style.gap = "4px";
        el.style.padding = "2px 6px";
        el.style.borderRadius = "6px";
        el.style.background = "rgba(255,255,255,0.08)";
        const time = Math.ceil(Math.max(0, item.remaining || 0));
        const label = document.createElement("span");
        label.style.fontSize = "12px";
        label.textContent = `${item.type} (${time}s)`;
        const btn = document.createElement("button");
        btn.textContent = "✕";
        btn.style.border = "0";
        btn.style.borderRadius = "6px";
        btn.style.padding = "2px 6px";
        btn.style.cursor = "pointer";
        btn.style.background = "#ef4444";
        btn.style.color = "#fff";
        btn.onclick = () => cancelQueueItem(b, idx);
        el.appendChild(label);
        el.appendChild(btn);
        bp.queueList.appendChild(el);
      });
    } else {
      bp.queueWrap.classList.add("hidden");
      bp.queueWrap.style.display = "none";
      while (bp.queueList.firstChild) bp.queueList.removeChild(bp.queueList.firstChild);
    }
  }

  configureProductionButtons(b.type);
}


// 유닛/빌딩/자원 정보 패널 갱신
function renderUnitPanel() {
  const selected = getSelectedUnits();
  const selBuilding = getSelectedBuilding();


  if (inspectedTarget && inspectedTarget.kind === "unit") {
    const unit = inspectedTarget.data;
    const def = unitTypes[unit.type] || {};
    const img = unitImages[unit.type];

    ui.panel.classList.remove("hidden");
    bp.panel.classList.add("hidden");
    build.panel.classList.add("hidden");
    ui.multiWrap.classList.add("hidden");

    ui.icon.src = (img && img.src) ? img.src : "";
    const displayName = def.displayName || unit.type;
    ui.name.textContent = displayName;
    ui.type.textContent = ownerDisplayName(unit.faction);

    const maxHp = unit.maxHp || 1;
    const curHp = Math.max(0, unit.hp ?? maxHp);
    const ratio = Math.max(0, Math.min(1, curHp / maxHp));
    ui.hpFill.style.width = `${Math.round(ratio * 100)}%`;
    ui.hpText.textContent = `${Math.max(0, Math.ceil(curHp))} / ${maxHp}`;

    ui.atk.textContent = def.atk ?? unit.atk ?? "—";
    ui.armor.textContent = def.armor ?? unit.armor ?? "—";
    ui.range.textContent = ((def.range ?? unit.range) ?? 0).toFixed(1);
    ui.period.textContent = (((def.period ?? unit.period) ?? 0).toFixed(2)) + "s";
    ui.speed.textContent = getUnitEffectiveSpeed(unit, def).toFixed(2);
    return;
  }

  if (inspectedTarget && inspectedTarget.kind === "building") {
    const b = inspectedTarget.data;
    const bdef = buildingTypes[b.type] || {};
    const bimg = buildingImages[b.type];
    const rel = relationOf(b.faction);
    const relLabel = rel === "enemy" ? "적" : (rel === "ally" ? "아군" : "중립");

    ui.panel.classList.remove("hidden");
    bp.panel.classList.add("hidden");
    build.panel.classList.add("hidden");
    ui.multiWrap.classList.add("hidden");

    ui.icon.src = (bimg && bimg.src) ? bimg.src : "";
    const buildingTitle = bdef.displayName || b.type || "건물";
    ui.name.textContent = buildingTitle;
    ui.type.textContent = `${ownerDisplayName(b.faction)} (${relLabel} 건물)`;

    if (b.maxHp) {
      const ratio = Math.max(0, Math.min(1, (b.hp ?? b.maxHp) / b.maxHp));
      ui.hpFill.style.width = `${Math.round(ratio * 100)}%`;
      ui.hpText.textContent = `${Math.max(0, Math.ceil(b.hp ?? b.maxHp))} / ${b.maxHp}`;
    } else {
      ui.hpFill.style.width = "0%";
      ui.hpText.textContent = "—";
    }

    ui.atk.textContent = bdef.atk ?? "—";
    ui.armor.textContent = bdef.armor ?? "—";
    ui.range.textContent = (bdef.range ?? 0).toFixed ? (bdef.range ?? 0).toFixed(1) : "—";
    ui.period.textContent = (typeof bdef.period === "number") ? (bdef.period.toFixed(2) + "s") : "—";
    const w = b.width ?? (bdef.footprint?.w ?? 1);
    const h = b.height ?? (bdef.footprint?.h ?? 1);
    ui.speed.textContent = `크기 ${w}×${h}`;
    return;
  }

  if (inspectedTarget && inspectedTarget.kind === "resource") {
    const r = inspectedTarget.data;
    const img = resourceImages[String(r.id)];

    ui.panel.classList.remove("hidden");
    bp.panel.classList.add("hidden");
    build.panel.classList.add("hidden");
    ui.multiWrap.classList.add("hidden");

    const resName = resourceNameById(r.id);
    ui.icon.src = (img && img.src) ? img.src : "";
    ui.name.textContent = resName;
    ui.type.textContent = "자원";
    ui.hpFill.style.width = "0%";
    ui.hpText.textContent = `현재 매장량: ${r.amount | 0}`;
    ui.atk.textContent = "—";
    ui.armor.textContent = "—";
    ui.range.textContent = "—";
    ui.period.textContent = "—";
    ui.speed.textContent = `좌표 ${r.y}, ${r.x}`;
    return;
  }


  if (selected.length === 0 && !selBuilding) {
    ui.panel.classList.add("hidden");
    ui.multiCount.textContent = "1";
    bp.panel.classList.add("hidden");
    build.panel.classList.add("hidden");
    return;
  }

  ui.panel.classList.remove("hidden");


  if (selBuilding) {
    ui.multiWrap.classList.add("hidden");

    const bdef = buildingTypes[selBuilding.type] || {};
    const bimg = buildingImages[selBuilding.type];

    ui.icon.src = (bimg && bimg.src) ? bimg.src : "";
    const buildingName = bdef.displayName || selBuilding.type;
    ui.name.textContent = buildingName;
    ui.type.textContent = `${ownerDisplayName(selBuilding.faction)} (건물)`;

    const maxHp = selBuilding.maxHp ?? (bdef.hp ?? 100);
    const curHp = Math.max(0, selBuilding.hp ?? maxHp);
    const ratio = Math.max(0, Math.min(1, curHp / maxHp));
    ui.hpFill.style.width = `${Math.round(ratio * 100)}%`;
    ui.hpText.textContent = `${Math.ceil(curHp)} / ${maxHp}`;
    ui.atk.textContent = bdef.atk ?? "—";
    ui.armor.textContent = bdef.armor ?? "—";
    ui.range.textContent = bdef.range ? bdef.range.toFixed(1) : "—";
    ui.period.textContent = bdef.period ? (bdef.period.toFixed(2) + "s") : "—";
    const w = selBuilding.width ?? (bdef.footprint?.w ?? 1);
    const h = selBuilding.height ?? (bdef.footprint?.h ?? 1);
    ui.speed.textContent = `크기 ${w}×${h}`;
    return;
  }


  if (selected.length > 1) {
    ui.multiWrap.classList.remove("hidden");
    ui.multiCount.textContent = String(selected.length);
    ui.icon.src = "";
    ui.name.textContent = "다중 선택";
    ui.type.textContent = "선택된 유닛";
    ui.hpFill.style.width = "0%";
    ui.hpText.textContent = "—";
    ui.atk.textContent = "—";
    ui.armor.textContent = "—";
    ui.range.textContent = "—";
    ui.period.textContent = "—";
    ui.speed.textContent = "—";
    build.panel.classList.add("hidden");
    return;
  }


  ui.multiWrap.classList.add("hidden");
  const unit = selected[0];
  const def = unitTypes[unit.type] || {};
  const img = unitImages[unit.type];

  ui.icon.src = (img && img.src) ? img.src : "";
  const displayName = def.displayName || unit.type;
  ui.name.textContent = displayName;
  ui.type.textContent = ownerDisplayName(unit.faction);
  const hpRatio = Math.max(0, Math.min(1, unit.hp / (unit.maxHp || 1)));
  ui.hpFill.style.width = `${Math.round(hpRatio * 100)}%`;
  ui.hpText.textContent = `${Math.max(0, Math.ceil(unit.hp))} / ${unit.maxHp}`;
  ui.atk.textContent = def.atk ?? unit.atk ?? 0;
  ui.armor.textContent = def.armor ?? unit.armor ?? 0;
  ui.range.textContent = (def.range ?? unit.range ?? 0).toFixed(1);
  ui.period.textContent = (def.period ?? unit.period ?? 0).toFixed(2) + "s";
  ui.speed.textContent = getUnitEffectiveSpeed(unit, def).toFixed(2);
  // ensure building panel is hidden while unit is selected
  bp.panel.classList.add("hidden");

  if (unit.type === "limestone") {

    build.panel.classList.remove("hidden");
    if (!wasBuildPanelVisible) setBuildMenuPage("root");
    wasBuildPanelVisible = true;
  } else {
    build.panel.classList.add("hidden");
    wasBuildPanelVisible = false;
  }

  if (selected.length === 0 && !selBuilding) {
    ui.panel.classList.add("hidden");
    ui.multiWrap.classList.add("hidden");
    wasBuildPanelVisible = false;
    build.panel.classList.add("hidden");
    return;
  }

}

// 미니맵 화면 전체 갱신
function renderMinimap() {
  if (!mapData) return;

  const { width: mw, height: mh, tiles } = mapData;
  const s = miniScaleRot();
  const halfW = MINIMAP_CSS_W / 2;
  const halfH = MINIMAP_CSS_H / 2;
  const fogActive = FOG_ENABLED && fogState;

  mctx.clearRect(0, 0, MINIMAP_CSS_W, MINIMAP_CSS_H);
  mctx.save();
  // Avoid subpixel seams between tiles on minimap
  mctx.imageSmoothingEnabled = false;


  mctx.translate(halfW, halfH);
  mctx.rotate(MINIMAP_ROT);

  const marginLeft = MINIMAP_MARGIN_LEFT;
  const marginTop = MINIMAP_MARGIN_TOP;
  const marginRight = MINIMAP_MARGIN_RIGHT;
  const marginBottom = MINIMAP_MARGIN_BOTTOM;
  const paddedW = mw + marginLeft + marginRight;
  const paddedH = mh + marginTop + marginBottom;
  const centerShiftX = (marginRight - marginLeft) * s / 2;
  const centerShiftY = (marginBottom - marginTop) * s / 2;

  mctx.translate(-paddedW * s / 2 + centerShiftX, -paddedH * s / 2 + centerShiftY);


  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const id = tiles[y][x];
      mctx.fillStyle = TILE_ID_TO_COLOR[id] || "#2a2a2a";
      // snap and slightly overlap to hide grid seams
      const px = Math.floor((x + marginLeft) * s);
      const py = Math.floor((y + marginTop) * s);
      const w = Math.ceil(s) + 2;
      mctx.fillRect(px - 1, py - 1, w, w);
      if (fogActive) {
        if (!isTileExplored(x, y)) {
          mctx.fillStyle = FOG_SETTINGS.minimapHiddenColor;
          mctx.fillRect(px - 1, py - 1, w, w);
        } else if (!isTileVisible(x, y)) {
          mctx.fillStyle = FOG_SETTINGS.minimapExploredColor;
          mctx.fillRect(px - 1, py - 1, w, w);
        }
      }
    }
  }

  const colForFaction = (f) => {
    if (f === myTeam) return "#53A7FF";
    if (f === enemyTeam) return "#FF5B5B";
    return "#C8C8C8";
  };



  // drawBuildingMini 함수 동작을 수행
  function drawBuildingMini(b) {
    mctx.fillStyle = colForFaction(b.faction);
    mctx.globalAlpha = 0.85;
    mctx.fillRect((b.x + marginLeft) * s, (b.y + marginTop) * s, (b.width || 1) * s, (b.height || 1) * s);
    mctx.globalAlpha = 1;
  }
  playerbuildings.forEach(drawBuildingMini);
  enemybuildings.forEach((b) => {
    if (fogActive && !isBuildingVisibleToPlayer(b)) return;
    drawBuildingMini(b);
  });



  // drawUnitMini 함수 동작을 수행
  function drawUnitMini(u) {
    mctx.fillStyle = colForFaction(u.faction);
    const r = Math.max(2, s * 0.35);
    mctx.beginPath();
    mctx.arc((u.x + marginLeft) * s, (u.y + marginTop) * s, r, 0, Math.PI * 2);
    mctx.fill();
  }
  playerUnits.forEach(drawUnitMini);
  enemyUnits.forEach((u) => {
    if (fogActive && !isUnitVisibleToPlayer(u)) return;
    drawUnitMini(u);
  });

  for (const r of (mapData.resources || [])) {
    if ((r.amount | 0) <= 0) continue;
    if (fogActive && !isTileExplored(Math.floor(r.x), Math.floor(r.y))) continue;
    mctx.fillStyle = "#ffd166";

    mctx.beginPath();
    mctx.arc((r.x + marginLeft) * s, (r.y + marginTop) * s, Math.max(1.5, s * 0.25), 0, Math.PI * 2);
    mctx.fill();
  }

  // 5xx obstacles on minimap: dark green (501) / darker green (502)
  for (const o of (mapData.obstacles || [])) {
    const col = (o.id === 501) ? "#14532d" : (o.id === 502 ? "#052e16" : "#14532d");
    mctx.fillStyle = col;
    const r = Math.max(1.5, s * 0.25); // +1px larger
    mctx.beginPath();
    mctx.arc((o.x + marginLeft) * s, (o.y + marginTop) * s, r, 0, Math.PI * 2);
    mctx.fill();
  }



  const corners = [[0, 0], [viewW, 0], [viewW, viewH], [0, viewH]];
  mctx.strokeStyle = "white";
  mctx.lineWidth = 2;
  mctx.beginPath();
  for (let i = 0; i < corners.length; i++) {
    const [sx, sy] = corners[i];
    const [wx, wy] = screenToWorld(sx, sy);
    const px = (wx + marginLeft) * s;
    const py = (wy + marginTop) * s;
    if (i === 0) mctx.moveTo(px, py); else mctx.lineTo(px, py);
  }
  mctx.closePath();
  mctx.stroke();

  mctx.restore();
}




// 건설 버튼 활성/비활성 갱신
function refreshBuildButtons() {
  const pairs = [
    [addBuildingBtn1, "nexus"],
    [addBuildingBtn2, "armory"],
    [addBuildingBtn3, "barracks"],
    [addBuildingBtn4, "factory"],
  ];
  for (const [btn, type] of pairs) {
    const miss = missingPrereqs(type);
    const lock = miss.length > 0;
    btn.disabled = lock;
    btn.title = lock ? `필요: ${miss.join(", ")}` : "";
    btn.style.opacity = lock ? 0.5 : 1;
    btn.style.cursor = lock ? "not-allowed" : "pointer";
  }
}

// Override to include cost + affordability
// Keeps same name used across code, but updates labels and disabled state.
refreshBuildButtons = function () {
  const setBtn = (btn, label, enabled, title, onClick) => {
    btn.textContent = label;
    btn.disabled = !enabled;
    btn.title = title || "";
    btn.style.opacity = enabled ? 1 : 0.5;
    btn.style.cursor = enabled ? "pointer" : "not-allowed";
    btn.onclick = onClick || null;
  };

  const showBuild = (btn, type) => {
    const miss = missingPrereqs(type);
    const needPrereq = miss.length > 0;
    const baseCost = getBuildingCost(type);
    const affordNow = canAffordCost(baseCost);
    const reasons = [];
    if (needPrereq) reasons.push(`필요: ${miss.join(", ")}`);
    if (!affordNow) reasons.push(`자원 부족 (${formatCost(baseCost)})`);
    const def = buildingTypes[type] || {};
    const labelName = def.displayName || def.name || type;
    const label = `${labelName} (${formatCost(baseCost)})`;
    const handleClick = () => {
      const missingNow = missingPrereqs(type);
      if (missingNow.length > 0) {
        alert(`선행 건물이 필요합니다: ${missingNow.join(", ")}`);
        return;
      }
      const cost = getBuildingCost(type);
      if (!canAffordCost(cost)) {
        alert(`자원이 부족합니다. 필요: ${formatCost(cost)}`);
        return;
      }
      buildModeSelectedUnitIds = playerUnits.filter(u => u.selected && isWorker(u)).map(u => u.id);
      for (let u of playerUnits) u.selected = false;
      buildMode = true;
      currentBuildType = type;
      updateCanvasCursor();
    };
    setBtn(btn, label, !needPrereq, reasons.join(" | "), handleClick);
    if (!needPrereq && !affordNow) {
      btn.style.opacity = 0.85;
    }
  };

  const showBack = (btn) => setBtn(btn, "< Back", true, "", () => setBuildMenuPage("root"));

  if (buildMenuPage === "root") {
    // Root shows: Nexus / Tech1 / Tech2 / Tech3 / Bay
    showBuild(addBuildingBtn1, "nexus");
    setBtn(addBuildingBtn2, "Tech 1", true, "Armory 관련", () => setBuildMenuPage("tech1"));
    setBtn(addBuildingBtn3, "Tech 2", true, "Barracks 관련", () => setBuildMenuPage("tech2"));
    setBtn(addBuildingBtn4, "Tech 3", true, "Factory 관련", () => setBuildMenuPage("tech3"));
    setBtn(addBuildingBtn5, "Bay", true, "Bay 카테고리", () => setBuildMenuPage("bay"));
    return;
  }

  if (buildMenuPage === "tech1") {
    // Tech1: 1-1 armory, 1-2 armory2 (requires armory)
    showBuild(addBuildingBtn1, "armory");
    showBuild(addBuildingBtn2, "armory2");
    [addBuildingBtn3, addBuildingBtn4].forEach(b => setBtn(b, "", false, "", null));
    showBack(addBuildingBtn5);
    return;
  }
  if (buildMenuPage === "tech2") {
    // Tech2: 1-1 barracks, 1-2 barracks2 (requires barracks)
    showBuild(addBuildingBtn1, "barracks");
    showBuild(addBuildingBtn2, "barracks2");
    [addBuildingBtn3, addBuildingBtn4].forEach(b => setBtn(b, "", false, "", null));
    showBack(addBuildingBtn5);
    return;
  }
  if (buildMenuPage === "tech3") {
    // Tech3: 1-1 factory, 1-2 factory2 (requires factory)
    showBuild(addBuildingBtn1, "factory");
    showBuild(addBuildingBtn2, "factory2");
    [addBuildingBtn3, addBuildingBtn4].forEach(b => setBtn(b, "", false, "", null));
    showBack(addBuildingBtn5);
    return;
  }
  if (buildMenuPage === "bay") {
    // Bay page: Bay / Defense Tower / Observe, Back on btn5
    showBuild(addBuildingBtn1, "bay");
    showBuild(addBuildingBtn2, "defendtower");
    showBuild(addBuildingBtn3, "observe");
    // Mine placement (generic, auto-picks extractor type over resource)
    setBtn(addBuildingBtn4, "Mine", true, "자원 위에서 누르면 채굴기 자동", () => {
      buildModeSelectedUnitIds = playerUnits.filter(u => u.selected && isWorker(u)).map(u => u.id);
      for (let u of playerUnits) u.selected = false;
      buildMode = true;
      currentBuildType = "mine";
      updateCanvasCursor();
    });
    showBack(addBuildingBtn5);
    return;
  }
};


resizeCanvas();
window.addEventListener("resize", resizeCanvas);

// Track window-level mouse for edge scrolling over UI overlays
window.addEventListener("mousemove", (e) => {
  edgeMouseX = e.clientX;
  edgeMouseY = e.clientY;
});


canvas.addEventListener("mousemove", (e) => {
  if (!mapData) return;
  const rect = canvas.getBoundingClientRect();
  mouseX = e.clientX - rect.left;
  mouseY = e.clientY - rect.top;

  if (isDragging) {
    dragEnd = { x: mouseX, y: mouseY };
  }

  if (mouseIsDown && potentialClick && !isDragging) {
    const dx = mouseX - dragStart.x;
    const dy = mouseY - dragStart.y;
    if (dx * dx + dy * dy >= DRAG_THRESHOLD * DRAG_THRESHOLD) {
      isDragging = true;
      potentialClick = false;
      if (dragExtendSelection) {
        selectedBuildingId = null;
        isRallyPlacementMode = false;
        inspectedTarget = null;
      } else {
        clearSelectionAndInspection();
      }
    }
  }

  if (buildMode && mapData) {
    const [rawWX, rawWY] = screenToWorld(mouseX, mouseY);
    const [worldX, worldY] = clampWorldCoords(rawWX, rawWY);
    // infer extractor type when generic 'mine' is selected
    let effectiveType = currentBuildType;
    if (currentBuildType === "mine") {
      const bx = Math.floor(worldX), by = Math.floor(worldY) + 1;
      const res = findResourceAtTile(bx, by);
      const candidates = res ? (RESOURCE_TO_MINES[res.id] || []) : [];
      if (candidates.length > 0) effectiveType = candidates[0];
    }
    const def = buildingTypes[effectiveType];
    let valid = false;
    if (ALL_MINE_TYPES.has(effectiveType)) {
      valid = canPlaceExtractorAt(effectiveType, worldX, worldY);
    } else if (def && def.footprint) {
      valid = canPlaceBuilding(worldX, worldY, def.footprint.w, def.footprint.h);
    }
    window.previewBuilding = {
      type: effectiveType,
      x: Math.floor(worldX),
      y: Math.floor(worldY),
      width: def?.footprint?.w ?? 1,
      height: def?.footprint?.h ?? 1,
      valid,
    };
  } else {
    window.previewBuilding = null;
  }
});


canvas.addEventListener("mousedown", (e) => {
  if (!mapData) return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;


  if (buildMode) {
    const [rawWX2, rawWY2] = screenToWorld(mx, my);
    const [worldX, worldY] = clampWorldCoords(rawWX2, rawWY2);
    // Determine actual place type (auto-picks extractor by resource when 'mine' selected)
    let placeType = currentBuildType;
    if (currentBuildType === "mine") {
      const bx = Math.floor(worldX), by = Math.floor(worldY) + 1;
      const res = findResourceAtTile(bx, by);
      const candidates = res ? (RESOURCE_TO_MINES[res.id] || []) : [];
      if (candidates.length > 0) placeType = candidates[0];
    }
    const def = buildingTypes[placeType];
    const miss = missingPrereqs(currentBuildType);
    if (miss.length) {
      alert(`${currentBuildType} 건설 불가: 먼저 ${miss.join(", ")} 를 지어야 합니다.`);
      buildMode = false;
      updateCanvasCursor();
      return;
    }
    if (ALL_MINE_TYPES.has(placeType) && !canPlaceExtractorAt(placeType, worldX, worldY)) {
      alert("자원 위에서만 지을 수 있습니다.");
      return;
    }
    if (!ALL_MINE_TYPES.has(placeType) && !canPlaceBuilding(worldX, worldY, def.footprint.w, def.footprint.h)) {
      alert("여기에 건물을 지을 수 없습니다.");
      return;
    }
    // building cost check/spend
    const bCost = getBuildingCost(placeType);
    if (!canAffordCost(bCost)) {
      alert(`자원이 부족합니다. 필요: ${formatCost(bCost)}`);
      return;
    }
    spendCost(bCost);
    updateResourceUI();
    const newB = createBuilding(placeType, worldX, worldY, myTeam);
    if (newB) {
      if (ALL_MINE_TYPES.has(newB.type)) {
        const rx = Math.floor(newB.x);
        const ry = Math.floor(newB.y) + 1; // ← 규약 유지
        const res = mapData.resources.find(r => Math.floor(r.x) === rx && Math.floor(r.y) === ry);
        if (res) {
          newB._resId = res.id;
          newB._resX = rx;
          newB._resY = ry;
          newB._prodCd = 0;
        }
      }
      playerbuildings.push(newB);
      // Assign only the units that were selected when entering build mode
      try {
        const workers = buildModeSelectedUnitIds
          .map(id => playerUnits.find(u => u.id === id))
          .filter(u => u && isWorker(u));
        if (workers.length > 0) assignSpecificWorkersToBuilding(newB, workers);
      } catch (_) { }
      // reset captured selection for next time
      buildModeSelectedUnitIds = [];
      buildMode = false;
      updateCanvasCursor();
      socket.emit("BuildplayerBuilding", { buildings: playerbuildings, room: roomId });
      refreshBuildButtons();
    }

    if (maptemp === 0) { currentBuildType = "armory"; maptemp = 1; }
    else { currentBuildType = "nexus"; maptemp = 0; }
    return;
  }


  if (e.button === 0) {
    dragExtendSelection = e.shiftKey === true;
    mouseIsDown = true;
    potentialClick = true;
    isDragging = false;
    dragStart = { x: mx, y: my };
    dragEnd = { x: mx, y: my };
  }
});


canvas.addEventListener("mouseup", (e) => {
  if (!mapData) return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  if (isRallyPlacementMode && potentialClick && !isDragging) {
    potentialClick = false;
    const selB = getSelectedBuilding?.();
    if (selB) {
      const [rawRallyWX, rawRallyWY] = screenToWorld(mx, my);
      const [rallyWX, rallyWY] = clampWorldCoords(rawRallyWX, rawRallyWY);
      setBuildingRallyPoint(selB, rallyWX, rallyWY);
      showToast?.('Rally point set');
    }
    isRallyPlacementMode = false;
    dragExtendSelection = false;
    return;
  }
  if (e.button !== 0) return;
  mouseIsDown = false;


  if (isAttackMode && potentialClick && !isDragging) {
    potentialClick = false;
    isAttackMode = false;
    updateCanvasCursor();

    const pick = pickBuildingAtScreen(mx, my, "any") || pickUnitAtScreen(mx, my, "any");
    const [rawWX4, rawWY4] = screenToWorld(mx, my);
    const [worldX, worldY] = clampWorldCoords(rawWX4, rawWY4);
    const selectedUnits = playerUnits.filter((u) => u.selected);
    const cMap = createCollisionMap();


    if (pick) {
      const t = pick.data;
      const tKind = pick.kind;
      const tTeam = (t && typeof t.faction !== "undefined") ? t.faction : NEUTRAL;
      const tId = t.id;

      // Allow friendly-fire only via explicit Attack command (A-click):
      // do not override with attack-move; proceed to set attackTarget regardless of relation.

      const tX = Math.floor(t.x), tY = Math.floor(t.y);
      const fw = tKind === "building" ? (t.width || 2) : 1;
      const fh = tKind === "building" ? (t.height || 2) : 1;


      const border = reachableBorderTiles(tX, tY, fw, fh, cMap);
      const assigned = new Set();

      for (const u of selectedUnits) {

        const def = unitTypes[u.type] || {};
        const rng = def.range ?? u.range ?? 1.5;
        const distTile = (tKind === "building")
          ? distPointToBuilding(u.x, u.y, t)
          : Math.hypot(t.x - u.x, t.y - u.y);

        u.order = { type: "attackTarget", target: { kind: tKind, team: tTeam, id: tId } };

        if (distTile <= rng + 1e-6) {
          u.path = [];
          continue;
        }


        let target = pickNearestEmpty(u, border, assigned);
        if (!target) {

          border.sort((a, b) => Math.hypot(a[0] - u.x, a[1] - u.y) - Math.hypot(b[0] - u.x, b[1] - u.y));
          target = border[0] || [tX, tY];
        }
        assigned.add(`${target[0]},${target[1]}`);

        let p = findPath(Math.floor(u.x), Math.floor(u.y), target[0], target[1], cMap);
        if (!p || p.length === 0) {

          const alts = findEmptyTilesAroundPoint(cMap, target[0], target[1], 12);
          const alt = pickNearestEmpty(u, alts, assigned);
          if (alt) {
            p = findPath(Math.floor(u.x), Math.floor(u.y), alt[0], alt[1], cMap);
            if (p) assigned.add(`${alt[0]},${alt[1]}`);
          }
        }
        u.path = p || [];
      }

      try {
        socket.emit("orders", {
          room: roomId,
          orders: selectedUnits.map((u) => ({
            unitId: u.id,
            team: myTeam,
            type: "attackTarget",
            target: { kind: tKind, team: tTeam, id: tId },
          })),
        });
      } catch (_) { }
    } else {

      const gx = Math.floor(worldX), gy = Math.floor(worldY);
      for (const u of selectedUnits) {
        u.order = { type: "attackMove", tx: gx, ty: gy };
        u._resumeOrder = null;
        const sx = Math.floor(u.x), sy = Math.floor(u.y);
        u.path = findPath(sx, sy, gx, gy, cMap) || [];
      }

    }

    renderUnitPanel();
    dragExtendSelection = false;
    return;
  }


  if (isDragging) {
    isDragging = false;
    dragEnd = { x: mx, y: my };
    inspectedTarget = null;
    selectUnitsInBox(dragStart, dragEnd, { extend: dragExtendSelection });
    dragExtendSelection = false;
    dragStart = null;
    dragEnd = null;
    renderUnitPanel();
    return;
  }

  dragExtendSelection = false;

  if (potentialClick) {
    potentialClick = false;
    const extendSelection = e.shiftKey === true;
    // clicking anything cancels build placement
    const { tileWidth, tileHeight } = mapData;
    const centerX = viewW / 2;
    let clicked = false;


    for (let unit of playerUnits) {
      const screenX = (unit.x - unit.y) * tileWidth / 2 - cameraX + centerX;
      const screenY = (unit.x + unit.y) * tileHeight / 2 - cameraY;
      const dist = Math.hypot(screenX - mx, screenY - my);
      if (dist < 32) {
        selectedBuildingId = null;
        if (!extendSelection && !e.ctrlKey) {
          for (let u of playerUnits) u.selected = false;
        }
        if (e.ctrlKey) {
          const type = unit.type;
          for (let other of playerUnits) {
            const ox = (other.x - other.y) * tileWidth / 2 - cameraX + centerX;
            const oy = (other.x + other.y) * tileHeight / 2 - cameraY;
            const inView =
              ox >= 0 && ox <= viewW &&
              oy >= 0 && oy <= viewH;
            if (other.type === type && inView) {
              other.selected = true;
            }
          }
          inspectedTarget = null;
        } else {
          if (extendSelection && unit.selected) {
            unit.selected = false;
            if (inspectedTarget && inspectedTarget.kind === "unit" && inspectedTarget.data === unit) {
              inspectedTarget = null;
            }
            if (!playerUnits.some((u) => u.selected)) {
              inspectedTarget = null;
            }
          } else {
            unit.selected = true;
            if (!extendSelection) inspectedTarget = null;
          }
        }
        clicked = true;
        break;
      }
    }

    if (!clicked) {
      const pickMine = pickBuildingAtScreen(mx, my, "mine");
      if (pickMine) {
        for (let u of playerUnits) u.selected = false;
        selectedBuildingId = pickMine.data.id ?? null;
        inspectedTarget = null;
        clicked = true;
      }
    }
    if (!clicked) {
      const res = pickResourceAtScreen(mx, my);
      if (res) {
        inspectedTarget = { kind: "resource", data: res };
        selectedBuildingId = null;
        for (let u of playerUnits) u.selected = false;
        renderUnitPanel();
        renderBuildingPanel();
        return;
      }
    }

    if (!clicked) {
      const pickU = pickUnitAtScreen(mx, my, "any");
      const pickB = pickBuildingAtScreen(mx, my, "any");
      const pick = pickU || pickB;

      if (pick) {
        const fac = pick.data.faction;
        const rel = relationOf(fac);
        if (rel === "enemy" || rel === "neutral") {
          inspectedTarget = pick;
          for (let u of playerUnits) u.selected = false;
          selectedBuildingId = null;
          renderUnitPanel();
          renderBuildingPanel();
          return;
        }
      }
    }


    if (!clicked) {
      if (!extendSelection) {
        inspectedTarget = null;
        selectedBuildingId = null;
        for (let u of playerUnits) u.selected = false;
      }
    }
    renderUnitPanel();
    renderBuildingPanel();
  }
});


canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (!mapData) return;
  isAttackMode = false;
  updateCanvasCursor();

  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  const [rawWX5, rawWY5] = screenToWorld(mx, my);
  const [worldX, worldY] = clampWorldCoords(rawWX5, rawWY5);
  const selectedUnits = playerUnits.filter((u) => u.selected);
  const selectedBuilding = getSelectedBuilding?.();
  if (selectedBuilding && selectedUnits.length === 0) {
    setBuildingRallyPoint(selectedBuilding, worldX, worldY);
    isRallyPlacementMode = false;
    showToast?.('Rally point set');
    return;
  }
  for (const u of selectedUnits) { clearCombatState(u); }
  // Inform server to clear any prior attack orders so combat stops server-side
  try {
    if (selectedUnits.length) {
      // Send a dummy attackTarget to an invalid neutral entity so server clears prior orders
      socket.emit("orders", {
        room: roomId,
        orders: selectedUnits.map(u => ({
          unitId: u.id,
          team: myTeam,
          type: "attackTarget",
          target: { kind: "unit", team: "neutral", id: -1 },
        })),
      });
    }
  } catch (_) { }
  const collisionMap = createCollisionMap();

  // If right-clicking a friendly, under-construction building with workers selected,
  // convert into a build command and distribute workers to adjacent perimeter tiles (all sides).
  const pickB = pickBuildingAtScreen(mx, my, "any");
  if (pickB && pickB.kind === "building") {
    const b = pickB.data;
    if (b && b.faction === myTeam && b.constructing) {
      const workers = selectedUnits.filter(isWorker);
      if (workers.length > 0) {
        const front = getFrontBorderTiles(b, collisionMap);
        const border = front.length ? front : reachableBorderTiles(Math.floor(b.x), Math.floor(b.y), b.width || 1, b.height || 1, collisionMap);
        const taken = new Set();
        // greedily assign closest border tiles
        for (const u of workers) {
          const choices = [...border].filter(([x, y]) => !taken.has(`${x},${y}`))
            .sort((a, b2) => Math.hypot(a[0] + 0.5 - u.x, a[1] + 0.5 - u.y) - Math.hypot(b2[0] + 0.5 - u.x, b2[1] + 0.5 - u.y));
          const spot = choices[0] || border[0];
          if (!spot) continue;
          const [gx, gy] = spot;
          taken.add(`${gx},${gy}`);
          u.order = { type: "build", buildingId: b.id };
          const sx = Math.floor(u.x), sy = Math.floor(u.y);
          u.path = findPath(sx, sy, gx, gy, collisionMap) || [];
        }
        return; // done handling build command
      }
    }
  }

  const emptyTiles = findEmptyTilesAroundPoint(collisionMap, worldX, worldY, selectedUnits.length);
  const assignedTargets = new Set();

  for (let i = 0; i < selectedUnits.length; i++) {
    const unit = selectedUnits[i];
    let target = i < emptyTiles.length ? emptyTiles[i] : [Math.floor(worldX), Math.floor(worldY)];


    if (Math.floor(unit.x) === target[0] && Math.floor(unit.y) === target[1]) {
      const extras = findEmptyTilesAroundPoint(collisionMap, worldX, worldY, selectedUnits.length * 2);
      target = extras.find(
        (t) =>
          !(Math.floor(unit.x) === t[0] && Math.floor(unit.y) === t[1]) &&
          !assignedTargets.has(t.toString())
      ) || [Math.floor(unit.x), Math.floor(unit.y)];
    }
    assignedTargets.add(target.toString());

    const startX = Math.floor(unit.x);
    const startY = Math.floor(unit.y);
    const goalX = target[0];
    const goalY = target[1];
    let path = findPath(startX, startY, goalX, goalY, collisionMap);

    if (!path) {
      const backups = findEmptyTilesAroundPoint(collisionMap, goalX, goalY, 5);
      for (let t of backups) {
        const ap = findPath(startX, startY, t[0], t[1], collisionMap);
        if (ap) { path = ap; break; }
      }
    }
    unit.path = path || [];
  }
});


window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.key === "a" || e.key === "A") {
    if (!isAttackMode) {
      lastAttackCursor = computeBaseCursor();
    }
    isAttackMode = true;
    updateCanvasCursor();
  } else if (e.key === "b" || e.key === "B") {
    // Quick-build Bay
    if (canBuildType("bay")) {
      buildModeSelectedUnitIds = playerUnits.filter(u => u.selected && isWorker(u)).map(u => u.id);
      for (let u of playerUnits) u.selected = false;
      buildMode = true;
      currentBuildType = "bay";
    }
  } else if (e.key === "t" || e.key === "T") {
    // Quick-build Defense Tower
    if (canBuildType("defendtower")) {
      buildModeSelectedUnitIds = playerUnits.filter(u => u.selected && isWorker(u)).map(u => u.id);
      for (let u of playerUnits) u.selected = false;
      buildMode = true;
      currentBuildType = "defendtower";
    }
  } else if (e.key === "o" || e.key === "O") {
    // Quick-build Observe Tower
    if (canBuildType("observe")) {
      buildModeSelectedUnitIds = playerUnits.filter(u => u.selected && isWorker(u)).map(u => u.id);
      for (let u of playerUnits) u.selected = false;
      buildMode = true;
      currentBuildType = "observe";
    }
  } else if (e.key === "s" || e.key === "S") {
    // Quick-build Special Lab
    if (canBuildType("special")) {
      buildModeSelectedUnitIds = playerUnits.filter(u => u.selected && isWorker(u)).map(u => u.id);
      for (let u of playerUnits) u.selected = false;
      buildMode = true;
      currentBuildType = "special";
    }
  } else if (e.key === "e" || e.key === "E") {
    // Quick-build Advanced Mine (mine3 -> produces epic unit)
    if (canBuildType("mine3")) {
      buildModeSelectedUnitIds = playerUnits.filter(u => u.selected && isWorker(u)).map(u => u.id);
      for (let u of playerUnits) u.selected = false;
      buildMode = true;
      currentBuildType = "mine3";
    }
  } else if (e.key === "y" || e.key === "Y") {
    const selB = getSelectedBuilding?.();
    if (selB) {
      isRallyPlacementMode = true;
      showToast?.('Rally point: left-click destination');
      e.preventDefault();
    }
  }
  updateCanvasCursor();
});
window.addEventListener("keyup", (e) => {
  if (e.key === "a" || e.key === "A") {

  } else if (e.key === "Escape") {
    isAttackMode = false;
    isRallyPlacementMode = false;
    updateCanvasCursor();
  }
});


// handleMiniPan 함수 동작을 수행
function handleMiniPan(e) {
  const rect = minimap.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const [wx, wy] = miniToWorldRot(mx, my);
  centerCameraOnTile(wx, wy);
}
minimap.addEventListener("mousedown", (e) => {
  miniDragging = true;
  handleMiniPan(e);
});
window.addEventListener("mousemove", (e) => {
  if (miniDragging) handleMiniPan(e);
});
window.addEventListener("mouseup", () => { miniDragging = false; });



// 선택 건물 주위로 유닛 소환
function spawnUnitFromBuilding(unitType) {
  const b = getSelectedBuilding();
  if (!b || !mapData) return;
  // Check cost and affordability first
  const cost = getUnitCost(unitType);
  if (!canAffordCost(cost)) {
    // not enough resources
    return;
  }
  const coll = createCollisionMap();
  const w = coll[0].length, h = coll.length;

  const inBounds = (x, y) => x >= 1 && y >= 0 && x < w && y < h - 1;
  const occupiedByMe = new Set(playerUnits.map((u) => `${Math.floor(u.x)},${Math.floor(u.y)}`));

  const bx = Math.floor(b.x), by = Math.floor(b.y);
  const bw = b.width | 0, bh = b.height | 0;


  // ringCandidates 함수 동작을 수행
  function ringCandidates(p) {
    const out = [];
    const x0 = bx - p, x1 = bx + bw - 1 + p;
    const y0 = by - p;
    // Reduce allowable bottom side by 3 tiles
    let y1 = by + bh - 1 + p - 3;
    if (y1 < y0) y1 = y0;
    for (let x = x0; x <= x1; x++) {
      if (inBounds(x, y0) && coll[y0][x] === 0) out.push([x, y0]);
      if (inBounds(x, y1) && coll[y1][x] === 0) out.push([x, y1]);
    }
    for (let y = y0 + 1; y <= y1 - 1; y++) {
      if (inBounds(x0, y) && coll[y][x0] === 0) out.push([x0, y]);
      if (inBounds(x1, y) && coll[y][x1] === 0) out.push([x1, y]);
    }
    return out;
  }

  let target = null;
  const MAX_PAD = Math.max(w, h);
  for (let p = 1; p <= MAX_PAD && !target; p++) {
    const ring = ringCandidates(p);
    target = ring.find(([x, y]) => !occupiedByMe.has(`${x},${y}`));
  }
  if (!target) return;

  // Deduct resources and spawn unit
  spendCost(cost);
  updateResourceUI();
  const u = createUnit(unitType, target[0], target[1], myTeam);
  if (u) {
    playerUnits.push(u);
    sendUnitToBuildingRally(b, u);
  }
  // refresh buttons to reflect new affordability
  configureProductionButtons(b.type);
}

// Queue-based production: enqueue with time cost
function enqueueUnitProduction(unitType) {
  const b = getSelectedBuilding();
  if (!b || !mapData) return;
  if (b.constructing) return;
  const cost = getUnitCost(unitType);
  if (!canAffordCost(cost)) return;
  spendCost(cost);
  updateResourceUI();
  const time = (unitTypes[unitType]?.time) ?? 0;
  b._prodQueue = b._prodQueue || [];
  // Queue with base time; actual progress speed is affected per-frame by sub-commander
  b._prodQueue.push({ type: unitType, remaining: Math.max(0.01, time) });
  configureProductionButtons(b.type);
  renderBuildingPanel?.();
}

// Attempt spawning a unit next to a specific building; returns true on success
function trySpawnUnitAtBuilding(b, unitType) {
  const coll = createCollisionMap();
  const w = coll[0].length, h = coll.length;
  const inBounds = (x, y) => x >= 1 && y >= 0 && x < w && y < h;
  const occupiedByMe = new Set(playerUnits.map((u) => `${Math.floor(u.x)},${Math.floor(u.y)}`));
  const bx = Math.floor(b.x), by = Math.floor(b.y);
  const bw = b.width | 0, bh = b.height | 0;
  function ringCandidates(p) {
    const out = [];
    const x0 = bx - p, x1 = bx + bw - 1 + p;
    const y0 = by - p;
    // Reduce allowable bottom side by 3 tiles
    let y1 = by + bh - 1 + p - 2;
    if (y1 < y0) y1 = y0;
    for (let x = x0; x <= x1; x++) {
      if (inBounds(x, y0) && coll[y0][x] === 0) out.push([x, y0]);
      if (inBounds(x, y1) && coll[y1][x] === 0) out.push([x, y1]);
    }
    for (let y = y0 + 1; y <= y1 - 1; y++) {
      if (inBounds(x0, y) && coll[y][x0] === 0) out.push([x0, y]);
      if (inBounds(x1, y) && coll[y][x1] === 0) out.push([x1, y]);
    }
    return out;
  }
  let target = null;
  const MAX_PAD = Math.max(w, h);
  for (let p = 1; p <= MAX_PAD && !target; p++) {
    const ring = ringCandidates(p);
    target = ring.find(([x, y]) => !occupiedByMe.has(`${x},${y}`));
  }
  if (!target) return false;
  const u = createUnit(unitType, target[0], target[1], myTeam);
  if (u) {
    playerUnits.push(u);
    sendUnitToBuildingRally(b, u);
  }
  return true;
}

// Cancel and refund an under-construction building
function cancelConstruction(b) {
  if (!b || !b.constructing) return;
  const cost = getBuildingCost(b.type);
  playerRes[401] = (playerRes[401] | 0) + (cost[401] | 0);
  playerRes[402] = (playerRes[402] | 0) + (cost[402] | 0);
  playerRes[403] = (playerRes[403] | 0) + (cost[403] | 0);
  updateResourceUI();
  // remove building
  playerbuildings = playerbuildings.filter(x => x.id !== b.id);
  selectedBuildingId = null;
  socket.emit("BuildplayerBuilding", { buildings: playerbuildings, room: roomId });
  renderBuildingPanel?.();
}

// Cancel queued unit and refund its cost
function cancelQueueItem(b, idx) {
  if (!b || !Array.isArray(b._prodQueue)) return;
  if (idx < 0 || idx >= b._prodQueue.length) return;
  const item = b._prodQueue[idx];
  const cost = getUnitCost(item.type);
  playerRes[401] = (playerRes[401] | 0) + (cost[401] | 0);
  playerRes[402] = (playerRes[402] | 0) + (cost[402] | 0);
  playerRes[403] = (playerRes[403] | 0) + (cost[403] | 0);
  updateResourceUI();
  b._prodQueue.splice(idx, 1);
  configureProductionButtons(b.type);
  renderBuildingPanel?.();
}


// 점과 건물의 최소 거리 계산
function distPointToBuilding(px, py, b) {
  const left = b.x;
  const right = left + (b.width ?? 1);
  const top = b.y;
  const bottom = top + (b.height ?? 1);
  const dx = (px < left) ? (left - px) : (px > right ? (px - right) : 0);
  const dy = (py < top) ? (top - py) : (py > bottom ? (py - bottom) : 0);
  return Math.hypot(dx, dy);
}



// 사거리 내 최적의 적 타깃 탐색
function findBestTargetWithin(unit, radius) {
  let best = null;
  let bestDist = Infinity;
  const considerFog = FOG_ENABLED && unit.faction === myTeam;

  for (const e of enemyUnits) {
    if (considerFog && !isUnitVisibleToPlayer(e)) continue;
    const d = Math.hypot(e.x - unit.x, e.y - unit.y);
    if (d <= radius && d < bestDist) {
      best = { kind: "unit", data: e };
      bestDist = d;
    }
  }
  for (const b of enemybuildings) {
    if (considerFog && !isBuildingVisibleToPlayer(b)) continue;
    const d = distPointToBuilding(unit.x, unit.y, b);
    if (d <= radius && d < bestDist) {
      best = { kind: "building", data: b };
      bestDist = d;
    }
  }
  return best ? { ...best, dist: bestDist } : null;
}

addBuildingBtn1.onclick = () => {
  if (!canBuildType("nexus")) { alert("넥서스는 선행 조건이 없습니다."); return; }
  buildModeSelectedUnitIds = playerUnits.filter(u => u.selected && isWorker(u)).map(u => u.id);
  for (let u of playerUnits) u.selected = false;
  buildMode = true;
  currentBuildType = "nexus";
  updateCanvasCursor();
};
addBuildingBtn2.onclick = () => {
  const miss = missingPrereqs("armory");
  if (miss.length) { alert(`아머리를 지으려면 먼저 ${miss.join(", ")} 가 필요합니다.`); return; }
  buildModeSelectedUnitIds = playerUnits.filter(u => u.selected && isWorker(u)).map(u => u.id);
  for (let u of playerUnits) u.selected = false;
  buildMode = true;
  currentBuildType = "armory";
  updateCanvasCursor();
};
addBuildingBtn3.onclick = () => {
  const miss = missingPrereqs("barracks");
  if (miss.length) { alert(`배럭스를 지으려면 먼저 ${miss.join(", ")} 가 필요합니다.`); return; }
  buildModeSelectedUnitIds = playerUnits.filter(u => u.selected && isWorker(u)).map(u => u.id);
  for (let u of playerUnits) u.selected = false;
  buildMode = true;
  currentBuildType = "barracks";
  updateCanvasCursor();
};
addBuildingBtn4.onclick = () => {
  const miss = missingPrereqs("factory");
  if (miss.length) { alert(`팩토리를 지으려면 먼저 ${miss.join(", ")} 가 필요합니다.`); return; }
  buildModeSelectedUnitIds = playerUnits.filter(u => u.selected && isWorker(u)).map(u => u.id);
  for (let u of playerUnits) u.selected = false;
  buildMode = true;
  currentBuildType = "factory";
  updateCanvasCursor();
};

// Mine placement: enter generic 'mine' mode, auto-picks type by hovered resource
addBuildingBtn5.onclick = () => {
  buildModeSelectedUnitIds = playerUnits.filter(u => u.selected && isWorker(u)).map(u => u.id);
  for (let u of playerUnits) u.selected = false;
  buildMode = true;
  currentBuildType = "mine";
  updateCanvasCursor();
};


startBtn.onclick = () => {
  nickname = nicknameInput.value.trim() || "Player";
  teamNames[myTeam] = nickname || "Player";
  matchStatus.textContent = "find match...";
  loader.style.display = "block";
  socket.emit("joinGame", { nickname });
};

socket.on("assignTeam", (data) => {
  myTeam = data.team === "B" ? "B" : "A";
  enemyTeam = myTeam === "A" ? "B" : "A";
  teamNames[myTeam] = nickname || "Player";
  teamNames[enemyTeam] = enemyNickname || "Enemy";
  refreshBuildButtons();
});

socket.on("gameStart", (data) => {
  roomId = data.room;
  enemyNickname = data.players.find((p) => p.id !== socket.id)?.nickname || "Enemy";
  teamNames[myTeam] = nickname || "Player";
  teamNames[enemyTeam] = enemyNickname || "Enemy";
  try { serverAssignedSpawn = data?.spawns?.[myTeam] || null; } catch (_) { serverAssignedSpawn = null; }
  matchStatus.textContent = "Match found";
  loader.style.display = "none";
  resetGameClock();

  setTimeout(() => {
    home.style.display = "none";
    if (minimapWrap) minimapWrap.classList.remove('hidden');
    if (resourceBar) resourceBar.classList.remove('hidden');
    canvas.style.display = "block";
    addUnitBtn1.style.display = "inline-block";
    addUnitBtn2.style.display = "inline-block";
    addBuildingBtn1.style.display = "inline-block";
    addBuildingBtn2.style.display = "inline-block";
    addBuildingBtn3.style.display = "inline-block";
    addBuildingBtn4.style.display = "inline-block";
    if (addBuildingBtn5) addBuildingBtn5.style.display = "inline-block";
    startGame();
    refreshBuildButtons();
  }, 1000);
});

// 동기화: 상대방이 채굴해 자원량이 변할 때 갱신
socket.on("resourceUpdate", (msg = {}) => {
  try {
    if (!mapData || !Array.isArray(mapData.resources)) return;
    const rx = Math.floor(msg.x), ry = Math.floor(msg.y);
    for (const r of mapData.resources) {
      if (Math.floor(r.x) === rx && Math.floor(r.y) === ry) {
        if (msg.id == null || r.id === msg.id) {
          r.amount = Math.max(0, Number(msg.amount) | 0);
        }
        break;
      }
    }
  } catch (_) { }
});

socket.on("combatUpdate", (msg = {}) => {
  const updates = msg.updates || [];
  const buildingUpdates = msg.buildingUpdates || [];

  const teamToFaction = (t) => (t === "neutral" ? NEUTRAL : t);


  for (const up of updates) {
    const fac = teamToFaction(up.team);
    let unit =
      playerUnits.find((u) => u.id === up.id && u.faction === fac) ||
      enemyUnits.find((u) => u.id === up.id && u.faction === fac);
    if (!unit) continue;
    unit.hp = up.hp;
    if (up.didAttack) {
      const def = unitTypes[unit.type] || {};
      const period = def.period ?? unit.period ?? 1.0;
      unit._attackAnim = Math.min(0.45, period * 0.7);
    }
    if (up.dead) {
      deadUnits.add(`${fac}:${up.id}`);
      let idx = playerUnits.indexOf(unit);
      if (idx !== -1) playerUnits.splice(idx, 1);
      idx = enemyUnits.indexOf(unit);
      if (idx !== -1) enemyUnits.splice(idx, 1);
    }
  }

  for (const bu of buildingUpdates) {
    const fac = teamToFaction(bu.team);
    let b =
      playerbuildings.find((x) => x.id === bu.id && x.faction === fac) ||
      enemybuildings.find((x) => x.id === bu.id && x.faction === fac);
    if (!b) continue;
    b.hp = bu.hp;
    if (bu.dead) {
      deadBuildings.add(`${fac}:${bu.id}`);
      const shooters = (fac === myTeam) ? enemyUnits : playerUnits;
      for (const u of shooters) {
        const def = unitTypes[u.type] || {};
        const rng = def.range ?? u.range ?? 1.5;
        if (distPointToBuilding(u.x, u.y, b) <= rng + 0.5) {
          u._attackAnim = 0;
        }
      }
      let idx = playerbuildings.indexOf(b);
      if (idx !== -1) playerbuildings.splice(idx, 1);
      idx = enemybuildings.indexOf(b);
      if (idx !== -1) enemybuildings.splice(idx, 1);
    }
  }
  for (const u of playerUnits) {
    if (u.order?.type === "attackTarget" && !findTargetByOrder(u.order)) {
      u.order = null;
      u._cd = 0;
      u._attackAnim = 0;
    }
  }
  rebindInspectedTargetIfNeeded();
  refreshBuildButtons?.();
  renderUnitPanel();
  renderBuildingPanel();
  if (!defeatTriggered) {
    const mine = myOwnedBuildings();
    if (mine.length > 0) {
      hasEverOwnedBuilding = true;
    } else if (hasEverOwnedBuilding) {
      handlePlayerDefeat();
    }
  }
});

socket.on("enemyMove", (data = {}) => {
  const incoming = Array.isArray(data.units) ? data.units : [];


  const prevByKey = new Map(
    enemyUnits.map(u => [`${u.faction}:${u.id}`, u])
  );

  const next = incoming
    .filter(raw => !deadUnits.has(`${raw.faction}:${raw.id}`))
    .map(raw => {
      const key = `${raw.faction}:${raw.id}`;
      const prev = prevByKey.get(key);
      const def = unitTypes[raw.type] || {};

      const maxHp = prev?.maxHp ?? raw.maxHp ?? (def.hp ?? 1);
      const hp = Math.min(prev?.hp ?? raw.hp ?? maxHp, maxHp);

      return {
        ...raw,
        maxHp,
        hp,

        armor: prev?.armor ?? raw.armor ?? (def.armor ?? 0),
        range: prev?.range ?? raw.range ?? (def.range ?? 1.5),
        period: prev?.period ?? raw.period ?? (def.period ?? 1.0),
        speed: prev?.speed ?? raw.speed ?? (def.speed ?? 3),
      };
    });

  enemyUnits = next;
});


socket.on("BuildenemyBuilding", (data) => {
  const incoming = Array.isArray(data.buildings) ? data.buildings : [];
  const prevByKey = new Map(
    enemybuildings.map(b => [`${b.faction}:${b.id}`, b])
  );

  const merged = [];
  for (const raw of incoming) {
    const fac = raw.faction ?? enemyTeam;
    const key = `${fac}:${raw.id}`;
    if (deadBuildings.has(key)) continue; // do not resurrect confirmed-dead
    const prev = prevByKey.get(key);
    const def = buildingTypes[raw.type] || {};
    const maxHpIncoming = (typeof raw.maxHp === "number") ? raw.maxHp : (def.hp ?? 100);
    const maxHp = prev?.maxHp ?? maxHpIncoming;
    // Never increase hp from this snapshot; server combatUpdate is authoritative
    const incomingHp = (typeof raw.hp === "number") ? raw.hp : maxHpIncoming;
    const hp = Math.min(prev?.hp ?? incomingHp, maxHp);

    merged.push({
      ...raw,
      faction: fac,
      id: raw.id == null ? allocBuildingId(fac) : raw.id,
      x: Math.floor(raw.x),
      y: Math.floor(raw.y),
      maxHp,
      hp,
      width: raw.width,
      height: raw.height,
    });
  }
  enemybuildings = merged;
  refreshBuildButtons();
  rebindInspectedTargetIfNeeded();
  if (!defeatTriggered) {
    const mine = myOwnedBuildings();
    if (mine.length > 0) {
      hasEverOwnedBuilding = true;
    } else if (hasEverOwnedBuilding) {
      handlePlayerDefeat();
    }
  }
});



// 내 유닛/건물 상태 네트워크 브로드캐스트
function networkTick() {
  socket.emit("playerMove", { units: playerUnits, room: roomId });
  const owned = playerbuildings.filter(b => b.faction === myTeam);
  socket.emit("BuildplayerBuilding", { buildings: owned, room: roomId });
}



// 공격 명령의 실제 타깃 객체 조회
function findTargetByOrder(order) {
  if (!order || order.type !== "attackTarget" || !order.target) return null;
  const { kind, team, id } = order.target;
  if (kind === "unit") {
    const all = [...playerUnits, ...enemyUnits];
    return all.find((u) => u.id === id && u.faction === team) || null;
  } else {
    const all = [...playerbuildings, ...enemybuildings];
    return all.find((b) => b.id === id && b.faction === team) || null;
  }
}



// 대기 유닛의 자동 교전 유발
function tryAutoAggroWhenIdle(unit, cMap) {
  const def = unitTypes[unit.type] || {};
  const atkRange = def.range ?? unit.range ?? 1.5;
  const aggroRange = atkRange;
  let best = null;
  let bestDist = Infinity;
  const considerFog = FOG_ENABLED && unit.faction === myTeam;
  for (const e of enemyUnits) {
    if (considerFog && !isUnitVisibleToPlayer(e)) continue;
    const d = Math.hypot(e.x - unit.x, e.y - unit.y);
    if (d <= aggroRange && d < bestDist) {
      best = { kind: "unit", data: e };
      bestDist = d;
    }
  }
  for (const b of enemybuildings) {
    if (considerFog && !isBuildingVisibleToPlayer(b)) continue;
    const d = distPointToBuilding(unit.x, unit.y, b);
    if (d <= aggroRange && d < bestDist) {
      best = { kind: "building", data: b };
      bestDist = d;
    }
  }

  if (!best) return;

  const t = best.data;
  const tKind = best.kind;
  const tTeam = t.faction;
  unit.order = { type: "attackTarget", target: { kind: tKind, team: tTeam, id: t.id } };

  if (bestDist <= atkRange) {
    unit.path = [];
  } else {
    const fw = tKind === "building" ? (t.width || 2) : 1;
    const fh = tKind === "building" ? (t.height || 2) : 1;
    const [gx, gy] = nearestReachableAround(Math.floor(t.x), Math.floor(t.y), fw, fh, cMap, Math.floor(unit.x), Math.floor(unit.y));
    unit.path = findPath(Math.floor(unit.x), Math.floor(unit.y), gx, gy, cMap) || [];
  }
}


// 좌표 주변의 빈 타일 탐색
function findEmptyTilesAroundPoint(collisionMap, x, y, neededCount = 10) {
  const tiles = [];
  const w = collisionMap[0].length;
  const h = collisionMap.length;
  const visited = new Set();
  const q = [];
  const sx = Math.floor(x), sy = Math.floor(y);
  const inb = (cx, cy) => cx >= 0 && cy >= 0 && cx < w && cy < h;

  q.push([sx, sy]); visited.add(`${sx},${sy}`);
  const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (q.length && tiles.length < neededCount) {
    const [cx, cy] = q.shift();
    if (inb(cx, cy) && collisionMap[cy][cx] === 0) tiles.push([cx, cy]);
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy, key = `${nx},${ny}`;
      if (!visited.has(key) && inb(nx, ny) && collisionMap[ny][nx] === 0) {
        visited.add(key); q.push([nx, ny]);
      }
    }
  }
  return tiles;
}


// 분산 처리 대상 유닛 판정
function isStationaryForSeparation(u) {
  if (u.path && u.path.length > 0) return false;



  if (!u.order) return true;
  if (u.order.type === "attackMove") return false;

  if (u.order.type === "attackTarget") {
    const tgt = findTargetByOrder(u.order);
    if (!tgt) return true;
    const def = unitTypes[u.type] || {};
    const rng = def.range ?? u.range ?? 1.5;
    const dist = (u.order.target.kind === "building")
      ? distPointToBuilding(u.x, u.y, tgt)
      : Math.hypot(tgt.x - u.x, tgt.y - u.y);
    return dist <= rng + 1e-6;
  }
  return false;
}




// 좌표에서 타깃까지의 거리 계산
function distToTargetFrom(x, y, order) {
  if (!order || order.type !== "attackTarget") return Infinity;
  const tgt = findTargetByOrder(order);
  if (!tgt) return Infinity;
  return (order.target.kind === "building")
    ? distPointToBuilding(x, y, tgt)
    : Math.hypot(tgt.x - x, tgt.y - y);
}





// 내 유닛의 타일 점유 현황 생성
function buildPlayerOccupancy() {
  const tileToUnits = new Map();
  for (const u of playerUnits) {
    const x = Math.floor(u.x), y = Math.floor(u.y);
    const k = `${x},${y}`;
    if (!tileToUnits.has(k)) tileToUnits.set(k, []);
    tileToUnits.get(k).push(u);
  }
  return tileToUnits;
}



// 후보 중 가장 가까운 빈칸 선택
function pickNearestEmpty(unit, candidates, assignedSet) {
  const ux = Math.floor(unit.x), uy = Math.floor(unit.y);
  let best = null, bestD = Infinity;
  for (const [cx, cy] of candidates) {
    const key = `${cx},${cy}`;
    if (assignedSet.has(key)) continue;
    if (cx === ux && cy === uy) continue;
    const d = Math.hypot(cx - ux, cy - uy);
    if (d < bestD) { bestD = d; best = [cx, cy]; }
  }
  return best;
}







// 목표 경계의 도달 가능 타일 수집
function reachableBorderTiles(targetX, targetY, fw, fh, map) {
  const tiles = [];
  const H = map.length, W = map[0].length;
  for (let dy = -1; dy <= fh; dy++) {
    for (let dx = -1; dx <= fw; dx++) {
      const onBorder = dy === -1 || dy === fh || dx === -1 || dx === fw;
      if (!onBorder) continue;
      const cx = Math.floor(targetX) + dx;
      const cy = Math.floor(targetY) + dy;
      if (cy >= 0 && cy < H && cx >= 0 && cx < W && map[cy][cx] === 0) {
        tiles.push([cx, cy]);
      }
    }
  }
  return tiles;
}

// Global ESC shortcut: cancel build mode (clear preview and captured workers)
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (buildMode) {
      buildMode = false;
      buildModeSelectedUnitIds = [];
      window.previewBuilding = null;
      e.preventDefault();
      updateCanvasCursor();
    }
  }
});

// Determine if a unit is a worker (has working images)
function isWorker(u) {
  const def = unitTypes[u.type] || {};
  return !!def.workingimage; // presence of workingimage marks a worker
}

// Border tiles around the building (all sides) just outside the footprint
// Note: previously limited to the south side; now returns 360° reachable perimeter
function getFrontBorderTiles(b, cMap) {
  const tX = Math.floor(b.x);
  const tY = Math.floor(b.y);
  const fw = b.width || 1;
  const fh = b.height || 1;
  return reachableBorderTiles(tX, tY, fw, fh, cMap);
}

// Assign nearest available worker to build a newly placed building
function assignWorkersToBuilding(b, maxCount) {
  const allWorkers = playerUnits.filter(u => u.faction === myTeam && isWorker(u));
  if (allWorkers.length === 0) return;
  const cMap = createCollisionMap();
  let front = getFrontBorderTiles(b, cMap);
  if (front.length === 0) {
    // fallback to any border tile
    front = reachableBorderTiles(Math.floor(b.x), Math.floor(b.y), b.width || 1, b.height || 1, cMap);
    if (front.length === 0) return;
  }
  // choose target count
  const targetCount = Math.min(front.length, (typeof maxCount === 'number' ? maxCount : allWorkers.length));
  // pick nearest workers to building center
  const bx = b.x + (b.width || 1) / 2;
  const by = b.y + (b.height || 1) / 2;
  const workers = [...allWorkers]
    .filter(u => !u.order || u.order.type !== 'build')
    .sort((u1, u2) => (Math.hypot(u1.x - bx, u1.y - by) - Math.hypot(u2.x - bx, u2.y - by)))
    .slice(0, targetCount);
  // greedily assign nearest border tile for each worker
  const taken = new Set();
  for (const u of workers) {
    const choices = [...front]
      .filter(([x, y]) => !taken.has(`${x},${y}`))
      .sort((a, b2) => Math.hypot(a[0] + 0.5 - u.x, a[1] + 0.5 - u.y) - Math.hypot(b2[0] + 0.5 - u.x, b2[1] + 0.5 - u.y));
    const spot = choices[0] || front[0];
    if (!spot) continue;
    const [gx, gy] = spot;
    taken.add(`${gx},${gy}`);
    u.order = { type: "build", buildingId: b.id };
    const sx = Math.floor(u.x), sy = Math.floor(u.y);
    u.path = findPath(sx, sy, gx, gy, cMap) || [];
  }
}
// Backward-compat wrapper
function assignWorkerToBuilding(b) { assignWorkersToBuilding(b, 1); }

// Assign a specific set of workers to a building (respect border tiles)
function assignSpecificWorkersToBuilding(b, workers) {
  if (!Array.isArray(workers) || workers.length === 0) return;
  const cMap = createCollisionMap();
  let front = getFrontBorderTiles(b, cMap);
  if (front.length === 0) {
    front = reachableBorderTiles(Math.floor(b.x), Math.floor(b.y), b.width || 1, b.height || 1, cMap);
  }
  if (front.length === 0) return;
  const taken = new Set();
  for (const u of workers) {
    if (!isWorker(u)) continue;
    const choices = [...front]
      .filter(([x, y]) => !taken.has(`${x},${y}`))
      .sort((a, b2) => Math.hypot(a[0] + 0.5 - u.x, a[1] + 0.5 - u.y) - Math.hypot(b2[0] + 0.5 - u.x, b2[1] + 0.5 - u.y));
    const spot = choices[0] || front[0];
    if (!spot) continue;
    const [gx, gy] = spot;
    taken.add(`${gx},${gy}`);
    u.order = { type: "build", buildingId: b.id };
    const sx = Math.floor(u.x), sy = Math.floor(u.y);
    u.path = findPath(sx, sy, gx, gy, cMap) || [];
  }
}

// Count workers currently stationed around the building perimeter
function countWorkersAtBuilding(b) {
  const cMap = createCollisionMap();
  const front = getFrontBorderTiles(b, cMap);
  if (front.length === 0) return 0;
  const set = new Set(front.map(([x, y]) => `${x},${y}`));
  let n = 0;
  for (const u of playerUnits) {
    if (!isWorker(u)) continue;
    if (!u.order || u.order.type !== "build" || u.order.buildingId !== b.id) continue;
    const ux = Math.floor(u.x), uy = Math.floor(u.y);
    if (set.has(`${ux},${uy}`) || front.some(([fx, fy]) => Math.hypot(fx + 0.5 - u.x, fy + 0.5 - u.y) < 0.51)) {
      n++;
    }
  }
  return n;
}



// 겹친 유닛을 인접 빈칸으로 분산
function separateOverlaps(cMap) {
  const MAX_PER_TILE_PER_TICK = 3;
  const tileToUnits = buildPlayerOccupancy();


  const rangeErrorAt = (u, cx, cy) => {
    if (!u.order || u.order.type !== "attackTarget") return Infinity;
    const def = unitTypes[u.type] || {};
    const rng = def.range ?? u.range ?? 1.5;
    const d = distToTargetFrom(cx + 0.5, cy + 0.5, u.order);
    if (!Number.isFinite(d)) return Infinity;
    return Math.abs(d - rng);
  };

  for (const [key, list] of tileToUnits.entries()) {
    if (list.length < 2) continue;


    const idleGroup = list.filter(u =>
      (!u.path || u.path.length === 0) &&
      isStationaryForSeparation(u) &&
      (u._sepCooldown ?? 0) <= 0
    );
    if (idleGroup.length < 2) continue;


    const scoreOf = (u) => {
      const d = distToTargetFrom(u.x, u.y, u.order);
      return Number.isFinite(d) ? d : 9999 + u.id * 1e-3;
    };
    idleGroup.sort((a, b) => scoreOf(a) - scoreOf(b) || (a.id - b.id));
    const anchor = idleGroup[0];
    const moversAll = idleGroup.slice(1);
    const movers = moversAll.slice(0, MAX_PER_TILE_PER_TICK);
    if (movers.length === 0) continue;


    const [tx, ty] = key.split(",").map(Number);

    let candidates = findEmptyTilesAroundPoint(
      cMap,
      tx,
      ty,
      Math.max(16, movers.length * 4)
    );


    const assigned = new Set();

    for (const u of movers) {
      const ux = Math.floor(u.x), uy = Math.floor(u.y);


      let usable = [];

      if (u.order && u.order.type === "attackTarget") {
        const def = unitTypes[u.type] || {};
        const rng = def.range ?? u.range ?? 1.5;

        for (const [cx, cy] of candidates) {
          const keyC = `${cx},${cy}`;
          if (assigned.has(keyC)) continue;
          if (cx === ux && cy === uy) continue;

          const d = distToTargetFrom(cx + 0.5, cy + 0.5, u.order);
          if (!Number.isFinite(d)) continue;


          if (d < rng * 0.6) continue;

          usable.push([cx, cy, Math.abs(d - rng), d]);
        }


        usable.sort((A, B) => (A[2] - B[2]) || (B[3] - A[3]));
      } else {

        usable = candidates
          .filter(([cx, cy]) => !assigned.has(`${cx},${cy}`) && !(cx === ux && cy === uy))
          .map(([cx, cy]) => [cx, cy, -Math.hypot(cx - tx, cy - ty)]);

        usable.sort((A, B) => A[2] - B[2]);
      }


      let chosen = null;
      for (const c of usable) {
        const [cx, cy] = c;

        const p = findPath(ux, uy, cx, cy, cMap);
        if (p && p.length) {
          chosen = { cx, cy, path: p };
          break;
        }
      }


      if (!chosen) {
        for (const [cx, cy] of candidates) {
          const keyC = `${cx},${cy}`;
          if (assigned.has(keyC)) continue;
          if (cx === ux && cy === uy) continue;
          const p = findPath(ux, uy, cx, cy, cMap);
          if (p && p.length) { chosen = { cx, cy, path: p }; break; }
        }
      }

      if (chosen) {
        assigned.add(`${chosen.cx},${chosen.cy}`);
        u._separating = true;
        u._sepCooldown = 0.6;
        u.path = chosen.path;
      }
    }
  }
}




// 관찰 중인 객체 참조 재바인딩
function rebindInspectedTargetIfNeeded() {
  if (!inspectedTarget || !inspectedTarget.data) return;
  if (inspectedTarget.kind === "building") {
    const tgt = inspectedTarget.data;
    const list = [...playerbuildings, ...enemybuildings];
    const newer = list.find(b => b.id === tgt.id && b.faction === tgt.faction);
    if (newer && newer !== inspectedTarget.data) {
      inspectedTarget.data = newer;
    }
    const current = inspectedTarget?.data;
    if (!current) { inspectedTarget = null; return; }
    if (FOG_ENABLED && current.faction !== myTeam && !isBuildingVisibleToPlayer(current)) {
      inspectedTarget = null;
    }
  } else if (inspectedTarget.kind === "unit") {
    const tgt = inspectedTarget.data;
    const list = [...playerUnits, ...enemyUnits];
    const newer = list.find(u => u.id === tgt.id && u.faction === tgt.faction);
    if (newer && newer !== inspectedTarget.data) {
      inspectedTarget.data = newer;
    }
    const current = inspectedTarget?.data;
    if (!current) { inspectedTarget = null; return; }
    if (FOG_ENABLED && current.faction !== myTeam && !isUnitVisibleToPlayer(current)) {
      inspectedTarget = null;
    }
  }
}



// 초기 유닛 스폰
function pickRandomStartTile() {
  try {
    const s = Array.isArray(mapData?.startPoints) ? mapData.startPoints : [];
    if (s.length === 0) return null;
    const i = Math.floor(Math.random() * s.length);
    const pt = s[i];
    if (Number.isFinite(pt?.x) && Number.isFinite(pt?.y)) return { x: pt.x, y: pt.y };
    return null;
  } catch (_) { return null; }
}

function spawnUnits() {
  let spawnX = null, spawnY = null;
  const pt = serverAssignedSpawn || pickRandomStartTile();
  if (pt) {
    spawnX = pt.x;
    spawnY = (pt.y | 0) - 1; // spawn one tile above the 601 marker
    // clamp to map bounds if available
    try {
      if (mapData) {
        const mw = mapData.width | 0;
        const mh = mapData.height | 0;
        if (!Number.isFinite(spawnX)) spawnX = 0;
        if (!Number.isFinite(spawnY)) spawnY = 0;
        spawnX = Math.max(0, Math.min(spawnX, Math.max(0, mw - 1)));
        spawnY = Math.max(0, Math.min(spawnY, Math.max(0, mh - 1)));
      }
    } catch (_) { }
  }

  // Fallbacks if no start markers present
  if (!Number.isFinite(spawnX) || !Number.isFinite(spawnY)) {
    if (myTeam === "A") { spawnX = 5; spawnY = 5; } else { spawnX = 10; spawnY = 10; }
  }

  // Determine starting worker count
  const baseWorkers = 3;
  const scWorkers = (window.subCommander?.startWorkers) ?? baseWorkers;
  const count = Math.max(1, scWorkers);
  const offsets = [[0, 0], [1, 0], [0, 1], [-1, 0], [1, 1], [-1, 1], [2, 0], [0, 2]];
  const units = [];
  for (let i = 0; i < count; i++) {
    const off = offsets[i] || [0, 0];
    const ux = Math.max(0, Math.min((mapData?.width ?? spawnX) - 1, spawnX + off[0]));
    const uy = Math.max(0, Math.min((mapData?.height ?? spawnY) - 1, spawnY + off[1]));
    const u = createUnit("limestone", ux, uy, myTeam);
    if (u) units.push(u);
  }
  playerUnits = units;
  enemyUnits = [];
  resetFogState({ clearExplored: true });
  updateFogVisibility();
  // Center camera on spawn
  try { centerCameraOnTile(spawnX, spawnY); } catch (_) { }
}


// 메인 루프 시작 및 프레임 처리
function startGame() {
  spawnUnits();
  startGameClock();
  let lastTimestamp = 0;
  let repathTimer = 0;
  let fogTimer = 0;


  // frame 함수 동작을 수행
  function frame(ts) {
    let dt = (ts - lastTimestamp) / 1000;
    if (!lastTimestamp) dt = 0;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    lastTimestamp = ts;
    if (gameClockRunning) {
      gameClockElapsed += dt;
      updateGameTimerDisplay();
    }
    repathTimer += dt;

    ctx.clearRect(0, 0, viewW, viewH);
    for (const u of [...playerUnits, ...enemyUnits]) {
      if (u._attackAnim > 0) {
        u._attackAnim = Math.max(0, u._attackAnim - dt);

        if (!hasAnyTargetInRange(u)) u._attackAnim = 0;
      }
    }
    if (mapData) {
      scrollCamera();
      fogTimer += dt;
      if (fogTimer >= FOG_UPDATE_INTERVAL) {
        updateFogVisibility();
        fogTimer = 0;
      }
      drawIsoMap();
    }

    const cMap = createCollisionMap();
    separateOverlaps(cMap);

    // process construction/upgrade/production for my team
    const MINE_PERIOD = 2.0; // seconds
    for (const b of playerbuildings) {
      // advance construction timers (multi-worker speedup with sqrt diminishing returns)
      if (b.constructing) {
        const builders = b.requiresBuilder ? countWorkersAtBuilding(b) : 1;
        if (builders > 0) {
          // Effective speed = sqrt(n). 1 worker => 1x, 4 workers => 2x, etc.
          const eff = Math.sqrt(builders);
          b.buildRemaining = Math.max(0, (b.buildRemaining || 0) - dt * eff);
          if (b.buildRemaining <= 0) {
            b.constructing = false;
            // clear builders' working state targeting this building
            for (const u of playerUnits) {
              if (u.order && u.order.type === "build" && u.order.buildingId === b.id) {
                u.order = null;
                u._isWorking = false;
                u._workingBuildingId = null;
              }
            }
          }
        }
      }

      // advance upgrading timers
      if (b.upgrading) {
        b.upgradeRemaining = Math.max(0, (b.upgradeRemaining || 0) - dt);
        if (b.upgradeRemaining <= 0) {
          const upType = b.upgradeTarget;
          const def = upType ? (buildingTypes[upType] || {}) : null;
          if (upType && def) {
            b.upgrading = false;
            b.upgradeTarget = null;
            // switch to upgraded type
            b.type = upType;
            // adopt footprint if not explicitly set
            b.width = b.width ?? (def.footprint?.w ?? 1);
            b.height = b.height ?? (def.footprint?.h ?? 1);
            // rebind UI and sync
            renderBuildingPanel?.();
            renderUnitPanel?.();
            socket.emit("BuildplayerBuilding", { buildings: playerbuildings.filter(x => x.faction === myTeam), room: roomId });
          } else {
            // fail-safe: cancel upgrade state
            b.upgrading = false;
            b.upgradeTarget = null;
          }
        }
      }

      // process unit training queue if any (skip while constructing)
      if (!b.constructing && !b.upgrading && Array.isArray(b._prodQueue) && b._prodQueue.length > 0) {
        const head = b._prodQueue[0];
        const trainMult = (window.subCommander?.trainSpeedMult) ?? 1.0;
        head.remaining = Math.max(0, (head.remaining || 0) - dt * trainMult);
        if (head.remaining <= 0) {
          // try spawn; if no space, keep retrying next frame without popping
          const ok = trySpawnUnitAtBuilding(b, head.type);
          if (ok) {
            b._prodQueue.shift();
          } else {
            // small backoff to avoid tight loop
            head.remaining = 0.25;
          }
        }
      }

      if (!ALL_MINE_TYPES.has(b.type)) continue;
      if (b.constructing || b.upgrading) continue; // mines only produce after construction/upgrade
      b._prodCd = (b._prodCd || 0) + dt;
      if (b._prodCd >= MINE_PERIOD) {
        b._prodCd -= MINE_PERIOD;
        const res = (b._resX != null && b._resY != null)
          ? mapData.resources.find(r => Math.floor(r.x) === b._resX && Math.floor(r.y) === b._resY)
          : findResourceAtTile(Math.floor(b.x), Math.floor(b.y) + 1); // ← 규약 유지 fallback
        if (res && (res.amount | 0) > 0) {
          const yieldAmt = getMineYieldFor(b, res.id);
          const take = Math.min(yieldAmt, res.amount | 0);
          res.amount = (res.amount | 0) - take;
          try {
            socket.emit("resourceUpdate", {
              room: roomId,
              x: Math.floor(res.x),
              y: Math.floor(res.y),
              id: res.id,
              amount: Math.max(0, res.amount | 0),
            });
          } catch (_) { }
          playerRes[res.id] = (playerRes[res.id] | 0) + take;
        }
      }
    }


    for (let unit of playerUnits) {
      if (unit._sepCooldown > 0) unit._sepCooldown = Math.max(0, unit._sepCooldown - dt);

      if ((!unit.order || (unit.order.type !== "attackTarget" && unit.order.type !== "build")) && (!unit.path || unit.path.length === 0)) {
        tryAutoAggroWhenIdle(unit, cMap);
      }
      if (unit.order && unit.order.type === "attackTarget") {
        const tgt = findTargetByOrder(unit.order);
        if (tgt) {
          const vx = (unit.order.target.kind === "building")
            ? ((Math.max(tgt.x, unit.x) + Math.min(tgt.x + (tgt.width || 1), unit.x)) / 2 - unit.x)
            : (tgt.x - unit.x);
          const vy = (unit.order.target.kind === "building")
            ? ((Math.max(tgt.y, unit.y) + Math.min(tgt.y + (tgt.height || 1), unit.y)) / 2 - unit.y)
            : (tgt.y - unit.y);
          const dirScreen = vx - vy;
          if (Math.abs(dirScreen) > 1e-3) {
            unit.facing = dirScreen < 0 ? -1 : 1;
          }
          const def = unitTypes[unit.type] || {};
          const rng = def.range ?? unit.range ?? 1.5;

          const ux = unit.x, uy = unit.y;
          const distTile = (unit.order?.target?.kind === "building")
            ? distPointToBuilding(ux, uy, tgt)
            : Math.hypot(tgt.x - ux, tgt.y - uy);

          if (distTile <= rng) {
            unit.path = [];
            unit._cd -= dt;
            const period = (def.period ?? unit.period ?? 1.0);
            if (unit._cd <= 0) {
              unit._cd = period;
              unit._attackAnim = Math.min(0.45, period * 0.7);
            }
          } else {
            if (unit.path.length === 0 || repathTimer >= 0.25) {
              const fw = tgt.width || 1, fh = tgt.height || 1;
              const [gx, gy] = nearestReachableAround(Math.floor(tgt.x), Math.floor(tgt.y), fw, fh, cMap, Math.floor(unit.x), Math.floor(unit.y));
              const p = findPath(Math.floor(unit.x), Math.floor(unit.y), gx, gy, cMap);
              if (p) unit.path = p;
              repathTimer = 0;
            }
          }
        } else {

          unit._cd = 0;
          unit._attackAnim = 0;


          if (unit._resumeOrder && unit._resumeOrder.type === "attackMove") {
            unit.order = unit._resumeOrder;
            unit._resumeOrder = null;
            const sx = Math.floor(unit.x), sy = Math.floor(unit.y);
            const gx = Math.floor(unit.order.tx), gy = Math.floor(unit.order.ty);
            unit.path = findPath(sx, sy, gx, gy, cMap) || [];
          } else {
            unit.order = null;
          }
        }
      }
      // Build order: move to building front and work
      if (unit.order && unit.order.type === "build") {
        const b = playerbuildings.find(bb => bb.id === unit.order.buildingId && bb.faction === myTeam);
        if (!b || !b.constructing) {
          unit._isWorking = false;
          unit._workingBuildingId = null;
          unit.order = null;
        } else {
          // Face towards building center
          const vx = (b.x + (b.width || 1) / 2) - unit.x;
          const vy = (b.y + (b.height || 1) / 2) - unit.y;
          const dirScreen = vx - vy;
          if (Math.abs(dirScreen) > 1e-3) unit.facing = dirScreen < 0 ? -1 : 1;

          const cMap2 = createCollisionMap();
          const front = getFrontBorderTiles(b, cMap2);
          const footprintW = b.width || 1;
          const footprintH = b.height || 1;
          let approachTiles = front;
          if (!approachTiles || approachTiles.length === 0) {
            approachTiles = reachableBorderTiles(Math.floor(b.x), Math.floor(b.y), footprintW, footprintH, cMap2);
          }
          if (!Array.isArray(approachTiles)) approachTiles = [];
          // Check if we are standing on a valid work tile (front or fallback border)
          const atFront = approachTiles.some(([fx, fy]) => Math.hypot(fx + 0.5 - unit.x, fy + 0.5 - unit.y) < 0.51);
          if (atFront) {
            unit.path = [];
            unit._isWorking = true;
            unit._workingBuildingId = b.id;
          } else {
            unit._isWorking = false;
            unit._workingBuildingId = null;
            if (unit.path.length === 0 || repathTimer >= 0.25) {
              // Choose nearest valid approach tile (front or fallback border)
              const candidates = approachTiles.length ? [...approachTiles] : [[Math.floor(b.x), Math.floor(b.y) + footprintH]];
              candidates.sort((a, b2) => Math.hypot(a[0] + 0.5 - unit.x, a[1] + 0.5 - unit.y) - Math.hypot(b2[0] + 0.5 - unit.x, b2[1] + 0.5 - unit.y));
              const [gx, gy] = candidates[0];
              const p = findPath(Math.floor(unit.x), Math.floor(unit.y), gx, gy, cMap2);
              if (p) unit.path = p;
              repathTimer = 0;
            }
          }
        }
      }
      if (unit.order && unit.order.type === "attackMove") {
        const def = unitTypes[unit.type] || {};
        const atkRange = def.range ?? unit.range ?? 1.5;

        const aggroRange = Math.max(atkRange + 0.5, 2.5);
        const seen = findBestTargetWithin(unit, aggroRange);

        if (seen) {
          const t = seen.data;
          const tKind = seen.kind;
          const tTeam = t.faction;
          if (!unit._resumeOrder && Number.isFinite(unit.order?.tx) && Number.isFinite(unit.order?.ty)) {
            unit._resumeOrder = { type: "attackMove", tx: unit.order.tx, ty: unit.order.ty };
          }
          unit.order = { type: "attackTarget", target: { kind: tKind, team: tTeam, id: t.id } };
          if (seen.dist > atkRange) {
            const fw = tKind === "building" ? (t.width || 2) : 1;
            const fh = tKind === "building" ? (t.height || 2) : 1;
            const [gx, gy] = nearestReachableAround(Math.floor(t.x), Math.floor(t.y), fw, fh, cMap, Math.floor(unit.x), Math.floor(unit.y));
            unit.path = findPath(Math.floor(unit.x), Math.floor(unit.y), gx, gy, cMap) || [];
          } else {
            unit.path = [];
          }
        } else {

          if (!unit._separating && (!unit.path || unit.path.length === 0)) {
            const dx = unit.order.tx + 0.5 - unit.x;
            const dy = unit.order.ty + 0.5 - unit.y;
            if (Math.hypot(dx, dy) < 0.51) {
              unit.order = null;
            }
          }
        }
      }


      if (unit.path && unit.path.length > 0) {
        const [tx, ty] = unit.path[0];
        const dx = tx + 0.5 - unit.x;
        const dy = ty + 0.5 - unit.y;
        const dist = Math.hypot(dx, dy);
        const def = unitTypes[unit.type] || {};
        const baseSpeed = def.speed ?? 3;
        const moveMult = (window.subCommander?.moveSpeedMult) ?? 1.0;
        const speed = baseSpeed * moveMult;
        const dirScreen = dx - dy;
        if (Math.abs(dirScreen) > 1e-3) {
          unit.facing = dirScreen < 0 ? -1 : 1;
        }
        if (!Number.isFinite(speed) || speed <= 0) continue;
        const step = speed * dt;
        if (dist < step) {
          unit.x = tx + 0.5;
          unit.y = ty + 0.5;
          unit.path.shift();

          if (unit.path.length === 0 && unit._separating) {
            unit._separating = false;
          }
        } else {
          unit.x += (dx / dist) * step;
          unit.y += (dy / dist) * step;
        }
      }
      const movingNow = unit.path && unit.path.length > 0;
      if (movingNow) {
        unit._walkTimer += dt;
        if (unit._walkTimer >= 0.2) {
          unit._walkTimer -= 0.2;
          unit._walkToggle = !unit._walkToggle;
        }
      } else {

        unit._walkTimer = 0;
        unit._walkToggle = false;
      }
      // Working animation toggle (independent of walking)
      if (unit._isWorking) {
        unit._workTimer += dt;
        if (unit._workTimer >= 0.25) {
          unit._workTimer -= 0.25;
          unit._workToggle = !unit._workToggle;
        }
      } else {
        unit._workTimer = 0;
        unit._workToggle = false;
      }
    }

    networkTick();

    const drawables = [];
    const fogActive = FOG_ENABLED && fogState;
    // 5xx obstacles first (so units/buildings draw over them properly)
    for (const o of (mapData.obstacles || [])) {
      drawables.push({
        kind: "obstacle",
        x: o.x,
        y: o.y,
        z: Math.floor(o.x) + Math.floor(o.y) - 1,
        data: o,
      });
    }
    for (const r of (mapData.resources || [])) {
      if ((r.amount | 0) > 0) {
        if (fogActive && !isTileExplored(Math.floor(r.x), Math.floor(r.y))) continue;
        drawables.push({
          kind: "resource",
          x: r.x,
          y: r.y,
          z: Math.floor(r.x) + Math.floor(r.y) - 1,
          data: r
        });
      }
    }
    for (const b of playerbuildings) drawables.push({ kind: "building", faction: b.faction, x: b.x, y: b.y, z: b.x + b.y, data: b });
    for (const b of enemybuildings) {
      if (fogActive && !isBuildingVisibleToPlayer(b)) continue;
      drawables.push({ kind: "building", faction: b.faction, x: b.x, y: b.y, z: b.x + b.y, data: b });
    }
    for (const u of playerUnits) drawables.push({ kind: "unit", faction: u.faction, x: u.x, y: u.y, z: Math.floor(u.x) + Math.floor(u.y) + 0.001, data: u });
    for (const u of enemyUnits) {
      if (fogActive && !isUnitVisibleToPlayer(u)) continue;
      drawables.push({ kind: "unit", faction: u.faction, x: u.x, y: u.y, z: Math.floor(u.x) + Math.floor(u.y) + 0.001, data: u });
    }

    drawables.sort((a, b) => a.z - b.z);

    for (const d of drawables) {
      if (!mapData) continue;
      if (d.kind === "unit") {
        drawIsoUnit(d.data);
      } else if (d.kind === "building") {
        const b = d.data;
        const def = buildingTypes[b.type];
        const img = buildingImages[b.type];
        const { tileWidth, tileHeight } = mapData;
        const screenX = snap((b.x - b.y) * tileWidth / 2 - cameraX + viewW / 2);
        const screenY = snap((b.x + b.y) * tileHeight / 2 - cameraY);
        const scaleTiles = def?.imageScaleTiles ?? b.width;
        const targetWidth = tileWidth * scaleTiles;
        const aspectRatio = img?.naturalWidth ? img.naturalHeight / img.naturalWidth : 1;
        const targetHeight = targetWidth * aspectRatio;
        const yOffsetTiles = def?.imageYOffsetTiles ?? 1.5;
        const xOffsetTiles = def?.imageXOffsetTiles ?? 0;

        if (img && img.complete && img.naturalWidth > 0) {
          ctx.save();
          if (b.constructing) ctx.globalAlpha = 0.5;
          ctx.drawImage(
            img,
            screenX - targetWidth / 2 + tileHeight * xOffsetTiles,
            screenY - targetHeight + tileHeight / 2 + tileHeight * yOffsetTiles,
            targetWidth,
            targetHeight
          );
          ctx.restore();
        } else {
          ctx.save();
          ctx.globalAlpha = 0.6;
          ctx.fillStyle = b.faction === enemyTeam ? "#a33" : "#3a3";
          for (let dy = 0; dy < b.height; dy++) {
            for (let dx = 0; dx < b.width; dx++) {
              const tx = b.x + dx;
              const ty = b.y + dy;
              const sx = (tx - ty) * tileWidth / 2 - cameraX + viewW / 2;
              const sy = (tx + ty) * tileHeight / 2 - cameraY;
              drawDiamondTile(sx - tileWidth * 0.5, sy, tileWidth, tileHeight, ctx.fillStyle);
            }
          }
          ctx.restore();
        }

        if (b.faction === myTeam && b.id != null && b.id === selectedBuildingId) {
          ctx.save();
          ctx.strokeStyle = "yellow";
          ctx.lineWidth = 2;
          // Draw a single large diamond around the whole footprint
          const leftTileX = b.x;
          const leftTileY = b.y + (b.height - 1);
          const rightTileX = b.x + (b.width - 1);
          const rightTileY = b.y;
          const topTileX = b.x;
          const topTileY = b.y;
          const bottomTileX = b.x + (b.width - 1);
          const bottomTileY = b.y + (b.height - 1);

          const [lx, ly] = worldToScreen(leftTileX, leftTileY);
          const [rx, ry] = worldToScreen(rightTileX, rightTileY);
          const [tx1, ty1] = worldToScreen(topTileX, topTileY);
          const [bx1, by1] = worldToScreen(bottomTileX, bottomTileY);

          const leftPtX = lx - tileWidth / 2;
          const leftPtY = ly + tileHeight / 2;
          const topPtX = tx1;
          const topPtY = ty1;
          const rightPtX = rx + tileWidth / 2;
          const rightPtY = ry + tileHeight / 2;
          const bottomPtX = bx1;
          const bottomPtY = by1 + tileHeight;

          ctx.beginPath();
          ctx.moveTo(leftPtX, leftPtY);
          ctx.lineTo(topPtX, topPtY);
          ctx.lineTo(rightPtX, rightPtY);
          ctx.lineTo(bottomPtX, bottomPtY);
          ctx.closePath();
          ctx.stroke();
          ctx.restore();
        }

        ensureBuildingRallyPointField(b);
        const isSelectedBuilding = b.id != null && b.id === selectedBuildingId;
        if (isSelectedBuilding && b.faction === myTeam && b.rallyPoint) {
          const rallyTileX = Math.floor(b.rallyPoint.x);
          const rallyTileY = Math.floor(b.rallyPoint.y);
          const rallyScreenX = snap((rallyTileX - rallyTileY) * tileWidth / 2 - cameraX + viewW / 2);
          const rallyScreenY = snap((rallyTileX + rallyTileY) * tileHeight / 2 - cameraY);
          const diamondX = rallyScreenX - tileWidth / 2;
          const diamondY = rallyScreenY;
          ctx.save();
          ctx.globalAlpha = 0.45;
          drawDiamondTile(diamondX, diamondY, tileWidth, tileHeight, 'rgba(250, 204, 21, 0.35)');
          ctx.globalAlpha = 1;
          ctx.strokeStyle = '#facc15';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(diamondX, diamondY + tileHeight / 2);
          ctx.lineTo(diamondX + tileWidth / 2, diamondY);
          ctx.lineTo(diamondX + tileWidth, diamondY + tileHeight / 2);
          ctx.lineTo(diamondX + tileWidth / 2, diamondY + tileHeight);
          ctx.closePath();
          ctx.stroke();
          const centerWorldX = b.x + (b.width || 1) / 2;
          const centerWorldY = b.y + (b.height || 1) / 2;
          const centerScreenX = snap((centerWorldX - centerWorldY) * tileWidth / 2 - cameraX + viewW / 2);
          const centerScreenY = snap((centerWorldX + centerWorldY) * tileHeight / 2 - cameraY + tileHeight / 2);
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(centerScreenX, centerScreenY);
          ctx.lineTo(rallyScreenX, rallyScreenY + tileHeight / 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }

        // Construction progress overlay bar
        if (b.constructing) {
          ctx.save();
          const barW = 60, barH = 6;
          const bx1 = screenX - barW / 2;
          const by1 = screenY + 12;
          ctx.fillStyle = "rgba(0,0,0,0.5)";
          ctx.fillRect(bx1 - 1, by1 - 1, barW + 2, barH + 2);
          const total = b.buildTime || 1;
          const remain = Math.max(0, b.buildRemaining || 0);
          const ratio = Math.max(0, Math.min(1, 1 - remain / total));
          ctx.fillStyle = "#22c55e";
          ctx.fillRect(bx1, by1, Math.floor(barW * ratio), barH);
          ctx.fillStyle = "#fff";
          ctx.font = "12px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(`${Math.ceil(remain)}s`, screenX, by1 - 4);
          ctx.restore();
        }

        // Upgrade progress overlay bar
        if (b.upgrading) {
          ctx.save();
          const barW = 60, barH = 6;
          const bx1 = screenX - barW / 2;
          const by1 = screenY + 22;
          ctx.fillStyle = "rgba(0,0,0,0.5)";
          ctx.fillRect(bx1 - 1, by1 - 1, barW + 2, barH + 2);
          const total = b.upgradeRemaining + 0.0001; // will be updated only via ratio calc below
          // We don't store total separately; approximate using target def time if available
          let baseTotal = 5;
          try {
            const t = buildingTypes[b.upgradeTarget] || {};
            baseTotal = Math.max(0.01, (t.upgradeTime ?? t.buildTime ?? 5));
          } catch (e) { }
          const remain = Math.max(0, b.upgradeRemaining || 0);
          const ratio = Math.max(0, Math.min(1, 1 - remain / baseTotal));
          ctx.fillStyle = "#3b82f6"; // blue
          ctx.fillRect(bx1, by1, Math.floor(barW * ratio), barH);
          ctx.fillStyle = "#fff";
          ctx.font = "12px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(`${Math.ceil(remain)}s`, screenX, by1 - 4);
          ctx.restore();
        }
      } else if (d.kind === "resource") {
        drawIsoResource(d.data);
      } else if (d.kind === "obstacle") {
        drawIsoObstacle(d.data);
      }
    }

    if (FOG_ENABLED && fogOverlays.length) {
      for (const fog of fogOverlays) {
        drawDiamondTile(fog.x, fog.y, fog.w, fog.h, fog.color);
      }
    }

    if (isDragging && dragStart && dragEnd) {
      ctx.strokeStyle = "rgba(255, 0, 0, 1)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 2]);
      ctx.strokeRect(dragStart.x, dragStart.y, dragEnd.x - dragStart.x, dragEnd.y - dragStart.y);
      ctx.setLineDash([]);
    }

    if (buildMode && window.previewBuilding) {
      const { x, y, width: wFoot, height: hFoot, type, valid } = window.previewBuilding;
      const def = buildingTypes[type];
      const img = buildingImages[type];
      const { tileWidth, tileHeight } = mapData;
      const [screenX, screenY] = worldToScreen(x, y);

      const scaleTiles = def?.imageScaleTiles ?? wFoot;
      const targetWidth = tileWidth * scaleTiles;
      const aspectRatio = img?.naturalWidth ? img.naturalHeight / img.naturalWidth : 1;
      const targetHeight = targetWidth * aspectRatio;
      const yOffsetTiles = def?.imageYOffsetTiles ?? 1.5;
      const xOffsetTiles = def?.imageXOffsetTiles ?? 0;

      ctx.save();
      ctx.globalAlpha = 0.6;
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(
          img,
          screenX - targetWidth / 2 + tileHeight * xOffsetTiles,
          screenY - targetHeight + tileHeight / 2 + tileHeight * yOffsetTiles,
          targetWidth,
          targetHeight
        );
      }
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = valid ? "lime" : "red";
      for (let dy = 0; dy < hFoot; dy++) {
        for (let dx = 0; dx < wFoot; dx++) {
          const tx = x + dx;
          const ty = y + dy;
          const sx = (tx - ty) * tileWidth / 2 - cameraX + viewW / 2;
          const sy = (tx + ty) * tileHeight / 2 - cameraY;
          drawDiamondTile(sx - tileWidth * 0.5, sy, tileWidth, tileHeight, ctx.fillStyle);
        }
      }
      ctx.restore();
    }
    renderMinimap();
    renderUnitPanel();
    updateResourceUI();
    // Keep production buttons' affordability up to date while selected
    const selB = getSelectedBuilding?.();
    if (selB) configureProductionButtons(selB.type);
    // Re-render building panel to refresh queue/construct UI
    renderBuildingPanel?.();
    // Also keep build buttons (including mine) updated with dynamic costs
    refreshBuildButtons?.();
    updateCanvasCursor();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}


(async function init() {
  await loadGameData();

  fetch("/maps/map_iso.json")
    .then((res) => res.json())
    .then((json) => {

      if (Array.isArray(json.tiles) && typeof json.tiles[0] === "number") {
        const a = new Array(json.height);
        for (let r = 0; r < json.height; r++) {
          a[r] = json.tiles.slice(r * json.width, (r + 1) * json.width);
        }
        json.tiles = a;
      }


      if (!Array.isArray(json.resourceAmt)) {
        json.resourceAmt = Array.from({ length: json.height }, () =>
          Array(json.width).fill(0)
        );
      }
      const ids = new Set();
      for (const row of json.tiles) for (const id of row) ids.add(id);


      const tileset = {};
      const images = {};
      ids.forEach((id) => {
        tileset[String(id)] = TILE_ID_TO_COLOR[id] || "#000";
        images[String(id)] = imageSrcForTileId(id);
      });


      const resources = [];
      const obstacles = [];
      const startPoints = [];
      for (let y = 0; y < json.height; y++) {
        for (let x = 0; x < json.width; x++) {
          const tid = json.tiles[y][x];
          const amt = (json.resourceAmt?.[y]?.[x]) | 0;
          // 601: starting point markers
          if (tid === 601) {
            startPoints.push({ x, y });
            // replace with base ground so it doesn't render as a special tile
            json.tiles[y][x] = 100;
          } else if (isResourceId(tid)) {
            resources.push({ id: tid, x, y, amount: Math.max(amt, 1) });
            json.tiles[y][x] = 100;
          } else if (isObstacleId(tid)) {
            obstacles.push({ id: tid, x, y });
            json.tiles[y][x] = 100; // show base ground under obstacle
          } else if (amt > 0) {

            resources.push({ id: 401, x, y, amount: amt });
          }
        }
      }


      mapData = { ...json, tileset, images, resourceAmt: json.resourceAmt, resources, obstacles, startPoints };
      initFogState(mapData.width | 0, mapData.height | 0);
      resetFogState({ clearExplored: true });


      primeResourceImagesOnce();
      primeObstacleImagesOnce();
    });

})();


function isTypingIntoField() {
  try {
    const el = document.activeElement;
    if (!el) return false;
    const tag = (el.tagName || "").toUpperCase();
    return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
  } catch (_) {
    return false;
  }
}

// Hotkeys for building production buttons
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (!bp || !bp.panel || bp.panel.classList.contains("hidden")) return;
  if (isTypingIntoField()) return;
  const key = (e.key || "").toLowerCase();
  if (!key) return;
  const buttons = [addUnitBtn1, addUnitBtn2];
  for (const btn of buttons) {
    if (!btn || typeof btn.click !== "function") continue;
    const hk = (btn.dataset?.hotkey || "").toLowerCase();
    if (!hk || hk !== key) continue;
    if (btn.disabled) continue;
    if (btn.classList?.contains("hidden")) continue;
    e.preventDefault();
    btn.click();
    break;
  }
});
// 1-5 hotkeys for build menu (left-to-right)
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  try {
    if (!build || !build.panel) return;
    const visible = !build.panel.classList.contains("hidden");
    if (!visible) return;
    const map = { 'q': addBuildingBtn1, 'w': addBuildingBtn2, 'e': addBuildingBtn3, 'r': addBuildingBtn4, 't': addBuildingBtn5 };
    const k = (e.key || "").toLowerCase();
    const btn = map[k];
    if (btn && typeof btn.click === "function") {
      e.preventDefault();
      btn.click();
    }
  } catch (_) { }
});









