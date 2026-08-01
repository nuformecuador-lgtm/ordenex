"use client";

import { useState, type ReactNode } from "react";
import useSWR from "swr";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { filasDesdeResultado } from "@/components/shared/descarga-resultado";
import {
  listarMovimientosDeTiendaAction,
  listarMovimientosDeTiendaCompletoAction,
} from "@/lib/actions/wallet-tienda";
import type {
  DesgloseTiendaDTO,
  ListarMovimientosDeTiendaResult,
  SaldoTiendaResumenDTO,
  WalletTiendaMovimientoDTO,
} from "@/lib/types/wallet-tienda";

import {
  COLUMNAS_DESCARGA_DESGLOSE_TIENDA,
  filaDescargaDesgloseTienda,
} from "./desglose-tienda-descarga-columnas";
import {
  CATEGORIA_TIENDA_LABEL,
  CATEGORIA_TIENDA_OPTIONS,
  DESGLOSE_TIENDA_COLUMNAS,
  DESGLOSE_TIENDA_ERROR,
  DESGLOSE_TIENDA_FILTRO_LABEL,
  DESGLOSE_TIENDA_LABEL,
  DESGLOSE_TIENDA_NOMBRE,
  DESGLOSE_TIENDA_VACIO,
  SALDO_SIGNO_LABEL,
  TIPO_TIENDA_LABEL,
  money,
  origenLabel,
} from "./desglose-tienda-labels";

// Feature 171 (T2.3, R1–R21) — DESGLOSE del dinero de UNA tienda para los roles de acceso
// total. Se MONTA al expandir su fila en `SaldosTiendasTable` (el `renderExpanded` del
// `DataTable` solo monta lo abierto), y es ahí —dentro de este componente— donde vive el
// `useSWR`: por eso listar N tiendas cuesta CERO lecturas de desglose (R32) y abrir una fila
// cuesta exactamente una, solo de esa tienda (R33). Cada instancia lleva su propia página,
// sus propios filtros y su propia caché, así que dos filas abiertas no se pisan (R3).
//
// Money-safe (R14/R23): los cuatro importes de la cabecera y el monto de cada movimiento
// llegan como STRING ya formateado y con el signo calculado en el SERVIDOR, y se pintan TAL
// CUAL con `money`. Nada de `Number()`, `parseFloat` ni `toFixed` aquí: es dinero.
//
// Por qué la cabecera NO es la del mensajero: a una tienda se le DEBE lo cobrado a sus
// clientes y se le COBRAN los servicios, así que son cuatro importes propios (R7).

/** Tamaño de página del desglose (coincide con el default del schema zod del borde). */
const DESGLOSE_PAGE_SIZE = 20;

/** Prefijo de la clave SWR. Identifica a esta lectura entre todas las de la app. */
const CLAVE_DESGLOSE = "wallet-tiendas:desglose";

/** Borrador / conjunto aplicado de filtros del desglose (R18). */
export interface FiltrosDesgloseTienda {
  cierreId: string;
  categoria: string;
  desde: string;
  hasta: string;
}

export const FILTROS_DESGLOSE_TIENDA_VACIOS: FiltrosDesgloseTienda = {
  cierreId: "",
  categoria: "",
  desde: "",
  hasta: "",
};

/**
 * R46 — Clave SWR de UN desglose. Exportada a propósito: es la que este componente usa, y
 * es la que permite refrescar el desglose de UNA tienda desde fuera (`mutate(clave)`) sin
 * recargar la página ni tocar los desgloses de las demás. La 172, tras registrar un pago,
 * llama a `mutate(claveDesgloseTienda(tiendaId))` y esta cabecera vuelve a leerse sola.
 *
 * Los valores por defecto son el estado con el que nace un desglose recién abierto (primera
 * página, sin filtros), que es el caso que le interesa a quien refresca desde fuera.
 */
export function claveDesgloseTienda(
  tiendaId: string,
  page: number = 1,
  filtros: FiltrosDesgloseTienda = FILTROS_DESGLOSE_TIENDA_VACIOS,
): readonly [string, string, number, string, string, string, string] {
  return [
    CLAVE_DESGLOSE,
    tiendaId,
    page,
    filtros.cierreId,
    filtros.categoria,
    filtros.desde,
    filtros.hasta,
  ] as const;
}

/**
 * Input del listado PAGINADO. Los filtros vacíos NO se mandan: el schema los declara
 * opcionales y una cadena vacía sería un filtro que no filtra nada… o un error de borde.
 */
function buildInput(
  tiendaId: string,
  page: number,
  filtros: FiltrosDesgloseTienda,
): Record<string, unknown> {
  const input: Record<string, unknown> = {
    tiendaId,
    page,
    pageSize: DESGLOSE_PAGE_SIZE,
  };
  if (filtros.cierreId) input.cierreId = filtros.cierreId;
  if (filtros.categoria) input.categoria = filtros.categoria;
  if (filtros.desde) input.desde = filtros.desde;
  if (filtros.hasta) input.hasta = filtros.hasta;
  return input;
}

/**
 * R37 — Input del modo COMPLETO (la descarga): el `tiendaId` y los MISMOS filtros vigentes,
 * SIN `page`/`pageSize`. Su schema es `.strict()`, así que colar la paginación devolvería
 * `validation_error` en vez de un archivo; por eso este constructor es SEPARADO y no la
 * pone. Se descarga el conjunto filtrado entero, no la página visible.
 */
function buildInputCompleto(
  tiendaId: string,
  filtros: FiltrosDesgloseTienda,
): Record<string, unknown> {
  const input: Record<string, unknown> = { tiendaId };
  if (filtros.cierreId) input.cierreId = filtros.cierreId;
  if (filtros.categoria) input.categoria = filtros.categoria;
  if (filtros.desde) input.desde = filtros.desde;
  if (filtros.hasta) input.hasta = filtros.hasta;
  return input;
}

/** Fetcher SWR: pide el desglose y traduce un status != ok a un throw (SWR lo marca error). */
async function desgloseFetcher(
  tiendaId: string,
  page: number,
  filtros: FiltrosDesgloseTienda,
): Promise<ListarMovimientosDeTiendaResult> {
  const res = await listarMovimientosDeTiendaAction(buildInput(tiendaId, page, filtros));
  if (res.status !== "ok") throw new Error(res.status);
  return res.data;
}

/** Badge de color por tipo: crédito (a favor de la tienda) vs débito (cargo de Ordenex). */
function TipoBadge({ tipo }: { tipo: WalletTiendaMovimientoDTO["tipo"] }) {
  return (
    <Badge variant={tipo === "credito" ? "default" : "destructive"}>
      {TIPO_TIENDA_LABEL[tipo]}
    </Badge>
  );
}

/** Origen legible: tipo de origen + descripción si la hay (la misma composición del archivo). */
function origenTexto(m: WalletTiendaMovimientoDTO): string {
  const base = origenLabel(m.origenTipo);
  return m.descripcion ? `${base} · ${m.descripcion}` : base;
}

/** R13: el estado del saldo se lee del MISMO mapa que la tabla de saldos; aquí solo el color. */
const SIGNO_BADGE: Record<
  SaldoTiendaResumenDTO["signo"],
  { variant: "default" | "secondary" | "destructive" | "outline"; label: string }
> = {
  positivo: { variant: "default", label: SALDO_SIGNO_LABEL.positivo },
  negativo: { variant: "destructive", label: SALDO_SIGNO_LABEL.negativo },
  cero: { variant: "secondary", label: SALDO_SIGNO_LABEL.cero },
};

/** Color del saldo según su signo (verde a favor / rojo en contra / neutro en cero). */
const SALDO_COLOR: Record<SaldoTiendaResumenDTO["signo"], string> = {
  positivo: "text-success-strong",
  negativo: "text-danger-strong",
  cero: "text-muted-foreground",
};

// R15: las cinco columnas del ledger, en orden — las MISMAS que `/mi-wallet` (mismo libro,
// mismo DTO). Money-safe: el monto se pinta TAL CUAL.
const COLUMNS: Column<WalletTiendaMovimientoDTO>[] = [
  {
    id: "fecha",
    value: DESGLOSE_TIENDA_COLUMNAS.fecha,
    render: (m) => m.fechaMovimiento.slice(0, 10),
  },
  {
    id: "tipo",
    value: DESGLOSE_TIENDA_COLUMNAS.tipo,
    render: (m) => <TipoBadge tipo={m.tipo} />,
  },
  {
    id: "concepto",
    value: DESGLOSE_TIENDA_COLUMNAS.concepto,
    render: (m) => CATEGORIA_TIENDA_LABEL[m.categoria],
  },
  {
    id: "monto",
    value: DESGLOSE_TIENDA_COLUMNAS.monto,
    render: (m) => money(m.monto),
  },
  {
    id: "origen",
    value: DESGLOSE_TIENDA_COLUMNAS.origen,
    render: (m) => origenTexto(m),
  },
];

/** Un importe de la cabecera: rótulo, cifra ya formateada por el servidor y aclaración. */
function Importe({
  rotulo,
  valor,
  pista,
  className,
  extra,
}: {
  rotulo: string;
  /** STRING del servidor. `null` = aún no cargado (se muestra «—», nunca un cero falso). */
  valor: string | null;
  pista: string;
  className?: string;
  extra?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{rotulo}</span>
        {extra}
      </div>
      <span className={`text-lg font-medium ${className ?? ""}`}>{money(valor)}</span>
      <span className="text-xs text-muted-foreground">{pista}</span>
    </div>
  );
}

export interface DesgloseMovimientosTiendaProps {
  /**
   * La fila de la tabla de saldos desde la que se despliega: `tiendaId`, `tiendaNombre` y su
   * saldo agregado. El nombre baja por props y NO se le pide al servidor (R35): ya está aquí,
   * y consultarlo costaría una lectura más por cada fila que se abre.
   */
  resumen: SaldoTiendaResumenDTO;
  /** id del elemento (para enlazar con el `aria-controls` del botón que lo expande). */
  id?: string;
  /**
   * R45 — Punto de extensión para la 172: contenido de acciones sobre la tienda, renderizado
   * en la cabecera junto al saldo. Sin él NO se renderiza contenedor alguno — ni un hueco en
   * blanco ni un elemento vacío que anunciar a un lector de pantalla.
   *
   * Esta feature NO registra ni ofrece registrar ningún pago (R47): aquí solo queda el sitio.
   */
  acciones?: ReactNode;
}

export function DesgloseMovimientosTienda({
  resumen,
  id,
  acciones,
}: DesgloseMovimientosTiendaProps) {
  const { tiendaId, tiendaNombre } = resumen;

  const [page, setPage] = useState(1);
  const [filtros, setFiltros] = useState<FiltrosDesgloseTienda>(
    FILTROS_DESGLOSE_TIENDA_VACIOS,
  );
  const [draft, setDraft] = useState<FiltrosDesgloseTienda>(
    FILTROS_DESGLOSE_TIENDA_VACIOS,
  );

  const { data, error, isLoading } = useSWR(
    claveDesgloseTienda(tiendaId, page, filtros),
    () => desgloseFetcher(tiendaId, page, filtros),
  );

  // R12: los cuatro importes son los del CONJUNTO FILTRADO, tal como los devolvió el
  // servidor. Antes de la primera carga solo se conoce el saldo que ya venía en la fila
  // (R11: sin filtros, es el mismo), y los otros tres se muestran como «—»: pendiente de
  // cargar, que NO es lo mismo que cero.
  const desglose: DesgloseTiendaDTO | undefined = data?.desglose;
  const signo = desglose?.signo ?? resumen.signo;
  const badge = SIGNO_BADGE[signo];
  const movimientos = data?.movimientos ?? [];
  const total = data?.total ?? 0;

  function set<K extends keyof FiltrosDesgloseTienda>(key: K, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function aplicarFiltros() {
    setFiltros(draft); // nuevos filtros → nueva clave SWR → re-obtiene SOLO esta tienda (R36)
    setPage(1); // R19: aplicar filtros vuelve a la primera página
  }

  function limpiarFiltros() {
    setDraft(FILTROS_DESGLOSE_TIENDA_VACIOS);
    setFiltros(FILTROS_DESGLOSE_TIENDA_VACIOS);
    setPage(1); // R19: limpiarlos, también
  }

  // Los ids llevan el `tiendaId` porque puede haber varias filas abiertas a la vez y un
  // `htmlFor` repetido apuntaría al campo de otra tienda.
  const cierreFiltroId = `desglose-tienda-${tiendaId}-cierre`;
  const conceptoFiltroId = `desglose-tienda-${tiendaId}-concepto`;
  const desdeFiltroId = `desglose-tienda-${tiendaId}-desde`;
  const hastaFiltroId = `desglose-tienda-${tiendaId}-hasta`;

  return (
    <section
      id={id}
      aria-label={DESGLOSE_TIENDA_NOMBRE.region(tiendaNombre)}
      className="flex flex-col gap-4 rounded-lg bg-muted/40 p-4"
    >
      {/* R7 — los cuatro importes, en el orden de la fórmula: a favor − cargos − pagado. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Importe
          rotulo={DESGLOSE_TIENDA_LABEL.aFavor}
          valor={desglose?.aFavor ?? null}
          pista={DESGLOSE_TIENDA_LABEL.aFavorHint}
          className="text-success-strong"
        />
        <Importe
          rotulo={DESGLOSE_TIENDA_LABEL.cargos}
          valor={desglose?.cargos ?? null}
          pista={DESGLOSE_TIENDA_LABEL.cargosHint}
        />
        {/*
          R43 — «Pagado a la tienda» hoy sale siempre en 0,00 porque ningún flujo emite
          todavía un pago a tienda (lo cierra la 172). Se muestra IGUAL, y como la cifra que
          es: el servidor la lee de la categoría real del libro, no devuelve un cero fijo, así
          que el día que existan pagos aparecen aquí solos, sin tocar una línea.
        */}
        <Importe
          rotulo={DESGLOSE_TIENDA_LABEL.pagado}
          valor={desglose?.pagado ?? null}
          pista={DESGLOSE_TIENDA_LABEL.pagadoHint}
        />
        <Importe
          rotulo={DESGLOSE_TIENDA_LABEL.saldo}
          valor={desglose?.saldo ?? resumen.saldo}
          pista={DESGLOSE_TIENDA_LABEL.saldoHint}
          className={SALDO_COLOR[signo]}
          extra={<Badge variant={badge.variant}>{badge.label}</Badge>}
        />
      </div>

      {/* R45: sin `acciones` no se renderiza ningún contenedor añadido. */}
      {acciones ? <div className="flex flex-wrap items-center gap-2">{acciones}</div> : null}

      {/* R18 — filtros resueltos en el SERVIDOR: cierre, concepto y rango de fechas. */}
      <form
        aria-label={DESGLOSE_TIENDA_NOMBRE.filtros(tiendaNombre)}
        className="flex flex-wrap items-end gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          aplicarFiltros();
        }}
      >
        <div className="flex min-w-56 flex-col gap-1.5">
          <Label htmlFor={cierreFiltroId}>{DESGLOSE_TIENDA_FILTRO_LABEL.cierre}</Label>
          <Input
            id={cierreFiltroId}
            type="text"
            value={draft.cierreId}
            onChange={(e) => set("cierreId", e.target.value)}
            disabled={isLoading}
            placeholder={DESGLOSE_TIENDA_FILTRO_LABEL.cierrePlaceholder}
            className="w-56"
          />
        </div>

        {/*
          R44 — las opciones se pueblan del SEED del enum, no de una lista escrita a mano:
          por eso `pago_tienda` ya está entre ellas hoy, y por eso una categoría nueva del
          libro aparecerá aquí sin que nadie se acuerde de añadirla.
        */}
        <div className="flex min-w-56 flex-col gap-1.5">
          <Label htmlFor={conceptoFiltroId}>{DESGLOSE_TIENDA_FILTRO_LABEL.concepto}</Label>
          <Select
            id={conceptoFiltroId}
            aria-label={DESGLOSE_TIENDA_NOMBRE.concepto(tiendaNombre)}
            value={draft.categoria}
            onValueChange={(v) => set("categoria", v)}
            options={CATEGORIA_TIENDA_OPTIONS}
            placeholder={DESGLOSE_TIENDA_FILTRO_LABEL.conceptoPlaceholder}
            disabled={isLoading}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={desdeFiltroId}>{DESGLOSE_TIENDA_FILTRO_LABEL.desde}</Label>
          <Input
            id={desdeFiltroId}
            type="date"
            value={draft.desde}
            onChange={(e) => set("desde", e.target.value)}
            disabled={isLoading}
            className="w-40"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={hastaFiltroId}>{DESGLOSE_TIENDA_FILTRO_LABEL.hasta}</Label>
          <Input
            id={hastaFiltroId}
            type="date"
            value={draft.hasta}
            onChange={(e) => set("hasta", e.target.value)}
            disabled={isLoading}
            className="w-40"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={isLoading}>
            {DESGLOSE_TIENDA_FILTRO_LABEL.aplicar}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isLoading}
            onClick={limpiarFiltros}
          >
            {DESGLOSE_TIENDA_FILTRO_LABEL.limpiar}
          </Button>
        </div>
      </form>

      {/* R16: del más reciente al más antiguo — el servidor ya los devuelve ordenados. */}
      <div className="overflow-x-auto">
        <DataTable
          columns={COLUMNS}
          data={movimientos}
          rowKey="id"
          ariaLabel={DESGLOSE_TIENDA_NOMBRE.tabla(tiendaNombre)}
          isLoading={isLoading}
          /* R5: el fallo se cuenta DENTRO de esta fila; la tabla de saldos sigue en pie. */
          error={error ? DESGLOSE_TIENDA_ERROR : null}
          emptyMessage={DESGLOSE_TIENDA_VACIO}
          /**
           * R37/R38 — descarga del DATASET COMPLETO de esta tienda con los filtros vigentes,
           * no de la página visible. La config se declara aquí (y no en el módulo padre)
           * porque es este componente el que conoce su `tiendaId` y sus filtros.
           *
           * El título lleva el nombre de la tienda para que el control tenga un nombre
           * accesible ÚNICO: pueden estar varias filas abiertas, y tres botones llamados
           * «Descargar Desglose» no identificarían nada. El tope de filas, el mensaje
           * accionable y el «ninguna rama de error viaja con filas» los resuelve
           * `filasDesdeResultado` (R39/R40).
           */
          descarga={{
            titulo: DESGLOSE_TIENDA_NOMBRE.region(tiendaNombre),
            columnas: COLUMNAS_DESCARGA_DESGLOSE_TIENDA,
            obtenerFilas: () =>
              filasDesdeResultado(
                listarMovimientosDeTiendaCompletoAction(
                  buildInputCompleto(tiendaId, filtros),
                ),
                filaDescargaDesgloseTienda,
              ),
          }}
        />
      </div>

      {/* R17: paginación SERVER-SIDE — el total es el del conjunto filtrado, no el de la página. */}
      <Pagination
        page={page}
        pageSize={DESGLOSE_PAGE_SIZE}
        total={total}
        onPageChange={setPage}
        disabled={isLoading}
        ariaLabel={DESGLOSE_TIENDA_NOMBRE.paginacion(tiendaNombre)}
      />
    </section>
  );
}
