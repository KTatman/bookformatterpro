import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { BookOpen, CheckCircle, FileText, ArrowRight, Sparkles, LogIn, UserPlus } from "lucide-react";
import { TEMPLATES, TemplateMarketingCard } from "@/components/TemplatePreview";
import heroImage from "../assets/hero.jpg";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/apiFetch";
import { useToast } from "@/hooks/use-toast";

export default function Home() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const handleStartClick = () => navigate(user ? "/dashboard" : "/auth");

  const handleCheckout = async (plan: "single" | "pro") => {
    if (!user) { navigate("/auth"); return; }
    try {
      const res = await apiFetch("/api/checkout/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) {
        const err = await res.json();
        toast({ title: "Checkout unavailable", description: err.message, variant: "destructive" });
        return;
      }
      const { url } = await res.json();
      if (url) window.location.href = url;
    } catch {
      toast({ title: "Checkout error", description: "Could not start checkout. Please try again.", variant: "destructive" });
    }
  };

  const handleCheckoutSingle = () => handleCheckout("single");
  const handleCheckoutPro    = () => handleCheckout("pro");

  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      <header className="px-6 py-4 flex items-center justify-between border-b bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <BookOpen className="h-6 w-6 text-primary" />
          <span className="text-xl font-serif font-bold text-primary">BookFormatter Pro</span>
        </div>
        <nav className="hidden md:flex gap-6">
          <a href="#features" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">Features</a>
          <a href="#templates" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">Templates</a>
          <a href="#pricing" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">Pricing</a>
        </nav>
        <div className="flex items-center gap-4">
          {user ? (
            <Link href="/dashboard">
              <Button className="rounded-full px-6 shadow-md hover:shadow-lg transition-all">My Dashboard</Button>
            </Link>
          ) : (
            <>
              <Link href="/auth">
                <Button variant="ghost" className="hidden md:inline-flex gap-2" data-testid="button-nav-login">
                  <LogIn className="h-4 w-4" />Log In
                </Button>
              </Link>
              <Link href="/auth">
                <Button className="rounded-full px-6 shadow-md hover:shadow-lg transition-all" data-testid="button-nav-signup">
                  <UserPlus className="h-4 w-4 mr-2" />Start Free
                </Button>
              </Link>
            </>
          )}
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative pt-20 pb-32 overflow-hidden">
          <div className="absolute inset-0 z-0">
            <div className="absolute inset-0 bg-gradient-to-r from-background via-background/90 to-background/20 z-10"></div>
            <img src={heroImage} alt="Professional formatting" className="w-full h-full object-cover object-right opacity-30 md:opacity-100" />
          </div>
          
          <div className="container px-4 md:px-6 relative z-20">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary mb-6 border border-primary/20">
                <Sparkles className="h-4 w-4" />
                <span className="text-sm font-medium">AI-Powered Proofreading Included</span>
              </div>
              <h1 className="text-5xl md:text-7xl font-serif font-bold tracking-tight text-foreground mb-6 leading-[1.1]">
                Your manuscript, <br />
                <span className="text-primary italic">perfectly formatted.</span>
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground mb-8 leading-relaxed max-w-xl">
                The professional formatting and AI proofreading platform built by self-published authors, for self-published authors. Preserve your voice while achieving traditional publishing standards.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Button
                  size="lg"
                  className="rounded-full px-8 text-base h-14 shadow-lg hover:shadow-xl transition-all"
                  onClick={handleStartClick}
                  data-testid="button-hero-cta"
                >
                  Format Your Book
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
                <Button size="lg" variant="outline" className="rounded-full px-8 text-base h-14 bg-background/50 backdrop-blur-sm border-2">
                  View Sample Outputs
                </Button>
              </div>
              
              <div className="mt-12 flex items-center gap-8 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-primary" />
                  <span>KDP & IngramSpark Ready</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-primary" />
                  <span>You Keep Full Control</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="py-24 bg-muted/30">
          <div className="container px-4 md:px-6">
            <div className="text-center mb-16 max-w-3xl mx-auto">
              <h2 className="text-4xl font-serif font-bold mb-4">Publishing-quality results in minutes</h2>
              <p className="text-lg text-muted-foreground">Stop spending days on formatting. BookFormatter Pro handles the technical work so you can focus on the writing.</p>
            </div>
            <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
              {[
                {
                  icon: <FileText className="h-8 w-8 text-primary" />,
                  title: "Smart Auto-Formatting",
                  desc: "Upload your DOCX or TXT and watch it transform into a print-ready manuscript with proper margins, spacing, and chapter headers—automatically."
                },
                {
                  icon: <Sparkles className="h-8 w-8 text-primary" />,
                  title: "Two-Pass AI Proofreading",
                  desc: "Silent Pass 1 fixes typos, spacing, and capitalization. Pass 2 surfaces grammar and clarity issues for you to accept or reject—keeping your voice intact."
                },
                {
                  icon: <BookOpen className="h-8 w-8 text-primary" />,
                  title: "Export Everywhere",
                  desc: "Generate KDP-ready PDFs, EPUB3 for digital stores, and DOCX for editors—all from a single upload, with your chosen template applied."
                },
              ].map((f, i) => (
                <div key={i} className="bg-card rounded-2xl p-8 border border-border/50 shadow-sm">
                  <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center mb-6">
                    {f.icon}
                  </div>
                  <h3 className="text-xl font-bold mb-3">{f.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Templates */}
        <section id="templates" className="py-24 bg-muted/20">
          <div className="container px-4 md:px-6">
            <div className="text-center mb-14 max-w-3xl mx-auto">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary mb-4 text-sm font-medium border border-primary/20">
                <BookOpen className="h-4 w-4" /> Publishing-grade templates
              </div>
              <h2 className="text-4xl md:text-5xl font-serif font-bold mb-4">See what your book will actually look like</h2>
              <p className="text-lg text-muted-foreground">
                Representative interior previews — title pages, chapter openings, body text, and TOCs — showing the typography, spacing, and hierarchy each template applies to your manuscript.
              </p>
            </div>
            <div className="grid md:grid-cols-2 gap-8 max-w-6xl mx-auto">
              {TEMPLATES.map((t) => (
                <TemplateMarketingCard key={t.id} t={t} />
              ))}
            </div>
            <div className="text-center mt-12">
              <Button onClick={handleStartClick} size="lg" className="rounded-full px-8 shadow-md hover:shadow-lg" data-testid="button-templates-cta">
                Try a template free <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="py-24 bg-muted/30">
          <div className="container px-4 md:px-6">
            <div className="text-center mb-16 max-w-3xl mx-auto">
              <h2 className="text-4xl font-serif font-bold mb-4">Simple, honest pricing</h2>
              <p className="text-lg text-muted-foreground">Start for free. Upgrade only when you're ready to publish.</p>
            </div>
            <div className="grid md:grid-cols-4 gap-6 max-w-7xl mx-auto mb-24">
              {[
                {
                  name: "Free",
                  price: "$0",
                  desc: "Test the waters",
                  features: ["1 project per month", "Up to 2,500 words", "DOCX export only", "Basic formatting", "Watermark on exports"],
                  cta: "Start Free",
                  plan: "free",
                  highlighted: false,
                },
                {
                  name: "Single Book",
                  price: "$7",
                  desc: "One-time payment",
                  features: ["1 manuscript", "Up to 50,000 words", "PDF, DOCX, and EPUB export", "No watermark"],
                  cta: "Buy Now — $7",
                  plan: "single",
                  highlighted: false,
                },
                {
                  name: "Pro",
                  price: "$19",
                  period: "/mo",
                  desc: "For prolific writers",
                  features: ["5 projects per month", "Up to 150,000 words", "All export formats", "Save custom templates", "No watermark", "Priority processing"],
                  cta: "Start Pro — $19/mo",
                  plan: "pro",
                  highlighted: true,
                },
                {
                  name: "Agency",
                  price: null,
                  desc: "For small presses",
                  features: ["20 projects per month", "Unlimited words", "All export formats", "Team access for 5 users", "No watermark", "Priority processing", "Priority support"],
                  cta: "Contact Us",
                  plan: "agency",
                  highlighted: false,
                },
              ].map((tier, i) => (
                <div key={i} className={`bg-card p-6 rounded-2xl border ${tier.highlighted ? 'ring-2 ring-primary shadow-xl relative md:-translate-y-2' : 'shadow-sm'}`}>
                  {tier.highlighted && (
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">
                      Recommended
                    </div>
                  )}
                  <h3 className="text-xl font-bold mb-2">{tier.name}</h3>
                  <div className="flex items-baseline gap-1 mb-2 h-12">
                    {tier.price ? (
                      <>
                        <span className="text-4xl font-bold">{tier.price}</span>
                        {tier.period && <span className="text-muted-foreground">{tier.period}</span>}
                      </>
                    ) : (
                      <span className="text-3xl font-bold text-foreground/80 mt-1">Custom</span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mb-6">{tier.desc}</p>
                  <Button
                    variant={tier.highlighted ? "default" : "outline"}
                    className="w-full rounded-full mb-6"
                    data-testid={`button-pricing-${tier.plan}`}
                    onClick={() => {
                      if (tier.plan === "free") handleStartClick();
                      else if (tier.plan === "single") handleCheckoutSingle();
                      else if (tier.plan === "pro") handleCheckoutPro();
                      else window.location.href = "mailto:hello@bookformatter.pro?subject=Agency Plan Inquiry";
                    }}
                  >
                    {tier.cta}
                  </Button>
                  <ul className="space-y-3">
                    {tier.features.map((f, j) => (
                      <li key={j} className="flex items-center gap-2 text-sm">
                        <CheckCircle className="h-4 w-4 text-primary shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            {/* FAQ Section */}
            <div className="max-w-3xl mx-auto">
              <div className="text-center mb-10">
                <h2 className="text-3xl font-serif font-bold mb-4">Frequently Asked Questions</h2>
                <p className="text-muted-foreground">Everything you need to know about formatting and proofing your book.</p>
              </div>
              
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="item-1">
                  <AccordionTrigger className="text-left font-bold text-lg">What does the AI automatically fix?</AccordionTrigger>
                  <AccordionContent className="text-muted-foreground leading-relaxed text-base">
                    By default, the AI only fixes objective errors: extra spaces, stray tabs, basic capitalization (like at the start of a sentence), and clear spelling mistakes. It will never alter your sentence structure, word choice, or punctuation style automatically.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="item-2">
                  <AccordionTrigger className="text-left font-bold text-lg">What changes go to the Review Page?</AccordionTrigger>
                  <AccordionContent className="text-muted-foreground leading-relaxed text-base">
                    Any suggestion that could alter your authorial voice or the meaning of a sentence goes to the Review Page. This includes grammar suggestions, run-on sentence splits, clarity improvements, and stylistic formatting. You have full control to accept or reject each one individually, while seeing your original text in context.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="item-3">
                  <AccordionTrigger className="text-left font-bold text-lg">What export formats are supported?</AccordionTrigger>
                  <AccordionContent className="text-muted-foreground leading-relaxed text-base">
                    We support all major publishing standards. You can export print-ready PDFs specifically tuned for Amazon KDP Print or IngramSpark, as well as validated EPUB3 files perfect for Kindle, Apple Books, Kobo, and Draft2Digital. We also support DOCX export.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="item-4">
                  <AccordionTrigger className="text-left font-bold text-lg">Can I customize the formatting templates?</AccordionTrigger>
                  <AccordionContent className="text-muted-foreground leading-relaxed text-base">
                    Yes! While we offer professionally designed templates (Modern Novel, Memoir, Fantasy Epic, Non-Fiction), Pro and Agency users can customize typography, chapter headers, line spacing, and margins, then save them as custom templates for future books in a series.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="item-5">
                  <AccordionTrigger className="text-left font-bold text-lg">Is my manuscript data safe?</AccordionTrigger>
                  <AccordionContent className="text-muted-foreground leading-relaxed text-base">
                    Absolutely. Your manuscript is your intellectual property. We do not use your book to train our AI models. The text is processed securely for your formatting and proofreading session and is kept private to your account.
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-muted py-12 border-t text-center">
        <div className="container px-4 md:px-6">
          <div className="flex items-center justify-center gap-2 mb-4">
            <BookOpen className="h-6 w-6 text-primary" />
            <span className="text-xl font-serif font-bold text-foreground">BookFormatter Pro</span>
          </div>
          <p className="text-muted-foreground text-sm">© 2026 BookFormatter Pro. Built by self-published authors.</p>
        </div>
      </footer>
    </div>
  );
}
