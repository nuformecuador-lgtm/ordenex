import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/lib/constants/auth";
import { SessionRepository } from "@/lib/repositories/SessionRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { LoginForm } from "./_components/LoginForm";

export default async function LoginPage(props: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  // Verificar si hay una sesión válida (R24)
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (sessionId) {
    const prisma = getPrismaClient();
    const sessionRepo = new SessionRepository(prisma);
    const session = await sessionRepo.findValidById(sessionId);

    if (session) {
      redirect("/");
    }
  }

  // Leer el parámetro de redirección
  const searchParams = await props.searchParams;
  const redirectParam = searchParams.redirect || null;

  return (
    <div className="flex items-center justify-center min-h-screen bg-zinc-50 dark:bg-black">
      <LoginForm redirectParam={redirectParam} />
    </div>
  );
}
