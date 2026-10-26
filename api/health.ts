/* Probe deployment — diagnosis apakah api/ functions ter-detect. */
export default function handler(): Response {
  return new Response(JSON.stringify({ ok: true, probe: "health" }), {
    headers: { "Content-Type": "application/json" },
  });
}
