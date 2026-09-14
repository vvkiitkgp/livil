// Safari still exposes the prefixed constructor; `analyzeLocalFile` falls back to it.
interface Window {
  webkitOfflineAudioContext?: typeof OfflineAudioContext;
}
