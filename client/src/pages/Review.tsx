import { useState, useEffect } from "react";
import { Link, useParams } from "wouter";
import { apiFetch } from "@/lib/apiFetch";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Check, X, ChevronLeft, AlertCircle, Wand2, Type, Loader2, RefreshCw } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";

interface Suggestion {
  id: string;
  original_text: string;
  suggested_text: string;
  reason: string | null;
  type: string | null;
  context_before: string | null;
  context_after: string | null;
  status: string;
}

function Sparkles({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/>
      <path d="M19 3l.8 2.2L22 6l-2.2.8L19 9l-.8-2.2L16 6l2.2-.8z"/>
    </svg>
  );
}

export default function Review() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [pendingIndex, setPendingIndex] = useState(0); // index within pendingSuggestions
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [projectTitle, setProjectTitle] = useState("Your Manuscript");

  useEffect(() => {
    if (id) fetchSuggestions();
  }, [id]);

  const fetchSuggestions = async () => {
    setIsLoading(true);
    try {
      const response = await apiFetch(`/api/projects/${id}/corrections`);
      if (!response.ok) throw new Error("Failed to fetch corrections");
      const data = await response.json();
      setSuggestions(data.corrections || []);
      setProjectTitle(data.projectTitle || "Your Manuscript");
    } catch (err) {
      console.error(err);
      toast({ variant: "destructive", title: "Error loading suggestions", description: "Could not load AI suggestions from server." });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAction = async (action: "accepted" | "rejected") => {
    const current = pendingSuggestions[pendingIndex];
    if (!current) return;

    setIsSaving(true);
    try {
      await apiFetch(`/api/corrections/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: action }),
      });

      setResolvedIds(prev => new Set([...prev, current.id]));
      // pendingIndex stays the same — after resolving, the next item slides into that slot.
      // If this was the last item, pendingIndex will be out-of-bounds and isComplete will trigger.

      toast({
        title: action === "accepted" ? "Suggestion Accepted" : "Original Kept",
        description: action === "accepted"
          ? "The AI suggestion will be applied to your manuscript."
          : "Your original text has been preserved.",
      });
    } catch (err) {
      toast({ variant: "destructive", title: "Error saving decision" });
    } finally {
      setIsSaving(false);
    }
  };

  const pendingSuggestions = suggestions.filter(s => !resolvedIds.has(s.id));
  const resolvedCount = resolvedIds.size;
  const total = suggestions.length;
  const progress = total > 0 ? (resolvedCount / total) * 100 : 0;
  const safePendingIndex = Math.min(pendingIndex, Math.max(0, pendingSuggestions.length - 1));
  const currentItem = pendingSuggestions[safePendingIndex];
  const isComplete = total > 0 && resolvedCount === total;

  const typeLabel: Record<string, { label: string; color: string }> = {
    grammar: { label: "Grammar Issue", color: "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800" },
    "run-on": { label: "Run-on Sentence", color: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800" },
    clarity: { label: "Clarity Suggestion", color: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800" },
  };

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      <header className="border-b bg-card px-4 py-3 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-4">
          <Link href={`/project/${id}`}>
            <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground">
              <ChevronLeft className="h-4 w-4" /> Back to Project
            </Button>
          </Link>
          <Separator orientation="vertical" className="h-6" />
          <div className="flex items-center gap-2 text-primary font-medium">
            <Wand2 className="h-5 w-5" />
            <span>AI Review Mode</span>
          </div>
        </div>

        <div className="flex items-center gap-4 w-1/3 max-w-xs">
          {!isLoading && total > 0 && (
            <div className="flex-1">
              <div className="flex justify-between text-xs mb-1 font-medium text-muted-foreground">
                <span>Progress</span>
                <span>{resolvedCount} / {total}</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center py-12 px-4 bg-muted/10">
        <div className="w-full max-w-4xl">

          {isLoading ? (
            <Card className="p-16 flex flex-col items-center justify-center text-center bg-card border-border/60 shadow-sm">
              <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
              <h2 className="text-2xl font-serif font-bold mb-2">Loading AI Suggestions</h2>
              <p className="text-muted-foreground">Fetching review items for <strong>{projectTitle}</strong>...</p>
            </Card>
          ) : total === 0 ? (
            <Card className="p-12 text-center flex flex-col items-center justify-center bg-card shadow-lg border-green-200 dark:border-green-900">
              <div className="h-24 w-24 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-6">
                <Check className="h-12 w-12" />
              </div>
              <h2 className="text-3xl font-serif font-bold mb-4">No Suggestions Found!</h2>
              <p className="text-lg text-muted-foreground mb-8 max-w-md">
                The AI didn't find any grammar, run-on, or clarity issues that need your review. Your manuscript looks great!
              </p>
              <div className="flex gap-4">
                <Button variant="outline" onClick={fetchSuggestions} className="gap-2">
                  <RefreshCw className="h-4 w-4" /> Refresh
                </Button>
                <Link href={`/project/${id}`}>
                  <Button size="lg" className="rounded-full px-8">Continue to Export</Button>
                </Link>
              </div>
            </Card>
          ) : isComplete ? (
            <Card className="p-12 text-center flex flex-col items-center justify-center bg-card shadow-lg border-primary/20">
              <div className="h-24 w-24 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-6">
                <Check className="h-12 w-12" />
              </div>
              <h2 className="text-3xl font-serif font-bold mb-4">Review Complete!</h2>
              <p className="text-lg text-muted-foreground mb-8 max-w-md">
                You've reviewed all {total} AI suggestions. Your manuscript has been updated while preserving your unique voice.
              </p>
              <Link href={`/project/${id}`}>
                <Button size="lg" className="rounded-full px-8">Continue to Export</Button>
              </Link>
            </Card>
          ) : currentItem ? (
            <>
              <div className="flex justify-between items-end mb-6">
                <div>
                  <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold uppercase tracking-wider mb-3 border ${(typeLabel[currentItem.type ?? ""] || typeLabel.clarity).color}`}>
                    <AlertCircle className="h-3.5 w-3.5" />
                    {(typeLabel[currentItem.type ?? ""] || { label: currentItem.type || "Suggestion" }).label}
                  </div>
                  <h2 className="text-sm font-medium text-muted-foreground">
                    {pendingSuggestions.length} suggestion{pendingSuggestions.length !== 1 ? "s" : ""} remaining
                  </h2>
                </div>
                <div className="text-sm text-muted-foreground flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={safePendingIndex === 0}
                    onClick={() => setPendingIndex(i => Math.max(0, i - 1))}
                    data-testid="button-previous-suggestion"
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={safePendingIndex >= pendingSuggestions.length - 1}
                    onClick={() => setPendingIndex(i => Math.min(pendingSuggestions.length - 1, i + 1))}
                    data-testid="button-skip-suggestion"
                  >
                    Skip
                  </Button>
                </div>
              </div>

              <Card className="bg-card shadow-lg border-border/60 overflow-hidden mb-8">
                <div className="p-8 bg-zinc-50 dark:bg-zinc-950 font-serif text-lg leading-loose text-zinc-600 dark:text-zinc-400 border-b border-border/40 relative">
                  <div className="absolute top-4 right-4 text-xs font-sans text-muted-foreground opacity-50 flex items-center gap-1">
                    <Type className="h-3 w-3" /> Original Text
                  </div>
                  {currentItem.context_before && (
                    <p className="mb-2 opacity-60 text-base">... {currentItem.context_before}</p>
                  )}
                  <p className="py-2 px-1 -mx-1 bg-red-100/50 dark:bg-red-900/20 text-red-900 dark:text-red-200 rounded line-through decoration-red-400/50 decoration-2">
                    {currentItem.original_text}
                  </p>
                  {currentItem.context_after && (
                    <p className="mt-2 opacity-60 text-base">{currentItem.context_after} ...</p>
                  )}
                </div>

                <div className="p-8 bg-card relative">
                  <div className="absolute top-0 left-8 -translate-y-1/2 bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 text-xs font-bold px-3 py-1 rounded-full border border-green-200 dark:border-green-800 shadow-sm flex items-center gap-1">
                    <Sparkles className="h-3 w-3" /> AI Suggestion
                  </div>
                  <p className="font-serif text-xl leading-loose text-foreground py-2 px-4 -mx-1 bg-green-50/50 dark:bg-green-900/10 rounded border-l-4 border-green-500 mt-2">
                    {currentItem.suggested_text}
                  </p>
                  {currentItem.reason && (
                    <div className="mt-6 bg-muted/50 p-4 rounded-lg text-sm text-muted-foreground border">
                      <strong>AI Note:</strong> {currentItem.reason}
                    </div>
                  )}
                </div>
              </Card>

              <div className="flex items-center justify-center gap-4">
                <Button
                  size="lg"
                  variant="outline"
                  disabled={isSaving}
                  className="h-16 px-8 rounded-full border-2 hover:bg-red-50 hover:text-red-600 hover:border-red-200 dark:hover:bg-red-950/30 dark:hover:border-red-900 transition-colors text-base"
                  onClick={() => handleAction("rejected")}
                >
                  {isSaving ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <X className="mr-2 h-5 w-5" />}
                  Keep Original
                </Button>

                <Button
                  size="lg"
                  disabled={isSaving}
                  className="h-16 px-8 rounded-full shadow-lg bg-green-600 hover:bg-green-700 text-white text-base transition-transform hover:scale-105 active:scale-95"
                  onClick={() => handleAction("accepted")}
                >
                  {isSaving ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Check className="mr-2 h-5 w-5" />}
                  Accept Suggestion
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}
