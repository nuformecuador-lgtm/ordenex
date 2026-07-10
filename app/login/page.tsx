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
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Panel de marca: visible desde md, oculto en móvil para no forzar scroll */}
      <div className="relative hidden overflow-hidden bg-navy px-12 py-16 text-white md:flex md:w-1/2 md:flex-col md:justify-between lg:w-[45%]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(242,100,25,0.16),transparent_55%)]"
        />
        <div className="relative">
          <span className="font-heading text-2xl font-semibold tracking-tight">
            Ordenex
          </span>
          <div className="mt-3 h-1 w-10 rounded-full bg-brand" />
        </div>
        <p className="relative max-w-sm text-sm leading-relaxed text-white/70">
          La plataforma que ordena la operación de tu equipo, de punta a punta.
        </p>
      </div>

      {/* Panel de formulario */}
      <div className="flex flex-1 flex-col items-center justify-center gap-8 bg-background px-6 py-12">
        {/* Wordmark compacto, solo visible en móvil (el panel de marca cubre desktop) */}
        <div className="md:hidden">
          <span className="font-heading text-xl font-semibold tracking-tight text-navy">
            Ordenex
          </span>
        </div>
        <LoginForm redirectParam={redirectParam} />
      </div>
    </div>
  );
}
