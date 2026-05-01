import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import Stripe from "stripe";
import { supabaseAdmin } from "./supabase";
import { createClient } from "@supabase/supabase-js";
import {
  extractTextFromBuffer,
  stripRtf,
  runAutoFixPass,
  runSuggestionPass,
} from "./openai-pipeline";
import { generatePDF, generateDOCX, generateEPUB, generateQuickPDF, generateQuickDOCX, generateQuickEPUB, splitParagraphs, autoDetectStructure } from "./export-generator";
import type { ParagraphType } from "./export-generator";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

// ── Stripe setup ─────────────────────────────────────────────────
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;
const STRIPE_PRICE_SINGLE = process.env.STRIPE_PRICE_SINGLE || "";
const STRIPE_PRICE_PRO    = process.env.STRIPE_PRICE_PRO    || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

if (!stripe) {
  console.warn("[Stripe] STRIPE_SECRET_KEY not set — checkout routes disabled.");
}

// ── Supabase Auth client (uses anon key) ─────────────────────────
const supabaseUrl = "https://pofrdafqjzutzxyygpgu.supabase.co";
const supabaseAnonKey =
  process.env.SUPABASE_ANON_KEY || "sb_publishable_mp_IZqov4BLWayDXerxb8A_Zs23etyp";
const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false },
});

// ── In-memory stores ──────────────────────────────────────────────
const manuscriptTexts = new Map<string, string>();
interface ConfirmedParagraph { text: string; type: string; }
const confirmedStructures = new Map<string, ConfirmedParagraph[]>();

// ── Auth middleware ───────────────────────────────────────────────

interface AuthedRequest extends Request {
  userId?: string;
  userEmail?: string;
}

async function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ message: "Unauthorized — no token provided" });
    return;
  }

  try {
    const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
    if (error || !user) {
      res.status(401).json({ message: "Unauthorized — invalid token" });
      return;
    }
    req.userId = user.id;
    req.userEmail = user.email ?? undefined;
    next();
  } catch (err) {
    res.status(401).json({ message: "Unauthorized — token verification failed" });
  }
}

// ── DB helpers ────────────────────────────────────────────────────

async function insertCorrectionRow(
  row: Record<string, unknown>,
  attempt = 1
): Promise<boolean> {
  const { error } = await supabaseAdmin.from("corrections").insert(row);
  if (!error) return true;

  const missingColMatch = error.message.match(
    /Could not find the '(\w+)' column/
  );
  if (missingColMatch && attempt <= 10) {
    const badCol = missingColMatch[1];
    const reduced = { ...row };
    delete reduced[badCol];
    if (Object.keys(reduced).length < 3) {
      console.error(`[Pipeline] Row reduced to <3 fields, giving up: ${error.message}`);
      return false;
    }
    console.warn(`[Pipeline] Stripping unknown column '${badCol}', retry ${attempt}…`);
    return insertCorrectionRow(reduced, attempt + 1);
  }

  console.error(`[Pipeline] Insert failed: ${error.message}`);
  return false;
}

async function safeUpdate(
  table: string,
  fields: Record<string, unknown>,
  matchId: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from(table)
    .update(fields)
    .eq("id", matchId);
  if (error) {
    console.error(`[DB] UPDATE ${table} (id=${matchId}) failed:`, error.message);
  }
}

async function forceStatus(
  projectId: string,
  status: string,
  errorMsg?: string
): Promise<void> {
  const { error: minErr } = await supabaseAdmin
    .from("projects")
    .update({ status })
    .eq("id", projectId);
  if (minErr) {
    console.error(`[DB] forceStatus(status) failed for ${projectId}:`, minErr.message);
    return;
  }
  if (errorMsg) {
    const { error } = await supabaseAdmin
      .from("projects")
      .update({ ai_error: errorMsg.slice(0, 500) })
      .eq("id", projectId);
    if (error) {
      console.warn(`[DB] forceStatus(ai_error) skipped: ${error.message}`);
    }
  }
}

// ── Plan resolution (single source of truth) ─────────────────────
export type Plan = "free" | "single" | "pro" | "agency";
export const FREE_WORD_CAP = 2500;
export const PLAN_CAPS: Record<Plan, number> = {
  free: FREE_WORD_CAP,
  single: 150_000,
  pro: 500_000,
  agency: 2_000_000,
};

/**
 * Resolve a user's plan from Supabase Auth metadata. Fail-closed: any
 * lookup error or missing/unknown value resolves to "free".
 */
async function resolveUserPlan(userId: string): Promise<Plan> {
  try {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (error) throw error;
    const raw = String((data?.user?.user_metadata as any)?.plan ?? "")
      .trim()
      .toLowerCase();
    if (raw === "single" || raw === "pro" || raw === "agency") return raw;
    return "free";
  } catch (e) {
    console.warn(
      `[Plan] Lookup failed for user=${userId} — defaulting to free (fail-closed):`,
      (e as Error).message
    );
    return "free";
  }
}

/**
 * Compute the authoritative word count for a project. Prefers
 * the value provided in `text`, then the cached manuscript map,
 * then the DB-stored `cleaned_text`, then `word_count`. Returns 0
 * only when nothing is available.
 */
async function resolveWordCount(
  projectId: string,
  text?: string | null
): Promise<number> {
  const count = (s: string) => s.split(/\s+/).filter(Boolean).length;
  if (typeof text === "string" && text.length > 0) return count(text);
  const cached = manuscriptTexts.get(projectId);
  if (typeof cached === "string" && cached.length > 0) return count(cached);
  try {
    const { data } = await supabaseAdmin
      .from("projects")
      .select("cleaned_text, word_count")
      .eq("id", projectId)
      .single();
    if (data?.cleaned_text && typeof data.cleaned_text === "string") {
      return count(data.cleaned_text);
    }
    if (typeof data?.word_count === "number") return data.word_count;
  } catch {}
  return 0;
}

/** Verify that the requesting user owns this project */
async function verifyOwnership(
  projectId: string,
  userId: string
): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from("projects")
      .select("user_id")
      .eq("id", projectId)
      .single();

    if (error) {
      if (error.message?.includes("column") || error.code === "PGRST204") {
        return true;
      }
      console.error("[verifyOwnership] Query error:", error.message);
      return false;
    }
    if (data?.user_id === null || data?.user_id === undefined) return true;
    return data.user_id === userId;
  } catch {
    return true; // column doesn't exist — allow access
  }
}

// ── Routes ────────────────────────────────────────────────────────

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ── Stripe webhook (must be before bodyParser JSON for raw body) ──
  app.post(
    "/api/stripe/webhook",
    async (req: Request, res: Response) => {
      const sig = req.headers["stripe-signature"] as string;
      if (!stripe || !STRIPE_WEBHOOK_SECRET || !sig) {
        return res.status(400).json({ message: "Webhook not configured" });
      }
      let event: Stripe.Event;
      try {
        const rawBody = (req as any).rawBody;
        event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
      } catch (err: any) {
        console.error("[Stripe webhook] Signature verification failed:", err.message);
        return res.status(400).json({ message: `Webhook error: ${err.message}` });
      }

      if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.user_id;
        const plan = session.metadata?.plan;
        if (userId && plan) {
          try {
            await supabaseAdmin.auth.admin.updateUserById(userId, {
              user_metadata: { plan },
            });
            console.log(`[Stripe webhook] Updated plan for user ${userId} → ${plan}`);
          } catch (err: any) {
            console.error("[Stripe webhook] Failed to update user metadata:", err.message);
          }
        }
      }

      if (event.type === "customer.subscription.deleted") {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.user_id;
        if (userId) {
          try {
            await supabaseAdmin.auth.admin.updateUserById(userId, {
              user_metadata: { plan: "free" },
            });
          } catch { /* non-fatal */ }
        }
      }

      res.json({ received: true });
    }
  );

  // ── Stripe checkout session ───────────────────────────────────────
  app.post("/api/checkout/session", requireAuth, async (req: AuthedRequest, res: Response) => {
    if (!stripe) {
      return res.status(503).json({ message: "Stripe not configured — add STRIPE_SECRET_KEY to secrets." });
    }
    const { plan } = req.body as { plan: "single" | "pro" };
    if (!["single", "pro"].includes(plan)) {
      return res.status(400).json({ message: "Invalid plan. Must be 'single' or 'pro'." });
    }

    const priceId = plan === "single" ? STRIPE_PRICE_SINGLE : STRIPE_PRICE_PRO;
    if (!priceId) {
      return res.status(503).json({
        message: `STRIPE_PRICE_${plan.toUpperCase()} not configured — add it to secrets.`,
      });
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;

    try {
      const session = await stripe.checkout.sessions.create({
        mode: plan === "pro" ? "subscription" : "payment",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${origin}/dashboard?checkout=success&plan=${plan}`,
        cancel_url:  `${origin}/#pricing`,
        customer_email: req.userEmail,
        metadata: {
          user_id: req.userId!,
          plan: plan === "pro" ? "pro" : "single",
        },
      });
      res.json({ url: session.url });
    } catch (err: any) {
      console.error("[Stripe] Checkout session creation failed:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Projects: list ────────────────────────────────────────────────
  app.get("/api/projects", requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      // Try filtering by user_id; fall back to all if column doesn't exist
      let query = supabaseAdmin
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false });

      const userId = req.userId!;

      // Attempt user-scoped query
      const { data, error } = await supabaseAdmin
        .from("projects")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) {
        // If user_id column doesn't exist, return all (temporary open mode)
        if (error.message.includes("user_id")) {
          console.warn("[Projects] user_id column missing — returning all projects");
          const { data: allData, error: allErr } = await supabaseAdmin
            .from("projects")
            .select("*")
            .order("created_at", { ascending: false });
          if (allErr) throw allErr;
          return res.json({ projects: allData });
        }
        throw error;
      }

      res.json({ projects: data });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Projects: upload / create ─────────────────────────────────────
  app.post(
    "/api/projects/upload",
    requireAuth,
    upload.single("manuscript"),
    async (req: AuthedRequest, res: Response) => {
      try {
        if (!req.file) {
          return res.status(400).json({ message: "No file provided" });
        }

        const { title, author_name } = req.body;
        const file = req.file;

        // 1. Try uploading raw file to Supabase Storage (non-fatal)
        const ext = (file.originalname.split(".").pop() || "txt").toLowerCase();
        const storagePath = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: storageError } = await supabaseAdmin.storage
          .from("manuscripts")
          .upload(storagePath, file.buffer, {
            contentType: file.mimetype,
            upsert: false,
          });
        if (storageError) {
          console.warn("[Storage] Upload to bucket failed (non-fatal):", storageError.message);
        }

        // 2. Extract text
        let rawText = "";
        try {
          rawText = await extractTextFromBuffer(file.buffer, file.originalname);
        } catch (err: any) {
          console.warn("[Upload] Text extraction failed:", err.message);
        }

        const wordCount = rawText.split(/\s+/).filter(Boolean).length;

        // ── Plan gating at upload time (fail-closed) ──
        // We block before creating the project so a Free user never ends up
        // with an oversized draft they can't process.
        const uploadPlan = await resolveUserPlan(req.userId!);
        const uploadCap = PLAN_CAPS[uploadPlan];
        if (wordCount > uploadCap) {
          console.log(
            `[Upload] Rejected user=${req.userId} plan=${uploadPlan} ` +
            `words=${wordCount} cap=${uploadCap}`
          );
          const isFree = uploadPlan === "free";
          return res.status(402).json({
            message: isFree
              ? `Free plan supports up to ${uploadCap.toLocaleString()} words. ` +
                `Your manuscript has ${wordCount.toLocaleString()} words. ` +
                `Upgrade to continue.`
              : `Your ${uploadPlan} plan supports up to ${uploadCap.toLocaleString()} words. ` +
                `Your manuscript has ${wordCount.toLocaleString()} words.`,
            needsUpgrade: isFree,
            wordCount,
            wordCap: uploadCap,
            plan: uploadPlan,
          });
        }

        // 3. Create project record
        const insertPayload: Record<string, unknown> = {
          title: (title || file.originalname.replace(/\.[^/.]+$/, "")).trim(),
          status: "Draft",
          storage_path: storagePath,
          original_filename: file.originalname,
          word_count: wordCount,
          cleaned_text: rawText || null,
          user_id: req.userId,
        };
        if (author_name?.trim()) insertPayload.author_name = author_name.trim();

        // Self-adapting insert — strips unknown columns and retries
        async function insertProject(payload: Record<string, unknown>): Promise<any> {
          const { data, error } = await supabaseAdmin
            .from("projects")
            .insert([payload])
            .select()
            .single();
          if (!error) return data;

          const missingCol = error.message.match(/Could not find the '(\w+)' column/)?.[1];
          if (missingCol && Object.keys(payload).length > 3) {
            console.warn(`[Upload] Stripping unknown column '${missingCol}'`);
            const reduced = { ...payload };
            delete reduced[missingCol];
            return insertProject(reduced);
          }
          throw error;
        }

        const project = await insertProject(insertPayload);
        manuscriptTexts.set(project.id, rawText);
        console.log(`[Upload] Draft project=${project.id} stored ~${wordCount} words`);

        res.json({
          success: true,
          projectId: project.id,
          wordCount,
          message: "Upload successful.",
        });
      } catch (err: any) {
        console.error("[Upload] Error:", err);
        res.status(500).json({ message: err.message });
      }
    }
  );

  // ── Projects: update metadata ─────────────────────────────────────
  app.patch("/api/projects/:id", requireAuth, async (req: AuthedRequest, res: Response) => {
    const projectId = req.params.id;

    if (!(await verifyOwnership(projectId, req.userId!))) {
      return res.status(403).json({ message: "Forbidden" });
    }

    try {
      const allowed = ["title", "author_name", "genre", "template", "trim_size", "output_target"];
      const fields: Record<string, unknown> = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined && req.body[key] !== null) {
          fields[key] = String(req.body[key]).trim();
        }
      }
      if (Object.keys(fields).length === 0) {
        return res.json({ success: true, message: "Nothing to update" });
      }

      async function patchWithFallback(f: Record<string, unknown>): Promise<void> {
        const { error } = await supabaseAdmin
          .from("projects")
          .update(f)
          .eq("id", projectId);
        if (!error) return;

        const missingCol = error.message.match(/Could not find the '(\w+)' column/)?.[1];
        if (missingCol && Object.keys(f).length > 1) {
          console.warn(`[PATCH] Skipping unknown column '${missingCol}'`);
          const reduced = { ...f };
          delete reduced[missingCol];
          return patchWithFallback(reduced);
        }
        if (Object.keys(f).length === 1 && missingCol) {
          console.warn(`[PATCH] Column '${missingCol}' doesn't exist — skipped`);
          return;
        }
        throw error;
      }

      await patchWithFallback(fields);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Projects: delete ──────────────────────────────────────────────
  app.delete("/api/projects/:id", requireAuth, async (req: AuthedRequest, res: Response) => {
    const projectId = req.params.id;

    if (!(await verifyOwnership(projectId, req.userId!))) {
      return res.status(403).json({ message: "Forbidden" });
    }

    try {
      // Delete corrections first
      await supabaseAdmin.from("corrections").delete().eq("project_id", projectId);
      // Delete project
      const { error } = await supabaseAdmin.from("projects").delete().eq("id", projectId);
      if (error) throw error;
      manuscriptTexts.delete(projectId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Projects: trigger AI pipeline ────────────────────────────────
  app.post("/api/projects/:id/process", requireAuth, async (req: AuthedRequest, res: Response) => {
    const projectId = req.params.id;

    if (!(await verifyOwnership(projectId, req.userId!))) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const { data: project, error: fetchErr } = await supabaseAdmin
      .from("projects")
      .select("status, original_filename, word_count")
      .eq("id", projectId)
      .single();

    if (fetchErr || !project) {
      return res.status(404).json({ message: "Project not found" });
    }

    if (project.status === "processing") {
      return res.status(409).json({ message: "Already processing" });
    }

    // ── Plan gating at process time (fail-closed) ──
    const processPlan = await resolveUserPlan(req.userId!);
    const processCap = PLAN_CAPS[processPlan];
    const processWords = await resolveWordCount(projectId);
    if (processWords > processCap) {
      console.log(
        `[Process] Blocked user=${req.userId} plan=${processPlan} ` +
        `words=${processWords} cap=${processCap}`
      );
      const isFree = processPlan === "free";
      return res.status(402).json({
        message: isFree
          ? `Free plan supports up to ${processCap.toLocaleString()} words. ` +
            `Your manuscript has ${processWords.toLocaleString()} words. ` +
            `Upgrade to continue.`
          : `Your ${processPlan} plan supports up to ${processCap.toLocaleString()} words.`,
        needsUpgrade: isFree,
        wordCount: processWords,
        wordCap: processCap,
        plan: processPlan,
      });
    }

    const rawText = manuscriptTexts.get(projectId);
    if (!rawText && rawText !== "") {
      return res.status(422).json({
        message:
          "Manuscript text is no longer available (the server may have restarted). " +
          "Please upload your file again.",
        needsReupload: true,
      });
    }

    await supabaseAdmin
      .from("projects")
      .update({ status: "processing" })
      .eq("id", projectId);

    const mode = (req.body?.mode === "fast") ? "fast" : "full";
    res.json({ success: true, message: "AI processing started.", mode });

    processManuscript(projectId, rawText, project.original_filename || "manuscript.txt", mode)
      .catch((err) => {
        console.error("[Pipeline] Uncaught top-level error:", err);
      })
      .finally(() => {
        manuscriptTexts.delete(projectId);
      });
  });

  // ── Projects: single detail ───────────────────────────────────────
  app.get("/api/projects/:id", requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      if (!(await verifyOwnership(req.params.id, req.userId!))) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { data, error } = await supabaseAdmin
        .from("projects")
        .select("*")
        .eq("id", req.params.id)
        .single();
      if (error) throw error;
      res.json({ project: data });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Projects: status polling ──────────────────────────────────────
  app.get("/api/projects/:id/status", requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const { data, error } = await supabaseAdmin
        .from("projects")
        .select("status")
        .eq("id", req.params.id)
        .single();
      if (error) throw error;

      let aiError: string | null = null;
      let processingProgress: number | null = null;
      try {
        const { data: extra } = await supabaseAdmin
          .from("projects")
          .select("ai_error, processing_progress")
          .eq("id", req.params.id)
          .single();
        aiError = extra?.ai_error ?? null;
        processingProgress = extra?.processing_progress ?? null;
      } catch { /* columns may not exist */ }

      res.json({ status: data.status, ai_error: aiError, processing_progress: processingProgress });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Corrections: list ─────────────────────────────────────────────
  app.get("/api/projects/:id/corrections", requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      if (!(await verifyOwnership(req.params.id, req.userId!))) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const { data: project } = await supabaseAdmin
        .from("projects")
        .select("title")
        .eq("id", req.params.id)
        .single();

      const { data, error } = await supabaseAdmin
        .from("corrections")
        .select("*")
        .eq("project_id", req.params.id)
        .eq("status", "pending")
        .order("created_at", { ascending: true });

      if (error) throw error;

      res.json({
        corrections: data || [],
        projectTitle: project?.title || "Your Manuscript",
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ── Structure Review ─────────────────────────────────────────────

  app.get("/api/projects/:id/structure", requireAuth, async (req: AuthedRequest, res: Response) => {
    const { id } = req.params;
    if (!(await verifyOwnership(id, req.userId!))) {
      return res.status(403).json({ message: "Forbidden" });
    }
    try {
      const { data: project, error } = await supabaseAdmin
        .from("projects")
        .select("title, author_name, cleaned_text")
        .eq("id", id)
        .single();
      if (error || !project || !project.cleaned_text) {
        return res.status(404).json({ message: "Project not found or no text available." });
      }

      const text = project.cleaned_text;
      const aiDetect = req.query.aidetect === "1";

      let savedParas: ConfirmedParagraph[] | undefined;
      if (!aiDetect) {
        try {
          const { data: ext } = await supabaseAdmin
            .from("projects")
            .select("manuscript_structure")
            .eq("id", id)
            .single();
          if (ext && (ext as any).manuscript_structure) {
            const raw = (ext as any).manuscript_structure;
            if (Array.isArray(raw) && raw.length > 0) {
              if (typeof raw[0] === "object" && raw[0].text !== undefined) {
                savedParas = raw as ConfirmedParagraph[];
              }
            }
          }
        } catch {}
        if (!savedParas) {
          savedParas = confirmedStructures.get(id);
        }
      }

      if (savedParas && savedParas.length > 0) {
        return res.json({ paragraphs: savedParas, confirmed: true, fullText: text });
      }

      if (aiDetect) {
        const paras = splitParagraphs(text);
        const types = autoDetectStructure(text, project.title || "", project.author_name || "");
        const paragraphs = paras.map((t, i) => ({ text: t, type: types[i] || "body" }));
        return res.json({ paragraphs, confirmed: false, fullText: text });
      }

      res.json({ paragraphs: [], confirmed: false, fullText: text });
    } catch (err: any) {
      console.error("[Structure GET] Error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/projects/:id/structure", requireAuth, async (req: AuthedRequest, res: Response) => {
    const { id } = req.params;
    if (!(await verifyOwnership(id, req.userId!))) {
      return res.status(403).json({ message: "Forbidden" });
    }
    try {
      const { paragraphs } = req.body;
      if (!Array.isArray(paragraphs)) {
        return res.status(400).json({ message: "paragraphs must be an array" });
      }
      const validTypes = new Set(["title", "author", "chapter", "chapter-label", "chapter-title", "section", "introduction", "body", "front-matter", "scene-break"]);
      for (const p of paragraphs) {
        if (typeof p !== "object" || typeof p.text !== "string" || typeof p.type !== "string") {
          return res.status(400).json({ message: "Each paragraph must have text and type" });
        }
        if (!validTypes.has(p.type)) {
          return res.status(400).json({ message: `Invalid paragraph type: ${p.type}` });
        }
      }

      const confirmed: ConfirmedParagraph[] = paragraphs.map((p: any) => ({ text: p.text, type: p.type }));
      confirmedStructures.set(id, confirmed);

      try {
        await supabaseAdmin
          .from("projects")
          .update({ manuscript_structure: confirmed })
          .eq("id", id);
      } catch {}

      res.json({ success: true });
    } catch (err: any) {
      console.error("[Structure PUT] Error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Export ────────────────────────────────────────────────────────
  app.get("/api/projects/:id/exports/:format", requireAuth, async (req: AuthedRequest, res: Response) => {
    const { id } = req.params;
    const format = String(req.params.format);

    if (!["pdf", "docx", "epub"].includes(format)) {
      return res.status(400).json({ message: `Unsupported format: ${format}` });
    }

    if (!(await verifyOwnership(id, req.userId!))) {
      return res.status(403).json({ message: "Forbidden" });
    }

    // ── Plan gating at export time (fail-closed) ──
    const userPlan = await resolveUserPlan(req.userId!);
    const exportCap = PLAN_CAPS[userPlan];
    const exportWords = await resolveWordCount(id);
    if (exportWords > exportCap) {
      console.log(
        `[Export] Blocked user=${req.userId} plan=${userPlan} ` +
        `words=${exportWords} cap=${exportCap}`
      );
      const isFree = userPlan === "free";
      return res.status(402).json({
        message: isFree
          ? `Free plan supports up to ${exportCap.toLocaleString()} words. ` +
            `Your manuscript has ${exportWords.toLocaleString()} words. ` +
            `Upgrade to continue.`
          : `Your ${userPlan} plan supports up to ${exportCap.toLocaleString()} words.`,
        needsUpgrade: isFree,
        wordCount: exportWords,
        wordCap: exportCap,
        plan: userPlan,
      });
    }
    // Free plan: DOCX export only (with watermark).
    if (userPlan === "free" && format !== "docx") {
      return res.status(402).json({
        message: `The Free plan only includes DOCX export. Upgrade to Single Book ($7) for PDF, DOCX, and EPUB.`,
        needsUpgrade: true,
        allowedFormats: ["docx"],
        plan: userPlan,
      });
    }

    try {
      console.log(`[Export] Looking up project id=${id} for user=${req.userId} plan=${userPlan}`);

      const { data: project, error } = await supabaseAdmin
        .from("projects")
        .select("title, author_name, cleaned_text, genre")
        .eq("id", id)
        .single();

      if (error || !project) {
        console.error("[Export] Project query failed:", JSON.stringify({ message: error?.message, code: error?.code, details: error?.details, hint: error?.hint }));
        return res.status(404).json({ message: "Project not found — could not load your manuscript. Please return to the dashboard and try opening it again." });
      }

      console.log(`[Export] Project loaded: title="${project.title}", has_text=${!!project.cleaned_text?.length}`);

      let text = (project.cleaned_text || "").trim();
      if (text.trimStart().startsWith("{\\rtf")) {
        console.log("[Export] Detected raw RTF markup in stored text, stripping...");
        text = stripRtf(text);
      }
      if (!text) {
        return res.status(422).json({
          message:
            "No manuscript text is available yet. Please upload a file and complete the proofreading step.",
        });
      }

      // ── Quick Convert short-circuit ──────────────────────────────
      if (req.query.quickConvert === "1") {
        const qcSettings: import("./export-generator").ExportSettings = {
          title:    project.title       || "Untitled",
          author:   project.author_name || "Unknown Author",
          template: "modern-novel",
          trimSize: String(req.query.trim || '6" × 9" (US Trade)'),
          target:   "Generic PDF",
        };
        const safeTitle2 = (qcSettings.title || "manuscript")
          .replace(/[^a-z0-9_\- ]/gi, "").trim().replace(/\s+/g, "_").slice(0, 80);
        console.log(`[Export] Quick Convert: format=${format} project=${id}`);
        if (format === "pdf") {
          const buf = await generateQuickPDF(text, qcSettings);
          res.setHeader("Content-Type", "application/pdf");
          res.setHeader("Content-Disposition", `attachment; filename="${safeTitle2}_quick.pdf"`);
          return res.send(buf);
        }
        if (format === "docx") {
          const buf = await generateQuickDOCX(text, qcSettings);
          res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
          res.setHeader("Content-Disposition", `attachment; filename="${safeTitle2}_quick.docx"`);
          return res.send(buf);
        }
        if (format === "epub") {
          const buf = await generateQuickEPUB(text, qcSettings);
          res.setHeader("Content-Type", "application/epub+zip");
          res.setHeader("Content-Disposition", `attachment; filename="${safeTitle2}_quick.epub"`);
          return res.send(buf);
        }
      }

      let extendedFields: Record<string, any> = {};
      const { data: ext, error: extErr } = await supabaseAdmin
        .from("projects")
        .select("trim_size, output_target, selected_trim_size, selected_output_target, applied_template_snapshot")
        .eq("id", id)
        .single();
      if (!extErr && ext) {
        extendedFields = ext;
      } else {
        const { data: ext2, error: ext2Err } = await supabaseAdmin
          .from("projects")
          .select("trim_size, output_target")
          .eq("id", id)
          .single();
        if (!ext2Err && ext2) {
          extendedFields = ext2;
        }
      }

      let templateConfig: Record<string, any> | undefined;
      try {
        const templateName = String(req.query.template || project.genre || "modern-novel");
        const { data: tplRow } = await supabaseAdmin
          .from("templates")
          .select("margin_settings, paragraph_settings, header_footer_settings, chapter_title_rules, toc_settings")
          .eq("name", templateName)
          .maybeSingle();
        if (tplRow) {
          templateConfig = {};
          if (tplRow.margin_settings) templateConfig.marginSettings = tplRow.margin_settings;
          if (tplRow.paragraph_settings) templateConfig.paragraphSettings = tplRow.paragraph_settings;
          if (tplRow.header_footer_settings) templateConfig.headerFooterSettings = tplRow.header_footer_settings;
          if (tplRow.chapter_title_rules) templateConfig.chapterTitleRules = tplRow.chapter_title_rules;
          if ((tplRow as any).toc_settings) (templateConfig as any).tocSettings = (tplRow as any).toc_settings;
        }
      } catch {}

      const snapshotConfig = (() => {
        try {
          const snap = extendedFields.applied_template_snapshot;
          if (snap && typeof snap === "object") return snap;
        } catch {}
        return undefined;
      })();

      const projTrim = extendedFields.selected_trim_size || (project as any).trim_size;
      const projTarget = extendedFields.selected_output_target || (project as any).output_target;

      const mergedConfig = snapshotConfig || templateConfig || {};
      if (req.query.toc !== undefined) {
        const tocOverride: Record<string, any> = {
          includeTableOfContents: req.query.toc === "1",
        };
        if (req.query.tocTitle) tocOverride.tocTitle = String(req.query.tocTitle);
        if (req.query.tocDepth) tocOverride.tocDepth = Math.max(1, Math.min(2, Number(req.query.tocDepth) || 1));
        if (req.query.tocFrontMatter !== undefined) tocOverride.includeFrontMatterInToc = req.query.tocFrontMatter === "1";
        if (req.query.tocNewPage !== undefined) tocOverride.startTocOnNewPage = req.query.tocNewPage === "1";
        mergedConfig.tocSettings = { ...(mergedConfig.tocSettings || {}), ...tocOverride };
      }

      const settings: import("./export-generator").ExportSettings = {
        title:    project.title        || "Untitled",
        author:   project.author_name  || "Unknown Author",
        template: String(req.query.template || project.genre || "modern-novel"),
        trimSize: String(req.query.trim || projTrim || '6" × 9" (US Trade)'),
        target:   String(req.query.target || projTarget || "Generic PDF"),
        templateConfig: mergedConfig,
      };

      const safeTitle = (settings.title || "manuscript")
        .replace(/[^a-z0-9_\- ]/gi, "")
        .trim()
        .replace(/\s+/g, "_")
        .slice(0, 80);

      let exportTypes: ParagraphType[] | undefined;
      let confirmedParas: ConfirmedParagraph[] | undefined;
      try {
        const { data: ext } = await supabaseAdmin
          .from("projects")
          .select("manuscript_structure")
          .eq("id", id)
          .single();
        if (ext && (ext as any).manuscript_structure) {
          const raw = (ext as any).manuscript_structure;
          if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "object" && raw[0].text !== undefined) {
            confirmedParas = raw as ConfirmedParagraph[];
          }
        }
      } catch {}
      if (!confirmedParas) {
        confirmedParas = confirmedStructures.get(id);
      }
      if (confirmedParas && confirmedParas.length > 0) {
        text = confirmedParas.map(p => p.text).join("\n\n");
        exportTypes = confirmedParas.map(p => p.type as ParagraphType);
      }

      console.log(`[Export] Generating ${format.toUpperCase()} for project=${id} template=${settings.template} structure=${exportTypes ? "confirmed" : "auto"}`);

      if (format === "pdf") {
        const buffer = await generatePDF(text, settings, exportTypes);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}_formatted.pdf"`);
        res.setHeader("Content-Length", buffer.length);
        return res.send(buffer);
      }

      if (format === "docx") {
        const buffer = await generateDOCX(text, settings, exportTypes);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}_formatted.docx"`);
        res.setHeader("Content-Length", buffer.length);
        return res.send(buffer);
      }

      if (format === "epub") {
        const buffer = await generateEPUB(text, settings, exportTypes);
        res.setHeader("Content-Type", "application/epub+zip");
        res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.epub"`);
        res.setHeader("Content-Length", buffer.length);
        return res.send(buffer);
      }
    } catch (err: any) {
      console.error(`[Export] ${format} generation failed:`, err.message);
      return res.status(500).json({ message: `Failed to generate ${format.toUpperCase()}: ${err.message}` });
    }
  });

  // ── Corrections: accept / reject ──────────────────────────────────
  app.patch("/api/corrections/:id", requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const { status } = req.body;
      if (!["accepted", "rejected"].includes(status)) {
        return res.status(400).json({ message: "Status must be accepted or rejected" });
      }

      // Verify the correction belongs to a project the user owns
      const { data: correction } = await supabaseAdmin
        .from("corrections")
        .select("project_id")
        .eq("id", req.params.id)
        .single();

      if (correction?.project_id && !(await verifyOwnership(correction.project_id, req.userId!))) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const { data, error } = await supabaseAdmin
        .from("corrections")
        .update({ status })
        .eq("id", req.params.id)
        .select()
        .single();

      if (error) throw error;

      if (data?.project_id) {
        const { count } = await supabaseAdmin
          .from("corrections")
          .select("id", { count: "exact", head: true })
          .eq("project_id", data.project_id)
          .eq("status", "pending");

        if (count === 0) {
          await safeUpdate("projects", { status: "Completed" }, data.project_id);
        }
      }

      res.json({ success: true, correction: data });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  return httpServer;
}

// ── Background AI pipeline ────────────────────────────────────────

async function processManuscript(
  projectId: string,
  rawText: string,
  filename: string,
  mode: "fast" | "full" = "full"
): Promise<void> {
  console.log(`\n[Pipeline] ===== START project=${projectId} file=${filename} =====`);

  if (!rawText || rawText.trim().length === 0) {
    console.error("[Pipeline] Empty manuscript text — aborting");
    await forceStatus(projectId, "failed", "Could not read file: manuscript appeared empty.");
    return;
  }

  console.log(`[Pipeline] Text: ${rawText.length} chars, ~${rawText.split(/\s+/).length} words, mode=${mode}`);

  const onProgress = async (pct: number) => {
    await safeUpdate("projects", { processing_progress: pct }, projectId);
  };

  await onProgress(5);

  // ── Pass 1: Auto-fix (caps, spelling, punctuation, spacing) ──
  let cleanedText = rawText;
  const pass1Progress = mode === "fast"
    ? (pct: number) => {
        const normalized = Math.max(0, Math.min(1, (pct - 5) / 45));
        return onProgress(Math.round(5 + normalized * 90));
      }
    : onProgress;
  try {
    console.log("[Pipeline] Running auto-fix pass (Pass 1)…");
    cleanedText = await runAutoFixPass(rawText, pass1Progress);
    console.log("[Pipeline] Auto-fix pass complete");
  } catch (err: any) {
    console.error("[Pipeline] Auto-fix pass failed, using raw text:", err.message);
    cleanedText = rawText;
  }

  await safeUpdate("projects", { cleaned_text: cleanedText }, projectId);

  // ── Pass 2: Suggestion pass (grammar/clarity — skipped in fast mode)
  let suggestions: Awaited<ReturnType<typeof runSuggestionPass>> = [];
  if (mode === "full") {
    await onProgress(50);
    try {
      console.log("[Pipeline] Running suggestion pass (Pass 2)…");
      suggestions = await runSuggestionPass(cleanedText, onProgress);
      console.log(`[Pipeline] Suggestion pass complete — ${suggestions.length} suggestions`);
    } catch (err: any) {
      console.error("[Pipeline] Suggestion pass failed:", err.message);
    }
  } else {
    console.log("[Pipeline] Fast mode — skipping suggestion pass");
  }

  await onProgress(92);

  // ── Save corrections ──────────────────────────────────────────
  if (suggestions.length > 0) {
    const validType = (t: string) =>
      ["grammar", "run-on", "clarity"].includes(t) ? t : "clarity";

    let saved = 0;
    for (const s of suggestions) {
      const ok = await insertCorrectionRow({
        project_id: projectId,
        original_text:  (s.original_text  || "").slice(0, 1000),
        suggested_text: (s.suggested_text || "").slice(0, 1000),
        reason:         (s.reason         || "").slice(0, 500),
        type:           validType(s.type),
        context_before: (s.context_before || "").slice(0, 500),
        context_after:  (s.context_after  || "").slice(0, 500),
        status:         "pending",
      });
      if (ok) saved++;
    }

    if (saved === 0) {
      console.error("[Pipeline] Could not save any corrections — treating as zero");
      suggestions = [];
    } else {
      console.log(`[Pipeline] Saved ${saved}/${suggestions.length} corrections`);
      suggestions = suggestions.slice(0, saved);
    }
  }

  // ── Final status ──────────────────────────────────────────────
  const finalStatus = suggestions.length > 0 ? "Review Required" : "Completed";
  const { error: finalErr } = await supabaseAdmin
    .from("projects")
    .update({ status: finalStatus, processing_progress: 100 })
    .eq("id", projectId);

  if (finalErr) {
    console.error("[Pipeline] Final status update failed:", finalErr.message);
    // Try without progress column
    await supabaseAdmin
      .from("projects")
      .update({ status: finalStatus })
      .eq("id", projectId);
  } else {
    console.log(`[Pipeline] ===== DONE project=${projectId} status=${finalStatus} =====\n`);
  }

  await safeUpdate("projects", { attention_required: suggestions.length > 0 }, projectId);
  await safeUpdate("projects", { ai_error: null }, projectId);
}
