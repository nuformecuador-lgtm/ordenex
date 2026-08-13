"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  Landmark,
  TrendingUp,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

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
// `periodoFiltrado` del DTO, no deduciendo nada en el cliente.
//
// ── Feature 200 (tanda 1) — REDISENO DE PRESENTACION, no de datos ──
//
// La misma informacion pasa de UNA tarjeta monolitica a una GRILLA DE TILES hermanos (DESIGN.md:
// «Cards: hermanas, nunca anidadas»), con un tercer tile OPCIONAL de conteo. Lo que NO cambia,
// porque es lo que la feature 173 vino a impedir:
//
//  - las dos cifras siguen viendose A LA VEZ, sin nada que abrir: esta tarjeta no tiene ni un
//    solo `<button>`, y los iconos son decoracion (`aria-hidden`), no controles;
//  - cada cifra sigue siendo HERMANA de su propio desglose dentro de su tile, para que ningun
//    importe pueda leerse bajo el rotulo del de al lado;
//  - la tercera linea sigue viviendo AQUI —ahora como banda destacada a lo ancho—, con su
//    advertencia y su enlace: sacarla a otro componente la separaria de las cifras que explica.
//
// El tercer tile (`movimientos`) es un CONTEO, no dinero: color neutro, sin insignia de signo y
// sin desglose. Llega como prop opcional; sin ella la grilla queda de dos columnas.

// Feature 200 (tanda 2) — las insignias de signo pasan a las variantes SEMANTICAS de la
// primitiva. «Positivo» venia con `default`, que es el naranja de marca, y DESIGN.md lo
// reserva para accion primaria y seleccion: un estado pintado con el color de la accion
// compite con los botones de la pantalla y deja de leerse como estado. Los TEXTOS no cambian.
const SIGNO_BADGE: Record<
  WalletBalanceSigno,
  { variant: "success" | "danger" | "secondary"; label: string }
> = {
  positivo: { variant: "success", label: "Positivo" },
  negativo: { variant: "danger", label: "Negativo" },
  cero: { variant: "secondary", label: "En cero" },
};

/** Color de una cifra grande segun su signo (verde/rojo/neutro). */
const SIGNO_COLOR: Record<WalletBalanceSigno, string> = {
  positivo: "text-success-strong",
  negativo: "text-danger-strong",
  cero: "text-muted-foreground",
};

/** Tipografia comun de las cifras grandes: mismo peso para las tres, ninguna manda. */
const CIFRA_GRANDE = "text-3xl font-semibold tracking-tight tabular-nums";

/**
 * El icono de un tile. Es DECORACION: nombra lo que el rotulo ya dice, asi que se oculta al
 * lector de pantalla en vez de repetirselo.
 */
function IconoTile({ icono: Icono }: { icono: LucideIcon }) {
  // La caja va EXPLICITA (`inline-flex items-center justify-center`). Un `<span>` es inline por
  // defecto y hoy solo se comporta como caja porque su padre resulta ser un contenedor flex que
  // lo blockifica: funcionaba por accidente. Sin la caja propia, en cualquier otro contenedor el
  // `p-2` no genera area, el `bg-muted` se pinta como una tira estirada a la altura de la linea
  // y el icono se desborda. Con ella mide 32 x 32 alli donde se ponga.
  return (
    <span className="inline-flex items-center justify-center rounded-md bg-muted p-2 text-muted-foreground">
      <Icono className="size-4" aria-hidden="true" />
    </span>
  );
}

/** Cabecera de un tile: rotulo (con su insignia, si la lleva) a la izquierda; icono a la derecha. */
function CabeceraTile({
  rotulo,
  insignia,
  icono,
}: {
  rotulo: string;
  insignia?: ReactNode;
  icono: LucideIcon;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">{rotulo}</span>
        {insignia}
      </div>
      <IconoTile icono={icono} />
    </div>
  );
}

/**
 * Tile de una de las dos cifras de DINERO: rotulo, insignia de signo, importe grande, su
 * aclaracion y —hermano de la `<section>`, no dentro— su desglose.
 */
function TileCifra({
  rotulo,
  pista,
  valor,
  signo,
  icono,
  desglose,
}: {
  rotulo: string;
  pista: string;
  /** STRING del servidor, pintado tal cual (puede venir "-123.45"). */
  valor: string;
  signo: WalletBalanceSigno;
  icono: LucideIcon;
  desglose: ReactNode;
}) {
  const badge = SIGNO_BADGE[signo];
  return (
    <Card>
      <CardContent className="flex flex-1 flex-col gap-3">
        <section aria-label={rotulo} className="flex flex-col gap-2">
          <CabeceraTile
            rotulo={rotulo}
            insignia={<Badge variant={badge.variant}>{badge.label}</Badge>}
            icono={icono}
          />
          <span className={`${CIFRA_GRANDE} ${SIGNO_COLOR[signo]}`}>{money(valor)}</span>
          <span className="text-xs text-muted-foreground">{pista}</span>
        </section>
        <div className="mt-auto grid grid-cols-2 gap-4 border-t pt-3">{desglose}</div>
      </CardContent>
    </Card>
  );
}

/**
 * Tile del CONTEO de movimientos. No es dinero: ni color semantico ni insignia de signo, para
 * que no compita con las dos cifras ni parezca una tercera. El entero se pinta tal cual.
 */
function TileConteo({ cantidad }: { cantidad: number }) {
  return (
    <Card>
      <CardContent className="flex flex-1 flex-col gap-2">
        <CabeceraTile rotulo={CAJA_RESUMEN_LABEL.movimientos} icono={ArrowLeftRight} />
        <span className={`${CIFRA_GRANDE} text-foreground`}>{cantidad}</span>
        <span className="text-xs text-muted-foreground">
          {CAJA_RESUMEN_LABEL.movimientosPista}
        </span>
      </CardContent>
    </Card>
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
      <span className="text-xs text-muted-foreground">{rotulo}</span>
      <span className={`text-lg font-medium tabular-nums ${className ?? ""}`}>
        {money(valor)}
      </span>
    </div>
  );
}

export interface CajaResumenCardProps {
  /** Las dos cifras (y la tercera linea) ya derivadas en el servidor, montos STRING. */
  resumen: CajaResumenDTO;
  /**
   * Feature 200: cuantos registros tiene el conjunto que se esta mirando. Es el `total` del
   * servidor, no el largo de la pagina pintada. Opcional: sin el, la grilla queda de dos tiles.
   */
  movimientos?: number;
}

export function CajaResumenCard({ resumen, movimientos }: CajaResumenCardProps) {
  // `[P7]`: el HECHO lo da el servidor; aqui solo se elige el rotulo que no miente.
  const rotuloEnCaja = resumen.periodoFiltrado
    ? CAJA_RESUMEN_LABEL.enCajaPeriodo
    : CAJA_RESUMEN_LABEL.enCaja;

  // Las clases van completas en cada rama: Tailwind lee el fuente, no evalua expresiones.
  const grilla =
    movimientos === undefined
      ? "grid grid-cols-1 gap-4 md:grid-cols-2"
      : "grid grid-cols-1 gap-4 md:grid-cols-3";

  return (
    <div className="flex flex-col gap-4">
      {/* R58: las dos, a la vez y con el mismo peso visual. */}
      <div className={grilla}>
        <TileCifra
          rotulo={rotuloEnCaja}
          pista={CAJA_RESUMEN_LABEL.enCajaPista}
          valor={resumen.enCaja}
          signo={resumen.signoEnCaja}
          icono={Landmark}
          desglose={
            <>
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
            </>
          }
        />

        <TileCifra
          rotulo={CAJA_RESUMEN_LABEL.ganancia}
          pista={CAJA_RESUMEN_LABEL.gananciaPista}
          valor={resumen.ganancia}
          signo={resumen.signoGanancia}
          icono={TrendingUp}
          desglose={
            <>
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
            </>
          }
        />

        {movimientos === undefined ? null : <TileConteo cantidad={movimientos} />}
      </div>

      {/* R60: en que se diferencian, junto a las dos cifras y no en otra pantalla. */}
      <div className="flex flex-col gap-2">
        <p role="note" className="text-xs text-muted-foreground">
          {CAJA_RESUMEN_NOTA_DIFERENCIA}
        </p>

        {/* `[P7]`: solo cuando hay un periodo elegido, que es cuando el nombre de siempre
            mentiria. */}
        {resumen.periodoFiltrado ? (
          <p role="note" className="text-xs text-muted-foreground">
            {CAJA_RESUMEN_AVISO_PERIODO}
          </p>
        ) : null}
      </div>

      {/* Tercera linea `[P6]` — R34: la advertencia y el enlace no son decorado, son la unica
          defensa contra leer esta cifra como la deuda con las tiendas. Va a lo ancho y con el
          color de aviso porque es lo ultimo que se lee antes de sacar una conclusion. */}
      <section
        aria-label={CAJA_RESUMEN_LABEL.deTerceros}
        className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning-soft p-4 sm:flex-row sm:items-start sm:gap-4 dark:bg-warning/15"
      >
        <span className="w-fit rounded-md bg-warning/15 p-2 text-warning-strong">
          <TriangleAlert className="size-4" aria-hidden="true" />
        </span>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-warning-strong">
            {CAJA_RESUMEN_LABEL.deTerceros}
          </span>
          {/* Feature 208 — LA CIFRA va en `text-foreground`, no en el color de aviso.
              El aviso lo siguen dando el icono, el rótulo, el borde y el fondo; el
              número es dinero y necesita margen, no el aprobado justo:
              `text-warning-strong` sobre `bg-warning-soft` medía 4.51:1 en tema claro
              (el umbral AA es 4.50), y quedarse a una centésima de la línea en el
              importe que se retiene de terceros no es aceptable. Medido después:
              14.22:1 en claro y 15.1:1 en oscuro.

              Feature 210 — ese 4.51 YA NO ES EL VIGENTE: `--warning-strong` pasó a
              #92400e y el par mide 6.37:1. La decisión de arriba NO cambia —la cifra
              sigue en `text-foreground`, que da 14.22— pero el motivo que la justificaba
              está saldado, así que no vuelvas aquí buscando el 4.51. El contraste de
              estos pares lo vigila ahora `contraste-tokens.guardia.test.ts`. */}
          <span className="text-2xl font-semibold tracking-tight tabular-nums text-foreground">
            {money(resumen.deTerceros)}
          </span>
          <p role="note" className="text-xs text-muted-foreground">
            {CAJA_RESUMEN_AVISO_TERCEROS}
          </p>
          <Link
            href={CAJA_TIENDAS_HREF}
            className="w-fit rounded-sm text-xs font-medium text-warning-strong underline underline-offset-2 transition-colors duration-200 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {CAJA_RESUMEN_LABEL.deTercerosEnlace}
          </Link>
        </div>
      </section>
    </div>
  );
}
