"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Shared open/edit/save state for the owner-profile section edit forms
 * (Vessel details, Registration, Storage, Contact, Emergency, Notes,
 * Insurance, Propulsion & safety) — each section's fields and layout
 * differ, but this bookkeeping doesn't, so it's factored out rather than
 * repeated in all eight.
 */
export function useSectionEdit<T>(initial: T) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<T>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function open() {
    setValues(initial);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  function save(action: () => Promise<{ error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  return { editing, values, setValues, error, pending, open, cancel, save };
}
