// Which PayPal the app is talking to. LIVE: the real PayPal sandbox. REPLAY: recorded sandbox
// responses (Phase 6), flagged in the UI so nobody mistakes them for live calls.

export type AppMode = 'live' | 'replay';

export const appMode = (): AppMode => (process.env.REPLAY_MODE === '1' || process.env.REPLAY_MODE === 'true' ? 'replay' : 'live');
