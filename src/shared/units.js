// Physical constants and the game clock. Everything in SI: metres, kilograms, seconds.

export const AU = 149597870700;
export const G = 6.6743e-11;
export const DAY = 86400;
export const HOUR = 3600;
export const DEG = Math.PI / 180;

// Game time runs faster than real time so a sunrise fits inside one session.
// A martian day (24.6229 h) lands at about 15 minutes of wall clock.
export const TIME_SCALE = 100;

export function formatDistance(metres) {
  const m = Math.abs(metres);
  if (m >= 0.1 * AU) return `${(metres / AU).toFixed(4)} AU`;
  if (m >= 1e6) return `${(metres / 1000).toFixed(0)} km`;
  if (m >= 1000) return `${(metres / 1000).toFixed(2)} km`;
  return `${metres.toFixed(1)} m`;
}

export function formatSpeed(metresPerSecond) {
  const v = Math.abs(metresPerSecond);
  if (v >= 1e6) return `${(metresPerSecond / 1000).toFixed(0)} km/s`;
  if (v >= 1000) return `${(metresPerSecond / 1000).toFixed(2)} km/s`;
  return `${metresPerSecond.toFixed(1)} m/s`;
}
