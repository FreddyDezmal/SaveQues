/**
 * tests/component/InstallSaveQuestCard.test.tsx
 *
 * Sprint 18 — Phase 4. Tests components/pwa/InstallSaveQuestCard.tsx.
 *
 * Mocks usePWAInstall directly rather than driving a raw
 * `beforeinstallprompt` browser event — that event's own wiring lives in
 * lib/hooks/usePWAInstall.ts and is a separate unit of behavior; this file
 * tests how the CARD reacts to what the hook reports, which is the
 * correct boundary for a component test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InstallSaveQuestCard from "@/components/pwa/InstallSaveQuestCard";

const mockPromptInstall = vi.fn();
let mockCanInstall = true;
let mockIsInstalled = false;

vi.mock("@/lib/hooks/usePWAInstall", () => ({
  usePWAInstall: () => ({
    canInstall: mockCanInstall,
    isInstalled: mockIsInstalled,
    justInstalled: false,
    promptInstall: mockPromptInstall,
  }),
}));

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
  AnalyticsEvents: {
    PWA_INSTALL_PROMPT_SHOWN: "pwa_install_prompt_shown",
    PWA_INSTALL_PROMPT_ACCEPTED: "pwa_install_prompt_accepted",
    PWA_INSTALL_PROMPT_DISMISSED: "pwa_install_prompt_dismissed",
  },
}));

describe("InstallSaveQuestCard", () => {
  beforeEach(() => {
    localStorage.clear();
    mockCanInstall = true;
    mockIsInstalled = false;
    mockPromptInstall.mockReset();
  });

  it("renders the install card when canInstall is true and not previously dismissed", () => {
    render(<InstallSaveQuestCard userId="user-1" />);
    expect(screen.getByText("Install SaveQuest")).toBeInTheDocument();
  });

  it("renders nothing when canInstall is false (Safari/Firefox — beforeinstallprompt never fired)", () => {
    mockCanInstall = false;
    render(<InstallSaveQuestCard userId="user-1" />);
    expect(screen.queryByText("Install SaveQuest")).not.toBeInTheDocument();
  });

  it("renders nothing when the app is already installed", () => {
    mockIsInstalled = true;
    render(<InstallSaveQuestCard userId="user-1" />);
    expect(screen.queryByText("Install SaveQuest")).not.toBeInTheDocument();
  });

  it("renders nothing for a user who previously dismissed it (localStorage check is per-userId)", () => {
    localStorage.setItem("sq_install_dismissed_user-1", "1");
    render(<InstallSaveQuestCard userId="user-1" />);
    expect(screen.queryByText("Install SaveQuest")).not.toBeInTheDocument();
  });

  it("still shows for a DIFFERENT user on the same device who hasn't dismissed it (dismissal is keyed per-userId, not global)", () => {
    localStorage.setItem("sq_install_dismissed_user-1", "1");
    render(<InstallSaveQuestCard userId="user-2" />);
    expect(screen.getByText("Install SaveQuest")).toBeInTheDocument();
  });

  it("calls promptInstall when the Install button is clicked", async () => {
    mockPromptInstall.mockResolvedValue("accepted");
    const user = userEvent.setup();
    render(<InstallSaveQuestCard userId="user-1" />);
    await user.click(screen.getByRole("button", { name: "Install" }));
    expect(mockPromptInstall).toHaveBeenCalledOnce();
  });

  it("persists dismissal and hides the card when 'Not now' is clicked", async () => {
    const user = userEvent.setup();
    render(<InstallSaveQuestCard userId="user-1" />);
    await user.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByText("Install SaveQuest")).not.toBeInTheDocument();
    expect(localStorage.getItem("sq_install_dismissed_user-1")).toBe("1");
  });

  it("persists dismissal when the outcome of promptInstall is 'dismissed' (native dialog cancelled)", async () => {
    mockPromptInstall.mockResolvedValue("dismissed");
    const user = userEvent.setup();
    render(<InstallSaveQuestCard userId="user-1" />);
    await user.click(screen.getByRole("button", { name: "Install" }));

    // promptInstall() is awaited inside the component's click handler, so
    // the dismissal (and the card's removal) happens asynchronously after
    // the click — waitFor is required here, not an immediate assertion.
    await waitFor(() => {
      expect(screen.queryByText("Install SaveQuest")).not.toBeInTheDocument();
    });
    expect(localStorage.getItem("sq_install_dismissed_user-1")).toBe("1");
  });
});
