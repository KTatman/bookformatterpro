import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://pofrdafqjzutzxyygpgu.supabase.co";

// Prefer service role key (bypasses RLS) — fall back to anon/publishable key
const supabaseKey =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "sb_publishable_mp_IZqov4BLWayDXerxb8A_Zs23etyp";

if (!process.env.SUPABASE_SERVICE_KEY) {
  console.warn(
    "[Supabase] WARNING: SUPABASE_SERVICE_KEY is not set. " +
    "Using anon/publishable key — DB writes will fail if Row Level Security is enabled on your tables. " +
    "Disable RLS on the projects and corrections tables in Supabase, or add SUPABASE_SERVICE_KEY to Replit Secrets."
  );
}

export const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});
