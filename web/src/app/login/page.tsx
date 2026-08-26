import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Sign in · Moxie",
};

type Props = {
  searchParams: Promise<{ next?: string }>;
};

export default async function LoginPage({ searchParams }: Props) {
  const sp = await searchParams;
  const nextPath = sp.next && sp.next.startsWith("/") ? sp.next : "/dashboard";

  return (
    <div className="min-h-screen bg-[var(--cream)]">
      <LoginForm nextPath={nextPath} />
    </div>
  );
}
