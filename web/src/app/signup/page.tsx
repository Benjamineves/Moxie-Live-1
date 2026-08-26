import type { Metadata } from "next";
import { SignupForm } from "./SignupForm";

export const metadata: Metadata = {
  title: "Create account · Moxie",
};

type Props = {
  searchParams: Promise<{ next?: string }>;
};

export default async function SignupPage({ searchParams }: Props) {
  const sp = await searchParams;
  const nextPath = sp.next && sp.next.startsWith("/") ? sp.next : "/dashboard";

  return (
    <div className="min-h-screen bg-[var(--cream)]">
      <SignupForm nextPath={nextPath} />
    </div>
  );
}
