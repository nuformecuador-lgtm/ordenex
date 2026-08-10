// Feature 192 (F2.2/F2.3/F5.1/F5.2) — los ocho contadores de "en que termino el dia",
// repartidos en DOS grupos visualmente separados (R28):
//
//   1. RESULTADOS  — los cinco desenlaces del enum `gestion_resultado`.
//   2. SIN RESULTADO — `sinRecoger` / `enReparto` / `otros`: todavia NO terminaron, y por
//      eso no se mezclan con los de arriba. Un pendiente no es un desenlace.
//
// Componente PURO: recibe los conteos por props. Lo comparten la tarjeta de un mensajero
// (`MensajeroCard`) y el bloque de totales (`TableroDiaTotales`), para que la tarjeta y el
// total no puedan pintar dos desgloses distintos del mismo dato (R30).

import type { TotalesTableroDia } from "@/lib/types/tablero-dia";

import {
  ayudaBucket,
  CLAVES_BUCKET,
  CLAVES_RESULTADO,
  ETIQUETA_BUCKET,
  ETIQUETA_RESULTADO,
} from "./contadores";

const TITULO_RESULTADOS = "Resultados del día";
const TITULO_SIN_RESULTADO = "Sin resultado todavía";

function Contador({
  clave,
  etiqueta,
  valor,
  ayuda,
}: Readonly<{
  clave: string;
  etiqueta: string;
  valor: number;
  ayuda?: string;
}>) {
  return (
    <div
      data-contador={clave}
      title={ayuda}
      className="flex flex-col gap-0.5 rounded-md bg-muted/40 px-2 py-1.5"
    >
      <dt className="text-xs leading-tight text-muted-foreground">{etiqueta}</dt>
      <dd className="text-base leading-tight font-semibold tabular-nums">{valor}</dd>
    </div>
  );
}

export function ContadoresTablero({
  contadores,
}: Readonly<{ contadores: TotalesTableroDia }>) {
  return (
    <div className="flex flex-col gap-3">
      <section data-grupo="resultados" aria-label={TITULO_RESULTADOS}>
        <h4 className="mb-1 text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
          {TITULO_RESULTADOS}
        </h4>
        <dl className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {CLAVES_RESULTADO.map((clave) => (
            <Contador
              key={clave}
              clave={clave}
              etiqueta={ETIQUETA_RESULTADO[clave]}
              valor={contadores[clave]}
            />
          ))}
        </dl>
      </section>

      {/* R28 — separacion VISUAL (no solo de orden) entre lo que termino y lo que no:
          borde superior + su propio titulo. */}
      <section
        data-grupo="sin-resultado"
        aria-label={TITULO_SIN_RESULTADO}
        className="border-t border-foreground/10 pt-3"
      >
        <h4 className="mb-1 text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
          {TITULO_SIN_RESULTADO}
        </h4>
        <dl className="grid grid-cols-3 gap-1.5">
          {/* R45/F5.2 — los TRES buckets se pintan siempre, `otros` incluido aunque valga
              0, y cada uno lleva la ayuda que explica que contiene. */}
          {CLAVES_BUCKET.map((clave) => (
            <Contador
              key={clave}
              clave={clave}
              etiqueta={ETIQUETA_BUCKET[clave]}
              valor={contadores[clave]}
              ayuda={ayudaBucket(clave)}
            />
          ))}
        </dl>
      </section>
    </div>
  );
}
