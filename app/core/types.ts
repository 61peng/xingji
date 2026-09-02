/** Core, platform-neutral data model shared by web, macOS and iOS builds. */
export type Purpose = "study" | "family" | "travel" | "business";
export type Transport = "rail" | "air" | "road";

export type Leg = {
  id: string;
  from: string;
  to: string;
  transport: Transport;
};

export type JourneyDay = {
  id: string;
  date: string;
  legs: Leg[];
  purpose: Purpose;
  note?: string;
};

export type PlaceState = {
  location: string;
  purpose: Purpose;
};

export type DaySnapshot = {
  date: string;
  known: boolean;
  before: PlaceState;
  end: PlaceState;
  purpose: Purpose;
  journeys: JourneyDay[];
};
