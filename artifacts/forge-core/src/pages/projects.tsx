import { useListProjects } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FolderKanban } from "lucide-react";

export default function Projects() {
  const { data: projects, isLoading } = useListProjects();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight uppercase">Projects</h1>
          <p className="text-muted-foreground">Active development initiatives</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects?.map(project => (
          <Card key={project.id} className="hover:border-primary/50 transition-colors cursor-pointer border-border/50 bg-card/50">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <FolderKanban className="w-5 h-5 text-primary" />
                  {project.name}
                </CardTitle>
                <Badge variant="outline" className="uppercase text-[10px]">{project.status}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground line-clamp-2 min-h-[40px]">
                {project.description || "No description provided."}
              </p>
              <div className="mt-4 text-xs font-mono text-muted-foreground">
                Created: {new Date(project.createdAt).toLocaleDateString()}
              </div>
            </CardContent>
          </Card>
        ))}
        {projects?.length === 0 && (
          <div className="col-span-full p-12 text-center border border-dashed rounded-lg border-border text-muted-foreground">
            No projects found.
          </div>
        )}
      </div>
    </div>
  );
}
