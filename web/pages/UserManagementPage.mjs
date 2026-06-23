export function UserManagementPage({ root, loadUsers }) {
  return { name: "users", roots: [root], enter: () => loadUsers() };
}
