import type {
  LeaderboardPeriod,
  LeaderboardResponse,
  LeaderboardSort,
  MatchRecord,
  PlayerProfile,
  StorageStatus,
} from '@pfa/shared';

/** Empty in dev: Vite proxies /api to the game server, so one origin serves both. */
const BASE = import.meta.env.VITE_SERVER_URL ?? '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}/api${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });

  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(detail?.message ?? `Request failed (${response.status})`);
  }

  return (await response.json()) as T;
}

export function fetchStorageStatus(): Promise<StorageStatus> {
  return request<StorageStatus>('/storage');
}

export function fetchLeaderboard(
  period: LeaderboardPeriod,
  sort: LeaderboardSort,
  limit = 25,
): Promise<LeaderboardResponse> {
  return request<LeaderboardResponse>(
    `/leaderboard?period=${period}&sort=${sort}&limit=${limit}`,
  );
}

export function fetchMatchHistory(
  profileId: string,
  limit = 20,
): Promise<{ profile: PlayerProfile; matches: MatchRecord[] }> {
  return request(`/profiles/${profileId}/matches?limit=${limit}`);
}

export function buyUpgrade(
  profileId: string,
  attribute: string,
  secret: string,
): Promise<PlayerProfile> {
  return request<PlayerProfile>(`/profiles/${profileId}/upgrade`, {
    method: 'POST',
    headers: { 'x-pfa-secret': secret },
    body: JSON.stringify({ attribute }),
  });
}

export function equipSkin(
  profileId: string,
  skinId: string,
  secret: string,
): Promise<PlayerProfile> {
  return request<PlayerProfile>(`/profiles/${profileId}/skin`, {
    method: 'POST',
    headers: { 'x-pfa-secret': secret },
    body: JSON.stringify({ skinId }),
  });
}

export function renameProfile(
  profileId: string,
  nickname: string,
  secret: string,
): Promise<PlayerProfile> {
  return request<PlayerProfile>(`/profiles/${profileId}/nickname`, {
    method: 'POST',
    headers: { 'x-pfa-secret': secret },
    body: JSON.stringify({ nickname }),
  });
}
