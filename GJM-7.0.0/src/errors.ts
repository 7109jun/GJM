export const GJM_CODES = {
  OK: 'GJM-OK',
  MAKE_INVALID: 'GJM-E101',
  MAKE_APPLY_FAILED: 'GJM-E102',
  BEHAVIOR_INVALID: 'GJM-E111',
  BEHAVIOR_APPLY_FAILED: 'GJM-E112',
  GODOT_RUNTIME: 'GJM-E201',
  BEHAVIOR_RUNTIME: 'GJM-E202',
  ASSERTION_FAILED: 'GJM-E203',
  GODOT_TIMEOUT: 'GJM-E302',
  FFMPEG_FAILED: 'GJM-E303',
  ENVIRONMENT: 'GJM-E301',
  BEHAVIOR_REQUIRED: 'GJM-W201',
  UNKNOWN_BEHAVIOR: 'GJM-W101'
} as const;

export type GjmCode = typeof GJM_CODES[keyof typeof GJM_CODES];

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
