/**
 * One JSON object per line, which CloudWatch Logs Insights can query. Never pass OCR text in here: a proof
 * screenshot can show a trainer name, a friend code or a location.
 */
export function log(level: 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, msg, ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
}
