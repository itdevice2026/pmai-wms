import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PMAI Warehouse Management System",
  description:
    "Crate-level traceability for basic dressing, further processing and warehouse operations.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
