import Image from "next/image";
import { Suspense } from "react";

import type { ConteosPublicos } from "@/lib/types/conteos-publicos";

import {
  CIFRAS_EN_CERO,
  CifraAnimada,
  cifrasDeConteo,
  leerConteosPublicos,
} from "./cifras-publicas";
import { Enfasis } from "./primitivas";

/**
 * Las tres cifras bajo el titular del hero (`.lp-hero-stats`).
 *
 * Antes eran texto fijo («GAM + 3», «100+», «9.9K+»); ahora salen de la base (feature 198),
 * aproximadas a la baja. Ver `cifras-publicas.tsx` para el porque de cada decision.
 */
function HeroCifras({ conteos }: Readonly<{ conteos: ConteosPublicos | null }>) {
  const cifras = cifrasDeConteo(conteos);
  if (cifras.length === 0) return null;

  return (
    <dl className="mt-9 grid grid-cols-3 gap-6 border-t border-white/20 pt-6">
      {cifras.map((cifra) => (
        <div key={cifra.etiqueta} className="flex flex-col gap-1">
          <dt className="text-[11px] font-semibold tracking-[0.06em] text-asfalto-2/65 uppercase">
            {cifra.etiqueta}
          </dt>
          <dd className="font-mono text-[clamp(22px,4vw,30px)] leading-none font-semibold tracking-[-0.01em] text-brand tabular-nums">
            <CifraAnimada valor={cifra.valor} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** La variante que consulta. Va dentro de `<Suspense>` para no retrasar el titular. */
async function HeroCifrasCargadas() {
  return <HeroCifras conteos={await leerConteosPublicos()} />;
}

/**
 * Hero de la landing (`.lp-hero`): rótulo, titular y las tres cifras, sobre la
 * foto de bodega que el sitio pinta de fondo bajo un degradado navy.
 *
 * La foto es DECORATIVA (`alt=""`): todo lo que comunica ya está en el titular y
 * en las cifras, así que anunciarla en un lector de pantalla solo añadiría ruido.
 * El `bg-navy-deep` de la sección es el color de respaldo mientras carga o si
 * nunca llega.
 *
 * `priority` porque es el LCP de la página: diferirla dejaría el hero en navy
 * sólido durante la primera pintada.
 */
export function LandingHero() {
  return (
    <section className="relative overflow-hidden bg-navy-deep py-7 lg:py-24">
      <Image
        src="/landing/hero-bodega.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        className="pointer-events-none object-cover"
      />
      {/*
        Dos capas sobre la foto, en este orden: el degradado navy que la apaga lo
        suficiente para que el texto blanco conserve contraste AA, y encima el halo
        naranja radial que ya usaban las páginas públicas de la app.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-navy-deep via-navy-deep/90 to-navy-deep/70"
      />
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

          {/* El fallback pinta la MISMA rejilla en 0, no un hueco vacío: así el titular no
              salta cuando llegan los números, y el contador arranca desde el 0 que ya está
              en pantalla en vez de aparecer con el valor final puesto. */}
          <Suspense fallback={<HeroCifras conteos={CIFRAS_EN_CERO} />}>
            <HeroCifrasCargadas />
          </Suspense>
        </div>

      </div>
    </section>
  );
}
