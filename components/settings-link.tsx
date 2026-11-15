import Link from "next/link";
import { LineIcon } from "./icons";

export function SettingsLink({ active = false }: { active?: boolean }) {
  return <Link href="/settings" className="icon-button" aria-label="설정" title="설정" data-tooltip="설정" aria-current={active ? "page" : undefined}><LineIcon name="settings" /></Link>;
}
