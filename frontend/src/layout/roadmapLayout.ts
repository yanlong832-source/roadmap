/**
 * Pure layout engine for the interactive roadmap (plan Task 2).
 *
 * Every function here is a deterministic pure function so it can be
 * unit-tested without React Flow; RoadmapFlow consumes its output.
 */

/* ------------------------------------------------------------------ */
/* learning status                                                     */
/* ------------------------------------------------------------------ */

export type LearningStatus = "not_started" | "in_progress" | "done";

/** UI label per status (Chinese, per spec). */
export const STATUS_LABELS: Record<LearningStatus, string> = {
  not_started: "未开始",
  in_progress: "学习中",
  done: "已完成",
};

/** Status cycle: pill clicks walk this loop. */
export const NEXT_STATUS: Record<LearningStatus, LearningStatus> = {
  not_started: "in_progress",
  in_progress: "done",
  done: "not_started",
};

/* ------------------------------------------------------------------ */
/* fingerprint (dependency-free sha1, matches backend hashlib.sha1)     */
/* ------------------------------------------------------------------ */

// Modular arithmetic helpers on 32-bit unsigned ints. Node's >>>
// operator already coerces to uint32 for shifts, so >>> is the
// unsigned-shift we need without extra masking.
const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));

/**
 * sha1 over a UTF-8 string, first 12 hex chars of the full 160-bit
 * digest. No dependencies (plan constraint); output is the topic
 * stability key shared with the backend's hashlib.sha1 prefix.
 */
export function sha1Hex(input: string): string {
  // Encode as UTF-8 bytes.
  const bytes = new TextEncoder().encode(input);

  // Length in bits, for the final 64-bit length block.
  const bitLength = bytes.length * 8;

  // Pad: 0x80, then zeros, then 64-bit big-endian length. Pad to 64.
  const withPad = ((bytes.length + 1 + 8 + 63) & ~63) || 64;
  const padded = new Uint8Array(withPad);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  // 64-bit big-endian length: high word first (bytes.length < 2^53;
  // the high 32 bits are zero for any input under 512 MiB).
  const lo = bitLength >>> 0;
  const hi = Math.floor(bitLength / 0x100000000);
  padded[padded.length - 4] = (lo >>> 24) & 0xff;
  padded[padded.length - 3] = (lo >>> 16) & 0xff;
  padded[padded.length - 2] = (lo >>> 8) & 0xff;
  padded[padded.length - 1] = lo & 0xff;
  for (let i = 0; i < 4; i += 1) {
    padded[padded.length - 8 + i] = (hi >>> (8 * (3 - i))) & 0xff;
  }

  // Initial hash state (first 32 bits of the fractional parts of
  // sqrt(5), sqrt(15), sqrt(21), sqrt(28), sqrt(3)).
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  for (let block = 0; block < padded.length; block += 64) {
    // Message words: 16 big-endian 32-bit values from the block.
    const m: number[] = new Array(80);
    for (let t = 0; t < 16; t += 1) {
      m[t] =
        (padded[block + t * 4] << 24) |
        (padded[block + t * 4 + 1] << 16) |
        (padded[block + t * 4 + 2] << 8) |
        padded[block + t * 4 + 3];
    }
    for (let t = 16; t < 80; t += 1) {
      m[t] = rotl(m[t - 3] ^ m[t - 8] ^ m[t - 14] ^ m[t - 16], 1);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let t = 0; t < 80; t += 1) {
      // The four per-round functions (f..g are F1..F4 in the standard
      // notation; k the round constant; j the hash value to shift).
      let f: number;
      let k: number;
      if (t < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (t < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (t < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp =
        (rotl(a, 5) + f + e + k + m[t]) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  const toHex = (n: number) =>
    (n >>> 0).toString(16).padStart(8, "0");
  return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4);
}

/** First 12 hex chars of sha1 of the pipe-joined identity string. */
/** First 12 hex chars of sha1 of the pipe-joined identity string. */
export function computeFingerprint(
  normKeyword: string,
  phaseName: string,
  topicTitle: string,
): string {
  return sha1Hex(`${normKeyword}|${phaseName}|${topicTitle}`).slice(0, 12);
}

/* ------------------------------------------------------------------ */
/* two-column, dynamic-row layout                                      */
/* ------------------------------------------------------------------ */

export const PHASE_CARD_HEIGHT = 96;
export const TOPIC_NODE_HEIGHT = 116;
export const PHASE_GAP = 130;
export const TOPIC_GAP = 56;
export const BASE_ROW_HEIGHT = 250;

/** Vertical advance between consecutive phase blocks, per-row. */
export function rowHeightFor(maxSideCount: number, collapsed: boolean): number {
  if (collapsed) {
    return Math.max(BASE_ROW_HEIGHT, PHASE_CARD_HEIGHT + PHASE_GAP);
  }
  return Math.max(
    BASE_ROW_HEIGHT,
    maxSideCount * (TOPIC_NODE_HEIGHT + TOPIC_GAP) + PHASE_GAP,
  );
}

export interface LayoutPhaseInput {
  phaseId: string;
  phaseName: string;
  topics: Array<{ id: string; title: string }>;
  blockY: number;
}

export interface LayoutPhaseOutput {
  topicId: string;
  x: number;
  y: number;
  side: "left" | "right";
}

/**
 * Even topic index goes left, odd goes right; each column stacks
 * vertically, centered against the block's midline. X offsets use
 * the block's own coordinates so the two columns stay symmetrical.
 */
export function layoutPhase(input: LayoutPhaseInput): LayoutPhaseOutput[] {
  const { topics, blockY } = input;
  const left: number[] = [];
  const right: number[] = [];
  topics.forEach((topic, i) => {
    const row = Math.floor(i / 2);
    if (i % 2 === 0) left.push(row);
    else right.push(row);
  });
  const leftCount = left.length;
  const rightCount = right.length;
  const maxSide = Math.max(leftCount, rightCount);
  // Center each column stack against the block card's midline.
  const leftStackHeight =
    leftCount * TOPIC_NODE_HEIGHT + Math.max(leftCount - 1, 0) * TOPIC_GAP;
  const rightStackHeight =
    rightCount * TOPIC_NODE_HEIGHT + Math.max(rightCount - 1, 0) * TOPIC_GAP;
  const leftStartY = blockY + PHASE_CARD_HEIGHT / 2 - leftStackHeight / 2;
  const rightStartY =
    blockY + PHASE_CARD_HEIGHT / 2 - rightStackHeight / 2;

  const out: LayoutPhaseOutput[] = [];
  topics.forEach((topic, i) => {
    const row = Math.floor(i / 2);
    const side: "left" | "right" = i % 2 === 0 ? "left" : "right";
    const y =
      side === "left"
        ? leftStartY + row * (TOPIC_NODE_HEIGHT + TOPIC_GAP)
        : rightStartY + row * (TOPIC_NODE_HEIGHT + TOPIC_GAP);
    out.push({
      topicId: topic.id,
      x: side === "left" ? 0 : 140, // 140px offset, block-relative.
      y,
      side,
    });
  });
  // maxSide is reserved for callers doing overlap checks (plan Task 2
  // "no-overlap" test).
  void maxSide;
  return out;
}

/* ------------------------------------------------------------------ */
/* block chain edges                                                   */
/* ------------------------------------------------------------------ */

export interface ChainEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
  type: "straight";
  style: { stroke: string; strokeWidth: number };
  markerEnd: string;
}

/**
 * Solid center-to-center link between consecutive phase blocks. Uses
 * named handles so React Flow anchors at the card midline rather than
 * the default left/right handle positions.
 */
export function buildChainEdge(
  prevBlockId: string,
  nextBlockId: string,
): ChainEdge {
  return {
    id: `${prevBlockId}->${nextBlockId}`,
    source: prevBlockId,
    target: nextBlockId,
    sourceHandle: "bottom-center",
    targetHandle: "top-center",
    type: "straight",
    style: { stroke: "#4f46e5", strokeWidth: 2 },
    markerEnd: "arrowclosed",
  };
}
