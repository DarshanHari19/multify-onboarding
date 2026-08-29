// Aggregates 👍/👎 suggestion-feedback events for the dashboard. Pure and
// dependency-free like lib/retriever.js — feedback_up/feedback_down are NOT
// funnel stages (see server.js FEEDBACK_STAGES), so this stays a separate
// summary rather than folding into the STAGES funnel aggregation.

export function summarizeFeedback(events) {
  const result = { up: 0, down: 0, byConnector: {} };
  for (const e of events || []) {
    if (e.stage !== "feedback_up" && e.stage !== "feedback_down") continue;
    const key = e.stage === "feedback_up" ? "up" : "down";
    result[key]++;
    (result.byConnector[e.connectorId] ||= { up: 0, down: 0 })[key]++;
  }
  return result;
}
