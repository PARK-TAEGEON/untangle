"use client";

import { useEffect, useRef, useState } from "react";
import { IconButton } from "./icons";

const STORAGE_KEY = "untangle.today-guide.v1";

export function TodayGuide() {
  const initialized = useRef(false);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    // Effect replay must not hide this first visit just because its marker was already saved.
    if (initialized.current) return;
    initialized.current = true;
    let firstVisit = true;
    try { firstVisit = window.localStorage.getItem(STORAGE_KEY) !== "seen"; } catch { /* Guidance still works without storage. */ }
    setVisible(firstVisit);
    if (firstVisit) {
      try { window.localStorage.setItem(STORAGE_KEY, "seen"); } catch { /* A blocked marker never blocks the app. */ }
    }
  }, []);
  if (!visible) return null;
  return <aside className="today-guide" aria-label="오늘 화면 안내"><ul className="today-guide-copy"><li>카드는 먼저 건네는 한 걸음</li><li>초안은 고쳐 쓰면 됨</li><li>관심 없으면 ×</li></ul><IconButton icon="close" label="안내 닫기" onClick={() => setVisible(false)} /></aside>;
}
