/// Which information page the address bar points at (§71.41). Split out of SitePage.tsx so App can
/// route without loading that page, its FAQ and its legal text up front: SitePage itself is a lazy
/// chunk (§71.174).
export type Site = "notices" | "help" | "disclaimer" | "privacy";

export function readSite(): Site | null {
  const h = location.hash.slice(1).split("/")[0];
  return h === "notices" || h === "help" || h === "disclaimer" || h === "privacy" ? h : null;
}
