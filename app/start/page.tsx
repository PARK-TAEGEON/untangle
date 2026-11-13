import { Onboarding } from "../../components/onboarding";
import { loadOnboardingPrompt } from "../../lib/onboarding-prompt";

export default async function StartPage() {
  const exportPrompt = await loadOnboardingPrompt();
  return <Onboarding exportPrompt={exportPrompt} />;
}
