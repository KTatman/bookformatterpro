import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { PlusCircle, BookOpen, Clock, MoreVertical, LayoutTemplate, Loader2, LogOut, User } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/apiFetch";
import { useToast } from "@/hooks/use-toast";

interface Project {
  id: string;
  title: string;
  author: string;
  status: string;
  lastModified: string;
  genre: string;
  attention: boolean;
}

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [, navigate] = useLocation();
  const { user, signOut } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    fetchProjects();
    // Show success message after Stripe checkout
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "success") {
      const plan = params.get("plan") || "paid";
      toast({
        title: "Payment successful!",
        description: `Your ${plan === "pro" ? "Pro" : "Single Book"} plan is now active. Thank you!`,
      });
      // Clean up the URL
      window.history.replaceState({}, "", "/dashboard");
    }
  }, []);

  const fetchProjects = async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch("/api/projects");
      if (res.ok) {
        const data = await res.json();
        if (data.projects) {
          setProjects(data.projects.map((p: any) => ({
            id: p.id,
            title: p.title || "Untitled Project",
            author: p.author_name || "",
            status: p.status || "Draft",
            lastModified: new Date(p.updated_at || p.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
            genre: p.genre || "Standard",
            attention: p.attention_required || p.status === "Review Required",
          })));
        } else {
          setProjects([]);
        }
      }
    } catch (err) {
      console.error("Error fetching projects:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const handleDeleteProject = async (projectId: string) => {
    try {
      const res = await apiFetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (res.ok) {
        setProjects(prev => prev.filter(p => p.id !== projectId));
        toast({ title: "Project deleted" });
      }
    } catch {
      toast({ title: "Failed to delete project", variant: "destructive" });
    }
  };

  const statusStyle = (status: string, attention: boolean) => {
    if (attention || status === "Review Required") return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border border-amber-200 dark:border-amber-800";
    if (status === "Completed") return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border border-green-200 dark:border-green-800";
    if (status === "processing") return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200 dark:border-blue-800";
    return "bg-muted text-muted-foreground border border-border/50";
  };

  const userInitial = user?.email?.[0]?.toUpperCase() ?? "A";
  const userEmail = user?.email ?? "";
  const planLabel = (user?.user_metadata?.plan as string | undefined) ?? "Free";

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="border-b bg-card sticky top-0 z-40">
        <div className="container px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" />
            <span className="text-xl font-serif font-bold text-foreground">BookFormatter</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="sm" className="text-muted-foreground">Home</Button>
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="flex items-center gap-2 h-9 px-3" data-testid="button-user-menu">
                  <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium border border-primary/20 text-sm">
                    {userInitial}
                  </div>
                  <span className="hidden md:block text-sm text-muted-foreground max-w-[160px] truncate">{userEmail}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem className="text-muted-foreground text-xs" disabled>
                  <User className="h-3 w-3 mr-2" />{userEmail}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleSignOut} className="text-destructive" data-testid="button-signout">
                  <LogOut className="h-4 w-4 mr-2" />Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <div className="container px-4 py-8 max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-serif font-bold mb-2">My Projects</h1>
            <p className="text-muted-foreground">Manage your manuscripts and formatting projects.</p>
          </div>
          <Link href="/project/new">
            <Button size="lg" className="rounded-full shadow-sm gap-2" data-testid="button-new-project">
              <PlusCircle className="h-5 w-5" />
              New Project
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <Card className="bg-card shadow-sm border-border/50">
            <CardHeader className="pb-2">
              <CardDescription>Projects this month</CardDescription>
              <CardTitle className="text-3xl" data-testid="stat-project-count">{projects.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card className="bg-card shadow-sm border-border/50">
            <CardHeader className="pb-2">
              <CardDescription>Awaiting Review</CardDescription>
              <CardTitle className="text-3xl text-amber-600" data-testid="stat-review-count">
                {projects.filter(p => p.attention).length}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card className="bg-card shadow-sm border-border/50">
            <CardHeader className="pb-2">
              <CardDescription>Active Plan</CardDescription>
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl capitalize" data-testid="stat-plan">{planLabel}</CardTitle>
                <Link href="/#pricing">
                  <Button variant="link" size="sm" className="h-auto p-0">Upgrade</Button>
                </Link>
              </div>
            </CardHeader>
          </Card>
        </div>

        <h2 className="text-xl font-semibold mb-4">Recent Manuscripts</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {isLoading ? (
            <div className="col-span-full flex justify-center items-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <>
              {projects.map((project) => (
                <Card key={project.id} data-testid={`card-project-${project.id}`} className="flex flex-col group hover:shadow-md transition-all duration-200 border-border/50">
                  <CardHeader className="pb-3">
                    <div className="flex justify-between items-start">
                      <div className={`px-2 py-1 rounded text-xs font-medium capitalize ${statusStyle(project.status, project.attention)}`}>
                        {project.status === "processing" ? "AI Processing..." : project.status}
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 -mr-2 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => handleDeleteProject(project.id)}
                            data-testid={`button-delete-${project.id}`}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <CardTitle className="text-xl mt-2 font-serif leading-tight">{project.title}</CardTitle>
                    <CardDescription className="flex items-center gap-1 mt-1">
                      <LayoutTemplate className="h-3 w-3" />
                      {project.genre}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1">
                    <div className="flex items-center text-sm text-muted-foreground">
                      <Clock className="h-4 w-4 mr-2" />
                      Last updated {project.lastModified}
                    </div>
                  </CardContent>
                  <CardFooter className="pt-0 border-t mt-4 p-4 bg-muted/10">
                    {project.attention ? (
                      <Link href={`/project/${project.id}/review`} className="w-full">
                        <Button className="w-full bg-amber-600 hover:bg-amber-700 text-white shadow-sm">Review AI Edits</Button>
                      </Link>
                    ) : (
                      <Link href={`/project/${project.id}`} className="w-full">
                        <Button variant="outline" className="w-full bg-card hover:bg-muted">Open Project</Button>
                      </Link>
                    )}
                  </CardFooter>
                </Card>
              ))}

              <Link href="/project/new" className="block">
                <Card className="h-full min-h-[240px] flex flex-col items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/50 border-dashed border-2 bg-transparent transition-all cursor-pointer group">
                  <div className="h-16 w-16 rounded-full bg-muted/50 group-hover:bg-primary/10 flex items-center justify-center mb-4 transition-colors">
                    <PlusCircle className="h-8 w-8" />
                  </div>
                  <p className="font-medium text-lg">Create New Project</p>
                  <p className="text-sm mt-1">Upload a new manuscript</p>
                </Card>
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
