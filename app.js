// TW-4 Course Rules Cesium Operational App
const CESIUM_ION_TOKEN = "";
if (CESIUM_ION_TOKEN) Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN;

const DATA = window.TW4_COURSE_RULES_DATA || { features: [] };
const LINE_METADATA = window.TW4_LINE_METADATA || {};
const AIRPORTS = window.TW4_AIRPORTS || [];
const POINTS = window.TW4_POINTS || [];
const POLYGONS = window.TW4_POLYGONS || [];

const viewer = new Cesium.Viewer("cesiumContainer", {
  timeline: true,
  animation: true,
  baseLayerPicker: false,
  geocoder: true,
  sceneModePicker: false,
  homeButton: false,
  navigationHelpButton: false,
  infoBox: false,
  selectionIndicator: true,
  shouldAnimate: true
});

viewer.imageryLayers.removeAll();
Cesium.ArcGisMapServerImageryProvider.fromUrl(
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer"
).then(provider => viewer.imageryLayers.addImageryProvider(provider));

viewer.scene.globe.depthTestAgainstTerrain = false;
viewer.scene.screenSpaceCameraController.minimumZoomDistance = 500;
viewer.scene.screenSpaceCameraController.maximumZoomDistance = 600000;

if (CESIUM_ION_TOKEN) {
  Cesium.createWorldTerrainAsync()
    .then(tp => viewer.terrainProvider = tp)
    .catch(console.warn);
}

const categoryPalette = [
  Cesium.Color.CYAN,
  Cesium.Color.LIME,
  Cesium.Color.YELLOW,
  Cesium.Color.ORANGE,
  Cesium.Color.MAGENTA,
  Cesium.Color.ROYALBLUE,
  Cesium.Color.SPRINGGREEN,
  Cesium.Color.PINK,
  Cesium.Color.WHITE,
  Cesium.Color.TOMATO
];

const routeTypeColors = {
  departure: Cesium.Color.RED,
  arrival: Cesium.Color.LIME,
  transition: Cesium.Color.YELLOW,
  airspace: Cesium.Color.CYAN,
  pattern: Cesium.Color.ORANGE,
  initial: Cesium.Color.SPRINGGREEN,
  other: Cesium.Color.WHITE
};

const entitiesByType = { point: [], line: [], polygon: [] };
const routes = [];
const referenceEntities = [];
let aircraftEntity = null;
let activeRouteEntity = null;

function cartesianFromCoord(c) {
  return Cesium.Cartesian3.fromDegrees(c[0], c[1], c[2] || 0);
}

function feet(m) {
  return Math.round((m || 0) * 3.28084);
}

function hashColor(text) {
  if (!text) return Cesium.Color.WHITE;
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash += text.charCodeAt(i);
  return categoryPalette[Math.abs(hash) % categoryPalette.length];
}

function mergeMetadata(f) {
  if (f.type !== "line") return f;
  return { ...f, ...(LINE_METADATA[f.id] || {}) };
}

function colorForFeature(f) {
  if (f.type === "line") return routeTypeColors[f.routeType] || routeTypeColors.other;
  if (f.type === "polygon") return hashColor(f.category || f.areaType || f.name);
  return f.pointType === "airport" ? Cesium.Color.CYAN : Cesium.Color.WHITE;
}

function descriptionForFeature(f) {
  const pieces = [];
  pieces.push(f.name || f.id || "Unnamed");
  if (f.id) pieces.push(`ID: ${f.id}`);
  if (f.type) pieces.push(`Type: ${f.type}`);
  if (f.pointType) pieces.push(`Point: ${f.pointType}`);
  if (f.airport) pieces.push(`Airport: ${f.airport}`);
  if (f.runway) pieces.push(`Runway: ${f.runway}`);
  if (f.routeType) pieces.push(`Route type: ${f.routeType}`);
  if (f.routeFamily) pieces.push(`Family: ${f.routeFamily}`);
  if (f.displayGroup) pieces.push(`Group: ${f.displayGroup}`);
  if (f.from || f.to) pieces.push(`From/To: ${f.from || ""} → ${f.to || ""}`);
  if (f.floorFt || f.ceilingFt) pieces.push(`Block: ${f.floorFt || 0}–${f.ceilingFt || 0} ft`);

  if (f.type === "line" && Array.isArray(f.coordinates)) {
    const alts = f.coordinates.map(c => c[2] || 0).filter(a => a > 0);
    if (alts.length) pieces.push(`KML altitude: ${feet(Math.min(...alts))}–${feet(Math.max(...alts))} ft approx`);
  }

  if (f.folderPath?.length) pieces.push(`Source: ${f.folderPath.join(" > ")}`);
  if (f.description) pieces.push(`\n${f.description}`);
  if (f.notes) pieces.push(`\n${f.notes}`);

  return pieces.join("\n");
}

function cleanPolygonCoordinates(coords) {
  if (!Array.isArray(coords)) return [];

  // Remove bad rows and bad pasted coordinates.
  const valid = coords.filter(c =>
    Array.isArray(c) &&
    Number.isFinite(c[0]) &&
    Number.isFinite(c[1]) &&
    Math.abs(c[0]) <= 180 &&
    Math.abs(c[1]) <= 90
  );

  if (valid.length < 3) return [];

  const first = valid[0];
  const last = valid[valid.length - 1];

  if (first[0] === last[0] && first[1] === last[1]) {
    return valid.slice(0, -1);
  }

  return valid;
}

function addFeature(rawFeature) {
  const f = mergeMetadata(rawFeature);
  const catColor = colorForFeature(f);
  let entity;

  const common = {
    name: f.name,
    properties: {
      sourceId: f.id,
      featureType: f.type,
      category: f.category || "",
      routeType: f.routeType || "",
      displayGroup: f.displayGroup || "",
      routeFamily: f.routeFamily || "",
      notes: f.description || f.notes || ""
    }
  };

  if (f.type === "point") {
    entity = viewer.entities.add({
      ...common,
      position: cartesianFromCoord(f.coordinates),
      point: {
        pixelSize: f.pointType === "airport" ? 11 : 8,
        color: catColor,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2
      },
      label: {
        text: f.label || f.name,
        font: "13px sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -18),
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.45),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 140000)
      }
    });
  }

  if (f.type === "line") {
    const positions = f.coordinates.map(cartesianFromCoord);

    entity = viewer.entities.add({
      ...common,
      polyline: {
        positions,
        width: 4,
        material: catColor.withAlpha(0.95),
        clampToGround: false
      }
    });

    routes.push({ feature: f, entity });
  }

  if (f.type === "polygon") {
    const coords = cleanPolygonCoordinates(f.coordinates || []);
    if (coords.length < 3) return;

    const floorMeters = Math.max(0, (f.floorFt || 0) * 0.3048);
    const ceilingMeters = Math.max(floorMeters + 1, (f.ceilingFt || f.floorFt || 0) * 0.3048);

    const hierarchyPositions = coords.map(c =>
      Cesium.Cartesian3.fromDegrees(c[0], c[1])
    );

    const bottom = coords.map(c =>
      Cesium.Cartesian3.fromDegrees(c[0], c[1], floorMeters)
    );

    const top = coords.map(c =>
      Cesium.Cartesian3.fromDegrees(c[0], c[1], ceilingMeters)
    );

    const bottomClosed = [...bottom, bottom[0]];
    const topClosed = [...top, top[0]];

    // Main 3D MOA volume.
    entity = viewer.entities.add({
      ...common,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(hierarchyPositions),
        height: ceilingMeters,
        extrudedHeight: floorMeters,
        material: catColor.withAlpha(0.20),
        outline: true,
        outlineColor: catColor.withAlpha(0.95),
        closeTop: true,
        closeBottom: true
      }
    });

    // Bottom outline.
    viewer.entities.add({
      ...common,
      polyline: {
        positions: bottomClosed,
        width: 2,
        material: catColor.withAlpha(0.55),
        clampToGround: false
      }
    });

    // Top outline.
    viewer.entities.add({
      ...common,
      polyline: {
        positions: topClosed,
        width: 3,
        material: catColor.withAlpha(0.95),
        clampToGround: false
      }
    });

    // Vertical corner lines.
    for (let i = 0; i < bottom.length; i++) {
      viewer.entities.add({
        ...common,
        polyline: {
          positions: [bottom[i], top[i]],
          width: 1,
          material: catColor.withAlpha(0.65),
          clampToGround: false
        }
      });
    }
  }

  if (entity) {
    entity.tw4Feature = f;
    if (entitiesByType[f.type]) entitiesByType[f.type].push(entity);
    return entity;
  }
}

DATA.features.forEach(addFeature);

function getRouteMetaList() {
  return routes.map((route, idx) => ({
    idx,
    entity: route.entity,
    feature: route.feature,
    meta: LINE_METADATA[route.feature.id] || {}
  }));
}

function setOptions(selectId, items, labelFn, valueFn = x => x) {
  const select = document.getElementById(selectId);
  if (!select) return;

  select.innerHTML = "";

  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "-- Select --";
  select.appendChild(blank);

  items.forEach(item => {
    const opt = document.createElement("option");
    opt.value = valueFn(item);
    opt.textContent = labelFn(item);
    select.appendChild(opt);
  });
}

function uniqueSorted(arr) {
  return [...new Set(arr.filter(Boolean))].sort();
}

function populateMissionBuilder() {
  setOptions(
    "departureAirportSelect",
    AIRPORTS,
    a => `${a.airportCode} - ${a.airportName}`,
    a => a.airportCode
  );

  setOptions(
    "recoveryAirportSelect",
    AIRPORTS,
    a => `${a.airportCode} - ${a.airportName}`,
    a => a.airportCode
  );

  updateDepartureRunways();
  updateRecoveryRunways();
  updateDestinationOptions();
}

function getAirportByCode(code) {
  return AIRPORTS.find(a => a.airportCode === code);
}

function updateDepartureRunways() {
  const airportCode = document.getElementById("departureAirportSelect")?.value;
  const airport = getAirportByCode(airportCode);

  setOptions("departureRunwaySelect", airport?.runways || [], r => `RWY ${r}`);
  updateDepartureRoutes();
}

function updateDepartureRoutes() {
  const airport = document.getElementById("departureAirportSelect")?.value;
  const runway = document.getElementById("departureRunwaySelect")?.value;

  const matches = getRouteMetaList().filter(r =>
    r.meta.airport === airport &&
    r.meta.runway === runway &&
    r.meta.routeType === "departure"
  );

  setOptions(
    "departureRouteSelect",
    matches,
    r => `${r.meta.routeFamily || r.meta.name || r.feature.name}`,
    r => r.idx
  );
}

function updateDestinationOptions() {
  const destinations = [
    ...AIRPORTS.map(a => ({
      type: "airport",
      id: a.airportCode,
      label: `${a.airportCode} - ${a.airportName}`
    })),
    ...(window.TW4_POLYGONS || []).map(p => ({
      type: "area",
      id: p.id,
      label: p.name
    }))
  ];

  setOptions("destinationSelect", destinations, d => d.label, d => `${d.type}:${d.id}`);
}

function updateDestinationArrivals() {
  const value = document.getElementById("destinationSelect")?.value;
  if (!value) return;

  const [type, id] = value.split(":");
  const airport = type === "airport" ? id : "";

  const arrivals = getRouteMetaList().filter(r =>
    airport &&
    r.meta.airport === airport &&
    r.meta.routeType === "arrival"
  );

  setOptions(
    "destinationArrivalSelect",
    arrivals,
    r => `${r.meta.routeFamily || r.meta.name || r.feature.name}${r.meta.runway ? " - RWY " + r.meta.runway : ""}`,
    r => r.idx
  );

  const departures = getRouteMetaList().filter(r =>
    airport &&
    r.meta.airport === airport &&
    r.meta.routeType === "departure"
  );

  setOptions(
    "destinationDepartureSelect",
    departures,
    r => `${r.meta.routeFamily || r.meta.name || r.feature.name}${r.meta.runway ? " - RWY " + r.meta.runway : ""}`,
    r => r.idx
  );
}

function updateRecoveryRunways() {
  const airportCode = document.getElementById("recoveryAirportSelect")?.value;
  const airport = getAirportByCode(airportCode);

  setOptions("recoveryRunwaySelect", airport?.runways || [], r => `RWY ${r}`);
  updateRecoveryArrivals();
}

function updateRecoveryArrivals() {
  const airport = document.getElementById("recoveryAirportSelect")?.value;
  const runway = document.getElementById("recoveryRunwaySelect")?.value;

  const matches = getRouteMetaList().filter(r =>
    r.meta.airport === airport &&
    (!runway || r.meta.runway === runway || !r.meta.runway) &&
    r.meta.routeType === "arrival"
  );

  setOptions(
    "recoveryArrivalSelect",
    matches,
    r => `${r.meta.routeFamily || r.meta.name || r.feature.name}${r.meta.runway ? " - RWY " + r.meta.runway : ""}`,
    r => r.idx
  );
}

function getSelectedMissionRoutes() {
  const ids = [
    "departureRouteSelect",
    "destinationArrivalSelect",
    "destinationDepartureSelect",
    "recoveryArrivalSelect"
  ];

  return ids
    .map(id => Number(document.getElementById(id)?.value))
    .filter(n => Number.isInteger(n))
    .map(idx => routes[idx])
    .filter(Boolean);
}

function showSelectedMission() {
  const selected = getSelectedMissionRoutes();

  updateVisibility();

  routes.forEach(r => {
    const active = selected.includes(r);
    r.entity.show = active;
    if (r.entity.polyline) r.entity.polyline.width = active ? 9 : 4;
  });

  if (selected.length) viewer.flyTo(selected.map(r => r.entity));
}

[...AIRPORTS, ...POINTS, ...POLYGONS].forEach(f => {
  const entity = addFeature(f);
  if (entity) referenceEntities.push(entity);
});

function setVisible(list, show) {
  list.forEach(e => e.show = show);
}

function updateVisibility() {
  setVisible(entitiesByType.point, document.getElementById("pointsToggle")?.checked ?? true);
  setVisible(entitiesByType.line, document.getElementById("routesToggle")?.checked ?? true);
  setVisible(entitiesByType.polygon, document.getElementById("areasToggle")?.checked ?? true);
}

function corpusHome() {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(-97.45, 27.72, 90000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-62),
      roll: 0
    },
    duration: 1.5
  });
}

function birdseye() {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(-97.45, 27.72, 115000),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(-90),
      roll: 0
    },
    duration: 1.2
  });
}

function tiltView() {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(-97.35, 27.55, 55000),
    orientation: {
      heading: Cesium.Math.toRadians(335),
      pitch: Cesium.Math.toRadians(-45),
      roll: 0
    },
    duration: 1.2
  });
}

function stopFlythrough() {
  viewer.trackedEntity = undefined;
  viewer.clock.shouldAnimate = false;

  if (aircraftEntity) {
    viewer.entities.remove(aircraftEntity);
    aircraftEntity = null;
  }

  if (activeRouteEntity && activeRouteEntity.polyline) {
    activeRouteEntity.polyline.width = 4;
  }

  activeRouteEntity = null;
}

function setInfo(feature) {
  const box = document.getElementById("infoBox");
  if (box) box.textContent = descriptionForFeature(feature);
}

viewer.selectedEntityChanged.addEventListener(entity => {
  if (entity && entity.tw4Feature) {
    setInfo(entity.tw4Feature);

    const selectedPanel = document.getElementById("selectedPanel");
    if (selectedPanel) selectedPanel.open = true;
  }
});

["pointsToggle", "routesToggle", "areasToggle"].forEach(id =>
  document.getElementById(id)?.addEventListener("change", updateVisibility)
);

document.getElementById("homeBtn")?.addEventListener("click", corpusHome);
document.getElementById("topDownBtn")?.addEventListener("click", birdseye);
document.getElementById("tiltBtn")?.addEventListener("click", tiltView);
document.getElementById("stopFlyBtn")?.addEventListener("click", stopFlythrough);
document.getElementById("togglePanelBtn")?.addEventListener("click", () => {
  document.getElementById("panel")?.classList.toggle("collapsed");
});

document.getElementById("departureAirportSelect")?.addEventListener("change", updateDepartureRunways);
document.getElementById("departureRunwaySelect")?.addEventListener("change", updateDepartureRoutes);
document.getElementById("destinationSelect")?.addEventListener("change", updateDestinationArrivals);
document.getElementById("recoveryAirportSelect")?.addEventListener("change", updateRecoveryRunways);
document.getElementById("recoveryRunwaySelect")?.addEventListener("change", updateRecoveryArrivals);
document.getElementById("showMissionBtn")?.addEventListener("click", showSelectedMission);

let selectedQuickViewGroup = "";

const QUICK_VIEW_GROUPS = {
  departures: [
    { key: "all", label: "All Departures", aliases: [] },
    { key: "beachline", label: "Beachline", aliases: ["beachline"] },
    { key: "rusty", label: "Rusty", aliases: ["rusty"] }
  ],
  arrivals: [
    { key: "all", label: "All Arrivals", aliases: [] },
    { key: "shamrock", label: "Shamrock", aliases: ["shamrock"] },
    { key: "northern", label: "Northern", aliases: ["northern"] },
    { key: "ne", label: "NE", aliases: ["ne arrival", "northeast", "north east"] }
  ],
  workingAreas: [
    { key: "all", label: "All Working Areas", aliases: [] },
    { key: "mustang", label: "Mustang", aliases: ["mustang"] },
    { key: "kings", label: "Kings 4", aliases: ["kings"] },
    { key: "foxtrot", label: "Foxtrot", aliases: ["foxtrot"] }
  ],
  airfields: [
    { key: "all", label: "All Airfields", aliases: [] },
    ...AIRPORTS.map(a => ({
      key: a.airportCode,
      label: a.airportCode,
      aliases: [a.airportCode, a.airportName]
    }))
  ]
};

function routeText(r) {
  return [
    r.meta.routeFamily,
    r.meta.name,
    r.meta.airport,
    r.meta.runway,
    r.feature.name,
    r.feature.id,
    r.feature.routeFamily,
    r.feature.airport,
    r.feature.runway
  ].filter(Boolean).join(" ").toLowerCase();
}

function routeMatchesGroup(r, group) {
  if (!group || group.key === "all") return true;
  const text = routeText(r);
  return group.aliases.some(alias => text.includes(alias.toLowerCase()));
}

function areaMatchesGroup(p, group) {
  if (!group || group.key === "all") return true;
  const text = `${p.name || ""} ${p.id || ""} ${p.category || ""}`.toLowerCase();
  return group.aliases.some(alias => text.includes(alias.toLowerCase()));
}

function airportMatchesGroup(f, group) {
  if (!group || group.key === "all") return true;
  const text = `${f.airportCode || ""} ${f.airport || ""} ${f.id || ""} ${f.name || ""} ${f.label || ""}`.toLowerCase();
  return group.aliases.some(alias => text.includes(alias.toLowerCase()));
}

function hideAllEntities() {
  viewer.entities.values.forEach(e => e.show = false);
}

function showEntityList(entityList) {
  entityList.forEach(e => e.show = true);
}

function getRoutesByTypeAndGroup(type, group) {
  const routeType = type === "departures" ? "departure" : "arrival";

  return getRouteMetaList().filter(r =>
    (r.meta.routeType === routeType || r.feature.routeType === routeType) &&
    routeMatchesGroup(r, group)
  );
}

function getAreasByGroup(group) {
  return POLYGONS.filter(p => areaMatchesGroup(p, group));
}

function getAirportEntitiesByGroup(group) {
  if (group.key === "all") {
    return entitiesByType.point.filter(e => e.tw4Feature?.pointType === "airport");
  }

  const pointEntities = entitiesByType.point.filter(e =>
    e.tw4Feature && airportMatchesGroup(e.tw4Feature, group)
  );

  const routeEntities = routes
    .filter(r => routeMatchesGroup(
      {
        meta: LINE_METADATA[r.feature.id] || {},
        feature: r.feature
      },
      group
    ))
    .map(r => r.entity);

  return [...pointEntities, ...routeEntities];
}

function populateQuickViewGroups() {
  const type = document.getElementById("quickViewTypeSelect")?.value;
  const container = document.getElementById("quickViewGroups");
  const itemSelect = document.getElementById("quickViewItemSelect");
  if (!container || !itemSelect) return;

  selectedQuickViewGroup = "";
  container.innerHTML = "";
  itemSelect.innerHTML = `<option value="">-- Select group first --</option>`;

  const groups = QUICK_VIEW_GROUPS[type] || [];

  groups.forEach(group => {
    let hasContent = true;

    if (type === "departures" || type === "arrivals") {
      hasContent = getRoutesByTypeAndGroup(type, group).length > 0;
    }

    if (type === "workingAreas") {
      hasContent = getAreasByGroup(group).length > 0;
    }

    if (!hasContent && group.key !== "all") return;

    const btn = document.createElement("button");
    btn.textContent = group.label;

    btn.onclick = () => {
      selectedQuickViewGroup = group.key;

      [...container.querySelectorAll("button")].forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      populateQuickViewItems(type, group);
    };

    container.appendChild(btn);
  });
}

function populateQuickViewItems(type, group) {
  const itemSelect = document.getElementById("quickViewItemSelect");
  if (!itemSelect) return;

  itemSelect.innerHTML = "";

  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "-- Select --";
  itemSelect.appendChild(blank);

  const all = document.createElement("option");
  all.value = `group:${type}:${group.key}`;
  all.textContent = `Show ${group.label}`;
  itemSelect.appendChild(all);

  let items = [];

  if (type === "departures" || type === "arrivals") {
    items = getRoutesByTypeAndGroup(type, group).map(r => ({
      value: `route:${r.idx}`,
      label: `${r.meta.runway ? "RWY " + r.meta.runway + " - " : ""}${r.meta.name || r.meta.routeFamily || r.feature.name}`
    }));
  }

  if (type === "workingAreas") {
    items = getAreasByGroup(group).map(p => ({
      value: `area:${p.id}`,
      label: p.name || p.id
    }));
  }

  if (type === "airfields" && group.key !== "all") {
    items = [{
      value: `airport:${group.key}`,
      label: `Show ${group.label}`
    }];
  }

  items.sort((a, b) => a.label.localeCompare(b.label)).forEach(item => {
    const opt = document.createElement("option");
    opt.value = item.value;
    opt.textContent = item.label;
    itemSelect.appendChild(opt);
  });
}

function showQuickViewSelection() {
  const value = document.getElementById("quickViewItemSelect")?.value;
  if (!value) return;

  const parts = value.split(":");
  const kind = parts[0];

  hideAllEntities();

  let selectedEntities = [];

  if (kind === "route") {
    const idx = Number(parts[1]);
    selectedEntities = routes[idx] ? [routes[idx].entity] : [];
  }

  if (kind === "area") {
    const areaId = parts[1];
    selectedEntities = entitiesByType.polygon.filter(e => e.tw4Feature?.id === areaId);
  }

  if (kind === "airport") {
    const airportCode = parts[1];
    const group = QUICK_VIEW_GROUPS.airfields.find(g => g.key === airportCode);
    selectedEntities = getAirportEntitiesByGroup(group);
  }

  if (kind === "group") {
    const type = parts[1];
    const groupKey = parts[2];
    const group = QUICK_VIEW_GROUPS[type].find(g => g.key === groupKey);

    if (type === "departures" || type === "arrivals") {
      selectedEntities = getRoutesByTypeAndGroup(type, group).map(r => r.entity);
    }

    if (type === "workingAreas") {
      const areas = getAreasByGroup(group);
      selectedEntities = entitiesByType.polygon.filter(e =>
        areas.some(p => p.id === e.tw4Feature?.id)
      );
    }

    if (type === "airfields") {
      selectedEntities = getAirportEntitiesByGroup(group);
    }
  }

  showEntityList(selectedEntities);
  if (selectedEntities.length) viewer.flyTo(selectedEntities);
}

function resetQuickView() {
  updateVisibility();

  const itemSelect = document.getElementById("quickViewItemSelect");
  if (itemSelect) itemSelect.value = "";
}

document.getElementById("quickViewTypeSelect")?.addEventListener("change", populateQuickViewGroups);
document.getElementById("showQuickViewBtn")?.addEventListener("click", showQuickViewSelection);
document.getElementById("resetQuickViewBtn")?.addEventListener("click", resetQuickView);

populateMissionBuilder();
corpusHome();

console.log(
  `Loaded ${DATA.features.length} KML features, ${routes.length} routes, ${AIRPORTS.length} airports, ${POINTS.length} waypoints, ${POLYGONS.length} polygons`
);
