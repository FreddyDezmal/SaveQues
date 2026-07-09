/**
 * tests/component/Toggle.test.tsx
 *
 * Sprint 18 — Phase 4. Tests components/ui/Toggle.tsx.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Toggle from "@/components/ui/Toggle";

describe("Toggle", () => {
  it("renders with role='switch' and reflects checked state via aria-checked", () => {
    render(<Toggle checked={true} onChange={() => {}} label="Test toggle" />);
    const el = screen.getByRole("switch");
    expect(el).toHaveAttribute("aria-checked", "true");
  });

  it("uses the visible label as the accessible name when no srLabel is given", () => {
    render(<Toggle checked={false} onChange={() => {}} label="Daily streak reminders" />);
    expect(screen.getByRole("switch", { name: "Daily streak reminders" })).toBeInTheDocument();
  });

  it("prefers srLabel over label for the accessible name when both are given", () => {
    render(<Toggle checked={false} onChange={() => {}} label="Visible text" srLabel="More descriptive screen-reader text" />);
    expect(screen.getByRole("switch", { name: "More descriptive screen-reader text" })).toBeInTheDocument();
  });

  it("calls onChange with the OPPOSITE of the current checked value when clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Test" />);
    await user.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("is keyboard-activatable (Enter/Space), not just mouse-clickable — it's a real <button>", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Test" />);
    await user.tab(); // focus the toggle
    expect(screen.getByRole("switch")).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("does not call onChange when disabled, even on click", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} disabled label="Test" />);
    await user.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
