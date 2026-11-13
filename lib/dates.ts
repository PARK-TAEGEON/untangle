export function todayInSeoul(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

export function deadlineCaption(deadline: string | null, today: string): string | null {
  if (!deadline) return null;
  const days = Math.round((Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (!Number.isFinite(days)) return null;
  if (days > 0) return `${days}일 남음`;
  if (days === 0) return "오늘 일정";
  return `${Number(deadline.slice(5, 7))}월 ${Number(deadline.slice(8, 10))}일 일정`;
}
