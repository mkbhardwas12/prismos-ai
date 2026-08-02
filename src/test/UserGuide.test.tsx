import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import UserGuide from "../components/UserGuide";

describe("UserGuide", () => {
  it("states the current product, release, performance, and learning boundaries", () => {
    render(<UserGuide open onClose={vi.fn()} />);

    expect(screen.getByText(/local-first desktop assistant with bounded sequential workflows/i)).toBeInTheDocument();
    expect(screen.getByText(/No platform release is described as security-qualified/i)).toBeInTheDocument();
    expect(screen.getByText(/gain depends on the model, quantization, backend/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Tips & Best Practices/i }));
    expect(screen.getByText(/does not retrain the model or guarantee better answers/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /About & Legal/i }));
    expect(screen.getByText(/0\.5\.2 source tree/i)).toBeInTheDocument();
    expect(screen.queryByText(/Version:\s*0\.5\.0/i)).not.toBeInTheDocument();
  });
});
