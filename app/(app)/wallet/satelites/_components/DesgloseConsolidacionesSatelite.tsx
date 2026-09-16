"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { SegmentedToggle } from "@/components/shared/SegmentedToggle";
import { filasDesdeResultado } from "@/components/shared/descarga-resultado";
import { ConciliacionAcciones } from "@/components/shared/conciliacion/ConciliacionAcciones";
import {
  DESMARCAR_NO_MUEVE_DINERO_NOTA,
  DESMARCAR_NO_MUEVE_DINERO_TITULO,
} from "@/components/shared/conciliacion/conciliacion-labels";
import {
  listarConsolidacionesSateliteAction,
  listarConsolidacionesSateliteCompletoAction,
} from "@/lib/actions/conciliacion-satelites";
import { cierreBodegaConfig } from "@/lib/config/cierre-bodega";
import type {
  ConsolidacionSateliteDTO,
  SaldoSateliteDTO,
} from "@/lib/types/conciliacion-satelites";

import {
  COLUMNAS_DESCARGA_CONSOLIDACIONES_SATELITE,
  filaDescargaConsolidacionSatelite,
} from "./consolidaciones-satelite-descarga-columnas";
import {
  DESGLOSE_SATELITE,
  DESGLOSE_SATELITE_COLUMNAS,
  DESGLOSE_SATELITE_ERROR,
  DESGLOSE_SATELITE_FILTRO,
  DESGLOSE_SATELITE_NOMBRE,
  DESGLOSE_SATELITE_VACIO,
  ESTADO_CONCILIACION_LABEL,
  ESTADO_CONCILIACION_VARIANT,
  SIN_DATO,
  estadoConciliacionDe,
  money,
} from "./satelites-labels";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 431 (T21, R22/R24/R25) — EL DESGLOSE DE UNA BODEGA SATÉLITE.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Se MONTA al desplegar su fila en `SaldosSatelitesTable` (el `renderExpanded` del `DataTable`
// sólo monta lo abierto), y es aquí —dentro de este componente— donde vive el `useSWR`: por eso
// listar N bodegas cuesta CERO lecturas de desglose y abrir una fila cuesta exactamente una, sólo
// la de esa bodega. Cada instancia lleva su página, su filtro y su caché, así que dos filas
// abiertas no se pisan. Es el patrón exacto de `DesgloseMovimientosTienda` (feature 171).
//
// ── MONEY-SAFE (R20): CERO `Number(`, CERO `parseFloat`, CERO restas.
// Los cinco importes de cada fila y el «Pendiente de llegar» de la cabecera llegan como STRING ya
// derivados del SERVIDOR y se pintan TAL CUAL con `money`. En particular `faltaPorRecibir` NO se
// calcula aquí: la identidad `declarado − recibido = falta` es exactamente la clase de resta que
// la ficha 359 encontró rota en 13 pantallas, y por eso este par entra en
// `tests/components/DineroIdentidadesEnPantalla.test.tsx`.
//
// ── EL AVISO DE LA CABECERA NO ES DECORACIÓN
// Es la mitad que faltaba del control de seguimiento (Q7). Cuando la central marca por menos de lo
// declarado, la diferencia tiene que estar A LA VISTA de las dos partes; si sólo viviera en una
// columna de una tabla, la bodega la descubriría semanas después, cuando alguien se la reclame.

/** Tamaño de página del desglose. Sale de la config del dominio, no de un literal de pantalla. */
const DESGLOSE_PAGE_SIZE = 20;

/** Prefijo de la clave SWR. Identifica esta lectura entre todas las de la app. */
const CLAVE_DESGLOSE = "wallet-satelites:desglose";

/** Los dos conjuntos que el conmutador ofrece. */
type FiltroDesglose = "sin_conciliar" | "todas";

/**
 * Clave SWR de UN desglose. Exportada a propósito, por el mismo motivo que
 * `claveDesgloseTienda`: es lo que permite refrescar el desglose de UNA bodega —y sólo ésa— desde
 * fuera, tras marcar o desmarcar, sin recargar la página ni tocar las demás filas abiertas.
 */
export function claveDesgloseSatelite(
  zonaId: string,
  page: number = 1,
  filtro: FiltroDesglose = "sin_conciliar",
): readonly [string, string, number, string] {
  return [CLAVE_DESGLOSE, zonaId, page, filtro] as const;
}

/** Input del listado PAGINADO. `soloSinConciliar` sólo viaja cuando recorta: el schema es
 *  `.strict()` y un `false` explícito sería un filtro que no filtra. */
function buildInput(zonaId: string, page: number, filtro: FiltroDesglose) {
  return {
    zonaId,
    page,
    pageSize: DESGLOSE_PAGE_SIZE,
    ...(filtro === "sin_conciliar" ? { soloSinConciliar: true } : {}),
  };
}

/** Input del modo COMPLETO (la descarga): el MISMO filtro vigente, SIN paginación. Su schema es
 *  `.strict()`, así que colar `page` devolvería `validation_error` en vez de un archivo. */
function buildInputCompleto(zonaId: string, filtro: FiltroDesglose) {
  return {
    zonaId,
    ...(filtro === "sin_conciliar" ? { soloSinConciliar: true } : {}),
  };
}

interface PaginaDesglose {
  items: ConsolidacionSateliteDTO[];
  total: number;
}

/** Fetcher SWR: pide la página y traduce un status != ok a un throw (SWR lo marca error). */
async function leerDesglose(
  zonaId: string,
  page: number,
  filtro: FiltroDesglose,
): Promise<PaginaDesglose> {
  const res = await listarConsolidacionesSateliteAction(buildInput(zonaId, page, filtro));
  if (res.status !== "ok") throw new Error(res.status);
  return { items: res.items, total: res.total };
}

/** El día de la consolidación, como lo lee una persona. Sin horas: una bodega consolida una vez. */
function dia(iso: string): string {
  return iso.slice(0, 10);
}

/** Quién marcó y cuándo, en una línea. Sin marca no hay nada que decir. */
function conciliadoPorTexto(c: ConsolidacionSateliteDTO): string {
  if (c.conciliadoPorNombre === null || c.conciliadoAt === null) return SIN_DATO;
  return `${c.conciliadoPorNombre} · ${dia(c.conciliadoAt)}`;
}

export interface DesgloseConsolidacionesSateliteProps {
  /**
   * La fila de la tabla de saldos desde la que se despliega. El nombre y el saldo bajan por props
   * y NO se le piden al servidor: ya están aquí, y consultarlos costaría una lectura por cada
   * fila que se abre.
   */
  resumen: SaldoSateliteDTO;
  /** id del elemento, para enlazar con el `aria-controls` del botón que lo expande. */
  id?: string;
  /**
   * Si el actor puede marcar y desmarcar. Lo decide el SERVIDOR (`esAccesoTotal`, el mismo
   * predicado con el que el servicio responde `forbidden`) y baja por props. **Default `false`:
   * falla cerrado.**
   */
  puedeConciliar?: boolean;
}

export function DesgloseConsolidacionesSatelite({
  resumen,
  id,
  puedeConciliar = false,
}: Readonly<DesgloseConsolidacionesSateliteProps>) {
  const { zonaId, zonaNombre } = resumen;
  const { mutate } = useSWRConfig();
  const [page, setPage] = useState(1);
  // Arranca en «Sin conciliar» porque es la pregunta que trae a alguien a esta pantalla: qué
  // falta por llegar. Lo ya recibido es historia y está a un clic.
  const [filtro, setFiltro] = useState<FiltroDesglose>("sin_conciliar");

  const { data, error, isLoading } = useSWR(claveDesgloseSatelite(zonaId, page, filtro), () =>
    leerDesglose(zonaId, page, filtro),
  );

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  /**
   * Las consolidaciones de ESTA página que llegaron incompletas. Se usa SÓLO para decidir si el
   * aviso se enciende y para contarlas — **nunca para sumar dinero**: el importe del aviso es
   * `resumen.saldoSinConciliar`, que el servidor ya cuadró sobre la bodega entera.
   */
  const incompletas = items.filter((c) => estadoConciliacionDe(c) === "incompleto");

  /** Refresco DIRIGIDO tras marcar o desmarcar: esta bodega y la tabla de saldos, nada más. */
  async function refrescar() {
    await Promise.all([
      // Todas las páginas y filtros de ESTE desglose (la fila puede haberse movido de conjunto).
      mutate((clave) => Array.isArray(clave) && clave[0] === CLAVE_DESGLOSE && clave[1] === zonaId),
      // Y la tabla de arriba, cuyo «Pendiente» y cuyas tres tarjetas acaban de cambiar.
      mutate((clave) => Array.isArray(clave) && clave[0] === "wallet-satelites:saldos"),
    ]);
  }

  const COLUMNS: Column<ConsolidacionSateliteDTO>[] = [
    {
      id: "consolidada",
      value: DESGLOSE_SATELITE_COLUMNAS.consolidada,
      render: (c) => dia(c.solicitadoAt),
    },
    {
      id: "declarado",
      // «Declarado» es el EFECTIVO: lo que viaja en el bulto (decisión Q2). El general vive en la
      // línea de composición de abajo, como contexto.
      value: DESGLOSE_SATELITE_COLUMNAS.declarado,
      render: (c) => <span className="tabular-nums">{money(c.totales.efectivo)}</span>,
    },
    {
      id: "recibido",
      value: DESGLOSE_SATELITE_COLUMNAS.recibido,
      // Sin marcar se pinta «—» y NO «₡0,00»: «nadie lo ha mirado» no es «llegaron cero colones».
      render: (c) =>
        c.montoRecibido === null ? (
          <span className="text-muted-foreground">{SIN_DATO}</span>
        ) : (
          <span
            className={`tabular-nums font-medium ${
              estadoConciliacionDe(c) === "incompleto" ? "text-warning-strong" : ""
            }`}
          >
            {money(c.montoRecibido)}
          </span>
        ),
    },
    {
      id: "estado",
      value: DESGLOSE_SATELITE_COLUMNAS.estado,
      render: (c) => {
        const estado = estadoConciliacionDe(c);
        return (
          <Badge variant={ESTADO_CONCILIACION_VARIANT[estado]}>
            {ESTADO_CONCILIACION_LABEL[estado]}
          </Badge>
        );
      },
    },
    {
      id: "conciliadoPor",
      value: DESGLOSE_SATELITE_COLUMNAS.conciliadoPor,
      render: (c) => (
        <div className="flex flex-col">
          <span className="text-muted-foreground">{conciliadoPorTexto(c)}</span>
          {/* La NOTA se ve: es lo que distingue una conciliación real de la retroactiva del
              backfill de la migración (R30). No baja a la descarga (texto libre). */}
          {c.nota ? <span className="text-xs text-muted-foreground">{c.nota}</span> : null}
        </div>
      ),
    },
    {
      id: "acciones",
      value: "",
      render: (c) => (
        <ConciliacionAcciones
          cierreBodegaId={c.cierreBodegaId}
          bodega={zonaNombre}
          fecha={dia(c.solicitadoAt)}
          declarado={c.totales.efectivo}
          marca={c}
          nota={c.nota}
          puedeConciliar={puedeConciliar}
          onCambio={refrescar}
        />
      ),
    },
  ];

  return (
    <section
      id={id}
      aria-label={DESGLOSE_SATELITE_NOMBRE.region(zonaNombre)}
      className="flex flex-col gap-4 rounded-lg bg-muted/40 p-4"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-stretch">
        {/* «Pendiente de llegar»: el saldo de ESTA bodega, cuadrado por el servidor. */}
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4 md:w-72">
          <span className="text-sm text-muted-foreground">
            {DESGLOSE_SATELITE.pendienteRotulo}
          </span>
          <span className="text-2xl font-semibold tabular-nums text-foreground">
            {money(resumen.saldoSinConciliar)}
          </span>
        </div>

        {/*
          Q7 — EL AVISO DE LA DIFERENCIA, explicado y no sólo señalado.
          `role="status"` y no `alert`: es información que hay que ver, no una alarma — nadie ha
          hecho nada mal, y teñir de rojo una conciliación parcial legítima la haría parecer un
          error. Tokens semánticos de `DESIGN.md`, cero hex.
        */}
        {incompletas.length > 0 ? (
          <div
            role="status"
            className="flex flex-1 flex-col gap-1 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-strong"
          >
            <span className="font-medium">
              {DESGLOSE_SATELITE.diferenciaTitulo(incompletas.length)}
            </span>
            <span className="text-[13px] leading-relaxed">
              {incompletas.length === 1
                ? DESGLOSE_SATELITE.diferenciaDetalle(
                    money(incompletas[0].totales.efectivo),
                    money(incompletas[0].montoRecibido),
                    money(incompletas[0].faltaPorRecibir),
                  )
                : DESGLOSE_SATELITE.diferenciaDetalleVarias(money(resumen.saldoSinConciliar))}
            </span>
          </div>
        ) : null}
      </div>

      {/* El conmutador del desglose: la cola primero, la historia a un clic. */}
      <SegmentedToggle
        options={[
          { valor: "sin_conciliar", etiqueta: DESGLOSE_SATELITE_FILTRO.sinConciliar },
          { valor: "todas", etiqueta: DESGLOSE_SATELITE_FILTRO.todas },
        ]}
        valor={filtro}
        onChange={(v) => {
          setFiltro(v);
          setPage(1); // cambiar de conjunto vuelve a la primera página
        }}
        ariaLabel={DESGLOSE_SATELITE_NOMBRE.filtro(zonaNombre)}
      />

      <div className="overflow-x-auto">
        <DataTable
          columns={COLUMNS}
          data={items}
          rowKey="cierreBodegaId"
          ariaLabel={DESGLOSE_SATELITE_NOMBRE.tabla(zonaNombre)}
          isLoading={isLoading}
          /* El fallo se cuenta DENTRO de esta fila; la tabla de saldos sigue en pie. */
          error={error ? DESGLOSE_SATELITE_ERROR : null}
          emptyMessage={DESGLOSE_SATELITE_VACIO}
          /**
           * R29 — descarga del CONJUNTO FILTRADO de esta bodega, no de la página visible. El
           * título lleva el nombre de la bodega para que el control tenga un nombre accesible
           * ÚNICO: pueden estar varias filas abiertas, y tres botones llamados «Descargar» no
           * identificarían nada. El tope de filas lo evalúa el SERVIDOR y `limite_excedido` viaja
           * sin filas, así que nunca sale un archivo al que le faltan filas sin avisar.
           */
          descarga={{
            titulo: DESGLOSE_SATELITE_NOMBRE.region(zonaNombre),
            columnas: COLUMNAS_DESCARGA_CONSOLIDACIONES_SATELITE,
            obtenerFilas: () =>
              filasDesdeResultado(
                listarConsolidacionesSateliteCompletoAction(buildInputCompleto(zonaId, filtro)),
                filaDescargaConsolidacionSatelite,
              ),
          }}
        />
      </div>

      {/* Paginación SERVER-SIDE: el total es el del conjunto filtrado, no el de la página. */}
      <Pagination
        page={page}
        pageSize={DESGLOSE_PAGE_SIZE}
        total={total}
        onPageChange={setPage}
        disabled={isLoading}
        ariaLabel={DESGLOSE_SATELITE_NOMBRE.paginacion(zonaNombre)}
      />

      {/* D6 — la nota que impide que «Desmarcar» se lea como devolver plata. Al pie y visible. */}
      <p role="note" className="text-xs leading-relaxed text-muted-foreground">
        <strong className="font-semibold text-foreground">
          {DESMARCAR_NO_MUEVE_DINERO_TITULO}
        </strong>{" "}
        {DESMARCAR_NO_MUEVE_DINERO_NOTA}
      </p>
    </section>
  );
}

/** El tope de página del dominio, para que la tabla de arriba no invente el suyo. */
export const DESGLOSE_SATELITE_MAX_PAGE_SIZE = cierreBodegaConfig.MAX_PAGE_SIZE;
