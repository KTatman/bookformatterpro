import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BookOpen, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

export default function Auth() {
  const [, navigate] = useLocation();
  const { signIn, signUp } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerConfirm, setRegisterConfirm] = useState("");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await signIn(loginEmail, loginPassword);
    setLoading(false);
    if (error) {
      toast({ title: "Login failed", description: error, variant: "destructive" });
    } else {
      navigate("/dashboard");
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (registerPassword !== registerConfirm) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    if (registerPassword.length < 6) {
      toast({ title: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }
    setLoading(true);
    const { error } = await signUp(registerEmail, registerPassword);
    setLoading(false);
    if (error) {
      toast({ title: "Sign up failed", description: error, variant: "destructive" });
    } else {
      toast({
        title: "Account created!",
        description: "Check your email to confirm your account, then log in.",
      });
    }
  }

  return (
    <div className="min-h-screen bg-muted/20 flex flex-col">
      <header className="px-6 py-4 border-b bg-background/80 backdrop-blur-sm">
        <Link href="/">
          <div className="flex items-center gap-2 cursor-pointer w-fit">
            <BookOpen className="h-6 w-6 text-primary" />
            <span className="text-xl font-serif font-bold text-primary">BookFormatter Pro</span>
          </div>
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <Tabs defaultValue="login">
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="login" data-testid="tab-login">Log In</TabsTrigger>
              <TabsTrigger value="register" data-testid="tab-register">Create Account</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <Card className="shadow-md border-border/50">
                <CardHeader className="space-y-1">
                  <CardTitle className="text-2xl font-serif">Welcome back</CardTitle>
                  <CardDescription>Log in to your BookFormatter Pro account</CardDescription>
                </CardHeader>
                <form onSubmit={handleLogin}>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="login-email">Email</Label>
                      <Input
                        id="login-email"
                        data-testid="input-login-email"
                        type="email"
                        placeholder="author@example.com"
                        value={loginEmail}
                        onChange={e => setLoginEmail(e.target.value)}
                        required
                        autoComplete="email"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="login-password">Password</Label>
                      <Input
                        id="login-password"
                        data-testid="input-login-password"
                        type="password"
                        placeholder="••••••••"
                        value={loginPassword}
                        onChange={e => setLoginPassword(e.target.value)}
                        required
                        autoComplete="current-password"
                      />
                    </div>
                  </CardContent>
                  <CardFooter>
                    <Button
                      data-testid="button-login"
                      type="submit"
                      className="w-full rounded-full"
                      disabled={loading}
                    >
                      {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Log In
                    </Button>
                  </CardFooter>
                </form>
              </Card>
            </TabsContent>

            <TabsContent value="register">
              <Card className="shadow-md border-border/50">
                <CardHeader className="space-y-1">
                  <CardTitle className="text-2xl font-serif">Start for free</CardTitle>
                  <CardDescription>Create your account — no credit card required</CardDescription>
                </CardHeader>
                <form onSubmit={handleRegister}>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="reg-email">Email</Label>
                      <Input
                        id="reg-email"
                        data-testid="input-register-email"
                        type="email"
                        placeholder="author@example.com"
                        value={registerEmail}
                        onChange={e => setRegisterEmail(e.target.value)}
                        required
                        autoComplete="email"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="reg-password">Password</Label>
                      <Input
                        id="reg-password"
                        data-testid="input-register-password"
                        type="password"
                        placeholder="••••••••"
                        value={registerPassword}
                        onChange={e => setRegisterPassword(e.target.value)}
                        required
                        autoComplete="new-password"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="reg-confirm">Confirm Password</Label>
                      <Input
                        id="reg-confirm"
                        data-testid="input-register-confirm"
                        type="password"
                        placeholder="••••••••"
                        value={registerConfirm}
                        onChange={e => setRegisterConfirm(e.target.value)}
                        required
                        autoComplete="new-password"
                      />
                    </div>
                  </CardContent>
                  <CardFooter>
                    <Button
                      data-testid="button-register"
                      type="submit"
                      className="w-full rounded-full"
                      disabled={loading}
                    >
                      {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Create Account
                    </Button>
                  </CardFooter>
                </form>
              </Card>
              <p className="text-center text-sm text-muted-foreground mt-4">
                By creating an account you agree to our{" "}
                <a href="#" className="underline hover:text-primary">Terms of Service</a>.
              </p>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
