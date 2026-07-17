import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VERITAS DESK",
  description: "The agent-run trading desk — for real this time.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
