import type { DaySnapshot, JourneyDay, PlaceState } from "./types";

const UNKNOWN_STATE: PlaceState = { location: "", purpose: "travel" };

export function compareText(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortJourneys(items: JourneyDay[]) {
  return [...items].sort((a, b) => compareText(a.date, b.date) || compareText(a.id, b.id));
}

/** Reserved migration boundary for future on-device schema upgrades. */
export function migrateJourneys(items: JourneyDay[]) {
  return sortJourneys(items);
}

export function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function addDays(value: string, amount: number) {
  const date = parseDate(value);
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}

export function formatDate(value: string, includeYear = false) {
  const date = parseDate(value);
  return `${includeYear ? `${date.getFullYear()}年` : ""}${date.getMonth() + 1}月${date.getDate()}日`;
}

export function compactDate(value: string) {
  const date = parseDate(value);
  return `${date.getMonth() + 1}.${date.getDate()}`;
}

export function placeShort(place: string) {
  return place.replace(/^.*?(省|自治区)/, "").replace(/市$/, "");
}

function applyJourney(state: PlaceState, journey: JourneyDay): PlaceState {
  const first = journey.legs[0];
  const last = journey.legs[journey.legs.length - 1];
  if (!first || !last) return state;
  const isRoundTrip = first.from === last.to;
  return { location: last.to, purpose: isRoundTrip ? state.purpose : journey.purpose };
}

export function snapshotForDate(value: string, journeys: JourneyDay[]): DaySnapshot {
  const sorted = sortJourneys(journeys);
  const firstJourney = sorted[0];
  const firstLeg = firstJourney?.legs[0];
  if (!firstJourney || !firstLeg || value < firstJourney.date) {
    return {
      date: value,
      known: false,
      before: UNKNOWN_STATE,
      end: UNKNOWN_STATE,
      purpose: UNKNOWN_STATE.purpose,
      journeys: [],
    };
  }

  let state: PlaceState = { location: firstLeg.from, purpose: firstJourney.purpose };
  for (const journey of sorted) {
    if (journey.date >= value) break;
    state = applyJourney(state, journey);
  }

  const before = state;
  const dayJourneys = sorted.filter((journey) => journey.date === value);
  dayJourneys.forEach((journey) => { state = applyJourney(state, journey); });
  return {
    date: value,
    known: true,
    before,
    end: state,
    purpose: dayJourneys.at(-1)?.purpose ?? state.purpose,
    journeys: dayJourneys,
  };
}

export function dateSeries(start: string, end: string) {
  if (!start || !end || end < start) return [];
  const values: string[] = [];
  for (let value = start; value <= end; value = addDays(value, 1)) values.push(value);
  return values;
}

export function buildMonthDays(cursor: Date) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - offset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

export function routeLabel(journey: JourneyDay) {
  if (!journey.legs.length) return "";
  return [journey.legs[0].from, ...journey.legs.map((leg) => leg.to)].map(placeShort).join(" → ");
}
