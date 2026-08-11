"use client";

import {
  CalendarClock,
  Receipt,
  ShieldAlert,
  TrendingDown,
  Users,
  type LucideIcon,
} from "lucide-react";

import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { DesgloseEgresosDTO } from "@/lib/types/wallet";

import { money } from "./wallet-labels";

// Feature 45 (T10, R11/R12) — tarjeta del DESGLOSE de egresos por concepto del CONJUNTO
// FILTRADO. El módulo recalcula el desglose server-side con los MISMOS filtros que el libro y
// lo pasa por props ya serializado; el cliente NUNCA recalcula montos. Money-safe: todos los
// totales llegan como STRING y se renderizan TAL CUAL con `money`, sin parseFloat/Number.
//
// Feature 158 (T2.5, R32) — entra la fila "Indemnizaciones" y CAMBIA EL COPY del título. La
// tarjeta se llamaba "Egresos administrativos", que era exacto mientras sus tres conceptos
// (gasto fijo, gasto variable, sueldo) fueran administrativos. La indemnización por incidente
// NO lo es: es un egreso OPERATIVO, nace de un paquete dañado, perdido o robado. Dejar el
// título viejo con la fila nueva dentro convertiría el rótulo en una mentira, y encima una
// mentira sobre dinero. Por eso el título pasa a "Egresos" y una línea de descripción dice
// exactamente qué entra y qué no: la tarjeta NO es el total de todos los egresos de la caja
// (no incluye los pagos a tiendas ni a mensajeros), y eso antes tampoco se decía.
//
// ── Feature 200 (tanda 2) — REDISEÑO DE PRESENTACIÓN, no de datos ──
//
// La lista pasa de cuatro filas planas + un total con `border-t` a una lista JERARQUIZADA con
// cierre fuerte: icono por concepto, fila con superficie propia al pasar el ratón, importe a
// la derecha en `tabular-nums`, y el TOTAL fuera del cuerpo, en el `CardFooter` de la
// primitiva (que ya trae `border-t bg-muted/50`: el cierre no se dibuja a mano).
//
// Lo que NO cambia, porque es lo que sostiene la tarjeta:
//
//  - Money-safe (R64): ni `Number(`, ni `parseFloat(`, ni `parseInt(`, ni `.toFixed(`. Por eso
//    esta lista NO lleva barras ni porcentajes: un porcentaje exige convertir los montos a
//    número EN EL CLIENTE, que es exactamente lo que el desglose tiene prohibido.
//  - El ORDEN de `FILAS` es el escrito, no el de magnitud: ordenar por importe cambiaría el
//    sitio de cada concepto en cada recarga y obligaría a comparar montos aquí.
//  - La `<dl>` sigue siendo UNA, con su `role="group"` y su `aria-label`: se reparte entre el
//    cuerpo y el pie (el pie es su último hijo), porque el total es el `<dt>/<dd>` que cierra
//    la lista, no un dato suelto de otra caja. Por eso el cuerpo no usa `CardContent`: la
//    `<dl>` ES el cuerpo, y así cada `<dt>/<dd>` sigue colgando de su fila y su fila de la
//    lista, sin un nivel de más entre medias.
//  - Los iconos son DECORACIÓN (`aria-hidden`): nombran lo que el rótulo ya dice.

// --- Textos i18n-ready (separados de la lógica, docs/conventions) ---
const TITULO = "Egresos";
const DESCRIPCION =
  "Gastos, sueldos e indemnizaciones del conjunto filtrado. No incluye los pagos a tiendas ni a mensajeros.";
const GRUPO_ARIA = "Desglose de egresos";
const TOTAL_LABEL = "Total de egresos";

/**
 * Filas del desglose: etiqueta i18n-ready + el monto STRING que le corresponde + su icono.
 * El ORDEN es parte del contenido (concepto a concepto, del más recurrente al más
 * excepcional) y NO se reordena por magnitud.
 */
const FILAS: {
  key: keyof Omit<DesgloseEgresosDTO, "total">;
  label: string;
  icono: LucideIcon;
}[] = [
  { key: "gastoFijo", label: "Gastos fijos", icono: CalendarClock },
  { key: "gastoVariable", label: "Gastos variables", icono: Receipt },
  { key: "sueldo", label: "Sueldos", icono: Users },
  // Feature 158/R32: la indemnizacion entra en el TOTAL desde el backend (T1.16), asi que su
  // fila tiene que estar aqui o el total dejaria de cuadrar con lo que se ve.
  { key: "indemnizacion", label: "Indemnizaciones", icono: ShieldAlert },
];

export interface DesgloseEgresosCardProps {
  desglose: DesgloseEgresosDTO;
}

export function DesgloseEgresosCard({ desglose }: DesgloseEgresosCardProps) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>{TITULO}</CardTitle>
        <CardDescription>{DESCRIPCION}</CardDescription>
        {/* El tile lleva `inline-flex items-center justify-center` EXPLICITO. Un `<span>` es
            inline por defecto y, como aqui es hijo directo de un grid item (no de un flex),
            nadie lo blockifica: el `p-2` no genera caja, el `bg-muted` se pinta como una tira
            estirada a la altura de la linea y el icono se sale por arriba y por abajo. Con la
            caja explicita mide 32 x 32 (16 del icono + 8 de padding a cada lado). */}
        <CardAction>
          <span className="inline-flex items-center justify-center rounded-md bg-muted p-2 text-muted-foreground">
            <TrendingDown className="size-4" aria-hidden="true" />
          </span>
        </CardAction>
      </CardHeader>

      {/* La `<dl>` es el cuerpo de la tarjeta. Las filas llevan su propio `mx-2 px-2`: el texto
          queda alineado con el de la cabecera y la superficie del hover se desborda media
          unidad a cada lado, de modo que la fila se ilumina entera y no sólo su texto. */}
      <dl role="group" aria-label={GRUPO_ARIA} className="flex flex-col gap-0.5">
        {FILAS.map(({ key, label, icono: Icono }) => (
          <div
            key={key}
            className="mx-2 flex items-center justify-between gap-4 rounded-md px-2 py-1.5 transition-colors duration-200 hover:bg-muted/50"
          >
            <dt className="flex items-center gap-2 text-sm text-muted-foreground">
              <Icono className="size-4 shrink-0" aria-hidden="true" />
              {label}
            </dt>
            <dd className="text-sm font-medium tabular-nums text-danger-strong">
              {money(desglose[key])}
            </dd>
          </div>
        ))}

        {/* El cierre: el pie de la primitiva ya trae `border-t bg-muted/50` a lo ancho de la
            tarjeta, y el `Card` le quita el padding inferior para que apoye en el borde. */}
        <CardFooter className="mt-3 justify-between gap-4">
          <dt className="text-sm font-medium">{TOTAL_LABEL}</dt>
          <dd className="text-base font-semibold tabular-nums text-danger-strong">
            {money(desglose.total)}
          </dd>
        </CardFooter>
      </dl>
    </Card>
  );
}
