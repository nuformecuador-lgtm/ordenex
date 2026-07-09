import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/lib/constants/auth";
import { SessionRepository } from "@/lib/repositories/SessionRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { LogoutButton } from "@/app/_components/LogoutButton";

export default async function Home() {
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
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center justify-between py-32 px-16 bg-white dark:bg-black sm:items-start">
        <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left">
          <h1 className="max-w-xs text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50">
            Bienvenido
          </h1>
          <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
            Has iniciado sesión correctamente
          </p>

          {/* Minimal logout button for E2E coverage (R25, R26) */}
          {/* This button is a minimal affordance to unblock T021 of specs/login/tasks.md. */}
          {/* It is not part of a full dashboard feature; if a full authenticated home exists */}
          {/* in the future, this button should be moved/replaced there. */}
          {hasValidSession && (
            <div className="mt-6">
              <LogoutButton />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
