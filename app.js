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
if (CESIUM_ION_TOKEN) Cesium.createWorldTerrainAsync().then(tp => viewer.terrainProvider = tp).catch(console.warn);

const categoryPalette = [
  Cesium.Color.CYAN, Cesium.Color.LIME, Cesium.Color.YELLOW, Cesium.Color.ORANGE,
  Cesium.Color.MAGENTA, Cesium.Color.ROYALBLUE, Cesium.Color.SPRINGGREEN,
  Cesium.Color.PINK, Cesium.Color.WHITE, Cesium.Color.TOMATO
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

function cartesianFromCoord(c) { return Cesium.Cartesian3.fromDegrees(c[0], c[1], c[2] || 0); }
function feet(m) { return Math.round((m || 0) * 3.28084); }
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
      point: { pixelSize: f.pointType === "airport" ? 11 : 8, color: catColor, outlineColor: Cesium.Color.BLACK, outlineWidth: 2 },
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
      polyline: { positions, width: 4, material: catColor.withAlpha(0.95), clampToGround: false }
    });
    routes.push({ feature: f, entity });
  }

if (f.type === "polygon") {
  const coords = f.coordinates || [];
  if (!coords.length) return;

  const floorMeters = (f.floorFt || 0) * 0.3048;
  const ceilingMeters = (f.ceilingFt || f.floorFt || 0) * 0.3048;

  const bottom = coords.map(c =>
    Cesium.Cartesian3.fromDegrees(c[0], c[1], floorMeters)
  );

  const top = coords.map(c =>
    Cesium.Cartesian3.fromDegrees(c[0], c[1], ceilingMeters)
  );

  const bottomClosed = [...bottom, bottom[0]];
  const topClosed = [...top, top[0]];

  entity = viewer.entities.add({
    ...common,
    polyline: {
      positions: bottomClosed,
      width: 2,
      material: catColor.withAlpha(0.45),
      clampToGround: false
    }
  });

  viewer.entities.add({
    ...common,
    polyline: {
      positions: topClosed,
      width: 3,
      material: catColor.withAlpha(0.95),
      clampToGround: false
    }
  });

  for (let i = 0; i < bottom.length; i++) {
    viewer.entities.add({
      ...common,
      polyline: {
        positions: [bottom[i], top[i]],
        width: 1,
        material: catColor.withAlpha(0.55),
        clampToGround: false
      }
    });
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
  const airportCode = document.getElementById("departureAirportSelect").value;
  const airport = getAirportByCode(airportCode);
  setOptions("departureRunwaySelect", airport?.runways || [], r => `RWY ${r}`);
  updateDepartureRoutes();
}

function updateDepartureRoutes() {
  const airport = document.getElementById("departureAirportSelect").value;
  const runway = document.getElementById("departureRunwaySelect").value;

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
    ...AIRPORTS.map(a => ({ type: "airport", id: a.airportCode, label: `${a.airportCode} - ${a.airportName}` })),
    ...(window.TW4_POLYGONS || []).map(p => ({ type: "area", id: p.id, label: p.name }))
  ];

  setOptions("destinationSelect", destinations, d => d.label, d => `${d.type}:${d.id}`);
}

function updateDestinationArrivals() {
  const value = document.getElementById("destinationSelect").value;
  if (!value) return;

  const [type, id] = value.split(":");
  const airport = type === "airport" ? id : "";

  const matches = getRouteMetaList().filter(r =>
    airport &&
    r.meta.airport === airport &&
    r.meta.routeType === "arrival"
  );

  setOptions(
    "destinationArrivalSelect",
    matches,
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
  const airportCode = document.getElementById("recoveryAirportSelect").value;
  const airport = getAirportByCode(airportCode);
  setOptions("recoveryRunwaySelect", airport?.runways || [], r => `RWY ${r}`);
  updateRecoveryArrivals();
}

function updateRecoveryArrivals() {
  const airport = document.getElementById("recoveryAirportSelect").value;
  const runway = document.getElementById("recoveryRunwaySelect").value;

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
    .map(id => Number(document.getElementById(id).value))
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

function setVisible(list, show) { list.forEach(e => e.show = show); }
function updateVisibility() {
  setVisible(entitiesByType.point, document.getElementById("pointsToggle").checked);
  setVisible(entitiesByType.line, document.getElementById("routesToggle").checked);
  setVisible(entitiesByType.polygon, document.getElementById("areasToggle").checked);
}

function corpusHome() {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(-97.45, 27.72, 90000),
    orientation: { heading: Cesium.Math.toRadians(0), pitch: Cesium.Math.toRadians(-62), roll: 0 },
    duration: 1.5
  });
}
function birdseye() {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(-97.45, 27.72, 115000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
    duration: 1.2
  });
}
function tiltView() {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(-97.35, 27.55, 55000),
    orientation: { heading: Cesium.Math.toRadians(335), pitch: Cesium.Math.toRadians(-45), roll: 0 },
    duration: 1.2
  });
}
function stopFlythrough() {
  viewer.trackedEntity = undefined;
  viewer.clock.shouldAnimate = false;
  if (aircraftEntity) { viewer.entities.remove(aircraftEntity); aircraftEntity = null; }
  if (activeRouteEntity && activeRouteEntity.polyline) activeRouteEntity.polyline.width = 4;
  activeRouteEntity = null;
}
function setInfo(feature) { document.getElementById("infoBox").textContent = descriptionForFeature(feature); }
viewer.selectedEntityChanged.addEventListener(entity => {
  if (entity && entity.tw4Feature) {
    setInfo(entity.tw4Feature);
    const selectedPanel = document.getElementById("selectedPanel");
    if (selectedPanel) selectedPanel.open = true;
  }
});

["pointsToggle", "routesToggle", "areasToggle"].forEach(id => document.getElementById(id)?.addEventListener("change", updateVisibility));
document.getElementById("homeBtn")?.addEventListener("click", corpusHome);
document.getElementById("topDownBtn")?.addEventListener("click", birdseye);
document.getElementById("tiltBtn")?.addEventListener("click", tiltView);
document.getElementById("stopFlyBtn")?.addEventListener("click", stopFlythrough);
document.getElementById("togglePanelBtn")?.addEventListener("click", () => document.getElementById("panel").classList.toggle("collapsed"));
document.getElementById("departureAirportSelect").addEventListener("change", updateDepartureRunways);
document.getElementById("departureRunwaySelect").addEventListener("change", updateDepartureRoutes);

document.getElementById("destinationSelect").addEventListener("change", updateDestinationArrivals);

document.getElementById("recoveryAirportSelect").addEventListener("change", updateRecoveryRunways);
document.getElementById("recoveryRunwaySelect").addEventListener("change", updateRecoveryArrivals);

document.getElementById("showMissionBtn").addEventListener("click", showSelectedMission);

populateMissionBuilder();
corpusHome();
console.log(`Loaded ${DATA.features.length} KML features, ${routes.length} routes, ${AIRPORTS.length} airports, ${POINTS.length} waypoints, ${POLYGONS.length} polygons`);
