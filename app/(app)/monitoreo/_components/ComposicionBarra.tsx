// Feature 258 (F5.2, R66–R70) — la BARRA APILADA de composicion del dia.
//
// Que es: las `asignadas` del bloque que la monta, partidas en los ocho contadores que las
// componen. Entra por decision humana del 2026-08-21 (`design.md` §12.4).
//
// POR QUE VIVE EN SU PROPIO ARCHIVO Y NO DENTRO DE CADA CONSUMIDOR: la montan DOS sitios —la
// tira de totales y cada tarjeta de mensajero— y tienen que pintar el MISMO reparto. Si cada
// uno se armara la suya, la tarjeta y el total podrian contar historias distintas del mismo
// dato, que es exactamente lo que R30 de la 192 evita.
//
// ─── EL COLOR NO LLEVA EL DATO SOLO (R68) ────────────────────────────────────────────────
// Cada segmento es un `<span>` SIN texto dentro; la cifra y la etiqueta viven DEBAJO, en los
// ocho `Badge` de `ContadoresTablero`. Y la barra entera es un `role="img"` cuyo `aria-label`
// enumera los OCHO valores. Quien no distingue verde de naranja lee los numeros; quien usa un
// lector de pantalla oye la frase. `role="img"` deja ademas los segmentos fuera del arbol
// accesible, que es lo correcto: son pintura.
//
// ⛔ Ni un hex ni una utilidad de paleta cruda (R67): el color de cada segmento sale de
// `COLOR_SEGMENTO`, que solo tiene tokens de `app/globals.css`.

import type { TotalesTableroDia } from "@/lib/types/tablero-dia";
import { cn } from "@/lib/utils";

import { CLAVES_CONTADOR, COLOR_SEGMENTO, etiquetaContador } from "./contadores";

/** La pista: `bg-muted` GIRA con el tema, igual que los segmentos que se apoyan en ella. */
const PISTA = "flex h-2 w-full overflow-hidden rounded-full bg-muted";

/**
 * R68 — el nombre accesible enumera los OCHO valores, tambien los que valen cero. Los ceros
 * no pintan segmento (R69) pero SI se dicen: «Incidentes 0» es informacion, y callarlo dejaria
 * a quien escucha sin saber si el contador no existe o esta a cero.
 */
export function composicionNombreAccesible(
  etiqueta: string,
  contadores: TotalesTableroDia,
): string {
  const partes = CLAVES_CONTADOR.map(
    (clave) => `${etiquetaContador(clave)} ${contadores[clave]}`,
  );
  return `${etiqueta}: ${partes.join(", ")}`;
}

export interface ComposicionBarraProps {
  /** Los mismos ocho contadores que alimentan los `Badge`, sin recalcular nada (R69). */
  readonly contadores: TotalesTableroDia;
  /** De quien habla la barra («Composición del día», «Composición de Ana Rojas»). */
  readonly etiqueta: string;
  readonly className?: string;
}

export function ComposicionBarra({ contadores, etiqueta, className }: ComposicionBarraProps) {
  // R70 — el 100 % es de las `asignadas` DE ESTE BLOQUE. La identidad de R3 hace que los ocho
  // sumandos sean exactamente esas asignadas, asi que los anchos suman 100 % por construccion
  // y no por un ajuste al ultimo segmento.
  const total = contadores.asignadas;

  // R69 — un contador a 0 NO pinta segmento: un `<span>` de ancho 0 % es un nodo invisible que
  // ensucia el DOM sin decir nada. Y con `asignadas` a 0 no hay reparto que hacer: queda la
  // pista vacia, que es la lectura honesta de «todavia no hay nada».
  const segmentos =
    total > 0 ? CLAVES_CONTADOR.filter((clave) => contadores[clave] > 0) : [];

  return (
    <div
      role="img"
      aria-label={composicionNombreAccesible(etiqueta, contadores)}
      data-slot="composicion-barra"
      className={cn(PISTA, className)}
    >
      {segmentos.map((clave) => (
        <span
          key={clave}
          data-segmento={clave}
          className={COLOR_SEGMENTO[clave]}
          // El ancho es un DATO, no una clase: Tailwind compila estaticamente y no puede
          // generar `w-[28.57%]` en tiempo de ejecucion.
          style={{ width: `${(contadores[clave] / total) * 100}%` }}
          // El `title` acompaña al puntero; el dato de verdad esta en los `Badge` de debajo.
          title={`${etiquetaContador(clave)} ${contadores[clave]}`}
        />
      ))}
    </div>
  );
}
