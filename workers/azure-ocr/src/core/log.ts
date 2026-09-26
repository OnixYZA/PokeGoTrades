/**
 * One JSON object per line. Azure Functions ships `console.log` / `console.error` output straight to the
 * Function's own log stream and, when Application Insights is wired up, into `traces` there too, both of
 * which can filter and query structured fields the same way CloudWatch Logs Insights did for the Lambda
 * version. Never pass OCR text, a handle or a friend code in here: a proof screenshot can show a trainer
 * name, a friend code, or a location, and the profile queue exists specifically to extract the first two.
 */
export function log(level: 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, msg, ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
}
