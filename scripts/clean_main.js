const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'public', 'main.js');

function simplifyRedundantLoop(src) {
  const pattern = /for \(const u of selectedUnits\) \{\s*const selectedUnits = playerUnits\.filter\(\(u\) => u\.selected\)\;\s*for \(const u of selectedUnits\) \{\s*clearCombatState\(u\)\;\s*\}\s*\}/g;
  return src.replace(pattern, 'for (const u of selectedUnits) { clearCombatState(u); }');
}

function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let inS = false, inD = false, inT = false;
  let inLine = false, inBlock = false;
  let esc = false;
  while (i < n) {
    const c = src[i];
    const next = i + 1 < n ? src[i + 1] : '';

    if (inLine) {
      if (c === '\n') { inLine = false; out += c; }
      i++; continue;
    }
    if (inBlock) {
      if (c === '*' && next === '/') { inBlock = false; i += 2; continue; }
      i++; continue;
    }

    if (inS) {
      out += c;
      if (!esc && c === '\\') { esc = true; i++; continue; }
      if (!esc && c === '\'') inS = false;
      esc = false; i++; continue;
    }
    if (inD) {
      out += c;
      if (!esc && c === '\\') { esc = true; i++; continue; }
      if (!esc && c === '"') inD = false;
      esc = false; i++; continue;
    }
    if (inT) {
      out += c;
      if (!esc && c === '\\') { esc = true; i++; continue; }
      if (!esc && c === '`') inT = false;
      esc = false; i++; continue;
    }

    if (c === '\'' ) { inS = true; out += c; i++; continue; }
    if (c === '"') { inD = true; out += c; i++; continue; }
    if (c === '`') { inT = true; out += c; i++; continue; }

    if (c === '/' && next === '/') { inLine = true; i += 2; continue; }
    if (c === '/' && next === '*') { inBlock = true; i += 2; continue; }

    out += c; i++;
  }
  return out;
}

const descriptions = {
  resizeMinimap: '미니맵 캔버스 크기와 DPR 설정',
  snap: '화면 좌표 스냅(격자 정렬)',
  relationOf: '진영 관계를 판정하여 레이블 반환',
  allocBuildingId: '팀별 건물 ID 증가/할당',
  myOwnedBuildings: '내 진영이 소유한 건물 목록 반환',
  hasBuilding: '특정 건물 보유 여부 확인',
  missingPrereqs: '건설 선행 조건 누락 목록 반환',
  canBuildType: '건설 가능 여부(선행 조건 충족) 판정',
  clearSelectionAndInspection: '유닛/건물 선택 및 관찰 상태 초기화',
  pickResourceAtScreen: '화면 좌표로 자원 클릭 판정',
  loadGameData: '유닛/건물 데이터와 스프라이트 로드',
  cameraBounds: '현재 맵 기준 카메라 이동 한계 계산',
  imageSrcForTileId: '타일 ID에 대응하는 이미지 경로 반환',
  primeTileImagesOnce: '맵 타일 이미지 캐시 초기화',
  getArrayByTeam: '팀에 따른 유닛 배열 참조 반환',
  createUnit: '유닛 객체 생성',
  createBuilding: '건물 객체 생성',
  screenToWorld: '스크린 좌표를 등각 월드 좌표로 변환',
  worldToScreen: '월드 좌표를 스크린 좌표로 변환',
  clampCamera: '카메라 좌표를 경계 내로 보정',
  centerCameraOnTile: '특정 타일 중심으로 카메라 이동',
  miniScaleRot: '미니맵 회전 대비 스케일 계산',
  miniToWorldRot: '미니맵 좌표를 월드 좌표로 변환',
  createCollisionMap: '타일/유닛/건물 기반 충돌 맵 생성',
  canPlaceBuilding: '건물 배치 가능 위치인지 확인',
  nearestReachableAround: '목표 경계에서 도달 가능한 최단 타일 탐색',
  findPath: 'A* 경로 탐색',
  reconstructPath: 'A* 탐색 결과 경로 재구성',
  pickUnitAtScreen: '화면 클릭으로 유닛 선택',
  pickBuildingAtScreen: '화면 클릭으로 건물 선택',
  selectUnitsInBox: '드래그 박스로 유닛 다중 선택',
  resizeCanvas: '게임 캔버스 크기와 컨텍스트 설정',
  scrollCamera: '마우스 가장자리 기반 카메라 스크롤',
  drawDiamondTile: '등각 타일 다이아몬드 렌더링',
  drawIsoMap: '등각 맵 타일 전체 그리기',
  drawIsoResource: '자원 아이콘 등각 렌더링',
  drawIsoUnit: '유닛 스프라이트 및 선택표시 렌더링',
  getSelectedUnits: '선택된 내 유닛 목록 반환',
  getSelectedBuilding: '선택된 내 건물 반환',
  renderBuildingPanel: '건물 정보 패널 갱신',
  renderUnitPanel: '유닛/빌딩/자원 정보 패널 갱신',
  renderMinimap: '미니맵 화면 전체 갱신',
  refreshBuildButtons: '건설 버튼 활성/비활성 갱신',
  spawnUnitFromBuilding: '선택 건물 주위로 유닛 소환',
  distPointToBuilding: '점과 건물의 최소 거리 계산',
  findBestTargetWithin: '사거리 내 최적의 적 타깃 탐색',
  networkTick: '내 유닛/건물 상태 네트워크 브로드캐스트',
  findTargetByOrder: '공격 명령의 실제 타깃 객체 조회',
  tryAutoAggroWhenIdle: '대기 유닛의 자동 교전 유발',
  findEmptyTilesAroundPoint: '좌표 주변의 빈 타일 탐색',
  isStationaryForSeparation: '분산 처리 대상 유닛 판정',
  distToTargetFrom: '좌표에서 타깃까지의 거리 계산',
  buildPlayerOccupancy: '내 유닛의 타일 점유 현황 생성',
  pickNearestEmpty: '후보 중 가장 가까운 빈칸 선택',
  reachableBorderTiles: '목표 경계의 도달 가능 타일 수집',
  separateOverlaps: '겹친 유닛을 인접 빈칸으로 분산',
  rebindInspectedTargetIfNeeded: '관찰 중인 객체 참조 재바인딩',
  spawnUnits: '초기 유닛 스폰',
  startGame: '메인 루프 시작 및 프레임 처리'
};

function addFunctionHeaders(src) {
  const lines = src.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^\s*function\s+([A-Za-z0-9_]+)\s*\(/);
    if (m) {
      const name = m[1];
      const desc = descriptions[name] || `${name} 함수 동작을 수행`;
      out.push(`// ${desc}`);
    }
    out.push(line);
  }
  return out.join('\n');
}

function removeObviousUnused(src) {
  src = src.replace(/\nfunction\s+isImageReady\s*\([^)]*\)\s*\{[\s\S]*?\}\n/, '\n');
  return src;
}

function main() {
  let code = fs.readFileSync(target, 'utf8');
  code = simplifyRedundantLoop(code);
  code = stripComments(code);
  code = removeObviousUnused(code);
  code = addFunctionHeaders(code);
  // Ensure header comment and function do not end up on the same line
  code = code.replace(/^(\/\/[^\n\r]*?)function\s/mg, '$1\nfunction ');
  fs.writeFileSync(target, code, 'utf8');
  console.log('Updated', target);
}

main();
