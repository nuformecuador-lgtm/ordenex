import { LandingBanda } from "./_landing/LandingBanda";
import { LandingComoFunciona } from "./_landing/LandingComoFunciona";
import { LandingFooter } from "./_landing/LandingFooter";
import { LandingHero } from "./_landing/LandingHero";
import { LandingNav } from "./_landing/LandingNav";
import { LandingPoliticas } from "./_landing/LandingPoliticas";
import { LandingPostular } from "./_landing/LandingPostular";
import { LandingServicios } from "./_landing/LandingServicios";

/**
 * Landing pública en `/`: réplica del home de ordenex.co, **sin imágenes**.
 *
 * Server Component fuera del grupo `(app)` → no hereda el Sidebar ni
 * `resolveActorFromSession`. Sin fetch de datos.
 *
 * El sitio define su maquetado en clases `lp-*`; aquí se traduce a utilidades
 * Tailwind sobre los tokens de marca que `globals.css` ya expone (`brand`,
 * `navy-deep`, escala `asfalto`, `kraft-*`, `ink-blue`), sin CSS suelto ni hex
 * ad-hoc (DESIGN.md). Los tres puntos donde el sitio pone una fotografía —fondo
 * del hero, banda intermedia y cabecera de las tarjetas de postulación— quedan
 * resueltos con el navy y el halo naranja que ya usan las páginas públicas.
 */
export default function LandingPage() {
  return (
    <div className="min-h-dvh overflow-x-clip bg-kraft-canvas font-sans text-asfalto-9">
      <LandingNav />
      <main>
        <LandingHero />
        <LandingServicios />
        <LandingBanda />
        <LandingComoFunciona />
        <LandingPoliticas />
        <LandingPostular />
      </main>
      <LandingFooter />
    </div>
  );
}
