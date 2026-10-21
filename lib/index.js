// dsh-enter-guard host half: an intentionally empty shell.
// The whole behaviour lives in the browser bundle (lib/client.js), which installs
// its own document-level key listener. Nothing here touches sessions, storage or
// the network.
export default {
  apply(ctx) {},
}
