export function RequirementDetailPage({ root, loadRequirement }) {
  return { name: "requirement-detail", roots: [root], enter: (route) => loadRequirement(route.params.requestId) };
}
