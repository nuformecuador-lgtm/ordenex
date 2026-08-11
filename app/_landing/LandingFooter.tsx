import Link from "next/link";
import { Logo } from "@/components/shared/Logo";

const CLASE_ENLACE =
  "block py-1.5 text-[13px] text-asfalto-2/70 transition-colors hover:text-brand-light";

/**
 * Pie de la landing (`.lp-footer`).
 *
 * Los destinos que hoy no tienen ruta en la app (términos, privacidad, acuerdo
 * COD, dirección y WhatsApp) se pintan como texto, no como enlaces: un
 * `href="#"` muerto es peor que un elemento honesto que no promete navegación.
 * El teléfono sí es un enlace `tel:` real.
 *
 * Las anclas de esta misma página van en `<a>` nativo por la misma razón que en
 * `LandingNav`: `<Link>` anularía el desplazamiento suave.
 */
export function LandingFooter() {
  return (
    <footer className="bg-navy-deep px-6 pt-14 pb-8 text-asfalto-2/80 md:px-12 md:pt-[72px]">
      <div className="mx-auto grid max-w-[1200px] grid-cols-2 gap-8 md:grid-cols-[2fr_1fr_1fr_1fr_1fr]">
        <div>
          <Logo className="text-white" />
          <p className="mt-3.5 max-w-[38ch] text-[13px] leading-relaxed text-asfalto-2/60">
            Transportadora costarricense comprometida con la rapidez, confiabilidad y
            transparencia en cada envío. Operamos en el Gran Área Metropolitana.
          </p>
        </div>

        <div>
          <ColumnaTitulo>Servicios</ColumnaTitulo>
          <a href="#servicios" className={CLASE_ENLACE}>
            Envío estándar
          </a>
          <a href="#servicios" className={CLASE_ENLACE}>
            Express 24h
          </a>
          <a href="#servicios" className={CLASE_ENLACE}>
            E-commerce
          </a>
          <a href="#servicios" className={CLASE_ENLACE}>
            Empresas
          </a>
        </div>

        <div>
          <ColumnaTitulo>Información</ColumnaTitulo>
          <a href="#politicas" className={CLASE_ENLACE}>
            Políticas
          </a>
          <a href="#como-funciona" className={CLASE_ENLACE}>
            Cómo funciona
          </a>
          <Link href="/login" className={CLASE_ENLACE}>
            Ingresar
          </Link>
        </div>

        <div>
          <ColumnaTitulo>Legal</ColumnaTitulo>
          <span className={CLASE_ENLACE}>Términos y Condiciones</span>
          <span className={CLASE_ENLACE}>Política de Privacidad</span>
          <span className={CLASE_ENLACE}>Acuerdo COD</span>
        </div>

        <div>
          <ColumnaTitulo>Contacto</ColumnaTitulo>
          <Link href="/postulacion" className={CLASE_ENLACE}>
            Formulario de contacto
          </Link>
          <a href="tel:+50620000000" className={CLASE_ENLACE}>
            +506 2000-0000
          </a>
          <span className={CLASE_ENLACE}>San José, Costa Rica</span>
          <span className={CLASE_ENLACE}>WhatsApp Business</span>
        </div>
      </div>

      <div className="mx-auto mt-10 flex max-w-[1200px] flex-col items-start justify-between gap-3 border-t border-white/10 pt-6 text-xs text-asfalto-2/55 md:flex-row md:items-center">
        <span>© 2026 · Ordenex S.A. · Costa Rica</span>
        <span className="flex flex-wrap gap-2">
          {["Hacienda CR", "MOPT", "SSL"].map((sello) => (
            <span
              key={sello}
              className="rounded-full border border-white/15 px-2.5 py-1 text-[10px] font-semibold tracking-[0.06em] text-asfalto-2/70 uppercase"
            >
              {sello}
            </span>
          ))}
        </span>
      </div>
    </footer>
  );
}

function ColumnaTitulo({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <p className="mb-3.5 text-[11px] font-bold tracking-[0.08em] text-white uppercase">
      {children}
    </p>
  );
}
