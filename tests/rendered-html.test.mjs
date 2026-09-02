import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";

const text = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("builds the browser application from the shared Vite entry", async () => {
  const [sourceHtml, builtHtml, main, packageJson, viteConfig] = await Promise.all([
    text("../mobile/index.html"),
    text("../mobile-dist/index.html"),
    text("../mobile/main.tsx"),
    text("../package.json"),
    text("../vite.mobile.config.ts"),
  ]);

  assert.match(sourceHtml, /<title>行迹 · 我的本地行程记录<\/title>/);
  assert.match(builtHtml, /assets\/index-[^"']+\.js/);
  assert.match(main, /Home from "\.\.\/app\/page"/);
  assert.match(main, /"\.\.\/app\/globals\.css"/);
  assert.match(packageJson, /"dev": "vite --config vite\.mobile\.config\.ts"/);
  assert.match(viteConfig, /port: 3000/);
});

test("starts empty and never embeds private journey history", async () => {
  const [page, gitignore] = await Promise.all([
    text("../app/page.tsx"),
    text("../.gitignore"),
  ]);

  assert.match(page, /useState<JourneyDay\[\]>\(\[\]\)/);
  assert.match(page, /const firstJourneyDate = useMemo/);
  assert.match(page, /overviewMode === "all"\) return \{ start: firstJourneyDate, end: today \}/);
  assert.match(page, /\.filter\(\(snapshot\) => snapshot\.known\)/);
  assert.doesNotMatch(page, /seedJourneys|mergeHistoricalSeeds|DEFAULT_STATE_CHANGES/);
  assert.doesNotMatch(page, /j(?:23|24|25|26)\d{4}/);
  assert.match(gitignore, /private travel data and exports/);
  assert.match(gitignore, /行迹数据\*\.json/);
});

test("keeps platform storage isolated behind one adapter", async () => {
  const [page, storage, capacitor, macApp, macBuild, types] = await Promise.all([
    text("../app/page.tsx"),
    text("../app/platform/device-storage.ts"),
    text("../capacitor.config.ts"),
    text("../macos/XingjiApp.swift"),
    text("../scripts/build-macos-app.sh"),
    text("../app/core/types.ts"),
  ]);

  assert.match(page, /from "\.\/platform\/device-storage"/);
  assert.match(storage, /Application Support\/io\.github\.peng61\.xingji/);
  assert.match(storage, /window as DesktopWindow/);
  assert.match(storage, /import\("@capacitor\/filesystem"\)/);
  assert.match(capacitor, /appId: "io\.github\.peng61\.xingji"/);
  assert.match(macApp, /appendingPathComponent\("行迹"/);
  assert.match(macApp, /journeys-v1\.json/);
  assert.match(macApp, /case "export"/);
  assert.match(macApp, /case "import"/);
  assert.match(macBuild, /mobile-dist/);
  assert.match(macBuild, /io\.github\.peng61\.xingji\.macos/);
  assert.match(types, /export type JourneyDay/);
});

test("keeps the complete travel product feature set", async () => {
  const [page, css] = await Promise.all([
    text("../app/page.tsx"),
    text("../app/globals.css"),
  ]);

  for (const phrase of [
    "所有记录", "自定义时间", "年度视图", "刷新数据", "导出数据", "导入数据",
    "中国省级行政区行迹地图", "怎么走，又常走哪条路", "热门路线", "全部明细",
  ]) assert.match(page, new RegExp(phrase));

  assert.match(page, /function ProvinceFootprintMap/);
  assert.match(page, /function TransportOverview/);
  assert.match(page, /function MovementRoute/);
  assert.match(page, /function importedJourneys/);
  assert.match(page, /function updateJourney/);
  assert.match(css, /\.location-list\.expanded[^}]*overflow-y: auto/);
  assert.match(css, /\.province-shapes path\.visited[^}]*--province-color/);
  assert.match(css, /@keyframes rail-glide[^}]*scaleX\(-1\)/);
});

test("ships the open-source documentation and application assets", async () => {
  const [license, readme, architecture, privacy, dataFormat, contributing, releasing, icon, iosIcon] = await Promise.all([
    text("../LICENSE"),
    text("../README.md"),
    text("../docs/ARCHITECTURE.md"),
    text("../docs/PRIVACY.md"),
    text("../docs/DATA_FORMAT.md"),
    text("../CONTRIBUTING.md"),
    text("../docs/RELEASING.md"),
    stat(new URL("../macos/AppIcon-1024.png", import.meta.url)),
    stat(new URL("../ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png", import.meta.url)),
  ]);

  assert.match(license, /MIT License/);
  assert.match(readme, /Releases/);
  assert.match(readme, /本地优先/);
  assert.match(architecture, /共享 React 核心/);
  assert.match(privacy, /不会上传/);
  assert.match(dataFormat, /journeys/);
  assert.match(contributing, /Pull Request/);
  assert.match(releasing, /GitHub Releases/);
  assert.ok(icon.size > 100_000);
  assert.ok(iosIcon.size > 100_000);

  const generated = await readdir(new URL("../mobile-dist/assets", import.meta.url));
  assert.ok(generated.some((name) => name.endsWith(".js")));
});
