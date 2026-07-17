import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ChainAlpha — Supply-Chain World Model & Trading Simulation",
  description:
    "From physical-world disruption to tradable financial exposure. A supply-chain command center that models disruptions across a semiconductor world graph and simulates hedged trades.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${plexMono.variable}`}>
      <body className="min-h-screen bg-atlas-bg antialiased overflow-hidden">
        {children}
      </body>
    </html>
  );
}
