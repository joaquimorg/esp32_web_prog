// localStorage access that never throws (private mode, blocked storage, corrupt JSON)
export function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch (e) {
    return fallback
  }
}

export function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    // storage unavailable: settings simply won't persist
  }
}
