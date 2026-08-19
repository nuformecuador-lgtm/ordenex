"use client";

import type { CajaResumenDTO, ModoComposicionCaja } from "@/lib/types/wallet";
import { cn } from "@/lib/utils";

import { composicionCajaNombreAccesible } from "./wallet-labels";

// Feature 231 (T4.2, design §4.2) — la barra de composicion de la caja.
//
// Que es: la cifra grande de «Dinero en caja» partida en las DOS porciones que la componen,
// la de las TIENDAS y la de ORDENEX. No hay una tercera porcion ni un residuo escondido: la
// identidad `enCaja = ganancia + deTerceros` la deriva el servidor y esta comprobada en
// `lib/utils/caja-tesoreria.ts`.
//
// Que NO es, y por que importa:
//
//  - NO es un `Progress` de Radix (design §6.1). Aquel recibe `value: number`, asi que
//    alimentarlo exigiria convertir el porcentaje a numero EN EL NAVEGADOR — la llamada que
//    R12 prohibe— y ademas representa UNA magnitud sobre un total, no una composicion de dos
//    porciones con cuatro modos degenerados.
//  - NO decide nada (R21). El modo y el porcentaje llegan del servidor ya derivados; aqui no
//    se compara un importe con otro ni se lee `signoGanancia` para adivinar la forma.
//  - NO es interactiva (R8): la tarjeta que la contiene no admite ni un solo control.
//
// Money-safe (R12): `porcentajeTiendas` viaja como STRING y se pega TAL CUAL dentro de la
// unidad `%`. El segundo segmento NO lleva porcentaje: ocupa el resto con `flex-1`, de modo
// que un redondeo de centesima no puede abrir un hilo blanco al final de la barra ni
// desbordarla (design §6.5).

/** Alto de la barra. Una banda fina: acompaña a la cifra, no compite con ella. */
const PISTA = "flex h-2 w-full overflow-hidden rounded-full bg-muted";

/**
 * Un segmento pintado: de quien es, con que color y como se mide.
 *
 *  - `porcentaje` → el ancho es el STRING del DTO (solo el de las tiendas, R11).
 *  - `resto`      → lo que quede (`flex-1`), sin numero propio.
 *  - `todo`       → la barra entera, cuando no hay reparto que hacer.
 */
type Medida = "porcentaje" | "resto" | "todo";

interface Segmento {
  clave: "tiendas" | "ordenex";
  /** Color por TOKEN (R39). Ni un hex, ni una utilidad de paleta ad-hoc. */
  color: string;
  medida: Medida;
}

const ANCHO: Record<Medida, string> = {
  porcentaje: "shrink-0",
  resto: "flex-1",
  todo: "w-full",
};

/**
 * Los CUATRO modos, en un `Record` TOTAL (design §4.2): un modo nuevo en el servidor rompe el
 * build de esta pantalla en vez de caer en un `default` que pintaria cualquier cosa.
 *
 *  - `dos_bolsillos` — los dos segmentos. Tiendas en `warning` (es dinero que hay que
 *    entregar, no una alarma) y Ordenex en superficie NEUTRA: `DESIGN.md` reserva el acento
 *    para accion y estado, y la ganancia normal no es ninguna de las dos cosas (R5).
 *  - `solo_tiendas` — la barra ENTERA en `warning` (R16): Ordenex esta en perdida y lo que
 *    queda en la caja es dinero de las tiendas.
 *  - `solo_ordenex` — el espejo (R17, D4): no queda nada de las tiendas.
 *  - `sin_reparto` — CERO segmentos (R18/R20): la pista neutra vacia, sin porcentaje alguno.
 */
const SEGMENTOS_POR_MODO: Record<ModoComposicionCaja, readonly Segmento[]> = {
  dos_bolsillos: [
    { clave: "tiendas", color: "bg-warning", medida: "porcentaje" },
    { clave: "ordenex", color: "bg-muted-foreground", medida: "resto" },
  ],
  solo_tiendas: [{ clave: "tiendas", color: "bg-warning", medida: "todo" }],
  solo_ordenex: [{ clave: "ordenex", color: "bg-muted-foreground", medida: "todo" }],
  sin_reparto: [],
};

export interface BarraComposicionCajaProps {
  /** El resumen ENTERO, ya derivado en el servidor: modo, porcentaje y los dos importes. */
  resumen: CajaResumenDTO;
  className?: string;
}

export function BarraComposicionCaja({ resumen, className }: BarraComposicionCajaProps) {
  const segmentos = SEGMENTOS_POR_MODO[resumen.modoComposicion];

  return (
    <div
      // R13: el nombre accesible enuncia las DOS porciones con su rotulo y su importe. Sin el,
      // quien usa lector de pantalla oiria «imagen» y nada mas. `role="img"` deja los
      // segmentos fuera del arbol accesible, que es lo correcto: son pintura.
      role="img"
      aria-label={composicionCajaNombreAccesible(resumen)}
      data-modo={resumen.modoComposicion}
      className={cn(PISTA, className)}
    >
      {segmentos.map((segmento) => (
        <span
          key={segmento.clave}
          data-segmento={segmento.clave}
          className={cn(ANCHO[segmento.medida], segmento.color)}
          // El ancho es un DATO de la respuesta, no una clase: Tailwind lee el fuente y no
          // puede generar `w-[83.33%]` en tiempo de ejecucion. El STRING entra tal cual.
          style={
            segmento.medida === "porcentaje"
              ? { width: `${resumen.porcentajeTiendas}%` }
              : undefined
          }
        />
      ))}
    </div>
  );
}
