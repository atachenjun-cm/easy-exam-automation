export function RequirementListPage({ root, loadRequirements }) {
  return { name: "requirements", roots: [root], enter: () => loadRequirements() };
}
