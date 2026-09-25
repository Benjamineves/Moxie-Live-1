import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";
import { safeNextPath } from "@/lib/safe-next";

export const metadata: Metadata = {
  title: "Sign in · Moxie",
};

type Props = {
  searchParams: Promise<{ next?: string }>;
};

export default async function LoginPage({ searchParams }: Props) {
  const sp = await searchParams;
  const nextPath = safeNextPath(sp.next);

  return (
    <div className="min-h-screen bg-[var(--cream)]">
      <LoginForm nextPath={nextPath} />
    </div>
  );
}
