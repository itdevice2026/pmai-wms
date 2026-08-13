"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NAV, type NavSection } from "@/lib/nav";

export function Sidebar({
  sections,
  plantName,
}: {
  sections: NavSection[];
  plantName: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav className="thin-scroll flex h-full flex-col overflow-y-auto">
      <div className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-slate-200 bg-white px-5 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
          P
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900">PMAI</div>
          <div className="truncate text-[11px] text-slate-500">{plantName}</div>
        </div>
      </div>

      <div className="flex-1 px-3 pb-8 pt-3">
        {sections.map((section, si) => (
          <div key={section.title ?? `s${si}`} className="mb-4">
            {section.title && (
              <div className="px-2 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                {section.title}
              </div>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={`block rounded-lg px-2.5 py-1.5 text-[13px] transition ${
                        active
                          ? "bg-brand-50 font-medium text-brand-700"
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Toggle navigation"
        className="fixed left-3 top-3 z-50 rounded-lg border border-slate-300 bg-white p-2 shadow-sm lg:hidden"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/30 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 border-r border-slate-200 bg-white transition-transform lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {nav}
      </aside>
    </>
  );
}

export { NAV };
