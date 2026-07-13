/**
 * /signup — legacy route, redirects to the unified onboarding wizard.
 *
 * Task F2.1: signup now lives inside `/get-started` (its `email` step),
 * which also handles OTP verification, name, PIN, and KYC choice. This
 * route is kept only so old links/bookmarks still resolve.
 */
import { redirect } from "next/navigation"

export default function SignupPage() {
  redirect("/get-started")
}
