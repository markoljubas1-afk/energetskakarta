import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n";
import type { MapApi } from "../map/MapView";
import { renderWithI18n } from "../test/render";
import { embedCode, ShareMenu } from "./ShareMenu";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ShareMenu", () => {
  it("copies the current link and says so", async () => {
    const user = userEvent.setup();
    const write = vi.fn().mockResolvedValue(undefined);
    renderWithI18n(<ShareMenu map={null} writeClipboard={write} />);
    await user.click(screen.getByText("Podijeli"));
    await user.click(screen.getByRole("button", { name: "Kopiraj poveznicu" }));
    expect(write).toHaveBeenCalledWith(window.location.href);
    expect(await screen.findByRole("status")).toHaveTextContent("Poveznica je kopirana.");
  });

  it("opens the device's share sheet with this view where there is one, and hides the button where not", async () => {
    const user = userEvent.setup();
    const share = vi.fn().mockRejectedValue(new DOMException("closed", "AbortError"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { unmount } = renderWithI18n(<ShareMenu map={null} nativeShare={share} />);
    await user.click(screen.getByText("Podijeli"));
    await user.click(screen.getByRole("button", { name: /^Pošalji/ }));
    expect(share).toHaveBeenCalledWith({ title: "GridAtlas", url: window.location.href });
    // closing the sheet is not an error
    expect(errors).not.toHaveBeenCalled();
    unmount();

    renderWithI18n(<ShareMenu map={null} nativeShare={null} />);
    await user.click(screen.getByText("Podijeli"));
    expect(screen.queryByRole("button", { name: /^Pošalji/ })).not.toBeInTheDocument();
  });

  it("shows the link in a field when the clipboard is not available", async () => {
    const user = userEvent.setup();
    renderWithI18n(<ShareMenu map={null} writeClipboard={() => Promise.reject(new Error("denied"))} />);
    await user.click(screen.getByText("Podijeli"));
    await user.click(screen.getByRole("button", { name: "Kopiraj poveznicu" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Kopiranje nije uspjelo");
    expect(screen.getByRole("textbox", { name: "Kopiraj poveznicu" })).toHaveValue(window.location.href);
  });

  it("saves the map's picture under a dated name, and waits for the map before offering it", async () => {
    const user = userEvent.setup();
    const blob = new Blob(["png"], { type: "image/png" });
    const map: MapApi = {
      flyTo: vi.fn(),
      travelTo: vi.fn(),
      level: vi.fn(),
      showTraveller: vi.fn(),
      snapshot: vi.fn().mockResolvedValue(blob),
    };
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn().mockReturnValue("blob:test"),
      revokeObjectURL: vi.fn(),
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    const { rerender } = renderWithI18n(<ShareMenu map={null} now={() => new Date(2026, 8, 19, 9, 30)} />);
    await user.click(screen.getByText("Podijeli"));
    expect(screen.getByRole("button", { name: "Preuzmi sliku (PNG)" })).toBeDisabled();

    rerender(
      <I18nProvider lang="hr">
        <ShareMenu map={map} now={() => new Date(2026, 8, 19, 9, 30)} />
      </I18nProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Preuzmi sliku (PNG)" }));
    expect(map.snapshot).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(click).toHaveBeenCalledOnce();
    });
    const anchor = click.mock.instances[0];
    expect(anchor).toBeInstanceOf(HTMLAnchorElement);
    if (!(anchor instanceof HTMLAnchorElement)) throw new Error("unreachable");
    expect(anchor.download).toBe("energetska-karta-2026-09-19-0930.png");
    expect(anchor.href).toBe("blob:test");
  });

  it("reports a picture that could not be made", async () => {
    const user = userEvent.setup();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const map: MapApi = {
      flyTo: vi.fn(),
      travelTo: vi.fn(),
      level: vi.fn(),
      showTraveller: vi.fn(),
      snapshot: vi.fn().mockRejectedValue(new Error("no canvas")),
    };
    renderWithI18n(<ShareMenu map={map} />);
    await user.click(screen.getByText("Podijeli"));
    await user.click(screen.getByRole("button", { name: "Preuzmi sliku (PNG)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Slika se nije mogla izraditi.");
  });
});

describe("embed code", () => {
  it("is this view in embed mode, escaped for HTML, and copies on request", async () => {
    const user = userEvent.setup();
    const write = vi.fn().mockResolvedValue(undefined);
    window.history.replaceState(null, "", "/?v=45.8,16.5,12&l=plants");
    renderWithI18n(<ShareMenu map={null} writeClipboard={write} />);
    await user.click(screen.getByText("Podijeli"));
    await user.click(screen.getByRole("button", { name: "Ugradi na svoju stranicu" }));
    const code = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Ugradi na svoju stranicu" });
    expect(code.value).toContain("embed=1");
    expect(code.value).toContain("&amp;l=plants");
    expect(code.value).toContain('title="GridAtlas"');
    await user.click(screen.getByRole("button", { name: "Kopiraj kod" }));
    expect(write).toHaveBeenCalledWith(expect.stringContaining("<iframe"));
    expect(await screen.findByRole("button", { name: "Kod je kopiran." })).toBeInTheDocument();
  });

  it("builds the iframe from any page URL", () => {
    expect(embedCode("https://karta.example/?v=1,2,3", 'A "quoted" & title')).toBe(
      '<iframe src="https://karta.example/?v=1%2C2%2C3&amp;embed=1" title="A &quot;quoted&quot; &amp; title" width="100%" height="520" style="border:0;border-radius:12px" loading="lazy" allow="fullscreen"></iframe>',
    );
  });
});
