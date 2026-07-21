"use client";

import { useState } from "react";
import useSWR from "swr";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { listarPagosDeMensajeroAction } from "@/lib/actions/wallet-mensajero";
import type {
  CuentaPorPagarDTO,
  CuentaPorPagarResumenDTO,
  ListarPagosDeMensajeroResult,
  PagoMensajeroMovimientoDTO,
} from "@/lib/types/wallet-mensajero";

import {
  CATEGORIA_PAGO_LABEL,
  CUENTA_COLOR,
  DESGLOSE_COLUMNAS,
  DESGLOSE_FILTRO_LABEL,
  DESGLOSE_LABEL,
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
];

export function DesglosePagosMensajero({ resumen, id }: DesglosePagosMensajeroProps) {
  const { mensajeroId, mensajeroNombre } = resumen;

  const [page, setPage] = useState(1);
  const [filtros, setFiltros] = useState<FiltrosDesglose>(FILTROS_VACIOS);
  const [draft, setDraft] = useState<FiltrosDesglose>(FILTROS_VACIOS);

  const { data, error, isLoading } = useSWR(
    [
      "wallet-mensajeros:desglose",
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
  const desdeFiltroId = `desglose-${mensajeroId}-desde`;
  const hastaFiltroId = `desglose-${mensajeroId}-hasta`;

  return (
    <section
      id={id}
      aria-label={`Desglose de ${mensajeroNombre}`}
      className="flex flex-col gap-4 rounded-lg bg-muted/40 p-4"
    >
      {/* Saldo del conjunto filtrado (R22): se recalcula desde result.data.cuenta. */}
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

      {/* Filtros server-side por fecha/cierre (R22). */}
      <form
        aria-label={`Filtros del desglose de ${mensajeroNombre}`}
        className="flex flex-wrap items-end gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          aplicarFiltros();
        }}
      >
        <div className="flex min-w-56 flex-col gap-1.5">
          <Label htmlFor={cierreFiltroId}>{DESGLOSE_FILTRO_LABEL.cierre}</Label>
          <Input
            id={cierreFiltroId}
            type="text"
            value={draft.cierreId}
            onChange={(e) => set("cierreId", e.target.value)}
            placeholder={DESGLOSE_FILTRO_LABEL.cierrePlaceholder}
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
        />
      </div>

      <Pagination
        page={page}
        pageSize={DESGLOSE_PAGE_SIZE}
        total={total}
        onPageChange={setPage}
        disabled={isLoading}
        ariaLabel={`Paginación del desglose de ${mensajeroNombre}`}
      />
    </section>
  );
}
