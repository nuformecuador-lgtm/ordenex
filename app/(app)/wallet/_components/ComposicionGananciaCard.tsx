"use client";

import {
  ArrowRightLeft,
  HandCoins,
  Percent,
  Scale,
  Truck,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type {
  CajaResumenDTO,
  ComposicionGananciaDTO,
  DesgloseEgresosDTO,
  WalletBalanceSigno,
  WalletIngresoPropio,
} from "@/lib/types/wallet";
import { WALLET_INGRESO_PROPIO_SEED } from "@/lib/types/wallet";
import { cn } from "@/lib/utils";

import { DesgloseEgresosLista } from "./DesgloseEgresosLista";
import { FilaComposicion } from "./FilaComposicion";
import type { WalletFiltrosValue } from "./WalletFiltros";
import { CATEGORIA_LABEL, money } from "./wallet-labels";

// Feature 231 (T6.2, design §4.3) — «Cómo se compone la ganancia de Ordenex».
//
// La tarjeta que abre la cifra de la ganancia CONCEPTO POR CONCEPTO: los ingresos propios a un
// lado, los egresos propios al otro y la ganancia resultante en el pie. Es la respuesta a la
// pregunta que la tarjeta de la caja deja abierta —«¿y de dónde sale ese número?»— sin que haya
// que abrir nada ni cambiar de pantalla.
//
// Card HERMANA de la de la caja, nunca anidada (`DESIGN.md`). Por eso la columna de egresos usa
// `DesgloseEgresosLista` —el `<dl>` extraído de la tarjeta «Egresos» de la 45/158— en vez de
// meter aquella tarjeta entera aquí dentro. Esa tarjeta queda ABSORBIDA por ésta (D2, firmada):
// enseñaba los mismos cuatro conceptos y su total, y verlos dos veces en la misma pantalla es
// justo lo que hace dudar de cuál de los dos números es el bueno.
//
// Money-safe (R12): los once importes llegan como STRING del servidor y se pintan TAL CUAL con
// `money`. Aquí no se suma, no se resta y no se convierte a número — ni siquiera para el pie:
// `ganancia` y su signo los manda el servidor ya derivados (R27).
//
// El ORDEN de las dos columnas es el DECLARADO en el código (R28), no el de magnitud: ordenar
// por importe cambiaría el sitio de cada concepto en cada recarga —y obligaría a comparar montos
// en el navegador—. El de ingresos es `WALLET_INGRESO_PROPIO_SEED`, que es el mismo con el que el
// servidor construye el desglose: una fila nueva del catálogo entra por los dos sitios a la vez.

// --- Textos i18n-ready (separados de la lógica, docs/conventions) ---
const TITULO = "Cómo se compone la ganancia de Ordenex";

/**
 * R29 (copy heredado de la 158) — qué entra y, sobre todo, qué NO entra. La 158 escribió «no
 * incluye los pagos a tiendas ni a mensajeros» sobre la tarjeta de egresos; en ÉSTA el pago a
 * los mensajeros SÍ entra, por «Otros gastos de Ordenex» (consecuencia firmada en D2). Lo que de
 * verdad queda fuera de la ganancia es el dinero de las tiendas, y eso es lo que dice ahora.
 *
 * Y por eso la enumeración NOMBRA el pago a mensajeros. La primera versión de este texto listaba
 * «fletes, comisiones, impuestos, gastos, sueldos e indemnizaciones» y se lo callaba: una lista
 * parcial de lo que entra, con el concepto más grande de los que D2 metió dentro fuera de ella
 * (940 de 3 940,50 en el libro de no-regresión), induce a error sobre dinero. O se nombra todo o
 * no se enumera; se nombra.
 *
 * Ficha 339 (T5.5, R41) — la enumeración gana los AJUSTES, y es la continuación literal de esa
 * misma corrección. Con `egreso_ajuste` e `ingreso_ajuste` teniendo cada uno su fila con nombre,
 * un texto que siguiera callándoselos volvería a ser una lista parcial de lo que entra. R42: lo
 * que queda fuera —el dinero de las tiendas— se dice igual que hasta hoy.
 */
const DESCRIPCION =
  "Ingresos y gastos propios del conjunto filtrado, concepto por concepto: fletes, comisiones, " +
  "impuestos, gastos, sueldos, indemnizaciones, pagos a mensajeros y ajustes. No incluye el " +
  "dinero de las tiendas: el contra-entrega cobrado no es de Ordenex y por eso no está en la " +
  "ganancia.";

const INGRESOS_TITULO = "Ingresos";
const EGRESOS_TITULO = "Egresos";
const INGRESOS_GRUPO_ARIA = "Desglose de ingresos";
const INGRESOS_TOTAL_LABEL = "Total de ingresos";
const GANANCIA_LABEL = "Ganancia de Ordenex";

/**
 * Icono de cada concepto de ingreso. `Record` TOTAL sobre las siete categorías de ingreso
 * propio: una categoría nueva rompe el build hasta que alguien decida cómo se dibuja. Los tres
 * impuestos comparten icono a propósito — son la misma clase de dinero.
 */
const INGRESO_ICONO: Record<WalletIngresoPropio, LucideIcon> = {
  ingreso_flete: Truck,
  ingreso_flete_devolucion: ArrowRightLeft,
  ingreso_comision_cod: HandCoins,
  ingreso_iva_flete: Percent,
  ingreso_iva_flete_devolucion: Percent,
  ingreso_iva_comision_cod: Percent,
  ingreso_ajuste: Scale,
};

/** Insignia del signo de la ganancia. Las mismas variantes semánticas que la tarjeta de la caja. */
const SIGNO_BADGE: Record<
  WalletBalanceSigno,
  { variant: "success" | "danger" | "secondary"; label: string }
> = {
  positivo: { variant: "success", label: "Positivo" },
  negativo: { variant: "danger", label: "Negativo" },
  cero: { variant: "secondary", label: "En cero" },
};

const SIGNO_COLOR: Record<WalletBalanceSigno, string> = {
  positivo: "text-success-strong",
  negativo: "text-danger-strong",
  cero: "text-muted-foreground",
};

/**
 * Rótulo VISIBLE de una de las dos columnas. No es un encabezado del documento: la tarjeta vive
 * dentro de una página cuyo único `h1` es el título, y colgar aquí un `h3` sin `h2` por encima
 * rompería el orden por el que navega un lector de pantalla. El nombre accesible de cada columna
 * lo da el `aria-label` de su `<dl role="group">`, que dice lo mismo con más palabras.
 */
function TituloColumna({ children }: { children: string }) {
  return <span className="px-4 text-sm font-medium text-foreground">{children}</span>;
}

export interface ComposicionGananciaCardProps {
  /** El desglose de ingresos propios y los totales, ya derivados en el servidor. */
  composicion: ComposicionGananciaDTO;
  /** Los cuatro conceptos de egreso que la 45/158 ya abría. Su forma NO cambia. */
  desglose: DesgloseEgresosDTO;
  /** De aquí salen `ganancia` y `signoGanancia` del pie (R27). */
  resumen: CajaResumenDTO;
  /**
   * Ficha 339 (T5.5/T5.6, R20) — los filtros VIGENTES de la wallet, que bajan hasta el detalle
   * de cada fila. La tarjeta no los lee ni los interpreta: los transporta, para que el
   * desplegable de una fila y el importe de esa fila hablen SIEMPRE del mismo conjunto.
   */
  filtros: WalletFiltrosValue;
}

export function ComposicionGananciaCard({
  composicion,
  desglose,
  resumen,
  filtros,
}: ComposicionGananciaCardProps) {
  const badge = SIGNO_BADGE[resumen.signoGanancia];

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>{TITULO}</CardTitle>
        <CardDescription>{DESCRIPCION}</CardDescription>
        <CardAction>
          <span className="inline-flex items-center justify-center rounded-md bg-muted p-2 text-muted-foreground">
            <Wallet className="size-4" aria-hidden="true" />
          </span>
        </CardAction>
      </CardHeader>

      {/* Las dos columnas, apiladas en móvil. `items-start` para que la más corta no se estire
          hasta la altura de la otra y deje su cierre flotando a media tarjeta. */}
      <CardContent className="grid grid-cols-1 items-start gap-6 px-0 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <TituloColumna>{INGRESOS_TITULO}</TituloColumna>
          <dl
            role="group"
            aria-label={INGRESOS_GRUPO_ARIA}
            className="flex flex-col gap-0.5"
          >
            {/* Ficha 339 (Q1, decisión cerrada): «cada fila se puede abrir» es CADA fila. Las
                siete de ingreso también, y por el mismo mecanismo: una asimetría nueva entre
                las dos columnas sería exactamente el defecto que la 343 vino a cerrar. */}
            {WALLET_INGRESO_PROPIO_SEED.map((categoria) => (
              <FilaComposicion
                key={categoria}
                fila={categoria}
                // R25: la etiqueta legible que ya existe, nunca el valor del enum.
                label={CATEGORIA_LABEL[categoria]}
                valor={composicion.ingresos[categoria]}
                icono={INGRESO_ICONO[categoria]}
                tono="ingreso"
                filtros={filtros}
              />
            ))}

            <div className="mt-3 flex items-center justify-between gap-4 border-t bg-muted/50 px-4 py-3">
              <dt className="text-sm font-medium">{INGRESOS_TOTAL_LABEL}</dt>
              <dd className="text-base font-semibold tabular-nums text-success-strong">
                {money(composicion.totalIngresos)}
              </dd>
            </div>
          </dl>
        </div>

        <div className="flex flex-col gap-2">
          <TituloColumna>{EGRESOS_TITULO}</TituloColumna>
          {/* R26 (231): los cuatro conceptos de siempre MÁS lo que no tiene fila, para que el
              total de esta columna sea exactamente `egresosPropios`.

              Ficha 339 (R1/R2/R7/R8): los pagos a mensajeros y los ajustes dejan de ser «lo que
              no tiene fila» y pasan a tener la suya; «Otros gastos de Ordenex» se pinta SOLO si
              el servidor dice que ahí queda dinero. El total no se mueve ni un céntimo: lo que
              cambia es de qué cubeta sale cada importe, no la suma. */}
          <DesgloseEgresosLista
            desglose={desglose}
            egresos={composicion.egresos}
            otrosEgresos={composicion.otrosEgresos}
            hayOtrosEgresos={composicion.hayOtrosEgresos}
            total={composicion.totalEgresos}
            filtros={filtros}
          />
        </div>
      </CardContent>

      {/* El pie: la resta, con el signo que manda el servidor (R27). */}
      <CardFooter className="flex-wrap justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{GANANCIA_LABEL}</span>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
        <span
          className={cn(
            "text-xl font-semibold tabular-nums",
            SIGNO_COLOR[resumen.signoGanancia],
          )}
        >
          {money(resumen.ganancia)}
        </span>
      </CardFooter>
    </Card>
  );
}
