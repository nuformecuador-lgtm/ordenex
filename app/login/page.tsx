import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/lib/constants/auth";
import { SessionRepository } from "@/lib/repositories/SessionRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { Logo } from "@/components/shared/Logo";
import { VolverAlInicioLink } from "@/components/shared/VolverAlInicioLink";
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
      redirect("/dashboard");
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
          <Logo />
          <div className="mt-3 h-1 w-10 rounded-full bg-brand" />
        </div>
        <p className="relative max-w-sm text-sm leading-relaxed text-white/70">
          La plataforma que ordena la operación de tu equipo, de punta a punta.
        </p>
      </div>

      {/* Panel de formulario. La salida a la landing ocupa su propia franja
        ARRIBA, en el flujo del flex, y el formulario se centra en el espacio
        que queda (el hijo `flex-1` con `justify-center`).

        Antes iba `absolute left-3 top-3` sobre un panel `relative`, para no
        empujar el formulario hacia abajo. Eso pisaba la tarjeta: con `py-12`
        la tarjeta arranca en y=48 en cuanto es más alta que el panel —ahí
        `justify-center` ya no centra nada— y el enlace, de 44 px desde y=12,
        acaba en y=56; su `hover:bg-muted` se metía sobre la esquina superior
        izquierda (medido en /postulacion: franja de 54x8 px). Con el enlace en
        el flujo el solape es imposible por construcción, no evitado con un
        desplazamiento afinado a mano que volvería a romperse al cambiar el
        tamaño de la tarjeta. Por eso el panel ya no necesita `relative`: era
        el ancla de ese absoluto y nada más colgaba de él.

        Va en ESTE panel y no en el de marca (`hidden ... md:flex`), porque en
        móvil el de marca no existe y es justo ahí donde esta es la única
        salida de la pantalla. */}
      <div className="flex flex-1 flex-col gap-6 bg-background px-6 py-12">
        <VolverAlInicioLink className="self-start" />
        <div className="flex flex-1 flex-col items-center justify-center gap-8">
          {/* Wordmark compacto, solo visible en móvil (el panel de marca cubre desktop) */}
          <div className="md:hidden">
            {/* Feature 208: el wordmark de móvil vive sobre `bg-background`, que gira
              con el tema; en `navy` fijo medía 1.06:1 en oscuro. (El panel de marca de
              escritorio, `bg-navy` con texto blanco, es superficie FIJA y se conserva.) */}
            <Logo className="text-xl text-foreground" />
          </div>
          <LoginForm redirectParam={redirectParam} />
        </div>
      </div>
    </div>
  );
}
