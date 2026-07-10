import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/lib/constants/auth";
import { SessionRepository } from "@/lib/repositories/SessionRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { LogoutButton } from "@/app/_components/LogoutButton";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { AdminTiendaDashboard } from "@/app/(app)/_components/AdminTiendaDashboard";
import { PageHeader } from "@/components/shared/PageHeader";

export default async function Home() {
  // Ramificación por rol resuelta SOLO server-side (feature 26, R5): el
  // `adminTienda` ve su dashboard/apartado (R1); cualquier otro rol o sesión
  // ausente conserva el placeholder "Bienvenido" (R3, R4).
  const actor = await resolveActorFromSession();
  if (actor?.rol === "adminTienda") {
    return <AdminTiendaDashboard />;
  }

  // Check for valid session (R25)
  let hasValidSession = false;

  try {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    if (sessionId) {
      const prisma = getPrismaClient();
      const sessionRepo = new SessionRepository(prisma);
      const session = await sessionRepo.findValidById(sessionId);
      hasValidSession = !!session;
    }
  } catch {
    // If there's an error checking the session, treat as no session
    hasValidSession = false;
  }

  return (
    <div className="flex flex-col flex-1 gap-6 bg-zinc-50 font-sans dark:bg-black">
      <PageHeader
        title="Bienvenido"
        description="Has iniciado sesión correctamente"
      />

      {/* Minimal logout button for E2E coverage (R25, R26) */}
      {/* This button is a minimal affordance to unblock T021 of specs/login/tasks.md. */}
      {/* It is not part of a full dashboard feature; if a full authenticated home exists */}
      {/* in the future, this button should be moved/replaced there. */}
      {hasValidSession && (
        <div className="px-16">
          <LogoutButton />
        </div>
      )}
    </div>
  );
}
