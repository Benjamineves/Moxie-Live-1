import type { Metadata } from "next";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Reset password · Moxie",
};

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen bg-[var(--cream)]">
      <ForgotPasswordForm />
    </div>
  );
}
