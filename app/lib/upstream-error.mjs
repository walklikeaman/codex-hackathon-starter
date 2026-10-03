// An upstream that did not answer is a 504; one that answered badly, or not at all for
// another reason, is a 502 (#85). Copied word for word into the city and location routes;
// each keeps its own sentences and its own way of logging.
export function isTimeout(error) {
  return error?.name === "TimeoutError" || error?.name === "AbortError";
}

export function upstreamFailed(error, { timeoutMessage, failureMessage }) {
  const timedOut = isTimeout(error);
  return Response.json({ error: timedOut ? timeoutMessage : failureMessage }, { status: timedOut ? 504 : 502 });
}
