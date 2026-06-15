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


function hideAllEntities() {
  viewer.entities.values.forEach(e => e.show = false);
}

function showEntityList(entityList) {
  entityList.forEach(e => e.show = true);
}

function getPolygonEntitiesById(areaId) {
  return entitiesByType.polygon.filter(e => e.tw4Feature && e.tw4Feature.id === areaId);
}

function getAirportPointEntities(airportCode) {
  return entitiesByType.point.filter(e => {
    const f = e.tw4Feature || {};
    return f.airportCode === airportCode || f.airport === airportCode || f.id === airportCode || f.name === airportCode || f.label === airportCode;
  });
}

function getRouteEntityByIndex(idx) {
  const route = routes[idx];
  return route ? [route.entity] : [];
}

let selectedQuickViewGroup = "";

function routeFamilyName(r) {
  return r.meta.routeFamily || r.meta.name || r.feature.routeFamily || r.feature.name || "Other";
}

function populateQuickViewGroups() {
  const type = document.getElementById("quickViewTypeSelect")?.value;
  const container = document.getElementById("quickViewGroups");
  const itemSelect = document.getElementById("quickViewItemSelect");
  if (!container || !itemSelect) return;

  selectedQuickViewGroup = "";
  container.innerHTML = "";
  itemSelect.innerHTML = `<option value="">-- Select group first --</option>`;

  let groups = [];

  if (type === "departures") {
    groups = [...new Set(
      getRouteMetaList()
        .filter(r => r.meta.routeType === "departure" || r.feature.routeType === "departure")
        .map(routeFamilyName)
    )];
  }

  if (type === "arrivals") {
    groups = [...new Set(
      getRouteMetaList()
        .filter(r => r.meta.routeType === "arrival" || r.feature.routeType === "arrival")
        .map(routeFamilyName)
    )];
  }

  if (type === "workingAreas") {
    groups = [...new Set(
      POLYGONS.map(p => {
        const name = p.name || p.id || "";
        if (name.toLowerCase().includes("mustang")) return "Mustang";
        if (name.toLowerCase().includes("kings")) return "Kings 4";
        if (name.toLowerCase().includes("foxtrot")) return "Foxtrot";
        return p.category || "Other";
      })
    )];
  }

  if (type === "airfields") {
    groups = AIRPORTS.map(a => a.airportCode);
  }

  groups.sort().forEach(group => {
    const btn = document.createElement("button");
    btn.textContent = group;

    btn.onclick = () => {
      selectedQuickViewGroup = group;

      [...container.querySelectorAll("button")].forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      populateQuickViewItems(group);
    };

    container.appendChild(btn);
  });
}

function populateQuickViewItems(groupName) {
  const type = document.getElementById("quickViewTypeSelect")?.value;
  const itemSelect = document.getElementById("quickViewItemSelect");
  if (!itemSelect) return;

  itemSelect.innerHTML = "";

  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "-- Select --";
  itemSelect.appendChild(blank);

  const all = document.createElement("option");
  all.value = `group:${type}:${groupName}`;
  all.textContent = `All ${groupName}`;
  itemSelect.appendChild(all);

  let items = [];

  if (type === "departures") {
    items = getRouteMetaList()
      .filter(r => (r.meta.routeType === "departure" || r.feature.routeType === "departure"))
      .filter(r => routeFamilyName(r) === groupName)
      .map(r => ({
        value: `route:${r.idx}`,
        label: `${r.meta.runway ? "RWY " + r.meta.runway + " - " : ""}${r.meta.name || r.feature.name}`
      }));
  }

  if (type === "arrivals") {
    items = getRouteMetaList()
      .filter(r => (r.meta.routeType === "arrival" || r.feature.routeType === "arrival"))
      .filter(r => routeFamilyName(r) === groupName)
      .map(r => ({
        value: `route:${r.idx}`,
        label: `${r.meta.runway ? "RWY " + r.meta.runway + " - " : ""}${r.meta.name || r.feature.name}`
      }));
  }

  if (type === "workingAreas") {
    items = POLYGONS
      .filter(p => (p.name || "").toLowerCase().includes(groupName.toLowerCase().replace(" 4", "")))
      .map(p => ({
        value: `area:${p.id}`,
        label: p.name || p.id
      }));
  }

  if (type === "airfields") {
    items = [{
      value: `airport:${groupName}`,
      label: `Show ${groupName}`
    }];
  }

  items.sort((a, b) => a.label.localeCompare(b.label)).forEach(item => {
    const opt = document.createElement("option");
    opt.value = item.value;
    opt.textContent = item.label;
    itemSelect.appendChild(opt);
  });
}

  if (type === "arrivals") {
    items = getRouteMetaList()
      .filter(r => r.meta.routeType === "arrival" || r.feature.routeType === "arrival")
      .map(r => ({
        value: `route:${r.idx}`,
        label: `${r.meta.airport || r.feature.airport || ""} ${r.meta.runway ? "RWY " + r.meta.runway + " " : ""}${r.meta.routeFamily || r.meta.name || r.feature.name}`
      }));
  }

  if (type === "workingAreas") {
    items = POLYGONS.map(p => ({
      value: `area:${p.id}`,
      label: p.name || p.id
    }));
  }

  if (type === "airfields") {
    items = AIRPORTS.map(a => ({
      value: `airport:${a.airportCode}`,
      label: `${a.airportCode} - ${a.airportName}`
    }));
  }

  items
    .filter(item => item.label)
    .sort((a, b) => a.label.localeCompare(b.label))
    .forEach(item => {
      const opt = document.createElement("option");
      opt.value = item.value;
      opt.textContent = item.label;
      itemSelect.appendChild(opt);
    });
}

function showQuickViewSelection() {
  const value = document.getElementById("quickViewItemSelect")?.value;
  if (!value) return;

  const [kind, id] = value.split(":");
  hideAllEntities();

  let selectedEntities = [];
  if (kind === "route") selectedEntities = getRouteEntityByIndex(Number(id));
  if (kind === "area") selectedEntities = getPolygonEntitiesById(id);
  if (kind === "airport") selectedEntities = getAirportPointEntities(id);

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
