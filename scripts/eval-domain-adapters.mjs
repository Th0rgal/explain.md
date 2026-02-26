import {
  classifyDeclarationDomain,
  computeDomainTaggingReportHash,
  evaluateDomainTagging,
  renderDomainTaggingReport,
} from "../dist/domain-adapters.js";

const labeledSamples = [
  {
    sampleId: "verity_loop_memory",
    input: {
      declarationId: "lean:Verity/Compiler:loop_ok:10:1",
      modulePath: "Verity/Compiler",
      declarationName: "loop_ok",
      theoremKind: "theorem",
      statementText: "if loop invariant holds then compiler preserves memory state",
    },
    expectedTags: [
      "domain:verity/edsl",
      "concept:loop",
      "concept:conditional",
      "concept:memory",
      "concept:state",
      "concept:compiler_correctness",
    ],
  },
  {
    sampleId: "generic_theorem",
    input: {
      declarationId: "lean:Math/Core:refl_demo:1:1",
      modulePath: "Math/Core",
      declarationName: "refl_demo",
      theoremKind: "theorem",
      statementText: "forall n, n = n",
    },
    expectedTags: ["domain:lean/general", "kind:theorem"],
  },
  {
    sampleId: "verity_arithmetic",
    input: {
      declarationId: "lean:Verity/Arith:inc_ok:4:1",
      modulePath: "Verity/Arith",
      declarationName: "inc_ok",
      theoremKind: "lemma",
      statementText: "Nat.succ preserves arithmetic relation",
    },
    expectedTags: ["domain:verity/edsl", "concept:arithmetic"],
  },
];

const samples = labeledSamples.map((sample) => {
  const classification = classifyDeclarationDomain(sample.input);
  return {
    sampleId: sample.sampleId,
    expectedTags: sample.expectedTags,
    predictedTags: classification.tags,
  };
});

const report = evaluateDomainTagging(samples);
const rendered = renderDomainTaggingReport(report);
const hash = computeDomainTaggingReportHash(report);

process.stdout.write(`${rendered}\nreport_hash=${hash}\n`);
