import { useState } from "react";
import type { FormEvent } from "react";

import { normalizeKeyword } from "../types/roadmap";

/**
 * Spec section 7: the home empty state is a centered tool-style search
 * input (no marketing hero) plus hardcoded sample chips that do not
 * trigger any request — they only fill and submit the form.
 */
export const SAMPLE_KEYWORDS = ["前端开发", "RAG", "吉他", "健身"];

export interface SearchHomeProps {
  /**
   * Called with the normalized keyword (lowercased, trimmed, whitespace
   * collapsed) after a submit. Empty / whitespace-only input is
   * intercepted on the client and never calls this.
   */
  onSearch: (keyword: string) => void;
}

export function SearchHome({ onSearch }: SearchHomeProps) {
  const [value, setValue] = useState("");

  // Keyword interception point (spec 拦截点): blank input is dropped
  // before any request could happen.
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const keyword = normalizeKeyword(value);
    if (keyword) onSearch(keyword);
  };

  const handleChip = (keyword: string) => {
    // Equivalent to typing the keyword and submitting.
    setValue(keyword);
    onSearch(normalizeKeyword(keyword));
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        gap: 16,
        padding: "0 16px",
      }}
    >
      <form onSubmit={handleSubmit} style={{ width: "100%", maxWidth: 560 }}>
        <input
          data-testid="search-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="输入关键词，生成学习路线图"
          aria-label="关键词搜索"
          style={{
            width: "100%",
            padding: "12px 16px",
            fontSize: 18,
            border: "1px solid #d0d5dd",
            borderRadius: 8,
            outline: "none",
          }}
        />
      </form>

      <p style={{ color: "#5c6570", fontSize: 14 }}>
        输入任意关键词（如课程、技能、乐器、运动），为你规划一份分阶段学习路线
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
        {SAMPLE_KEYWORDS.map((kw) => (
          <button
            key={kw}
            type="button"
            onClick={() => handleChip(kw)}
            style={{
              padding: "6px 14px",
              fontSize: 14,
              border: "1px solid #d0d5dd",
              borderRadius: 999,
              background: "#fff",
              cursor: "pointer",
            }}
          >
            {kw}
          </button>
        ))}
      </div>
    </div>
  );
}
