/// Avatars generated deterministically from an address.
///
/// The point is to give a high-win-rate player something recognisable, not to let people express
/// themselves — so there is nothing to upload. Deriving it from the address means it is unique,
/// free, needs no moderation, and cannot be impersonated (the pattern follows the address, so
/// changing a display name does not change the picture), and a single variant number reproduces
/// it exactly.
///
/// Uploaded pictures are a later question: swap `variant` for an image URL and it is an addition,
/// not a rewrite. But that needs image hosting, a review queue and a takedown process — user
/// uploads on a public leaderboard will, sooner or later, include porn, hate imagery and stolen
/// likenesses.
///
/// The pattern is a 5×5 grid with left-right symmetry. Symmetry makes it read as designed rather
/// than as noise, and it stays recognisable at 24px because the difference lies in the overall
/// silhouette rather than in the detail.

export const VARIANTS = 8;

/// xorshift32: deterministic, dependency-free, good enough. Not used for anything security-related.
function rng(seed: number) {
  let x = seed || 1;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    return x / 0x1_0000_0000;
  };
}

function seedOf(address: string, variant: number): number {
  const hex = address.toLowerCase().replace(/^0x/, "");
  let h = 2166136261 ^ (variant * 0x9e3779b9);
  for (let i = 0; i < hex.length; i++) {
    h ^= hex.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const PALETTES: [string, string][] = [
  ["#3FA6E8", "#10243A"],
  ["#45A79A", "#12302C"],
  ["#E2726A", "#33211F"],
  ["#D9A44A", "#2C2313"],
  ["#8B7BE8", "#221E3A"],
  ["#5AC08A", "#14301F"],
  ["#E8845A", "#33231A"],
  ["#6FB8D9", "#162A33"],
];

export interface AvatarSpec {
  cells: boolean[];   // 5×5, row-major
  round: boolean[];   // whether each cell is drawn as a circle or a square
  fg: string;
  bg: string;
}

export function avatarSpec(address: string, variant = 0): AvatarSpec {
  const next = rng(seedOf(address, variant));
  const [fg, bg] = PALETTES[Math.floor(next() * PALETTES.length) % PALETTES.length];

  const cells = new Array<boolean>(25).fill(false);
  const round = new Array<boolean>(25).fill(false);

  // Only the left half (including the middle column) is rolled; the right half mirrors it —
  // that symmetry is what makes the result look designed.
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      const on = next() > 0.45;
      const isRound = next() > 0.5;
      for (const xx of x === 2 ? [2] : [x, 4 - x]) {
        cells[y * 5 + xx] = on;
        round[y * 5 + xx] = isRound;
      }
    }
  }
  return { cells, round, fg, bg };
}
