"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { filasDesdeResultado } from "@/components/shared/descarga-resultado";
import {
  listarPagosDeMensajeroAction,
  listarPagosDeMensajeroCompletoAction,
} from "@/lib/actions/wallet-mensajero";
import type {
  CuentaPorPagarDTO,
  CuentaPorPagarResumenDTO,
  ListarPagosDeMensajeroResult,
  PagoMensajeroMovimientoDTO,
} from "@/lib/types/wallet-mensajero";

import {
  COLUMNAS_DESCARGA_DESGLOSE_MENSAJERO,
  filaDescargaDesgloseMensajero,
} from "./desglose-mensajero-descarga-columnas";
import { PagoMensajeroAcciones } from "./PagoMensajeroAcciones";
import { EnlaceCierre } from "./RepartoPrevisualizacion";
import {
  CATEGORIA_PAGO_LABEL,
  CUENTA_COLOR,
  DESGLOSE_COLUMNAS,
  DESGLOSE_COLUMNA_CIERRE,
  DESGLOSE_FILTRO_LABEL,
  DESGLOSE_LABEL,
  DESGLOSE_SIN_CIERRE,
  DESGLOSE_VACIO,
  SIGNO_BADGE,
  TIPO_PAGO_LABEL,
  money,
  origenLabel,
} from "./wallet-mensajeros-labels";

// Feature 44 (T14, R18/R21/R22) — DESGLOSE por cierre de UN mensajero para el MAESTRO. Se monta
// al EXPANDIR la fila del mensajero y carga client-side (via SWR sobre `listarPagosDeMensajeroAction`,
// una lectura interna del mismo proyecto → Server Action, NO fetch a /api) los movimientos por
// cierre (paginados, mas reciente primero: el backend ya los devuelve ordenados desc). Expone
// filtros server-side por rango de fecha y por cierre (R22); al aplicarlos, SWR re-obtiene y el
// SALDO mostrado (devengado/pagado/cuenta por pagar) sale de `result.data.cuenta`, es decir
// refleja el CONJUNTO FILTRADO, no el agregado global. Money-safe (R21/R27): todos los montos
// llegan como STRING y se renderizan TAL CUAL con `money`, sin parseFloat/Number ni aritmetica en
// cliente. Antes de la primera carga, el saldo usa el resumen agregado que ya llego por props.

/** Tamaño de pagina del desglose por cierre (coincide con el default del schema zod). */
const DESGLOSE_PAGE_SIZE = 20;

/** Prefijo de la clave SWR de este desglose. Identifica la lectura entre todas las de la app. */
const CLAVE_DESGLOSE = "wallet-mensajeros:desglose";

/**
 * Feature 205 (T5.3, design §8) — filtro de `mutate` que alcanza el desglose de UN mensajero
 * en CUALQUIER página y con cualquier filtro, y ninguno de los demás.
 *
 * Es un filtro y no una clave literal porque la clave lleva la página y los tres filtros
 * vigentes: tras registrar un pago hay que releer lo que ese mensajero tenga a la vista, sea
 * cual sea. Un `mutate()` sin argumentos refrescaría también los desgloses de los otros
 * mensajeros abiertos, y cada uno cuesta una consulta (R33 de la 172).
 */
function esClaveDesgloseDe(mensajeroId: string): (clave: unknown) => boolean {
  return (clave) =>
    Array.isArray(clave) && clave[0] === CLAVE_DESGLOSE && clave[1] === mensajeroId;
}

/** Borrador / conjunto aplicado de filtros del desglose (cierre + rango de fechas). */
interface FiltrosDesglose {
  cierreId: string;
  desde: string;
  hasta: string;
}

const FILTROS_VACIOS: FiltrosDesglose = { cierreId: "", desde: "", hasta: "" };

export interface DesglosePagosMensajeroProps {
  /** Resumen agregado del mensajero (nombre + saldo inicial antes de la primera carga). */
  resumen: CuentaPorPagarResumenDTO;
  /** id del elemento (para enlazar con `aria-controls` del boton que lo expande). */
  id?: string;
}

/** Construye el input de la action omitiendo los filtros vacios (cierre/fecha). */
function buildInput(
  mensajeroId: string,
  page: number,
  filtros: FiltrosDesglose,
): Record<string, unknown> {
  const input: Record<string, unknown> = {
    mensajeroId,
    page,
    pageSize: DESGLOSE_PAGE_SIZE,
  };
  if (filtros.cierreId) input.cierreId = filtros.cierreId;
  if (filtros.desde) input.desde = filtros.desde;
  if (filtros.hasta) input.hasta = filtros.hasta;
  return input;
}

/**
 * Feature 170 (T C.4, R10/R18) — input del modo COMPLETO: el `mensajeroId` (REQUERIDO por
 * el schema, igual que en el listado) + los MISMOS filtros vigentes, SIN `page`/`pageSize`.
 * El schema es `.strict()`: colar la paginación devolvería `validation_error` en vez de un
 * archivo, así que este constructor es SEPARADO de `buildInput` y no la pone.
 */
function buildInputCompleto(
  mensajeroId: string,
  filtros: FiltrosDesglose,
): Record<string, unknown> {
  const input: Record<string, unknown> = { mensajeroId };
  if (filtros.cierreId) input.cierreId = filtros.cierreId;
  if (filtros.desde) input.desde = filtros.desde;
  if (filtros.hasta) input.hasta = filtros.hasta;
  return input;
}

/** Fetcher SWR: pide el desglose y traduce un status != ok a un throw (SWR lo marca `error`). */
async function desgloseFetcher(
  mensajeroId: string,
  page: number,
  filtros: FiltrosDesglose,
): Promise<ListarPagosDeMensajeroResult> {
  const res = await listarPagosDeMensajeroAction(buildInput(mensajeroId, page, filtros));
  if (res.status !== "ok") throw new Error(res.status);
  return res.data;
}

/** Badge de color por tipo: devengo (lo devengado) vs pago (lo ya entregado). */
function TipoBadge({ tipo }: { tipo: PagoMensajeroMovimientoDTO["tipo"] }) {
  return (
    <Badge variant={tipo === "pago" ? "default" : "secondary"}>
      {TIPO_PAGO_LABEL[tipo]}
    </Badge>
  );
}

/** Origen legible: tipo de origen + descripcion si la hay. */
function origenTexto(m: PagoMensajeroMovimientoDTO): string {
  const base = origenLabel(m.origenTipo);
  return m.descripcion ? `${base} · ${m.descripcion}` : base;
}

const COLUMNS: Column<PagoMensajeroMovimientoDTO>[] = [
  {
    id: "fecha",
    value: DESGLOSE_COLUMNAS.fecha,
    render: (m) => m.fechaMovimiento.slice(0, 10),
  },
  {
    id: "tipo",
    value: DESGLOSE_COLUMNAS.tipo,
    render: (m) => <TipoBadge tipo={m.tipo} />,
  },
  {
    id: "concepto",
    value: DESGLOSE_COLUMNAS.concepto,
    render: (m) => CATEGORIA_PAGO_LABEL[m.categoria],
  },
  {
    id: "monto",
    value: DESGLOSE_COLUMNAS.monto,
    // Money-safe (R21/R27): STRING tal cual, sin parseFloat/Number.
    render: (m) => money(m.monto),
  },
  {
    id: "origen",
    value: DESGLOSE_COLUMNAS.origen,
    render: (m) => origenTexto(m),
  },
  {
    // Feature 205 (T6.2, R43) — el enlace al detalle del cierre de esta fila. La fila que NO
    // identifica ningún cierre (un ajuste manual) NO lleva enlace: ni roto ni deshabilitado,
    // sino la misma raya con la que esta pantalla dice «acá no hay dato». El `cierreId` lo
    // DERIVA el servidor (design §7.3); acá no se adivina de qué cierre viene un movimiento.
    id: "cierre",
    value: DESGLOSE_COLUMNA_CIERRE,
    render: (m) =>
      m.cierreId === null ? (
        <span className="text-muted-foreground">{DESGLOSE_SIN_CIERRE}</span>
      ) : (
        <EnlaceCierre cierreId={m.cierreId} />
      ),
  },
];

export function DesglosePagosMensajero({ resumen, id }: DesglosePagosMensajeroProps) {
  const { mensajeroId, mensajeroNombre } = resumen;

  const [page, setPage] = useState(1);
  const [filtros, setFiltros] = useState<FiltrosDesglose>(FILTROS_VACIOS);
  const [draft, setDraft] = useState<FiltrosDesglose>(FILTROS_VACIOS);

  const { mutate } = useSWRConfig();
  const { data, error, isLoading } = useSWR(
    [
      CLAVE_DESGLOSE,
      mensajeroId,
      page,
      filtros.cierreId,
      filtros.desde,
      filtros.hasta,
    ],
    () => desgloseFetcher(mensajeroId, page, filtros),
  );

  // Saldo del CONJUNTO FILTRADO (R22): sale de result.data.cuenta. Antes de la primera carga usa
  // el agregado que ya llego por props (resumen). NUNCA se recalcula en cliente (money-safe).
  const cuenta: CuentaPorPagarDTO = data?.cuenta ?? {
    devengado: resumen.devengado,
    pagado: resumen.pagado,
    cuentaPorPagar: resumen.cuentaPorPagar,
    signo: resumen.signo,
  };
  const badge = SIGNO_BADGE[cuenta.signo];
  const movimientos = data?.movimientos ?? [];
  const total = data?.total ?? 0;

  function set<K extends keyof FiltrosDesglose>(key: K, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function aplicarFiltros() {
    setFiltros(draft); // nuevos filtros → SWR re-obtiene
    setPage(1); // vuelve a la primera pagina
  }

  function limpiarFiltros() {
    setDraft(FILTROS_VACIOS);
    setFiltros(FILTROS_VACIOS);
    setPage(1);
  }

  const cierreFiltroId = `desglose-${mensajeroId}-cierre`;
  const cierreAyudaId = `${cierreFiltroId}-ayuda`;
  const desdeFiltroId = `desglose-${mensajeroId}-desde`;
  const hastaFiltroId = `desglose-${mensajeroId}-hasta`;

  return (
    <section
      id={id}
      aria-label={`Desglose de ${mensajeroNombre}`}
      className="flex flex-col gap-4 rounded-lg bg-muted/40 p-4"
    >
      {/*
        Saldo del conjunto filtrado (R22): se recalcula desde result.data.cuenta.

        Deuda 203 — la limitación N1 (feature 172, T H.4) ya no se pinta acá como un párrafo
        aparte: era el MISMO párrafo que la cabecera de la tabla, visible al mismo tiempo que
        él, y una copia más por cada fila desplegada. La salvedad vive ahora en la pista de
        cada importe (`DESGLOSE_LABEL.*Hint`), que es lo que sigue en pantalla cuando el
        párrafo de la tabla queda arriba del todo.
      */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-muted-foreground">{DESGLOSE_LABEL.devengado}</span>
          <span className="text-lg font-medium">{money(cuenta.devengado)}</span>
          <span className="text-xs text-muted-foreground">{DESGLOSE_LABEL.devengadoHint}</span>
        </div>

        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-muted-foreground">{DESGLOSE_LABEL.pagado}</span>
          <span className="text-lg font-medium text-success-strong">
            {money(cuenta.pagado)}
          </span>
          <span className="text-xs text-muted-foreground">{DESGLOSE_LABEL.pagadoHint}</span>
        </div>

        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {DESGLOSE_LABEL.cuentaPorPagar}
            </span>
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>
          <span className={`text-lg font-medium ${CUENTA_COLOR[cuenta.signo]}`}>
            {money(cuenta.cuentaPorPagar)}
          </span>
          <span className="text-xs text-muted-foreground">
            {DESGLOSE_LABEL.cuentaPorPagarHint}
          </span>
        </div>
      </div>

      {/*
        Feature 205 (T5.3, R3) — PAGAR desde acá, sin ir a otra pantalla. Va en la cabecera del
        desglose, junto a los importes que explica y encima de los movimientos que el pago va a
        mover, y es el espejo de lo que hace la tienda en su propio desglose.

        El refresco es DIRIGIDO y lo hace el dueño de la clave: el bloque de pago refresca sus
        previsualizaciones y avisa acá, y acá se relee el desglose de ESTE mensajero —en la
        página y con los filtros que tenga puestos— y ninguno más.
      */}
      <PagoMensajeroAcciones
        resumen={resumen}
        onRegistrado={async () => {
          await mutate(esClaveDesgloseDe(mensajeroId));
        }}
      />

      {/* Filtros server-side por fecha/cierre (R22). */}
      <form
        aria-label={`Filtros del desglose de ${mensajeroNombre}`}
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          aplicarFiltros();
        }}
      >
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex min-w-56 flex-col gap-1.5">
            <Label htmlFor={cierreFiltroId}>{DESGLOSE_FILTRO_LABEL.cierre}</Label>
            <Input
              id={cierreFiltroId}
              type="text"
              value={draft.cierreId}
              onChange={(e) => set("cierreId", e.target.value)}
              placeholder={DESGLOSE_FILTRO_LABEL.cierrePlaceholder}
              aria-describedby={cierreAyudaId}
              className="w-56"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={desdeFiltroId}>{DESGLOSE_FILTRO_LABEL.desde}</Label>
            <Input
              id={desdeFiltroId}
              type="date"
              value={draft.desde}
              onChange={(e) => set("desde", e.target.value)}
              className="w-40"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={hastaFiltroId}>{DESGLOSE_FILTRO_LABEL.hasta}</Label>
            <Input
              id={hastaFiltroId}
              type="date"
              value={draft.hasta}
              onChange={(e) => set("hasta", e.target.value)}
              className="w-40"
            />
          </div>

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={isLoading}>
              {DESGLOSE_FILTRO_LABEL.aplicar}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isLoading}
              onClick={limpiarFiltros}
            >
              {DESGLOSE_FILTRO_LABEL.limpiar}
            </Button>
          </div>
        </div>

        {/*
          Deuda 203 — de dónde sale el identificador que pide el campo «Cierre». Va DEBAJO de la
          fila y no dentro de su columna para no descolgar ese campo de los otros dos (la fila
          alinea por abajo); el vínculo con el campo lo hace `aria-describedby`, así que un
          lector de pantalla lo anuncia al enfocarlo aunque en la pantalla esté una línea más
          abajo.
        */}
        <p id={cierreAyudaId} className="text-xs text-muted-foreground">
          {DESGLOSE_FILTRO_LABEL.cierreAyuda}
        </p>
      </form>

      {/* Desglose por cierre (mas reciente primero: el backend lo devuelve ordenado). */}
      <div className="overflow-x-auto">
        <DataTable
          columns={COLUMNS}
          data={movimientos}
          rowKey="id"
          ariaLabel={`Desglose por cierre de ${mensajeroNombre}`}
          isLoading={isLoading}
          error={error ? "No se pudo cargar el desglose del mensajero." : null}
          emptyMessage={DESGLOSE_VACIO}
          /**
           * Feature 170 (T C.4, R1/R9/R10/R13) — descarga del desglose COMPLETO de ESTE
           * mensajero. Aquí la config se declara en el propio componente (y no baja del
           * módulo) porque, a diferencia de los otros tres ledgers, éste YA conoce sus
           * filtros y su `mensajeroId`: es quien los usa para el listado paginado. No se
           * estrena ninguna lectura: es la MISMA superficie, en modo completo.
           *
           * El título lleva el nombre del mensajero para que el control tenga un nombre
           * accesible ÚNICO (R13): la tabla admite varias filas expandidas a la vez, y
           * tres botones llamados «Descargar Desglose por cierre» no identificarían nada.
           */
          descarga={{
            titulo: `Desglose de ${mensajeroNombre}`,
            columnas: COLUMNAS_DESCARGA_DESGLOSE_MENSAJERO,
            obtenerFilas: () =>
              filasDesdeResultado(
                listarPagosDeMensajeroCompletoAction(
                  buildInputCompleto(mensajeroId, filtros),
                ),
                filaDescargaDesgloseMensajero,
              ),
          }}
        />
      </div>

      <Pagination
        page={page}
        pageSize={DESGLOSE_PAGE_SIZE}
        total={total}
        onPageChange={setPage}
        disabled={isLoading}
        ariaLabel={`Paginación del desglose de ${mensajeroNombre}`}
        // Sub-lista desplegada DENTRO de una fila de la tabla de cuentas por pagar: su
        // barra tiene que quedarse dentro del desglose, no flotar sobre toda la pantalla
        // como si paginara el listado principal.
        sticky={false}
      />
    </section>
  );
}
