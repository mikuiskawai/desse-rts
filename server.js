"use strict";

/* =========================================================================
 * 서버/의존성 초기화
 * ========================================================================= */
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const TICK_HZ = 10;
const TICK_MS = Math.floor(1000 / TICK_HZ);

/* =========================================================================
 * 게임 상태(매치/룸)
 * ========================================================================= */
const rooms = {};            // { [roomId]: { players: [socketId, ...], teams: { [socketId]: 'A'|'B' }, state, lastTick } }
let waitingPlayer = null;    // 매칭 대기열 1인 버퍼

/* =========================================================================
 * 데이터 로딩: 유닛/건물 정의
 * ========================================================================= */
let UNIT_DEFS = {};
try {
  const unitsPath = path.join(__dirname, "public", "data", "units.json");
  const arr = JSON.parse(fs.readFileSync(unitsPath, "utf-8"));
  for (const u of arr) {
    UNIT_DEFS[u.type] = {
      hp: u.hp ?? 1,
      atk: u.atk ?? 1,
      armor: u.armor ?? 0,
      range: u.range ?? 1.5,
      period: u.period ?? 1.0,
      speed: u.speed ?? 3,
      attackType: u.attackType || 'n',
    };
  }
  console.log("✅ unit defs:", Object.keys(UNIT_DEFS).length);
} catch (e) {
  console.error("⚠️ units.json load failed.", e);
}

let BUILDING_DEFS = {};
try {
  const bPath = path.join(__dirname, "public", "data", "buildings.json");
  const arr = JSON.parse(fs.readFileSync(bPath, "utf-8"));
  for (const b of arr) {
    BUILDING_DEFS[b.type] = {
      hp: b.hp ?? 100,
      armor: b.armor ?? 0,
      footprint: b.footprint || { w: 1, h: 1 },
    };
  }
  console.log("✅ building defs:", Object.keys(BUILDING_DEFS).length);
} catch (e) {
  console.error("⚠️ buildings.json load failed.", e);
}

/* =========================================================================
 * 유틸리티
 * ========================================================================= */
// 방 상태가 없으면 초기 스키마 생성 (neutral 포함)
function ensureRoomState(roomId) {
  const room = rooms[roomId];
  if (!room.state) {
    room.state = {
      units: { A: {}, B: {}, neutral: {} },
      buildings: { A: {}, B: {}, neutral: {} },
      tombstones: {
        units: { A: new Set(), B: new Set(), neutral: new Set() },
        buildings: { A: new Set(), B: new Set(), neutral: new Set() },
      },
    };
  }
  if (!room.lastTick) room.lastTick = Date.now();
}

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}
function n(v, fallback) {
  const nv = Number(v);
  return Number.isFinite(nv) ? nv : fallback;
}
function getRoomForSocket(socket) {
  for (const [roomId, r] of Object.entries(rooms)) {
    if (r.players.includes(socket.id)) {
      return { room: r, roomId, team: r.teams[socket.id] };
    }
  }
  return { room: null, roomId: null, team: null };
}

// === 타깃 해석/피해 유틸 ===
function normalizeTeamKey(t) { return (t === "A" || t === "B") ? t : "neutral"; }
function resolveTarget(state, target) {
  if (!target || !target.kind || target.id == null) return null;
  const teamKey = normalizeTeamKey(target.team);
  const bucket = target.kind === "unit" ? state.units : state.buildings;
  return bucket?.[teamKey]?.[target.id] || null;
}
// Unit tier classification for damage type scaling
function getUnitTier(type) {
  switch (type) {
    // Tier 1
    case 'limestone':
      return 1;
    // Tier 2
    case 'boltaction':
    case 'shotgun':
    case 'uzi':
      return 2;
    // Tier 3
    case 'quartz':
    case 'rpg':
    case 'derringer':
    case 'niter':
    case 'martensite':
    case 'flamethrower':
      return 3;
    // Heroic / Epic
    case 'epic_unit':
      return 99;
    default:
      return 1;
  }
}

function damageMultiplier(attackType, target, kind) {
  // n: normal 100% to everything
  if (attackType === 'n' || !attackType) return 1.0;
  if (attackType === 't') {
    // 철거 특화형: 건물 100%, 유닛 50%
    return kind === 'building' ? 1.0 : 0.5;
  }
  if (kind === 'unit') {
    const tier = getUnitTier(target.type);
    if (attackType === 'r') {
      // 방사형: 1티어 100%, 2티어 75%, 3티어 50%, 영웅 25%
      if (tier === 1) return 1.0;
      if (tier === 2) return 0.75;
      if (tier === 3) return 0.5;
      if (tier === 99) return 0.25;
      return 1.0;
    }
    if (attackType === 'p') {
      // 집중형: 1티어 50%, 2티어 75%, 3티어/영웅 100%
      if (tier === 1) return 0.5;
      if (tier === 2) return 0.75;
      if (tier === 3 || tier === 99) return 1.0;
      return 1.0;
    }
  }
  // Default fallback
  return 1.0;
}

function applyDamage(attacker, target, kind) {
  const specA = UNIT_DEFS[attacker.type] || {};
  const atk = specA.atk ?? 1;
  const cd = specA.period ?? 1.0;
  const armor = kind === "unit"
    ? (UNIT_DEFS[target.type]?.armor ?? 0)
    : (BUILDING_DEFS[target.type]?.armor ?? 0);
  let dmg = Math.max(1, atk - armor);
  const mult = damageMultiplier(specA.attackType, target, kind);
  dmg = Math.max(1, Math.floor(dmg * mult));
  target.hp = Math.max(0, (target.hp ?? 1) - dmg);
  attacker.cd = cd;
}

function distPointToBuilding(px, py, b) {
  const left = (b.x ?? 0);
  const right = left + (b.width ?? 1);
  const top = (b.y ?? 0);
  const bottom = top + (b.height ?? 1);
  const dx = (px < left) ? (left - px) : (px > right ? (px - right) : 0);
  const dy = (py < top) ? (top - py) : (py > bottom ? (py - bottom) : 0);
  return Math.hypot(dx, dy);
}

/* =========================================================================
 * 서버 틱(전투/피해 처리)
 * ========================================================================= */
function serverTick(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  ensureRoomState(roomId);

  const now = Date.now();
  const dt = Math.max(0, (now - room.lastTick) / 1000);
  room.lastTick = now;

  // 쿨다운 감소 + didAttack 초기화
  for (const team of ["A", "B"]) {
    for (const u of Object.values(room.state.units[team])) {
      u.cd = Math.max(0, (u.cd ?? 0) - dt);
      u.didAttack = false;
    }
  }

  // 1) "오더 우선" 처리 : attackTarget 에 한해 즉시 공격
  for (const team of ["A", "B"]) {
    for (const u of Object.values(room.state.units[team])) {
      if ((u.hp ?? 1) <= 0) continue;
      if ((u.cd ?? 0) > 0) continue;

      const ord = u.order;
      if (!ord || ord.type !== "attackTarget" || !ord.target) continue;

      const tgt = resolveTarget(room.state, ord.target);
      if (!tgt || (tgt.hp ?? 1) <= 0) { u.order = null; continue; }

      const spec = UNIT_DEFS[u.type] || {};
      const rng = spec.range ?? 1.5;

      const inRange = (ord.target.kind === "building")
        ? (distPointToBuilding(u.x, u.y, tgt) <= rng)
        : (dist(u.x, u.y, tgt.x, tgt.y) <= rng);
      if (inRange) {
        applyDamage(u, tgt, ord.target.kind);
        u.didAttack = true;

        const teamKey = normalizeTeamKey(tgt.team);
        // If target died, remember its id as a tombstone to prevent resurrection via snapshots
        if ((tgt.hp ?? 0) <= 0) {
          if (ord.target.kind === "building") {
            rooms[roomId].state.tombstones.buildings[teamKey].add(Number(tgt.id));
          } else {
            rooms[roomId].state.tombstones.units[teamKey].add(Number(tgt.id));
          }
        }
        if (ord.target.kind === "building") {
          io.to(roomId).emit("combatUpdate", {
            buildingUpdates: [{ team: teamKey, id: tgt.id, hp: tgt.hp, dead: tgt.hp <= 0 }]
          });
        } else {
          io.to(roomId).emit("combatUpdate", {
            updates: [{ team: teamKey, id: tgt.id, hp: tgt.hp, dead: tgt.hp <= 0 }]
          });
        }
      }

    }
  }

  // 2) 자동 교전(유닛 → 적 A/B 간만; neutral 은 자동 타격 X, 오더로만 공격)
  function stepCombat(attackerTeam, defenderTeam) {
    const attackers = room.state.units[attackerTeam];
    const defUnits = room.state.units[defenderTeam];
    const defBlds = room.state.buildings[defenderTeam];

    for (const atk of Object.values(attackers)) {
      if ((atk.hp ?? 1) <= 0) continue;
      if (atk.didAttack) continue;        // 오더로 이미 공격한 유닛은 스킵
      if ((atk.cd ?? 0) > 0) continue;

      const spec = UNIT_DEFS[atk.type] || {};
      const rng = spec.range ?? 1.5;

      let best = null;
      let bestD = Infinity;
      let bestKind = null; // 'unit' | 'building'

      // 가장 가까운 적 유닛
      for (const tgt of Object.values(defUnits)) {
        if ((tgt.hp ?? 1) <= 0 ) continue;
        const d = dist(atk.x, atk.y, tgt.x, tgt.y);
        if (d < bestD) { bestD = d; best = tgt; bestKind = "unit"; }
      }
      // 가장 가까운 적 건물(중심좌표)
      for (const b of Object.values(defBlds)) {
        if ((b.hp ?? 1) <= 0) continue;
        const d = distPointToBuilding(atk.x, atk.y, b);
        if (d < bestD) { bestD = d; best = b; bestKind = "building"; }
      }

      if (!best) continue;
      if (bestD <= rng) {
        applyDamage(atk, best, bestKind);

        const teamKey = normalizeTeamKey(best.team);
        if ((best.hp ?? 0) <= 0) {
          if (bestKind === "building") {
            rooms[roomId].state.tombstones.buildings[teamKey].add(Number(best.id));
          } else {
            rooms[roomId].state.tombstones.units[teamKey].add(Number(best.id));
          }
        }
        if (bestKind === "building") {
          io.to(roomId).emit("combatUpdate", {
            buildingUpdates: [{ team: teamKey, id: best.id, hp: best.hp, dead: best.hp <= 0 }]
          });
        } else {
          io.to(roomId).emit("combatUpdate", {
            updates: [{ team: teamKey, id: best.id, hp: best.hp, dead: best.hp <= 0 }]
          });
        }
      }

    }
  }

  stepCombat("A", "B");
  stepCombat("B", "A");

  // 3) 클라이언트 동기화용 업데이트 리스트 (A/B/neutral 모두 포함)
  const teamsForSync = ["A", "B", "neutral"];
  const unitUpdates = [];
  const buildingUpdates = [];

  for (const team of teamsForSync) {
    for (const u of Object.values(room.state.units[team])) {
      unitUpdates.push({
        team,
        id: u.id,
        hp: u.hp,
        dead: u.hp <= 0,
        didAttack: !!u.didAttack,   // ← 추가!
      });
    }
    for (const b of Object.values(room.state.buildings[team])) {
      buildingUpdates.push({ team, id: b.id, hp: b.hp, dead: b.hp <= 0 });
    }
  }

  // 4) 실제 삭제는 업데이트 송신 후 수행
  for (const team of teamsForSync) {
    for (const id of Object.keys(room.state.units[team])) {
      if (room.state.units[team][id].hp <= 0) delete room.state.units[team][id];
    }
    for (const id of Object.keys(room.state.buildings[team])) {
      if (room.state.buildings[team][id].hp <= 0) delete room.state.buildings[team][id];
    }
  }

  io.to(roomId).emit("combatUpdate", { updates: unitUpdates, buildingUpdates });
}

// 전체 방에 대해 고정 틱 실행
setInterval(() => {
  for (const roomId of Object.keys(rooms)) serverTick(roomId);
}, TICK_MS);

/* =========================================================================
 * 소켓 이벤트
 * ========================================================================= */
  io.on("connection", (socket) => {
  // 매칭 참여
  socket.on("joinGame", (data) => {
    const nnn = Math.floor(Math.random() * 1000);
    socket.data.nickname = data.nickname || `Player${nnn}`;

    if (waitingPlayer) {
      const roomId = `room-${waitingPlayer.id}-${socket.id}`;
      socket.join(roomId);
      waitingPlayer.join(roomId);

      rooms[roomId] = { players: [waitingPlayer.id, socket.id], teams: {} };
      ensureRoomState(roomId);

      rooms[roomId].teams[waitingPlayer.id] = "A";
      rooms[roomId].teams[socket.id] = "B";

      io.to(waitingPlayer.id).emit("assignTeam", { team: "A" });
      io.to(socket.id).emit("assignTeam", { team: "B" });

      // Compute unique starting points from map (tile id 601)
      function computeSpawns() {
        try {
          const mapPath = path.join(__dirname, "public", "maps", "map_iso.json");
          const raw = JSON.parse(fs.readFileSync(mapPath, "utf-8"));
          let tiles = raw.tiles;
          if (Array.isArray(tiles) && typeof tiles[0] === "number") {
            const a = new Array(raw.height);
            for (let r = 0; r < raw.height; r++) {
              a[r] = tiles.slice(r * raw.width, (r + 1) * raw.width);
            }
            tiles = a;
          }
          const points = [];
          for (let y = 0; y < (raw.height || 0); y++) {
            for (let x = 0; x < (raw.width || 0); x++) {
              if (tiles?.[y]?.[x] === 601) points.push({ x, y });
            }
          }
          const pick = () => {
            if (!points.length) return null;
            const i = Math.floor(Math.random() * points.length);
            const p = points[i];
            points.splice(i, 1);
            return p;
          };
          const sA = pick();
          const sB = pick();
          // Fallbacks if insufficient markers
          return {
            A: sA || { x: 5, y: 5 },
            B: sB || (sA ? { x: Math.max(0, sA.x + 5), y: Math.max(0, sA.y + 5) } : { x: 10, y: 10 }),
          };
        } catch (e) {
          return { A: { x: 5, y: 5 }, B: { x: 10, y: 10 } };
        }
      }
      const spawns = computeSpawns();

      io.to(roomId).emit("gameStart", {
        room: roomId,
        players: [
          { id: waitingPlayer.id, nickname: waitingPlayer.data.nickname },
          { id: socket.id, nickname: socket.data.nickname },
        ],
        spawns,
      });

      waitingPlayer = null;
    } else {
      waitingPlayer = socket;
    }
  });

  // 자원(광물 등) 감소/변경 브로드캐스트
  // payload: { room, x, y, id, amount }
  socket.on("resourceUpdate", (payload = {}) => {
    const { room, roomId } = getRoomForSocket(socket);
    if (!room || !roomId) return;
    const x = Number(payload.x), y = Number(payload.y);
    const id = payload.id;
    const amount = Math.max(0, Number(payload.amount) | 0);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    // 단순 중계 (서버 권위 자원 관리가 필요하면 여기서 상태를 가질 수 있음)
    socket.to(roomId).emit("resourceUpdate", { x, y, id, amount });
  });

  // 유닛 위치/생성 스냅샷 수신
  socket.on("playerMove", (data) => {
    const { room, roomId, team: myTeam } = getRoomForSocket(socket);
    if (!room || !roomId || !myTeam) return;
    ensureRoomState(roomId);

    const bucket = rooms[roomId].state.units[myTeam];
    const tomb = rooms[roomId].state.tombstones.units[myTeam];
    const snapshot = Array.isArray(data.units) ? data.units : [];

    for (const u of snapshot) {
      const id = u.id;
      const type = u.type;
      if (id === undefined || !type) continue;

      if (!bucket[id]) {
        // Prevent resurrecting units that have been confirmed dead
        if (tomb.has(Number(id))) continue;
        const spec = UNIT_DEFS[type] || {};
        bucket[id] = {
          id,
          type,
          x: n(u.x, 0),
          y: n(u.y, 0),
          hp: spec.hp ?? 1,
          cd: 0,
          team: myTeam,
        };
      } else {
        bucket[id].x = n(u.x, bucket[id].x);
        bucket[id].y = n(u.y, bucket[id].y);
        bucket[id].type = type;
        bucket[id].team = myTeam;
      }
    }

    const out = Object.values(bucket).map(u => ({
      id: u.id,
      type: u.type,
      x: u.x,
      y: u.y,
      faction: myTeam,
      hp: u.hp,
      maxHp: UNIT_DEFS[u.type]?.hp ?? u.hp ?? 1,
    }));

    socket.to(roomId).emit("enemyMove", { units: out });

  });

  // 건물 스냅샷 수신/동기화
  socket.on("BuildplayerBuilding", (data) => {
    const { room, roomId, team: myTeam } = getRoomForSocket(socket);
    if (!room || !roomId || !myTeam) return;
    ensureRoomState(roomId);

    const bucket = rooms[roomId].state.buildings[myTeam];
    const tombB = rooms[roomId].state.tombstones.buildings[myTeam];
    const list = Array.isArray(data.buildings) ? data.buildings : [];

    for (const b of list) {
      const id = b.id;
      const type = b.type;
      if (id === undefined || !type) continue;

      const spec = BUILDING_DEFS[type] || {};
      if (!bucket[id]) {
        if (tombB.has(Number(id))) continue;
        bucket[id] = {
          id,
          type,
          x: n(b.x, 0),
          y: n(b.y, 0),
          width: n(b.width, spec.footprint?.w || 1),
          height: n(b.height, spec.footprint?.h || 1),
          maxHp: spec.hp ?? 100,
          hp: spec.hp ?? 100,
          team: myTeam,
        };
      } else {
        bucket[id].type = type;
        bucket[id].x = n(b.x, bucket[id].x);
        bucket[id].y = n(b.y, bucket[id].y);
        bucket[id].width = n(b.width, bucket[id].width);
        bucket[id].height = n(b.height, bucket[id].height);
      }
    }

    // 상대에게는 현재 내 건물의 형태/위치만 공개(체력 비공개)
    const snapshot = Object.values(bucket).map((bb) => ({
      id: bb.id,
      type: bb.type,
      x: bb.x,
      y: bb.y,
      width: bb.width,
      height: bb.height,
      faction: myTeam,
      maxHp: bb.maxHp,
      hp: bb.hp,
    }));
    socket.to(roomId).emit("BuildenemyBuilding", { buildings: snapshot });
  });

  // === 공격 오더 수신: 내/적/중립 무엇이든 지정 가능 ===
  // payload: { room, orders: [{ unitId, team, type:'attackTarget', target:{ kind:'unit'|'building', team:'A'|'B'|'neutral', id } }] }
  socket.on("orders", (payload = {}) => {
    const { room, roomId, team: myTeam } = getRoomForSocket(socket);
    if (!room || !roomId || !myTeam) return;
    ensureRoomState(roomId);

    for (const o of (payload.orders || [])) {
      if (!o || o.type !== "attackTarget") continue;
      const u = rooms[roomId].state.units[myTeam]?.[o.unitId];
      if (!u) continue;
      // 클라가 지정한 target.team 을 그대로 보존(A/B/neutral)
      u.order = { type: "attackTarget", target: o.target };
    }
  });

  // 연결 종료 처리
  socket.on("disconnect", () => {
    if (waitingPlayer?.id === socket.id) waitingPlayer = null;

    const { room, roomId } = getRoomForSocket(socket);
    if (!room || !roomId) return;

    room.players = room.players.filter((id) => id !== socket.id);
    delete room.teams[socket.id];

    if (room.players.length === 0) delete rooms[roomId];
  });
});

/* =========================================================================
 * 서버 시작
 * ========================================================================= */
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
