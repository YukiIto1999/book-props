/** A consent the user has already given. */
export function agreed() {
  return { given: async () => true, agree: async () => {}, withdraw: async () => {} };
}

/** A settings page view that records what it says in `said` and what it shows in `shown`. */
export function optionsView(said, shown = {}) {
  return {
    disclose: (disclosed) => (shown.disclosed = disclosed),
    agreeing: () => {},
    say: (text) => said.push(text),
    offerAllow: () => {},
    pairing: () => {},
    allowing: () => {},
  };
}
