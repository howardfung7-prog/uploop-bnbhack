import { useEffect, useState } from 'react';
import type { ComponentProps } from 'react';
import type { ReactNode } from 'react';
import { CrazyRace } from './CrazyRace';
import { DailyArena } from './DailyArena';
import { tr } from '../lib/i18n';
export type CompetitionMode = 'summit' | 'daily' | 'activity';
export type CompetitionAvailability = Partial<Record<CompetitionMode, boolean>> & {
  rooms?: Partial<Record<2 | 10 | 50 | 200, boolean>>;
};

export function CompetitionGames(props: ComponentProps<typeof CrazyRace> & {
  availability?: CompetitionAvailability;
  dailyPreview?: ComponentProps<typeof DailyArena>["preview"];
  activityContent?: ReactNode;
  onModeChange?: (mode: CompetitionMode) => void;
}) {
  const { availability = {}, activityContent, dailyPreview, onModeChange, ...raceProps } = props;
  const modeFromHash = (): CompetitionMode => location.hash.startsWith('#arena/daily') ? 'daily' : location.hash.startsWith('#arena/activity') ? 'activity' : 'summit';
  const [mode, setMode] = useState<CompetitionMode>(modeFromHash);
  useEffect(() => { const change = () => { const next = modeFromHash(); setMode(next); onModeChange?.(next); }; addEventListener('hashchange', change); return () => removeEventListener('hashchange', change); }, [onModeChange]);
  const select = (next: CompetitionMode) => {
    if (availability[next] === false) return;
    setMode(next); onModeChange?.(next);
    location.hash = next === 'daily' ? 'arena/daily' : next === 'activity' ? 'arena/activity' : 'arena';
  };
  return <div className={`competition-games competition-${mode}`}>
    <div className="competition-tabs" role="group" aria-label={tr('Competition type')}>
      {([['summit', '100-point race'], ['daily', 'Daily arenas'], ['activity', 'Activity matches']] as const).map(([key, label]) => (
        <button key={key} className={`competition-tab-${key}`} aria-pressed={mode === key} disabled={availability[key] === false} onClick={() => select(key)}>{tr(label)}</button>
      ))}
    </div>
    {availability[mode] === false ? <div className="competition-disabled" role="status">{tr('This competition is temporarily unavailable.')}</div>
      : mode === 'daily' ? <DailyArena {...raceProps} configured={dailyPreview ? true : raceProps.configured} preview={dailyPreview}/>
      : mode === 'activity' ? activityContent
      : <CrazyRace {...raceProps} roomAvailability={availability.rooms}/>}  </div>;
}
