"use client";

import { china } from "@esmjs/geo";
import { geoMercator, geoPath } from "d3-geo";
import type { FeatureCollection, Geometry } from "geojson";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  buildMonthDays,
  compactDate,
  compareText,
  dateKey,
  dateSeries,
  formatDate,
  migrateJourneys,
  parseDate,
  placeShort,
  routeLabel,
  snapshotForDate,
  sortJourneys,
} from "./core/journeys";
import type { DaySnapshot, JourneyDay, Leg, Purpose, Transport } from "./core/types";
import { exportDesktopJourneys, importDesktopJourneys, readDeviceJourneys, writeDeviceJourneys } from "./platform/device-storage";

type View = "overview" | "calendar" | "records";
type OverviewMode = "year" | "all" | "custom";
type CalendarMode = "month" | "year";
type StorageMode = "web" | "native";

type DataNotice = { kind: "success" | "error"; text: string };
type ProvinceMapProperties = {
  name: string;
  adcode: number | string;
  center?: number[];
  centroid?: number[];
};
type ProvinceStat = {
  name: string;
  stayDays: number;
  visits: number;
  purposeDays: Record<Purpose, number>;
  movementPurposes: Record<Purpose, number>;
  cities: string[];
  dominantPurpose: Purpose;
};

const STORAGE_KEY = "footprint-movement-days-v5";
const LEGACY_STORAGE_KEYS = ["footprint-movement-days-v4", "footprint-movement-days-v3"];

const purposeMeta: Record<Purpose, { label: string; short: string; color: string; soft: string; symbol: string }> = {
  study: { label: "上学", short: "学", color: "#3478f6", soft: "#eaf2ff", symbol: "▤" },
  family: { label: "探亲", short: "亲", color: "#a45ee8", soft: "#f3eafe", symbol: "⌂" },
  travel: { label: "游玩", short: "游", color: "#17b8aa", soft: "#e4f8f5", symbol: "◇" },
  business: { label: "出差 / 开会", short: "差", color: "#ef5474", soft: "#ffeaef", symbol: "□" },
};

const transportMeta: Record<Transport, { label: string; short: string; symbol: string }> = {
  rail: { label: "铁路", short: "铁", symbol: "🚄" },
  air: { label: "飞机", short: "飞", symbol: "✈️" },
  road: { label: "公路", short: "车", symbol: "🚗" },
};

const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
const monthNames = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
const purposeOrder = Object.keys(purposeMeta) as Purpose[];

// The bundled GeoJSON follows RFC 7946 winding. d3-geo uses the opposite
// spherical winding convention, so reverse the rings before projecting it.
function rewindGeometryForD3(geometry: Geometry): Geometry {
  if (geometry.type === "Polygon") {
    return { ...geometry, coordinates: geometry.coordinates.map((ring) => [...ring].reverse()) };
  }
  if (geometry.type === "MultiPolygon") {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((polygon) => polygon.map((ring) => [...ring].reverse())),
    };
  }
  return geometry;
}

const chinaGeoSource = china as unknown as FeatureCollection<Geometry, ProvinceMapProperties>;
const chinaGeo: FeatureCollection<Geometry, ProvinceMapProperties> = {
  ...chinaGeoSource,
  features: chinaGeoSource.features.map((feature) => ({
    ...feature,
    geometry: rewindGeometryForD3(feature.geometry),
  })),
};
const namedProvinceFeatures = chinaGeo.features.filter((feature) => feature.properties.name);
const provinceNames = namedProvinceFeatures.map((feature) => feature.properties.name);
const namedChinaGeo: FeatureCollection<Geometry, ProvinceMapProperties> = {
  type: "FeatureCollection",
  features: namedProvinceFeatures,
};
const chinaProjection = geoMercator().fitExtent([[22, 18], [678, 462]], namedChinaGeo);
const chinaPath = geoPath(chinaProjection);
const provinceShapes = namedProvinceFeatures.map((feature) => ({
  feature,
  name: feature.properties.name,
  path: chinaPath(feature) ?? "",
  labelPoint: chinaProjection(
    (feature.properties.centroid ?? feature.properties.center ?? [0, 0]) as [number, number],
  ),
}));
const maritimeBoundaryPath = chinaGeo.features
  .filter((feature) => !feature.properties.name)
  .map((feature) => chinaPath(feature) ?? "")
  .join(" ");
const cityProvinceAliases: Record<string, string> = {
  北京: "北京市", 天津: "天津市", 上海: "上海市", 重庆: "重庆市",
  武汉: "湖北省", 青岛: "山东省", 济南: "山东省", 枣庄: "山东省", 济宁: "山东省", 日照: "山东省", 烟台: "山东省", 潍坊: "山东省", 滕州: "山东省",
  濮阳: "河南省", 郑州: "河南省", 成都: "四川省", 杭州: "浙江省", 嘉兴: "浙江省", 广州: "广东省", 西安: "陕西省", 咸阳: "陕西省",
  长沙: "湖南省", 乌鲁木齐: "新疆维吾尔自治区", 长春: "吉林省", 南京: "江苏省", 秦皇岛: "河北省", 合肥: "安徽省",
  香港: "香港特别行政区", 澳门: "澳门特别行政区", 台湾: "台湾省",
};
const shanghaiDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function todayKey() {
  const parts = shanghaiDateFormatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function provinceForPlace(place: string) {
  const compact = place.replace(/\s/g, "");
  const full = provinceNames.find((province) => compact.startsWith(province));
  if (full) return full;
  const alias = Object.entries(cityProvinceAliases).find(([city]) => compact.startsWith(city));
  return alias?.[1] ?? null;
}

function provinceShort(province: string) {
  return province
    .replace(/特别行政区$/, "")
    .replace(/壮族自治区$/, "")
    .replace(/回族自治区$/, "")
    .replace(/维吾尔自治区$/, "")
    .replace(/自治区$/, "")
    .replace(/[省市]$/, "");
}

function dominantPurpose(days: Record<Purpose, number>, fallback: Record<Purpose, number>) {
  const source = Object.values(days).some(Boolean) ? days : fallback;
  return purposeOrder.reduce((best, purpose) => source[purpose] > source[best] ? purpose : best, purposeOrder[0]);
}

function buildProvinceStats(snapshots: DaySnapshot[], journeys: JourneyDay[]) {
  const entries = new Map<string, {
    stayDays: number;
    visits: number;
    purposeDays: Record<Purpose, number>;
    movementPurposes: Record<Purpose, number>;
    cities: Set<string>;
  }>();
  const ensure = (name: string) => {
    const existing = entries.get(name);
    if (existing) return existing;
    const created = {
      stayDays: 0,
      visits: 0,
      purposeDays: { study: 0, family: 0, travel: 0, business: 0 },
      movementPurposes: { study: 0, family: 0, travel: 0, business: 0 },
      cities: new Set<string>(),
    };
    entries.set(name, created);
    return created;
  };

  snapshots.forEach((snapshot) => {
    const province = provinceForPlace(snapshot.end.location);
    if (!province) return;
    const item = ensure(province);
    item.stayDays += 1;
    item.purposeDays[snapshot.purpose] += 1;
    item.cities.add(placeShort(snapshot.end.location));
  });
  journeys.forEach((journey) => journey.legs.forEach((leg) => {
    const province = provinceForPlace(leg.to);
    if (!province) return;
    const item = ensure(province);
    item.visits += 1;
    item.movementPurposes[journey.purpose] += 1;
    item.cities.add(placeShort(leg.to));
  }));

  return [...entries.entries()]
    .map(([name, values]): ProvinceStat => ({
      name,
      stayDays: values.stayDays,
      visits: values.visits,
      purposeDays: values.purposeDays,
      movementPurposes: values.movementPurposes,
      cities: [...values.cities],
      dominantPurpose: dominantPurpose(values.purposeDays, values.movementPurposes),
    }))
    .filter((item) => item.stayDays > 0 || item.visits > 0)
    .sort((a, b) => b.stayDays - a.stayDays || b.visits - a.visits || compareText(a.name, b.name));
}

function importedJourneys(payload: unknown): JourneyDay[] {
  const candidate =
    Array.isArray(payload)
      ? payload
      : payload && typeof payload === "object" && "journeys" in payload
        ? (payload as { journeys: unknown }).journeys
        : null;
  if (!Array.isArray(candidate) || candidate.length === 0) {
    throw new Error("文件中没有可导入的行程记录");
  }

  const ids = new Set<string>();
  const purposes: Purpose[] = ["study", "family", "travel", "business"];
  const transports: Transport[] = ["rail", "air", "road"];
  const valid = candidate.every((item) => {
    if (!item || typeof item !== "object") return false;
    const journey = item as Partial<JourneyDay>;
    if (
      typeof journey.id !== "string" ||
      !journey.id.trim() ||
      ids.has(journey.id) ||
      typeof journey.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(journey.date) ||
      dateKey(parseDate(journey.date)) !== journey.date ||
      !journey.purpose ||
      !purposes.includes(journey.purpose) ||
      (journey.note !== undefined && typeof journey.note !== "string") ||
      !Array.isArray(journey.legs) ||
      journey.legs.length === 0
    ) return false;
    ids.add(journey.id);
    return journey.legs.every((leg) =>
      Boolean(
        leg &&
        typeof leg.id === "string" &&
        leg.id.trim() &&
        typeof leg.from === "string" &&
        leg.from.trim() &&
        typeof leg.to === "string" &&
        leg.to.trim() &&
        transports.includes(leg.transport),
      ),
    );
  });
  if (!valid) throw new Error("文件格式不正确，或包含不完整的日期、地点和交通方式");
  return sortJourneys(candidate as JourneyDay[]);
}

function downloadJourneys(journeys: JourneyDay[], filename: string) {
  const payload = {
    app: "行迹",
    version: 1,
    exportedAt: new Date().toISOString(),
    journeys,
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function Home() {
  const today = todayKey();
  const currentYear = parseDate(today).getFullYear();
  const [journeys, setJourneys] = useState<JourneyDay[]>([]);
  const [view, setView] = useState<View>("overview");
  const [overviewMode, setOverviewMode] = useState<OverviewMode>("year");
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [customStart, setCustomStart] = useState(`${currentYear}-01-01`);
  const [customEnd, setCustomEnd] = useState(today);
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("month");
  const [monthCursor, setMonthCursor] = useState(new Date(currentYear, 0, 1));
  const [showForm, setShowForm] = useState(false);
  const [editingJourney, setEditingJourney] = useState<JourneyDay | null>(null);
  const [addingDate, setAddingDate] = useState<string | null>(null);
  const [filter, setFilter] = useState<Purpose | "all">("all");
  const [recordYear, setRecordYear] = useState<number | "all">("all");
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [storageMode, setStorageMode] = useState<StorageMode>("web");
  const [storageReady, setStorageReady] = useState(false);
  const [dataNotice, setDataNotice] = useState<DataNotice | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;

    function readWebJourneys() {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      const legacy = LEGACY_STORAGE_KEYS.map((key) => window.localStorage.getItem(key)).find(Boolean);
      if (!saved && legacy) {
        try {
          const previous = JSON.parse(legacy) as JourneyDay[];
          if (Array.isArray(previous) && previous.every((item) => Array.isArray(item.legs))) {
            return migrateJourneys(previous);
          }
        } catch {
          LEGACY_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key));
        }
        return null;
      }
      if (!saved) return null;
      try {
        const parsed = JSON.parse(saved) as JourneyDay[];
        if (Array.isArray(parsed) && parsed.every((item) => Array.isArray(item.legs))) return migrateJourneys(parsed);
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
      return null;
    }

    async function hydrate() {
      const device = await readDeviceJourneys<JourneyDay[]>();
      if (!active) return;
      const webJourneys = readWebJourneys();
      if (device.native) {
        setStorageMode("native");
        if (Array.isArray(device.data) && device.data.every((item) => Array.isArray(item.legs))) {
          setJourneys(migrateJourneys(device.data));
        } else if (webJourneys) {
          setJourneys(webJourneys);
        }
      } else if (webJourneys) {
        setJourneys(webJourneys);
      }
      setStorageReady(true);
    }

    void hydrate();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    if (storageMode === "native") {
      void writeDeviceJourneys(journeys).catch((error) => console.error("无法保存本地行程文件", error));
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(journeys));
  }, [journeys, storageMode, storageReady]);

  const firstJourneyDate = useMemo(
    () => sortJourneys(journeys)[0]?.date ?? today,
    [journeys, today],
  );
  const range = useMemo(() => {
    if (overviewMode === "all") return { start: firstJourneyDate, end: today };
    if (overviewMode === "custom") return { start: customStart, end: customEnd > today ? today : customEnd };
    const yearEnd = `${selectedYear}-12-31`;
    return { start: `${selectedYear}-01-01`, end: yearEnd > today ? today : yearEnd };
  }, [overviewMode, selectedYear, customStart, customEnd, firstJourneyDate, today]);

  const rangeValid = Boolean(range.start && range.end && range.end >= range.start);
  const snapshots = useMemo(
    () => rangeValid
      ? dateSeries(range.start, range.end)
        .map((date) => snapshotForDate(date, journeys))
        .filter((snapshot) => snapshot.known)
      : [],
    [range, rangeValid, journeys],
  );
  const scopeJourneys = useMemo(
    () => rangeValid ? sortJourneys(journeys.filter((journey) => journey.date >= range.start && journey.date <= range.end)) : [],
    [journeys, range, rangeValid],
  );

  const stats = useMemo(() => {
    const purposeDays: Record<Purpose, number> = { study: 0, family: 0, travel: 0, business: 0 };
    const transportCounts: Record<Transport, number> = { rail: 0, air: 0, road: 0 };
    const routeMaps: Record<Transport, Map<string, TransportRouteStat>> = {
      rail: new Map(),
      air: new Map(),
      road: new Map(),
    };
    const locations = new Map<string, { stayDays: number; visits: number }>();
    snapshots.forEach((snapshot) => {
      purposeDays[snapshot.purpose] += 1;
      const item = locations.get(snapshot.end.location) ?? { stayDays: 0, visits: 0 };
      item.stayDays += 1;
      locations.set(snapshot.end.location, item);
    });
    let movementCount = 0;
    scopeJourneys.forEach((journey) => journey.legs.forEach((leg) => {
      movementCount += 1;
      transportCounts[leg.transport] += 1;
      const routeKey = `${leg.from}\u0000${leg.to}`;
      const route = routeMaps[leg.transport].get(routeKey) ?? { from: leg.from, to: leg.to, count: 0, details: [] };
      route.count += 1;
      route.details.push({ date: journey.date, from: leg.from, to: leg.to });
      routeMaps[leg.transport].set(routeKey, route);
      const item = locations.get(leg.to) ?? { stayDays: 0, visits: 0 };
      item.visits += 1;
      locations.set(leg.to, item);
    }));
    const locationList = [...locations.entries()]
      .map(([location, values]) => ({ location, ...values }))
      .sort((a, b) => b.stayDays - a.stayDays || b.visits - a.visits);
    const transportRoutes = (Object.keys(transportMeta) as Transport[]).reduce((result, transport) => {
      result[transport] = [...routeMaps[transport].values()]
        .map((route) => ({ ...route, details: [...route.details].sort((a, b) => compareText(b.date, a.date)) }))
        .sort((a, b) => b.count - a.count || compareText(b.details[0]?.date ?? "", a.details[0]?.date ?? "") || compareText(a.from, b.from));
      return result;
    }, { rail: [], air: [], road: [] } as Record<Transport, TransportRouteStat[]>);
    return { totalDays: snapshots.length, purposeDays, transportCounts, transportRoutes, movementCount, locations: locationList };
  }, [snapshots, scopeJourneys]);

  const current = useMemo(() => snapshotForDate(today, journeys), [journeys, today]);
  const latestInScope = snapshots.at(-1);
  const maxPurposeDays = Math.max(...Object.values(stats.purposeDays), 1);
  const calendarDays = useMemo(() => buildMonthDays(monthCursor), [monthCursor]);
  const sortedDescending = useMemo(() => sortJourneys(journeys).reverse(), [journeys]);
  const recordYears = useMemo(
    () => [...new Set(journeys.map((journey) => parseDate(journey.date).getFullYear()))].sort((a, b) => b - a),
    [journeys],
  );
  const filteredJourneys = sortedDescending.filter((journey) => {
    const matchesPurpose = filter === "all" || journey.purpose === filter;
    const matchesYear = recordYear === "all" || parseDate(journey.date).getFullYear() === recordYear;
    const text = `${routeLabel(journey)} ${journey.note ?? ""}`;
    return matchesPurpose && matchesYear && text.includes(query.trim());
  });

  function openAdd() {
    setEditingJourney(null);
    setAddingDate(null);
    setShowForm(true);
  }

  function openAddForDate(date: string) {
    setEditingJourney(null);
    setAddingDate(date);
    setShowForm(true);
  }

  function openCalendarDay(date: string, journey?: JourneyDay) {
    if (journey) {
      setShowForm(false);
      setAddingDate(null);
      setEditingJourney(journey);
      return;
    }
    openAddForDate(date);
  }

  function closeForm() {
    setShowForm(false);
    setEditingJourney(null);
    setAddingDate(null);
  }

  function addJourney(journey: Omit<JourneyDay, "id">) {
    setJourneys((items) => sortJourneys([...items, { ...journey, id: `journey-${Date.now()}` }]));
    setSelectedYear(parseDate(journey.date).getFullYear());
    setMonthCursor(new Date(parseDate(journey.date).getFullYear(), parseDate(journey.date).getMonth(), 1));
    closeForm();
  }

  function updateJourney(updated: Omit<JourneyDay, "id">) {
    if (!editingJourney) return;
    setJourneys((items) => sortJourneys(items.map((item) => item.id === editingJourney.id ? { ...updated, id: editingJourney.id } : item)));
    closeForm();
  }

  function deleteJourney(id: string) {
    if (window.confirm("确认删除这一天的移动记录吗？之后的停留地会据此重新计算。")) {
      setJourneys((items) => items.filter((item) => item.id !== id));
    }
  }

  function goToView(next: View) {
    setView(next);
    setMenuOpen(false);
  }

  function changeCalendarPeriod(offset: number) {
    setMonthCursor((cursor) => new Date(cursor.getFullYear(), cursor.getMonth() + offset * (calendarMode === "year" ? 12 : 1), 1));
  }

  async function exportData() {
    const filename = `行迹数据-${todayKey()}.json`;
    setDataNotice(null);
    try {
      const desktop = await exportDesktopJourneys(journeys, filename);
      if (desktop.handled) {
        if (desktop.saved) setDataNotice({ kind: "success", text: `已导出 ${journeys.length} 条移动记录` });
        return;
      }
      downloadJourneys(journeys, filename);
      setDataNotice({ kind: "success", text: `已导出 ${journeys.length} 条移动记录` });
    } catch {
      setDataNotice({ kind: "error", text: "导出失败，请稍后重试" });
    }
  }

  async function replaceWithImportedData(payload: unknown) {
    const imported = importedJourneys(payload);
    const confirmed = window.confirm(
      `文件中有 ${imported.length} 条移动记录。导入后将替换当前的 ${journeys.length} 条记录，是否继续？`,
    );
    if (!confirmed) return;
    if (storageMode === "native") await writeDeviceJourneys(imported);
    setJourneys(imported);
    const latest = imported.at(-1);
    if (latest) {
      const latestDate = parseDate(latest.date);
      setSelectedYear(latestDate.getFullYear());
      setMonthCursor(new Date(latestDate.getFullYear(), latestDate.getMonth(), 1));
    }
    setRecordYear("all");
    setDataNotice({ kind: "success", text: `已导入 ${imported.length} 条移动记录，并保存到本机` });
  }

  async function openImport() {
    setDataNotice(null);
    try {
      const desktop = await importDesktopJourneys<unknown>();
      if (desktop.handled) {
        if (desktop.data != null) await replaceWithImportedData(desktop.data);
        return;
      }
      importInputRef.current?.click();
    } catch (error) {
      setDataNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "无法读取这份数据文件",
      });
    }
  }

  async function importData(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setDataNotice(null);
    if (file.size > 5 * 1024 * 1024) {
      setDataNotice({ kind: "error", text: "文件过大，请选择行迹导出的 JSON 文件" });
      return;
    }

    try {
      await replaceWithImportedData(JSON.parse(await file.text()));
    } catch (error) {
      setDataNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "无法读取这份数据文件",
      });
    }
  }

  async function refreshData() {
    setDataNotice(null);
    try {
      const device = await readDeviceJourneys<JourneyDay[]>();
      if (!device.native || !Array.isArray(device.data)) {
        setDataNotice({ kind: "error", text: "本地数据文件不存在或暂时无法读取" });
        return;
      }
      const refreshed = migrateJourneys(device.data);
      setJourneys(refreshed);
      setDataNotice({ kind: "success", text: `已从本地文件刷新 ${refreshed.length} 条移动记录` });
    } catch {
      setDataNotice({ kind: "error", text: "刷新失败，请检查本地数据文件" });
    }
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <div className="brand"><span className="brand-mark">迹</span><div><strong>行迹</strong><small>我的本地足迹</small></div></div>
        <nav className="main-nav" aria-label="主导航">
          <button className={view === "overview" ? "active" : ""} onClick={() => goToView("overview")}><span className="nav-icon">◫</span>概览</button>
          <button className={view === "calendar" ? "active" : ""} onClick={() => goToView("calendar")}><span className="nav-icon">▦</span>日历</button>
          <button className={view === "records" ? "active" : ""} onClick={() => goToView("records")}><span className="nav-icon">⇄</span>移动记录</button>
        </nav>
        <div className="sidebar-legend">
          <span className="eyebrow">出行目的</span>
          {(Object.keys(purposeMeta) as Purpose[]).map((purpose) => <div className="legend-row" key={purpose}><i style={{ background: purposeMeta[purpose].color }} />{purposeMeta[purpose].label}</div>)}
        </div>
        <div className="transport-legend">
          <span className="eyebrow">交通方式</span>
          {(Object.keys(transportMeta) as Transport[]).map((transport) => <span key={transport}><i>{transportMeta[transport].symbol}</i>{transportMeta[transport].label}</span>)}
        </div>
        <div className="privacy-card"><span>⌁</span><div><strong>{storageMode === "native" ? "应用本地文件" : "仅保存在本机"}</strong><p>移动与停留数据不会上传</p></div></div>
      </aside>
      {menuOpen && <button className="menu-backdrop" aria-label="关闭菜单" onClick={() => setMenuOpen(false)} />}

      <section className="workspace">
        <header className="topbar">
          <button className="menu-button" aria-label="打开菜单" onClick={() => setMenuOpen(true)}>☰</button>
          <div className="topbar-title"><span className="mobile-brand">行迹</span><span className="local-status"><i />{storageMode === "native" ? "本地文件已开启" : "本地存储已开启"}</span></div>
          <div className="topbar-actions">
            {storageMode === "native" && <button className="data-tool-button" onClick={refreshData} title="重新读取软件本地数据文件"><span>↻</span><b>刷新数据</b></button>}
            <button className="data-tool-button" onClick={exportData} title="导出全部行程数据"><span>↓</span><b>导出数据</b></button>
            <button className="data-tool-button" onClick={openImport} title="从 JSON 文件导入全部行程数据"><span>↑</span><b>导入数据</b></button>
            <input ref={importInputRef} className="import-file-input" type="file" accept=".json,application/json" onChange={importData} />
            <button className="add-button" onClick={openAdd}><span>＋</span>记录移动</button>
          </div>
        </header>
        {dataNotice && <div className={`data-notice ${dataNotice.kind}`} role="status"><span>{dataNotice.kind === "success" ? "✓" : "!"}</span><p>{dataNotice.text}</p><button aria-label="关闭提示" onClick={() => setDataNotice(null)}>×</button></div>}
        <div className={`content ${view === "calendar" ? "calendar-content" : ""}`}>
          {view === "overview" && (
            <Overview
              mode={overviewMode}
              setMode={setOverviewMode}
              selectedYear={selectedYear}
              setSelectedYear={setSelectedYear}
              customStart={customStart}
              customEnd={customEnd}
              setCustomStart={setCustomStart}
              setCustomEnd={setCustomEnd}
              rangeValid={rangeValid}
              snapshots={snapshots}
              scopeJourneys={scopeJourneys}
              stats={stats}
              maxPurposeDays={maxPurposeDays}
              focus={overviewMode === "year" && selectedYear === parseDate(today).getFullYear()
                ? (current.known ? current : undefined)
                : latestInScope}
              onCalendar={() => setView("calendar")}
              onAdd={openAdd}
            />
          )}
          {view === "calendar" && (
            <CalendarView
              cursor={monthCursor}
              days={calendarDays}
              journeys={journeys}
              mode={calendarMode}
              setMode={setCalendarMode}
              onChange={changeCalendarPeriod}
              onToday={() => { setMonthCursor(new Date()); setCalendarMode("month"); }}
              onOpenMonth={(month) => { setMonthCursor(new Date(monthCursor.getFullYear(), month, 1)); setCalendarMode("month"); }}
              onDayClick={openCalendarDay}
              onAdd={openAdd}
            />
          )}
          {view === "records" && (
            <RecordsView
              journeys={filteredJourneys}
              filter={filter}
              setFilter={setFilter}
              year={recordYear}
              years={recordYears}
              setYear={setRecordYear}
              query={query}
              setQuery={setQuery}
              onAdd={openAdd}
              onEdit={setEditingJourney}
              onDelete={deleteJourney}
            />
          )}
        </div>
      </section>
      {(showForm || editingJourney) && <JourneyForm initial={editingJourney ?? undefined} initialDate={addingDate ?? undefined} journeys={journeys} onClose={closeForm} onSubmit={editingJourney ? updateJourney : addJourney} />}
    </main>
  );
}

function PageHeading({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><span className="eyebrow accent-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>;
}

function YearPicker({ value, onChange }: { value: number; onChange: (year: number) => void }) {
  return <div className="year-picker"><button aria-label="上一年" onClick={() => onChange(value - 1)}>‹</button><strong>{value}</strong><button aria-label="下一年" onClick={() => onChange(value + 1)}>›</button></div>;
}

type Stats = {
  totalDays: number;
  purposeDays: Record<Purpose, number>;
  transportCounts: Record<Transport, number>;
  transportRoutes: Record<Transport, TransportRouteStat[]>;
  movementCount: number;
  locations: { location: string; stayDays: number; visits: number }[];
};

type TransportRouteStat = {
  from: string;
  to: string;
  count: number;
  details: { date: string; from: string; to: string }[];
};

function Overview({ mode, setMode, selectedYear, setSelectedYear, customStart, customEnd, setCustomStart, setCustomEnd, rangeValid, snapshots, scopeJourneys, stats, maxPurposeDays, focus, onCalendar, onAdd }: {
  mode: OverviewMode;
  setMode: (mode: OverviewMode) => void;
  selectedYear: number;
  setSelectedYear: (year: number) => void;
  customStart: string;
  customEnd: string;
  setCustomStart: (value: string) => void;
  setCustomEnd: (value: string) => void;
  rangeValid: boolean;
  snapshots: DaySnapshot[];
  scopeJourneys: JourneyDay[];
  stats: Stats;
  maxPurposeDays: number;
  focus?: DaySnapshot;
  onCalendar: () => void;
  onAdd: () => void;
}) {
  const [locationsExpanded, setLocationsExpanded] = useState(false);
  const heading = mode === "year"
    ? { eyebrow: "年度概览", title: `${selectedYear}，走过的日子`, purpose: "这一年，日子花在哪里" }
    : mode === "all"
      ? { eyebrow: "全部概览", title: "所有记录，一路走来", purpose: "所有记录中，日子花在哪里" }
      : { eyebrow: "自定义概览", title: rangeValid ? `${formatDate(customStart, true)} — ${formatDate(customEnd, true)}` : "请选择有效的时间范围", purpose: "这段时间，日子花在哪里" };
  const recent = [...scopeJourneys].reverse().slice(0, 4);
  const latestJourney = scopeJourneys.at(-1);
  const focusMeta = focus ? purposeMeta[focus.purpose] : null;

  return <>
    <section className="overview-controls" aria-label="概览范围">
      <div className="scope-tabs"><button className={mode === "year" ? "active" : ""} onClick={() => setMode("year")}>年度</button><button className={mode === "all" ? "active" : ""} onClick={() => setMode("all")}>所有记录</button><button className={mode === "custom" ? "active" : ""} onClick={() => setMode("custom")}>自定义时间</button></div>
      <div className="scope-detail">
        {mode === "year" && <YearPicker value={selectedYear} onChange={setSelectedYear} />}
        {mode === "all" && <span className="scope-caption">从 2017 年开始整理</span>}
        {mode === "custom" && <div className={`custom-range ${rangeValid ? "" : "invalid"}`}><label><span>从</span><input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label><i>→</i><label><span>到</span><input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label></div>}
      </div>
    </section>
    <PageHeading eyebrow={heading.eyebrow} title={heading.title} subtitle="移动日记录路线，其他日期自动延续为停留地。" />

    <section className="hero-grid">
      <article className="focus-card">
        <div className="focus-card-top"><span className="focus-label">{focus?.date === todayKey() ? "今日落脚" : "范围最后落脚"}</span>{focusMeta && <span className="category-pill" style={{ color: focusMeta.color, background: focusMeta.soft }}><i style={{ background: focusMeta.color }} />{focusMeta.label}</span>}</div>
        {focus ? <><h2>{placeShort(focus.end.location)}</h2><p>{latestJourney ? `最近移动：${formatDate(latestJourney.date)} · ${routeLabel(latestJourney)}` : "当前范围内没有移动"}</p><div className="focus-footer"><span><b>{snapshots.filter((item) => item.end.location === focus.end.location).length}</b> 天落脚于此</span></div></> : <div className="empty-inline">当前范围还没有足迹。</div>}
      </article>
      <article className="stat-card"><span className="stat-symbol">◷</span><p>覆盖天数</p><strong>{stats.totalDays}<small> 天</small></strong><span>每天只计入一个落脚地</span></article>
      <article className="stat-card"><span className="stat-symbol">⌖</span><p>到访城市</p><strong>{stats.locations.length}<small> 座</small></strong><span>包括当天途经的城市</span></article>
      <article className="stat-card"><span className="stat-symbol">⇄</span><p>移动段数</p><strong>{stats.movementCount}<small> 段</small></strong><span>{scopeJourneys.length} 个移动日</span></article>
    </section>

    <section className="dashboard-grid">
      <article className="panel purpose-panel">
        <div className="panel-heading"><div><span className="eyebrow">时间去向</span><h3>{heading.purpose}</h3></div><span className="panel-total">共 {stats.totalDays} 天</span></div>
        <div className="purpose-list">{(Object.keys(purposeMeta) as Purpose[]).map((purpose) => { const meta = purposeMeta[purpose]; const days = stats.purposeDays[purpose]; return <div className="purpose-row" key={purpose}><span className="purpose-icon" style={{ color: meta.color, background: meta.soft }}>{meta.symbol}</span><div className="purpose-main"><div><strong>{meta.label}</strong><span>{days} 天</span></div><div className="progress"><i style={{ width: `${days / maxPurposeDays * 100}%`, background: meta.color }} /></div></div></div>; })}</div>
      </article>
      <article className="panel location-panel">
        <div className="panel-heading"><div><span className="eyebrow">地点汇总</span><h3>落脚与到访</h3></div>{stats.locations.length > 3 && <button className="panel-expand-button" onClick={() => setLocationsExpanded((value) => !value)}>{locationsExpanded ? "收起" : `展开全部 ${stats.locations.length} 座`} <i aria-hidden="true">⌄</i></button>}</div>
        <div className={`location-list ${locationsExpanded ? "expanded" : ""}`}>{stats.locations.slice(0, locationsExpanded ? undefined : 3).map((item, index) => <div className="location-row" key={item.location}><span className="rank">{String(index + 1).padStart(2, "0")}</span><div><strong>{placeShort(item.location)}</strong><small>到访 {item.visits} 次</small></div><b>{item.stayDays}<small> 天落脚</small></b></div>)}</div>
        <p className="panel-note">当天经过但未落脚的城市显示为 0 天，并保留到访次数。</p>
      </article>
    </section>

    <ProvinceFootprintMap snapshots={snapshots} journeys={scopeJourneys} />

    <TransportOverview counts={stats.transportCounts} routes={stats.transportRoutes} total={stats.movementCount} />

    <section className="panel recent-panel">
      <div className="panel-heading"><div><span className="eyebrow">最近移动</span><h3>路线时间线</h3></div><button className="text-button" onClick={onCalendar}>查看日历 →</button></div>
      {recent.length ? <div className="timeline">{recent.map((journey) => <div className="timeline-item" key={journey.id}><span className="timeline-date">{compactDate(journey.date)}<small>{parseDate(journey.date).getFullYear()}</small></span><span className="timeline-dot" style={{ borderColor: purposeMeta[journey.purpose].color }}><i style={{ background: purposeMeta[journey.purpose].color }} /></span><div className="timeline-copy"><strong>{routeLabel(journey)}</strong><span>{journey.legs.map((leg) => transportMeta[leg.transport].label).join(" · ")}</span></div><b>{journey.legs.length} 段</b></div>)}</div> : <EmptyState onAdd={onAdd} />}
    </section>
  </>;
}

function ProvinceFootprintMap({ snapshots, journeys }: { snapshots: DaySnapshot[]; journeys: JourneyDay[] }) {
  const provinceStats = useMemo(() => buildProvinceStats(snapshots, journeys), [snapshots, journeys]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const statByName = useMemo(() => new Map(provinceStats.map((item) => [item.name, item])), [provinceStats]);
  const selected = statByName.get(selectedName ?? "") ?? provinceStats[0] ?? null;

  return <section className="panel province-map-panel">
    <div className="panel-heading province-map-heading">
      <div><span className="eyebrow">省域足迹</span><h3>去过的地方，在地图上留下颜色</h3></div>
      <span className="panel-total">已到访 {provinceStats.length} / 34 个省级行政区</span>
    </div>
    <div className="province-map-layout">
      <div className="province-map-canvas">
        <svg viewBox="0 0 700 480" role="img" aria-label="中国省级行政区行迹地图">
          <g className="province-shapes">
            {provinceShapes.map((shape) => {
              const stat = statByName.get(shape.name);
              const meta = stat ? purposeMeta[stat.dominantPurpose] : null;
              const active = selected?.name === shape.name;
              const label = stat
                ? `${shape.name}，停留 ${stat.stayDays} 天，到访 ${stat.visits} 次，主要为${meta?.label}`
                : `${shape.name}，暂无到访记录`;
              return <path
                d={shape.path}
                key={shape.name}
                className={`${stat ? "visited" : "unvisited"} ${active ? "active" : ""}`}
                style={stat ? { "--province-color": meta?.color } as React.CSSProperties : undefined}
                role="button"
                tabIndex={0}
                aria-label={label}
                onClick={() => { if (stat) setSelectedName(shape.name); }}
                onFocus={() => { if (stat) setSelectedName(shape.name); }}
                onMouseEnter={() => { if (stat) setSelectedName(shape.name); }}
                onKeyDown={(event) => { if (stat && (event.key === "Enter" || event.key === " ")) setSelectedName(shape.name); }}
              ><title>{label}</title></path>;
            })}
            {maritimeBoundaryPath && <path className="maritime-boundary" d={maritimeBoundaryPath} />}
          </g>
          <g className="province-map-labels" aria-hidden="true">
            {provinceShapes.map((shape) => {
              const stat = statByName.get(shape.name);
              if (!stat || !shape.labelPoint) return null;
              return <text x={shape.labelPoint[0]} y={shape.labelPoint[1]} key={`label-${shape.name}`}>{provinceShort(shape.name)}</text>;
            })}
          </g>
        </svg>
        <div className="map-purpose-legend">
          {purposeOrder.map((purpose) => <span key={purpose}><i style={{ background: purposeMeta[purpose].color }} />{purposeMeta[purpose].label}</span>)}
          <span><i className="empty" />未到访</span>
        </div>
      </div>
      <aside className="province-map-detail">
        {selected ? <>
          <div className="province-detail-main">
            <span>当前省份</span>
            <h4>{selected.name}</h4>
            <p><i style={{ background: purposeMeta[selected.dominantPurpose].color }} />以{purposeMeta[selected.dominantPurpose].label}为主</p>
          </div>
          <div className="province-detail-metrics"><div><strong>{selected.stayDays}</strong><span>停留天数</span></div><div><strong>{selected.visits}</strong><span>到访次数</span></div></div>
          <div className="province-purpose-bars">{purposeOrder.map((purpose) => <div key={purpose}><span>{purposeMeta[purpose].label}</span><i><b style={{ width: `${selected.stayDays ? selected.purposeDays[purpose] / selected.stayDays * 100 : 0}%`, background: purposeMeta[purpose].color }} /></i><strong>{selected.purposeDays[purpose]} 天</strong></div>)}</div>
          <div className="province-cities"><span>涉及城市</span><p>{selected.cities.join("、") || "仅有途经记录"}</p></div>
        </> : <div className="province-map-empty"><span>⌖</span><h4>当前范围暂无省域足迹</h4><p>切换概览范围后，地图会同步更新。</p></div>}
        {provinceStats.length > 1 && <div className="province-visited-list"><span>到访省份</span><div>{provinceStats.map((item, index) => <button className={selected?.name === item.name ? "active" : ""} onClick={() => setSelectedName(item.name)} key={item.name}><b>{String(index + 1).padStart(2, "0")}</b><strong>{provinceShort(item.name)}</strong><small>{item.stayDays} 天</small></button>)}</div></div>}
      </aside>
    </div>
    <p className="province-map-note">颜色按所选时间范围内停留天数最多的出行目的确定；只有途经记录的省份按移动目的着色。地图与年度、所有记录和自定义时间同步。</p>
  </section>;
}

function TransportOverview({ counts, routes, total }: { counts: Record<Transport, number>; routes: Record<Transport, TransportRouteStat[]>; total: number }) {
  return <section className="panel transport-panel">
    <div className="panel-heading transport-heading"><div><span className="eyebrow">交通足迹</span><h3>怎么走，又常走哪条路</h3></div><span className="panel-total">共 {total} 段移动</span></div>
    <div className="transport-summary-grid">
      {(Object.keys(transportMeta) as Transport[]).map((transport) => {
        const meta = transportMeta[transport];
        const count = counts[transport];
        const share = total ? Math.round(count / total * 100) : 0;
        const popular = routes[transport].slice(0, 3);
        const allDetails = routes[transport]
          .flatMap((route) => route.details)
          .sort((a, b) => compareText(b.date, a.date));
        return <article className={`transport-summary-card ${transport}`} key={transport}>
          <div className="transport-card-head"><span className={`transport-card-icon ${transport}`} aria-hidden="true">{meta.symbol}</span><div><strong>{meta.label}</strong><span>{share}% 的移动段</span></div><b>{count}<small> 次</small></b></div>
          <div className="transport-share" aria-label={`${meta.label}占全部移动的 ${share}%`}><i style={{ width: `${share}%` }} /></div>
          <div className="route-ranking">
            <div className="route-ranking-label"><span>热门路线</span><small>按单向行程统计</small></div>
            {popular.length ? popular.map((route, index) => <details className="ranked-route" key={`${transport}-${route.from}-${route.to}`}>
              <summary><span className="route-rank-number">{String(index + 1).padStart(2, "0")}</span><strong>{placeShort(route.from)}<i>→</i>{placeShort(route.to)}</strong><b>{route.count} 次</b><span className="route-expand" aria-hidden="true">⌄</span></summary>
              <div className="route-occurrences">{route.details.map((detail, detailIndex) => <div key={`${detail.date}-${detailIndex}`}><time dateTime={detail.date}>{formatDate(detail.date, true)}</time><span>{placeShort(detail.from)}<i>{meta.symbol}</i>{placeShort(detail.to)}</span></div>)}</div>
            </details>) : <div className="transport-empty"><span>—</span><p>当前范围没有{meta.label}记录</p></div>}
          </div>
          <details className="transport-all-details">
            <summary><span>全部明细</span><b>{allDetails.length} 段</b><i aria-hidden="true">⌄</i></summary>
            <div className="transport-detail-list">{allDetails.length ? allDetails.map((detail, index) => <div key={`${transport}-${detail.date}-${detail.from}-${detail.to}-${index}`}><time dateTime={detail.date}>{formatDate(detail.date, true)}</time><span>{placeShort(detail.from)}<i>{meta.symbol}</i>{placeShort(detail.to)}</span></div>) : <p>当前范围没有{meta.label}记录</p>}</div>
          </details>
        </article>;
      })}
    </div>
    <p className="transport-note">次数按每一段交通计算；同一天经过多个城市时，每段路线分别计入。热门路线可按线路查看，全部明细按日期由近到远排列。</p>
  </section>;
}

function CalendarView({ cursor, days, journeys, mode, setMode, onChange, onToday, onOpenMonth, onDayClick, onAdd }: {
  cursor: Date;
  days: Date[];
  journeys: JourneyDay[];
  mode: CalendarMode;
  setMode: (mode: CalendarMode) => void;
  onChange: (offset: number) => void;
  onToday: () => void;
  onOpenMonth: (month: number) => void;
  onDayClick: (date: string, journey?: JourneyDay) => void;
  onAdd: () => void;
}) {
  const today = todayKey();
  return <>
    <PageHeading eyebrow="行迹日历" title={mode === "month" ? `${cursor.getFullYear()}年 ${monthNames[cursor.getMonth()]}` : `${cursor.getFullYear()}年`} subtitle={mode === "month" ? "有路线时看移动，无路线时看所在城市。" : "全年地点与移动，一眼看清。"} action={<div className="calendar-controls"><div className="view-switch"><button className={mode === "month" ? "active" : ""} onClick={() => setMode("month")}>月</button><button className={mode === "year" ? "active" : ""} onClick={() => setMode("year")}>年</button></div><button className="today-button" onClick={onToday}>今天</button><div className="month-buttons"><button aria-label="上一个时间段" onClick={() => onChange(-1)}>‹</button><button aria-label="下一个时间段" onClick={() => onChange(1)}>›</button></div></div>} />
    <section className="calendar-panel">
      <div className="calendar-legend"><span>{mode === "month" ? "整月视图" : "年度视图 · 点击月份可展开"}</span><div>{(Object.keys(purposeMeta) as Purpose[]).map((purpose) => <span key={purpose}><i style={{ background: purposeMeta[purpose].color }} />{purposeMeta[purpose].label}</span>)}</div></div>
      {mode === "month" ? <><div className="calendar-grid calendar-weekdays">{weekdays.map((day) => <div key={day}>{day}</div>)}</div><div className="calendar-grid calendar-days">{days.map((day) => {
        const key = dateKey(day);
        const snapshot = snapshotForDate(key, journeys);
        const future = key > today;
        const outside = day.getMonth() !== cursor.getMonth();
        const meta = purposeMeta[snapshot.purpose];
        const legs = snapshot.journeys.flatMap((journey) => journey.legs);
        const dayDescription = future
          ? "未来日期"
          : snapshot.journeys.length
          ? `${snapshot.journeys.map(routeLabel).join("；")}，点击查看或编辑`
          : `${snapshot.known ? placeShort(snapshot.end.location) : "尚无地点记录"}，点击添加当天移动`;
        return <button
          type="button"
          className={`day-cell ${outside ? "outside" : ""} ${key === today ? "is-today" : ""} ${future ? "future" : ""}`}
          key={key}
          style={!future && snapshot.known ? { background: meta.soft, "--day-color": meta.color } as React.CSSProperties : undefined}
          aria-label={`${formatDate(key, true)}，${dayDescription}`}
          title={dayDescription}
          disabled={future}
          onClick={() => { if (!future) onDayClick(key, snapshot.journeys[0]); }}
        >
          <span className="day-number">{day.getDate()}</span>
          {!future && snapshot.known && (legs.length ? <MovementRoute legs={legs} /> : <span className="calendar-city">{placeShort(snapshot.end.location)}</span>)}
        </button>;
      })}</div></> : <YearCalendar year={cursor.getFullYear()} journeys={journeys} today={today} onOpenMonth={onOpenMonth} />}
      <div className="calendar-footnote"><span>统计方式</span><p>有移动的日期展示完整路线；其余日期自动延续上一落脚地。每天按最后到达的城市计入地点天数。</p><button onClick={onAdd}>＋ 记录移动</button></div>
    </section>
  </>;
}

function MovementRoute({ legs }: { legs: Leg[] }) {
  if (!legs.length) return null;
  return <span className="movement-route" title={[legs[0].from, ...legs.map((leg) => `${transportMeta[leg.transport].label}到${leg.to}`)].join(" · ")}>
    <strong>{placeShort(legs[0].from)}</strong>
    {legs.map((leg) => <span className="route-hop" key={leg.id}><i className={`transport-emoji ${leg.transport}`} aria-hidden="true">{transportMeta[leg.transport].symbol}</i><strong>{placeShort(leg.to)}</strong></span>)}
  </span>;
}

function YearCalendar({ year, journeys, today, onOpenMonth }: { year: number; journeys: JourneyDay[]; today: string; onOpenMonth: (month: number) => void }) {
  return <div className="year-calendar-grid">{monthNames.map((name, month) => { const first = new Date(year, month, 1); const leading = (first.getDay() + 6) % 7; const count = new Date(year, month + 1, 0).getDate(); const dates = Array.from({ length: count }, (_, index) => dateKey(new Date(year, month, index + 1))); const movementDays = dates.filter((date) => date <= today && journeys.some((journey) => journey.date === date)).length; return <article className="mini-month" key={name}><button className="mini-month-heading" onClick={() => onOpenMonth(month)}><strong>{String(month + 1).padStart(2, "0")}</strong><span>{name}<small>{movementDays} 个移动日</small></span><i>↗</i></button><div className="mini-weekdays">{weekdays.map((day) => <span key={day}>{day}</span>)}</div><div className="mini-days">{Array.from({ length: leading }, (_, index) => <span className="mini-day blank" key={`b-${index}`} />)}{dates.map((date) => { const snapshot = snapshotForDate(date, journeys); if (date > today || !snapshot.known) return <span className="mini-day unknown" key={date}>{parseDate(date).getDate()}</span>; const meta = purposeMeta[snapshot.purpose]; return <span className={`mini-day recorded ${snapshot.journeys.length ? "moved" : ""} ${date === today ? "today" : ""}`} key={date} style={{ color: meta.color, background: meta.soft }} title={snapshot.journeys.length ? snapshot.journeys.map(routeLabel).join("；") : placeShort(snapshot.end.location)}>{parseDate(date).getDate()}</span>; })}</div></article>; })}</div>;
}

function RecordsView({ journeys, filter, setFilter, year, years, setYear, query, setQuery, onAdd, onEdit, onDelete }: {
  journeys: JourneyDay[];
  filter: Purpose | "all";
  setFilter: (filter: Purpose | "all") => void;
  year: number | "all";
  years: number[];
  setYear: (year: number | "all") => void;
  query: string;
  setQuery: (value: string) => void;
  onAdd: () => void;
  onEdit: (journey: JourneyDay) => void;
  onDelete: (id: string) => void;
}) {
  return <><PageHeading eyebrow="逐日行迹" title="移动记录" subtitle="一天是一条记录，同一天可以连续经过多个地方。" action={<button className="outline-add" onClick={onAdd}>＋ 新增移动</button>} />
    <section className="records-toolbar"><label className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索城市或备注" /></label><div className="records-filters"><label className="year-filter"><span>年份</span><select value={year} onChange={(event) => setYear(event.target.value === "all" ? "all" : Number(event.target.value))}><option value="all">全部年份</option>{years.map((item) => <option value={item} key={item}>{item}年</option>)}</select></label><div className="filter-tabs"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部目的</button>{(Object.keys(purposeMeta) as Purpose[]).map((purpose) => <button className={filter === purpose ? "active" : ""} key={purpose} onClick={() => setFilter(purpose)}>{purposeMeta[purpose].label}</button>)}</div></div></section>
    <section className="records-list">{journeys.length ? journeys.map((journey) => { const meta = purposeMeta[journey.purpose]; return <article className="record-card" key={journey.id}><div className="record-accent" style={{ background: meta.color }} /><div className="record-date"><strong>{compactDate(journey.date)}</strong><small>{parseDate(journey.date).getFullYear()}</small></div><div className="record-route"><div className="route-chain">{journey.legs.map((leg, index) => <span className="route-leg" key={leg.id}>{index === 0 && <strong>{placeShort(leg.from)}</strong>}<i><b>{transportMeta[leg.transport].symbol}</b>{transportMeta[leg.transport].label}</i><strong>{placeShort(leg.to)}</strong></span>)}</div>{journey.note && <p>{journey.note}</p>}</div><span className="category-pill" style={{ color: meta.color, background: meta.soft }}><i style={{ background: meta.color }} />{meta.label}</span><div className="record-actions"><button className="edit-button" onClick={() => onEdit(journey)}>编辑</button><button className="delete-button" aria-label={`删除 ${formatDate(journey.date)} 的移动记录`} onClick={() => onDelete(journey.id)}>×</button></div></article>; }) : <EmptyState onAdd={onAdd} />}</section>
  </>;
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return <div className="empty-state"><span>⇄</span><h3>还没有移动记录</h3><p>选择一天，记下从哪里到哪里。</p><button onClick={onAdd}>＋ 记录移动</button></div>;
}

function JourneyForm({ initial, initialDate, journeys, onClose, onSubmit }: { initial?: JourneyDay; initialDate?: string; journeys: JourneyDay[]; onClose: () => void; onSubmit: (journey: Omit<JourneyDay, "id">) => void }) {
  const today = todayKey();
  const startingDate = initial?.date ?? initialDate ?? today;
  const suggestedOrigin = snapshotForDate(startingDate, journeys).before.location;
  const [date, setDate] = useState(startingDate);
  const [legs, setLegs] = useState<Leg[]>(initial?.legs ?? [{ id: "leg-draft-1", from: suggestedOrigin, to: "", transport: "rail" }]);
  const [purpose, setPurpose] = useState<Purpose>(initial?.purpose ?? "study");
  const [note, setNote] = useState(initial?.note ?? "");
  const [error, setError] = useState("");

  function updateLeg(index: number, field: keyof Leg, value: string) {
    setLegs((items) => {
      const next = items.map((item) => ({ ...item }));
      const oldTo = next[index].to;
      next[index] = { ...next[index], [field]: value } as Leg;
      if (field === "to" && next[index + 1] && (!next[index + 1].from || next[index + 1].from === oldTo)) next[index + 1].from = value;
      return next;
    });
  }

  function addLeg() {
    const from = legs.at(-1)?.to ?? "";
    setLegs((items) => [...items, { id: `leg-${Date.now()}-${items.length}`, from, to: "", transport: "rail" }]);
  }

  function removeLeg(index: number) {
    setLegs((items) => {
      const next = items.filter((_, itemIndex) => itemIndex !== index).map((item) => ({ ...item }));
      for (let itemIndex = 1; itemIndex < next.length; itemIndex += 1) next[itemIndex].from = next[itemIndex - 1].to;
      return next;
    });
  }

  function changeDate(value: string) {
    setDate(value);
    if (!initial && legs.length === 1 && !legs[0].to && value) {
      const origin = snapshotForDate(value, journeys).before.location;
      setLegs((items) => [{ ...items[0], from: origin }]);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!date) return setError("请选择移动日期");
    if (legs.some((leg) => !leg.from.trim() || !leg.to.trim())) return setError("请完整填写每一段的出发地和目的地");
    if (legs.some((leg) => leg.from.trim() === leg.to.trim())) return setError("同一段的出发地和目的地不能相同");
    onSubmit({ date, legs: legs.map((leg) => ({ ...leg, from: leg.from.trim(), to: leg.to.trim() })), purpose, note: note.trim() || undefined });
  }

  return <div className="modal-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="journey-form" role="dialog" aria-modal="true" aria-labelledby="journey-form-title"><div className="form-heading"><div><span className="eyebrow accent-eyebrow">{initial ? "编辑移动" : "新行迹"}</span><h2 id="journey-form-title">{initial ? "修改这一天的路线" : "记录一天的移动"}</h2><p>同一天可以按顺序添加多段路线。</p></div><button aria-label="关闭" onClick={onClose}>×</button></div><form onSubmit={submit}>
    <label className="form-field"><span>移动日期</span><input type="date" value={date} onChange={(event) => changeDate(event.target.value)} /></label>
    <fieldset className="route-fieldset"><legend>当天路线</legend><div className="route-builder">{legs.map((leg, index) => <div className="route-row" key={leg.id}><span className="leg-index">{index + 1}</span><label><span>从</span><input value={leg.from} readOnly={index > 0} onChange={(event) => updateLeg(index, "from", event.target.value)} placeholder="出发地" /></label><label className="transport-select"><span>交通</span><select value={leg.transport} onChange={(event) => updateLeg(index, "transport", event.target.value)}>{(Object.keys(transportMeta) as Transport[]).map((transport) => <option key={transport} value={transport}>{transportMeta[transport].label}</option>)}</select></label><label><span>到</span><input value={leg.to} onChange={(event) => updateLeg(index, "to", event.target.value)} placeholder="目的地" /></label>{legs.length > 1 && <button type="button" className="remove-leg" aria-label={`删除第 ${index + 1} 段`} onClick={() => removeLeg(index)}>×</button>}</div>)}</div><button type="button" className="add-leg" onClick={addLeg}>＋ 同一天再去一个地方</button><p className="field-help">后一段会自动以上一段的目的地作为出发地。</p></fieldset>
    <fieldset className="category-fieldset"><legend>当天主要目的</legend><div className="category-options">{(Object.keys(purposeMeta) as Purpose[]).map((item) => { const meta = purposeMeta[item]; return <button type="button" key={item} className={purpose === item ? "selected" : ""} style={{ "--choice-color": meta.color, "--choice-soft": meta.soft } as React.CSSProperties} onClick={() => setPurpose(item)}><span>{meta.symbol}</span>{meta.label}</button>; })}</div></fieldset>
    <label className="form-field"><span>备注 <i>选填</i></span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：当天往返、参加会议" /></label>{error && <p className="form-error">{error}</p>}<div className="form-actions"><button type="button" className="cancel-button" onClick={onClose}>取消</button><button type="submit" className="save-button">{initial ? "保存修改" : "保存到本机"} →</button></div>
  </form></section></div>;
}
