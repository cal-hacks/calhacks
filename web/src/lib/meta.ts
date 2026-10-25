import type { CalendarProvider, GoalCategory, GoalPeriod, ShareCategory, TrackingSource, UpdateFrequency } from "./types";

export const APP_NAME = "Waggle";

export const SHARE_CATEGORIES: { key: ShareCategory; label: string; icon: string; hint: string }[] = [
  { key: "checkins", label: "Check-ins", icon: "💬", hint: "Things you post, like “hit my goal 🎉”" },
  { key: "goals", label: "Goal wins", icon: "🏆", hint: "When you hit a goal you've marked shareable" },
  { key: "availability", label: "Free time", icon: "🗓️", hint: "Free/busy only, never event details" },
  { key: "photos", label: "Photos", icon: "📸", hint: "Photos you upload and choose to share" },
  { key: "places", label: "Places", icon: "📍", hint: "City-level spots, like “weirdest place of the week”" },
  { key: "fitness", label: "Fitness", icon: "🏃", hint: "Runs, workouts and step milestones" },
  { key: "sleep", label: "Sleep", icon: "🌙", hint: "Only playful highlights, like “night owl of the week”" },
  { key: "screenTime", label: "Screen time", icon: "📱", hint: "Only wins, unless you allow roasts" },
];

export const FREQUENCIES: { key: UpdateFrequency; label: string; hint: string }[] = [
  { key: "realtime", label: "As it happens", hint: "Up to one highlight a day" },
  { key: "daily", label: "Daily digest", hint: "One roundup each evening" },
  { key: "weekly", label: "Weekly", hint: "Sunday recap" },
  { key: "monthly", label: "Monthly", hint: "First of the month" },
  { key: "paused", label: "Paused", hint: "Nothing gets shared" },
];

export const CALENDAR_PROVIDERS: { key: CalendarProvider; label: string; icon: string }[] = [
  { key: "google", label: "Google Calendar", icon: "🟦" },
  { key: "outlook", label: "Outlook / Microsoft 365", icon: "🟧" },
  { key: "apple", label: "Apple iCloud Calendar", icon: "⬜" },
];

export const PERIODS: { key: GoalPeriod; label: string }[] = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "yearly", label: "Yearly" },
];

export const CATEGORIES: { key: GoalCategory; label: string; icon: string }[] = [
  { key: "study", label: "Study", icon: "📚" },
  { key: "fitness", label: "Fitness", icon: "🏃" },
  { key: "wellness", label: "Wellness", icon: "🌿" },
  { key: "social", label: "Social", icon: "🫶" },
  { key: "custom", label: "Other", icon: "✨" },
];

export const SOURCES: { key: TrackingSource; label: string; hint: string }[] = [
  { key: "location", label: "Location", hint: "Time spent at a place you name" },
  { key: "calendar", label: "Calendar", hint: "Time in matching calendar events" },
  { key: "health", label: "Apple Health", hint: "Workouts, steps, sleep via the iOS Shortcut" },
  { key: "screenTime", label: "Screen Time", hint: "From screenshots or the iOS Shortcut" },
  { key: "manual", label: "I'll log it", hint: "Check in by hand or by iMessage" },
];

export interface GoalTemplate {
  title: string;
  icon: string;
  category: GoalCategory;
  period: GoalPeriod;
  target: number;
  unit: string;
  direction: "atLeast" | "atMost";
  trackBy: TrackingSource;
  place?: string;
}

export const GOAL_TEMPLATES: GoalTemplate[] = [
  { title: "Study at the library", icon: "📚", category: "study", period: "daily", target: 120, unit: "minutes", direction: "atLeast", trackBy: "location", place: "Library" },
  { title: "Study hours", icon: "🧠", category: "study", period: "weekly", target: 15, unit: "hours", direction: "atLeast", trackBy: "calendar" },
  { title: "Work out", icon: "🏋️", category: "fitness", period: "weekly", target: 3, unit: "times", direction: "atLeast", trackBy: "health" },
  { title: "Screen time under 3h", icon: "📵", category: "wellness", period: "daily", target: 180, unit: "minutes", direction: "atMost", trackBy: "screenTime" },
  { title: "Call a friend", icon: "📞", category: "social", period: "monthly", target: 4, unit: "times", direction: "atLeast", trackBy: "manual" },
  { title: "Read books", icon: "📖", category: "custom", period: "yearly", target: 12, unit: "books", direction: "atLeast", trackBy: "manual" },
];

export const TIMEZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];
