import { apiGet, apiPost, ApiError, apiErrorText } from './api';
import { tr } from './i18n';
export interface DailyLeg { ticker: string; symbol: string; side: 'long'|'short'; return_points?: string; close?: string }
export interface DailyScore { entry_id: number; player: string; rank: number; return_points: string; estimated_prize: string; legs: DailyLeg[] }
export interface DailyEntry { id: number; player: string; name: string; changes: number; strategy: {name: string; legs: DailyLeg[]}; prize: string; creator_reward: string; performance: DailyScore|null }
export interface DailyRoom { my_prize?: string; my_creator_reward?: string; id: number; name: string; creator: string; creator_name: string; starts_at: number; ends_at: number; cutoff_at: number; amount: string; status: string; count: number; locked: number; total_prize: string; bonus?: string; featured?: string|null; prize_slots: number; reason: string|null; pause_reason: string|null; enabled: boolean }
export interface DailyList { rooms: DailyRoom[]; next_before: number|null; enabled: boolean }
export interface DailyDetail { room: DailyRoom; entries: DailyEntry[]; samples: {at: number; scores: DailyScore[]}[]; me: DailyEntry|null; balance: string|null; operations_paused?: boolean; result: {platform_fee: string; stakers_fee?: string; jackpot_fee?: string; referral_fee?: string; platform_share?: string; creator_reward: string; player_budget: string; bonus?: string; reason?: string}|null }
const CJK_NAME_CHAR = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
export const dailyNameLimit = (name: string) => CJK_NAME_CHAR.test(name) ? 32 : 64;
export const validDailyName = (name: string) => {
  const value = name.trim();
  return value.length > 0 && Array.from(value).length <= dailyNameLimit(value);
};
export const loadDailyRooms = (before?: number, address?: string) => apiGet<DailyList>('/daily-arenas', {before,address});
export const loadDailyRoom = (id: number) => apiGet<DailyDetail>(`/daily-arenas/${id}`);
export const dailyAction = (body: Record<string,unknown>) => apiPost<{room_id:number;kind:string}>('/daily-arenas/actions',body);
export function dailyError(error: unknown) {
  const messages: Record<string,string> = {
    BAD_DAILY_STRATEGY: tr('Choose a saved five-asset strategy.'), BAD_DATE: tr('Choose a UTC date in the next 30 days.'),
    BAD_NAME: tr('Chinese arena names allow up to 32 characters; English names allow up to 64 characters.'), BAD_AMOUNT: tr('Choose 5, 10, 50 or 200 USDT.'), BAD_BONUS: tr('Bonus must be a whole number from 0 to 10,000 USDT.'),
    DAILY_CLOSED: tr('This arena is no longer open.'), DAILY_ENTRY_CLOSED: tr('Registration closes 15 minutes before the start.'),
    DAILY_STARTED: tr('Strategies are locked after the start.'), DAILY_SWITCH_USED: tr('Your one strategy change has already been used.'),
    DAILY_NOT_CREATOR: tr('Only the creator can cancel this arena.'), DAILY_LOCKED: tr('An arena cannot be cancelled once three wallets have joined.'),
    INSUFFICIENT_BALANCE: tr('Insufficient arena balance. Please deposit first.'), ALREADY_IN: tr('You have already entered this arena.'),
    IDEMPOTENCY_CONFLICT: tr('The request has changed. Review and submit it again.'), DISABLED: tr('Daily arenas are currently unavailable.'),
  };
  return error instanceof ApiError && messages[error.code] ? messages[error.code] : apiErrorText(error);
}
export function dailyStatus(room: DailyRoom) {
  if (room.status==='refunded') return room.reason==='all_equal' ? tr('All returns equal · refunded') : tr('Cancelled · refunded');
  return room.status==='finished' ? tr('Settled') : room.pause_reason ? tr('Waiting for market data') : room.status==='active' ? tr('Live') : tr('Registration');
}
