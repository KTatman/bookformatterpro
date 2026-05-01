import { useState, useRef, useEffect, useCallback } from "react";
import { Link, useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  UploadCloud, LayoutTemplate, Sparkles, Download,
  CheckCircle2, ChevronLeft, ArrowRight, AlertCircle,
  Loader2, FileText, BookOpen, RefreshCw, XCircle, Play,
  ListTree, Zap,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { apiFetch } from "@/lib/apiFetch";
import StructureReview from "@/components/StructureReview";

// Terminal statuses — polling stops when we see one of these
const TERMINAL_STATUSES = new Set(["Review Required", "Completed", "failed", "Draft"]);
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes — enough for 150K-word books

import { TEMPLATES, TemplatePreviewSpread, type TemplateDef } from "@/components/TemplatePreview";


const TRIM_SIZES = [
  '5" × 8" (Trade Paperback)',
  '5.25" × 8"',
  '5.5" × 8.5" (Digest)',
  '6" × 9" (US Trade)',
];

const PRINT_TARGETS = [
  "Amazon KDP Print",
  "IngramSpark",
  "Barnes & Noble Press",
  "Generic PDF",
];

export default function Project() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // ── Core state ─────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState("upload");
  const [hasFile, setHasFile]     = useState(false);
  const [isUploading, setIsUploading]   = useState(false);
  const [isSavingMeta, setIsSavingMeta] = useState(false);

  // Processing state (only active after user explicitly starts pipeline)
  const [isProcessing, setIsProcessing]           = useState(false);
  const [processingTimedOut, setProcessingTimedOut] = useState(false);
  const [aiError, setAiError]                     = useState<string | null>(null);
  const [needsReupload, setNeedsReupload]         = useState(false);
  const [suggestionsCount, setSuggestionsCount]   = useState<number | null>(null);
  const [processingProgress, setProcessingProgress] = useState<number | null>(null);

  // Project metadata
  const [projectId, setProjectId]       = useState<string | null>(id && id !== "new" ? id : null);
  const [projectTitle, setProjectTitle] = useState("");
  const [authorName, setAuthorName]     = useState("");
  const [fileName, setFileName]         = useState("");
  const [wordCount, setWordCount]       = useState<number | null>(null);

  // Template / format options
  const [selectedTemplate, setSelectedTemplate] = useState("modern-novel");
  const [selectedTrimSize, setSelectedTrimSize] = useState(TRIM_SIZES[0]);
  const [selectedTarget, setSelectedTarget]     = useState(PRINT_TARGETS[0]);

  const [tocEnabled, setTocEnabled]                     = useState(false);
  const [tocTitle, setTocTitle]                         = useState("Table of Contents");
  const [tocIncludeFrontMatter, setTocIncludeFrontMatter] = useState(false);
  const [tocNewPage, setTocNewPage]                     = useState(true);
  const [tocDepth, setTocDepth]                         = useState(1);
  const tocDefaultsApplied = useRef<string | null>(null);

  useEffect(() => {
    if (tocDefaultsApplied.current === selectedTemplate) return;
    tocDefaultsApplied.current = selectedTemplate;
    const isNonFiction = /non-?fiction|manual|guide|academic|textbook|cookbook/i.test(selectedTemplate);
    setTocEnabled(isNonFiction);
    setTocTitle("Table of Contents");
    setTocIncludeFrontMatter(false);
    setTocNewPage(true);
    setTocDepth(1);
  }, [selectedTemplate]);

  // Workflow mode: "full" = AI proofreading + structure; "quick" = instant convert
  const [workflowMode, setWorkflowMode] = useState<"full" | "quick">("full");

  // Auto-fix toggles (sent as context to the AI — all on by default)
  const [fixSpacing, setFixSpacing]         = useState(true);
  const [fixCapitalization, setFixCapitalization] = useState(true);
  const [fixPunctuation, setFixPunctuation] = useState(true);
  const [fixTypos, setFixTypos]             = useState(true);
  const proofMode = "full" as const;

  // Structure review state
  const [structureConfirmed, setStructureConfirmed] = useState(false);

  // Export state
  const [downloadingFormat, setDownloadingFormat] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess]         = useState<Record<string, boolean>>({});
  const [exportError, setExportError]             = useState<Record<string, string>>({});

  const fileInputRef       = useRef<HTMLInputElement>(null);
  const titleInputRef      = useRef<HTMLInputElement>(null);
  const pollIntervalRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef     = useRef<ReturnType<typeof setTimeout>  | null>(null);
  // Prevents loadExistingProject from auto-advancing tabs right after a fresh upload
  const justUploadedRef    = useRef(false);

  // ── Polling ────────────────────────────────────────────────────
  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
    if (pollTimeoutRef.current)  { clearTimeout(pollTimeoutRef.current);   pollTimeoutRef.current  = null; }
  }, []);

  useEffect(() => {
    if (id && id !== "new") loadExistingProject(id);
    return stopPolling;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // After a fresh upload completes, focus the title field so the user
  // can immediately type without clicking
  useEffect(() => {
    if (hasFile && !isUploading && activeTab === "upload") {
      // Small delay so the DOM has rendered the input
      const t = setTimeout(() => titleInputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [hasFile, isUploading, activeTab]);

  const fetchSuggestionsCount = useCallback(async (pid: string) => {
    try {
      const res  = await apiFetch(`/api/projects/${pid}/corrections`);
      if (!res.ok) return;
      const data = await res.json();
      setSuggestionsCount(data.corrections?.length ?? 0);
    } catch { /* ignore */ }
  }, []);

  const handleTerminalStatus = useCallback(
    (status: string, error: string | null, pid: string) => {
      stopPolling();
      setIsProcessing(false);

      if (status === "Review Required") {
        fetchSuggestionsCount(pid);
        toast({ title: "AI Proofreading Complete", description: "Suggestions are ready for your review." });
      } else if (status === "Completed") {
        setSuggestionsCount(0);
        toast({ title: "Processing Complete", description: "No review items found. You're ready to export!" });
      } else if (status !== "Draft") {
        const msg = error || "The AI pipeline encountered an unexpected error.";
        setAiError(msg);
        toast({ variant: "destructive", title: "AI Processing Failed", description: msg });
      }
    },
    [stopPolling, fetchSuggestionsCount, toast]
  );

  const startPolling = useCallback(
    (pid: string) => {
      stopPolling();
      setProcessingTimedOut(false);
      setAiError(null);

      pollTimeoutRef.current = setTimeout(() => {
        stopPolling();
        setIsProcessing(false);
        setProcessingTimedOut(true);
        toast({
          variant: "destructive",
          title: "Processing is taking too long",
          description: "The AI job may still be running in the background. Refresh in a few minutes to check.",
        });
      }, POLL_TIMEOUT_MS);

      pollIntervalRef.current = setInterval(async () => {
        try {
          const res  = await apiFetch(`/api/projects/${pid}/status`);
          if (!res.ok) return;
          const data: { status: string; ai_error?: string; processing_progress?: number } = await res.json();
          if (data.processing_progress != null) {
            setProcessingProgress(data.processing_progress);
          }
          if (TERMINAL_STATUSES.has(data.status)) {
            setProcessingProgress(100);
            handleTerminalStatus(data.status, data.ai_error ?? null, pid);
          }
        } catch { /* swallow network errors */ }
      }, POLL_INTERVAL_MS);
    },
    [stopPolling, handleTerminalStatus, toast]
  );

  // ── Load existing project ─────────────────────────────────────
  const loadExistingProject = async (pid: string) => {
    try {
      const res = await apiFetch(`/api/projects/${pid}`);
      if (!res.ok) return;
      const { project: p } = await res.json();
      if (!p) return;

      setProjectTitle(p.title || "");
      setAuthorName(p.author_name || "");
      setFileName(p.original_filename || "");
      setWordCount(p.word_count ?? null);
      setHasFile(true);

      if (p.status === "Draft") {
        if (justUploadedRef.current) {
          // User just uploaded in this session — stay on upload tab so they
          // can review/edit the title and author name before continuing.
          justUploadedRef.current = false;
        } else {
          // Returning user who previously uploaded — drop them on template tab.
          setActiveTab("template");
        }
      } else if (p.status === "processing") {
        setActiveTab("ai");
        setIsProcessing(true);
        startPolling(pid);
      } else if (TERMINAL_STATUSES.has(p.status)) {
        setActiveTab("ai");
        handleTerminalStatus(p.status, p.ai_error ?? null, pid);
      }
    } catch (err) {
      console.error("Error loading project:", err);
    }
  };

  // ── Step 1: Handle file upload ─────────────────────────────────
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setFileName(file.name);
    setNeedsReupload(false);
    setAiError(null);

    const derivedTitle = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
    if (!projectTitle) setProjectTitle(derivedTitle);

    try {
      const formData = new FormData();
      formData.append("manuscript", file);
      formData.append("title", projectTitle || derivedTitle);
      formData.append("author_name", authorName);

      const res = await apiFetch("/api/projects/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Upload failed");
      }

      const data = await res.json();
      setProjectId(data.projectId);
      setWordCount(data.wordCount ?? null);
      setHasFile(true);

      // Update the URL so a page refresh restores the project, but mark that
      // we just uploaded so loadExistingProject doesn't auto-advance to template.
      if (id === "new") {
        justUploadedRef.current = true;
        navigate(`/project/${data.projectId}`, { replace: true });
      }

      toast({
        title: "File Uploaded",
        description: "Review your title and author name below, then click Continue when you're ready.",
      });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Upload Failed", description: err.message });
    } finally {
      setIsUploading(false);
    }
  };

  // ── Step 2: Save title/author and go to template tab ──────────
  const handleContinueToTemplate = async () => {
    if (!projectId) { setActiveTab("template"); return; }
    setIsSavingMeta(true);
    try {
      await apiFetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: projectTitle, author_name: authorName }),
      });
    } catch { /* non-fatal */ }
    setIsSavingMeta(false);
    setActiveTab("template");
  };

  // ── Step 3: Save template choices and advance ─────────────────
  const handleContinueToAI = async () => {
    if (projectId) {
      try {
        await apiFetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ genre: selectedTemplate, trim_size: selectedTrimSize, output_target: selectedTarget }),
        });
      } catch { /* non-fatal */ }
    }
    if (workflowMode === "quick") {
      setActiveTab("export");
    } else {
      setActiveTab("ai");
    }
  };

  // ── Step 4: Trigger AI pipeline ───────────────────────────────
  const handleStartProcessing = async () => {
    if (!projectId) return;
    setAiError(null);
    setNeedsReupload(false);
    setIsProcessing(true);

    try {
      const res = await apiFetch(`/api/projects/${projectId}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: proofMode }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.needsReupload) {
          setIsProcessing(false);
          setNeedsReupload(true);
          toast({
            variant: "destructive",
            title: "Please Re-upload Your File",
            description: "The server was restarted and your file is no longer available. Upload it again to continue.",
          });
          return;
        }
        throw new Error(data.message || "Failed to start processing");
      }

      startPolling(projectId);
      toast({ title: "Proofreading Started",
        description: "Running auto-fixes and grammar review — this may take 1–3 minutes." });
    } catch (err: any) {
      setIsProcessing(false);
      setAiError(err.message);
      toast({ variant: "destructive", title: "Could Not Start Processing", description: err.message });
    }
  };

  const retryPolling = () => {
    if (projectId) {
      setProcessingTimedOut(false);
      setAiError(null);
      setIsProcessing(true);
      startPolling(projectId);
    }
  };

  const triggerFileInput = () => fileInputRef.current?.click();

  // ── Export / Download ─────────────────────────────────────────
  const handleDownload = async (format: "pdf" | "docx" | "epub") => {
    if (!projectId) {
      toast({ variant: "destructive", title: "No project loaded", description: "Please complete the upload step first." });
      return;
    }
    setDownloadingFormat(format);
    setExportError(prev => ({ ...prev, [format]: "" }));
    setExportSuccess(prev => ({ ...prev, [format]: false }));
    try {
      const params = new URLSearchParams({
        template: selectedTemplate,
        trim:     selectedTrimSize,
        target:   selectedTarget,
        toc:      tocEnabled ? "1" : "0",
        tocTitle: tocTitle,
        tocDepth: String(tocDepth),
        tocFrontMatter: tocIncludeFrontMatter ? "1" : "0",
        tocNewPage: tocNewPage ? "1" : "0",
        ...(workflowMode === "quick" ? { quickConvert: "1" } : {}),
      });
      const url = `/api/projects/${projectId}/exports/${format}?${params}`;
      const res = await apiFetch(url);

      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: `Server error (${res.status})` }));
        throw new Error(body.message || `Download failed (${res.status})`);
      }

      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const body = await res.json();
        throw new Error(body.message || "Unexpected response from server");
      }

      const blob = await res.blob();
      if (blob.size === 0) {
        throw new Error("Generated file was empty. Please try again.");
      }
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `${projectTitle || "manuscript"}_formatted.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);

      setExportSuccess(prev => ({ ...prev, [format]: true }));
      setExportError(prev => ({ ...prev, [format]: "" }));
      toast({ title: `${format.toUpperCase()} downloaded!`, description: `Your formatted manuscript is ready.` });
    } catch (err: any) {
      const msg = err.message || "An unexpected error occurred";
      setExportError(prev => ({ ...prev, [format]: msg }));
      toast({ variant: "destructive", title: "Download failed", description: msg });
    } finally {
      setDownloadingFormat(null);
    }
  };

  // ── Derived state for sidebar badges ─────────────────────────
  const templateDone = hasFile; // simplified — template is "done" once they've been there
  const aiDone = suggestionsCount !== null;

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-muted/20 flex flex-col">

      {/* Header */}
      <header className="border-b bg-card sticky top-0 z-40">
        <div className="container px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/dashboard">
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                <ChevronLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="h-6 w-px bg-border" />
            <div>
              <h1 className="font-serif font-bold leading-none">
                {projectTitle || (id === "new" ? "New Project" : "Loading…")}
              </h1>
              <span className="text-xs text-muted-foreground">
                {isProcessing
                  ? "AI is analyzing your manuscript…"
                  : aiError
                  ? "Processing failed"
                  : hasFile
                  ? wordCount
                    ? `${wordCount.toLocaleString()} words · Ready`
                    : "Ready"
                  : "New draft"}
              </span>
            </div>
          </div>
          {isProcessing && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>AI Processing…</span>
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 container px-4 py-8 max-w-5xl mx-auto flex flex-col md:flex-row gap-8">

        {/* Sidebar */}
        <div className="w-full md:w-64 shrink-0">
          <Tabs value={activeTab} onValueChange={setActiveTab} orientation="vertical" className="w-full flex flex-col">
            <TabsList className="flex flex-col h-auto bg-transparent items-start space-y-1 p-0">
              {[
                {
                  value: "upload",
                  icon: <UploadCloud className="mr-3 h-5 w-5 shrink-0" />,
                  label: "1. Upload",
                  sub: "Manuscript file",
                  badge: hasFile ? <CheckCircle2 className="ml-auto h-4 w-4 text-green-500" /> : null,
                  disabled: false,
                },
                {
                  value: "template",
                  icon: <LayoutTemplate className="mr-3 h-5 w-5 shrink-0" />,
                  label: "2. Template",
                  sub: "Style & trim size",
                  badge: null,
                  disabled: !hasFile,
                },
                {
                  value: "ai",
                  icon: <Sparkles className="mr-3 h-5 w-5 shrink-0" />,
                  label: "3. AI Proofing",
                  sub: "Review & fix",
                  badge: suggestionsCount !== null && suggestionsCount > 0
                    ? <span className="ml-auto text-xs bg-amber-500 text-white rounded-full px-1.5 py-0.5 font-bold">{suggestionsCount}</span>
                    : aiDone
                    ? <CheckCircle2 className="ml-auto h-4 w-4 text-green-500" />
                    : null,
                  disabled: !hasFile,
                },
                {
                  value: "structure",
                  icon: <ListTree className="mr-3 h-5 w-5 shrink-0" />,
                  label: "4. Structure",
                  sub: "Chapters & headings",
                  badge: structureConfirmed
                    ? <CheckCircle2 className="ml-auto h-4 w-4 text-green-500" />
                    : null,
                  disabled: !hasFile,
                },
                {
                  value: "export",
                  icon: <Download className="mr-3 h-5 w-5 shrink-0" />,
                  label: "5. Export",
                  sub: "PDF, EPUB, etc.",
                  badge: null,
                  disabled: !hasFile,
                },
              ].map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  disabled={tab.disabled}
                  data-testid={`tab-${tab.value}`}
                  className="w-full justify-start px-4 py-3 rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm data-[state=active]:text-primary border border-transparent data-[state=active]:border-border/50 transition-all"
                >
                  {tab.icon}
                  <div className="text-left">
                    <div className="font-medium">{tab.label}</div>
                    <div className="text-xs font-normal opacity-70">{tab.sub}</div>
                  </div>
                  {tab.badge}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {/* Progress guide */}
          {hasFile && (
            <div className="mt-6 p-4 rounded-xl bg-card border border-border/40 text-xs text-muted-foreground space-y-2">
              <p className="font-semibold text-foreground text-sm">Your progress</p>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                <span>File uploaded</span>
              </div>
              <div className="flex items-center gap-2">
                {activeTab !== "upload" ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" /> : <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground/40 shrink-0" />}
                <span>Template chosen</span>
              </div>
              <div className="flex items-center gap-2">
                {isProcessing ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" /> : aiDone ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" /> : <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground/40 shrink-0" />}
                <span>AI proofreading</span>
              </div>
              <div className="flex items-center gap-2">
                {structureConfirmed ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" /> : <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground/40 shrink-0" />}
                <span>Structure review</span>
              </div>
            </div>
          )}
        </div>

        {/* Main content */}
        <div className="flex-1">
          <Tabs value={activeTab} className="w-full">

            {/* ── TAB 1: UPLOAD ──────────────────────────────── */}
            <TabsContent value="upload" className="mt-0 focus-visible:outline-none focus-visible:ring-0">
              <Card className="border-border/50 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-2xl font-serif">Upload Your Manuscript</CardTitle>
                  <CardDescription>
                    {hasFile
                      ? "File received. Review or correct the title and author name below, then click Continue."
                      : "Drop your file below, fill in the book details, then click Continue. AI proofreading starts only after you complete all the setup steps."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">

                  {/* File drop zone OR file confirmation */}
                  {!hasFile ? (
                    <div
                      className="border-2 border-dashed border-primary/20 rounded-xl p-12 flex flex-col items-center justify-center text-center bg-primary/5 hover:bg-primary/10 transition-colors cursor-pointer group"
                      onClick={triggerFileInput}
                      data-testid="upload-dropzone"
                    >
                      <input
                        type="file"
                        ref={fileInputRef}
                        className="hidden"
                        accept=".doc,.docx,.txt,.rtf"
                        onChange={handleFileChange}
                        data-testid="input-file"
                      />
                      <div className="h-16 w-16 bg-card rounded-full shadow-sm flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                        {isUploading
                          ? <Loader2 className="h-8 w-8 text-primary animate-spin" />
                          : <UploadCloud className="h-8 w-8 text-primary" />
                        }
                      </div>
                      <h3 className="text-xl font-bold mb-2">
                        {isUploading ? "Uploading securely…" : "Drag & drop your manuscript"}
                      </h3>
                      <p className="text-muted-foreground max-w-sm mb-6">
                        {isUploading
                          ? "Your file is being processed."
                          : "or click to browse. Max 50 MB. Accepts .docx, .doc, .txt, .rtf"}
                      </p>
                      {!isUploading && (
                        <Button variant="outline" className="bg-card" data-testid="button-select-file">
                          Select File
                        </Button>
                      )}
                    </div>
                  ) : (
                    /* File received — compact confirmation bar */
                    <div className="rounded-xl p-4 flex items-center gap-4 border bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900/40">
                      <div className="p-2.5 rounded-full shrink-0 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300">
                        <FileText className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-green-900 dark:text-green-100 truncate text-sm">{fileName}</p>
                        {wordCount !== null && (
                          <p className="text-xs text-green-700 dark:text-green-400">
                            {wordCount.toLocaleString()} words extracted
                          </p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => { setHasFile(false); setFileName(""); setProjectId(null); setProjectTitle(""); setAuthorName(""); }}
                        data-testid="button-replace-file"
                      >
                        Replace file
                      </Button>
                    </div>
                  )}

                  {/* Needs re-upload notice */}
                  {needsReupload && (
                    <div className="rounded-xl p-5 flex items-start gap-4 border bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900">
                      <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                      <div>
                        <p className="font-semibold text-amber-900 dark:text-amber-100">File no longer available</p>
                        <p className="text-sm text-amber-800 dark:text-amber-300/80 mt-1">
                          The server was restarted and your file data was cleared. Please upload your file again to continue.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* ── Book details — always visible, prominent once file is ready ── */}
                  <div className={hasFile ? "rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-4" : "space-y-4"}>
                    {hasFile && (
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 h-5 w-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">
                          ✎
                        </div>
                        <div>
                          <p className="font-semibold text-sm">Review your book details</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            We extracted these from your file name. Edit them before you continue — they'll appear on every exported page.
                          </p>
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="book-title" className={hasFile ? "font-semibold" : ""}>
                          Book Title {hasFile && <span className="text-primary">*</span>}
                        </Label>
                        <Input
                          id="book-title"
                          ref={titleInputRef}
                          value={projectTitle}
                          onChange={(e) => setProjectTitle(e.target.value)}
                          placeholder="My Great Novel"
                          className="mt-1"
                          data-testid="input-book-title"
                        />
                      </div>
                      <div>
                        <Label htmlFor="author-name" className={hasFile ? "font-semibold" : ""}>
                          Author Name {hasFile && <span className="text-primary">*</span>}
                        </Label>
                        <Input
                          id="author-name"
                          value={authorName}
                          onChange={(e) => setAuthorName(e.target.value)}
                          placeholder="Jane Smith"
                          className="mt-1"
                          data-testid="input-author-name"
                        />
                      </div>
                    </div>
                    {hasFile && (
                      <p className="text-xs text-muted-foreground">
                        You can always update these later from the project settings.
                      </p>
                    )}
                  </div>
                </CardContent>
                <CardFooter className="flex justify-between border-t pt-6">
                  {hasFile ? (
                    <p className="text-sm text-muted-foreground">
                      Title and author look good? Click Continue to choose your template.
                    </p>
                  ) : (
                    <span />
                  )}
                  <Button
                    onClick={handleContinueToTemplate}
                    disabled={!hasFile || isUploading || isSavingMeta}
                    className="gap-2"
                    data-testid="button-continue-to-template"
                  >
                    {isSavingMeta ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Continue <ArrowRight className="h-4 w-4" />
                  </Button>
                </CardFooter>
              </Card>
            </TabsContent>

            {/* ── TAB 2: TEMPLATE ────────────────────────────── */}
            <TabsContent value="template" className="mt-0 focus-visible:outline-none focus-visible:ring-0">
              <Card className="border-border/50 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-2xl font-serif">Formatting Template</CardTitle>
                  <CardDescription>Choose a style template, trim size, and target platform for your book.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-8">

                  {/* ── Workflow selector ─────────────────────── */}
                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Choose Your Workflow</h3>
                    <div className="grid sm:grid-cols-2 gap-4">
                      {/* Full Formatting */}
                      <button
                        type="button"
                        onClick={() => setWorkflowMode("full")}
                        data-testid="button-workflow-full"
                        className={`relative text-left rounded-xl border-2 p-5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          workflowMode === "full"
                            ? "border-primary bg-primary/5 shadow-sm"
                            : "border-border bg-card hover:bg-muted/40"
                        }`}
                      >
                        {workflowMode === "full" && (
                          <span className="absolute top-3 right-3 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                            <CheckCircle2 className="h-3.5 w-3.5 text-primary-foreground" />
                          </span>
                        )}
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                            <Sparkles className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <div className="font-semibold text-sm mb-0.5">Full Formatting <span className="ml-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">Recommended</span></div>
                            <p className="text-xs text-muted-foreground leading-relaxed">AI proofreading, chapter formatting, and table of contents</p>
                          </div>
                        </div>
                      </button>

                      {/* Quick Convert */}
                      <button
                        type="button"
                        onClick={() => setWorkflowMode("quick")}
                        data-testid="button-workflow-quick"
                        className={`relative text-left rounded-xl border-2 p-5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          workflowMode === "quick"
                            ? "border-amber-500 bg-amber-50 dark:bg-amber-950/20 shadow-sm"
                            : "border-border bg-card hover:bg-muted/40"
                        }`}
                      >
                        {workflowMode === "quick" && (
                          <span className="absolute top-3 right-3 h-5 w-5 rounded-full bg-amber-500 flex items-center justify-center">
                            <CheckCircle2 className="h-3.5 w-3.5 text-white" />
                          </span>
                        )}
                        <div className="flex items-start gap-3">
                          <div className={`mt-0.5 h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${workflowMode === "quick" ? "bg-amber-100 dark:bg-amber-900/30" : "bg-muted"}`}>
                            <Zap className={`h-5 w-5 ${workflowMode === "quick" ? "text-amber-600" : "text-muted-foreground"}`} />
                          </div>
                          <div>
                            <div className="font-semibold text-sm mb-0.5">Quick Convert</div>
                            <p className="text-xs text-muted-foreground leading-relaxed">Skip all processing — instantly convert your file (no formatting applied)</p>
                          </div>
                        </div>
                      </button>
                    </div>

                    {/* Quick Convert warning */}
                    {workflowMode === "quick" && (
                      <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900/50 px-4 py-3" data-testid="warning-quick-convert">
                        <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                        <p className="text-sm text-amber-800 dark:text-amber-300/90">
                          No formatting, chapters, or table of contents will be applied.
                        </p>
                      </div>
                    )}
                  </div>

                  <Separator />

                  {/* Template selection with previews */}
                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Genre Template</h3>
                    <RadioGroup value={selectedTemplate} onValueChange={setSelectedTemplate} className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                      {TEMPLATES.map((t) => (
                        <div key={t.id}>
                          <RadioGroupItem value={t.id} id={`template-${t.id}`} className="peer sr-only" />
                          <Label
                            htmlFor={`template-${t.id}`}
                            className="block border rounded-xl cursor-pointer hover:bg-muted/30 peer-data-[state=checked]:border-primary peer-data-[state=checked]:ring-1 peer-data-[state=checked]:ring-primary peer-data-[state=checked]:bg-primary/5 transition-all overflow-hidden"
                            data-testid={`label-template-${t.id}`}
                          >
                            {/* Multi-page preview spread */}
                            <div className="bg-gradient-to-b from-muted/50 to-muted/20 border-b px-4 py-4">
                              <TemplatePreviewSpread t={t} />
                            </div>
                            {/* Details */}
                            <div className="p-4 space-y-3">
                              <div>
                                <div className="text-[10px] font-semibold uppercase tracking-wider text-primary/70 mb-0.5">
                                  {t.genre}
                                </div>
                                <div className="font-bold text-base">{t.name}</div>
                                <div className="text-sm text-muted-foreground leading-relaxed mt-1">{t.desc}</div>
                              </div>
                              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground border-t pt-2">
                                <div><span className="text-foreground/70 font-medium">Body:</span> {t.fontLabel}</div>
                                <div><span className="text-foreground/70 font-medium">Heading:</span> {t.headingFontLabel}</div>
                                <div><span className="text-foreground/70 font-medium">Spacing:</span> {t.spacingLabel}</div>
                                <div><span className="text-foreground/70 font-medium">Trim:</span> {t.trimDefault}</div>
                                <div className="col-span-2"><span className="text-foreground/70 font-medium">Hierarchy:</span> {t.hierarchyLabel}</div>
                                <div className="col-span-2"><span className="text-foreground/70 font-medium">Exports:</span> {t.formats.join(" · ")}</div>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {t.features.map((f) => (
                                  <span
                                    key={f}
                                    className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground border"
                                  >
                                    {f}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>

                  <Separator />

                  {/* Trim size & target */}
                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Print Size &amp; Target</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label className="mb-1.5 block">Trim Size</Label>
                        <select
                          value={selectedTrimSize}
                          onChange={(e) => setSelectedTrimSize(e.target.value)}
                          className="w-full h-10 px-3 rounded-md border bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          data-testid="select-trim-size"
                        >
                          {TRIM_SIZES.map((s) => <option key={s}>{s}</option>)}
                        </select>
                      </div>
                      <div>
                        <Label className="mb-1.5 block">Target Platform</Label>
                        <select
                          value={selectedTarget}
                          onChange={(e) => setSelectedTarget(e.target.value)}
                          className="w-full h-10 px-3 rounded-md border bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          data-testid="select-print-target"
                        >
                          {PRINT_TARGETS.map((p) => <option key={p}>{p}</option>)}
                        </select>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-3">
                      Ebook target: Universal EPUB3 (Kindle, Apple Books, Kobo) — always included.
                    </p>
                  </div>

                  <Separator />

                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Table of Contents</h3>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <Label htmlFor="toc-toggle" className="text-sm font-medium">Include Table of Contents</Label>
                          <p className="text-xs text-muted-foreground mt-0.5">Add a visible TOC page in PDF and DOCX exports</p>
                        </div>
                        <Switch id="toc-toggle" checked={tocEnabled} onCheckedChange={setTocEnabled} data-testid="switch-toc-enabled" />
                      </div>

                      {tocEnabled && (
                        <div className="space-y-4 pl-1 border-l-2 border-primary/20 ml-1 pl-4">
                          <div>
                            <Label htmlFor="toc-title" className="mb-1.5 block text-sm">TOC Title</Label>
                            <Input
                              id="toc-title"
                              value={tocTitle}
                              onChange={(e) => setTocTitle(e.target.value)}
                              placeholder="Table of Contents"
                              className="max-w-xs"
                              data-testid="input-toc-title"
                            />
                          </div>

                          <div>
                            <Label htmlFor="toc-depth" className="mb-1.5 block text-sm">Depth</Label>
                            <select
                              id="toc-depth"
                              value={tocDepth}
                              onChange={(e) => setTocDepth(Number(e.target.value))}
                              className="w-full max-w-xs h-10 px-3 rounded-md border bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              data-testid="select-toc-depth"
                            >
                              <option value={1}>Chapters only</option>
                              <option value={2}>Chapters + sections</option>
                            </select>
                          </div>

                          <div className="flex items-center justify-between max-w-xs">
                            <Label htmlFor="toc-front-matter" className="text-sm">Include front matter in TOC</Label>
                            <Switch id="toc-front-matter" checked={tocIncludeFrontMatter} onCheckedChange={setTocIncludeFrontMatter} data-testid="switch-toc-front-matter" />
                          </div>

                          <div className="flex items-center justify-between max-w-xs">
                            <Label htmlFor="toc-new-page" className="text-sm">Start TOC on a new page</Label>
                            <Switch id="toc-new-page" checked={tocNewPage} onCheckedChange={setTocNewPage} data-testid="switch-toc-new-page" />
                          </div>
                        </div>
                      )}

                      <p className="text-xs text-muted-foreground">
                        EPUB exports always include a navigable table of contents regardless of this setting.
                      </p>
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="flex justify-between border-t pt-6">
                  <Button variant="ghost" onClick={() => setActiveTab("upload")}>Back</Button>
                  {workflowMode === "quick" ? (
                    <Button onClick={handleContinueToAI} className="gap-2 bg-amber-500 hover:bg-amber-600 text-white" data-testid="button-quick-convert-go">
                      <Zap className="h-4 w-4" /> Convert &amp; Download
                    </Button>
                  ) : (
                    <Button onClick={handleContinueToAI} className="gap-2" data-testid="button-continue-to-ai">
                      Next: AI Options <ArrowRight className="h-4 w-4" />
                    </Button>
                  )}
                </CardFooter>
              </Card>
            </TabsContent>

            {/* ── TAB 3: AI PROOFING ─────────────────────────── */}
            <TabsContent value="ai" className="mt-0 focus-visible:outline-none focus-visible:ring-0">
              <Card className="border-border/50 shadow-sm overflow-hidden">
                {/* Hero header */}
                <div className="bg-primary/5 border-b px-6 py-7">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary mb-3 text-sm font-medium border border-primary/20">
                    <Sparkles className="h-4 w-4" /> AI Proofreader
                  </div>
                  <CardTitle className="text-3xl font-serif mb-1">AI Editorial Assistant</CardTitle>
                  <CardDescription className="text-base max-w-xl">
                    Automatically fixes spelling, capitalization, punctuation &amp; spacing, then flags grammar, run-on sentences, and clarity issues for your review.
                  </CardDescription>
                </div>

                <CardContent className="p-6 space-y-6">

                  {/* Auto-fix toggles */}
                  <div className="bg-card border rounded-xl p-5 shadow-sm">
                    <h3 className="font-bold flex items-center gap-2 mb-1">
                      <CheckCircle2 className="h-5 w-5 text-green-500" /> Automatic Fixes
                    </h3>
                    <p className="text-sm text-muted-foreground mb-4">Applied automatically — no review needed.</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {[
                        { label: "Spacing & Formatting",  sub: "Double spaces, stray tabs, em-dashes", value: fixSpacing,         set: setFixSpacing },
                        { label: "Capitalization",         sub: "Sentence starts, proper nouns",        value: fixCapitalization,  set: setFixCapitalization },
                        { label: "Basic Punctuation",      sub: "Missing periods, quote pairing",       value: fixPunctuation,     set: setFixPunctuation },
                        { label: "Typo Correction",        sub: "Clear misspellings",                   value: fixTypos,           set: setFixTypos },
                      ].map((item) => (
                        <div
                          key={item.label}
                          className="flex items-center justify-between p-3 border rounded-lg bg-muted/20"
                          data-testid={`toggle-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                        >
                          <div className="space-y-0.5">
                            <Label className="text-base cursor-pointer">{item.label}</Label>
                            <p className="text-xs text-muted-foreground">{item.sub}</p>
                          </div>
                          <Switch checked={item.value} onCheckedChange={item.set} />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Dynamic status block */}
                  {!isProcessing && !processingTimedOut && !aiError && suggestionsCount === null && !needsReupload ? (
                    /* ── Not yet started ── */
                    <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 flex flex-col sm:flex-row items-start sm:items-center gap-5">
                      <div className="bg-primary/10 p-4 rounded-full">
                        <Sparkles className="h-7 w-7 text-primary" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-bold text-lg mb-1">
                          Ready to proofread
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          Auto-fixes spelling, caps &amp; punctuation, then reviews grammar &amp; clarity. Takes 1–3 minutes.
                        </p>
                      </div>
                      <Button
                        size="lg"
                        className="gap-2 shrink-0"
                        onClick={handleStartProcessing}
                        data-testid="button-start-proofreading"
                      >
                        <Play className="h-4 w-4" />
                        Start Proofreading
                      </Button>
                    </div>

                  ) : isProcessing ? (
                    /* ── Processing ── */
                    <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/50 rounded-xl p-5">
                      <div className="flex items-start gap-4">
                        <div className="bg-blue-100 dark:bg-blue-900 p-2 rounded-full text-blue-600 mt-1 shrink-0">
                          <Loader2 className="h-5 w-5 animate-spin" />
                        </div>
                        <div className="flex-1">
                          <h3 className="font-bold text-blue-900 dark:text-blue-100 text-lg">
                            AI is proofreading your manuscript…
                          </h3>
                          <p className="text-blue-800 dark:text-blue-300/80 mt-1 mb-3">
                            Auto-fixing spelling, caps &amp; punctuation, then reviewing grammar &amp; clarity.
                            {wordCount && wordCount > 30000 && (
                              <span className="block mt-1 text-sm">Large manuscript — this may take 3–5 minutes.</span>
                            )}
                          </p>
                          {processingProgress != null && processingProgress > 0 ? (
                            <div className="space-y-2 mb-3">
                              <div className="flex justify-between text-xs text-blue-700 dark:text-blue-300">
                                <span>
                                  {processingProgress < 50
                                    ? "Auto-fixing spelling, caps & spacing…"
                                    : processingProgress < 95
                                    ? "Reviewing grammar & clarity…"
                                    : "Saving results…"}
                                </span>
                                <span>{processingProgress}%</span>
                              </div>
                              <Progress value={processingProgress} className="h-2" />
                            </div>
                          ) : (
                            <div className="space-y-1.5 text-sm text-blue-700 dark:text-blue-300 mb-3">
                              <div className="flex items-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Starting proofreading…
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                  ) : processingTimedOut ? (
                    /* ── Timed out ── */
                    <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 rounded-xl p-5 flex items-start gap-4">
                      <div className="bg-amber-100 p-2 rounded-full text-amber-600 mt-1">
                        <AlertCircle className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-amber-900 dark:text-amber-200 text-lg">Still processing…</h3>
                        <p className="text-amber-800 dark:text-amber-300/80 mb-3 mt-1">
                          This is taking longer than usual. The AI job may still be running in the background.
                        </p>
                        <Button variant="outline" size="sm" onClick={retryPolling} className="gap-2" data-testid="button-check-again">
                          <RefreshCw className="h-4 w-4" /> Check Again
                        </Button>
                      </div>
                    </div>

                  ) : aiError ? (
                    /* ── Error ── */
                    <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 rounded-xl p-5 flex items-start gap-4">
                      <div className="bg-red-100 p-2 rounded-full text-red-600 mt-1">
                        <XCircle className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-red-900 dark:text-red-100 text-lg">AI Processing Failed</h3>
                        <p className="text-red-800 dark:text-red-300/80 mt-1 mb-3">{aiError}</p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={handleStartProcessing}
                          data-testid="button-retry-processing"
                        >
                          <RefreshCw className="h-4 w-4" /> Try Again
                        </Button>
                      </div>
                    </div>

                  ) : needsReupload ? (
                    /* ── Needs re-upload ── */
                    <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 rounded-xl p-5 flex items-start gap-4">
                      <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                      <div>
                        <h3 className="font-bold text-amber-900 dark:text-amber-100">File no longer in memory</h3>
                        <p className="text-sm text-amber-800 dark:text-amber-300/80 mt-1 mb-3">
                          The server was restarted. Please go back to the Upload step and re-upload your manuscript file.
                        </p>
                        <Button variant="outline" size="sm" onClick={() => setActiveTab("upload")} className="gap-2">
                          <UploadCloud className="h-4 w-4" /> Go to Upload
                        </Button>
                      </div>
                    </div>

                  ) : suggestionsCount !== null && suggestionsCount > 0 ? (
                    /* ── Suggestions ready ── */
                    <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 rounded-xl p-5">
                      <div className="flex items-start gap-4">
                        <div className="bg-amber-100 dark:bg-amber-900/50 p-2 rounded-full text-amber-600 mt-1">
                          <AlertCircle className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="font-bold text-amber-900 dark:text-amber-200 text-lg">
                            {suggestionsCount} suggestion{suggestionsCount !== 1 ? "s" : ""} need your review
                          </h3>
                          <p className="text-amber-800 dark:text-amber-300/80 mb-4 mt-1">
                            The AI found grammar, run-on, and clarity issues that might alter meaning. Each one needs your explicit approval before being applied.
                          </p>
                          <Link href={`/project/${projectId}/review`}>
                            <Button className="bg-amber-600 hover:bg-amber-700 text-white shadow-sm" data-testid="button-go-to-review">
                              Go to Review Page
                            </Button>
                          </Link>
                        </div>
                      </div>
                    </div>

                  ) : suggestionsCount === 0 ? (
                    /* ── Clean ── */
                    <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900/50 rounded-xl p-5">
                      <div className="flex items-start gap-4">
                        <div className="bg-green-100 dark:bg-green-900 p-2 rounded-full text-green-600">
                          <CheckCircle2 className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="font-bold text-green-900 dark:text-green-100 text-lg">No Review Items Found</h3>
                          <p className="text-green-800 dark:text-green-300/80 mt-1">
                            The AI didn't find any grammar or clarity issues requiring your approval. Your manuscript is ready to export!
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </CardContent>

                <CardFooter className="flex justify-between border-t p-6 bg-muted/10">
                  <Button variant="ghost" onClick={() => setActiveTab("template")}>Back</Button>
                  <Button
                    onClick={() => setActiveTab("structure")}
                    disabled={isProcessing}
                    className="gap-2"
                    data-testid="button-continue-to-structure"
                  >
                    Continue to Structure <ArrowRight className="h-4 w-4" />
                  </Button>
                </CardFooter>
              </Card>
            </TabsContent>

            {/* ── TAB 4: STRUCTURE REVIEW ─────────────────────── */}
            <TabsContent value="structure" className="mt-0 focus-visible:outline-none focus-visible:ring-0">
              {projectId && (
                <StructureReview
                  projectId={projectId}
                  onConfirm={() => {
                    setStructureConfirmed(true);
                    setActiveTab("export");
                  }}
                  onBack={() => setActiveTab("ai")}
                  onLoadConfirmed={(isConfirmed) => {
                    if (isConfirmed) setStructureConfirmed(true);
                  }}
                />
              )}
            </TabsContent>

            {/* ── TAB 5: EXPORT ──────────────────────────────── */}
            <TabsContent value="export" className="mt-0 focus-visible:outline-none focus-visible:ring-0">
              <Card className="border-border/50 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-2xl font-serif">Export &amp; Download</CardTitle>
                  <CardDescription>
                    {workflowMode === "quick" ? (
                      <>Your manuscript converted directly — no AI formatting or chapter detection applied. Files are generated instantly from your uploaded text.</>
                    ) : (
                      <>Your manuscript formatted for <strong>{selectedTarget}</strong> at <strong>{selectedTrimSize}</strong> using the <strong>{TEMPLATES.find(t => t.id === selectedTemplate)?.name ?? selectedTemplate}</strong> template. Each file is generated fresh from your final proofread text.</>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-8">

                  {/* Summary banner */}
                  <div className="rounded-xl border bg-muted/30 p-4 flex flex-wrap gap-4 text-sm">
                    {workflowMode === "quick" && (
                      <div className="flex items-center gap-2 w-full pb-2 mb-1 border-b border-amber-200 dark:border-amber-900/40">
                        <Zap className="h-4 w-4 text-amber-500" />
                        <span className="font-semibold text-amber-700 dark:text-amber-400">Quick Convert Mode</span>
                        <span className="text-muted-foreground">— raw text exported without AI formatting</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <LayoutTemplate className="h-4 w-4 text-primary" />
                      <span className="text-muted-foreground">Template:</span>
                      <span className="font-medium">{workflowMode === "quick" ? "None (plain text)" : (TEMPLATES.find(t => t.id === selectedTemplate)?.name ?? selectedTemplate)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-primary" />
                      <span className="text-muted-foreground">Trim size:</span>
                      <span className="font-medium">{selectedTrimSize}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <BookOpen className="h-4 w-4 text-primary" />
                      <span className="text-muted-foreground">Target:</span>
                      <span className="font-medium">{selectedTarget}</span>
                    </div>
                    {wordCount !== null && (
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-primary" />
                        <span className="text-muted-foreground">Words:</span>
                        <span className="font-medium">{wordCount.toLocaleString()}</span>
                      </div>
                    )}
                  </div>

                  {/* Download cards — 3 formats in a responsive grid */}
                  <div className="grid md:grid-cols-3 gap-6">

                    {/* PDF card */}
                    <div
                      className="border rounded-xl p-6 flex flex-col items-center text-center bg-card hover:shadow-md transition-shadow"
                      data-testid="export-card-pdf"
                    >
                      <div className={`h-16 w-16 rounded-full flex items-center justify-center mb-4 transition-colors ${
                        exportSuccess.pdf
                          ? "bg-green-100 dark:bg-green-900/30 text-green-600"
                          : "bg-blue-100 dark:bg-blue-900/30 text-blue-600"
                      }`}>
                        {exportSuccess.pdf
                          ? <CheckCircle2 className="h-8 w-8" />
                          : <FileText className="h-8 w-8" />}
                      </div>
                      <h3 className="font-bold text-xl mb-1">Print PDF</h3>
                      <p className="text-sm text-muted-foreground mb-1">
                        Formatted for {selectedTarget} with proper margins, embedded fonts, and page numbers.
                      </p>
                      <p className="text-xs text-muted-foreground mb-6">
                        {selectedTrimSize} trim · chapter page breaks · running headers
                      </p>
                      {exportSuccess.pdf && (
                        <p className="text-xs text-green-600 font-medium mb-2 flex items-center gap-1" data-testid="status-pdf-success">
                          <CheckCircle2 className="h-3 w-3" /> Downloaded successfully
                        </p>
                      )}
                      {exportError.pdf && (
                        <div className="w-full rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 p-2 mb-2" data-testid="status-pdf-error">
                          <p className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1">
                            <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" /> {exportError.pdf}
                          </p>
                        </div>
                      )}
                      <Button
                        className="w-full gap-2"
                        onClick={() => handleDownload("pdf")}
                        disabled={downloadingFormat === "pdf" || !projectId}
                        variant={exportSuccess.pdf ? "outline" : exportError.pdf ? "destructive" : "default"}
                        data-testid="button-download-pdf"
                      >
                        {downloadingFormat === "pdf" ? (
                          <><Loader2 className="h-4 w-4 animate-spin" /> Generating PDF…</>
                        ) : exportError.pdf ? (
                          <><RefreshCw className="h-4 w-4" /> Retry PDF</>
                        ) : exportSuccess.pdf ? (
                          <><Download className="h-4 w-4" /> Download Again</>
                        ) : (
                          <><Download className="h-4 w-4" /> Download PDF</>
                        )}
                      </Button>
                    </div>

                    {/* DOCX card */}
                    <div
                      className="border rounded-xl p-6 flex flex-col items-center text-center bg-card hover:shadow-md transition-shadow"
                      data-testid="export-card-docx"
                    >
                      <div className={`h-16 w-16 rounded-full flex items-center justify-center mb-4 transition-colors ${
                        exportSuccess.docx
                          ? "bg-green-100 dark:bg-green-900/30 text-green-600"
                          : "bg-violet-100 dark:bg-violet-900/30 text-violet-600"
                      }`}>
                        {exportSuccess.docx
                          ? <CheckCircle2 className="h-8 w-8" />
                          : <BookOpen className="h-8 w-8" />}
                      </div>
                      <h3 className="font-bold text-xl mb-1">Word Document</h3>
                      <p className="text-sm text-muted-foreground mb-1">
                        Editable DOCX file with correct page size, margins, and styled chapter headings.
                      </p>
                      <p className="text-xs text-muted-foreground mb-6">
                        Compatible with Microsoft Word, Google Docs, LibreOffice
                      </p>
                      {exportSuccess.docx && (
                        <p className="text-xs text-green-600 font-medium mb-2 flex items-center gap-1" data-testid="status-docx-success">
                          <CheckCircle2 className="h-3 w-3" /> Downloaded successfully
                        </p>
                      )}
                      {exportError.docx && (
                        <div className="w-full rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 p-2 mb-2" data-testid="status-docx-error">
                          <p className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1">
                            <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" /> {exportError.docx}
                          </p>
                        </div>
                      )}
                      <Button
                        className="w-full gap-2"
                        onClick={() => handleDownload("docx")}
                        disabled={downloadingFormat === "docx" || !projectId}
                        variant={exportSuccess.docx ? "outline" : exportError.docx ? "destructive" : "default"}
                        data-testid="button-download-docx"
                      >
                        {downloadingFormat === "docx" ? (
                          <><Loader2 className="h-4 w-4 animate-spin" /> Generating DOCX…</>
                        ) : exportError.docx ? (
                          <><RefreshCw className="h-4 w-4" /> Retry DOCX</>
                        ) : exportSuccess.docx ? (
                          <><Download className="h-4 w-4" /> Download Again</>
                        ) : (
                          <><Download className="h-4 w-4" /> Download DOCX</>
                        )}
                      </Button>
                    </div>

                    {/* EPUB card */}
                    <div
                      className="border rounded-xl p-6 flex flex-col items-center text-center bg-card hover:shadow-md transition-shadow"
                      data-testid="export-card-epub"
                    >
                      <div className={`h-16 w-16 rounded-full flex items-center justify-center mb-4 transition-colors ${
                        exportSuccess.epub
                          ? "bg-green-100 dark:bg-green-900/30 text-green-600"
                          : "bg-amber-100 dark:bg-amber-900/30 text-amber-600"
                      }`}>
                        {exportSuccess.epub
                          ? <CheckCircle2 className="h-8 w-8" />
                          : <Sparkles className="h-8 w-8" />}
                      </div>
                      <h3 className="font-bold text-xl mb-1">Reflowable EPUB</h3>
                      <p className="text-sm text-muted-foreground mb-1">
                        Valid EPUB3 with table of contents, chapter navigation, and template-matched typography.
                      </p>
                      <p className="text-xs text-muted-foreground mb-6">
                        Works on Kindle, Apple Books, Kobo, and any EPUB reader
                      </p>
                      {exportSuccess.epub && (
                        <p className="text-xs text-green-600 font-medium mb-2 flex items-center gap-1" data-testid="status-epub-success">
                          <CheckCircle2 className="h-3 w-3" /> Downloaded successfully
                        </p>
                      )}
                      {exportError.epub && (
                        <div className="w-full rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 p-2 mb-2" data-testid="status-epub-error">
                          <p className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1">
                            <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" /> {exportError.epub}
                          </p>
                        </div>
                      )}
                      <Button
                        className="w-full gap-2"
                        onClick={() => handleDownload("epub")}
                        disabled={downloadingFormat === "epub" || !projectId}
                        variant={exportSuccess.epub ? "outline" : exportError.epub ? "destructive" : "default"}
                        data-testid="button-download-epub"
                      >
                        {downloadingFormat === "epub" ? (
                          <><Loader2 className="h-4 w-4 animate-spin" /> Generating EPUB…</>
                        ) : exportError.epub ? (
                          <><RefreshCw className="h-4 w-4" /> Retry EPUB</>
                        ) : exportSuccess.epub ? (
                          <><Download className="h-4 w-4" /> Download Again</>
                        ) : (
                          <><Download className="h-4 w-4" /> Download EPUB</>
                        )}
                      </Button>
                    </div>

                  </div>

                  {/* Tip */}
                  {!projectId && (
                    <div className="rounded-xl p-4 flex items-start gap-3 border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900/50">
                      <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                      <p className="text-sm text-amber-800 dark:text-amber-300/80">
                        Upload a manuscript on the first step to enable downloads.
                      </p>
                    </div>
                  )}

                </CardContent>
                <CardFooter className="border-t pt-6">
                  <Button variant="ghost" onClick={() => setActiveTab(workflowMode === "quick" ? "template" : "structure")}>
                    {workflowMode === "quick" ? "← Back to Template" : "← Back to Structure"}
                  </Button>
                </CardFooter>
              </Card>
            </TabsContent>

          </Tabs>
        </div>
      </div>
    </div>
  );
}
