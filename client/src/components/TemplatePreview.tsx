import { Type, AlignLeft, BookOpen, FileDown } from "lucide-react";

export type TemplateDef = {
  id: string;
  name: string;
  genre: string;
  desc: string;
  trimDefault: string;
  targetDefault: string;
  font: string;
  fontLabel: string;
  headingFont: string;
  headingFontLabel: string;
  sampleTitle: string;
  sampleSubtitle: string;
  sampleAuthor: string;
  sampleHeading: string;
  sampleLines: string[];
  features: string[];
  formats: ("PDF" | "DOCX" | "EPUB")[];
  spacingLabel: string;
  hierarchyLabel: string;
  hasDropCap?: boolean;
  hasOrnament?: boolean;
  uppercaseChapter?: boolean;
  chapterAlign?: "center" | "left";
  bodyAlign?: "justify" | "left";
  lineHeight?: number;
  showToc?: boolean;
  tocEntries?: { title: string; page: number }[];
  runningHeader?: string;
};

export const TEMPLATES: TemplateDef[] = [
  {
    id: "modern-novel",
    name: "Modern Novel",
    genre: "Literary & Contemporary Fiction",
    desc: "Clean, elegant serif typography for contemporary fiction.",
    trimDefault: '6" × 9"',
    targetDefault: "Amazon KDP Print",
    font: "Georgia, serif",
    fontLabel: "Georgia 11pt",
    headingFont: "Georgia, serif",
    headingFontLabel: "Georgia 18pt",
    sampleTitle: "The Quiet Hour",
    sampleSubtitle: "A NOVEL",
    sampleAuthor: "Elena Marsh",
    sampleHeading: "Chapter One",
    sampleLines: [
      "The morning light filtered through the curtains, casting long shadows across the hardwood floor.",
      "She reached for the letter on the nightstand, her fingers trembling slightly as she broke the seal.",
      "It had been three years since she'd heard from him — three years of silence that felt like a lifetime.",
    ],
    features: ["Serif body text", "Centered chapter titles", '0.25" indent', "Justified text"],
    formats: ["PDF", "DOCX", "EPUB"],
    spacingLabel: "1.5× leading",
    hierarchyLabel: "H1 centered • H2 italic",
    chapterAlign: "center",
    bodyAlign: "justify",
    lineHeight: 1.5,
    runningHeader: "The Quiet Hour",
  },
  {
    id: "memoir",
    name: "Memoir / Bio",
    genre: "Memoir, Biography & Personal Essay",
    desc: "Warm, readable styling with generous line spacing.",
    trimDefault: '5.5" × 8.5"',
    targetDefault: "IngramSpark",
    font: "Georgia, serif",
    fontLabel: "Georgia 11.5pt",
    headingFont: "Arial, sans-serif",
    headingFontLabel: "Arial 16pt",
    sampleTitle: "Flour and Sundays",
    sampleSubtitle: "A MEMOIR",
    sampleAuthor: "Margaret Ellis",
    sampleHeading: "Prologue",
    sampleLines: [
      "I remember the smell of fresh bread drifting through the kitchen every Sunday morning.",
      "My grandmother would stand at the counter, flour dusting her apron, humming a melody I've never been able to place.",
      "Those mornings shaped everything I became — though I didn't know it at the time.",
    ],
    features: ["Serif body", "Extra leading", "Wide margins", "Sans-serif headers"],
    formats: ["PDF", "DOCX", "EPUB"],
    spacingLabel: "1.75× leading",
    hierarchyLabel: "H1 centered • H2 small caps",
    chapterAlign: "center",
    bodyAlign: "justify",
    lineHeight: 1.75,
    runningHeader: "Flour and Sundays",
  },
  {
    id: "fantasy",
    name: "Fantasy Epic",
    genre: "Fantasy, Sci-Fi & Epic Fiction",
    desc: "Ornate chapter headers with drop caps and classic margins.",
    trimDefault: '6" × 9"',
    targetDefault: "Amazon KDP Print",
    font: "Georgia, serif",
    fontLabel: "Georgia 11pt",
    headingFont: '"Times New Roman", serif',
    headingFontLabel: 'Times 20pt small caps',
    sampleTitle: "The Obsidian Crown",
    sampleSubtitle: "BOOK ONE OF THE ASHEN CYCLE",
    sampleAuthor: "R. J. Valen",
    sampleHeading: "CHAPTER I",
    sampleLines: [
      "The ancient tower rose above the mist-shrouded forest, its stone walls scarred by centuries of wind and war.",
      "Beneath the archway, a figure cloaked in shadow whispered words of binding — syllables older than the kingdom itself.",
      "The seal cracked. Light poured from the fracture, illuminating runes that had not glowed in a thousand years.",
    ],
    features: ["Drop caps", "Ornament dividers", "Uppercase chapter titles", "Running headers"],
    formats: ["PDF", "DOCX", "EPUB"],
    spacingLabel: "1.5× leading",
    hierarchyLabel: "H1 uppercase • ornament • drop cap",
    hasDropCap: true,
    hasOrnament: true,
    uppercaseChapter: true,
    chapterAlign: "center",
    bodyAlign: "justify",
    lineHeight: 1.5,
    runningHeader: "The Obsidian Crown",
  },
  {
    id: "non-fiction",
    name: "Business / Non-Fiction",
    genre: "Non-Fiction, Business & How-To",
    desc: "Crisp sans-serif headers, structured hierarchy, with TOC.",
    trimDefault: '6" × 9"',
    targetDefault: "Generic PDF",
    font: "Arial, sans-serif",
    fontLabel: "Arial 10.5pt",
    headingFont: "Arial, sans-serif",
    headingFontLabel: "Arial 16pt bold",
    sampleTitle: "Distributed Leadership",
    sampleSubtitle: "FRAMEWORKS FOR MODERN TEAMS",
    sampleAuthor: "Dr. Sam Choi",
    sampleHeading: "Introduction",
    sampleLines: [
      "The landscape of modern business has shifted dramatically in the past decade.",
      "Organizations that once relied on hierarchical decision-making now embrace distributed models of leadership.",
      "This chapter examines three frameworks for navigating this transition effectively.",
    ],
    features: ["Sans-serif throughout", "Left-aligned headings", "Table of Contents", "Structured layout"],
    formats: ["PDF", "DOCX", "EPUB"],
    spacingLabel: "1.45× leading",
    hierarchyLabel: "H1 left bold • H2 left semibold",
    chapterAlign: "left",
    bodyAlign: "left",
    lineHeight: 1.45,
    showToc: true,
    tocEntries: [
      { title: "Introduction", page: 1 },
      { title: "1. The Shift", page: 11 },
      { title: "2. Trust & Autonomy", page: 27 },
      { title: "3. Frameworks", page: 48 },
      { title: "Conclusion", page: 72 },
    ],
    runningHeader: "Distributed Leadership",
  },
];

export type MiniPageType = "title" | "toc" | "chapter" | "body";

export const PAGE_LABELS: Record<MiniPageType, string> = {
  title: "Title page",
  toc: "Table of Contents",
  chapter: "Chapter opening",
  body: "Body page",
};

export function getPreviewPages(t: TemplateDef): MiniPageType[] {
  return t.showToc ? ["title", "toc", "chapter", "body"] : ["title", "chapter", "body"];
}

type Size = "sm" | "md" | "lg";
const SIZES: Record<Size, { w: number; h: number; scale: number }> = {
  sm: { w: 70, h: 96, scale: 1 },
  md: { w: 96, h: 132, scale: 1.4 },
  lg: { w: 132, h: 180, scale: 1.9 },
};

export function MiniPage({
  t,
  type,
  size = "sm",
}: {
  t: TemplateDef;
  type: MiniPageType;
  size?: Size;
}) {
  const dims = SIZES[size];
  const s = dims.scale;
  const textAlign = t.bodyAlign || "justify";
  const lineHeight = t.lineHeight || 1.5;
  const headingSize = (t.uppercaseChapter ? 5.5 : 6) * s;

  return (
    <div
      className="relative bg-white border border-border/60 rounded-sm shadow-sm flex flex-col overflow-hidden"
      style={{ width: dims.w, height: dims.h, padding: `${5 * s}px ${5 * s}px ${3 * s}px` }}
      data-testid={`mini-page-${t.id}-${type}`}
      role="img"
      aria-label={`${t.name} ${PAGE_LABELS[type]} preview`}
      aria-hidden="true"
    >
      {type === "title" && (
        <div className="flex-1 flex flex-col items-center text-center">
          <div style={{ flex: 0.9 }} />
          <div
            style={{
              fontFamily: t.headingFont,
              fontSize: 7 * s,
              fontWeight: 700,
              lineHeight: 1.1,
              color: "#111",
              padding: `0 ${2 * s}px`,
            }}
          >
            {t.sampleTitle}
          </div>
          <div
            style={{
              fontFamily: t.headingFont,
              fontSize: 3.2 * s,
              marginTop: 3 * s,
              color: "#666",
              letterSpacing: 0.4,
            }}
          >
            {t.sampleSubtitle}
          </div>
          <div style={{ flex: 1 }} />
          <div
            style={{
              fontFamily: t.font,
              fontSize: 4 * s,
              color: "#222",
              fontStyle: t.id === "non-fiction" ? "normal" : "italic",
            }}
          >
            {t.sampleAuthor}
          </div>
        </div>
      )}

      {type === "toc" && (
        <>
          <div
            style={{
              fontFamily: t.headingFont,
              fontSize: 5.5 * s,
              fontWeight: 700,
              color: "#111",
              textAlign: t.chapterAlign || "center",
              marginBottom: 4 * s,
              paddingTop: 3 * s,
            }}
          >
            Contents
          </div>
          {(t.tocEntries || []).map((entry, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                fontFamily: t.font,
                fontSize: 3.5 * s,
                color: "#222",
                lineHeight: 1.5,
                alignItems: "baseline",
                gap: 1,
                marginBottom: 1 * s,
              }}
            >
              <span style={{ whiteSpace: "nowrap" }}>{entry.title}</span>
              <span
                style={{
                  flex: 1,
                  overflow: "hidden",
                  color: "#bbb",
                  fontSize: 3 * s,
                  letterSpacing: 0.4,
                  whiteSpace: "nowrap",
                }}
              >
                {"·".repeat(40)}
              </span>
              <span style={{ color: "#444", fontVariantNumeric: "tabular-nums" }}>{entry.page}</span>
            </div>
          ))}
        </>
      )}

      {type === "chapter" && (
        <>
          <div style={{ height: 10 * s }} />
          <div
            style={{
              fontFamily: t.headingFont,
              fontSize: headingSize,
              fontWeight: 700,
              color: "#111",
              textAlign: t.chapterAlign || "center",
              letterSpacing: t.uppercaseChapter ? 0.6 : 0,
              lineHeight: 1.1,
            }}
          >
            {t.sampleHeading}
          </div>
          {t.hasOrnament && (
            <div
              style={{
                textAlign: "center",
                fontSize: 4 * s,
                color: "#999",
                marginTop: 2 * s,
                letterSpacing: 1,
              }}
            >
              ❦
            </div>
          )}
          <div style={{ height: (t.hasOrnament ? 3 : 5) * s }} />
          <div
            style={{
              fontFamily: t.font,
              fontSize: 4 * s,
              color: "#333",
              textAlign,
              lineHeight,
            }}
          >
            {t.hasDropCap && (
              <span
                style={{
                  fontFamily: t.headingFont,
                  fontSize: 11 * s,
                  float: "left",
                  lineHeight: 0.85,
                  marginRight: 1 * s,
                  marginTop: 0.5,
                  fontWeight: 700,
                  color: "#111",
                }}
              >
                {t.sampleLines[0].charAt(0)}
              </span>
            )}
            {t.hasDropCap ? t.sampleLines[0].slice(1) : t.sampleLines[0]}
          </div>
          <div
            style={{
              fontFamily: t.font,
              fontSize: 4 * s,
              color: "#333",
              textAlign,
              textIndent: t.bodyAlign === "left" ? 0 : 4 * s,
              marginTop: t.bodyAlign === "left" ? 2 * s : 1 * s,
              lineHeight,
            }}
          >
            {t.sampleLines[1]}
          </div>
        </>
      )}

      {type === "body" && (
        <>
          <div
            style={{
              fontFamily: t.headingFont,
              fontSize: 3 * s,
              color: "#999",
              textAlign: "center",
              fontStyle: "italic",
              letterSpacing: 0.3,
              paddingBottom: 1,
              borderBottom: t.id === "non-fiction" ? "0.5px solid #ddd" : "none",
              marginBottom: 2 * s,
            }}
          >
            {t.runningHeader}
          </div>
          {t.sampleLines.map((line, i) => (
            <p
              key={i}
              style={{
                fontFamily: t.font,
                fontSize: 4 * s,
                color: "#333",
                textAlign,
                textIndent: i === 0 || t.bodyAlign === "left" ? 0 : 4 * s,
                lineHeight,
                margin: 0,
                marginBottom: t.bodyAlign === "left" ? 1.5 * s : 0.5 * s,
              }}
            >
              {line}
            </p>
          ))}
          <p
            style={{
              fontFamily: t.font,
              fontSize: 4 * s,
              color: "#333",
              textAlign,
              textIndent: t.bodyAlign === "left" ? 0 : 4 * s,
              lineHeight,
              margin: 0,
              marginTop: t.bodyAlign === "left" ? 1.5 * s : 0.5 * s,
            }}
          >
            The hours stretched long that afternoon, each minute heavier than the last.
          </p>
          <div
            className="mt-auto"
            style={{ fontSize: 3 * s, textAlign: "center", color: "#888", paddingTop: 2 * s }}
          >
            — 12 —
          </div>
        </>
      )}
    </div>
  );
}

/** Compact preview spread used inside the template-selector. */
export function TemplatePreviewSpread({ t, size = "sm" }: { t: TemplateDef; size?: Size }) {
  return (
    <div className="flex gap-2 justify-center items-end flex-wrap">
      {getPreviewPages(t).map((pageType) => (
        <div key={pageType} className="flex flex-col items-center gap-1">
          <MiniPage t={t} type={pageType} size={size} />
          <span className="text-[9px] text-muted-foreground font-medium uppercase tracking-wider">
            {PAGE_LABELS[pageType]}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Marketing-grade card for the landing page. */
export function TemplateMarketingCard({ t }: { t: TemplateDef }) {
  return (
    <div
      className="bg-card rounded-2xl border border-border/60 overflow-hidden hover:border-primary/40 hover:shadow-xl transition-all group"
      data-testid={`marketing-card-${t.id}`}
    >
      <div className="bg-gradient-to-b from-muted/60 to-muted/20 px-5 pt-6 pb-5 border-b">
        <div className="flex gap-2 justify-center items-end flex-wrap min-h-[180px]">
          {getPreviewPages(t).map((pageType) => (
            <MiniPage key={pageType} t={t} type={pageType} size="md" />
          ))}
        </div>
      </div>
      <div className="p-5 space-y-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-primary/70 mb-1">
            {t.genre}
          </div>
          <h3 className="font-serif font-bold text-xl">{t.name}</h3>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{t.desc}</p>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs pt-2 border-t">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Type className="h-3 w-3 shrink-0" />
            <span className="truncate" title={t.fontLabel}>{t.fontLabel}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <AlignLeft className="h-3 w-3 shrink-0" />
            <span className="truncate">{t.spacingLabel}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground col-span-2">
            <BookOpen className="h-3 w-3 shrink-0" />
            <span className="truncate">{t.hierarchyLabel}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground col-span-2">
            <FileDown className="h-3 w-3 shrink-0" />
            <span>{t.formats.join(" · ")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
