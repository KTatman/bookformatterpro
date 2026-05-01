import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ArrowRight, X, Trash2, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { useToast } from "@/hooks/use-toast";

const TAGS = [
  { value: "chapter", label: "Chapter / Intro / Conclusion Title", color: "#3b82f6", bg: "rgba(59,130,246,0.15)" },
  { value: "section", label: "Subchapter / Section", color: "#14b8a6", bg: "rgba(20,184,166,0.15)" },
  { value: "body", label: "Body", color: "#6b7280", bg: "rgba(107,114,128,0.12)" },
] as const;

const TAG_MAP = Object.fromEntries(TAGS.map(t => [t.value, t]));

const LEGACY_MAP: Record<string, string> = {
  "chapter-label": "chapter",
  "chapter-title": "chapter",
  "introduction": "chapter",
  "title": "chapter",
  "author": "body",
  "front-matter": "body",
  "scene-break": "body",
};
function normType(t: string): string { return LEGACY_MAP[t] || t; }

interface StructureEntry {
  id: string;
  start: number;
  end: number;
  text: string;
  type: string;
}

interface HighlightPart {
  text: string;
  ftStart: number;
  type?: string;
  entryId?: string;
}

interface Props {
  projectId: string;
  onConfirm: () => void;
  onBack: () => void;
  onLoadConfirmed?: (c: boolean) => void;
}

let _id = 0;
function uid() { return `se-${++_id}-${Date.now()}`; }

function findOffsetInFullText(
  node: Node,
  offsetInNode: number,
  container: HTMLElement
): number | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => {
      const el = n as HTMLElement;
      if (el.hasAttribute("data-ft-start")) return NodeFilter.FILTER_ACCEPT;
      return NodeFilter.FILTER_SKIP;
    },
  });

  let current: Node | null = walker.nextNode();
  while (current) {
    const el = current as HTMLElement;
    if (el.contains(node)) {
      const ftStart = parseInt(el.getAttribute("data-ft-start") || "0", 10);
      const textNode = el.firstChild;
      if (textNode && (textNode === node || textNode.contains(node))) {
        return ftStart + offsetInNode;
      }
      let charCount = 0;
      const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let tn: Node | null = tw.nextNode();
      while (tn) {
        if (tn === node) {
          return ftStart + charCount + offsetInNode;
        }
        charCount += (tn.textContent || "").length;
        tn = tw.nextNode();
      }
      return ftStart + offsetInNode;
    }
    current = walker.nextNode();
  }
  return null;
}

export default function StructureReview({ projectId, onConfirm, onBack, onLoadConfirmed }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fullText, setFullText] = useState("");
  const [entries, setEntries] = useState<StructureEntry[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);

  const [pendingSel, setPendingSel] = useState<{ start: number; end: number; text: string } | null>(null);
  const [floatingPos, setFloatingPos] = useState<{ x: number; y: number } | null>(null);

  const parseParagraphs = useCallback((paragraphs: any[], ft: string) => {
    const ents: StructureEntry[] = [];
    let cursor = 0;
    for (const p of paragraphs) {
      const nt = normType(p.type);
      if (nt === "body") {
        const idx = ft.indexOf(p.text, cursor);
        if (idx >= 0) cursor = idx + p.text.length;
        continue;
      }
      const idx = ft.indexOf(p.text, cursor);
      if (idx >= 0) {
        ents.push({ id: uid(), start: idx, end: idx + p.text.length, text: p.text, type: nt });
        cursor = idx + p.text.length;
      } else {
        const fallback = ft.indexOf(p.text);
        if (fallback >= 0) {
          ents.push({ id: uid(), start: fallback, end: fallback + p.text.length, text: p.text, type: nt });
        }
      }
    }
    return ents;
  }, []);

  const fetchStructure = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch(`/api/projects/${projectId}/structure`);
      if (!r.ok) throw new Error("Failed to load structure");
      const d = await r.json();
      setFullText(d.fullText || "");
      setConfirmed(d.confirmed);
      if (onLoadConfirmed) onLoadConfirmed(d.confirmed);
      if (d.paragraphs && d.paragraphs.length > 0) {
        setEntries(parseParagraphs(d.paragraphs, d.fullText || ""));
      } else {
        setEntries([]);
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    } finally {
      setLoading(false);
    }
  }, [projectId, toast, onLoadConfirmed, parseParagraphs]);

  useEffect(() => { fetchStructure(); }, [fetchStructure]);

  const applyAiSuggestions = useCallback(async () => {
    setAiLoading(true);
    try {
      const r = await apiFetch(`/api/projects/${projectId}/structure?aidetect=1`);
      if (!r.ok) throw new Error("Failed to run AI detection");
      const d = await r.json();
      const ft = d.fullText || fullText;
      if (d.paragraphs && d.paragraphs.length > 0) {
        setEntries(parseParagraphs(d.paragraphs, ft));
        setConfirmed(false);
        toast({ title: "AI Suggestions Applied", description: "Review and adjust the detected tags as needed." });
      } else {
        toast({ title: "No Structure Detected", description: "AI could not identify any chapter or section headings." });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
    } finally {
      setAiLoading(false);
    }
  }, [projectId, fullText, toast, parseParagraphs]);

  const handleTextMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !textRef.current) {
      setPendingSel(null);
      setFloatingPos(null);
      return;
    }

    const range = sel.getRangeAt(0);
    if (!textRef.current.contains(range.commonAncestorContainer)) {
      setPendingSel(null);
      setFloatingPos(null);
      return;
    }

    const startOffset = findOffsetInFullText(range.startContainer, range.startOffset, textRef.current);
    const endOffset = findOffsetInFullText(range.endContainer, range.endOffset, textRef.current);

    if (startOffset === null || endOffset === null || startOffset >= endOffset) {
      setPendingSel(null);
      setFloatingPos(null);
      return;
    }

    const selectedText = fullText.slice(startOffset, endOffset);
    if (selectedText.trim().length === 0) {
      setPendingSel(null);
      setFloatingPos(null);
      return;
    }

    const overlaps = entries.some(e => startOffset < e.end && endOffset > e.start);
    if (overlaps) {
      toast({ title: "Selection overlaps an existing tag", description: "Remove the overlapping tag first." });
      setPendingSel(null);
      setFloatingPos(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    setFloatingPos({ x: rect.left + rect.width / 2, y: rect.top - 8 });
    setPendingSel({ start: startOffset, end: endOffset, text: selectedText });
  }, [entries, fullText, toast]);

  const applyTag = useCallback((tagValue: string) => {
    if (!pendingSel) return;
    const newEntry: StructureEntry = {
      id: uid(),
      start: pendingSel.start,
      end: pendingSel.end,
      text: pendingSel.text,
      type: tagValue,
    };
    setEntries(prev => [...prev, newEntry].sort((a, b) => a.start - b.start));
    setConfirmed(false);
    setPendingSel(null);
    setFloatingPos(null);
    window.getSelection()?.removeAllRanges();
  }, [pendingSel]);

  const removeEntry = useCallback((id: string) => {
    setEntries(prev => prev.filter(e => e.id !== id));
    setConfirmed(false);
    setPendingSel(null);
    setFloatingPos(null);
  }, []);

  const changeEntryType = useCallback((id: string, newType: string) => {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, type: newType } : e));
    setConfirmed(false);
  }, []);

  const clearAll = useCallback(() => {
    setEntries([]);
    setConfirmed(false);
    setPendingSel(null);
    setFloatingPos(null);
  }, []);

  const entriesToParagraphs = useCallback(() => {
    if (entries.length === 0) {
      return [{ text: fullText, type: "body" }];
    }
    const sorted = [...entries].sort((a, b) => a.start - b.start);
    const result: { text: string; type: string }[] = [];
    let cursor = 0;
    for (const e of sorted) {
      if (e.start > cursor) {
        const gap = fullText.slice(cursor, e.start).trim();
        if (gap) result.push({ text: gap, type: "body" });
      }
      result.push({ text: e.text, type: e.type });
      cursor = e.end;
    }
    if (cursor < fullText.length) {
      const tail = fullText.slice(cursor).trim();
      if (tail) result.push({ text: tail, type: "body" });
    }
    return result;
  }, [entries, fullText]);

  const doConfirm = async () => {
    setSaving(true);
    try {
      const paragraphs = entriesToParagraphs();
      const r = await apiFetch(`/api/projects/${projectId}/structure`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paragraphs }),
      });
      if (!r.ok) throw new Error("Failed to save");
      setConfirmed(true);
      toast({ title: "Structure Confirmed", description: "Your manuscript structure has been saved." });
      onConfirm();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Save Failed", description: err.message });
    } finally { setSaving(false); }
  };

  const stats = useMemo(() => {
    const c: Record<string, number> = {};
    entries.forEach(e => { c[e.type] = (c[e.type] || 0) + 1; });
    return c;
  }, [entries]);

  const highlightedParts = useMemo((): HighlightPart[] => {
    if (!fullText) return [];
    const sorted = [...entries].sort((a, b) => a.start - b.start);
    const parts: HighlightPart[] = [];
    let cursor = 0;
    for (const e of sorted) {
      if (e.start > cursor) {
        parts.push({ text: fullText.slice(cursor, e.start), ftStart: cursor });
      }
      parts.push({ text: fullText.slice(e.start, e.end), ftStart: e.start, type: e.type, entryId: e.id });
      cursor = e.end;
    }
    if (cursor < fullText.length) {
      parts.push({ text: fullText.slice(cursor), ftStart: cursor });
    }
    return parts;
  }, [fullText, entries]);

  useEffect(() => {
    const dismiss = (e: MouseEvent) => {
      if (!pendingSel) return;
      const target = e.target as HTMLElement;
      if (target.closest("[data-floating-toolbar]")) return;
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) {
          setPendingSel(null);
          setFloatingPos(null);
        }
      }, 100);
    };
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [pendingSel]);

  if (loading) {
    return (
      <Card className="border-border/50 shadow-sm">
        <CardContent className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-3 text-muted-foreground">Loading manuscript…</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 shadow-sm overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="text-2xl font-serif" data-testid="text-structure-title">
          Map Your Manuscript Structure
        </CardTitle>
        <CardDescription className="text-sm leading-relaxed">
          {confirmed
            ? "Your structure is confirmed. You can still edit tags before exporting."
            : "Highlight text in the manuscript, then choose a tag. Your tags control chapter headings, TOC, and all export formatting."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap" data-testid="tag-toolbar">
          <div className="flex items-center gap-1.5">
            {TAGS.filter(t => t.value !== "body").map(t => (
              <span
                key={t.value}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full"
                style={{ backgroundColor: t.bg, color: t.color, border: `1px solid ${t.color}30` }}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: t.color }} />
                {t.label}
              </span>
            ))}
          </div>
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={applyAiSuggestions}
            disabled={aiLoading}
            data-testid="button-ai-suggest"
          >
            {aiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {aiLoading ? "Detecting…" : "AI Auto-detect"}
          </Button>
          {entries.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
              onClick={clearAll}
              data-testid="button-clear-all"
            >
              <Trash2 className="h-3 w-3" /> Clear All
            </Button>
          )}
        </div>

        {entries.length > 0 && (
          <div className="flex flex-wrap gap-1.5 text-xs" data-testid="structure-stats">
            {TAGS.filter(t => stats[t.value]).map(t => (
              <span
                key={t.value}
                className="px-2 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: t.bg, color: t.color }}
              >
                {stats[t.value]} {t.label}
              </span>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 border rounded-lg overflow-hidden relative">
            <div className="bg-muted/30 px-3 py-2 border-b text-xs text-muted-foreground font-medium flex items-center gap-2">
              <span>Manuscript</span>
              <span className="text-[10px] opacity-60">— highlight text, then pick a tag</span>
            </div>
            <div
              ref={textRef}
              className="p-4 max-h-[600px] overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap cursor-text font-serif selection:bg-blue-200/60 dark:selection:bg-blue-800/40"
              onMouseUp={handleTextMouseUp}
              data-testid="manuscript-text"
            >
              {highlightedParts.map((part, i) => {
                if (!part.type) {
                  return <span key={i} data-ft-start={part.ftStart}>{part.text}</span>;
                }
                const tag = TAG_MAP[part.type];
                return (
                  <mark
                    key={i}
                    data-ft-start={part.ftStart}
                    className="rounded px-0.5 cursor-pointer transition-colors"
                    style={{
                      backgroundColor: tag?.bg || "rgba(107,114,128,0.12)",
                      borderBottom: `2px solid ${tag?.color || "#6b7280"}`,
                      color: tag?.color || "#6b7280",
                    }}
                    title={`${tag?.label || part.type} — click to remove`}
                    onClick={() => part.entryId && removeEntry(part.entryId)}
                    data-testid={`highlight-${part.entryId}`}
                  >
                    {part.text}
                  </mark>
                );
              })}
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <div className="bg-muted/30 px-3 py-2 border-b text-xs text-muted-foreground font-medium">
              Tagged Sections ({entries.length})
            </div>
            <div className="max-h-[600px] overflow-y-auto divide-y" data-testid="entries-list">
              {entries.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  <div className="text-3xl mb-3 opacity-30">📝</div>
                  <p className="font-medium mb-1">No tags yet</p>
                  <p className="text-xs leading-relaxed">Highlight text in the manuscript, then choose a tag from the popup that appears.</p>
                  <p className="text-xs leading-relaxed mt-2 opacity-75">Or click <strong>AI Auto-detect</strong> to get started quickly.</p>
                </div>
              ) : (
                entries.map(e => {
                  const tag = TAG_MAP[e.type];
                  return (
                    <div key={e.id} className="px-3 py-2 hover:bg-muted/30 transition-colors group" data-testid={`entry-${e.id}`}>
                      <div className="flex items-start gap-2">
                        <select
                          value={e.type}
                          onChange={ev => changeEntryType(e.id, ev.target.value)}
                          className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded border-0 outline-none cursor-pointer"
                          style={{ backgroundColor: tag?.bg, color: tag?.color }}
                          data-testid={`select-entry-type-${e.id}`}
                        >
                          {TAGS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                        <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate leading-snug mt-0.5">
                          {e.text.length > 80 ? e.text.slice(0, 80) + "…" : e.text}
                        </span>
                        <button
                          onClick={() => removeEntry(e.id)}
                          className="shrink-0 p-0.5 rounded text-muted-foreground/40 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Remove tag"
                          data-testid={`remove-entry-${e.id}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          <strong>How it works:</strong> Highlight text in the manuscript, then pick a tag from the popup.
          Everything you don't tag is treated as body text. Only tagged chapter titles and sections get heading styling in exports.
        </p>
      </CardContent>

      <CardFooter className="flex justify-between border-t pt-6">
        <Button variant="ghost" onClick={onBack} data-testid="button-structure-back">Back</Button>
        <Button onClick={doConfirm} disabled={saving} className="gap-2" data-testid="button-confirm-structure">
          {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
            : <>{confirmed ? "Update & Continue" : "Confirm & Continue"} <ArrowRight className="h-4 w-4" /></>}
        </Button>
      </CardFooter>

      {pendingSel && floatingPos && (
        <div
          data-floating-toolbar
          className="fixed z-50 flex items-center gap-1 bg-popover border rounded-lg shadow-lg px-1.5 py-1 animate-in fade-in zoom-in-95"
          style={{
            left: `${floatingPos.x}px`,
            top: `${floatingPos.y}px`,
            transform: "translate(-50%, -100%)",
          }}
          data-testid="floating-tag-toolbar"
        >
          {TAGS.filter(t => t.value !== "body").map(t => (
            <button
              key={t.value}
              onClick={() => applyTag(t.value)}
              className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md transition-all hover:scale-105 whitespace-nowrap"
              style={{ backgroundColor: t.bg, color: t.color, border: `1px solid ${t.color}40` }}
              data-testid={`float-tag-${t.value}`}
            >
              {t.label}
            </button>
          ))}
          <button
            onClick={() => { setPendingSel(null); setFloatingPos(null); window.getSelection()?.removeAllRanges(); }}
            className="p-1 rounded text-muted-foreground hover:text-destructive"
            data-testid="float-tag-cancel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </Card>
  );
}
