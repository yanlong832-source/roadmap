/**
 * Cross-language sha1 vectors pinning the backend<->frontend fingerprint
 * contract (plan Task 4). Each expected value was generated once via
 * node:crypto `sha1(input).digest("hex").slice(0, 12)` for the exact
 * ASCII-safe inputs below; they are hardcoded here so both languages
 * are tested against the same ground truth.
 */
export interface FingerprintVector {
  input: string;
  expected: string;
}

export const FINGERPRINT_VECTORS: FingerprintVector[] = [
  { input: "rag|基础|向量数据库入门", expected: "fccf4d91a6cd" },
  { input: "git|进阶|rebase 与合并", expected: "596405d2b10d" },
  { input: "rag|阶段1|大模型推理基础", expected: "904967a6a0b7" },
  { input: "健身|初级|深蹲动作要领", expected: "ed4ca58b0bb2" },
];
