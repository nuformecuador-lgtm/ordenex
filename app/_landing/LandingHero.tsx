import { Enfasis } from "./primitivas";

/** Las tres cifras bajo el titular del hero (`.lp-hero-stats`). */
const CIFRAS = [
  { etiqueta: "Cobertura", valor: "GAM + 3" },
  { etiqueta: "Cantones activos", valor: "100+" },
  { etiqueta: "Envíos entregados", valor: "9.9K+" },
] as const;

/**
 * Hero de la landing (`.lp-hero`): rótulo, titular y las tres cifras.
 *
 * El sitio pinta de fondo una foto de bodega bajo un degradado navy; aquí, sin
 * imágenes, queda el degradado navy con el halo naranja radial que ya usaban las
 * páginas públicas de la app.
 */
export function LandingHero() {
  return (
    <section className="relative overflow-hidden bg-navy-deep py-7 lg:py-24">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(242,100,25,0.16),transparent_55%)]"
      />

      <div className="relative mx-auto grid max-w-[1180px] items-center gap-9 px-6 md:px-10 lg:gap-14 lg:px-12">
        {/* Rótulo, titular, subtítulo y cifras */}
        <div className="min-w-0 text-white">
          <p className="mb-4 inline-flex items-center gap-2.5 text-xs font-bold tracking-[0.12em] text-brand-light uppercase">
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-[22px] rounded-sm bg-brand"
            />
            Plataforma de despacho
          </p>

          <h1 className="mb-5 font-heading text-[clamp(30px,8vw,64px)] leading-[1.02] font-bold tracking-[-0.035em] text-white">
            Envíos <Enfasis>rápidos</Enfasis> y confiables en Costa Rica.
          </h1>

          <p className="max-w-[46ch] text-base leading-relaxed text-asfalto-2/90">
            Cubrimos el Gran Área Metropolitana con trazabilidad en tiempo real, fletes
            transparentes y entrega garantizada. Expandiéndonos pronto a todo el país.
          </p>

          <dl className="mt-9 grid grid-cols-3 gap-6 border-t border-white/20 pt-6">
            {CIFRAS.map((cifra) => (
              <div key={cifra.etiqueta} className="flex flex-col gap-1">
                <dt className="text-[11px] font-semibold tracking-[0.06em] text-asfalto-2/65 uppercase">
                  {cifra.etiqueta}
                </dt>
                <dd className="font-mono text-[clamp(22px,4vw,30px)] leading-none font-semibold tracking-[-0.01em] text-brand tabular-nums">
                  {cifra.valor}
                </dd>
              </div>
            ))}
          </dl>
        </div>

      </div>
    </section>
  );
}
