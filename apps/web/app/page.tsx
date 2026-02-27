import Link from "next/link";
import { listSeedProofs } from "../lib/proof-service";

export default async function HomePage() {
  const catalog = listSeedProofs();

  return (
    <section className="home">
      <article className="home-card">
        <h2>Deterministic seed data is active</h2>
        <p>
          The scaffold runs with a provenance-preserving Verity seed proof so UI and API contracts can be validated before full
          Lean ingestion wiring.
        </p>
        <p>
          <Link href="/proofs">Open proof explorer</Link>
        </p>
      </article>

      <article className="panel">
        <h2>Seed proofs</h2>
        <ul>
          {catalog.map((proof) => (
            <li key={proof.proofId}>
              <strong>{proof.title}</strong> ({proof.leafCount} leaves, depth {proof.maxDepth})
            </li>
          ))}
        </ul>
      </article>
    </section>
  );
}
