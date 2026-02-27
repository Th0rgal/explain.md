import { ProofExplorer } from "../../components/proof-explorer";
import { SEED_PROOF_ID } from "../../lib/proof-service";

export default function ProofExplorerPage() {
  return <ProofExplorer proofId={SEED_PROOF_ID} />;
}
