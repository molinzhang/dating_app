import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

// Node 22+ ships its own global `localStorage`, and it wins over the one jsdom
// installs. Without `--localstorage-file` that global is a stub whose `clear`
// is undefined, so the suite died in this hook before running a single
// assertion — and any code under test that touches localStorage (App.tsx keeps
// the auth token there) saw the same broken object. Swap in a real in-memory
// Storage when the environment's copy isn't usable.
if (typeof window.localStorage?.clear !== "function") {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (key: string) => store.get(String(key)) ?? null,
    setItem: (key: string, value: string) => void store.set(String(key), String(value)),
    removeItem: (key: string) => void store.delete(String(key)),
    clear: () => store.clear(),
  };
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});
