"use client";

import { useSyncExternalStore } from "react";
import { getServerThemeSnapshot, getThemeSnapshot, setTheme, subscribeTheme } from "../lib/theme";
import { IconButton } from "./icons";

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);
  const dark = theme === "dark";
  return <IconButton icon={dark ? "sun" : "moon"} label={dark ? "밝은 모드로 전환" : "어두운 모드로 전환"} onClick={() => setTheme(dark ? "light" : "dark")} />;
}
