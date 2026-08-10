import { Enfasis } from "./primitivas";

const CIFRAS = [
  { valor: "GAM + 3", etiqueta: "Cobertura" },
  { valor: "100+", etiqueta: "Cantones activos" },
  { valor: "1–3", etiqueta: "Días de entrega" },
] as const;

/**
 * Banda oscura entre servicios y «cómo funciona» (`.lp-imgband`). En el sitio
 * lleva una foto de paquetes bajo un degradado navy; sin imágenes queda el navy
 * sólido, que es lo que el degradado dejaba ver en el borde izquierdo.
 */
export function LandingBanda() {
  return (
    <section className="bg-navy-deep px-6 py-[72px] text-white md:px-12 md:py-[104px]">
      <div className="mx-auto max-w-[1200px]">
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
