"use client";

import { AppPage } from "@/components/shared/AppPage";
import { ErrorState } from "@/components/shared/ErrorState";

/**
 * Feature 365 — LA RED DEL PORTAL. Cubre las pantallas de las 16 secciones que cuelgan de
 * `app/(app)/` (mas `/dashboard`), que hasta hoy se quedaban EN BLANCO ante cualquier fallo de
 * render: un catalogo sin un campo esperado, un `undefined.map`, un dato que llega con otra
 * forma. Sin frontera, Next entrega el fallo a su pagina interna y el usuario pierde la
 * pantalla entera —incluida la de aprobar cierres, que es donde se mueve el dinero—.
 *
 * ── POR QUE UNA SOLA, AQUI, Y NO DIECISEIS
 * Un `error.tsx` protege su segmento Y TODO lo que cuelga debajo. Puesto en la raiz del grupo
 * cubre las 16 secciones y sus subrutas con un archivo; repetirlo por seccion serian dieciseis
 * copias del mismo texto que divergirian a la primera correccion, sin cubrir NADA que esta no
 * cubra ya. La regla que se sigue: se anade una frontera de seccion solo cuando esa seccion
 * necesita decir algo DISTINTO, no por simetria. Hoy hay exactamente una asi —`cierres-admin`,
 * ver su `error.tsx`— porque ahi «reintentar» no es evidentemente inocuo.
 *
 * ── LO QUE ESTA FRONTERA *NO* CUBRE, dicho en voz alta
 * Un `error.tsx` se renderiza DENTRO del layout de su segmento, asi que no puede capturar un
 * fallo del propio `app/(app)/layout.tsx` (sesion, sidebar, tema). Ese hueco lo tapa
 * `app/error.tsx`, y el del layout raiz lo tapa `app/global-error.tsx`. Los tres son la misma
 * red a tres alturas, no tres copias.
 *
 * Que se conserve el layout es justamente lo bueno de ponerla aqui: el usuario se queda con su
 * barra lateral y puede irse a otra seccion sin recargar. Y la pantalla usa `AppPage`, el unico
 * armazon de pagina del repo (DESIGN.md), para que se lea como una pantalla mas de la app y no
 * como la pagina rota de otro sitio.
 */
export default function ErrorDelPortal({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return (
    <AppPage
      title="No pudimos cargar esta pantalla"
      description="Falló al preparar la información. No es algo que hayas hecho mal."
    >
      <ErrorState
        error={error}
        reset={reset}
        titulo="La pantalla no llegó a mostrarse"
        descripcion="Probá de nuevo. Si vuelve a fallar, entrá desde el menú de la izquierda o volvé al inicio."
      />
    </AppPage>
  );
}
