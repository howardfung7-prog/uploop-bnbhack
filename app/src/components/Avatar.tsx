import { tr } from "../lib/i18n";
import { avatarSpec } from "../lib/avatar";

interface Props {
  address: string;
  variant?: number;
  size?: number;
  title?: string;
}

export function Avatar({ address, variant = 0, size = 28, title }: Props) {
  const { cells, round, fg, bg } = avatarSpec(address, variant);
  return (
    <svg
      className="avatar"
      viewBox="0 0 5 5"
      width={size}
      height={size}
      role="img"
      aria-label={title ?? tr("Avatar for {0}", address.slice(0, 6))}
    >
      <rect width="5" height="5" fill={bg} />
      {cells.map((on, i) =>
        on ? (
          round[i] ? (
            <circle key={i} cx={(i % 5) + 0.5} cy={Math.floor(i / 5) + 0.5} r="0.42" fill={fg} />
          ) : (
            <rect key={i} x={i % 5} y={Math.floor(i / 5)} width="1" height="1" fill={fg} />
          )
        ) : null
      )}
    </svg>
  );
}
