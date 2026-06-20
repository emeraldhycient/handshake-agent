import { AdaptiveExperience } from "@/components/shared/adaptive-experience"

/**
 * `/` root route — auto-selects the right surface by viewport.
 * Below lg (1024px) → mobile chat app.
 * At lg+ → desktop dashboard.
 * No manual choice needed.
 */
export default function Home() {
  return <AdaptiveExperience />
}
