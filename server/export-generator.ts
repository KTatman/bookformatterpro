import PDFDocument from "pdfkit";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  HeadingLevel,
  PageBreak,
  Header,
  Footer,
  PageNumber,
  NumberFormat,
  SectionType,
  TabStopType,
  TabStopPosition,
  InternalHyperlink,
  BookmarkStart,
  BookmarkEnd,
  PageReference,
} from "docx";
import JSZip from "jszip";

// ── Types ──────────────────────────────────────────────────────────

export interface MarginSettings {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface ParagraphSettings {
  font: string;
  size: number;
  indent: number;
  lineSpacing: number;
}

export interface HeaderFooterSettings {
  showHeader: boolean;
  showFooter: boolean;
  headerContent: "title-author" | "title-only" | "author-only" | "none";
  footerContent: "page-number" | "none";
  headerFontSize: number;
  footerFontSize: number;
}

export interface ChapterTitleRules {
  fontSize: number;
  bold: boolean;
  centered: boolean;
  spaceBefore: number;
  spaceAfter: number;
  startNewPage: boolean;
}

export interface TocSettings {
  includeTableOfContents: boolean;
  tocDepth: number;
  tocTitle: string;
  includeFrontMatterInToc: boolean;
  startTocOnNewPage: boolean;
}

export interface TemplateConfig {
  marginSettings: MarginSettings;
  paragraphSettings: ParagraphSettings;
  headerFooterSettings: HeaderFooterSettings;
  chapterTitleRules: ChapterTitleRules;
  tocSettings: TocSettings;
}

export interface ExportSettings {
  title: string;
  author: string;
  template: string;
  trimSize: string;
  target: string;
  templateConfig?: Partial<TemplateConfig>;
}

// ── Helpers ────────────────────────────────────────────────────────

function parseTrimPts(trim: string): [number, number] {
  const m = trim.match(/(\d+(?:\.\d+)?)["\s]*[×xX]\s*(\d+(?:\.\d+)?)/);
  if (!m) return [432, 648];
  return [Math.round(parseFloat(m[1]) * 72), Math.round(parseFloat(m[2]) * 72)];
}

function getDefaultMargins(trim: string, target: string): MarginSettings {
  const [w] = parseTrimPts(trim);
  const isStrict = /kdp|ingram/i.test(target);
  const sym = isStrict ? 72 : (w >= 432 ? 58 : 50);
  return { top: 72, bottom: 72, left: sym, right: sym };
}

interface FontSettings {
  titleFont: string;
  bodyFont: string;
  fontSize: number;
  lineGap: number;
}

function getFontSettings(template: string): FontSettings {
  switch (template) {
    case "memoir":
      return { titleFont: "Helvetica-Bold", bodyFont: "Helvetica", fontSize: 11, lineGap: 6 };
    case "non-fiction":
      return { titleFont: "Helvetica-Bold", bodyFont: "Helvetica", fontSize: 10, lineGap: 4 };
    case "fantasy":
    case "modern-novel":
    default:
      return { titleFont: "Times-Bold", bodyFont: "Times-Roman", fontSize: 11, lineGap: 5 };
  }
}

function getDefaultChapterTitleRules(template: string): ChapterTitleRules {
  switch (template) {
    case "non-fiction":
      return { fontSize: 14, bold: true, centered: false, spaceBefore: 36, spaceAfter: 18, startNewPage: true };
    case "memoir":
      return { fontSize: 15, bold: true, centered: true, spaceBefore: 48, spaceAfter: 24, startNewPage: true };
    case "fantasy":
      return { fontSize: 16, bold: true, centered: true, spaceBefore: 48, spaceAfter: 24, startNewPage: true };
    case "modern-novel":
    default:
      return { fontSize: 14, bold: true, centered: true, spaceBefore: 36, spaceAfter: 18, startNewPage: true };
  }
}

function getDefaultHeaderFooterSettings(): HeaderFooterSettings {
  return {
    showHeader: false,
    showFooter: true,
    headerContent: "none",
    footerContent: "page-number",
    headerFontSize: 8,
    footerFontSize: 8,
  };
}

function getDefaultTocSettings(template: string): TocSettings {
  return {
    includeTableOfContents: true,
    tocDepth: 2,
    tocTitle: "Table of Contents",
    includeFrontMatterInToc: false,
    startTocOnNewPage: true,
  };
}

export function resolveTemplateConfig(settings: ExportSettings): TemplateConfig {
  const dbCfg = settings.templateConfig || {};
  const fonts = getFontSettings(settings.template);

  const defaultParagraph: ParagraphSettings = {
    font: fonts.bodyFont,
    size: fonts.fontSize,
    indent: 18,
    lineSpacing: fonts.lineGap,
  };
  const defaultMargins = getDefaultMargins(settings.trimSize, settings.target);
  const defaultHF = getDefaultHeaderFooterSettings();
  const defaultChapter = getDefaultChapterTitleRules(settings.template);
  const defaultToc = getDefaultTocSettings(settings.template);

  return {
    marginSettings: { ...defaultMargins, ...(dbCfg.marginSettings || {}) },
    paragraphSettings: { ...defaultParagraph, ...(dbCfg.paragraphSettings || {}) },
    headerFooterSettings: { ...defaultHF, ...(dbCfg.headerFooterSettings || {}) },
    chapterTitleRules: { ...defaultChapter, ...(dbCfg.chapterTitleRules || {}) },
    tocSettings: { ...defaultToc, ...((dbCfg as any).tocSettings || {}) },
  };
}

// ── Chapter heading detection ─────────────────────────────────────

const NUMBER_WORDS = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty";

const CHAPTER_RE = new RegExp(
  "^(" +
    "chapter\\s+[\\divxlcdmIVXLCDM]+" +
    "|chapter\\s+(?:" + NUMBER_WORDS + ")" +
    "|part\\s+[\\divxlcdmIVXLCDM]+" +
    "|part\\s+(?:" + NUMBER_WORDS + ")" +
    "|prologue|epilogue|introduction|foreword|preface|afterword|acknowledgements?|about\\s+the\\s+author" +
  ")\\b",
  "i"
);

const ALL_CAPS_HEADING_RE = /^[A-Z][A-Z\s\d':!?—–-]{2,60}$/;

function isChapterHeading(para: string): boolean {
  const trimmed = para.trim();
  if (CHAPTER_RE.test(trimmed)) return true;

  if (ALL_CAPS_HEADING_RE.test(trimmed)) {
    const wordCount = trimmed.split(/\s+/).length;
    if (wordCount <= 8 && !/[.,;]$/.test(trimmed) && !trimmed.includes('"')) {
      return true;
    }
  }

  return false;
}

const SECTION_NUM_RE = /^(\d+\.)+\s+\S/;
const ROMAN_SECTION_RE = /^[IVXLCDM]+[.)]\s+[A-Z]/;
const DIGIT_SECTION_RE = /^\d+[.)]\s+[A-Z]/;
const SMALL_WORDS_RE = /^(the|of|and|in|a|an|to|for|or|with|on|at|by|from|as|is|it|but|not|no|its)$/;

const SECTION_KEYWORD_RE = /^(section|part|act|scene|book|volume|appendix|addendum|interlude|intermission)\s+/i;

function isSectionHeading(para: string): boolean {
  const trimmed = para.trim();
  if (isChapterHeading(trimmed)) return false;
  if (trimmed.length > 80 || trimmed.length < 2) return false;
  if (trimmed.includes("\n")) return false;
  const words = trimmed.split(/\s+/);
  if (words.length > 10) return false;
  if (/[.;,]$/.test(trimmed)) return false;
  if (/["\u201C\u201D]/.test(trimmed)) return false;

  if (SECTION_NUM_RE.test(trimmed)) return true;
  if (ROMAN_SECTION_RE.test(trimmed)) return true;
  if (DIGIT_SECTION_RE.test(trimmed)) return true;
  if (SECTION_KEYWORD_RE.test(trimmed)) return true;

  if (words.length >= 2 && words.length <= 6) {
    const significantWords = words.filter(w => !SMALL_WORDS_RE.test(w));
    const capitalizedSig = significantWords.filter(w => /^[A-Z]/.test(w));
    if (significantWords.length >= 2 && capitalizedSig.length === significantWords.length) {
      if (/^[A-Z]/.test(trimmed) && !/^(He|She|They|We|It|You|His|Her|My|Our|Your|Its|This|That|There|Here|When|Where|What|How|Why|Who|Some|Many|Most|Each|All|Any|No|Not|But|So|Yet|If|As|At|On|In|To|By|Up|Do|Can|Was|Were|Had|Has|Did|Got|Let|May|Now|Then|Just|Too|Very|Also|Only|Even|Still|Back|Into|Over|Down|Off|Out|Away|Long|More|Much)\s/.test(trimmed)) {
        return true;
      }
    }
  }

  return false;
}

type HeadingType = "chapter" | "chapter-label" | "chapter-title" | "section" | "body";

function classifyParagraph(para: string): HeadingType {
  if (isChapterHeading(para)) return "chapter";
  if (isSectionHeading(para)) return "section";
  return "body";
}

function isSceneBreak(para: string): boolean {
  const t = para.trim();
  if (t.length > 30 || t.length < 1) return false;
  return /^[\s*·•~#\-–—]+$/.test(t);
}

export function splitParagraphs(text: string): string[] {
  return text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
}

export type ParagraphType = "title" | "author" | "chapter" | "chapter-label" | "chapter-title" | "section" | "introduction" | "body" | "front-matter" | "scene-break";

export function autoDetectStructure(text: string, _projectTitle: string, _projectAuthor: string): ParagraphType[] {
  const paras = splitParagraphs(text);
  const types: ParagraphType[] = new Array(paras.length).fill("body");

  for (let i = 0; i < paras.length; i++) {
    types[i] = classifyParagraph(paras[i]);
  }

  return types;
}

function countFrontMatterSkip(types: ParagraphType[]): number {
  let skip = 0;
  if (types.length > 0 && types[0] === "title") skip = 1;
  if (types.length > 1 && skip === 1 && types[1] === "author") skip = 2;
  return skip;
}

function getBodyTypes(confirmedTypes: ParagraphType[]): ParagraphType[] {
  const skip = countFrontMatterSkip(confirmedTypes);
  return confirmedTypes.slice(skip);
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").trim();
}

interface FrontMatterResult {
  bodyText: string;
  detectedTitle: string | null;
  detectedAuthor: string | null;
}

const BY_PREFIX_RE = /^by\s+/i;

function isTitleLike(para: string): boolean {
  const trimmed = para.trim();
  if (trimmed.length > 150) return false;
  if (trimmed.length < 1) return false;
  if (trimmed.split(/\s+/).length > 20) return false;
  if (/[.;]$/.test(trimmed)) return false;
  if (isChapterHeading(trimmed)) return false;
  return true;
}

function isAuthorLine(para: string): boolean {
  const trimmed = para.trim();
  if (trimmed.length > 100) return false;
  if (BY_PREFIX_RE.test(trimmed)) return true;
  if (trimmed.split(/\s+/).length <= 5 && !/[.;,]$/.test(trimmed)) return true;
  return false;
}

function extractFrontMatter(text: string, projectTitle: string, projectAuthor: string): FrontMatterResult {
  const paras = splitParagraphs(text);
  if (paras.length === 0) {
    return { bodyText: text, detectedTitle: null, detectedAuthor: null };
  }

  let skip = 0;
  let detectedTitle: string | null = null;
  let detectedAuthor: string | null = null;

  const first = paras[0].trim();
  const projTitleNorm = normalize(projectTitle);
  const firstNorm = normalize(first);

  const exactTitleMatch = projTitleNorm.length > 0 && firstNorm === projTitleNorm;

  const hasByAuthorNext = paras.length > 1 && BY_PREFIX_RE.test(paras[1].trim());
  const structuralMatch = isTitleLike(first) && hasByAuthorNext;

  if (exactTitleMatch || structuralMatch) {
    detectedTitle = first;
    skip = 1;

    if (paras.length > 1) {
      const second = paras[1].trim();
      const projAuthorNorm = normalize(projectAuthor);
      const secondNorm = normalize(second);

      const authorMatch =
        secondNorm === projAuthorNorm ||
        secondNorm === `by ${projAuthorNorm}` ||
        BY_PREFIX_RE.test(second);

      if (authorMatch && !isChapterHeading(second)) {
        detectedAuthor = second.replace(BY_PREFIX_RE, "").trim();
        skip = 2;
      }
    }
  }

  return {
    bodyText: paras.slice(skip).join("\n\n"),
    detectedTitle,
    detectedAuthor,
  };
}

function stripFrontMatter(text: string, title: string, author: string): string {
  return extractFrontMatter(text, title, author).bodyText;
}

// ── TOC entry collection ──────────────────────────────────────────

const FRONT_MATTER_RE = /^(prologue|epilogue|introduction|foreword|preface|afterword|acknowledgements?|about\s+the\s+author)\b/i;

interface TocEntry {
  title: string;
  level: number;
  isFrontMatter: boolean;
  paraIndex: number;
}

function collectTocEntries(text: string, tocDepth: number, bodyTypes?: ParagraphType[]): TocEntry[] {
  const paras = splitParagraphs(text);
  const entries: TocEntry[] = [];

  for (let i = 0; i < paras.length; i++) {
    const trimmed = paras[i].trim();
    const type = bodyTypes && i < bodyTypes.length ? bodyTypes[i] : classifyParagraph(trimmed);
    if (type === "body" || type === "scene-break" || type === "front-matter" || type === "title" || type === "author" || type === "chapter-title") continue;

    const isFront = FRONT_MATTER_RE.test(trimmed);
    let level: number;
    if (type === "chapter" || type === "introduction" || type === "chapter-label") {
      level = /^part\s+/i.test(trimmed) ? 0 : 1;
    } else {
      level = 2;
    }

    if (level <= tocDepth) {
      entries.push({ title: trimmed, level, isFrontMatter: isFront, paraIndex: i });
    }
  }
  return entries;
}

// ── PDF ────────────────────────────────────────────────────────────

export async function generatePDF(
  text: string,
  settings: ExportSettings,
  confirmedTypes?: ParagraphType[]
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const [w, h] = parseTrimPts(settings.trimSize);
    const cfg = resolveTemplateConfig(settings);
    const margins = cfg.marginSettings;
    const fonts = getFontSettings(settings.template);
    const hfSettings = cfg.headerFooterSettings;
    const chRules = cfg.chapterTitleRules;

    const usableWidth = w - margins.left - margins.right;

    let displayTitle: string;
    let displayAuthor: string;
    let bodyText: string;
    let bodyTypes: ParagraphType[] | undefined;

    if (confirmedTypes) {
      displayTitle = settings.title || "Untitled";
      displayAuthor = settings.author || "Unknown Author";
      const allParas = splitParagraphs(text);
      const bodyIndices: number[] = [];
      for (let i = 0; i < confirmedTypes.length; i++) {
        const ct = confirmedTypes[i];
        if (ct === "title" && i < allParas.length) { displayTitle = allParas[i].trim() || displayTitle; continue; }
        if (ct === "author" && i < allParas.length) { displayAuthor = allParas[i].replace(/^by\s+/i, "").trim() || displayAuthor; continue; }
        bodyIndices.push(i);
      }
      bodyText = bodyIndices.map(i => allParas[i] || "").join("\n\n");
      bodyTypes = bodyIndices.map(i => confirmedTypes[i]);
    } else {
      const frontMatter = extractFrontMatter(text, settings.title, settings.author);
      displayTitle = frontMatter.detectedTitle || settings.title || "Untitled";
      displayAuthor = frontMatter.detectedAuthor || settings.author || "Unknown Author";
      bodyText = frontMatter.bodyText;
    }

    const doc = new PDFDocument({
      size: [w, h],
      margins,
      autoFirstPage: false,
      bufferPages: true,
      info: {
        Title: displayTitle,
        Author: displayAuthor,
        Creator: "BookFormatter Pro",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.addPage();
    doc.y = h * 0.38;
    doc
      .font(fonts.titleFont)
      .fontSize(22)
      .text(displayTitle, margins.left, doc.y, {
        width: usableWidth,
        align: "center",
      });
    doc.moveDown(0.8);
    doc
      .font(fonts.bodyFont)
      .fontSize(14)
      .text(`by ${displayAuthor}`, margins.left, doc.y, {
        width: usableWidth,
        align: "center",
      });
    const tocCfg = cfg.tocSettings;
    let frontPageCount = 1;

    const tocEntries = tocCfg.includeTableOfContents
      ? collectTocEntries(bodyText, tocCfg.tocDepth, bodyTypes)
      : [];
    const filteredToc = tocCfg.includeFrontMatterInToc
      ? tocEntries
      : tocEntries.filter(e => !e.isFrontMatter);

    const tocFontSize = cfg.paragraphSettings.size;
    const tocUsableHeight = h - margins.top - margins.bottom - 60;
    const tocEstLineHeight = tocFontSize + 8;
    const entriesPerPage = Math.max(1, Math.floor(tocUsableHeight / (tocEstLineHeight * 1.5)));
    const tocPageCount = filteredToc.length > 0 ? Math.max(1, Math.ceil(filteredToc.length / entriesPerPage)) : 0;
    const tocPageStart = frontPageCount;

    for (let tp = 0; tp < tocPageCount; tp++) {
      doc.addPage();
      frontPageCount++;
    }

    const renderedHeadings: { title: string; level: number; pageIndex: number; isFrontMatter: boolean }[] = [];

    const sectionFontSize = Math.round(chRules.fontSize * 0.75);
    const sectionSpaceBefore = Math.round(chRules.spaceBefore * 0.5);
    const sectionSpaceAfter = Math.round(chRules.spaceAfter * 0.5);

    const paras = splitParagraphs(bodyText);
    let firstParaAfterHeading = true;
    let needsNewPageForBody = true;

    for (let pi = 0; pi < paras.length; pi++) {
      const para = paras[pi];
      const pType = bodyTypes && pi < bodyTypes.length ? bodyTypes[pi] : classifyParagraph(para);

      if (pType === "scene-break") {
        if (needsNewPageForBody) { doc.addPage(); needsNewPageForBody = false; }
        doc.moveDown(1);
        doc.font(fonts.bodyFont).fontSize(cfg.paragraphSettings.size)
          .text("* * *", margins.left, doc.y, { width: usableWidth, align: "center" });
        doc.moveDown(1);
        firstParaAfterHeading = true;
        continue;
      }

      if (pType === "chapter" || pType === "introduction" || pType === "chapter-label") {
        if (chRules.startNewPage || needsNewPageForBody) {
          doc.addPage();
          needsNewPageForBody = false;
        }
        const headingPageIdx = doc.bufferedPageRange().start + doc.bufferedPageRange().count - 1;
        renderedHeadings.push({ title: para.trim(), level: /^part\s+/i.test(para.trim()) ? 0 : 1, pageIndex: headingPageIdx, isFrontMatter: FRONT_MATTER_RE.test(para.trim()) });
        doc.y = margins.top + chRules.spaceBefore;
        doc
          .font(chRules.bold ? fonts.titleFont : fonts.bodyFont)
          .fontSize(chRules.fontSize)
          .text(para.trim(), margins.left, doc.y, {
            width: usableWidth,
            align: chRules.centered ? "center" : "left",
          });
        doc.moveDown(chRules.spaceAfter / fonts.fontSize);
        firstParaAfterHeading = true;
      } else if (pType === "chapter-title") {
        if (needsNewPageForBody) {
          doc.addPage();
          needsNewPageForBody = false;
        }
        const subtitleSize = Math.max(chRules.fontSize - 4, cfg.paragraphSettings.size + 2);
        doc
          .font(fonts.titleFont)
          .fontSize(subtitleSize)
          .text(para.trim(), margins.left, doc.y, {
            width: usableWidth,
            align: chRules.centered ? "center" : "left",
          });
        doc.moveDown(chRules.spaceAfter / subtitleSize);
        firstParaAfterHeading = true;
      } else if (pType === "section") {
        if (needsNewPageForBody) {
          doc.addPage();
          needsNewPageForBody = false;
        }
        const secPageIdx = doc.bufferedPageRange().start + doc.bufferedPageRange().count - 1;
        renderedHeadings.push({ title: para.trim(), level: 2, pageIndex: secPageIdx, isFrontMatter: FRONT_MATTER_RE.test(para.trim()) });
        doc.moveDown(sectionSpaceBefore / sectionFontSize);
        doc
          .font(fonts.titleFont)
          .fontSize(sectionFontSize)
          .text(para.trim(), margins.left, doc.y, {
            width: usableWidth,
            align: "left",
          });
        doc.moveDown(sectionSpaceAfter / sectionFontSize);
        firstParaAfterHeading = true;
      } else {
        if (needsNewPageForBody) {
          doc.addPage();
          needsNewPageForBody = false;
        }
        const indent = firstParaAfterHeading ? 0 : cfg.paragraphSettings.indent;
        const pdfBodyFont = cfg.paragraphSettings.font || fonts.bodyFont;
        doc
          .font(pdfBodyFont)
          .fontSize(cfg.paragraphSettings.size)
          .text(para.trim(), margins.left + indent, doc.y, {
            width: usableWidth - indent,
            align: "justify",
            lineGap: cfg.paragraphSettings.lineSpacing,
          });
        doc.moveDown(0.25);
        firstParaAfterHeading = false;
      }
    }

    const tocToRender = renderedHeadings.filter(h => {
      if (h.level > tocCfg.tocDepth) return false;
      if (!tocCfg.includeFrontMatterInToc && h.isFrontMatter) return false;
      return true;
    });

    if (tocPageCount > 0 && tocToRender.length > 0) {
      const dotChar = ".";
      const pageNumReserve = 40;
      const hangingIndent = 14;
      const entrySpacing = 4;

      let currentTocPage = 0;
      doc.switchToPage(tocPageStart);
      let yPos = margins.top + 36;
      const yMax = h - margins.bottom - 10;

      doc
        .font(fonts.titleFont)
        .fontSize(16)
        .fillColor("#000")
        .text(tocCfg.tocTitle, margins.left, yPos, {
          width: usableWidth,
          align: "center",
        });
      yPos = doc.y + 18;

      for (let gi = 0; gi < tocToRender.length; gi++) {
        const entry = tocToRender[gi];
        const bodyPageNum = entry.pageIndex - frontPageCount + 1;
        const pageStr = String(bodyPageNum);
        const indent = entry.level > 1 ? 18 : 0;

        const entryFontSize = entry.level > 1 ? tocFontSize - 1 : tocFontSize;
        const entryFont = entry.level > 1 ? fonts.bodyFont : fonts.titleFont;
        const lineHeight = entryFontSize + 3;

        const titleAreaWidth = usableWidth - indent - pageNumReserve;

        doc.font(entryFont).fontSize(entryFontSize);
        const titleHeight = doc.heightOfString(entry.title, {
          width: titleAreaWidth - hangingIndent,
        });
        const totalEntryHeight = Math.max(titleHeight, lineHeight) + entrySpacing;

        if (yPos + totalEntryHeight > yMax && currentTocPage + 1 < tocPageCount) {
          currentTocPage++;
          doc.switchToPage(tocPageStart + currentTocPage);
          yPos = margins.top;
        }

        const titleFitsOneLine = titleHeight <= lineHeight + 2;

        if (titleFitsOneLine) {
          doc.font(entryFont).fontSize(entryFontSize).fillColor("#000");
          const titleWidth = doc.widthOfString(entry.title);

          doc.text(entry.title, margins.left + indent, yPos, {
            lineBreak: false,
          });

          doc.font(fonts.bodyFont).fontSize(entryFontSize);
          const pageNumWidth = doc.widthOfString(pageStr);
          const dotWidth = doc.widthOfString(dotChar + " ");

          const titleEndX = margins.left + indent + titleWidth;
          const pageStartX = margins.left + usableWidth - pageNumWidth;
          const dotsAvail = pageStartX - titleEndX - 8;
          const actualDots = Math.max(0, Math.floor(dotsAvail / dotWidth));

          if (actualDots > 2) {
            doc.fillColor("#999");
            doc.text(" " + (dotChar + " ").repeat(actualDots), titleEndX, yPos, {
              width: dotsAvail + 4,
              align: "left",
              lineBreak: false,
            });
          }

          doc.fillColor("#000").font(fonts.bodyFont).fontSize(entryFontSize);
          doc.text(pageStr, margins.left, yPos, {
            width: usableWidth,
            align: "right",
            lineBreak: false,
          });

          yPos += lineHeight + entrySpacing;
        } else {
          doc.font(entryFont).fontSize(entryFontSize).fillColor("#000");
          doc.text(entry.title, margins.left + indent, yPos, {
            width: titleAreaWidth - hangingIndent,
            align: "left",
            indent: 0,
            lineGap: 2,
          });
          const textBottom = doc.y;

          doc.font(fonts.bodyFont).fontSize(entryFontSize);
          const pageNumWidth = doc.widthOfString(pageStr);
          doc.fillColor("#000");
          doc.text(pageStr, margins.left, yPos, {
            width: usableWidth,
            align: "right",
            lineBreak: false,
          });

          yPos = textBottom + entrySpacing;
        }
      }
    }

    const range = doc.bufferedPageRange();
    const totalPages = range.count;

    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(range.start + i);

      if (i < frontPageCount) continue;

      const bodyPageNum = i - frontPageCount + 1;
      const isEven = bodyPageNum % 2 === 0;

      const savedMarginTop = doc.page.margins.top;
      const savedMarginBottom = doc.page.margins.bottom;
      doc.page.margins.top = 0;
      doc.page.margins.bottom = 0;

      if (hfSettings.showHeader && hfSettings.headerContent !== "none") {
        let headerText = "";
        if (hfSettings.headerContent === "title-author") {
          headerText = isEven ? displayTitle : displayAuthor;
        } else if (hfSettings.headerContent === "title-only") {
          headerText = displayTitle;
        } else if (hfSettings.headerContent === "author-only") {
          headerText = displayAuthor;
        }
        if (headerText) {
          doc
            .font(fonts.bodyFont)
            .fontSize(hfSettings.headerFontSize)
            .fillColor("#555")
            .text(headerText, margins.left, savedMarginTop - 20, {
              width: usableWidth,
              align: isEven ? "left" : "right",
              lineBreak: false,
            });
        }
      }

      if (hfSettings.showFooter && hfSettings.footerContent === "page-number") {
        doc
          .font(fonts.bodyFont)
          .fontSize(hfSettings.footerFontSize)
          .fillColor("#555")
          .text(String(bodyPageNum), margins.left, h - savedMarginBottom + 14, {
            width: usableWidth,
            align: "center",
            lineBreak: false,
          });
      }

      doc.page.margins.top = savedMarginTop;
      doc.page.margins.bottom = savedMarginBottom;
      doc.fillColor("#000");
      doc.y = savedMarginTop;
    }

    doc.flushPages();
    doc.end();
  });
}

// ── DOCX ───────────────────────────────────────────────────────────

const ptToHalfPt = (pt: number) => pt * 2;
const ptToTwips = (pt: number) => Math.round(pt * 20);

export async function generateDOCX(
  text: string,
  settings: ExportSettings,
  confirmedTypes?: ParagraphType[]
): Promise<Buffer> {
  const [w, h] = parseTrimPts(settings.trimSize);
  const cfg = resolveTemplateConfig(settings);
  const margins = cfg.marginSettings;
  const fonts = getFontSettings(settings.template);
  const chRules = cfg.chapterTitleRules;
  const hfSettings = cfg.headerFooterSettings;

  const cfgFont = cfg.paragraphSettings.font || fonts.bodyFont;
  const bodyFontFamily = /Helvetica|Arial/i.test(cfgFont) ? "Arial" : "Times New Roman";
  const titleFontFamily = /Helvetica|Arial/i.test(fonts.titleFont) ? "Arial" : "Times New Roman";

  let displayTitle: string;
  let displayAuthor: string;
  let bodyText: string;
  let docxBodyTypes: ParagraphType[] | undefined;

  if (confirmedTypes) {
    displayTitle = settings.title || "Untitled";
    displayAuthor = settings.author || "Unknown Author";
    const allParas = splitParagraphs(text);
    const bodyIndices: number[] = [];
    for (let i = 0; i < confirmedTypes.length; i++) {
      const ct = confirmedTypes[i];
      if (ct === "title" && i < allParas.length) { displayTitle = allParas[i].trim() || displayTitle; continue; }
      if (ct === "author" && i < allParas.length) { displayAuthor = allParas[i].replace(/^by\s+/i, "").trim() || displayAuthor; continue; }
      bodyIndices.push(i);
    }
    bodyText = bodyIndices.map(i => allParas[i] || "").join("\n\n");
    docxBodyTypes = bodyIndices.map(i => confirmedTypes[i]);
  } else {
    const frontMatter = extractFrontMatter(text, settings.title, settings.author);
    displayTitle = frontMatter.detectedTitle || settings.title || "Untitled";
    displayAuthor = frontMatter.detectedAuthor || settings.author || "Unknown Author";
    bodyText = frontMatter.bodyText;
  }
  const paras = splitParagraphs(bodyText);

  const titlePageChildren: Paragraph[] = [
    new Paragraph({
      children: [
        new TextRun({
          text: displayTitle,
          bold: true,
          size: ptToHalfPt(24),
          font: titleFontFamily,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: ptToTwips(h * 0.38), after: ptToTwips(8) },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `by ${displayAuthor}`,
          size: ptToHalfPt(14),
          font: bodyFontFamily,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: ptToTwips(24) },
    }),
  ];

  const tocCfg = cfg.tocSettings;
  const tocChildren: Paragraph[] = [];

  if (tocCfg.includeTableOfContents) {
    const tocEntries = collectTocEntries(bodyText, tocCfg.tocDepth, docxBodyTypes);
    const filtered = tocCfg.includeFrontMatterInToc
      ? tocEntries
      : tocEntries.filter(e => !e.isFrontMatter);

    if (filtered.length > 0) {
      tocChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: tocCfg.tocTitle,
              bold: true,
              size: ptToHalfPt(16),
              font: titleFontFamily,
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { before: ptToTwips(36), after: ptToTwips(18) },
        })
      );

      const rightTabPos = ptToTwips(w - margins.left - margins.right);
      const hangIndent = ptToTwips(14);
      for (let ei = 0; ei < filtered.length; ei++) {
        const entry = filtered[ei];
        const indentPt = entry.level * 18;
        const baseIndent = ptToTwips(indentPt);
        const bookmarkId = `toc_target_${ei}`;
        const entryFontSize = entry.level > 1 ? cfg.paragraphSettings.size - 1 : cfg.paragraphSettings.size;

        tocChildren.push(
          new Paragraph({
            children: [
              new InternalHyperlink({
                anchor: bookmarkId,
                children: [
                  new TextRun({
                    text: entry.title,
                    size: ptToHalfPt(entryFontSize),
                    font: entry.level > 1 ? bodyFontFamily : titleFontFamily,
                    bold: entry.level <= 1,
                  }),
                  new TextRun({
                    children: ["\t", new PageReference(bookmarkId)],
                    size: ptToHalfPt(entryFontSize),
                    font: bodyFontFamily,
                  }),
                ],
              }),
            ],
            tabStops: [
              {
                type: TabStopType.RIGHT,
                position: rightTabPos - baseIndent,
                leader: "dot" as any,
              },
            ],
            alignment: AlignmentType.LEFT,
            indent: {
              left: baseIndent + hangIndent,
              hanging: hangIndent,
            },
            spacing: { after: ptToTwips(6) },
          })
        );
      }
    }
  }

  const paraBookmarkMap = new Map<number, string>();
  if (tocCfg.includeTableOfContents) {
    const allTocEntries = collectTocEntries(bodyText, tocCfg.tocDepth, docxBodyTypes);
    const docxFiltered = tocCfg.includeFrontMatterInToc
      ? allTocEntries
      : allTocEntries.filter(e => !e.isFrontMatter);
    docxFiltered.forEach((entry, i) => {
      paraBookmarkMap.set(entry.paraIndex, `toc_target_${i}`);
    });
  }

  const docxSectionFontSize = Math.round(chRules.fontSize * 0.75);
  const docxSectionSpaceBefore = Math.round(chRules.spaceBefore * 0.5);
  const docxSectionSpaceAfter = Math.round(chRules.spaceAfter * 0.5);

  const bodyChildren: Paragraph[] = [];
  let firstAfterHeading = true;

  for (let pi = 0; pi < paras.length; pi++) {
    const para = paras[pi];
    const pType = docxBodyTypes && pi < docxBodyTypes.length ? docxBodyTypes[pi] : classifyParagraph(para);

    if (pType === "scene-break") {
      bodyChildren.push(
        new Paragraph({
          children: [new TextRun({ text: "* * *", font: bodyFontFamily, size: ptToHalfPt(cfg.paragraphSettings.size) })],
          alignment: AlignmentType.CENTER,
          spacing: { before: ptToTwips(18), after: ptToTwips(18) },
        })
      );
      firstAfterHeading = true;
      continue;
    }

    if (pType === "chapter" || pType === "introduction" || pType === "chapter-label") {
      const bmId = paraBookmarkMap.get(pi);
      const headingChildren: any[] = [];
      if (bmId) headingChildren.push(new BookmarkStart({ id: bmId, name: bmId }));
      headingChildren.push(new TextRun({
        text: para.trim(),
        bold: chRules.bold,
        size: ptToHalfPt(chRules.fontSize),
        font: titleFontFamily,
      }));
      if (bmId) headingChildren.push(new BookmarkEnd(bmId));
      bodyChildren.push(
        new Paragraph({
          children: headingChildren,
          heading: HeadingLevel.HEADING_1,
          alignment: chRules.centered ? AlignmentType.CENTER : AlignmentType.LEFT,
          spacing: { before: ptToTwips(chRules.spaceBefore), after: ptToTwips(chRules.spaceAfter) },
          pageBreakBefore: chRules.startNewPage,
        })
      );
      firstAfterHeading = true;
    } else if (pType === "chapter-title") {
      const subtitleSize = Math.max(chRules.fontSize - 4, cfg.paragraphSettings.size + 2);
      bodyChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: para.trim(),
              bold: true,
              size: ptToHalfPt(subtitleSize),
              font: titleFontFamily,
            }),
          ],
          heading: HeadingLevel.HEADING_2,
          alignment: chRules.centered ? AlignmentType.CENTER : AlignmentType.LEFT,
          spacing: { before: ptToTwips(4), after: ptToTwips(chRules.spaceAfter) },
        })
      );
      firstAfterHeading = true;
    } else if (pType === "section") {
      const secBmId = paraBookmarkMap.get(pi);
      const secChildren: any[] = [];
      if (secBmId) secChildren.push(new BookmarkStart({ id: secBmId, name: secBmId }));
      secChildren.push(new TextRun({
        text: para.trim(),
        bold: true,
        size: ptToHalfPt(docxSectionFontSize),
        font: titleFontFamily,
      }));
      if (secBmId) secChildren.push(new BookmarkEnd(secBmId));
      bodyChildren.push(
        new Paragraph({
          children: secChildren,
          heading: HeadingLevel.HEADING_2,
          alignment: AlignmentType.LEFT,
          spacing: { before: ptToTwips(docxSectionSpaceBefore), after: ptToTwips(docxSectionSpaceAfter) },
        })
      );
      firstAfterHeading = true;
    } else {
      bodyChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: para.trim(),
              size: ptToHalfPt(cfg.paragraphSettings.size),
              font: bodyFontFamily,
            }),
          ],
          alignment: AlignmentType.BOTH,
          indent: firstAfterHeading ? undefined : { firstLine: ptToTwips(cfg.paragraphSettings.indent) },
          spacing: { line: Math.round(240 + cfg.paragraphSettings.lineSpacing * 20), lineRule: "auto" as any },
        })
      );
      firstAfterHeading = false;
    }
  }

  const pageSize = {
    width: ptToTwips(w),
    height: ptToTwips(h),
  };
  const pageMargin = {
    top: ptToTwips(margins.top),
    bottom: ptToTwips(margins.bottom),
    left: ptToTwips(margins.left),
    right: ptToTwips(margins.right),
  };

  const makeHeaderParagraph = (text: string, align: typeof AlignmentType.LEFT) =>
    new Paragraph({
      children: [
        new TextRun({
          text,
          size: ptToHalfPt(hfSettings.headerFontSize),
          font: bodyFontFamily,
          color: "555555",
        }),
      ],
      alignment: align,
    });

  let bodyHeaders: Record<string, Header> = {};
  if (hfSettings.showHeader && hfSettings.headerContent !== "none") {
    if (hfSettings.headerContent === "title-author") {
      bodyHeaders = {
        even: new Header({ children: [makeHeaderParagraph(settings.title || "", AlignmentType.LEFT)] }),
        default: new Header({ children: [makeHeaderParagraph(settings.author || "", AlignmentType.RIGHT)] }),
      };
    } else {
      const headerText = hfSettings.headerContent === "author-only"
        ? (settings.author || "")
        : (settings.title || "");
      bodyHeaders = {
        default: new Header({ children: [makeHeaderParagraph(headerText, AlignmentType.CENTER)] }),
      };
    }
  }

  let bodyFooters: Record<string, Footer> = {};
  if (hfSettings.showFooter && hfSettings.footerContent === "page-number") {
    const footerPara = new Paragraph({
      children: [
        new TextRun({
          children: [PageNumber.CURRENT],
          size: ptToHalfPt(hfSettings.footerFontSize),
          font: bodyFontFamily,
          color: "555555",
        }),
      ],
      alignment: AlignmentType.CENTER,
    });
    bodyFooters = { default: new Footer({ children: [footerPara] }) };
  }

  const sections: any[] = [
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pageSize, margin: pageMargin },
        titlePage: true,
        pageNumberFormatType: NumberFormat.DECIMAL,
        pageNumberStart: 1,
      },
      headers: {},
      footers: {},
      children: titlePageChildren,
    },
  ];

  if (tocChildren.length > 0) {
    sections.push({
      properties: {
        type: tocCfg.startTocOnNewPage ? SectionType.NEXT_PAGE : SectionType.CONTINUOUS,
        page: { size: pageSize, margin: pageMargin },
      },
      headers: {},
      footers: bodyFooters,
      children: tocChildren,
    });
  }

  sections.push({
    properties: {
      type: SectionType.NEXT_PAGE,
      page: { size: pageSize, margin: pageMargin },
      pageNumberStart: 1,
    },
    headers: bodyHeaders,
    footers: bodyFooters,
    children: bodyChildren,
  });

  const doc = new Document({
    sections,
    styles: {
      default: {
        document: {
          run: {
            font: bodyFontFamily,
            size: ptToHalfPt(cfg.paragraphSettings.size),
          },
        },
      },
    },
  });

  return Packer.toBuffer(doc);
}

// ── EPUB ───────────────────────────────────────────────────────────

interface EpubChapter {
  id: string;
  title: string;
  body: string;
  index: number;
  paraTypes?: ParagraphType[];
}

function parseEpubChapters(text: string, bookTitle: string, author: string, confirmedTypes?: ParagraphType[]): { chapters: EpubChapter[]; displayTitle: string; displayAuthor: string } {
  let displayTitle: string;
  let displayAuthor: string;
  let paragraphs: string[];
  let bodyTypes: ParagraphType[] | undefined;

  if (confirmedTypes) {
    displayTitle = bookTitle || "Untitled";
    displayAuthor = author || "Unknown Author";
    const allParas = splitParagraphs(text);
    const bodyIndices: number[] = [];
    for (let i = 0; i < confirmedTypes.length; i++) {
      const ct = confirmedTypes[i];
      if (ct === "title" && i < allParas.length) { displayTitle = allParas[i].trim() || displayTitle; continue; }
      if (ct === "author" && i < allParas.length) { displayAuthor = allParas[i].replace(/^by\s+/i, "").trim() || displayAuthor; continue; }
      bodyIndices.push(i);
    }
    paragraphs = bodyIndices.map(i => allParas[i] || "").filter(p => p.trim());
    bodyTypes = bodyIndices.map(i => confirmedTypes[i]);
  } else {
    const fm = extractFrontMatter(text, bookTitle, author);
    displayTitle = fm.detectedTitle || bookTitle || "Untitled";
    displayAuthor = fm.detectedAuthor || author || "Unknown Author";
    paragraphs = fm.bodyText.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  }
  const chapters: EpubChapter[] = [];
  let current: string[] = [];
  let currentTypes: ParagraphType[] = [];
  let currentTitle = bookTitle || "Start";
  let chapterIndex = 0;

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const para = paragraphs[pi];
    const pType = bodyTypes && pi < bodyTypes.length ? bodyTypes[pi] : undefined;
    const isChap = pType ? (pType === "chapter" || pType === "introduction" || pType === "chapter-label") : isChapterHeading(para);

    if (isChap) {
      if (current.length > 0 || chapterIndex === 0) {
        chapterIndex++;
        chapters.push({
          id: `chapter_${String(chapterIndex).padStart(3, "0")}`,
          title: currentTitle,
          body: current.join("\n\n"),
          index: chapterIndex,
          paraTypes: bodyTypes ? currentTypes : undefined,
        });
      }
      currentTitle = para.trim();
      current = [];
      currentTypes = [];
    } else {
      current.push(para);
      if (pType) currentTypes.push(pType);
    }
  }

  chapterIndex++;
  chapters.push({
    id: `chapter_${String(chapterIndex).padStart(3, "0")}`,
    title: currentTitle,
    body: current.join("\n\n"),
    index: chapterIndex,
    paraTypes: bodyTypes ? currentTypes : undefined,
  });

  const filtered = chapters.filter(c => c.body.trim().length > 0 || c.title !== bookTitle);
  return { chapters: filtered, displayTitle, displayAuthor };
}

function stripInvalidXmlChars(str: string): string {
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function xmlEscape(str: string): string {
  return stripInvalidXmlChars(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function slugify(text: string): string {
  let slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return slug || "heading";
}

function makeUniqueAnchor(base: string, used: Set<string>): string {
  let anchor = `sec-${base}`;
  if (!used.has(anchor)) { used.add(anchor); return anchor; }
  let n = 2;
  while (used.has(`${anchor}-${n}`)) n++;
  anchor = `${anchor}-${n}`;
  used.add(anchor);
  return anchor;
}

function textToXhtmlParas(text: string, firstNoIndent = true, anchorSet?: Set<string>, paraTypes?: ParagraphType[]): string {
  const paras = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  let afterHeading = firstNoIndent;
  const usedAnchors = anchorSet || new Set<string>();
  return paras
    .map((p, i) => {
      const pType = paraTypes && i < paraTypes.length ? paraTypes[i] : (isSectionHeading(p) ? "section" : "body");

      if (pType === "scene-break") {
        afterHeading = true;
        return `    <p class="scene-break no-indent">* * *</p>`;
      }
      if (pType === "chapter-title") {
        afterHeading = true;
        return `    <h3 class="chapter-subtitle">${xmlEscape(p)}</h3>`;
      }
      if (pType === "section") {
        afterHeading = true;
        const anchor = makeUniqueAnchor(slugify(p), usedAnchors);
        return `    <h2 class="section-title" id="${anchor}">${xmlEscape(p)}</h2>`;
      }
      const cls = afterHeading ? ' class="no-indent"' : "";
      afterHeading = false;
      return `    <p${cls}>${xmlEscape(p)}</p>`;
    })
    .join("\n");
}

function makeEpubCSS(template: string, config?: TemplateConfig): string {
  const serif = `Georgia, "Palatino Linotype", "Book Antiqua", Palatino, serif`;
  const sans = `"Helvetica Neue", Arial, sans-serif`;

  const isSerifTemplate = ["modern-novel", "fantasy", "memoir"].includes(template);
  const bodyFont = isSerifTemplate ? serif : sans;
  const headFont = template === "non-fiction" ? sans : serif;
  const lineHeight = template === "memoir" ? "1.8" : template === "non-fiction" ? "1.5" : "1.65";
  const textAlign = template === "non-fiction" ? "left" : "justify";

  const chRules = config?.chapterTitleRules || getDefaultChapterTitleRules(template);
  const chFontSize = `${(chRules.fontSize / 11).toFixed(2)}em`;
  const chAlign = chRules.centered ? "center" : "left";
  const chWeight = chRules.bold ? "bold" : "normal";
  const chMarginTop = `${(chRules.spaceBefore / 16).toFixed(1)}em`;
  const chMarginBottom = `${(chRules.spaceAfter / 16).toFixed(1)}em`;

  return `/* BookFormatter Pro — EPUB Stylesheet */
@charset "UTF-8";

html, body {
  margin: 0;
  padding: 0;
}

body {
  font-family: ${bodyFont};
  font-size: 1em;
  line-height: ${lineHeight};
  color: #111;
  background: #fff;
  text-align: ${textAlign};
  -webkit-hyphens: auto;
  hyphens: auto;
}

h1, h2, h3, h4 {
  font-family: ${headFont};
  font-weight: ${chWeight};
  text-align: ${chAlign};
  margin: 2em 0 1em;
  page-break-after: avoid;
}

h1.chapter-title {
  font-size: ${chFontSize};
  font-weight: ${chWeight};
  text-align: ${chAlign};
  margin-top: ${chMarginTop};
  margin-bottom: ${chMarginBottom};
  letter-spacing: 0.02em;
}

h2.section-title {
  font-size: ${(chRules.fontSize * 0.75 / 11).toFixed(2)}em;
  font-weight: bold;
  text-align: left;
  margin-top: 1.2em;
  margin-bottom: 0.6em;
  letter-spacing: 0.01em;
}

h3.chapter-subtitle {
  font-size: ${(chRules.fontSize * 0.85 / 11).toFixed(2)}em;
  font-weight: bold;
  text-align: ${chAlign};
  margin-top: 0.2em;
  margin-bottom: ${chMarginBottom};
  letter-spacing: 0.01em;
}

p.scene-break {
  text-align: center;
  margin-top: 1.5em;
  margin-bottom: 1.5em;
  font-size: 1em;
  letter-spacing: 0.3em;
}

p {
  margin: 0;
  padding: 0;
  text-indent: 1.5em;
}

p.no-indent {
  text-indent: 0;
}

.title-page {
  text-align: center;
  margin-top: 4em;
}

.title-page h1 {
  font-size: 2em;
  margin-bottom: 0.4em;
}

.title-page .author {
  font-size: 1.2em;
  font-style: italic;
  margin-top: 0.5em;
}

.title-page .publisher {
  font-size: 0.85em;
  color: #555;
  margin-top: 3em;
}

hr.section-break {
  border: none;
  text-align: center;
  margin: 1.5em auto;
  width: 40%;
  border-top: 1px solid #999;
}
`;
}

function makeContentOpf(
  chapters: EpubChapter[],
  settings: ExportSettings,
  uid: string,
  isoDate: string
): string {
  const manifestItems = [
    `    <item id="titlepage" href="titlepage.xhtml" media-type="application/xhtml+xml"/>`,
    `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `    <item id="stylesheet" href="stylesheet.css" media-type="text/css"/>`,
    ...chapters.map(
      c => `    <item id="${c.id}" href="${c.id}.xhtml" media-type="application/xhtml+xml"/>`
    ),
  ].join("\n");

  const spineItems = [
    `    <itemref idref="titlepage"/>`,
    ...chapters.map(c => `    <itemref idref="${c.id}"/>`),
  ].join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf"
         version="3.0"
         unique-identifier="book-uid"
         xml:lang="en">

  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"
            xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="book-uid">${xmlEscape(uid)}</dc:identifier>
    <dc:title>${xmlEscape(settings.title)}</dc:title>
    <dc:creator id="author">${xmlEscape(settings.author)}</dc:creator>
    <dc:language>en</dc:language>
    <dc:publisher>BookFormatter Pro</dc:publisher>
    <meta property="dcterms:modified">${isoDate}</meta>
    <meta refines="#author" property="role" scheme="marc:relators">aut</meta>
  </metadata>

  <manifest>
${manifestItems}
  </manifest>

  <spine toc="ncx">
${spineItems}
  </spine>

  <guide>
    <reference type="title-page" title="Title Page" href="titlepage.xhtml"/>
    <reference type="toc" title="Table of Contents" href="nav.xhtml"/>
  </guide>

</package>`;
}

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

interface SectionAnchor {
  title: string;
  anchor: string;
}

function collectChapterSectionAnchors(chapter: EpubChapter): SectionAnchor[] {
  const paras = chapter.body.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  const used = new Set<string>();
  const result: SectionAnchor[] = [];
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    const pType = chapter.paraTypes && i < chapter.paraTypes.length ? chapter.paraTypes[i] : undefined;
    if (pType === "chapter-title") continue;
    const isSection = pType ? pType === "section" : isSectionHeading(p);
    if (isSection) {
      const anchor = makeUniqueAnchor(slugify(p), used);
      result.push({ title: p, anchor });
    }
  }
  return result;
}

function makeNavXhtml(chapters: EpubChapter[], settings: ExportSettings): string {
  const lines: string[] = [
    `      <li><a href="titlepage.xhtml">${xmlEscape(settings.title)}</a></li>`,
  ];

  for (const c of chapters) {
    const sections = collectChapterSectionAnchors(c);
    if (sections.length > 0) {
      lines.push(`      <li>`);
      lines.push(`        <a href="${c.id}.xhtml">${xmlEscape(c.title)}</a>`);
      lines.push(`        <ol>`);
      for (const s of sections) {
        lines.push(`          <li><a href="${c.id}.xhtml#${s.anchor}">${xmlEscape(s.title)}</a></li>`);
      }
      lines.push(`        </ol>`);
      lines.push(`      </li>`);
    } else {
      lines.push(`      <li><a href="${c.id}.xhtml">${xmlEscape(c.title)}</a></li>`);
    }
  }

  const tocItems = lines.join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:epub="http://www.idpf.org/2007/ops"
      xml:lang="en">
  <head>
    <meta charset="UTF-8"/>
    <title>Table of Contents</title>
    <link rel="stylesheet" type="text/css" href="stylesheet.css"/>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>Table of Contents</h1>
      <ol>
${tocItems}
      </ol>
    </nav>
  </body>
</html>`;
}

function makeTocNcx(chapters: EpubChapter[], settings: ExportSettings, uid: string): string {
  let playOrder = 1;
  const navPointLines: string[] = [
    `  <navPoint id="navpoint-0" playOrder="${playOrder++}">
    <navLabel><text>${xmlEscape(settings.title)}</text></navLabel>
    <content src="titlepage.xhtml"/>
  </navPoint>`,
  ];

  for (const c of chapters) {
    const sections = collectChapterSectionAnchors(c);
    if (sections.length > 0) {
      navPointLines.push(`  <navPoint id="navpoint-${playOrder}" playOrder="${playOrder}">`);
      playOrder++;
      navPointLines.push(`    <navLabel><text>${xmlEscape(c.title)}</text></navLabel>`);
      navPointLines.push(`    <content src="${c.id}.xhtml"/>`);
      for (const s of sections) {
        navPointLines.push(`    <navPoint id="navpoint-${playOrder}" playOrder="${playOrder}">`);
        playOrder++;
        navPointLines.push(`      <navLabel><text>${xmlEscape(s.title)}</text></navLabel>`);
        navPointLines.push(`      <content src="${c.id}.xhtml#${s.anchor}"/>`);
        navPointLines.push(`    </navPoint>`);
      }
      navPointLines.push(`  </navPoint>`);
    } else {
      navPointLines.push(`  <navPoint id="navpoint-${playOrder}" playOrder="${playOrder}">
    <navLabel><text>${xmlEscape(c.title)}</text></navLabel>
    <content src="${c.id}.xhtml"/>
  </navPoint>`);
      playOrder++;
    }
  }

  const navPoints = navPointLines.join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${xmlEscape(uid)}"/>
    <meta name="dtb:depth" content="2"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${xmlEscape(settings.title)}</text></docTitle>
  <docAuthor><text>${xmlEscape(settings.author)}</text></docAuthor>
  <navMap>
${navPoints}
  </navMap>
</ncx>`;
}

function makeTitlePageXhtml(settings: ExportSettings): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
  <head>
    <meta charset="UTF-8"/>
    <title>${xmlEscape(settings.title)}</title>
    <link rel="stylesheet" type="text/css" href="stylesheet.css"/>
  </head>
  <body>
    <div class="title-page">
      <h1>${xmlEscape(settings.title)}</h1>
      <p class="author no-indent">by ${xmlEscape(settings.author)}</p>
    </div>
  </body>
</html>`;
}

function makeChapterXhtml(chapter: EpubChapter, settings: ExportSettings): string {
  const bodyHtml = textToXhtmlParas(chapter.body, true, undefined, chapter.paraTypes);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
  <head>
    <meta charset="UTF-8"/>
    <title>${xmlEscape(chapter.title)}</title>
    <link rel="stylesheet" type="text/css" href="stylesheet.css"/>
  </head>
  <body>
    <h1 class="chapter-title">${xmlEscape(chapter.title)}</h1>
${bodyHtml || "    <p class=\"no-indent\"> </p>"}
  </body>
</html>`;
}

function makeEpubUid(title: string, author: string): string {
  const slug = `${title}-${author}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40);
  return `urn:bookformatter:${slug}-${Date.now()}`;
}

export async function generateEPUB(
  text: string,
  settings: ExportSettings,
  confirmedTypes?: ParagraphType[]
): Promise<Buffer> {
  const cfg = resolveTemplateConfig(settings);
  const parsed = parseEpubChapters(text, settings.title, settings.author, confirmedTypes);
  const chapters = parsed.chapters;

  const epubSettings: ExportSettings = {
    ...settings,
    title: parsed.displayTitle,
    author: parsed.displayAuthor,
  };

  const uid = makeEpubUid(epubSettings.title, epubSettings.author);
  const isoDate = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  const zip = new JSZip();

  zip.file("mimetype", "application/epub+zip", {
    compression: "STORE",
  });

  zip.file("META-INF/container.xml", CONTAINER_XML);

  zip.file("OEBPS/stylesheet.css", makeEpubCSS(epubSettings.template, cfg));
  zip.file("OEBPS/content.opf", makeContentOpf(chapters, epubSettings, uid, isoDate));
  zip.file("OEBPS/nav.xhtml", makeNavXhtml(chapters, epubSettings));
  zip.file("OEBPS/toc.ncx", makeTocNcx(chapters, epubSettings, uid));
  zip.file("OEBPS/titlepage.xhtml", makeTitlePageXhtml(epubSettings));

  for (const chapter of chapters) {
    zip.file(`OEBPS/${chapter.id}.xhtml`, makeChapterXhtml(chapter, epubSettings));
  }

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return buffer;
}

// ── Quick Convert generators ──────────────────────────────────────
// These intentionally skip ALL chapter detection, TOC, headers/footers,
// and template logic.  They produce the simplest valid output for each
// format — useful when the user just wants "convert my file now".

export async function generateQuickPDF(
  text: string,
  settings: ExportSettings
): Promise<Buffer> {
  const [pageW, pageH] = parseTrimPts(settings.trimSize);
  const margin = 72;

  const doc = new PDFDocument({
    size: [pageW, pageH],
    margins: { top: margin, bottom: margin, left: margin, right: margin },
    autoFirstPage: true,
    bufferPages: true,
    info: { Title: settings.title, Author: settings.author },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  const font      = "Times-Roman";
  const fontSize  = 11;
  const lineGap   = 5;
  const bodyWidth = pageW - margin * 2;

  doc.font(font).fontSize(fontSize).fillColor("#000");

  // Title block
  doc.fontSize(18).font("Times-Bold").text(settings.title, { align: "center" });
  if (settings.author) {
    doc.fontSize(12).font(font).moveDown(0.4).text(settings.author, { align: "center" });
  }
  doc.moveDown(1.5);
  doc.fontSize(fontSize).font(font);

  const paras = splitParagraphs(text);
  for (const para of paras) {
    if (!para.trim()) continue;
    doc.text(para, { align: "justify", lineGap, width: bodyWidth });
    doc.moveDown(0.6);
  }

  // Page numbers (requires bufferPages: true)
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.fontSize(8).font(font).fillColor("#555")
      .text(String(i + 1), margin, pageH - margin + 12, { width: bodyWidth, align: "center" });
  }

  doc.flushPages();
  doc.end();
  return await new Promise<Buffer>((resolve) =>
    doc.on("end", () => resolve(Buffer.concat(chunks)))
  );
}

export async function generateQuickDOCX(
  text: string,
  settings: ExportSettings
): Promise<Buffer> {
  const paras = splitParagraphs(text);

  const children: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: settings.title, bold: true, size: 36, font: "Times New Roman" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
    }),
    ...(settings.author
      ? [new Paragraph({
          children: [new TextRun({ text: settings.author, size: 24, font: "Times New Roman" })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 480 },
        })]
      : []),
    ...paras.map(
      (para) =>
        new Paragraph({
          children: [new TextRun({ text: para, size: 22, font: "Times New Roman" })],
          spacing: { after: 120, line: 360, lineRule: "auto" },
        })
    ),
  ];

  const doc = new Document({
    sections: [
      {
        children,
      },
    ],
    creator: settings.author || "BookFormatter Pro",
    title: settings.title,
  });

  return await Packer.toBuffer(doc);
}

export async function generateQuickEPUB(
  text: string,
  settings: ExportSettings
): Promise<Buffer> {
  const uid      = `bookformatter-quick-${Date.now()}`;
  const safeTitle = settings.title.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c)
  );
  const paras    = splitParagraphs(text);

  const contentXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${safeTitle}</title>
  <link rel="stylesheet" type="text/css" href="stylesheet.css"/>
</head>
<body>
  <section epub:type="chapter">
    <h1>${safeTitle}</h1>
    ${settings.author ? `<p class="author">${settings.author}</p>` : ""}
    ${paras.map((p) => `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`).join("\n    ")}
  </section>
</body>
</html>`;

  const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><meta charset="UTF-8"/><title>Navigation</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol><li><a href="content.xhtml">${safeTitle}</a></li></ol>
  </nav>
</body>
</html>`;

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${uid}</dc:identifier>
    <dc:title>${safeTitle}</dc:title>
    <dc:creator>${settings.author || "Unknown"}</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</meta>
  </metadata>
  <manifest>
    <item id="nav"  href="nav.xhtml"     media-type="application/xhtml+xml" properties="nav"/>
    <item id="css"  href="stylesheet.css" media-type="text/css"/>
    <item id="body" href="content.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="body"/>
  </spine>
</package>`;

  const css = `body { font-family: Georgia, serif; font-size: 1em; line-height: 1.6; margin: 1em; }
h1 { font-size: 1.6em; text-align: center; margin-bottom: 0.5em; }
p.author { text-align: center; font-style: italic; margin-bottom: 2em; }
p { margin: 0.4em 0; text-indent: 1.2em; }
p:first-of-type { text-indent: 0; }`;

  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);
  zip.file("OEBPS/content.opf", opf);
  zip.file("OEBPS/nav.xhtml", navXhtml);
  zip.file("OEBPS/stylesheet.css", css);
  zip.file("OEBPS/content.xhtml", contentXhtml);

  return await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}
