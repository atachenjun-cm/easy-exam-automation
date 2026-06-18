export function ProjectListPage({ root, loadProjects }) {
  return { name: "projects", roots: [root], enter: () => loadProjects() };
}
