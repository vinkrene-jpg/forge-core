export interface SidebarItem { id: string; group: string; label: string }
export function groupSidebarItems(items: SidebarItem[]): Record<string, SidebarItem[]> {
  const out: Record<string, SidebarItem[]> = {};
  for (const item of items) {
    (out[item.group] ??= []).push(item);
  }
  return out;
}
