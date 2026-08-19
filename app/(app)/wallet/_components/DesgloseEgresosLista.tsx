"use client";

import {
  CalendarClock,
  Ellipsis,
  Receipt,
  ShieldAlert,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { DesgloseEgresosDTO } from "@/lib/types/wallet";

import { money } from "./wallet-labels";

// Feature 231 (T6.1, design §4.3) — la LISTA de egresos, extraida del `<dl>` que vivia dentro
// de `DesgloseEgresosCard`.
//
// Por que se extrae en vez de meter aquella tarjeta dentro de la nueva: `DESIGN.md` dice
// «Cards: hermanas, nunca anidadas». La tarjeta de la ganancia necesita ESTA lista en una de
// sus dos columnas, no una tarjeta con su cabecera y su marco dentro de otra tarjeta.
//
// La extraccion es una MUDANZA: mismo `role="group"`, mismo `aria-label`, mismas filas, mismo
// orden y mismo color. Lo unico que gana es la fila «Otros gastos de Ordenex» (D2, firmada), y
// gana porque sin ella la resta de la tarjeta nueva no cuadraria en pantalla: `DesgloseEgresosDTO`
// abre 4 de las 7 categorias de egreso propio, y el hueco es sobre todo el pago a los mensajeros.
//
// Money-safe (R12): todos los importes llegan como STRING del servidor y se pintan TAL CUAL con
// `money`. Aqui no se suma nada — ni siquiera el total, que lo manda el servidor.
//
// Lo que NO cambia respecto de la 45/158/200 y es lo que sostiene la lista:
//
//  - el ORDEN de `FILAS` es el escrito, no el de magnitud: ordenar por importe cambiaria el
//    sitio de cada concepto en cada recarga y obligaria a comparar montos aqui (R28);
//  - sin barras ni porcentajes: un porcentaje exige convertir los montos a numero EN EL
//    CLIENTE, que es exactamente lo prohibido;
//  - los iconos son DECORACION (`aria-hidden`): nombran lo que el rotulo ya dice.

/** Nombre accesible del grupo. Lo heredan las aserciones de la 45 y de la 158. */
const DESGLOSE_EGRESOS_GRUPO_ARIA = "Desglose de egresos";

/** Rotulo del cierre de la lista. */
const DESGLOSE_EGRESOS_TOTAL_LABEL = "Total de egresos";

/**
 * D2 (firmada) — los egresos propios que `DesgloseEgresosDTO` NO abre concepto por concepto:
 * hoy el pago al mensajero, el gasto suelto y el ajuste. El servidor los agrupa por COMPLEMENTO
 * del catalogo, no por una lista escrita a mano, para que el total siga siendo `egresosPropios`
 * aunque manana aparezca un egreso propio nuevo (R26).
 */
const OTROS_EGRESOS_LABEL = "Otros gastos de Ordenex";

/**
 * Filas del desglose: etiqueta i18n-ready + el monto STRING que le corresponde + su icono. El
 * ORDEN es parte del contenido (del mas recurrente al mas excepcional) y NO se reordena.
 */
const FILAS: {
  key: keyof Omit<DesgloseEgresosDTO, "total">;
  label: string;
  icono: LucideIcon;
}[] = [
  { key: "gastoFijo", label: "Gastos fijos", icono: CalendarClock },
  { key: "gastoVariable", label: "Gastos variables", icono: Receipt },
  { key: "sueldo", label: "Sueldos", icono: Users },
  // Feature 158/R32: la indemnizacion entra en el TOTAL desde el backend, asi que su fila tiene
  // que estar aqui o el total dejaria de cuadrar con lo que se ve.
  { key: "indemnizacion", label: "Indemnizaciones", icono: ShieldAlert },
];

/** Una fila de la lista: rotulo con icono a la izquierda, importe a la derecha. */
function Fila({
  label,
  valor,
  icono: Icono,
}: {
  label: string;
  /** STRING del servidor, pintado tal cual. */
  valor: string;
  icono: LucideIcon;
}) {
  return (
    <div className="mx-2 flex items-center justify-between gap-4 rounded-md px-2 py-1.5 transition-colors duration-200 hover:bg-muted/50">
      <dt className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icono className="size-4 shrink-0" aria-hidden="true" />
        {label}
      </dt>
      <dd className="text-sm font-medium tabular-nums text-danger-strong">{money(valor)}</dd>
    </div>
  );
}

export interface DesgloseEgresosListaProps {
  /** Los cuatro conceptos que la 45/158 ya abria. Su forma NO cambia. */
  desglose: DesgloseEgresosDTO;
  /** D2 — el resto de egresos propios (hoy mensajero + gasto + ajuste), en una fila. */
  otrosEgresos: string;
  /**
   * El total a pintar: `ComposicionGananciaDTO.totalEgresos`, que es —importe a importe—
   * `egresosPropios` (R26). NO es `desglose.total`, que solo suma los cuatro conceptos.
   */
  total: string;
}

export function DesgloseEgresosLista({
  desglose,
  otrosEgresos,
  total,
}: DesgloseEgresosListaProps) {
  return (
    <dl role="group" aria-label={DESGLOSE_EGRESOS_GRUPO_ARIA} className="flex flex-col gap-0.5">
      {FILAS.map(({ key, label, icono }) => (
        <Fila key={key} label={label} valor={desglose[key]} icono={icono} />
      ))}

      <Fila label={OTROS_EGRESOS_LABEL} valor={otrosEgresos} icono={Ellipsis} />

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
