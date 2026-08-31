"use client";

import {
  Bike,
  CalendarClock,
  Ellipsis,
  Receipt,
  Scale,
  ShieldAlert,
  Users,
  type LucideIcon,
} from "lucide-react";

import type {
  ComposicionFilaId,
  DesgloseEgresosDTO,
  WalletEgresoNombrado,
} from "@/lib/types/wallet";
import { COMPOSICION_FILA_OTROS, WALLET_EGRESO_NOMBRADO_SEED } from "@/lib/types/wallet";

import {
  EGRESO_NOMBRADO_LABEL,
  OTROS_EGRESOS_PISTA,
} from "./composicion-detalle-labels";
import { FilaComposicion } from "./FilaComposicion";
import type { WalletFiltrosValue } from "./WalletFiltros";
import { money } from "./wallet-labels";

// Feature 231 (T6.1, design §4.3) — la LISTA de egresos, extraida del `<dl>` que vivia dentro
// de `DesgloseEgresosCard`.
//
// Por que se extrae en vez de meter aquella tarjeta dentro de la nueva: `DESIGN.md` dice
// «Cards: hermanas, nunca anidadas». La tarjeta de la ganancia necesita ESTA lista en una de
// sus dos columnas, no una tarjeta con su cabecera y su marco dentro de otra tarjeta.
//
// La extraccion es una MUDANZA: mismo `role="group"`, mismo `aria-label`, mismas filas, mismo
// orden y mismo color.
//
// Money-safe (R12): todos los importes llegan como STRING del servidor y se pintan TAL CUAL con
// `money`. Aqui no se suma nada — ni siquiera el total, que lo manda el servidor.
//
// ── FICHA 343 — «Otros gastos de Ordenex» deja de esconder el gasto mas grande ──
//
// La 231 dejo esta lista con CUATRO conceptos y un cubo. En produccion ese cubo pinto
// 227.300,00 —el 100 % de los egresos del periodo— y dentro habia NUEVE pagos a mensajeros: un
// concepto con nombre propio escondido en una fila anonima. El humano abrio la wallet y
// pregunto «como se cuales son estos gastos».
//
// Lo que cambia, y solo esto:
//
//  - `egreso_pago_mensajero` y `egreso_ajuste` ganan FILA PROPIA (R1/R2), recorriendo
//    `WALLET_EGRESO_NOMBRADO_SEED` igual que la columna de ingresos recorre el suyo: un
//    concepto que gane fila mañana entra por UN solo sitio;
//  - «Otros gastos de Ordenex» solo se pinta si el SERVIDOR dice que ahi queda dinero
//    (`hayOtrosEgresos`, R7/R8/R9). La pantalla NO compara importes: eso abriria una segunda
//    definicion de «esto esta en cero» en el lado que tiene prohibido juzgar dinero;
//  - cada fila se ABRE y enseña los movimientos que componen su importe (R15).
//
// EL TOTAL NO SE MUEVE (R11/R12). `otrosEgresos` sigue siendo el COMPLEMENTO derivado en el
// servidor, asi que sacar el pago a mensajeros del cubo cambia de cubeta un importe pero no lo
// saca de la suma: la columna sigue sumando `egresosPropios`, centimo a centimo.
//
// EL ORDEN de `FILAS` es el escrito, no el de magnitud (R6): ordenar por importe cambiaria el
// sitio de cada concepto en cada recarga y obligaria a comparar montos aqui. Las dos filas
// nuevas entran JUSTO ANTES de «Otros» —decision cerrada— y no al principio: aparecen donde el
// dinero se venia mostrando, sin reordenar una tarjeta que la gente ya conoce.
//
// Sin barras ni porcentajes: un porcentaje exige convertir los montos a numero EN EL CLIENTE,
// que es exactamente lo prohibido. Los iconos son DECORACION (`aria-hidden`): nombran lo que el
// rotulo ya dice.

/** Nombre accesible del grupo. Lo heredan las aserciones de la 45 y de la 158. */
const DESGLOSE_EGRESOS_GRUPO_ARIA = "Desglose de egresos";

/** Rotulo del cierre de la lista. */
const DESGLOSE_EGRESOS_TOTAL_LABEL = "Total de egresos";

/**
 * D2 (firmada por la 231) — los egresos propios que NO tienen fila propia, agrupados por el
 * COMPLEMENTO que deriva el servidor y no por una lista escrita a mano.
 *
 * Ficha 339: tras darles fila al pago al mensajero y al ajuste, lo unico que puede caer aqui es
 * `egreso_gasto`, una categoria RESERVADA sin un solo escritor en el arbol. O sea que esta fila
 * vale 0,00 y no se pinta; y el dia que aparezca significara literalmente «entro dinero de un
 * concepto que nadie ha decidido como se llama». Eso es exactamente la señal que se pidio, y por
 * eso lleva su pista debajo (R10) en vez de un 0,00 permanente que entrena a no mirar la linea.
 */
const OTROS_EGRESOS_LABEL = "Otros gastos de Ordenex";

/**
 * Filas del desglose: etiqueta i18n-ready + el monto STRING que le corresponde + su icono + el
 * TOKEN con el que el servidor sabe que movimientos la componen.
 */
const FILAS: {
  key: keyof Omit<DesgloseEgresosDTO, "total">;
  fila: ComposicionFilaId;
  label: string;
  icono: LucideIcon;
}[] = [
  { key: "gastoFijo", fila: "egreso_gasto_fijo", label: "Gastos fijos", icono: CalendarClock },
  {
    key: "gastoVariable",
    fila: "egreso_gasto_variable",
    label: "Gastos variables",
    icono: Receipt,
  },
  { key: "sueldo", fila: "egreso_sueldo", label: "Sueldos", icono: Users },
  // Feature 158/R32: la indemnizacion entra en el TOTAL desde el backend, asi que su fila tiene
  // que estar aqui o el total dejaria de cuadrar con lo que se ve.
  {
    key: "indemnizacion",
    fila: "egreso_indemnizacion",
    label: "Indemnizaciones",
    icono: ShieldAlert,
  },
];

/**
 * Ficha 339 (R1/R2) — el icono de cada egreso que gana fila propia. `Record` TOTAL sobre
 * `WalletEgresoNombrado`: un concepto nuevo rompe el build hasta que alguien decida como se
 * dibuja, igual que hace la columna de ingresos con los suyos.
 */
const NOMBRADO_ICONO: Record<WalletEgresoNombrado, LucideIcon> = {
  egreso_pago_mensajero: Bike,
  egreso_ajuste: Scale,
};

export interface DesgloseEgresosListaProps {
  /** Los cuatro conceptos que la 45/158 ya abria. Su forma NO cambia. */
  desglose: DesgloseEgresosDTO;
  /**
   * Ficha 339 — un importe por egreso propio con fila que no viene en `DesgloseEgresosDTO`: hoy
   * el pago al mensajero y el ajuste. `Record` TOTAL, sin huecos.
   */
  egresos: Record<WalletEgresoNombrado, string>;
  /** D2 — el resto de egresos propios (tras la 343, solo el gasto reservado), en una fila. */
  otrosEgresos: string;
  /**
   * R9 — si esa fila se pinta. Lo decide el SERVIDOR (`ComposicionGananciaDTO.hayOtrosEgresos`)
   * y NO una comparacion de importes aqui.
   */
  hayOtrosEgresos: boolean;
  /**
   * El total a pintar: `ComposicionGananciaDTO.totalEgresos`, que es —importe a importe—
   * `egresosPropios` (R26 de la 231). NO es `desglose.total`, que solo suma los cuatro conceptos.
   */
  total: string;
  /** Los filtros vigentes de la wallet, que bajan hasta el detalle de cada fila (R20). */
  filtros: WalletFiltrosValue;
}

export function DesgloseEgresosLista({
  desglose,
  egresos,
  otrosEgresos,
  hayOtrosEgresos,
  total,
  filtros,
}: DesgloseEgresosListaProps) {
  return (
    <dl role="group" aria-label={DESGLOSE_EGRESOS_GRUPO_ARIA} className="flex flex-col gap-0.5">
      {FILAS.map(({ key, fila, label, icono }) => (
        <FilaComposicion
          key={key}
          fila={fila}
          label={label}
          valor={desglose[key]}
          icono={icono}
          tono="egreso"
          filtros={filtros}
        />
      ))}

      {/* R1/R2 — las dos filas que la 343 saca del cubo, JUSTO ANTES de «Otros». */}
      {WALLET_EGRESO_NOMBRADO_SEED.map((categoria) => (
        <FilaComposicion
          key={categoria}
          fila={categoria}
          // R5: la etiqueta legible, nunca el valor del enum.
          label={EGRESO_NOMBRADO_LABEL[categoria]}
          valor={egresos[categoria]}
          icono={NOMBRADO_ICONO[categoria]}
          tono="egreso"
          filtros={filtros}
        />
      ))}

      {/* R7/R8 — la decision la trae el servidor; aqui no se compara ningun importe. */}
      {hayOtrosEgresos ? (
        <FilaComposicion
          fila={COMPOSICION_FILA_OTROS}
          label={OTROS_EGRESOS_LABEL}
          valor={otrosEgresos}
          icono={Ellipsis}
          tono="egreso"
          filtros={filtros}
          pista={OTROS_EGRESOS_PISTA}
        />
      ) : null}

      {/* El cierre de la lista: el total es el `<dt>/<dd>` que la termina, no un dato suelto de
          otra caja. Por eso vive DENTRO de la `<dl>`. */}
      <div className="mt-3 flex items-center justify-between gap-4 border-t bg-muted/50 px-4 py-3">
        <dt className="text-sm font-medium">{DESGLOSE_EGRESOS_TOTAL_LABEL}</dt>
        <dd className="text-base font-semibold tabular-nums text-danger-strong">
          {money(total)}
        </dd>
      </div>
    </dl>
  );
}
