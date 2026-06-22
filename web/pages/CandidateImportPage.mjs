export function CandidateImportPage({ root, loadContext = async () => {} }) {
  return { name: "candidate-import", roots: [root], enter: () => loadContext() };
}
