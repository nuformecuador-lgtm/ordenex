import {
  Building2,
  Calculator,
  MapPin,
  ShoppingCart,
  Truck,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  Enfasis,
  RotuloSeccion,
  Seccion,
  SubtituloSeccion,
  TituloSeccion,
} from "./primitivas";

interface Servicio {
  readonly codigo: string;
  readonly titulo: string;
  readonly descripcion: string;
  readonly Icono: LucideIcon;
  /** Fondo/color del cuadro del icono: el sitio los cicla en tres tonos. */
  readonly tono: string;
}

const SERVICIOS: readonly Servicio[] = [
  {
    codigo: "S-01",
    titulo: "Envío estándar",
    descripcion:
      "Entrega confiable en 1–2 días hábiles en el GAM. Ideal para e-commerce y envíos regulares.",
    Icono: Truck,
    tono: "bg-info-soft text-ink-blue",
  },
  {
    codigo: "S-02",
    titulo: "Express 24h",
    descripcion: "Entrega al día siguiente en GAM con confirmación inmediata.",
    Icono: Zap,
    tono: "bg-success-soft text-success-strong",
  },
  {
    codigo: "S-03",
    titulo: "E-commerce",
    descripcion: "Integración Dropi, Effi y APIs vía webhook.",
    Icono: ShoppingCart,
    tono: "bg-brand-soft text-brand-dark",
  },
  {
    codigo: "S-04",
    titulo: "Tracking real-time",
    descripcion: "Estado actualizado en cada handoff.",
    Icono: MapPin,
    tono: "bg-info-soft text-ink-blue",
  },
  {
    codigo: "S-05",
    titulo: "Fletes transparentes",
    descripcion: "Cálculo exacto antes de enviar, sin sorpresas.",
    Icono: Calculator,
    tono: "bg-success-soft text-success-strong",
  },
  {
    codigo: "S-06",
    titulo: "Cuentas empresa",
    descripcion: "Tarifas escalonadas y reportes para alto volumen.",
    Icono: Building2,
    tono: "bg-brand-soft text-brand-dark",
  },
];

/**
 * Rejilla de servicios (`.lp-serv-grid`). En pantalla ancha el sitio usa 6
 * columnas con reparto irregular: la primera tarjeta ocupa 3×2, la 2.ª y la 3.ª
 * 3×1, y de la 4.ª en adelante 2×1.
 */
function tramoDe(indice: number): string {
  if (indice === 0) return "lg:col-span-3 lg:row-span-2";
  if (indice <= 2) return "lg:col-span-3";
  return "lg:col-span-2";
}

export function LandingServicios() {
  return (
    <Seccion id="servicios">
      <RotuloSeccion>Servicios</RotuloSeccion>
      <TituloSeccion>
        Todo lo que necesitas para enviar <Enfasis>sin fricción</Enfasis>.
      </TituloSeccion>
      <SubtituloSeccion>
        Soluciones logísticas completas para empresas y personas en el GAM.
      </SubtituloSeccion>

      <div className="mt-9 grid gap-4 md:grid-cols-2 lg:grid-cols-6">
        {SERVICIOS.map((servicio, indice) => (
          <article
            key={servicio.codigo}
            className={`flex flex-col gap-3 rounded-xl border border-asfalto-2 bg-kraft-card p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-brand hover:shadow-lg ${tramoDe(indice)}`}
          >
            <p className="font-mono text-[11px] font-bold tracking-[0.1em] text-asfalto-4">
              {servicio.codigo}
            </p>
            <span
              className={`mb-1.5 grid size-10 place-items-center rounded-md ${servicio.tono}`}
            >
              <servicio.Icono className="size-5" aria-hidden="true" />
            </span>
            <h3
              className={`font-heading leading-tight font-semibold tracking-[-0.018em] text-asfalto-9 ${indice === 0 ? "text-2xl" : "text-lg"}`}
            >
              {servicio.titulo}
            </h3>
            <p className="text-sm leading-relaxed text-asfalto-5">{servicio.descripcion}</p>
          </article>
        ))}
      </div>
    </Seccion>
  );
}
