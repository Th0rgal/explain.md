import Link from "next/link";
import { listProofs } from "../lib/proof-service";

export default async function HomePage() {
  const catalog = await listProofs();

  return (
    <section className="home">
      <article className="home-card">
        <h2>Deterministic proof datasets are active</h2>
        <p>
          The scaffold serves both a seed proof and a Lean-ingested Verity fixture through the same provenance-preserving tree query
          APIs.
        </p>
        <p>
          <Link href="/proofs">Open proof explorer</Link>
        </p>
      </article>

      <article className="panel">
        <h2>Available proofs</h2>
        <ul>
          {catalog.map((proof) => (
            <li key={proof.proofId}>
              <strong>{proof.title}</strong> ({proof.leafCount} leaves, depth {proof.maxDepth}){" "}
              <Link href={`/proofs?proofId=${encodeURIComponent(proof.proofId)}`}>Open</Link>
            </li>
          ))}
        </ul>
      </article>
    </section>
  );
}
