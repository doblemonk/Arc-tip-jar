import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Arc Tip Jar — Cross-chain tips on Arc Testnet",
  description:
    "Tip a creator in USDC on Arc Testnet via Circle Gateway. One unified balance, no manual bridging.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            Arc Tip Jar
          </Link>
          <span className="testnet-badge">Arc Testnet · USDC only</span>
          <nav>
            <Link href="/creator">Creator setup</Link>
            <Link href="/dashboard">Dashboard</Link>
          </nav>
        </header>
        <main className="container">{children}</main>
        <footer className="footer">
          Testnet only — Arc Testnet (chain 5042002, Gateway domain 26).
          No mainnet, no real funds. Donations settle via Circle Gateway
          webhooks.
        </footer>
      </body>
    </html>
  );
}
