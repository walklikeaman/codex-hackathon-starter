// What every route that calls a model does around the call (#81).
//
// Three pieces were copied into the tour, narration and discover routes, and had begun to
// drift — one logged through an injected logger, two through console.error:
//
//   * a body that is not JSON is `null`, so the route's own schema refuses it with its 400;
//   * no model configured is a 503 that names the capability, before anything is paid for;
//   * a model or upstream failure is a 502 with a sentence the reader can act on, and the
//     log records the error's name and HTTP status — never its message, which can carry the
//     prompt or the provider's account details back into our logs.
//
// The wording stays with each route: "AI tours are not configured." is what the tour UI
// shows, and a shared generic sentence would be worse there.
//
// /api/film-image is deliberately not on this: it is a GET, answers a missing key with a
// 200 and a reason the card can show, and logs which upstream stage failed.

export function readJsonBody(request) {
  return request.json().catch(() => null);
}

export function notConfigured(message) {
  return Response.json({ error: message }, { status: 503 });
}

export function modelFailed({ error, label, message, log = console.error }) {
  log(label, { name: error?.name, status: error?.status });
  return Response.json({ error: message }, { status: 502 });
}
