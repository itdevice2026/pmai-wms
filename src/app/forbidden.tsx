import Link from "next/link";

export default function Forbidden() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold text-brand-600">403</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          You don&apos;t have access to this module
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Your role doesn&apos;t include permission for this screen. Ask an administrator to
          grant it under System → RBAC.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
