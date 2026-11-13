import { Onboarding } from "../../components/onboarding";
import { loadOnboardingPrompt } from "../../lib/onboarding-prompt";
export const metadata = { title: "내 기록 가져오기" };

export default async function StartPage() {
  const exportPrompt = await loadOnboardingPrompt();
  return <Onboarding exportPrompt={exportPrompt} />;
}
