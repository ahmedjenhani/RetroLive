import { readJson, writeStorage } from './storage';

export interface ParticipantCredentials {
  token: string;
  nickname: string;
  isHost: boolean;
}

const key = (sessionId: string): string => `retrolive.participant.${sessionId}`;

/** What the browser remembers about "me" in one session, so a refresh or reconnect keeps my votes. */
export const loadParticipant = (sessionId: string): ParticipantCredentials | null =>
  readJson<ParticipantCredentials>(key(sessionId));

export const saveParticipant = (sessionId: string, credentials: ParticipantCredentials): void =>
  writeStorage(key(sessionId), JSON.stringify(credentials));

export const forgetParticipant = (sessionId: string): void => writeStorage(key(sessionId), null);

const NICKNAME_KEY = 'retrolive.nickname';
export const lastNickname = (): string => readJson<string>(NICKNAME_KEY) ?? '';
export const rememberNickname = (nickname: string): void => writeStorage(NICKNAME_KEY, JSON.stringify(nickname));
