/* Probe deployment — diagnosis apakah api/ functions ter-detect. */
export default function handler(_req: any, res: any): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: true, probe: "health" }));
}
