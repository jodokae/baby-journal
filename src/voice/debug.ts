// Temporary dictation diagnostics. Enable with localStorage.setItem('voiceDebug', '1') + reload,
// or by opening the app with ?voiceDebug=1. Remove once the dictation chain is verified on-device.
// The flag is read ONCE per page load (module scope) — toggling it needs a reload.
const enabled =
  typeof localStorage !== 'undefined' &&
  (localStorage.getItem('voiceDebug') === '1' ||
    (typeof location !== 'undefined' && new URLSearchParams(location.search).has('voiceDebug')));

export function voiceDebug(...args: unknown[]): void {
  if (enabled) console.debug('[voice]', ...args);
}
