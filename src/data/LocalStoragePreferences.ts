/** Preferencias persistidas en localStorage del cliente webview. */
import type { Preferences } from "../domain/repositories/Preferences";

export class LocalStoragePreferences implements Preferences {
  get(key: string): string | null {
    return localStorage.getItem(key);
  }

  set(key: string, value: string): void {
    localStorage.setItem(key, value);
  }

  remove(key: string): void {
    localStorage.removeItem(key);
  }
}
