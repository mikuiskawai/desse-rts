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


// ?�닛/빌딩/?�원 ?�보 ?�널 갱신
function renderUnitPanel() {
  const selected = getSelectedUnits();
  const selBuilding = getSelectedBuilding();


  if (inspectedTarget && inspectedTarget.kind === "unit") {
    const unit = inspectedTarget.data;
    const def = unitTypes[unit.type] || {};
    const img = unitImages[unit.type];
    const relLabel = relationOf(unit.faction) === "enemy" ? "?? : "중립";

    ui.panel.classList.remove("hidden");
    bp.panel.classList.add("hidden");
    build.panel.classList.add("hidden");
    ui.multiWrap.classList.add("hidden");

    ui.icon.src = (img && img.src) ? img.src : "";
    ui.type.textContent = `${unit.type} (${relLabel} ?�닛)`;

    const maxHp = unit.maxHp || 1;
    const curHp = Math.max(0, unit.hp ?? maxHp);
    const ratio = Math.max(0, Math.min(1, curHp / maxHp));
    ui.hpFill.style.width = `${Math.round(ratio * 100)}%`;
    ui.hpText.textContent = `${Math.max(0, Math.ceil(curHp))} / ${maxHp}`;

    ui.atk.textContent = def.atk ?? unit.atk ?? "??;
    ui.armor.textContent = def.armor ?? unit.armor ?? "??;
    ui.range.textContent = ((def.range ?? unit.range) ?? 0).toFixed(1);
    ui.period.textContent = (((def.period ?? unit.period) ?? 0).toFixed(2)) + "s";
    ui.speed.textContent = (def.speed ?? 3).toFixed(2);
    return;
  }

  if (inspectedTarget && inspectedTarget.kind === "building") {
    const b = inspectedTarget.data;
    const bdef = buildingTypes[b.type] || {};
    const bimg = buildingImages[b.type];
    const rel = relationOf(b.faction);
    const relLabel = rel === "enemy" ? "?? : (rel === "ally" ? "?�군" : "중립");

    ui.panel.classList.remove("hidden");
    bp.panel.classList.add("hidden");
    build.panel.classList.add("hidden");
    ui.multiWrap.classList.add("hidden");

    ui.icon.src = (bimg && bimg.src) ? bimg.src : "";
    ui.type.textContent = `${bdef.displayName || b.type || "건물"} (${relLabel} 건물)`;

    if (b.maxHp) {
      const ratio = Math.max(0, Math.min(1, (b.hp ?? b.maxHp) / b.maxHp));
      ui.hpFill.style.width = `${Math.round(ratio * 100)}%`;
      ui.hpText.textContent = `${Math.max(0, Math.ceil(b.hp ?? b.maxHp))} / ${b.maxHp}`;
    } else {
      ui.hpFill.style.width = "0%";
      ui.hpText.textContent = "??;
    }

    ui.atk.textContent = bdef.atk ?? "??;
    ui.armor.textContent = bdef.armor ?? "??;
    ui.range.textContent = (bdef.range ?? 0).toFixed ? (bdef.range ?? 0).toFixed(1) : "??;
    ui.period.textContent = (typeof bdef.period === "number") ? (bdef.period.toFixed(2) + "s") : "??;
    const w = b.width ?? (bdef.footprint?.w ?? 1);
    const h = b.height ?? (bdef.footprint?.h ?? 1);
    ui.speed.textContent = `?�기 ${w}×${h}`;
    return;
  }

  if (inspectedTarget && inspectedTarget.kind === "resource") {
    const r = inspectedTarget.data;
    const img = resourceImages[String(r.id)];

    ui.panel.classList.remove("hidden");
    bp.panel.classList.add("hidden");
    build.panel.classList.add("hidden");
    ui.multiWrap.classList.add("hidden");

    ui.icon.src = (img && img.src) ? img.src : "";
    ui.type.textContent = `${resourceNameById(r.id)} (?�원)`;
    ui.hpFill.style.width = "0%";
    ui.hpText.textContent = `?�재 매장?? ${r.amount | 0}`;
    ui.atk.textContent = "??;
    ui.armor.textContent = "??;
    ui.range.textContent = "??;
    ui.period.textContent = "??;
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
    ui.type.textContent = `${bdef.displayName || selBuilding.type} (건물)`;

    const maxHp = selBuilding.maxHp ?? (bdef.hp ?? 100);
    const curHp = Math.max(0, selBuilding.hp ?? maxHp);
    const ratio = Math.max(0, Math.min(1, curHp / maxHp));
    ui.hpFill.style.width = `${Math.round(ratio * 100)}%`;
    ui.hpText.textContent = `${Math.ceil(curHp)} / ${maxHp}`;
    ui.atk.textContent = bdef.atk ?? "??;
    ui.armor.textContent = bdef.armor ?? "??;
    ui.range.textContent = bdef.range ? bdef.range.toFixed(1) : "??;
    ui.period.textContent = bdef.period ? (bdef.period.toFixed(2) + "s") : "??;
    const w = selBuilding.width ?? (bdef.footprint?.w ?? 1);
    const h = selBuilding.height ?? (bdef.footprint?.h ?? 1);
    ui.speed.textContent = `?�기 ${w}×${h}`;
    return;
  }


  if (selected.length > 1) {
    ui.multiWrap.classList.remove("hidden");
    ui.multiCount.textContent = String(selected.length);
    ui.icon.src = "";
    ui.type.textContent = "?�중 ?�택";
    ui.hpFill.style.width = "0%";
    ui.hpText.textContent = "??;
    ui.atk.textContent = "??;
    ui.armor.textContent = "??;
    ui.range.textContent = "??;
    ui.period.textContent = "??;
    ui.speed.textContent = "??;
    build.panel.classList.add("hidden");
    return;
  }


  ui.multiWrap.classList.add("hidden");
  const unit = selected[0];
  const def = unitTypes[unit.type] || {};
  const img = unitImages[unit.type];

  ui.icon.src = (img && img.src) ? img.src : "";
  ui.type.textContent = unit.type;
  const hpRatio = Math.max(0, Math.min(1, unit.hp / (unit.maxHp || 1)));
  ui.hpFill.style.width = `${Math.round(hpRatio * 100)}%`;
  ui.hpText.textContent = `${Math.max(0, Math.ceil(unit.hp))} / ${unit.maxHp}`;
  ui.atk.textContent = def.atk ?? unit.atk ?? 0;
  ui.armor.textContent = def.armor ?? unit.armor ?? 0;
  ui.range.textContent = (def.range ?? unit.range ?? 0).toFixed(1);
  ui.period.textContent = (def.period ?? unit.period ?? 0).toFixed(2) + "s";
  ui.speed.textContent = (def.speed ?? 3).toFixed(2);
  // ensure building panel is hidden while unit is selected
  bp.panel.classList.add("hidden");

  if (unit.type === "limestone") {
    build.panel.classList.remove("hidden");
  } else {
    build.panel.classList.add("hidden");
  }


  if (selected.length === 0 && !selBuilding) {
    ui.panel.classList.add("hidden");
    ui.multiWrap.classList.add("hidden");
    build.panel.classList.add("hidden");
    return;
  }

}

// 미니�??�면 ?�체 갱신
function renderMinimap() {
  if (!mapData) return;

  const { width: mw, height: mh, tiles } = mapData;
  const s = miniScaleRot();
  const halfW = MINIMAP_CSS_W / 2;
  const halfH = MINIMAP_CSS_H / 2;

  mctx.clearRect(0, 0, MINIMAP_CSS_W, MINIMAP_CSS_H);
  mctx.save();


  mctx.translate(halfW, halfH);
  mctx.rotate(MINIMAP_ROT);


  mctx.translate(-mw * s / 2, -mh * s / 2);


  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const id = tiles[y][x];
      mctx.fillStyle = TILE_ID_TO_COLOR[id] || "#2a2a2a";
      mctx.fillRect(x * s, y * s, s, s);
    }
  }

