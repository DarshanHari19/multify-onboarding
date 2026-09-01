// Flywheel step 4 — lets connect-rate data refine (never reshuffle) a
// curated role bundle. Pure, dependency-free (mirrors lib/affinity.js /
// lib/sensitivity.js conventions) so it's cheap to unit-test and safe to
// duplicate into app.js (classic script, no module loader — see firstwin.js
// for the established precedent of duplicating a pure lib client-side).
//
// Design (locked, see FLYWHEEL Step 4 spec):
// - Blend, don't reshuffle: auto-enabled entries always precede suggested
//   entries in the output; only the order WITHIN each group is data-driven.
// - Promote only, never demote: a curated auto entry never becomes
//   suggested, regardless of its rate.
// - Risk gate is absolute: `isSensitive` can veto a promotion outright.
// - Thin data doesn't reorder: entries with n < minN keep their original
//   relative order, pinned to the bottom of their group.

export function adjustBundle(bundle, affinity, opts, isSensitive) {
  const { promoteThreshold = 0.6, minN = 20 } = opts || {};
  const changes = [];
  const autoGroup = [];
  const suggestedGroup = [];

  for (const entry of bundle) {
    if (entry.auto) {
      autoGroup.push({ ...entry });
      continue;
    }
    const aff = (affinity || {})[entry.id] || { rate: 0, n: 0 };
    if (aff.rate >= promoteThreshold && aff.n >= minN && !isSensitive(entry)) {
      autoGroup.push({ ...entry, auto: true });
      changes.push({ id: entry.id, type: "promoted", rate: aff.rate, n: aff.n });
    } else {
      suggestedGroup.push({ ...entry });
    }
  }

  const nOf = (id) => ((affinity || {})[id] || {}).n || 0;
  const rateOf = (id) => ((affinity || {})[id] || {}).rate || 0;
  function sortByRateDesc(group) {
    const sufficient = group.filter((e) => nOf(e.id) >= minN);
    const insufficient = group.filter((e) => nOf(e.id) < minN);
    sufficient.sort((a, b) => rateOf(b.id) - rateOf(a.id));
    return [...sufficient, ...insufficient];
  }

  return {
    ordered: [...sortByRateDesc(autoGroup), ...sortByRateDesc(suggestedGroup)],
    changes,
  };
}
