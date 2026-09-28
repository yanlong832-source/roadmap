import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SearchHome } from "../SearchHome";
import { normalizeKeyword } from "../../types/roadmap";

describe("SearchHome", () => {
  const sampleKeywords = ["前端开发", "RAG", "吉他", "健身"];

  it("triggers onSearch with the normalized keyword on submit", () => {
    const onSearch = vi.fn();
    render(<SearchHome onSearch={onSearch} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "  Rag  System " } });
    fireEvent.submit(input.closest("form"));

    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledWith("rag system");
  });

  it("does not trigger onSearch when submitting an empty or whitespace-only value", () => {
    const onSearch = vi.fn();
    render(<SearchHome onSearch={onSearch} />);

    const form = screen.getByRole("textbox").closest("form");
    const input = screen.getByRole("textbox");

    // empty submit
    fireEvent.submit(form);
    expect(onSearch).not.toHaveBeenCalled();

    // whitespace-only submit
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(form);
    expect(onSearch).not.toHaveBeenCalled();
  });

  it.each(sampleKeywords)(
    'chip "%s" click submits that keyword (equivalent to typing + Enter)',
    (kw) => {
      const onSearch = vi.fn();
      render(<SearchHome onSearch={onSearch} />);

      fireEvent.click(screen.getByRole("button", { name: kw }));

      expect(onSearch).toHaveBeenCalledTimes(1);
      expect(onSearch).toHaveBeenCalledWith(normalizeKeyword(kw));
    },
  );

  it("renders all four hardcoded sample chips", () => {
    render(<SearchHome onSearch={vi.fn()} />);

    sampleKeywords.forEach((kw) => {
      expect(screen.getByRole("button", { name: kw })).toBeInTheDocument();
    });
  });
});
