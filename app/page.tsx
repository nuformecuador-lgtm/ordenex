import Link from "next/link";
import { Logo } from "@/components/shared/Logo";
import { buttonVariants } from "@/components/ui/button";

/**
 * Landing pública en `/` (feature 86, R1–R5). Server Component fuera del grupo
 * `(app)` → no hereda el Sidebar ni `resolveActorFromSession`. Sin fetch de datos
 * (no hay datos que cargar). Reutiliza el patrón «brand panel» de las páginas
 * públicas (`bg-navy` + radial-gradient naranja + barra `bg-brand`) y la paleta
 * de marca ya existente, sin introducir tokens ni copy de marketing (R4, R5).
 * El único texto descriptivo es el de `metadata.description` del root layout.
 */
export default function LandingPage() {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-navy text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(242,100,25,0.16),transparent_55%)]"
      />

      {/* Topbar: logo + enlaces «Trabaja con nosotros» → /postulacion e «Ingreso» → /login (R2) */}
      <header className="relative flex items-center justify-between px-6 py-5 sm:px-10">
        <Logo />
        <nav className="flex items-center gap-4 sm:gap-6">
          <Link
            href="/postulacion"
            className="text-sm font-medium text-white/80 transition-colors hover:text-white"
          >
            Trabaja con nosotros
          </Link>
          <Link
            href="/login"
            className="text-sm font-medium text-white/80 transition-colors hover:text-white"
          >
            Ingreso
          </Link>
        </nav>
      </header>

      {/* Hero: wordmark/claim + los 2 CTA (R3) */}
      <main className="relative flex flex-1 flex-col items-center justify-center gap-8 px-6 text-center">
        <div className="flex flex-col items-center gap-4">
          <Logo className="text-4xl sm:text-5xl" />
          <div className="h-1 w-12 rounded-full bg-brand" />
          <p className="max-w-md text-base leading-relaxed text-white/70">
            Plataforma de logística y entregas Ordenex
          </p>
        </div>
        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href="/login"
            className={buttonVariants({ variant: "brand-outline", size: "lg" })}
          >
            Ingreso
          </Link>
          <Link
            href="/postulacion"
            className={buttonVariants({ variant: "brand-outline", size: "lg" })}
          >
            Trabaja con nosotros
          </Link>
        </div>
      </main>
    </div>
  );
}
