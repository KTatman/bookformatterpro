import OpenAI from "openai";
import mammoth from "mammoth";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface Correction {
  original_text: string;
  suggested_text: string;
  reason: string;
  type: "grammar" | "run-on" | "clarity";
  context_before: string;
  context_after: string;
}

const CP1252: Record<number, number> = {
  0x80:0x20AC,0x82:0x201A,0x83:0x0192,0x84:0x201E,0x85:0x2026,0x86:0x2020,0x87:0x2021,
  0x88:0x02C6,0x89:0x2030,0x8A:0x0160,0x8B:0x2039,0x8C:0x0152,0x8E:0x017D,
  0x91:0x2018,0x92:0x2019,0x93:0x201C,0x94:0x201D,0x95:0x2022,0x96:0x2013,0x97:0x2014,
  0x98:0x02DC,0x99:0x2122,0x9A:0x0161,0x9B:0x203A,0x9C:0x0153,0x9E:0x017E,0x9F:0x0178,
};

function removeNestedGroup(src: string, startIdx: number): number {
  let depth = 1;
  let i = startIdx;
  while (i < src.length && depth > 0) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
    i++;
  }
  return i;
}

export function stripRtf(raw: string): string {
  let text = raw;

  const skipGroupRe = /\{\\(pict|pntxt[ab]?|fonttbl|colortbl|stylesheet|info|xmlnstbl|listtable|listoverridetable|latentstyles|datastore|themedata|colorschememapping|defchp|defpap)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = skipGroupRe.exec(text)) !== null) {
    const end = removeNestedGroup(text, m.index + 1);
    text = text.slice(0, m.index) + text.slice(end);
    skipGroupRe.lastIndex = m.index;
  }

  text = text.replace(/\{\\\*\\[a-z]+[^}]*\}/gi, "");

  text = text.replace(/\\u([0-9]{1,5})\s?\??/g, (_m, code) =>
    String.fromCharCode(parseInt(code, 10))
  );
  text = text.replace(/\\u(-[0-9]{1,5})\s?\??/g, (_m, code) =>
    String.fromCharCode(65536 + parseInt(code, 10))
  );

  text = text.replace(/\\'([0-9a-fA-F]{2})/g, (_m, hex) => {
    const byte = parseInt(hex, 16);
    const mapped = CP1252[byte];
    return String.fromCharCode(mapped !== undefined ? mapped : byte);
  });

  const specialMap: Record<string, string> = {
    "\\par": "\n",
    "\\line": "\n",
    "\\tab": "\t",
    "\\page": "\n\n",
    "\\sect": "\n\n",
    "\\~": "\u00A0",
    "\\_": "\u2011",
    "\\lquote": "\u2018",
    "\\rquote": "\u2019",
    "\\ldblquote": "\u201C",
    "\\rdblquote": "\u201D",
    "\\bullet": "\u2022",
    "\\endash": "\u2013",
    "\\emdash": "\u2014",
  };
  for (const [esc, repl] of Object.entries(specialMap)) {
    const re = new RegExp(esc.replace(/\\/g, "\\\\") + "(?:\\s|(?=[\\\\{}])|$)", "g");
    text = text.replace(re, repl);
  }

  text = text.replace(/\\[a-z]{1,32}(-?\d{1,10})?(?:\s|(?=[\\{}])|$)/gi, "");

  text = text.replace(/[{}]/g, "");

  text = text.replace(/\r\n/g, "\n");
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.trim();

  return text;
}

export async function extractTextFromBuffer(
  buffer: Buffer,
  filename: string
): Promise<string> {
  const ext = filename.split(".").pop()?.toLowerCase();

  if (ext === "docx" || ext === "doc") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } else if (ext === "rtf") {
    const raw = buffer.toString("utf-8");
    if (raw.trimStart().startsWith("{\\rtf")) {
      return stripRtf(raw);
    }
    return raw;
  } else if (ext === "txt") {
    return buffer.toString("utf-8");
  } else {
    throw new Error(`Unsupported file format: .${ext}`);
  }
}

export async function runAutoFixPass(
  text: string,
  onProgress?: (pct: number) => void
): Promise<string> {
  if (!text || text.trim().length < 10) return text;

  const chunkSize = 3000;
  const chunks = splitIntoChunks(text, chunkSize);
  const fixedChunks: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a manuscript copy-editor. Fix ONLY these four things — nothing else:
1. Capitalization: sentence starts, proper nouns
2. Punctuation: missing end punctuation, mismatched quotes, incorrect apostrophes
3. Spelling: clear misspellings (not homophones or intentional dialect)
4. Spacing: double spaces, trailing whitespace, stray tabs

Do NOT fix grammar, rewrite sentences, change word choice, alter sentence structure, or touch anything stylistic.
Return ONLY the corrected text with no commentary.`,
          },
          { role: "user", content: chunk },
        ],
        temperature: 0.1,
      });

      fixedChunks.push(response.choices[0].message.content || chunk);
    } catch (err) {
      console.error("[AutoFix] Chunk failed, keeping original:", err);
      fixedChunks.push(chunk);
    }

    // Report pass 1 progress: 5% → 50%
    if (onProgress) {
      const pct = Math.round(5 + ((i + 1) / chunks.length) * 45);
      onProgress(pct);
    }
  }

  return fixedChunks.join("\n");
}

export async function runSuggestionPass(
  text: string,
  onProgress?: (pct: number) => void
): Promise<Correction[]> {
  if (!text || text.trim().length < 30) return [];

  const chunkSize = 4000;
  const chunks = splitIntoChunks(text, chunkSize);
  const allCorrections: Correction[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are a professional manuscript editor performing a grammar and structural review.

Your job: identify every sentence that has one of the following problems and flag it for the author to review.

## WHAT TO FLAG (be thorough — flag every clear instance):

**grammar** — Subject-verb disagreement, wrong verb tense for context, wrong pronoun case, dangling modifier, unclear pronoun reference (ambiguous "it", "they", "this"), missing article (a/an/the), double negatives.
  Examples: "she don't know" → "she doesn't know"; "him and me went" → "he and I went"; "The team are winning" (if US English) → "The team is winning"

**run-on** — Two or more independent clauses joined only by a comma, or fused with no punctuation at all. A clause is independent if it has its own subject and verb and could stand alone.
  Examples: "I went to the store, I bought milk" → "I went to the store. I bought milk." or "I went to the store and bought milk."
  Note: "and/but/so/yet/or/nor/for" between two independent clauses is acceptable — only flag comma splices and fused sentences.

**clarity** — A sentence that a reader must re-read because the structure is confusing, the referent is ambiguous, or the phrasing obscures the meaning. Only flag when genuinely confusing, not just complex.

## WHAT NOT TO FLAG:
- Intentional sentence fragments for stylistic effect ("Gone. Just like that.")
- Comma splices used deliberately for pace in literary fiction
- Dialect, slang, informal register if consistent and intentional
- Capitalization, spelling, punctuation spacing (those are fixed automatically)
- Long sentences that are grammatically correct
- Stylistic repetition

## OUTPUT FORMAT:
Respond with ONLY a valid JSON object. Do not include any text before or after the JSON.

{
  "corrections": [
    {
      "original_text": "the exact sentence or clause with the problem (max 200 chars)",
      "suggested_text": "minimally corrected version that fixes only the flagged issue",
      "reason": "one sentence explaining exactly what is wrong",
      "type": "grammar",
      "context_before": "the sentence immediately before (empty string if none)",
      "context_after": "the sentence immediately after (empty string if none)"
    }
  ]
}

The "type" field MUST be one of: "grammar", "run-on", "clarity".
If you find zero issues in this chunk, return: {"corrections": []}
Be thorough. Err on the side of flagging rather than skipping.`,
          },
          {
            role: "user",
            content: `Review this manuscript excerpt for grammar, run-on sentences, and clarity issues:\n\n${chunk}`,
          },
        ],
        temperature: 0.0,
        response_format: { type: "json_object" },
      });

      const raw = response.choices[0].message.content || '{"corrections":[]}';

      try {
        const parsed = JSON.parse(raw);
        const corrections: Correction[] = extractCorrectionsArray(parsed);
        const valid = validateCorrections(corrections);
        allCorrections.push(...valid);
        if (valid.length > 0) {
          console.log(`[Suggestions] Chunk found ${valid.length} issue(s)`);
        }
      } catch (parseErr) {
        console.error("[Suggestions] JSON parse failed:", parseErr);
        console.error("[Suggestions] Raw (first 300 chars):", raw.substring(0, 300));
      }
    } catch (err: any) {
      console.error("[Suggestions] OpenAI call failed for chunk:", err.message);
    }

    // Report pass 2 progress: 50% → 90%
    if (onProgress) {
      const pct = Math.round(50 + ((i + 1) / chunks.length) * 40);
      onProgress(pct);
    }
  }

  // Cap at 30 suggestions to keep the review page manageable
  return allCorrections.slice(0, 30);
}

// ─── helpers ────────────────────────────────────────────────────

function extractCorrectionsArray(parsed: unknown): Correction[] {
  if (Array.isArray(parsed)) return parsed as Correction[];
  if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    for (const key of ["corrections", "suggestions", "items", "issues", "results"]) {
      if (Array.isArray(obj[key])) return obj[key] as Correction[];
    }
  }
  return [];
}

function validateCorrections(arr: Correction[]): Correction[] {
  const validTypes = new Set(["grammar", "run-on", "clarity"]);
  return arr.filter((c) => {
    if (typeof c !== "object" || c === null) return false;
    if (typeof c.original_text !== "string" || c.original_text.trim() === "") return false;
    if (typeof c.suggested_text !== "string" || c.suggested_text.trim() === "") return false;
    if (!validTypes.has(c.type)) return false;
    if (c.original_text.trim() === c.suggested_text.trim()) return false;
    return true;
  });
}

function splitIntoChunks(text: string, chunkSize: number): string[] {
  const paragraphs = text.split(/\n+/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if ((current + para).length > chunkSize && current.length > 0) {
      chunks.push(current.trim());
      current = para + "\n";
    } else {
      current += para + "\n";
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text];
}
