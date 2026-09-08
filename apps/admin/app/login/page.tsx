import { AdminLoginPanel } from "@/components/AdminLoginPanel";

interface LoginSearchParams {
  next?: string | string[];
}

export default async function LoginPage({ searchParams }: Readonly<{ searchParams: Promise<LoginSearchParams> }>) {
  const params = await searchParams;
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next;
  const nextPath = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") && !rawNext.startsWith("/api/admin/auth") ? rawNext : "/";
  return <AdminLoginPanel nextPath={nextPath} />;
}
