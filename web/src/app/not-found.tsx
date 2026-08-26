import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--cream)] px-6 text-center">
      <h1 className="font-[family-name:var(--font-display)] text-3xl font-light text-[var(--navy)]">
        Not found
      </h1>
      <p className="mt-3 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
        That vessel code does not exist or is not published yet.
      </p>
      <Link
        className="mt-8 font-[family-name:var(--font-dm)] text-sm text-[var(--blue-fg)] underline"
        href="/"
      >
        Back to home
      </Link>
    </div>
  );
}
