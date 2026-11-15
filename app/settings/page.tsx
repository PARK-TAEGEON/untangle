import { Settings } from "../../components/settings";
import { loadOnboardingPrompt } from "../../lib/onboarding-prompt";

export const metadata = { title: "설정" };

export default async function SettingsPage() {
  return <Settings exportPrompt={await loadOnboardingPrompt()} />;
}
