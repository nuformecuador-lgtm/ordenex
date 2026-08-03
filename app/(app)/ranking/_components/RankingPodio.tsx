"use client";

import { Award, Crown, Medal, Trophy } from "lucide-react";

import { EmptyState } from "@/components/shared/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import type { RankingRowDTO } from "@/lib/types/ranking";

import {
  PODIO_LABELS,
  RANKING_LABELS,
  SIN_DATO,
  anchoBarra,
  conteoCrudo,
  iniciales,
  money,
  porcentaje,
} from "./ranking-labels";

// Rediseño de la sección de ranking: podio visual (2º - 1º - 3º) + lista del resto.
// Presenta EXACTAMENTE los mismos datos que `RankingModule` (mismo `RankingRowDTO[]`):
// el orden ya viene resuelto del servidor (R4/R5) y los montos/porcentajes llegan como
// STRING (R12) — aquí solo se anteponen símbolos, nunca se recalculan. La única lectura
// numérica es `anchoBarra`, y es puramente visual (ancho CSS de la barra).
// Nota: es solo-lectura. La edición de premios sigue viviendo en `RankingModule`.

/** Paleta de cada escalón del podio, en tokens de marca (DESIGN.md: nada de hex sueltos
 * ni utilidades crudas de Tailwind). Oro → warning/hivis, plata → asfalto, bronce → brand. */
const ESCALONES = {
  1: {
    fondo: "bg-warning-soft",
    aro: "ring-warning",
    texto: "text-warning-strong",
    premio: "bg-warning text-navy-deep",
    alto: "h-32",
    avatar: "size-16 text-lg",
    porcentaje: "text-3xl",
    nombre: "text-sm",
  },
  2: {
    fondo: "bg-asfalto-1",
    aro: "ring-asfalto-4",
    texto: "text-asfalto-7",
    premio: "bg-asfalto-2 text-asfalto-9",
    alto: "h-24",
    avatar: "size-14 text-base",
    porcentaje: "text-2xl",
    nombre: "text-[13px]",
  },
  3: {
    fondo: "bg-brand-soft",
    aro: "ring-brand-light",
    texto: "text-brand-dark",
    premio: "bg-brand-light text-navy-deep",
    alto: "h-20",
    avatar: "size-14 text-base",
    porcentaje: "text-2xl",
    nombre: "text-[13px]",
  },
} as const;

type Posicion = keyof typeof ESCALONES;

/** Icono del escalón. Fuera del map de paleta porque es JSX, no clases. */
function IconoEscalon({ posicion, clase }: { posicion: Posicion; clase: string }) {
  if (posicion === 1) return <Trophy size={30} className={clase} aria-hidden="true" />;
  if (posicion === 2) return <Medal size={24} className={clase} aria-hidden="true" />;
  return <Award size={24} className={clase} aria-hidden="true" />;
}

function EscalonPodio({
  fila,
  posicion,
}: {
  fila: RankingRowDTO | null;
  posicion: Posicion;
}) {
  const s = ESCALONES[posicion];
  const destacado = posicion === 1;

  // Posición sin ocupante elegible (R15): pedestal apagado, NO se inventa mensajero.
  if (fila === null) {
    return (
      <li className="flex flex-col justify-end text-center">
        {destacado ? (
          <Crown
            size={22}
            className="mx-auto mb-0.5 text-hivis opacity-40"
            aria-hidden="true"
          />
        ) : null}
        {/* El escalón conserva SU color aunque no haya ocupante: el podio se lee siempre
            como oro/plata/bronce. Lo que se atenúa es el contenido, no la identidad. */}
        <div
          className={`mx-auto mb-2 ${s.avatar} ${s.fondo} ${s.aro} ${s.texto} flex items-center justify-center rounded-full font-medium ring-2 ring-dashed`}
          aria-hidden="true"
        >
          {SIN_DATO}
        </div>
        <div className={`${s.nombre} font-medium text-muted-foreground`}>
          {PODIO_LABELS.sinOcupante}
        </div>
        <div className="mb-2 text-[11px] text-muted-foreground">{SIN_DATO}</div>
        <div
          className={`${s.alto} ${s.fondo} flex flex-col items-center rounded-t-xl px-2 pb-3 pt-4`}
        >
          <IconoEscalon posicion={posicion} clase={`${s.texto} opacity-50`} />
          <div className={`${s.porcentaje} ${s.texto} mt-1 font-medium opacity-50`}>
            {SIN_DATO}
          </div>
          <div className={`text-[11px] ${s.texto}`}>{PODIO_LABELS.lugar(posicion)}</div>
        </div>
      </li>
    );
  }

  return (
    <li className="flex flex-col justify-end text-center">
      {destacado ? (
        <Crown size={22} className="mx-auto mb-0.5 text-hivis" aria-hidden="true" />
      ) : null}
      <div
        className={`mx-auto mb-2 ${s.avatar} ${s.fondo} ${s.aro} ${s.texto} flex items-center justify-center rounded-full font-medium ring-2`}
        aria-hidden="true"
      >
        {iniciales(fila.nombre)}
      </div>
      <div className={`${s.nombre} font-medium text-foreground`}>{fila.nombre}</div>
      <div className="mb-2 text-[11px] text-muted-foreground tabular-nums">
        {conteoCrudo(fila.entregadasHoy, fila.asignadasHoy)} {PODIO_LABELS.conteoSufijo}
      </div>
      <div
        className={`${s.alto} ${s.fondo} flex flex-col items-center rounded-t-xl px-2 pb-3 pt-4`}
      >
        <IconoEscalon posicion={posicion} clase={s.texto} />
        <div className={`${s.porcentaje} ${s.texto} mt-1 font-medium tabular-nums`}>
          {porcentaje(fila.pct)}
        </div>
        <div className={`text-[11px] ${s.texto}`}>{PODIO_LABELS.lugar(posicion)}</div>
        {fila.premio !== null ? (
          <div
            className={`${s.premio} mt-2.5 rounded-full px-3 py-1 text-[13px] font-medium tabular-nums`}
          >
            {money(fila.premio)}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function FilaResto({
  fila,
  lugar,
  esPropio = false,
}: {
  fila: RankingRowDTO;
  lugar: number;
  /** Fila del mensajero que está mirando: se realza el fondo para que se ubique de un vistazo. */
  esPropio?: boolean;
}) {
  return (
    <li
      className={`grid grid-cols-[28px_1fr_52px] items-center gap-2.5 border-b border-border px-1.5 py-2 last:border-b-0 sm:grid-cols-[28px_1fr_120px_52px] ${
        esPropio
          ? "rounded-md border-b-transparent bg-accent px-2.5 ring-1 ring-brand-light"
          : ""
      }`}
    >
      <span
        className={`text-center text-[13px] font-medium tabular-nums ${
          esPropio ? "text-brand-dark" : "text-muted-foreground"
        }`}
      >
        {lugar}
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className={`truncate text-[13px] ${
              esPropio ? "font-medium text-brand-dark" : "text-foreground"
            }`}
          >
            {fila.nombre}
          </span>
          {esPropio ? (
            <span className="shrink-0 rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary-foreground">
              {PODIO_LABELS.vos}
            </span>
          ) : null}
        </div>
        <div className="text-[11px] text-muted-foreground tabular-nums">
          {conteoCrudo(fila.entregadasHoy, fila.asignadasHoy)} {PODIO_LABELS.conteoSufijo}
        </div>
      </div>
      <div
        className="hidden h-[7px] overflow-hidden rounded-full bg-muted sm:block"
        aria-hidden="true"
      >
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${anchoBarra(fila.pct)}%` }}
        />
      </div>
      <span className="text-right text-sm font-medium text-foreground tabular-nums">
        {porcentaje(fila.pct)}
      </span>
    </li>
  );
}

export interface RankingPodioProps {
  /** Filas YA ordenadas por el servidor (R4/R5). Mismo DTO que `RankingModule`. */
  ranking: RankingRowDTO[];
  /**
   * `usuarioId` del mensajero que está mirando; `null` para maestro/admin (no tienen
   * fila propia). Se usa para realzar su fila y para anclarla si quedó fuera del top.
   */
  mensajeroPropioId?: string | null;
  /**
   * Cuántos mensajeros mostrar como máximo, PODIO INCLUIDO. `null` = lista completa
   * (maestro/admin, que necesitan la vista operativa entera).
   */
  limite?: number | null;
}

export function RankingPodio({
  ranking,
  mensajeroPropioId = null,
  limite = null,
}: RankingPodioProps) {
  // El podio se arma por `posicion` (1-3), NO por índice: una fila puede estar arriba en
  // la lista y aun así no ser elegible para el podio (`posicion: null`, R14/R15).
  const enPodio = (p: Posicion): RankingRowDTO | null =>
    ranking.find((fila) => fila.posicion === p) ?? null;
  const podio = [1, 2, 3].map((p) => enPodio(p as Posicion));
  const resto = ranking.filter((fila) => !podio.includes(fila));
  // La numeración del resto continúa tras los escalones REALMENTE ocupados: si el podio
  // tiene huecos (R15), la lista arranca en 2 o 3, no siempre en 4.
  const primerLugarDelResto = podio.filter(Boolean).length + 1;

  // Recorte: `limite` cuenta el podio, así que a la lista le queda lo que sobra.
  const restoVisible =
    limite === null
      ? resto
      : resto.slice(0, Math.max(0, limite - (primerLugarDelResto - 1)));

  // Si el que mira es un mensajero que quedó fuera del recorte, su fila se ancla al final
  // CON SUS DATOS REALES (posición real en la lista completa, conteo y % del servidor).
  const propioVisible =
    mensajeroPropioId !== null &&
    [...podio, ...restoVisible].some(
      (fila) => fila?.mensajeroId === mensajeroPropioId,
    );
  const indicePropio =
    mensajeroPropioId === null || propioVisible
      ? -1
      : resto.findIndex((fila) => fila.mensajeroId === mensajeroPropioId);
  const filaPropia = indicePropio === -1 ? null : resto[indicePropio];
  const lugarPropio = primerLugarDelResto + indicePropio;

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-[18px] font-medium text-foreground">
              <Trophy size={19} className="text-warning-strong" aria-hidden="true" />
              {PODIO_LABELS.titulo}
            </div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {PODIO_LABELS.descripcion}
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-border bg-muted px-2.5 py-1 text-[12px] font-medium text-muted-foreground">
            {PODIO_LABELS.contador(ranking.length)}
          </span>
        </div>

        {ranking.length === 0 ? (
          <div className="mt-4">
            <EmptyState icon={Trophy} title={RANKING_LABELS.vacio} />
          </div>
        ) : (
          <>
            {/* Podio en orden visual 2º - 1º - 3º (el 1º al centro y más alto). */}
            <ul
              aria-label={PODIO_LABELS.podioAria}
              className="mb-2 mt-5 grid grid-cols-3 items-end gap-2.5"
            >
              <EscalonPodio fila={podio[1]} posicion={2} />
              <EscalonPodio fila={podio[0]} posicion={1} />
              <EscalonPodio fila={podio[2]} posicion={3} />
            </ul>

            {restoVisible.length > 0 || filaPropia !== null ? (
              <>
                <div className="my-3.5 h-1 rounded-full bg-muted" aria-hidden="true" />
                <ul aria-label={PODIO_LABELS.listaAria}>
                  {restoVisible.map((fila, i) => (
                    <FilaResto
                      key={fila.mensajeroId}
                      fila={fila}
                      lugar={primerLugarDelResto + i}
                      esPropio={fila.mensajeroId === mensajeroPropioId}
                    />
                  ))}
                </ul>

                {filaPropia !== null ? (
                  <div className="mt-3">
                    <p className="mb-1.5 px-1.5 text-[11px] text-muted-foreground">
                      {PODIO_LABELS.fueraDelTop(limite ?? 0)}
                    </p>
                    <ul>
                      <FilaResto
                        fila={filaPropia}
                        lugar={lugarPropio}
                        esPropio
                      />
                    </ul>
                  </div>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
