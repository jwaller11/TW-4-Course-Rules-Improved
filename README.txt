TW-4 Cesium Starter
===================

Files:
- index.html: open this through a local web server
- app.js: Cesium app, toggles, camera views, flythrough
- courseRulesData.js: cleaned/converted data from your KML
- styles.css: sidebar/map styling

How to run on Windows:
1. Unzip this folder.
2. Open PowerShell in the folder.
3. Run:
   python -m http.server 8000
4. Open:
   http://localhost:8000

How to run on Mac/Linux:
   python3 -m http.server 8000

Notes:
- This starter uses Cesium from the public CDN, so internet is required for Cesium itself.
- It does NOT require a Cesium ion token for the basic globe.
- For real terrain, paste your Cesium ion token into app.js at CESIUM_ION_TOKEN.
- KML altitudes were preserved as meters. The sidebar displays approximate feet.
- Use this as a visualization/study tool only. Verify current procedures, routes, and course rules against official/current sources.
