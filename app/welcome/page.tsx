import type { Metadata } from "next";
import { Welcome } from "../../components/welcome";

export const metadata: Metadata = {
  title: { absolute: "Untangle" },
  description: "Every knot gives way, one thread at a time.",
};

export default function WelcomePage() { return <Welcome />; }
