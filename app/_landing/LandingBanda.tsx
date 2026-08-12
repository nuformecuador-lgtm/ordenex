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
 * Cifra fija de la banda. «1–3» es un RANGO, no un conteo: no sale de la base, no se aproxima
 * y no se anima —animar un guion no significa nada—. Se queda tal cual estaba.
 */
const DIAS_DE_ENTREGA = { valor: "1–3", etiqueta: "Días de entrega" } as const;

/**
 * Las cifras de la banda: dos conteos + los días de entrega.
 *
 * Se anuncian solo DOS de los tres conteos (cobertura y órdenes efectivas): la banda tiene
 * tres huecos y el tercero es de los días de entrega. Los tres completos viven en el hero.
 */
function BandaCifras({ conteos }: Readonly<{ conteos: ConteosPublicos | null }>) {
  const deConteo = cifrasDeConteo(conteos).slice(0, 2);

  return (
    <dl className="grid max-w-[560px] grid-cols-2 gap-6 md:grid-cols-3">
      {deConteo.map((cifra) => (
        <div key={cifra.etiqueta} className="flex flex-col gap-1">
          <dd className="font-mono text-[28px] font-semibold text-white tabular-nums">
            {/* Por debajo del pliegue: la cuenta espera a que el bloque entre en pantalla. */}
            <CifraAnimada valor={cifra.valor} animarAlSerVisible />
          </dd>
          <dt className="text-xs tracking-[0.04em] text-asfalto-2/70 uppercase">
            {cifra.etiqueta}
          </dt>
        </div>
      ))}
      <div className="flex flex-col gap-1">
        <dd className="font-mono text-[28px] font-semibold text-white tabular-nums">
          {DIAS_DE_ENTREGA.valor}
        </dd>
        <dt className="text-xs tracking-[0.04em] text-asfalto-2/70 uppercase">
          {DIAS_DE_ENTREGA.etiqueta}
        </dt>
      </div>
    </dl>
  );
}

/** La variante que consulta. Va dentro de `<Suspense>`: la banda nunca espera a la base. */
async function BandaCifrasCargadas() {
  return <BandaCifras conteos={await leerConteosPublicos()} />;
}

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
        <Suspense fallback={<BandaCifras conteos={CIFRAS_EN_CERO} />}>
          <BandaCifrasCargadas />
        </Suspense>
      </div>
    </section>
  );
}
