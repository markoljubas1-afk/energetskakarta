import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChunkLoadError, loadChunk } from "./chunks";
import { ErrorBoundary } from "./ErrorBoundary";

const reloadPage = vi.hoisted(() => vi.fn());
vi.mock("./chunks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./chunks")>()),
  reloadPage,
}));

let broken = true;
function Child({ error }: { error: Error }) {
  if (broken) throw error;
  return <p>shown</p>;
}

function renderWith(error: Error) {
  return render(
    <ErrorBoundary
      area="test"
      fallback={(reset, failure) => (
        <button type="button" onClick={reset}>
          {failure instanceof ChunkLoadError ? "reload" : "retry"}
        </button>
      )}
    >
      <Child error={error} />
    </ErrorBoundary>,
  );
}

afterEach(() => {
  broken = true;
  reloadPage.mockReset();
  vi.restoreAllMocks();
});

describe("ErrorBoundary (Faza 56, 4.3)", () => {
  it("renders the children again on retry after an ordinary failure", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderWith(new Error("boom"));
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "retry" }));
    expect(screen.getByText("shown")).toBeTruthy();
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it("reloads the page on retry when a part of the code failed to load, which React cannot retry", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderWith(new ChunkLoadError(new TypeError("Failed to fetch dynamically imported module")));
    fireEvent.click(screen.getByRole("button", { name: "reload" }));
    expect(reloadPage).toHaveBeenCalledOnce();
  });
});

describe("loadChunk", () => {
  it("passes a loaded module through", async () => {
    await expect(loadChunk(() => Promise.resolve(42))).resolves.toBe(42);
  });

  it("marks a failed load, keeping the cause", async () => {
    const cause = new TypeError("Failed to fetch dynamically imported module");
    const failure = await loadChunk(() => Promise.reject(cause)).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ChunkLoadError);
    expect((failure as ChunkLoadError).cause).toBe(cause);
  });
});
