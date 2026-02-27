import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "explain.md",
  description: "Provenance-first Lean proof explanations",
};

export default function RootLayout(props: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="app-header">
          <div>
            <p className="kicker">explain.md</p>
            <h1>Proof Explanation Workbench</h1>
          </div>
          <nav aria-label="Main">
            <Link href="/">Home</Link>
            <Link href="/proofs">Proof Explorer</Link>
          </nav>
        </header>
        <main>{props.children}</main>
      </body>
    </html>
  );
}
