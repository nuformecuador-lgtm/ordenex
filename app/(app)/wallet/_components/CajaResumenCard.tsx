"use client";

import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { CajaResumenDTO, WalletBalanceSigno } from "@/lib/types/wallet";

import {
  CAJA_RESUMEN_AVISO_PERIODO,
  CAJA_RESUMEN_AVISO_TERCEROS,
  CAJA_RESUMEN_LABEL,
  CAJA_RESUMEN_NOTA_DIFERENCIA,
  CAJA_TIENDAS_HREF,
  money,
} from "./wallet-labels";

// Feature 173 (T G.1, design §8) — la tarjeta de la caja. Sustituye a la tarjeta de una sola
// cifra de la 42, y el renombrado del archivo es parte del encargo: mientras el archivo llevara
// esa palabra en el nombre, alguien volveria a ponerla en pantalla. Aqui no aparece: ni en un
// rotulo, ni en un `aria-label`, ni en un comentario.
//
// Lo que cambia respecto de la 42 no es como se pinta un numero: son DOS numeros donde habia uno,
// y se ven A LA VEZ (R58). Nada de pestanas ni de desplegables — el punto entero de la feature es
// que nadie confunda el dinero que pasa por la caja con lo que Ordenex gana.
//
//  - «Dinero en caja» (R4): todo lo que entro menos todo lo que salio, incluido el contra-entrega
//    que se cobro a nombre de las tiendas.
//  - «Ganancia de Ordenex» (R5): es, numero por numero, el que la 42 rotulaba de la otra manera.
//    No cambia de valor: cambia de nombre.
//  - Tercera linea `[P6]` (R34): la diferencia entre las dos, con su advertencia de que NO es la
//    deuda con las tiendas y el enlace a la pantalla donde esa deuda si vive.
//
// Money-safe (R64): los seis importes llegan ya derivados y serializados por el SERVIDOR y se
// pintan TAL CUAL con `money`. Aqui no se suma, no se resta y no se convierte a numero; los dos
// signos tambien los da el servidor. El rotulo condicional `[P7]` se decide con la bandera
// `periodoFiltrado` del DTO, no deduciendo en el cliente si hay filtros puestos.

const SIGNO_BADGE: Record<
  WalletBalanceSigno,
  { variant: "default" | "secondary" | "destructive" | "outline"; label: string }
> = {
  positivo: { variant: "default", label: "Positivo" },
  negativo: { variant: "destructive", label: "Negativo" },
  cero: { variant: "secondary", label: "En cero" },
};

/** Color de una cifra grande segun su signo (verde/rojo/neutro). */
const SIGNO_COLOR: Record<WalletBalanceSigno, string> = {
  positivo: "text-success-strong",
  negativo: "text-danger-strong",
  cero: "text-muted-foreground",
};

/** Una de las dos cifras grandes: rotulo, insignia de signo, importe y su aclaracion. */
function Cifra({
  rotulo,
  pista,
  valor,
  signo,
}: {
  rotulo: string;
  pista: string;
  /** STRING del servidor, pintado tal cual (puede venir "-123.45"). */
  valor: string;
  signo: WalletBalanceSigno;
}) {
  const badge = SIGNO_BADGE[signo];
  return (
    <section aria-label={rotulo} className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{rotulo}</span>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>
      <span className={`text-3xl font-semibold tracking-tight ${SIGNO_COLOR[signo]}`}>
        {money(valor)}
      </span>
      <span className="text-xs text-muted-foreground">{pista}</span>
    </section>
  );
}

/** Un importe del desglose de una cifra grande. */
function Importe({
  rotulo,
  valor,
  className,
}: {
  rotulo: string;
  /** STRING del servidor, pintado tal cual. */
  valor: string;
  className?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-sm text-muted-foreground">{rotulo}</span>
      <span className={`text-lg font-medium ${className ?? ""}`}>{money(valor)}</span>
    </div>
  );
}

export interface CajaResumenCardProps {
  /** Las dos cifras (y la tercera linea) ya derivadas en el servidor, montos STRING. */
  resumen: CajaResumenDTO;
}

export function CajaResumenCard({ resumen }: CajaResumenCardProps) {
  // `[P7]`: el HECHO lo da el servidor; aqui solo se elige el rotulo que no miente.
  const rotuloEnCaja = resumen.periodoFiltrado
    ? CAJA_RESUMEN_LABEL.enCajaPeriodo
    : CAJA_RESUMEN_LABEL.enCaja;

  return (
    <Card>
      <CardContent className="flex flex-col gap-6 pt-2">
        {/* R58: las dos, a la vez y con el mismo peso visual. */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div className="flex flex-col gap-4">
            <Cifra
              rotulo={rotuloEnCaja}
              pista={CAJA_RESUMEN_LABEL.enCajaPista}
              valor={resumen.enCaja}
              signo={resumen.signoEnCaja}
            />
            <div className="grid grid-cols-2 gap-4 border-t pt-3">
              <Importe
                rotulo={CAJA_RESUMEN_LABEL.entradas}
                valor={resumen.entradas}
                className="text-success-strong"
              />
              <Importe
                rotulo={CAJA_RESUMEN_LABEL.salidas}
                valor={resumen.salidas}
                className="text-danger-strong"
              />
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <Cifra
              rotulo={CAJA_RESUMEN_LABEL.ganancia}
              pista={CAJA_RESUMEN_LABEL.gananciaPista}
              valor={resumen.ganancia}
              signo={resumen.signoGanancia}
            />
            <div className="grid grid-cols-2 gap-4 border-t pt-3">
              <Importe
                rotulo={CAJA_RESUMEN_LABEL.ingresosPropios}
                valor={resumen.ingresosPropios}
                className="text-success-strong"
              />
              <Importe
                rotulo={CAJA_RESUMEN_LABEL.egresosPropios}
                valor={resumen.egresosPropios}
                className="text-danger-strong"
              />
            </div>
          </div>
        </div>

        {/* R60: en que se diferencian, junto a las dos cifras y no en otra pantalla. */}
        <p role="note" className="border-t pt-4 text-xs text-muted-foreground">
          {CAJA_RESUMEN_NOTA_DIFERENCIA}
        </p>

        {/* `[P7]`: solo cuando hay filtros, que es cuando el nombre de siempre mentiria. */}
        {resumen.periodoFiltrado ? (
          <p role="note" className="text-xs text-muted-foreground">
            {CAJA_RESUMEN_AVISO_PERIODO}
          </p>
        ) : null}

        {/* Tercera linea `[P6]` — R34: la advertencia y el enlace no son decorado, son la unica
            defensa contra leer esta cifra como la deuda con las tiendas. */}
        <section
          aria-label={CAJA_RESUMEN_LABEL.deTerceros}
          className="flex flex-col gap-1 border-t pt-4"
        >
          <span className="text-sm text-muted-foreground">
            {CAJA_RESUMEN_LABEL.deTerceros}
          </span>
          <span className="text-lg font-medium">{money(resumen.deTerceros)}</span>
          <p role="note" className="text-xs text-muted-foreground">
            {CAJA_RESUMEN_AVISO_TERCEROS}
          </p>
          <Link
            href={CAJA_TIENDAS_HREF}
            className="text-xs font-medium underline underline-offset-2 hover:text-foreground"
          >
            {CAJA_RESUMEN_LABEL.deTercerosEnlace}
          </Link>
        </section>
      </CardContent>
    </Card>
  );
}
