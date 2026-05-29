// TW-4 Course Rules Cesium Starter
// Optional: paste a Cesium ion token here for Cesium World Terrain.
// Without a token this still works, but terrain is the ellipsoid globe.
const CESIUM_ION_TOKEN = "";
if (CESIUM_ION_TOKEN) Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN;

const DATA = window.TW4_COURSE_RULES_DATA;
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
).then(provider => {
  viewer.imageryLayers.addImageryProvider(provider);
});
viewer.scene.globe.depthTestAgainstTerrain = false;
viewer.scene.screenSpaceCameraController.minimumZoomDistance = 500;
viewer.scene.screenSpaceCameraController.maximumZoomDistance = 600000;

if (CESIUM_ION_TOKEN) {
  Cesium.createWorldTerrainAsync().then(tp => viewer.terrainProvider = tp).catch(console.warn);
}

const colors = {
  point: Cesium.Color.CYAN,
  line: Cesium.Color.YELLOW,
  polygon: Cesium.Color.ORANGE.withAlpha(0.28)
};
const categoryPalette = [
  Cesium.Color.CYAN, Cesium.Color.LIME, Cesium.Color.YELLOW, Cesium.Color.ORANGE,
  Cesium.Color.MAGENTA, Cesium.Color.ROYALBLUE, Cesium.Color.SPRINGGREEN,
  Cesium.Color.PINK, Cesium.Color.WHITE, Cesium.Color.TOMATO
];

const entitiesByType = { point: [], line: [], polygon: [] };
const entitiesByCategory = new Map();
const routes = [];
let aircraftEntity = null;
let activeRouteEntity = null;

function cartesianFromCoord(c) {
  return Cesium.Cartesian3.fromDegrees(c[0], c[1], c[2] || 0);
}
function feet(m) { return Math.round((m || 0) * 3.28084); }
function categoryColor(category) {
  const cats = [...new Set(DATA.features.map(f => f.category))].sort();
  const idx = cats.indexOf(category);
  return categoryPalette[idx % categoryPalette.length];
}
function descriptionForFeature(f) {
  const path = f.folderPath && f.folderPath.length ? f.folderPath.join(" > ") : "Uncategorized";
  let altText = "";
  if (f.type === "line") {
    const alts = f.coordinates.map(c => c[2] || 0).filter(a => a > 0);
    if (alts.length) altText = `\nAltitude range: ${feet(Math.min(...alts))}–${feet(Math.max(...alts))} ft MSL approx`;
  } else if (f.type === "point" && f.coordinates[2]) {
    altText = `\nAltitude: ${feet(f.coordinates[2])} ft MSL approx`;
  }
  return `${f.name}\n${path}${altText}\n\n${f.description || "No notes in source KML."}`;
}

function addFeature(f) {
  const catColor = categoryColor(f.category);
  let entity;
  const common = {
    name: f.name,
    properties: {
      sourceId: f.id,
      featureType: f.type,
      category: f.category,
      folderPath: (f.folderPath || []).join(" > "),
      notes: f.description || ""
    }
  };

  if (f.type === "point") {
    entity = viewer.entities.add({
      ...common,
      position: cartesianFromCoord(f.coordinates),
      point: {
        pixelSize: 9,
        color: catColor,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.NONE
      },
      label: {
        text: f.name,
        font: "13px sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -18),
        showBackground: true,
        backgroundColor: Cesium.Color.BLACK.withAlpha(0.45),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 120000)
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
        material: catColor.withAlpha(0.92),
        clampToGround: false
      }
    });
    routes.push({ feature: f, entity });
  }

  if (f.type === "polygon") {
    const positions = f.coordinates.map(cartesianFromCoord);
    entity = viewer.entities.add({
      ...common,
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(positions),
        material: catColor.withAlpha(0.25),
        outline: true,
        outlineColor: catColor,
        perPositionHeight: true
      },
      polyline: {
        positions: [...positions, positions[0]],
        width: 2,
        material: catColor.withAlpha(0.9),
        clampToGround: false
      }
    });
  }

  if (entity) {
    entity.tw4Feature = f;
    entitiesByType[f.type].push(entity);
    if (!entitiesByCategory.has(f.category)) entitiesByCategory.set(f.category, []);
    entitiesByCategory.get(f.category).push(entity);
  }
}

DATA.features.forEach(addFeature);

function setVisible(list, show) { list.forEach(e => e.show = show); }
function updateVisibility() {
  const typeVisibility = {
    point: document.getElementById("pointsToggle").checked,
    line: document.getElementById("routesToggle").checked,
    polygon: document.getElementById("areasToggle").checked
  };
  for (const [type, list] of Object.entries(entitiesByType)) setVisible(list, typeVisibility[type]);
  for (const [category, list] of entitiesByCategory.entries()) {
    const cb = document.querySelector(`[data-category="${CSS.escape(category)}"]`);
    if (cb && !cb.checked) setVisible(list, false);
  }
}

function buildCategoryToggles() {
  const container = document.getElementById("categoryToggles");
  [...entitiesByCategory.keys()].sort().forEach(category => {
    const id = "cat_" + category.replace(/\W+/g, "_");
    const div = document.createElement("div");
    div.className = "row category";
    div.innerHTML = `<input type="checkbox" id="${id}" data-category="${category.replace(/"/g, '&quot;')}" checked><label for="${id}">${category}</label>`;
    container.appendChild(div);
    div.querySelector("input").addEventListener("change", updateVisibility);
  });
}

function buildRouteSelect() {
  const select = document.getElementById("routeSelect");
  routes
    .sort((a,b) => `${a.feature.category} ${a.feature.name}`.localeCompare(`${b.feature.category} ${b.feature.name}`))
    .forEach((r, idx) => {
      const opt = document.createElement("option");
      opt.value = idx;
      opt.textContent = `${r.feature.category} / ${r.feature.folderPath.slice(1).join(" / ")} / ${r.feature.name}`.replace(/\/ \/  \/ /g, " / ");
      select.appendChild(opt);
    });
}
function lineLabel(route) {
  const f = route.feature;
  return `${f.id} | ${f.name} | ${(f.folderPath || []).join(" > ")}`;
}

function buildLineInspector() {
  const input = document.getElementById("lineFilterInput");
  const select = document.getElementById("lineSelect");

  function refresh() {
    const q = input.value.toLowerCase().trim();
    select.innerHTML = "";

    routes.forEach((route, idx) => {
      const label = lineLabel(route);
      if (!q || label.toLowerCase().includes(q)) {
        const opt = document.createElement("option");
        opt.value = idx;
        opt.textContent = label;
        select.appendChild(opt);
      }
    });
  }

  input.addEventListener("input", refresh);
  refresh();
}

function showSelectedLineOnly() {
  const idx = Number(document.getElementById("lineSelect").value);
  const selected = routes[idx];
  if (!selected) return;

  updateVisibility();

  routes.forEach(r => {
    r.entity.show = r === selected;
    if (r.entity.polyline) r.entity.polyline.width = r === selected ? 9 : 4;
  });

  setInfo(selected.feature);
  viewer.flyTo(selected.entity);
}

function showAllLines() {
  updateVisibility();

  routes.forEach(r => {
    r.entity.show = true;
    if (r.entity.polyline) r.entity.polyline.width = 4;
  });
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

function flySelectedRoute() {
  stopFlythrough();
  const idx = Number(document.getElementById("routeSelect").value);
  const route = routes[idx];
  if (!route) return;
  activeRouteEntity = route.entity;
  if (activeRouteEntity.polyline) activeRouteEntity.polyline.width = 8;

  const coords = route.feature.coordinates;
  if (!coords || coords.length < 2) return;

  const start = Cesium.JulianDate.now();
  const property = new Cesium.SampledPositionProperty();
  let t = 0;
  for (let i=0; i<coords.length; i++) {
    if (i > 0) {
      const prev = Cesium.Cartesian3.fromDegrees(coords[i-1][0], coords[i-1][1], coords[i-1][2] || 500);
      const curr = Cesium.Cartesian3.fromDegrees(coords[i][0], coords[i][1], coords[i][2] || 500);
      const distMeters = Cesium.Cartesian3.distance(prev, curr);
      t += Math.max(3, distMeters / 95); // visual speed, not aircraft performance
    }
    property.addSample(Cesium.JulianDate.addSeconds(start, t, new Cesium.JulianDate()), cartesianFromCoord(coords[i]));
  }
  const stop = Cesium.JulianDate.addSeconds(start, t, new Cesium.JulianDate());

  aircraftEntity = viewer.entities.add({
    name: `Flythrough: ${route.feature.name}`,
    availability: new Cesium.TimeIntervalCollection([new Cesium.TimeInterval({ start, stop })]),
    position: property,
    orientation: new Cesium.VelocityOrientationProperty(property),
    point: { pixelSize: 13, color: Cesium.Color.RED, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
    path: { resolution: 1, material: Cesium.Color.RED.withAlpha(0.85), width: 3, leadTime: 0, trailTime: 9999 }
  });

  viewer.clock.startTime = start.clone();
  viewer.clock.stopTime = stop.clone();
  viewer.clock.currentTime = start.clone();
  viewer.clock.clockRange = Cesium.ClockRange.CLAMPED;
  viewer.clock.multiplier = 1;
  viewer.clock.shouldAnimate = true;
  viewer.trackedEntity = aircraftEntity;
}

function setInfo(feature) { document.getElementById("infoBox").textContent = descriptionForFeature(feature); }

viewer.selectedEntityChanged.addEventListener(entity => {
  if (entity && entity.tw4Feature) {
    setInfo(entity.tw4Feature);
    document.getElementById("selectedPanel").open = true;
  }
});

["pointsToggle", "routesToggle", "areasToggle"].forEach(id => document.getElementById(id).addEventListener("change", updateVisibility));
document.getElementById("homeBtn").addEventListener("click", corpusHome);
document.getElementById("topDownBtn").addEventListener("click", birdseye);
document.getElementById("tiltBtn").addEventListener("click", tiltView);
// document.getElementById("flyRouteBtn").addEventListener("click", flySelectedRoute);
document.getElementById("stopFlyBtn").addEventListener("click", stopFlythrough);
document.getElementById("showLineBtn").addEventListener("click", showSelectedLineOnly);
document.getElementById("showAllLinesBtn").addEventListener("click", showAllLines);

buildCategoryToggles();
// buildRouteSelect();
buildLineInspector();
corpusHome();
console.log(`Loaded ${DATA.featureCount} TW-4 features`, DATA);
