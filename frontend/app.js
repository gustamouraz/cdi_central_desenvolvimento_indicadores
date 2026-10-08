const state = { dataset: null, rows: [], sources: [], visuals: [], filters: [], measures: [], relationships: [], selected: null, dashboardId: null, theme: "dark", preset: "violet", snapToGrid: false, visualsPaused: false };
const TYPES = [
  ["bar", "▥", "Barras"], ["line", "⌁", "Linhas"], ["pie", "◕", "Pizza"], ["card", "▣", "Card"],
  ["table", "▦", "Tabela"], ["matrix", "▤", "Matriz"], ["slicer", "▽", "Segmentação"], ["text", "T", "Texto"], ["image", "▧", "Imagem"],
];
const $ = (selector) => document.querySelector(selector);
const canvas = $("#canvas");
let draggedType = null;
let draggedField = null;
let draggedWellField = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}
function validImageSource(value) { return /^(https?:\/\/|\/media\/)/i.test(String(value || "").trim()); }
function fields(kind) { return (state.dataset?.fields || []).filter((field) => !kind || field.kind === kind); }
function setPanel(name) {
  document.querySelectorAll(".panel-tab").forEach((button) => button.classList.toggle("active", button.dataset.panel === name));
  document.querySelectorAll(".panel-content").forEach((panel) => panel.classList.toggle("active", panel.id === `${name}-panel`));
}
function normalizeVisual(visual) {
  visual.left ??= 3;
  visual.top ??= 18;
  visual.widthPct ??= ["table", "matrix"].includes(visual.type) ? 48 : 31;
  visual.heightPx ??= ["card", "text", "image"].includes(visual.type) ? 145 : 300;
}
function dimensionFields(visual) { return visual.dimensions?.length ? visual.dimensions : visual.dimension ? [visual.dimension] : []; }
function metricFields(visual) { return visual.metrics?.length ? visual.metrics : visual.metric ? [visual.metric] : []; }
function syncVisualRoles(visual) { visual.dimension = dimensionFields(visual)[0] || ""; visual.metric = metricFields(visual)[0] || ""; }
function axisFontSize(visual, axis) { return Math.max(7, Math.min(18, Number(visual[axis === "x" ? "xAxisFontSize" : "yAxisFontSize"]) || 9)); }
function filteredRows(visual) {
  const source = visual?.datasetId ? state.sources.find((item) => item.meta.id === visual.datasetId) : null;
  const rows = source?.rows || state.rows;
  const sourceId = source?.meta.id || state.dataset?.id;
  return rows.filter((row) => state.filters.every((filter) => {
    if (!filter.sourceId || filter.sourceId === sourceId || filter.field in row) return !(filter.field in row) || String(row[filter.field] ?? "") === filter.value;
    const relation = state.relationships.find((item) => (item.sourceTable === sourceId && item.targetTable === filter.sourceId) || (item.targetTable === sourceId && item.sourceTable === filter.sourceId));
    const related = relationshipSource(filter.sourceId);
    if (!relation || !related) return true;
    const sourceField = relation.sourceTable === sourceId ? relation.sourceField : relation.targetField;
    const relatedField = relation.sourceTable === sourceId ? relation.targetField : relation.sourceField;
    const allowed = new Set(related.rows.filter((relatedRow) => String(relatedRow[filter.field] ?? "") === filter.value).map((relatedRow) => String(relatedRow[relatedField] ?? "")));
    return allowed.has(String(row[sourceField] ?? ""));
  }));
}
function aggregate(visual, metricName) {
  const metric = metricName || metricFields(visual)[0];
  const dimensions = dimensionFields(visual);
  const measure = state.measures.find((item) => item.name === metric);
  if (measure) return [["Total", evaluateMeasure(measure.expression, filteredRows(visual))]];
  const grouped = {};
  filteredRows(visual).forEach((row) => {
    const key = dimensions.length ? dimensions.map((field) => row[field] ?? "Sem valor").join(" / ") : "Total";
    grouped[key] = (grouped[key] || 0) + (metric ? Number(row[metric]) || 0 : 1);
  });
  return Object.entries(grouped).slice(0, 8);
}
const THEME_PALETTES = {
  violet: ["#7c3aed", "#facc15", "#38bdf8", "#fb7185", "#4ade80", "#fb923c", "#d2bbff", "#94a3b8"],
  ocean: ["#0369a1", "#06b6d4", "#22c55e", "#f59e0b", "#8b5cf6", "#ef4444", "#7dd3fc", "#94a3b8"],
  forest: ["#15803d", "#84cc16", "#eab308", "#0ea5e9", "#f97316", "#a855f7", "#86efac", "#94a3b8"],
  sunset: ["#c2410c", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#0ea5e9", "#fdba74", "#94a3b8"],
};
function activePalette() { return THEME_PALETTES[state.preset] || THEME_PALETTES.violet; }
function seriesColor(visual, index) { return visual.colors?.[index] || (index === 0 && visual.customColor ? visual.color : activePalette()[index % activePalette().length]); }
function formatChartValue(value, total, visual) {
  if (visual.valueFormat === "percent") return `${((Number(value) / (total || 1)) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  return Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}
function evaluateMeasure(expression, rows) {
  const match = expression.trim().match(/^(SUM|AVG|COUNT|MIN|MAX)\s*\(\s*\[?([^\]]*)\]?\s*\)$/i);
  if (!match) return 0;
  const operation = match[1].toUpperCase(), field = match[2].trim();
  if (operation === "COUNT") return rows.length;
  const values = rows.map((row) => Number(row[field]) || 0);
  if (operation === "SUM") return values.reduce((sum, value) => sum + value, 0);
  if (operation === "AVG") return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return operation === "MIN" ? Math.min(...values) : Math.max(...values);
}
function visualBody(visual) {
  const values = aggregate(visual);
  const dimensions = dimensionFields(visual), metrics = metricFields(visual);
  const needsMetric = ["bar", "line", "pie", "card"].includes(visual.type);
  if (needsMetric && !metrics.length) return '<div class="visual-empty">Arraste um campo numérico aqui para definir a métrica.</div>';
  if (["bar", "line", "pie", "slicer"].includes(visual.type) && !dimensions.length) return '<div class="visual-empty">Arraste um campo de categoria aqui para definir a dimensão.</div>';
  if (visual.type === "bar") {
    const maximum = Math.max(...values.map(([, value]) => Number(value)), 1);
    const total = values.reduce((sum, [, value]) => sum + Number(value), 0);
    const bars = values.map(([label, value], index) => `<div class="bar-item" title="${escapeHtml(label)}: ${formatChartValue(value, total, visual)}">${visual.showValues ? `<strong>${formatChartValue(value, total, visual)}</strong>` : ""}<i style="height:${Math.max(12, (Number(value) / maximum) * 100)}%;background:${seriesColor(visual, index)}"></i><small>${escapeHtml(label)}</small></div>`).join("");
    return values.length ? `<div class="chart-bars">${bars}</div>${visual.showLegend ? `<div class="chart-legend">${values.map(([label], index) => `<span><i style="background:${seriesColor(visual, index)}"></i>${escapeHtml(label)}</span>`).join("")}</div>` : ""}` : '<div class="visual-empty">Não há registros para os campos selecionados.</div>';
  }
  if (visual.type === "line") {
    if (!values.length) return '<div class="visual-empty">Não há registros para os campos selecionados.</div>';
    const maximum = Math.max(...values.map(([, value]) => Number(value)), 1), total = values.reduce((sum, [, value]) => sum + Number(value), 0);
    // Margens internas no SVG evitam que marcadores e rótulos encostem nas bordas ao redimensionar.
    const coordinates = values.map(([, value], index) => ({ x: 14 + index * (188 / Math.max(values.length - 1, 1)), y: 92 - (Number(value) / maximum) * 68, value: Number(value) }));
    const points = coordinates.map((point) => `${point.x},${point.y}`).join(" ");
    const grid = [24, 58, 92].map((y) => `<line class="line-grid" x1="14" y1="${y}" x2="202" y2="${y}" />`).join("");
    const markers = coordinates.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="3" fill="${seriesColor(visual, 0)}" />${visual.showValues ? `<text x="${point.x}" y="${Math.max(9, point.y - 5)}" text-anchor="middle">${formatChartValue(point.value, total, visual)}</text>` : ""}`).join("");
    return `<div class="chart-line"><div class="line-plot"><div class="line-y-axis"><small>${formatChartValue(maximum, total, visual)}</small><small>${formatChartValue(maximum / 2, total, visual)}</small><small>0${visual.valueFormat === "percent" ? "%" : ""}</small></div><svg viewBox="0 0 216 112" preserveAspectRatio="none">${grid}<polyline style="stroke:${seriesColor(visual, 0)}" points="${points}" />${markers}</svg></div><div class="line-labels">${values.map(([label]) => `<small title="${escapeHtml(label)}">${escapeHtml(label)}</small>`).join("")}</div></div>${visual.showLegend ? `<div class="chart-legend"><i style="background:${seriesColor(visual, 0)}"></i>${escapeHtml(visual.metric)}</div>` : ""}`;
  }
  if (visual.type === "pie") {
    if (!values.length) return '<div class="visual-empty">Não há registros para os campos selecionados.</div>';
    const palette = values.map((_, index) => seriesColor(visual, index));
    const total = values.reduce((sum, [, value]) => sum + Number(value), 0) || 1;
    let start = 0;
    const slices = values.map(([, value], index) => { const end = start + (Number(value) / total) * 100; const slice = `${palette[index % palette.length]} ${start}% ${end}%`; start = end; return slice; }).join(",");
    return `<div class="pie-layout"><div class="chart-pie" style="background:conic-gradient(${slices})"></div>${visual.showLegend ? `<div class="pie-legend">${values.map(([label, value], index) => `<small><i style="background:${palette[index % palette.length]}"></i>${escapeHtml(label)}${visual.showValues ? ` (${formatChartValue(value, total, visual)})` : ""}</small>`).join("")}</div>` : ""}</div>`;
  }
  if (visual.type === "card") {
    const total = values.reduce((sum, [, value]) => sum + Number(value), 0);
    return `<div class="kpi">${state.dataset ? total.toLocaleString("pt-BR") : "—"}<small>${escapeHtml(visual.metric || "Escolha uma métrica")}</small></div>`;
  }
  if (visual.type === "text") return `<div class="text-placeholder" style="font-size:${visual.fontSize || 16}px">${escapeHtml(visual.text || "Clique para editar este texto")}</div>`;
  if (visual.type === "image") return validImageSource(visual.imageUrl) ? `<img class="dashboard-image" src="${escapeHtml(visual.imageUrl)}" alt="${escapeHtml(visual.title || "Imagem do painel")}" />` : '<div class="image-placeholder">Informe uma URL ou envie um arquivo nas propriedades.</div>';
  if (visual.type === "slicer") {
    const field = dimensions[0], options = [...new Set(filteredRows(visual).map((row) => String(row[field] ?? "")).filter(Boolean))].sort();
    const active = state.filters.find((filter) => filter.field === field && filter.sourceId === visual.datasetId)?.value || "";
    return `<div class="slicer-body"><label>${escapeHtml(field)}</label><select class="visual-slicer" data-slicer-id="${visual.id}"><option value="">Todos</option>${options.map((value) => `<option value="${escapeHtml(value)}" ${value === active ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}</select></div>`;
  }
  const rows = filteredRows(visual).slice(0, 5);
  const headers = visual.type === "matrix" ? [...dimensions, ...metrics].filter(Boolean) : Object.keys(rows[0] || {}).slice(0, 4);
  return `<table class="mini-table"><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>${rows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header])}</td>`).join("")}</tr>`).join("")}</table>`;
}

function renderCanvas() {
  canvas.innerHTML = "";
  if (!state.visuals.length) {
    canvas.innerHTML = '<div class="canvas-empty"><strong>Comece a construir seu painel</strong><br>Escolha um visual à direita ou arraste-o para este canvas.</div>';
    return;
  }
  state.visuals.forEach((visual) => {
    normalizeVisual(visual);
    const node = $("#visual-template").content.firstElementChild.cloneNode(true);
    node.draggable = false;
    node.dataset.id = visual.id;
    node.dataset.type = visual.type;
    node.classList.toggle("title-hidden", visual.showTitle === false);
    node.style.left = `${visual.left}%`;
    node.style.top = `${visual.top}px`;
    node.style.width = `${visual.widthPct}%`;
    node.style.height = `${visual.heightPx}px`;
    node.classList.toggle("selected", state.selected === visual.id);
    node.querySelector(".visual-title").textContent = visual.title;
    node.querySelector(".visual-body").innerHTML = visualBody(visual);
    const lineChart = node.querySelector(".chart-line");
    if (lineChart) {
      lineChart.style.setProperty("--axis-x-size", `${axisFontSize(visual, "x")}px`);
      lineChart.style.setProperty("--axis-y-size", `${axisFontSize(visual, "y")}px`);
    }
    const slicer = node.querySelector(".visual-slicer");
    if (slicer) slicer.addEventListener("change", () => {
      const field = dimensionFields(visual)[0], sourceId = visual.datasetId || state.dataset?.id;
      state.filters = state.filters.filter((filter) => !(filter.field === field && filter.sourceId === sourceId));
      if (slicer.value) state.filters.push({ field, value: slicer.value, sourceId });
      renderFilters(); renderDataView(); renderCanvas();
    });
    node.querySelector(".visual-card-header").addEventListener("pointerdown", (event) => beginMove(event, visual, node));
    node.addEventListener("dragover", (event) => { event.preventDefault(); event.stopPropagation(); node.classList.add("field-target"); });
    node.addEventListener("dragleave", () => node.classList.remove("field-target"));
    node.addEventListener("drop", (event) => applyFieldToVisual(event, visual, node));
    node.querySelector(".delete-visual").addEventListener("click", (event) => { event.stopPropagation(); removeVisual(visual.id); });
    const handle = document.createElement("button");
    handle.className = "resize-handle";
    handle.title = "Arraste para redimensionar";
    handle.addEventListener("pointerdown", (event) => beginResize(event, visual, node));
    node.append(handle);
    node.addEventListener("click", () => selectVisual(visual.id));
    canvas.append(node);
  });
}
function selectVisual(id) { state.selected = id; renderCanvas(); renderConfig(); }
function applyFieldToVisual(event, visual, node) {
  event.preventDefault(); event.stopPropagation(); node.classList.remove("field-target");
  let field = draggedField;
  try { field = JSON.parse(event.dataTransfer.getData("application/x-cdi-field")) || field; } catch { }
  if (!field?.name) return;
  visual.datasetId = field.sourceId;
  if (field.kind === "number") {
    visual.metrics = [...new Set([...(visual.metrics || (visual.metric ? [visual.metric] : [])), field.name])];
    visual.metric = visual.metrics[0];
  } else {
    visual.dimensions = [...new Set([...(visual.dimensions || (visual.dimension ? [visual.dimension] : [])), field.name])];
    visual.dimension = visual.dimensions[0];
  }
  state.selected = visual.id; draggedField = null;
  renderCanvas(); renderConfig();
}
function removeVisual(id) { state.visuals = state.visuals.filter((visual) => visual.id !== id); state.selected = null; renderCanvas(); renderConfig(); }
function beginMove(event, visual, node) {
  if (event.button !== 0 || event.target.closest("button")) return;
  event.preventDefault();
  state.selected = visual.id; renderConfig();
  const bounds = canvas.getBoundingClientRect();
  const box = node.getBoundingClientRect();
  const offsetX = event.clientX - box.left, offsetY = event.clientY - box.top;
  const move = (pointer) => {
    let left = Math.max(0, Math.min(bounds.width - box.width, pointer.clientX - bounds.left - offsetX));
    let top = Math.max(0, Math.min(bounds.height - box.height, pointer.clientY - bounds.top - offsetY));
    if (state.snapToGrid) { left = Math.round(left / 24) * 24; top = Math.round(top / 24) * 24; }
    visual.left = (left / bounds.width) * 100; visual.top = top;
    node.style.left = `${visual.left}%`; node.style.top = `${visual.top}px`;
  };
  const finish = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); };
  window.addEventListener("pointermove", move); window.addEventListener("pointerup", finish);
}
function beginResize(event, visual, node) {
  event.preventDefault(); event.stopPropagation();
  state.selected = visual.id; renderConfig();
  const bounds = canvas.getBoundingClientRect();
  const box = node.getBoundingClientRect();
  const startX = event.clientX, startY = event.clientY;
  const move = (pointer) => {
    const maxWidth = bounds.width - (visual.left / 100) * bounds.width;
    const width = Math.max(160, Math.min(maxWidth, box.width + pointer.clientX - startX));
    const height = Math.max(90, Math.min(bounds.height - visual.top, box.height + pointer.clientY - startY));
    visual.widthPct = (width / bounds.width) * 100; visual.heightPx = height;
    node.style.width = `${visual.widthPct}%`; node.style.height = `${visual.heightPx}px`;
  };
  const finish = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); };
  window.addEventListener("pointermove", move); window.addEventListener("pointerup", finish);
}
function addVisual(type, drop) {
  const definition = TYPES.find((item) => item[0] === type);
  if (!definition) return;
  const selected = state.visuals.find((visual) => visual.id === state.selected);
  if (selected && !drop) {
    const previousName = TYPES.find((item) => item[0] === selected.type)?.[2];
    selected.type = type;
    if (selected.title === previousName) selected.title = definition[2];
    renderCanvas(); renderConfig(); setPanel("visuals");
    return;
  }
  const index = state.visuals.length;
  const visual = {
    id: globalThis.crypto?.randomUUID?.() || `visual-${Date.now()}-${index}`,
    type, title: definition[2], dimension: "", metric: "", text: "", fontSize: 16, showTitle: true, imageUrl: "", xAxisFontSize: 9, yAxisFontSize: 9, datasetId: state.dataset?.id || null, color: activePalette()[0], customColor: false, showLegend: true, showValues: true,
    left: drop?.left ?? (3 + (index % 3) * 32),
    top: drop?.top ?? (18 + Math.floor(index / 3) * 170),
    widthPct: ["table", "matrix"].includes(type) ? 48 : 31,
    heightPx: ["card", "text", "image"].includes(type) ? 145 : 300,
  };
  state.visuals.push(visual); state.selected = visual.id;
  renderCanvas(); renderConfig(); setPanel("visuals");
}
function canvasPosition(event, type) {
  const bounds = canvas.getBoundingClientRect();
  const widthPct = ["table", "matrix"].includes(type) ? 48 : 31;
  let left = Math.max(0, Math.min(100 - widthPct, ((event.clientX - bounds.left) / bounds.width) * 100));
  let top = Math.max(0, Math.min(bounds.height - 145, event.clientY - bounds.top));
  if (state.snapToGrid) { left = Math.round(left / 2) * 2; top = Math.round(top / 24) * 24; }
  return { left, top };
}

function renderTemplates() {
  const container = $("#visual-templates");
  container.innerHTML = "";
  TYPES.forEach(([type, icon, label]) => {
    const button = document.createElement("button");
    button.type = "button"; button.className = "visual-template"; button.draggable = true;
    button.innerHTML = `<b>${icon}</b><span>${label}</span>`;
    button.addEventListener("click", () => addVisual(type));
    button.addEventListener("dragstart", (event) => { draggedType = type; event.dataTransfer.setData("text/plain", type); event.dataTransfer.effectAllowed = "copy"; });
    button.addEventListener("dragend", () => { draggedType = null; });
    container.append(button);
  });
}
function renderFields() {
  const term = $("#field-search").value.toLowerCase();
  if (!state.sources.length) { $("#field-list").innerHTML = '<p class="hint">Importe arquivos, uma API ou uma consulta para exibir as fontes.</p>'; return; }
  $("#field-list").innerHTML = state.sources.map((source) => {
    const active = source.meta.id === state.dataset?.id;
    const items = source.meta.fields.filter((field) => field.name.toLowerCase().includes(term)).map((field) => `<div class="field" draggable="true" data-field="${escapeHtml(field.name)}" data-kind="${field.kind}" data-source="${source.meta.id}" title="Arraste para um visual"><b>${field.kind === "number" ? "SUM" : "ABC"}</b><span>${escapeHtml(field.name)}</span><em>${field.kind === "number" ? "numérico" : "texto"}</em></div>`).join("");
    return `<div class="dataset-tree ${active ? "active-source" : ""}"><button type="button" class="dataset-header" data-source-id="${source.meta.id}"><span>▾</span><strong>▦ ${escapeHtml(source.meta.name)}</strong><small>${source.meta.rows.toLocaleString("pt-BR")} linhas</small></button><div class="dataset-fields">${items || '<p class="hint">Nenhum campo encontrado.</p>'}</div></div>`;
  }).join("");
  document.querySelectorAll("[data-source-id]").forEach((button) => button.addEventListener("click", () => activateSource(button.dataset.sourceId)));
  document.querySelectorAll(".field[draggable]").forEach((field) => field.addEventListener("dragstart", (event) => {
    draggedField = { name: field.dataset.field, kind: field.dataset.kind, sourceId: field.dataset.source };
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-cdi-field", JSON.stringify(draggedField));
  }));
}
function activateSource(id) {
  const source = state.sources.find((item) => item.meta.id === id);
  if (!source) return;
  state.dataset = source.meta; state.rows = source.rows; state.filters = [];
  $("#dataset-status").textContent = `Fonte ativa: ${source.meta.name} (${source.meta.rows.toLocaleString("pt-BR")} linhas)`;
  renderFields(); renderFilters(); renderDataView(); renderConfig();
}
function renderFilters() {
  const field = $("#filter-field"), value = $("#filter-value");
  field.innerHTML = '<option value="">Selecione um campo</option>' + fields().map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join("");
  value.innerHTML = '<option value="">Selecione primeiro um campo</option>';
  $("#filter-list").innerHTML = state.filters.map((filter, index) => `<div class="filter-chip">${escapeHtml(filter.field)}: ${escapeHtml(filter.value)}<button data-index="${index}">×</button></div>`).join("");
  document.querySelectorAll("[data-index]").forEach((button) => button.addEventListener("click", () => { state.filters.splice(Number(button.dataset.index), 1); renderFilters(); renderCanvas(); renderDataView(); }));
}
function updateFilterValues() {
  const field = $("#filter-field").value;
  const values = [...new Set(state.rows.map((row) => String(row[field] ?? "")).filter(Boolean))].slice(0, 100);
  $("#filter-value").innerHTML = '<option value="">Selecione um valor</option>' + values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
}
function renderConfig() {
  const visual = state.visuals.find((item) => item.id === state.selected);
  if (!visual) { $("#visual-config").innerHTML = '<p class="hint">Selecione um visual no canvas para editar suas propriedades.</p>'; return; }
  normalizeVisual(visual);
  const options = (list, selected) => '<option value="">Não definido</option>' + list.map((field) => `<option ${field.name === selected ? "selected" : ""}>${escapeHtml(field.name)}</option>`).join("");
  const metricOptions = [...fields("number"), ...state.measures.map((measure) => ({ name: measure.name }))];
  const well = (role, label, values) => `<div class="field-well"><strong>${label}</strong><div class="role-well" data-role-well="${role}">${values.map((name, index) => `<span class="role-chip" draggable="true" data-role-chip="${role}" data-chip-index="${index}" title="Arraste para reordenar"><b>${escapeHtml(name)}</b><button type="button" data-remove-role="${role}" data-remove-index="${index}" title="Remover">×</button></span>`).join("") || '<em>Arraste campos aqui</em>'}</div></div>`;
  const fieldSummary = `<div class="field-wells">${well("dimension", "Categorias", dimensionFields(visual))}${well("metric", "Valores", metricFields(visual))}</div>`;
  const chartOptions = ["bar", "line", "pie"].includes(visual.type) ? `<hr><h2>Formatação</h2><label>Cor principal</label><div class="color-control"><input id="cfg-color" type="color" value="${visual.color || "#7c3aed"}"><input id="cfg-colorHex" value="${visual.color || "#7c3aed"}" maxlength="7"></div><label class="check-option"><input id="cfg-showLegend" type="checkbox" ${visual.showLegend !== false ? "checked" : ""}> Exibir legenda</label><label class="check-option"><input id="cfg-showValues" type="checkbox" ${visual.showValues !== false ? "checked" : ""}> Exibir valores</label>` : "";
  $("#visual-config").innerHTML = `<h2>Propriedades</h2><label>Título</label><input id="cfg-title" value="${escapeHtml(visual.title)}"><label>Dimensão</label><select id="cfg-dimension">${options(fields(), visual.dimension)}</select><label>Métrica</label><select id="cfg-metric">${options(metricOptions, visual.metric)}</select>${fieldSummary}<div class="layout-grid"><label>Posição horizontal (%)<input id="cfg-left" type="number" min="0" max="90" value="${Math.round(visual.left)}"></label><label>Posição vertical (px)<input id="cfg-top" type="number" min="0" max="650" value="${Math.round(visual.top)}"></label><label>Largura (%)<input id="cfg-widthPct" type="number" min="16" max="100" value="${Math.round(visual.widthPct)}"></label><label>Altura (px)<input id="cfg-heightPx" type="number" min="90" max="700" value="${Math.round(visual.heightPx)}"></label></div>${chartOptions}${visual.type === "text" ? `<label>Texto</label><input id="cfg-text" value="${escapeHtml(visual.text)}"><label>Tamanho do texto</label><input id="cfg-fontSize" type="range" min="12" max="48" value="${visual.fontSize || 16}">` : ""}`;
  if (visual.type === "line") {
    $("#visual-config").insertAdjacentHTML("beforeend", `<hr><h2>Eixos</h2><div class="layout-grid"><label>Fonte do eixo X<input id="cfg-xAxisFontSize" type="range" min="7" max="18" value="${axisFontSize(visual, "x")}"></label><label>Fonte do eixo Y<input id="cfg-yAxisFontSize" type="range" min="7" max="18" value="${axisFontSize(visual, "y")}"></label></div><p class="hint">Ajuste a leitura dos rótulos sem mudar o tamanho do visual.</p>`);
    ["xAxisFontSize", "yAxisFontSize"].forEach((key) => {
      const input = $(`#cfg-${key}`);
      input.addEventListener("input", () => { visual[key] = Number(input.value); renderCanvas(); });
    });
  }
  $("#visual-config").insertAdjacentHTML("beforeend", `<hr><label class="check-option"><input id="cfg-showTitle" type="checkbox" ${visual.showTitle !== false ? "checked" : ""}> Exibir título do visual</label>`);
  $("#cfg-showTitle").addEventListener("change", (event) => { visual.showTitle = event.target.checked; renderCanvas(); });
  if (visual.type === "image") {
    $("#visual-config").insertAdjacentHTML("beforeend", `<hr><h2>Imagem</h2><label>URL da imagem</label><input id="cfg-imageUrl" type="url" value="${escapeHtml(visual.imageUrl || "")}" placeholder="https://... ou /media/..." /><label>Ou envie um arquivo</label><input id="cfg-imageFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif" /><p class="hint">Formatos aceitos: PNG, JPG, WEBP e GIF (até 10 MB).</p>`);
    $("#cfg-imageUrl").addEventListener("change", (event) => { visual.imageUrl = event.target.value.trim(); renderCanvas(); });
    $("#cfg-imageFile").addEventListener("change", async (event) => {
      const file = event.target.files?.[0]; if (!file) return;
      const form = new FormData(); form.append("file", file); actionStatus("Enviando imagem…");
      const response = await fetch("/api/images", { method: "POST", body: form }); const result = await response.json();
      if (!response.ok) { actionStatus(result.detail || "Não foi possível enviar a imagem."); return; }
      visual.imageUrl = result.url; actionStatus("Imagem adicionada ao visual."); renderCanvas(); renderConfig();
    });
  }
  ["title", "dimension", "metric", "text", "left", "top", "widthPct", "heightPx", "fontSize"].forEach((key) => {
    const input = $(`#cfg-${key}`);
    if (input) input.addEventListener("input", () => { visual[key] = ["left", "top", "widthPct", "heightPx", "fontSize"].includes(key) ? Number(input.value) : input.value; if (key === "dimension") visual.dimensions = visual.dimension ? [visual.dimension] : []; if (key === "metric") visual.metrics = visual.metric ? [visual.metric] : []; renderCanvas(); });
  });
  document.querySelectorAll("[data-remove-role]").forEach((button) => button.addEventListener("click", () => {
    const role = button.dataset.removeRole, index = Number(button.dataset.removeIndex);
    const property = role === "dimension" ? "dimensions" : "metrics";
    visual[property] = [...(visual[property] || (role === "dimension" ? dimensionFields(visual) : metricFields(visual)))];
    visual[property].splice(index, 1); syncVisualRoles(visual); renderCanvas(); renderConfig();
  }));
  document.querySelectorAll("[data-role-chip]").forEach((chip) => chip.addEventListener("dragstart", (event) => {
    draggedWellField = { role: chip.dataset.roleChip, index: Number(chip.dataset.chipIndex) };
    event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-cdi-well", JSON.stringify(draggedWellField));
  }));
  document.querySelectorAll("[data-role-well]").forEach((well) => {
    well.addEventListener("dragover", (event) => { event.preventDefault(); well.classList.add("drag-over"); });
    well.addEventListener("dragleave", () => well.classList.remove("drag-over"));
    well.addEventListener("drop", (event) => {
      event.preventDefault(); well.classList.remove("drag-over"); const role = well.dataset.roleWell;
      let field = draggedField, moved = draggedWellField;
      try { field = JSON.parse(event.dataTransfer.getData("application/x-cdi-field")) || field; } catch { }
      try { moved = JSON.parse(event.dataTransfer.getData("application/x-cdi-well")) || moved; } catch { }
      const property = role === "dimension" ? "dimensions" : "metrics";
      visual[property] = [...(visual[property] || (role === "dimension" ? dimensionFields(visual) : metricFields(visual)))];
      const targetChip = event.target.closest("[data-role-chip]");
      let targetIndex = targetChip && targetChip.dataset.roleChip === role ? Number(targetChip.dataset.chipIndex) : visual[property].length;
      if (moved?.role) {
        const sourceProperty = moved.role === "dimension" ? "dimensions" : "metrics";
        visual[sourceProperty] = [...(visual[sourceProperty] || (moved.role === "dimension" ? dimensionFields(visual) : metricFields(visual)))];
        const [name] = visual[sourceProperty].splice(moved.index, 1);
        if (moved.role === role && moved.index < targetIndex) targetIndex -= 1;
        if (name) visual[property].splice(Math.max(0, targetIndex), 0, name);
      }
      else if (field?.name && !visual[property].includes(field.name)) { visual[property].splice(Math.max(0, targetIndex), 0, field.name); visual.datasetId = field.sourceId; }
      syncVisualRoles(visual); draggedField = null; draggedWellField = null; renderCanvas(); renderConfig();
    });
  });
  const colorPicker = $("#cfg-color"), colorHex = $("#cfg-colorHex");
  if (colorPicker) colorPicker.addEventListener("input", () => { visual.color = colorPicker.value; visual.customColor = true; colorHex.value = visual.color; renderCanvas(); });
  if (colorHex) colorHex.addEventListener("change", () => { if (/^#[0-9a-f]{6}$/i.test(colorHex.value)) { visual.color = colorHex.value; visual.customColor = true; colorPicker.value = visual.color; renderCanvas(); } });
  ["showLegend", "showValues"].forEach((key) => { const input = $(`#cfg-${key}`); if (input) input.addEventListener("change", () => { visual[key] = input.checked; renderCanvas(); }); });
}
function renderDataView() {
  const rows = filteredRows().slice(0, 20);
  if (!rows.length) { $("#data-table").textContent = "Importe uma base na guia Dados para visualizá-la aqui."; return; }
  const headers = Object.keys(rows[0]);
  $("#data-table").innerHTML = `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
function relationshipSource(id) { return state.sources.find((source) => source.meta.id === id); }
async function createInferredRelationship(sourceTable, sourceField, targetTable, targetField) {
  const duplicate = state.relationships.some((relation) => relation.sourceTable === sourceTable && relation.sourceField === sourceField && relation.targetTable === targetTable && relation.targetField === targetField);
  if (duplicate) { actionStatus("Esse relacionamento já existe."); return; }
  actionStatus("Analisando cardinalidade das colunas…");
  try {
    const [sourceProfile, targetProfile] = await Promise.all([
      fetch(`/api/datasets/${encodeURIComponent(sourceTable)}/profile/${encodeURIComponent(sourceField)}`).then((response) => response.json()),
      fetch(`/api/datasets/${encodeURIComponent(targetTable)}/profile/${encodeURIComponent(targetField)}`).then((response) => response.json()),
    ]);
    if (sourceProfile.detail || targetProfile.detail) throw new Error(sourceProfile.detail || targetProfile.detail);
    const cardinality = sourceProfile.is_unique && targetProfile.is_unique ? "one-to-one" : sourceProfile.is_unique ? "one-to-many" : targetProfile.is_unique ? "many-to-one" : "many-to-many";
    state.relationships.push({ sourceTable, sourceField, targetTable, targetField, cardinality });
    renderRelationships();
    const label = ({ "one-to-one": "1 para 1", "one-to-many": "1 para N", "many-to-one": "N para 1", "many-to-many": "N para N" })[cardinality];
    actionStatus(`Relacionamento criado automaticamente: ${label}.`);
  } catch (error) { actionStatus(`Não foi possível analisar as colunas: ${error.message || "erro desconhecido"}`); }
}
function renderRelationFieldOptions(tableSelector, fieldSelector) {
  const source = relationshipSource($(tableSelector).value);
  $(fieldSelector).innerHTML = source ? source.meta.fields.map((field) => `<option value="${escapeHtml(field.name)}">${escapeHtml(field.name)}${field.kind === "number" ? " (numérico)" : ""}</option>`).join("") : '<option value="">Selecione uma tabela</option>';
}
function renderRelationships() {
  const tables = state.sources;
  if ($("#relation-cardinality").options.length < 4) $("#relation-cardinality").innerHTML = '<option value="one-to-one">1 para 1</option><option value="one-to-many">1 para N</option><option value="many-to-one">N para 1</option><option value="many-to-many">N para N</option>';
  const tableOptions = tables.map((source) => `<option value="${source.meta.id}">${escapeHtml(source.meta.name)}</option>`).join("");
  ["#relation-source-table", "#relation-target-table"].forEach((selector) => { const current = $(selector).value; $(selector).innerHTML = tables.length ? tableOptions : '<option value="">Importe duas fontes</option>'; if (tables.some((source) => source.meta.id === current)) $(selector).value = current; });
  renderRelationFieldOptions("#relation-source-table", "#relation-source-field"); renderRelationFieldOptions("#relation-target-table", "#relation-target-field");
  $("#relationship-count").textContent = `${state.relationships.length} relacionamento${state.relationships.length === 1 ? "" : "s"}`;
  $("#relationship-canvas").innerHTML = tables.length ? tables.map((source) => `<article class="relationship-table"><header>▦ ${escapeHtml(source.meta.name)} <small>(${source.meta.rows.toLocaleString("pt-BR")})</small></header>${source.meta.fields.map((field) => `<div class="relationship-field" draggable="true" data-relation-table="${source.meta.id}" data-relation-field="${escapeHtml(field.name)}" title="Arraste este campo sobre um campo de outra tabela"><span>${escapeHtml(field.name)}</span><b>${field.kind === "number" ? "∑" : "ABC"}</b></div>`).join("")}</article>`).join("") : '<div class="relationship-empty">Importe duas ou mais fontes para montar o mapa do modelo.</div>';
  $("#relationship-list").innerHTML = state.relationships.length ? state.relationships.map((relation, index) => {
    const source = relationshipSource(relation.sourceTable), target = relationshipSource(relation.targetTable);
    const cardinality = ({ "one-to-one": "1 : 1", "one-to-many": "1 : N", "many-to-one": "N : 1", "many-to-many": "N : N" })[relation.cardinality] || "1 : N";
    return `<div class="relationship-link"><span>${escapeHtml(source?.meta.name || "Tabela")}<b>.${escapeHtml(relation.sourceField)}</b> <em>${cardinality}</em> ${escapeHtml(target?.meta.name || "Tabela")}<b>.${escapeHtml(relation.targetField)}</b></span><button type="button" data-remove-relation="${index}" title="Remover relacionamento">×</button></div>`;
  }).join("") : '<p class="hint">Nenhum relacionamento criado.</p>';
  document.querySelectorAll("[data-remove-relation]").forEach((button) => button.addEventListener("click", () => { state.relationships.splice(Number(button.dataset.removeRelation), 1); renderRelationships(); }));
  document.querySelectorAll("[data-relation-table]").forEach((field) => {
    field.addEventListener("dragstart", (event) => { event.dataTransfer.setData("application/x-cdi-relation", JSON.stringify({ table: field.dataset.relationTable, field: field.dataset.relationField })); event.dataTransfer.effectAllowed = "link"; });
    field.addEventListener("dragover", (event) => { event.preventDefault(); field.classList.add("relationship-drop-target"); });
    field.addEventListener("dragleave", () => field.classList.remove("relationship-drop-target"));
    field.addEventListener("drop", async (event) => { event.preventDefault(); field.classList.remove("relationship-drop-target"); let source; try { source = JSON.parse(event.dataTransfer.getData("application/x-cdi-relation")); } catch { return; } if (!source || (source.table === field.dataset.relationTable && source.field === field.dataset.relationField)) return; await createInferredRelationship(source.table, source.field, field.dataset.relationTable, field.dataset.relationField); });
  });
}
async function upload(file) {
  const form = new FormData(); form.append("file", file); $("#dataset-status").textContent = "Importando…";
  const response = await fetch("/api/datasets", { method: "POST", body: form });
  const result = await response.json();
  if (!response.ok) { $("#dataset-status").textContent = result.detail || "Falha ao importar"; return; }
  const data = await fetch(`/api/datasets/${result.id}`).then((answer) => answer.json());
  registerSource(result, data.preview);
}
function registerSource(metadata, rows) {
  state.sources = state.sources.filter((source) => source.meta.id !== metadata.id);
  state.sources.push({ meta: metadata, rows });
  state.dataset = metadata; state.rows = rows; state.filters = [];
  $("#dataset-status").textContent = `${state.sources.length} fonte(s) carregada(s). Ativa: ${metadata.name}`;
  renderFields(); renderFilters(); renderDataView(); renderRelationships(); renderCanvas(); renderConfig();
}
function elapsedTime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000), minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
async function importConnector(endpoint, payload) {
  const status = $("#dataset-status"), startedAt = performance.now();
  const label = endpoint.includes("database") ? "Consultando banco de dados" : "Consultando API";
  const trigger = endpoint.includes("database") ? $("#connect-db") : $("#connect-api");
  const originalLabel = trigger.textContent; trigger.disabled = true; trigger.textContent = "Processando…";
  status.setAttribute("aria-live", "polite");
  status.textContent = `${label}… tempo decorrido: 00:00`;
  const timer = window.setInterval(() => { status.textContent = `${label}… tempo decorrido: ${elapsedTime(performance.now() - startedAt)}`; }, 500);
  try {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const raw = await response.text(); let result = {};
    try { result = raw ? JSON.parse(raw) : {}; } catch { result = { detail: raw || `Erro HTTP ${response.status}` }; }
    if (!response.ok) { status.textContent = `${result.detail || `Falha na conexão (HTTP ${response.status})`} (${elapsedTime(performance.now() - startedAt)})`; return; }
    status.textContent = "Consulta concluída. Preparando os dados…";
    const data = await fetch(`/api/datasets/${result.id}`).then((answer) => answer.json());
    registerSource(result, data.preview);
    status.textContent = `Consulta concluída em ${elapsedTime(performance.now() - startedAt)}. ${result.rows.toLocaleString("pt-BR")} linhas carregadas.`;
  } catch (error) { status.textContent = `Falha durante a consulta após ${elapsedTime(performance.now() - startedAt)}: ${error.message || "erro de rede"}`; }
  finally { window.clearInterval(timer); trigger.disabled = false; trigger.textContent = originalLabel; }
}
function databaseConnectionInput() { return { address: $("#db-url").value.trim(), database: $("#db-database").value.trim(), db_type: $("#db-type")?.value || "mssql" }; }
function openCredentialDialog() {
  const { address, database } = databaseConnectionInput();
  $("#db-dialog-address").textContent = address || "Informe o endereço do banco";
  $("#db-dialog-database").value = database;
  $("#db-dialog-status").textContent = "";
  const dialog = $("#db-credential-dialog");
  if (dialog.showModal) dialog.showModal(); else dialog.setAttribute("open", "");
}
async function checkSavedDatabaseCredentials(openWhenMissing = false) {
  const { address, database, db_type } = databaseConnectionInput();
  const status = $("#db-credential-status");
  if (!address) { status.textContent = "Informe o endereço para verificar credenciais salvas."; return false; }
  status.textContent = "Verificando credenciais salvas…";
  try {
    const response = await fetch("/api/connectors/database/credential-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address, database, db_type }) });
    const result = await response.json();
    if (result.saved && result.valid) { status.textContent = "✓ Credenciais salvas e validadas para este banco."; return true; }
    if (result.saved) { status.textContent = "⚠ As credenciais salvas não foram validadas."; if (openWhenMissing) openCredentialDialog(); return false; }
    status.textContent = "Nenhuma credencial salva para este banco."; if (openWhenMissing) openCredentialDialog(); return false;
  } catch { status.textContent = "Não foi possível verificar as credenciais agora."; return false; }
}
async function executeDatabaseImport() {
  const { address, database, db_type } = databaseConnectionInput();
  await importConnector("/api/connectors/database", { name: $("#db-name").value.trim(), address, database, db_type, query: $("#db-query").value.trim() });
}
let savedConnections = [];
async function loadSavedConnections() {
  try {
    const response = await fetch("/api/connections"); savedConnections = response.ok ? await response.json() : [];
    $("#db-connection-select").innerHTML = '<option value="">Selecionar servidor salvo</option>' + savedConnections.map((connection) => `<option value="${escapeHtml(connection.id)}">${escapeHtml(connection.name)} — ${escapeHtml(connection.address)}${connection.database ? ` / ${escapeHtml(connection.database)}` : ""}</option>`).join("");
  } catch { $("#db-connection-select").innerHTML = '<option value="">Nenhum servidor salvo</option>'; }
}
function clearDatabaseConnection() {
  $("#db-connection-select").value = ""; $("#new-db-name").value = ""; $("#new-db-url").value = ""; $("#new-db-database").value = ""; $("#db-connection-dialog").showModal();
}
function createCalculation() {
  const name = $("#calculation-name").value.trim(), kind = $("#calculation-kind").value, expression = $("#calculation-expression").value.trim();
  const status = $("#calculation-status");
  if (!state.dataset) { status.textContent = "Importe uma base antes de criar cálculos."; return; }
  if (!name || !expression) { status.textContent = "Informe nome e fórmula."; return; }
  if (kind === "measure") {
    if (!/^(SUM|AVG|COUNT|MIN|MAX)\s*\(/i.test(expression)) { status.textContent = "Use SUM, AVG, COUNT, MIN ou MAX."; return; }
    state.measures = state.measures.filter((measure) => measure.name !== name); state.measures.push({ name, expression });
  } else {
    if (!/^[\w\s\[\]\(\)\.\+\-\*\/]+$/u.test(expression)) { status.textContent = "Use campos entre colchetes e operações matemáticas simples."; return; }
    try {
      const javascript = expression.replace(/\[([^\]]+)\]/g, (_, field) => `(Number(row[${JSON.stringify(field)}]) || 0)`);
      const calculate = new Function("row", `return ${javascript};`);
      state.rows.forEach((row) => { row[name] = calculate(row); });
      state.dataset.fields = state.dataset.fields.filter((field) => field.name !== name);
      state.dataset.fields.push({ name, dtype: "float64", kind: "number" });
    } catch { status.textContent = "Não foi possível calcular esta fórmula."; return; }
  }
  $("#calculation-name").value = ""; $("#calculation-expression").value = ""; status.textContent = `${kind === "measure" ? "Medida" : "Campo"} criado: ${name}`;
  renderFields(); renderConfig(); renderCanvas();
}
async function saveDashboard() {
  const payload = { id: state.dashboardId, name: $("#dashboard-title").textContent.trim() || "Página 1", dataset_id: state.dataset?.id || null, visuals: state.visuals, filters: state.filters, relationships: state.relationships, theme: state.theme };
  const response = await fetch("/api/dashboards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const saved = await response.json(); state.dashboardId = saved.id;
  $("#save-status").textContent = `Salvo às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

document.querySelectorAll(".panel-tab").forEach((button) => button.addEventListener("click", () => setPanel(button.dataset.panel)));
document.querySelectorAll("[data-ribbon-tab]").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll("[data-ribbon-tab]").forEach((tab) => tab.classList.toggle("active", tab === button));
  document.querySelectorAll("[data-ribbon-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.ribbonPanel === button.dataset.ribbonTab));
}));
function actionStatus(message) { $("#calculation-status").textContent = message; }
function createFromRibbon(type) { state.selected = null; addVisual(type); }
document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => {
  const action = button.dataset.action;
  if (action === "import") { setPanel("data"); $("#dataset-file").click(); return; }
  if (action === "transform") { setPanel("data"); $("#field-search").focus(); actionStatus("Selecione uma fonte e seus campos para organizar os dados."); return; }
  if (action === "refresh" || action === "apply-filters") { if (!state.visualsPaused) { renderCanvas(); renderDataView(); } actionStatus(state.visualsPaused ? "Atualização está pausada." : "Visuais atualizados."); return; }
  if (action === "new-visual") { state.selected = null; setPanel("visuals"); renderConfig(); return; }
  if (action === "new-text") { createFromRibbon("text"); return; }
  if (action === "new-image") { createFromRibbon("image"); return; }
  if (action === "new-shape") { createFromRibbon("text"); const visual = state.visuals.find((item) => item.id === state.selected); if (visual) { visual.title = "Forma"; visual.text = "Forma"; renderCanvas(); renderConfig(); } return; }
  if (action === "new-table") { createFromRibbon("table"); return; }
  if (action === "save") { saveDashboard(); return; }
  if (action === "relationships") { document.querySelector('[data-view="relations"]').click(); return; }
  if (action === "new-calculation" || action === "new-measure") { $("#calculation-kind").value = action === "new-measure" ? "measure" : "field"; $("#calculation-name").focus(); return; }
  if (action === "toggle-theme") { $("#theme-button").click(); return; }
  if (action === "toggle-grid") { canvas.classList.toggle("show-grid"); actionStatus(canvas.classList.contains("show-grid") ? "Linhas de grade exibidas." : "Linhas de grade ocultas."); return; }
  if (action === "toggle-snap") { state.snapToGrid = !state.snapToGrid; actionStatus(state.snapToGrid ? "Ajuste à grade ativado." : "Ajuste à grade desativado."); return; }
  if (action === "filters") { setPanel("filters"); return; }
  if (action === "selection") { setPanel("visuals"); actionStatus(`${state.visuals.length} visual(is) no canvas. Selecione um para editar.`); return; }
  if (action === "toggle-pause") { state.visualsPaused = !state.visualsPaused; actionStatus(state.visualsPaused ? "Atualização dos visuais pausada." : "Atualização dos visuais retomada."); return; }
  if (action === "performance") { actionStatus(`${state.visuals.length} visual(is), ${state.rows.length.toLocaleString("pt-BR")} linha(s) na fonte ativa.`); return; }
  if (action === "new-page" || action === "buttons" || action === "parameters") { actionStatus("Este recurso está preparado na interface e será configurado na próxima etapa do CDI."); return; }
  if (action === "help") { actionStatus("CDI: crie painéis arrastando visuais e campos para o canvas."); return; }
  if (action === "guided-help") { setPanel("visuals"); actionStatus("1. Importe dados. 2. Arraste um visual. 3. Arraste campos para ele."); return; }
  if (action === "documentation" || action === "support") { actionStatus("Documentação e suporte serão disponibilizados no portal do CDI."); }
}));
document.querySelectorAll(".nav-button").forEach((button) => button.addEventListener("click", () => { document.querySelectorAll(".nav-button").forEach((item) => item.classList.toggle("active", item === button)); document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === `${button.dataset.view}-view`)); }));
canvas.addEventListener("dragover", (event) => { event.preventDefault(); canvas.classList.add("dragging"); });
canvas.addEventListener("dragleave", () => canvas.classList.remove("dragging"));
canvas.addEventListener("drop", (event) => { event.preventDefault(); canvas.classList.remove("dragging"); const type = event.dataTransfer.getData("text/plain") || draggedType; if (type) addVisual(type, canvasPosition(event, type)); draggedType = null; });
canvas.addEventListener("click", (event) => { if (event.target === canvas || event.target.classList.contains("canvas-empty")) { state.selected = null; renderCanvas(); renderConfig(); } });
$("#dataset-file").addEventListener("change", async (event) => { for (const file of event.target.files) await upload(file); event.target.value = ""; });
$("#relation-source-table").addEventListener("change", () => renderRelationFieldOptions("#relation-source-table", "#relation-source-field"));
$("#relation-target-table").addEventListener("change", () => renderRelationFieldOptions("#relation-target-table", "#relation-target-field"));
$("#add-relationship").addEventListener("click", () => {
  const sourceTable = $("#relation-source-table").value, targetTable = $("#relation-target-table").value;
  const sourceField = $("#relation-source-field").value, targetField = $("#relation-target-field").value, cardinality = $("#relation-cardinality").value;
  if (!sourceTable || !targetTable || !sourceField || !targetField) { actionStatus("Importe tabelas e selecione os quatro campos do relacionamento."); return; }
  if (sourceTable === targetTable && sourceField === targetField) { actionStatus("Selecione campos diferentes para criar o relacionamento."); return; }
  const exists = state.relationships.some((relation) => relation.sourceTable === sourceTable && relation.sourceField === sourceField && relation.targetTable === targetTable && relation.targetField === targetField);
  if (exists) { actionStatus("Esse relacionamento já existe."); return; }
  const source = relationshipSource(sourceTable);
  const values = source?.rows.map((row) => String(row[sourceField] ?? "")).filter(Boolean) || [];
  if (cardinality === "one-to-many" && new Set(values).size !== values.length) { actionStatus("O campo de origem possui valores repetidos. Escolha N para N ou use uma chave única para 1 para N."); return; }
  state.relationships.push({ sourceTable, sourceField, targetTable, targetField, cardinality }); renderRelationships(); actionStatus(`Relacionamento ${cardinality === "many-to-many" ? "N para N" : "1 para N"} criado.`);
});
$("#field-search").addEventListener("input", renderFields);
$("#filter-field").addEventListener("change", updateFilterValues);
$("#add-filter").addEventListener("click", () => { const field = $("#filter-field").value, value = $("#filter-value").value; if (!field || !value) return; const sourceId = state.dataset?.id; state.filters = state.filters.filter((filter) => !(filter.field === field && filter.sourceId === sourceId)); state.filters.push({ field, value, sourceId }); renderFilters(); renderCanvas(); renderDataView(); });
$("#save-button").addEventListener("click", saveDashboard);
$("#clear-canvas").addEventListener("click", () => { state.visuals = []; state.selected = null; renderCanvas(); renderConfig(); });
$("#theme-button").addEventListener("click", () => { state.theme = state.theme === "dark" ? "light" : "dark"; document.body.classList.toggle("theme-light", state.theme === "light"); $("#theme-button").textContent = state.theme === "dark" ? "☼ Tema claro" : "◐ Tema escuro"; });
$("#theme-preset").addEventListener("change", (event) => { document.body.classList.remove("theme-ocean", "theme-forest", "theme-sunset"); state.preset = event.target.value; if (state.preset !== "violet") document.body.classList.add(`theme-${state.preset}`); });
$("#create-calculation").addEventListener("click", createCalculation);
$("#theme-preset").addEventListener("change", () => { renderCanvas(); renderConfig(); });
$("#connect-api").addEventListener("click", () => importConnector("/api/connectors/api", { name: $("#api-name").value.trim(), url: $("#api-url").value.trim() }));
$("#new-db-connection").addEventListener("click", clearDatabaseConnection);
$("#db-connection-select").addEventListener("change", async () => { const connection = savedConnections.find((item) => item.id === $("#db-connection-select").value); if (!connection) return; $("#db-name").value = connection.name; $("#db-type").value = connection.db_type || "mssql"; $("#db-url").value = connection.address; $("#db-database").value = connection.database || ""; await checkSavedDatabaseCredentials(); });
$("#begin-db-credentials").addEventListener("click", () => { const name = $("#new-db-name").value.trim(), address = $("#new-db-url").value.trim(), database = $("#new-db-database").value.trim(); if (!name || !address) return; $("#db-name").value = name; $("#db-url").value = address; $("#db-database").value = database; $("#db-type").value = $("#new-db-type").value; $("#db-connection-dialog").close(); openCredentialDialog(); });
$("#connect-db").addEventListener("click", async () => { if (await checkSavedDatabaseCredentials(true)) await executeDatabaseImport(); });
$("#toggle-db-password").addEventListener("click", () => { const password = $("#db-password"), visible = password.type === "text"; password.type = visible ? "password" : "text"; $("#toggle-db-password").textContent = visible ? "◉" : "◉̸"; $("#toggle-db-password").title = visible ? "Mostrar senha" : "Ocultar senha"; });
$("#save-db-credentials").addEventListener("click", async () => {
  const address = $("#db-url").value.trim(), database = $("#db-dialog-database").value.trim(), db_type = $("#db-type")?.value || "mssql";
  const username = $("#db-username").value.trim(), password = $("#db-password").value;
  const status = $("#db-dialog-status"); status.textContent = "Validando credenciais…";
  try {
    const response = await fetch("/api/connectors/database/credentials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: $("#db-name").value.trim(), address, database, username, password, db_type }) });
    const result = await response.json();
    if (!response.ok) { status.textContent = result.detail || "Não foi possível validar as credenciais."; return; }
    $("#db-database").value = database; $("#db-credential-dialog").close(); $("#db-credential-status").textContent = "✓ Credenciais salvas e validadas para este banco."; await loadSavedConnections(); await executeDatabaseImport();
  } catch { status.textContent = "Não foi possível salvar as credenciais."; }
});

renderTemplates(); renderFields(); renderFilters(); renderRelationships(); renderCanvas(); renderConfig(); loadSavedConnections();
