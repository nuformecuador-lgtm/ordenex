import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Truck, Users, Warehouse, type LucideIcon } from "lucide-react";
import {
  Enfasis,
  RotuloSeccion,
  SubtituloSeccion,
  TituloSeccion,
} from "./primitivas";

interface Tarjeta {
  readonly titulo: string;
  readonly copy: string;
  readonly cta: string;
  readonly Icono: LucideIcon;
  /** Foto de cabecera (168px). Decorativa: el título ya dice de qué va la tarjeta. */
  readonly foto: string;
}

const TARJETAS: readonly Tarjeta[] = [
  {
    titulo: "Tenés un vehículo",
    copy: "¿Tenés un camión, carro o moto que no estás manejando? Ponelo a trabajar con Ordenex y generá ingresos con nuestra operación.",
    cta: "Postular mi vehículo",
    Icono: Truck,
    foto: "/landing/logistica.jpg",
  },
  {
    titulo: "Tenés una bodega",
    // Reusa la foto del hero a propósito: es la única de bodega que hay, y en una
    // tarjeta titulada «Tenés una bodega» encaja mejor que cualquier alternativa.
    // Van muy separadas en la página y a tamaños distintos, así que no se leen
    // como repetición.
    copy: "Si tenés un espacio o bodega disponible, lo podemos sumar a nuestra red logística. Contanos qué tenés.",
    cta: "Postular mi bodega",
    Icono: Warehouse,
    foto: "/landing/hero-bodega.jpg",
  },
  {
    titulo: "Querés trabajar con nosotros",
    copy: "¿Tenés otra forma de aportar o querés ser parte del equipo Ordenex? Postulate y conversemos.",
    cta: "Quiero postularme",
    Icono: Users,
    foto: "/landing/mensajera.jpg",
  },
];

/**
 * Bloque de reclutamiento (`.lp-postular-section`). Cada tarjeta abre con su foto
 * de 168px y el cuadro naranja del icono encima, en la esquina, que es el remate
 * que la foto lleva en el sitio. Las tres llamadas van a `/postulacion`, la ruta
 * pública que ya existe.
 */
export function LandingPostular() {
  return (
    <section className="border-y border-asfalto-1 bg-kraft-inset">
      <div className="mx-auto max-w-[1200px] px-6 py-16 md:px-12 md:py-[88px]">
        <RotuloSeccion>Sumate a Ordenex</RotuloSeccion>
        <TituloSeccion>
          ¿Tenés un recurso? <Enfasis>Trabajá con nosotros</Enfasis>.
        </TituloSeccion>
        <SubtituloSeccion>
          No hace falta ser mensajero. Si tenés un vehículo, una bodega o querés aportar de
          otra forma, postulate y nuestro equipo te contacta.
        </SubtituloSeccion>

        <div className="mt-9 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {TARJETAS.map((tarjeta) => (
            <article
              key={tarjeta.titulo}
              className="flex flex-col overflow-hidden rounded-2xl border border-asfalto-2 bg-kraft-card shadow-sm transition hover:-translate-y-0.5 hover:border-brand hover:shadow-xl"
            >
              <div className="relative h-[168px] overflow-hidden bg-navy-deep">
                <Image
                  src={tarjeta.foto}
                  alt=""
                  fill
                  sizes="(min-width: 1024px) 380px, (min-width: 768px) 50vw, 100vw"
                  className="object-cover"
                />
                {/* Velo navy: sostiene el contraste del cuadro naranja sobre fotos claras. */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 bg-gradient-to-t from-navy-deep/70 to-transparent"
                />
                <span className="absolute bottom-4 left-4 grid size-10 place-items-center rounded-md bg-brand text-white">
                  <tarjeta.Icono className="size-5" aria-hidden="true" />
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-2.5 p-[22px]">
                <h3 className="font-heading text-lg leading-tight font-bold tracking-[-0.01em] text-asfalto-9">
                  {tarjeta.titulo}
                </h3>
                <p className="flex-1 text-sm leading-snug text-asfalto-5">{tarjeta.copy}</p>
                <Link
                  href="/postulacion"
                  className="mt-1 inline-flex items-center gap-1.5 self-start rounded-md border border-brand bg-brand px-3.5 py-2.5 text-[13px] font-semibold text-white transition hover:border-brand-dark hover:bg-brand-dark"
                >
                  {tarjeta.cta}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
