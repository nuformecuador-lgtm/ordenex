import { Suspense } from "react";

import { LandingBanda } from "./_landing/LandingBanda";
import { LandingComoFunciona } from "./_landing/LandingComoFunciona";
import { LandingConteos } from "./_landing/LandingConteos";
import { LandingFooter } from "./_landing/LandingFooter";
import { LandingHero } from "./_landing/LandingHero";
import { LandingNav } from "./_landing/LandingNav";
import { LandingPoliticas } from "./_landing/LandingPoliticas";
import { LandingPostular } from "./_landing/LandingPostular";
import { LandingServicios } from "./_landing/LandingServicios";

/**
 * Landing pública en `/`: réplica del home de ordenex.co.
 *
 * Server Component fuera del grupo `(app)` → no hereda el Sidebar ni
 * `resolveActorFromSession`. Lee UN dato publico (los conteos de la feature 198), en
 * `<Suspense>` y tolerante a fallo: la landing nunca depende de el.
 *
 * El sitio define su maquetado en clases `lp-*`; aquí se traduce a utilidades
 * Tailwind sobre los tokens de marca que `globals.css` ya expone (`brand`,
 * `navy-deep`, escala `asfalto`, `kraft-*`, `ink-blue`), sin CSS suelto ni hex
 * ad-hoc (DESIGN.md).
 *
 * Los tres puntos donde el sitio pone fotografía ya las llevan, desde
 * `public/landing/`: fondo del hero (bodega), banda intermedia (paquetes) y
 * cabecera de las tarjetas de postulación (logística, bodega y mensajera). Todas
 * son DECORATIVAS —`alt=""`— porque lo que comunican ya está en los titulares, y
 * todas van bajo un degradado navy que sostiene el contraste del texto blanco. El
 * `bg-navy-deep` de cada sección sigue siendo el respaldo si una foto no carga.
 *
 * Van con `next/image`, que las sirve optimizadas y en el tamaño que pide cada
 * hueco: sin eso las cuatro fotos suman ~2 MB en la página de entrada del sitio.
 *
 * Durante un tiempo NO se pintaba ninguna, y la causa no estaba aquí: el `matcher`
 * del middleware excluía `.svg` pero no `.jpg`, así que la petición de cada foto se
 * trataba como ruta privada y salía en 307 a /login. Corregido en `middleware.ts`;
 * si algún día vuelven a desaparecer todas a la vez, ese es el primer sitio donde
 * mirar, y no las rutas de `public/`.
 */
export default function LandingPage() {
  return (
    <div className="min-h-dvh overflow-x-clip bg-kraft-canvas font-sans text-asfalto-9">
      <LandingNav />
      <main>
        <LandingHero />
        <LandingServicios />
        {/* Feature 198: las cifras publicas. Van en `<Suspense>` a proposito —pedido
            humano: NO bloqueante—: la landing se pinta entera y estas llegan despues por
            streaming, asi que una lectura lenta nunca retrasa el hero. El fallback es
            `null` y no un esqueleto: es un bloque decorativo, y un hueco animado que
            aparece y desaparece llama mas la atencion que la cifra misma. */}
        <Suspense fallback={null}>
          <LandingConteos />
        </Suspense>
        <LandingBanda />
        <LandingComoFunciona />
        <LandingPoliticas />
        <LandingPostular />
      </main>
      <LandingFooter />
    </div>
  );
}
