import Image from "next/image";

import { Enfasis } from "./primitivas";

const CIFRAS = [
  { valor: "GAM + 3", etiqueta: "Cobertura" },
  { valor: "100+", etiqueta: "Cantones activos" },
  { valor: "1–3", etiqueta: "Días de entrega" },
] as const;

/**
 * Banda oscura entre servicios y «cómo funciona» (`.lp-imgband`), con la foto de
 * paquetes bajo el degradado navy, igual que el sitio.
 *
 * El degradado va de navy opaco a la izquierda —donde vive el texto— hasta dejar
 * ver la foto a la derecha: es exactamente lo que el sitio muestra en ese borde.
 * Foto decorativa (`alt=""`) y sin `priority`: está por debajo del pliegue y su
 * carga no debe competir con la del hero.
 */
export function LandingBanda() {
  return (
    <section className="relative overflow-hidden bg-navy-deep px-6 py-[72px] text-white md:px-12 md:py-[104px]">
      <Image
        src="/landing/paquetes.jpg"
        alt=""
        fill
        sizes="100vw"
        className="pointer-events-none object-cover"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-navy-deep via-navy-deep/92 to-navy-deep/55"
      />
      <div className="relative mx-auto max-w-[1200px]">
        <p className="mb-3.5 text-xs font-bold tracking-[0.12em] text-brand-light uppercase">
          Operación real de despacho
        </p>
        <h2 className="mb-7 max-w-[22ch] font-heading text-[clamp(26px,4.5vw,42px)] leading-[1.1] font-bold tracking-[-0.025em]">
          De la bodega a la puerta, <Enfasis>sin perder el rastro</Enfasis>.
        </h2>
        <dl className="grid max-w-[560px] grid-cols-2 gap-6 md:grid-cols-3">
          {CIFRAS.map((cifra) => (
            <div key={cifra.etiqueta} className="flex flex-col gap-1">
              <dd className="font-mono text-[28px] font-semibold text-white tabular-nums">
                {cifra.valor}
              </dd>
              <dt className="text-xs tracking-[0.04em] text-asfalto-2/70 uppercase">
                {cifra.etiqueta}
              </dt>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
