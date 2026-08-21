import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import { Logo } from "@/components/shared/Logo";
import { RastreoDialog } from "./RastreoDialog";

const CLASE_ENLACE =
  "text-[13px] font-semibold tracking-[0.01em] text-white/80 transition-colors hover:text-white";

/**
 * Barra superior pegajosa de la landing (`.lp-nav` de ordenex.co): navy
 * translúcida con blur, enlaces de sección a la izquierda y las dos acciones a
 * la derecha.
 *
 * Los enlaces a secciones de esta misma página son `<a>` nativos, no `<Link>`:
 * el router de Next fuerza `scroll-behavior: auto` mientras salta al ancla, lo
 * que anularía el desplazamiento suave declarado en `globals.css`.
 *
 * Van en el MISMO orden en que `app/page.tsx` compone las secciones (servicios →
 * cómo funciona → políticas → postular); un test lo fija leyendo los `href` de
 * esta nav contra los `id` que la página renderiza.
 *
 * «Trabajá con nosotros» apunta a `#trabaja-con-nosotros`, no a `/postulacion`:
 * esa sección ofrece TRES vías —postular vehículo, postular bodega y postularse
 * como persona— y solo la tercera lleva a `/postulacion`; las otras dos abren
 * `PostularRecursoModal` sin salir de la página. Enlazar la ruta directa se
 * saltaba las otras dos.
 *
 * «Rastrear envío» YA NO es inerte (feature 229): es el disparador del diálogo de
 * consulta pública por guía, y su botón lo emite `RastreoDialog` —isla cliente
 * montada aquí dentro, igual que la landing hace con sus cifras
 * (`cifras-publicas.tsx`)— con el aspecto y el texto que esta nav le pasa. La nav
 * sigue siendo Server Component.
 *
 * El seguimiento del DESTINATARIO vive en ese diálogo, no en `/paquete/[numGuia]`:
 * esa ruta es privada (pinta la etiqueta, exige sesión) y sigue siéndolo.
 */
export function LandingNav() {
  return (
    <nav className="sticky top-0 z-50 flex items-center justify-between gap-2.5 border-b border-white/10 bg-navy-deep/95 px-4 py-3 backdrop-blur-[10px] md:gap-4 md:px-6 md:py-3.5">
      <Link href="/" aria-label="Ordenex — inicio">
        <Logo className="text-white" />
      </Link>

      <div className="hidden items-center gap-7 md:flex">
        <a href="#servicios" className={CLASE_ENLACE}>
          Servicios
        </a>
        <a href="#como-funciona" className={CLASE_ENLACE}>
          Cómo funciona
        </a>
        <a href="#politicas" className={CLASE_ENLACE}>
          Políticas
        </a>
        <a href="#trabaja-con-nosotros" className={CLASE_ENLACE}>
          Trabajá con nosotros
        </a>
      </div>

      <div className="flex items-center gap-2">
        <RastreoDialog className="inline-flex h-9 items-center gap-1.5 rounded-md border border-white bg-white px-3 text-[13px] font-semibold text-asfalto-9 transition hover:bg-kraft-inset">
          <Search className="size-4" aria-hidden="true" />
          <span className="hidden min-[380px]:inline">Rastrear envío</span>
        </RastreoDialog>
        <Link
          href="/login"
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-brand bg-brand px-3.5 text-[13px] font-semibold text-white transition hover:border-brand-dark hover:bg-brand-dark"
        >
          <span>Ingresar</span>
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </nav>
  );
}
