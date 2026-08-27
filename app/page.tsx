import { numGuiaDeQuery, PARAM_GUIA } from "./_landing/guia-en-url";
import { LandingBanda } from "./_landing/LandingBanda";
import { LandingComoFunciona } from "./_landing/LandingComoFunciona";
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
 * `resolveActorFromSession`. El unico dato que lee son los conteos publicos (feature 198), y
 * NO se leen aqui: cada seccion que los muestra —hero y banda— los pide dentro de su propio
 * `<Suspense>` (ver `_landing/cifras-publicas.tsx`). Si se subieran a este nivel con un
 * `await`, la pagina entera esperaria a la base antes de pintar una sola linea.
 *
 * El sitio define su maquetado en clases `lp-*`; aquí se traduce a utilidades
 * Tailwind sobre los tokens de marca que `globals.css` ya expone (`brand`,
 * `navy-deep`, escala `asfalto`, `kraft-*`, `ink-blue`), sin CSS suelto ni hex
 * ad-hoc (DESIGN.md).
 *
 * CLARA POR DISEÑO (feature 208). La landing no gira con el tema: su arte está
 * compuesto sobre fotografías y una paleta FIJA (`kraft-*`, `asfalto-*`,
 * `navy-deep`, `-soft`), que es exactamente lo que el sitio público muestra. La
 * clase `tema-claro` (ver `globals.css`) lo hace cumplible en vez de aspiracional:
 * fija los valores claros en este subárbol, así que el `.dark` que la fase 2 pondrá
 * en <html> no la alcanza de rebote por ningún token — hoy le llegaba por
 * `text-success-strong`, el único de la landing con variante oscura.
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
export default async function LandingPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  // `/?guia=4321` abre el rastreo con la guía ya puesta. Leer `searchParams` vuelve la página
  // dinámica —deja de prerenderizarse—, y es el precio conocido de admitir el enlace; NO añade
  // espera: no se consulta nada, solo se normaliza una cadena. Las cifras siguen resolviéndose
  // dentro de sus propios `<Suspense>`, así que esto no retrasa el hero.
  const query = (await searchParams) ?? {};
  const guiaInicial = numGuiaDeQuery(query[PARAM_GUIA]);

  return (
    <div className="tema-claro min-h-dvh overflow-x-clip bg-kraft-canvas font-sans text-asfalto-9">
      <LandingNav guiaInicial={guiaInicial} />
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
