export function ProjectDetailPage({ root, loadProject }) {
  return { name: "project-detail", roots: [root], enter: (route) => loadProject(route.params.projectId) };
}
