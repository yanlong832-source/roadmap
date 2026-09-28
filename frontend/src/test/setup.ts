import "@testing-library/jest-dom";

// React Flow (@xyflow/react) observes container size via ResizeObserver,
// which jsdom does not implement. Provide a no-op stub so the flow
// renders under Vitest without layout side effects.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
