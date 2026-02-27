import { ProofExplorer } from "../../components/proof-explorer";
import { isSupportedProofId, SEED_PROOF_ID } from "../../lib/proof-service";

interface ProofExplorerPageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

export default function ProofExplorerPage(props: ProofExplorerPageProps) {
  const requested = props.searchParams?.proofId;
  const proofId = typeof requested === "string" && isSupportedProofId(requested) ? requested : SEED_PROOF_ID;
  return <ProofExplorer proofId={proofId} />;
}
