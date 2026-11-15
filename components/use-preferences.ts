"use client";

import { useSyncExternalStore } from "react";
import { getPreferencesSnapshot, getServerPreferencesSnapshot, subscribePreferences } from "../lib/preferences";
import type { Preferences } from "../lib/preferences";

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribePreferences, getPreferencesSnapshot, getServerPreferencesSnapshot);
}
