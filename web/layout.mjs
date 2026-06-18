export function AppLayout({ pages, menuElements = [] }) {
  const pageByName = new Map(pages.map((page) => [page.name, page]));
  const allRoots = [...new Set(pages.flatMap((page) => page.roots))].filter(Boolean);

  async function render(route) {
    const page = pageByName.get(route.name) || pageByName.get("not-found");
    for (const root of allRoots) root.hidden = !page?.roots.includes(root);
    for (const item of menuElements) {
      item.element.classList.toggle("active", Boolean(route.menuKey && item.key === route.menuKey));
    }
    if (page?.enter) await page.enter(route);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  return { render };
}
