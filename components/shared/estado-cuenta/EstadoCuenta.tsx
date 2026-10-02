"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import useSWR, { useSWRConfig } from "swr";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BuscadorFiltros } from "@/components/shared/BuscadorFiltros";
import { FilterComponent, type FilterDef, type FilterSelection } from "@/components/shared/FilterComponent";
import { SegmentedToggle } from "@/components/shared/SegmentedToggle";
import {
  DataTable,
  type Column,
  type DataTableDescarga,
  type DataTableDescargaDetalle,
  type DataTableProps,
  type DescargaFilasResult,
} from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { SUFIJO_REINTENTO, mensajeLimiteDetalle } from "@/components/shared/descarga-resultado";
import { filasDetallePorGuia, filasKardex } from "@/components/shared/wallet/libro-kardex-descarga";
import { DetalleMovimientoPanel, type DetalleMovimiento } from "@/components/shared/wallet/DetalleMovimientoPanel";
import { PANEL_TEXTO, textoRegistro } from "@/components/shared/wallet/detalle-movimiento-panel-labels";
import { ORIGEN_ENLACE_VISIBLE } from "@/components/shared/wallet/origen-movimiento";
import { ORDEN_LIBRO, ORDEN_LIBRO_POR_DEFECTO, ZONA_LIBRO_TEXTO } from "@/components/shared/wallet/zonas-filtros-labels";
import { BUSQUEDA_LIBRO_MIN_CHARS } from "@/lib/config/libro-wallet";
import type { DireccionOrden } from "@/lib/types/ordenamiento-listado";
import { money } from "@/lib/config/moneda";
import {
  estadoCuentaKardexAction,
  estadoCuentaKardexConDetalleAction,
  verEstadoCuentaAction,
  type CuentaKardexActionResult,
  type CuentaKardexConDetalleActionResult,
} from "@/lib/actions/estado-cuenta";
import { estadoCuentaConfig } from "@/lib/config/estado-cuenta";
import type {
  EstadoCuentaDTO,
  FilaEstadoCuentaDTO,
  TipoDeCuenta,
  VerEstadoCuentaResult,
} from "@/lib/types/estado-cuenta";
import type { GestionResultado } from "@prisma/client";
import type { BloqueDeGuiaDTO, DetallePorGuiaDTO, KardexDTO } from "@/lib/types/libro-kardex";
import type { DescargaFila } from "@/lib/types/descarga";
import type { ChipEstadoCuenta } from "@/lib/utils/estado-cuenta-chips";
import { cn } from "@/lib/utils";

import { TarjetasEstadoCuenta } from "./TarjetasEstadoCuenta";
import { claveEstadoCuenta, esClaveDeLaCuenta } from "./estado-cuenta-clave";
import {
  COLUMNAS_DESCARGA_ESTADO_CUENTA,
  COLUMNAS_DESCARGA_MI_ESTADO_CUENTA,
  FIJAS_DESCARGA_ESTADO_CUENTA,
  filaBaseCuenta,
} from "./estado-cuenta-descarga-columnas";
import {
  CASILLA_ESTADO_CUENTA,
  CASILLAS_ESTADO_CUENTA_TEXTO,
  CHIP_LABEL,
  CHIP_TODO,
  CHIPS_POR_TIPO,
  COLUMNAS_TEXTO,
  ESTADO_CUENTA_TEXTO,
  type ChipOTodo,
} from "./estado-cuenta-labels";
import {
  estadoDeFila,
  lineaDeFila,
  lineaSaldoInicial,
  origenDeFila,
  pagoDeFila,
  type RotulosEstadoCuenta,
} from "./estado-cuenta-lineas";

// FICHA 458-D (T D.1/T D.5/T D.6/T D.7, design §3.2/§5; R17–R25, R30, R32, R34, R71, R72) — el ESTADO
// DE CUENTA de una tienda, un mensajero o una bodega satélite, como pantalla (no la fila desplegable de
// antes, D14); y, en su vista «tienda», el de `/mi-wallet` (R34).
//
// La primera página la resolvió el Server Component (que ya comprobó el rol, R81) y baja por props;
// los cambios de periodo, chip, cierre y página se piden al LECTOR de la superficie con SWR, con una
// clave POR CUENTA (`estado-cuenta-clave.ts`). Tras registrar o anular desde aquí se releen SOLO las
// claves de ESTA cuenta (R30): `refrescarCuenta`, que también reciben las acciones de la página.
//
// Nada se deriva aquí (R90, A4): tarjetas, totales, saldo inicial y saldo corrido los calcula el
// servidor; el estado «anulado» viaja en la fila (R71); el origen con su entidad y su enlace, y el
// método y la referencia del pago, también (458-D servidor). Ningún identificador se pinta (H6).
//
// El extracto (`TablaEstadoCuenta`, abajo) vive en ESTE archivo y no en uno propio: su `<DataTable>`
// lo montan las pantallas (tienda, mensajero, bodega, `/mi-wallet`) a través de este módulo, y así el
// censo de tablas (`tests/unit/descarga/censo-tablas.ts`) ve una tabla compartida con sus montajes.

/** Lo que la página necesita saber de la fila para abrir el panel «Ver» (lo pone la superficie). */
export interface PanelDeLaSuperficie {
  /** «el cobro a la tienda», «el pago al mensajero»: el título de «Anular …». */
  nombreParaAnular: (fila: FilaEstadoCuentaDTO) => string;
  /** R79 — la fila admite adjuntar un comprobante lateral (el servidor decide igual). */
  admiteAdjuntar: (fila: FilaEstadoCuentaDTO) => boolean;
  /** R100/R73 — una explicación en palabras, si la fila la lleva. */
  nota?: (fila: FilaEstadoCuentaDTO) => string | null;
}

/**
 * Los filtros del extracto tal como viajan al borde (ausente = sin ese filtro).
 *
 * FICHA 463 (R24/R35) — `q` (el término, con el mínimo cumplido) y el orden. El orden solo viaja cuando
 * NO es el de por defecto: el borde aplica «Más recientes» sin que nadie lo pida (R34), así que no
 * mandarlo es pedir eso.
 */
export interface FiltrosDeLectura {
  desde?: string;
  hasta?: string;
  chip?: ChipEstadoCuenta;
  cierreId?: string;
  q?: string;
  sortBy?: "fecha";
  sortDir?: DireccionOrden;
}

/**
 * FICHA 458-D — DE DÓNDE se lee el estado de cuenta. La oficina lo lee por la cuenta de la página
 * (`verEstadoCuentaAction`); `/mi-wallet`, por la tienda de la SESIÓN (`verMiEstadoCuentaAction`, sin
 * ninguna clave de cuenta, R36). El módulo no sabe cuál: pinta lo que devuelve.
 *
 * FICHA 468 (T13) — la descarga deja de leer el «completo» de la 458-D y lee el KARDEX: la oficina con
 * `estadoCuentaKardexAction` / `estadoCuentaKardexConDetalleAction`, `/mi-wallet` con
 * `miEstadoCuentaKardexAction` / `miEstadoCuentaKardexConDetalleAction`.
 */
export interface LectorEstadoCuenta {
  leer: (f: FiltrosDeLectura & { page: number; pageSize: number }) => Promise<VerEstadoCuentaResult>;
  /** R5–R16, R32 — el periodo filtrado ENTERO como kardex (hoja «Movimientos»), con el tope en el servidor. */
  leerKardex: (f: FiltrosDeLectura) => Promise<CuentaKardexActionResult>;
  /**
   * R26, R53 — lo mismo que `leerKardex` MÁS la hoja «Detalle por guía», en UNA petición. Lo tienen la
   * tienda y el mensajero en la oficina, y `/mi-wallet` (R24); la bodega satélite no (R25).
   */
  leerKardexConDetalle?: (f: FiltrosDeLectura) => Promise<CuentaKardexConDetalleActionResult>;
}

/** El lector de la oficina: la cuenta de la página viaja como id (nunca se pinta). */
export function lectorDeLaCuenta(cuenta: Pick<EstadoCuentaDTO["cuenta"], "tipo" | "id">): LectorEstadoCuenta {
  const { tipo, id } = cuenta;
  return {
    leer: (f) => verEstadoCuentaAction({ cuenta: { tipo, id }, ...f }),
    leerKardex: (f) => estadoCuentaKardexAction({ cuenta: { tipo, id }, ...f }),
    // FICHA 468 (R24/R25) — el detalle por guía existe en la tienda y en el mensajero, no en la bodega.
    ...(tipo === "bodega"
      ? {}
      : {
          leerKardexConDetalle: (f: FiltrosDeLectura) =>
            estadoCuentaKardexConDetalleAction({ cuenta: { tipo, id }, ...f }),
        }),
  };
}

/**
 * FICHA 468 (design §7.1; R24, R30–R32) — la hoja «Detalle por guía» de una superficie: la configuración
 * del control (su catálogo, su ámbito y sus columnas fijas) y la etiqueta de pantalla de los resultados
 * de una gestión (la del detalle de la fila de esa superficie).
 */
export interface DetalleDeLaDescarga {
  hoja: DataTableDescargaDetalle;
  /** La fila de cabecera de un bloque de guía de ESTA superficie (`filaCabeceraGuia*` de su módulo). */
  cabeceraDe: (bloque: BloqueDeGuiaDTO) => DescargaFila;
  resultadosTexto: (resultados: readonly GestionResultado[]) => string;
}

/**
 * FICHA 464 (R1/R2) — lo que CADA superficie declara de su descarga: el ámbito de su selector de
 * columnas (cada una el suyo) y, si la tiene, su hoja de detalle. El ámbito se asigna en el módulo de
 * la superficie, nunca aquí: este módulo lo monta para las cuatro y no puede ser dueño de ninguno.
 */
export interface DescargaDeLaSuperficie extends Required<Pick<DataTableDescarga, "ambitoColumnas">> {
  detalle?: DetalleDeLaDescarga;
}

/** FICHA 458-D (R19) — el despliegue de las órdenes de las filas que nacen de un cierre. */
export interface DetalleDeFila {
  render: (fila: FilaEstadoCuentaDTO, textos: { concepto: string; fecha: string }) => ReactNode;
  /** El nombre accesible del botón que la despliega: identifica SU fila (concepto y día). */
  nombre: (textos: { concepto: string; fecha: string }) => string;
}

/** FICHA 458-D (R10) — el selector de cierre de la superficie; el valor es el cierre (viaja, no se pinta). */
export type SelectorDeCierre = (valor: string | null, onCambiar: (cierreId: string | null) => void) => ReactNode;

/** R78 — una acción de SOLO LECTURA por fila (el comprobante de `/mi-wallet`), en lugar de «Ver». */
export interface AccionDeFila {
  titulo: string;
  render: (fila: FilaEstadoCuentaDTO) => ReactNode;
}

export interface EstadoCuentaProps {
  /** La primera página, resuelta en el servidor (sin periodo ni chip). */
  inicial: EstadoCuentaDTO;
  rotulos: RotulosEstadoCuenta;
  /**
   * FICHA 464 (R1/R2/R6/R7) — el ámbito del selector de columnas de la descarga y, en la tienda y en
   * `/mi-wallet`, la hoja de detalle. REQUERIDA y sin default: que la declare cada superficie la
   * garantiza el compilador.
   */
  descargaDeLaSuperficie: DescargaDeLaSuperficie;
  /** Sin él, el de la oficina sobre `inicial.cuenta`. */
  lector?: LectorEstadoCuenta;
  /**
   * «oficina» (por defecto) o «tienda» (`/mi-wallet`, R34/R35): la frase del saldo en segunda persona,
   * sin la línea «Registró» (el servidor no manda a la tienda los nombres de la gente de Ordenex) y la
   * descarga sin esa columna.
   */
  vista?: "oficina" | "tienda";
  /** R10 — el filtro por cierre, si la superficie lo ofrece. */
  selectorCierre?: SelectorDeCierre;
  /** R19 — el despliegue de órdenes de las filas de cierre. */
  detalleDeFila?: DetalleDeFila;
  /** R78 — acción de solo lectura por fila. */
  accionDeFila?: AccionDeFila;
  /** Sin él la tabla no ofrece «Ver» (la bodega no tiene filas de libro; `/mi-wallet` solo lee). */
  panel?: PanelDeLaSuperficie;
  /**
   * R26–R29 / R31 — las acciones de la cuenta. Reciben el estado VIGENTE (el saldo, su signo) y la
   * función que relee esta cuenta, para que el botón se habilite con lo que dice el servidor ahora.
   */
  acciones?: (vigente: EstadoCuentaDTO, refrescarCuenta: () => Promise<void>) => ReactNode;
  /** Lo que va debajo del extracto (la conciliación de la bodega, R31). */
  pie?: (vigente: EstadoCuentaDTO, refrescarCuenta: () => Promise<void>) => ReactNode;
  /**
   * Lo que va ENCIMA de las tarjetas, hermano de ellas, con el estado VIGENTE (el resumen de tres cifras
   * de `/mi-wallet`, 172 R55): se relee con cada lectura, así que nunca queda distinto de la tarjeta.
   */
  encabezado?: (vigente: EstadoCuentaDTO) => ReactNode;
}

type Periodo = { desde: string; hasta: string };

/** FICHA 463 — la zona del LIBRO del estado de cuenta: término y orden (los chips y el cierre, aparte). */
export interface LibroDeLectura {
  termino: string;
  sortDir: DireccionOrden;
}

const LIBRO_INICIAL: LibroDeLectura = { termino: "", sortDir: ORDEN_LIBRO_POR_DEFECTO };

/**
 * FICHA 463 (R49, revisión B1/m2) — TODO lo que se eligió en pantalla y pide una lectura: las dos zonas,
 * la página y su tamaño.
 */
interface Seleccion {
  periodo: Periodo;
  chip: ChipOTodo;
  cierreId: string | null;
  termino: string;
  sortDir: DireccionOrden;
  page: number;
  pageSize: number;
}

/**
 * Una lectura BUENA junto con la selección que la pidió. Lo que se pinta se describe con SU selección
 * (la posición del saldo inicial, el día del periodo) y no con la pedida: con `keepPreviousData` lo
 * pintado puede ser la lectura anterior mientras llega la nueva, o para siempre si la nueva falla (m2).
 * Y si una lectura falla, es la selección a la que vuelven los controles (R49).
 */
interface Lectura {
  seleccion: Seleccion;
  estado: EstadoCuentaDTO;
}

/** De lo que se eligió en pantalla a lo que viaja al borde: lo vacío (y el orden por defecto) no viaja. */
export function filtrosDeLectura(
  periodo: Periodo,
  chip: ChipOTodo,
  cierreId: string | null,
  libro: LibroDeLectura = LIBRO_INICIAL,
): FiltrosDeLectura {
  const termino = libro.termino.trim();
  return {
    ...(periodo.desde === "" ? {} : { desde: periodo.desde }),
    ...(periodo.hasta === "" ? {} : { hasta: periodo.hasta }),
    ...(chip === CHIP_TODO ? {} : { chip: chip as ChipEstadoCuenta }),
    ...(cierreId === null ? {} : { cierreId }),
    ...(termino.length >= BUSQUEDA_LIBRO_MIN_CHARS ? { q: termino } : {}),
    ...(libro.sortDir === ORDEN_LIBRO_POR_DEFECTO ? {} : { sortBy: "fecha" as const, sortDir: libro.sortDir }),
  };
}

/** El orden que pide una lectura: el del filtro, o el de por defecto si no viaja (R34). */
export function ordenDe(filtros: FiltrosDeLectura): DireccionOrden {
  return filtros.sortDir ?? ORDEN_LIBRO_POR_DEFECTO;
}

/**
 * FICHA 463 (R38/R39) — DÓNDE va la línea del saldo inicial en la página que se pinta. La pone la
 * pantalla, no el servidor (que devuelve solo movimientos y no la cuenta en `total`):
 *
 * - «Más antiguas»: es la PRIMERA línea de la página 1, donde cae en el tiempo.
 * - «Más recientes»: es la ÚLTIMA línea de la ÚLTIMA página, y de ninguna otra. Sin movimientos
 *   (`total === 0`) la única página es la 1 y va ahí.
 */
export function posicionSaldoInicial(
  sortDir: DireccionOrden,
  page: number,
  pageSize: number,
  total: number,
): "primera" | "ultima" | null {
  if (sortDir === "asc") return page === 1 ? "primera" : null;
  const ultimaPagina = Math.max(1, Math.ceil(total / pageSize));
  return page === ultimaPagina ? "ultima" : null;
}

/**
 * FICHA 467 (design §4.5; R7, R21) — los controles del ORQUESTADOR de la barra única de un estado de
 * cuenta: el Periodo (rango de fechas, se aplica solo) y el Tipo de movimiento (`single` con los chips
 * de ese tipo de cuenta, sin «Todo»: sin elección, ya son todos). El Cierre lo monta la superficie.
 */
const CASILLA = CASILLA_ESTADO_CUENTA;

export function declaracionesEstadoCuenta(tipo: TipoDeCuenta): FilterDef[] {
  return [
    { key: CASILLA.periodo, label: CASILLAS_ESTADO_CUENTA_TEXTO.periodo, kind: "dateRange" },
    {
      key: CASILLA.tipoMovimiento,
      label: CASILLAS_ESTADO_CUENTA_TEXTO.tipoMovimiento,
      kind: "single",
      options: CHIPS_POR_TIPO[tipo].filter((c) => c !== CHIP_TODO).map((c) => ({ value: c, label: CHIP_LABEL[c] })),
      placeholder: CHIP_LABEL[CHIP_TODO],
    },
  ];
}

/** R7 — las casillas que ofrece «Filtros», en su orden: «Cierre» solo si la superficie lo ofrece. */
export function casillasEstadoCuenta(conCierre: boolean): { key: string; label: string }[] {
  return [
    { key: CASILLA.periodo, label: CASILLAS_ESTADO_CUENTA_TEXTO.periodo },
    { key: CASILLA.tipoMovimiento, label: CASILLAS_ESTADO_CUENTA_TEXTO.tipoMovimiento },
    ...(conCierre ? [{ key: CASILLA.cierre, label: CASILLAS_ESTADO_CUENTA_TEXTO.cierre }] : []),
  ];
}

/** Periodo y chip como selección del orquestador (lo que repone la `siembra`, R28). */
function seleccionDe(p: Periodo, chip: ChipOTodo): FilterSelection {
  return {
    ...(p.desde === "" && p.hasta === "" ? {} : { [CASILLA.periodo]: ["", p.desde, p.hasta] }),
    ...(chip === CHIP_TODO ? {} : { [CASILLA.tipoMovimiento]: [chip] }),
  };
}

/** R27 — las casillas cuyo filtro TIENE valor, en el orden de las casillas. */
function casillasConValor(p: Periodo, chip: ChipOTodo, cierreId: string | null): string[] {
  return [
    ...(p.desde !== "" || p.hasta !== "" ? [CASILLA.periodo] : []),
    ...(chip !== CHIP_TODO ? [CASILLA.tipoMovimiento] : []),
    ...(cierreId !== null ? [CASILLA.cierre] : []),
  ];
}

async function leer(lector: LectorEstadoCuenta, seleccion: Seleccion): Promise<Lectura> {
  const { periodo, chip, cierreId, termino, sortDir, page, pageSize } = seleccion;
  const filtros = filtrosDeLectura(periodo, chip, cierreId, { termino, sortDir });
  const r = await lector.leer({ ...filtros, page, pageSize });
  if (r.status !== "ok") throw new Error(r.status);
  return { seleccion, estado: r.estado };
}

/** El movimiento del libro (tienda o mensajero) de una fila: el enlace con la hoja 2. Nunca se pinta. */
function idDeLibro(fila: FilaEstadoCuentaDTO): string | null {
  return fila.ref !== null && "libro" in fila.ref ? fila.ref.movimientoId : null;
}

/**
 * FICHA 468 (T13; R5–R8, R16, R18, R24–R26, R53, R57) — la descarga del estado de cuenta como KARDEX: el
 * periodo filtrado ENTERO (periodo, chip, cierre y término) en UNA lectura, con el tope en el servidor.
 *
 * - Siempre en orden cronológico ascendente (R7), aunque la pantalla diga «Más recientes»: el saldo
 *   corrido solo se lee de la más antigua a la más reciente. El servidor lo fuerza también.
 * - «Solo los movimientos» (`detalle` ausente) lee `leerKardex`; con `detalle`, `leerKardexConDetalle`:
 *   la hoja «Movimientos» sale de la MISMA función en los dos modos (R57).
 * - Por encima del tope no hay archivo (nunca uno al que le falten filas) y se dice con el aviso de esa
 *   hoja; cualquier otro fallo, aviso y sin archivo.
 */
export async function filasDelPeriodo(
  lector: LectorEstadoCuenta,
  filtros: FiltrosDeLectura,
  rotulos: RotulosEstadoCuenta,
  detalle?: DetalleDeLaDescarga,
): Promise<DescargaFilasResult> {
  const entrada: FiltrosDeLectura = { ...filtros, sortBy: "fecha", sortDir: "asc" };
  const desde = filtros.desde ?? null;
  try {
    if (detalle === undefined) {
      const r = await lector.leerKardex(entrada);
      if (r.status !== "ok") return errorDeDescargaCuenta(r);
      return colocarCuenta(r.estado, r.kardex, rotulos, desde);
    }
    if (lector.leerKardexConDetalle === undefined) throw new Error("la superficie no tiene detalle por guía");
    const r = await lector.leerKardexConDetalle(entrada);
    if (r.status !== "ok") return errorDeDescargaCuenta(r);
    return colocarCuenta(r.estado, r.kardex, rotulos, desde, { porGuia: r.porGuia, detalle });
  } catch {
    return { status: "error", mensaje: `${ESTADO_CUENTA_TEXTO.errorDescarga} ${SUFIJO_REINTENTO}` };
  }
}

/** El tope (con el aviso de SU hoja, R56) o cualquier otro fallo, como resultado de la descarga. */
function errorDeDescargaCuenta(
  r: Exclude<CuentaKardexActionResult | CuentaKardexConDetalleActionResult, { status: "ok" }>,
): DescargaFilasResult {
  if (r.status === "limite_excedido") {
    return {
      status: "error",
      mensaje:
        r.hoja === "detalle" ? mensajeLimiteDetalle(r.total, r.limite) : ESTADO_CUENTA_TEXTO.limiteDescarga(r.total, r.limite),
    };
  }
  return { status: "error", mensaje: `${ESTADO_CUENTA_TEXTO.errorDescarga} ${SUFIJO_REINTENTO}` };
}

/** Coloca la hoja «Movimientos» y, con `conGuias`, la hoja «Detalle por guía». */
function colocarCuenta(
  estado: EstadoCuentaDTO,
  kardex: KardexDTO,
  rotulos: RotulosEstadoCuenta,
  desde: string | null,
  conGuias?: { porGuia: DetallePorGuiaDTO; detalle: DetalleDeLaDescarga },
): DescargaFilasResult {
  const hoja1 = filasKardex({
    movimientos: estado.filas,
    kardex,
    // La fila se lee como la pinta la tabla (`lineaDeFila`) y se proyecta a la hoja (`filaBaseCuenta`).
    filaBase: (fila, ordenes) => filaBaseCuenta(lineaDeFila(fila, rotulos), ordenes),
    variante: "cuenta",
    fechaInicial: desde,
  });
  if (conGuias === undefined) {
    return { status: "ok", filas: hoja1.filas, filasDestacadas: hoja1.filasDestacadas };
  }
  const { porGuia, detalle } = conGuias;
  const porId = new Map<string, { fila: FilaEstadoCuentaDTO; ordenes: number | null }>();
  estado.filas.forEach((fila, i) => {
    const id = idDeLibro(fila);
    if (id !== null) porId.set(id, { fila, ordenes: kardex.filas[i].ordenes });
  });
  const hoja2 = filasDetallePorGuia({
    porGuia,
    cabeceraDe: detalle.cabeceraDe,
    movimientoPorId: porId,
    conceptoDe: (m) => rotulos.concepto(m.fila),
    fechaDe: (m) => m.fila.fecha,
    // R40 — el MISMO Detalle que en la hoja 1 (con su «N guía(s)»).
    detalleDe: (m) => String(filaBaseCuenta(lineaDeFila(m.fila, rotulos), m.ordenes).detalle),
    resultadosTexto: detalle.resultadosTexto,
  });
  return {
    status: "ok",
    filas: hoja1.filas,
    filasDestacadas: hoja1.filasDestacadas,
    filasDetalle: hoja2.filas,
    filasDestacadasDetalle: hoja2.filasDestacadas,
  };
}

/** El movimiento que pinta el panel «Ver», con lo que dice SU fila (el estado lo decidió el servidor). */
function detalleDe(
  fila: FilaEstadoCuentaDTO,
  rotulos: RotulosEstadoCuenta,
  panel: PanelDeLaSuperficie,
): DetalleMovimiento | null {
  if (fila.ref === null || !("libro" in fila.ref)) return null;
  const a = fila.anulacion;
  return {
    destino: { libro: fila.ref.libro, movimientoId: fila.ref.movimientoId },
    concepto: rotulos.concepto(fila),
    fecha: fila.fecha,
    monto: fila.cargo ?? fila.abono ?? "0.00",
    // Desde el lado del titular de la cuenta: el abono entra a su favor, el cargo sale.
    direccion: fila.abono !== null ? "entra" : "sale",
    motivo: fila.descripcion,
    origen: origenDeFila(fila, rotulos) ?? undefined,
    // Método y referencia del pago (458-D servidor); en las filas que no son un pago no hay línea.
    como: fila.pago === null ? undefined : pagoDeFila(fila),
    estado: {
      anulado: a !== null,
      motivoNoRegistrado: a !== null && a.motivo === null,
      detalle: a,
    },
    anulable: fila.anulable,
    nombreParaAnular: panel.nombreParaAnular(fila),
    tieneComprobante: fila.tieneComprobante,
    admiteAdjuntar: panel.admiteAdjuntar(fila),
    nota: panel.nota?.(fila) ?? null,
  };
}

export function EstadoCuenta({
  inicial,
  rotulos,
  descargaDeLaSuperficie,
  lector: lectorDado,
  vista = "oficina",
  selectorCierre,
  detalleDeFila,
  accionDeFila,
  panel,
  acciones,
  pie,
  encabezado,
}: Readonly<EstadoCuentaProps>) {
  const { tipo, id, nombre } = inicial.cuenta;
  const lector = lectorDado ?? lectorDeLaCuenta(inicial.cuenta);
  // FICHA 464 — el ámbito viaja tal cual (se ASIGNA en la superficie); la hoja de detalle solo se ofrece
  // si la superficie la declara Y su lector sabe leerla (468: R24/R25).
  const { detalle: detalleDeLaSuperficie, ...ambitoDeLaSuperficie } = descargaDeLaSuperficie;
  const detalleDescarga =
    detalleDeLaSuperficie !== undefined && lector.leerKardexConDetalle !== undefined ? detalleDeLaSuperficie : null;
  const { mutate } = useSWRConfig();
  const [periodo, setPeriodo] = useState<Periodo>({ desde: "", hasta: "" });
  const [chip, setChip] = useState<ChipOTodo>(CHIP_TODO);
  // FICHA 463 — la zona del libro: el término (ya con el mínimo cumplido, o vacío) y el orden.
  const [termino, setTermino] = useState("");
  const [sortDir, setSortDir] = useState<DireccionOrden>(ORDEN_LIBRO_POR_DEFECTO);
  const [cierreId, setCierreId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(inicial.pageSize);
  const [abierta, setAbierta] = useState<FilaEstadoCuentaDTO | null>(null);
  // FICHA 467 (R8–R11, R27) — las casillas marcadas de la barra. Se entra sin ninguna (R11).
  const [activos, setActivos] = useState<string[]>([]);
  // R49/R28 — si una lectura falla, los controles con estado propio (el calendario del periodo y el campo
  // del buscador) vuelven a lo de la última lectura buena por su `siembra`, que no emite: la señal sube y
  // el orquestador repone el periodo y el tipo de movimiento de lo vigente.
  const [senalSiembra, setSenalSiembra] = useState(0);
  const [siembraTermino, setSiembraTermino] = useState<{ senal: number; termino: string } | undefined>(undefined);
  // R49 — la lectura buena sobre la que falló la última: mientras sea la que se pinta, se avisa.
  const [falloSobre, setFalloSobre] = useState<Lectura | null>(null);

  // La primera página del servidor llega en «Más recientes» (R34/R47): es la inicial con ese orden.
  const esLaInicial =
    periodo.desde === "" &&
    periodo.hasta === "" &&
    chip === CHIP_TODO &&
    cierreId === null &&
    termino === "" &&
    sortDir === ORDEN_LIBRO_POR_DEFECTO &&
    page === 1 &&
    pageSize === inicial.pageSize;
  const seleccion: Seleccion = { periodo, chip, cierreId, termino, sortDir, page, pageSize };
  const filtros = filtrosDeLectura(periodo, chip, cierreId, { termino, sortDir });
  // La primera página del servidor, con la selección que la pidió (la de entrada).
  const lecturaInicial = useMemo<Lectura>(
    () => ({
      seleccion: {
        periodo: { desde: "", hasta: "" },
        chip: CHIP_TODO,
        cierreId: null,
        termino: "",
        sortDir: ORDEN_LIBRO_POR_DEFECTO,
        page: 1,
        pageSize: inicial.pageSize,
      },
      estado: inicial,
    }),
    [inicial],
  );
  const { data, error, isLoading } = useSWR(
    // R41 — el término y el orden van en la clave: dos lecturas que difieran en ellos no comparten caché.
    claveEstadoCuenta(tipo, id, { ...periodo, chip, page, pageSize, cierre: cierreId ?? "", termino, sortDir }),
    () => leer(lector, seleccion),
    {
      // `revalidateIfStale: false`: la primera página YA la leyó el servidor; sin esto SWR la vuelve a
      // pedir al montar (medido: una lectura de más por visita). Una clave nueva (periodo, chip,
      // cierre, página) no tiene datos y se lee igual; tras registrar o anular, `refrescarCuenta` relee.
      fallbackData: esLaInicial ? lecturaInicial : undefined,
      keepPreviousData: true,
      revalidateIfStale: false,
      // R49 — un fallo no se reintenta solo: la pantalla vuelve a lo último bueno y lo dice; quien
      // quiera reintentar lo vuelve a pedir.
      shouldRetryOnError: false,
      // SWR solo lo llama si la clave que falló sigue siendo la vigente.
      onError: () => conservarLoUltimo(),
    },
  );

  const vigente = data?.estado ?? inicial;
  const hayFallo = falloSobre !== null && falloSobre === data;

  /**
   * FICHA 463 (R49) — la lectura falló: se sigue pintando la última buena (`keepPreviousData` ya la
   * tiene en `data`: tarjetas, libro y su página) y TODOS los filtros vuelven a los de esa lectura
   * —periodo, chip, cierre, término, orden y página—, para que la pantalla no diga que hay puesto algo
   * que las cifras no reflejan. El aviso va junto al libro, no en su lugar.
   */
  function conservarLoUltimo() {
    if (data === undefined) return; // nada que conservar: la tabla dice el fallo en su lugar
    setFalloSobre(data);
    const buena = data.seleccion;
    setPeriodo(buena.periodo);
    setChip(buena.chip);
    setCierreId(buena.cierreId);
    setTermino(buena.termino);
    setSortDir(buena.sortDir);
    setPage(buena.page);
    setPageSize(buena.pageSize);
    // FICHA 467 (R27/R28) — y las casillas: como mínimo, las de los filtros de la lectura buena.
    const conValor = casillasConValor(buena.periodo, buena.chip, buena.cierreId);
    setActivos((a) => [...a, ...conValor.filter((k) => !a.includes(k))]);
    setSenalSiembra((n) => n + 1);
    setSiembraTermino((s) => ({ senal: (s?.senal ?? 0) + 1, termino: buena.termino }));
  }

  /** R30 — TODAS las claves de ESTA cuenta; ninguna de otra. */
  async function refrescarCuenta() {
    await mutate(esClaveDeLaCuenta(tipo, id));
  }

  /**
   * FICHA 467 (R14/R15/R17) — lo que emite el orquestador de la barra: el periodo (tarjetas y extracto
   * se releen con él) y el tipo de movimiento (solo el extracto). Página 1. Una emisión igual a lo que ya
   * se pidió —la poda del orquestador tras desmarcar una casilla— no cambia nada.
   */
  function cambiarSeleccion(seleccion: FilterSelection) {
    const [, desde = "", hasta = ""] = seleccion[CASILLA.periodo] ?? [];
    const siguienteChip = (seleccion[CASILLA.tipoMovimiento]?.[0] ?? CHIP_TODO) as ChipOTodo;
    if (desde === periodo.desde && hasta === periodo.hasta && siguienteChip === chip) return;
    setPeriodo({ desde, hasta });
    setChip(siguienteChip);
    setPage(1);
  }

  /**
   * FICHA 467 (R8/R10) — marcar no lee nada; desmarcar una casilla CON valor quita ese filtro (una sola
   * lectura: los cambios del mismo gesto mueven la clave SWR una vez).
   */
  function cambiarActivos(claves: string[]) {
    const salen = new Set(activos.filter((k) => !claves.includes(k)));
    setActivos(claves);
    let cambia = false;
    if (salen.has(CASILLA.periodo) && (periodo.desde !== "" || periodo.hasta !== "")) {
      setPeriodo({ desde: "", hasta: "" });
      cambia = true;
    }
    if (salen.has(CASILLA.tipoMovimiento) && chip !== CHIP_TODO) {
      setChip(CHIP_TODO);
      cambia = true;
    }
    if (salen.has(CASILLA.cierre) && cierreId !== null) {
      setCierreId(null);
      cambia = true;
    }
    if (cambia) setPage(1);
  }

  /** R29 — el término cambia: página 1. El buscador ya no avisa si no cambió. */
  function cambiarTermino(t: string) {
    setTermino(t);
    setPage(1);
  }

  /** R35 — el orden cambia: la página 1 del conjunto COMPLETO en ese orden (la lee el servidor). */
  function cambiarOrden(d: DireccionOrden) {
    if (d === sortDir) return;
    setSortDir(d);
    setPage(1);
  }

  /**
   * FICHA 467 (R25) — «Limpiar todo»: fuera el término, el periodo, el tipo de movimiento, el cierre y
   * todas las casillas; el ORDEN se queda. (La 463 conservaba el periodo: ahora vive en la misma barra.)
   */
  function limpiarTodo() {
    setActivos([]);
    setTermino("");
    setPeriodo({ desde: "", hasta: "" });
    setChip(CHIP_TODO);
    setCierreId(null);
    setPage(1);
  }

  const marcadas = new Set(activos);
  const montadas = declaracionesEstadoCuenta(tipo).filter((d) => marcadas.has(d.key));

  const detalle = abierta !== null && panel !== undefined ? detalleDe(abierta, rotulos, panel) : null;
  const registroAbierta = abierta?.registro ?? null;
  // R38/R39 — la línea del saldo inicial, con el orden, la página y el tamaño de lo que se PINTA (la
  // selección de la lectura vigente), no con lo pedido (revisión m2).
  const posicion =
    data === undefined
      ? null
      : posicionSaldoInicial(data.seleccion.sortDir, data.seleccion.page, data.seleccion.pageSize, data.estado.total);

  return (
    <div className="flex flex-col gap-6">
      {/* FICHA 467 (R1) — la sección de periodo de la 463 ya no está aquí: el Periodo es una casilla de la
          barra única del libro y sigue moviendo las tarjetas (R14). */}
      {encabezado ? encabezado(vigente) : null}
      <TarjetasEstadoCuenta estado={vigente} vista={vista} />

      {acciones ? (
        <section aria-label={ESTADO_CUENTA_TEXTO.acciones(nombre)} className="flex flex-col gap-3">
          {acciones(vigente, refrescarCuenta)}
        </section>
      ) : null}

      {/* R49 — el fallo se dice JUNTO al libro; el libro de la última lectura buena sigue debajo. */}
      {hayFallo ? (
        <p role="alert" className="text-sm text-destructive">
          {ESTADO_CUENTA_TEXTO.error} {ESTADO_CUENTA_TEXTO.errorConservado}
        </p>
      ) : null}

      <TablaEstadoCuenta
        estado={data?.estado}
        rotulos={rotulos}
        desde={data?.seleccion.periodo.desde ?? periodo.desde}
        posicionSaldoInicial={posicion}
        // FICHA 467 (R1/R2/R4/R7/R9/R23/R24/R32) — la BARRA ÚNICA, encima de la tabla y en la fila de
        // «Descargar», igual que `/ordenes`: [orden] [casillas marcadas…] [buscador] [Filtros] [Limpiar
        // todo]. Periodo y Tipo de movimiento son el orquestador; el Cierre, el selector de la superficie.
        filtros={
          <BuscadorFiltros
            label={ZONA_LIBRO_TEXTO.buscar}
            placeholder={ESTADO_CUENTA_TEXTO.buscarPlaceholder[vista]}
            minChars={BUSQUEDA_LIBRO_MIN_CHARS}
            leerDeUrl={false}
            siembra={siembraTermino}
            onChange={cambiarTermino}
            filtros={casillasEstadoCuenta(selectorCierre !== undefined)}
            activos={activos}
            onActivosChange={cambiarActivos}
            onLimpiarTodo={limpiarTodo}
            // R26 — con texto escrito (lo mira la barra) o con alguna casilla marcada.
            hayFiltrosAplicados={activos.length > 0}
          >
            <SegmentedToggle<DireccionOrden>
              options={ORDEN_LIBRO.opciones}
              valor={sortDir}
              onChange={cambiarOrden}
              ariaLabel={ORDEN_LIBRO.nombre}
              soloIcono
            />
            {montadas.length > 0 ? (
              <FilterComponent
                filters={montadas}
                onChange={cambiarSeleccion}
                leerDeUrl={false}
                // R28 — lo vigente (lo que dice la clave SWR); al subir la señal, se repone sin emitir.
                siembra={{ senal: senalSiembra, seleccion: seleccionDe(periodo, chip) }}
              />
            ) : null}
            {selectorCierre && marcadas.has(CASILLA.cierre)
              ? selectorCierre(cierreId, (c) => {
                  setCierreId(c);
                  setPage(1);
                })
              : null}
          </BuscadorFiltros>
        }
        isLoading={data === undefined && isLoading}
        // Solo sin ninguna lectura buena que enseñar; con una, el aviso va arriba y el libro se queda (R49).
        error={error !== undefined && data === undefined}
        onVer={panel === undefined ? undefined : (f) => (seAbre(f) ? setAbierta(f) : undefined)}
        conRegistro={vista === "oficina"}
        detalleDeFila={detalleDeFila}
        accionDeFila={accionDeFila}
        descarga={{
          ...ambitoDeLaSuperficie,
          titulo: ESTADO_CUENTA_TEXTO.tabla(nombre),
          columnas: vista === "oficina" ? COLUMNAS_DESCARGA_ESTADO_CUENTA : COLUMNAS_DESCARGA_MI_ESTADO_CUENTA,
          // FICHA 468 (R51) — Concepto, Entra, Sale y Saldo no se pueden desmarcar.
          columnasFijas: FIJAS_DESCARGA_ESTADO_CUENTA,
          // FICHA 468 (R7/R53/R57): una petición por opción, siempre en orden cronológico ascendente.
          obtenerFilas: (opciones) =>
            filasDelPeriodo(
              lector,
              filtros,
              rotulos,
              opciones?.conDetalle && detalleDescarga !== null ? detalleDescarga : undefined,
            ),
          detalle: detalleDescarga?.hoja,
        }}
      />
      {data !== undefined && data.estado.filas.length === 0 ? (
        <p className="text-sm text-muted-foreground">{ESTADO_CUENTA_TEXTO.vacio}</p>
      ) : null}

      <Pagination
        page={page}
        pageSize={pageSize}
        total={data?.estado.total ?? 0}
        // Solo sin nada que pintar: con la página del servidor en mano se puede paginar mientras SWR
        // revalida (su `isLoading` sigue en `true` con `fallbackData`).
        disabled={data === undefined}
        ariaLabel={ESTADO_CUENTA_TEXTO.paginacion(nombre)}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
        pageSizeOptions={[10, 20, 50, 100].filter((s) => s <= estadoCuentaConfig.MAX_PAGE_SIZE)}
      />

      {pie ? pie(vigente, refrescarCuenta) : null}

      {detalle !== null && registroAbierta !== null ? (
        <DetalleMovimientoPanel
          abierto={abierta !== null}
          onAbiertoChange={(v) => {
            if (!v) setAbierta(null);
          }}
          movimiento={detalle}
          autoria={{
            aQuien: { nombre, beneficiario: null, cuenta: tipo === "bodega" ? null : { tipo, id }, esOrdenex: false },
            registro: registroAbierta,
          }}
          onCambio={() => void refrescarCuenta()}
        />
      ) : null}
    </div>
  );
}

// FICHA 458-D (T D.1, design §3.2/§5.1; R6–R8, R19–R25, R71, R72) — el EXTRACTO del estado de cuenta.
//
//  - El SALDO INICIAL del periodo (R20): FICHA 463 (R38/R39), primera línea de la página 1 con «Más
//    antiguas» y última de la última página con «Más recientes» (`posicionSaldoInicial`).
//  - El orden es el que devolvió el servidor (R23; 463 R35): aquí no se reordena nada.
//  - Cada fila: fecha (día CR), movimiento y motivo (concepto, origen con su entidad y su enlace, método
//    y referencia del pago, descripción, comprobante y quién lo registró), cargo, abono, SALDO CORRIDO
//    de la cuenta entera (R21, lo calcula la base) y «Ver».
//  - Las filas que nacen de un cierre despliegan las órdenes que componen su importe (R19, 344/345).
//  - Anulado (R25/R71): el estado VIAJA en la fila, decidido por el servidor; la fila se tacha y dice
//    quién, cuándo y por qué («motivo no registrado» si no hay constancia, R72). El contra-asiento se
//    rotula «Anulación». Ningún componente compara filas entre sí para decidirlo (guardia R98).
// Money-safe (R90): los importes llegan STRING y se pintan con `money`. Ningún id se pinta (H6): `ref`
// viaja al panel «Ver» y al despliegue, y el del origen va SOLO en el `href` de su enlace (R7).

/** Una línea de la tabla: el saldo inicial o un movimiento. */
export type LineaTabla = { tipo: "inicial"; clave: string } | { tipo: "movimiento"; clave: string; fila: FilaEstadoCuentaDTO };

export interface TablaEstadoCuentaProps {
  estado: EstadoCuentaDTO | undefined;
  rotulos: RotulosEstadoCuenta;
  /** El día CR con el que empieza el periodo, o "" sin periodo. */
  desde: string;
  /**
   * FICHA 463 (R38/R39) — si esta página lleva la línea del saldo inicial y dónde: la primera (orden
   * «Más antiguas», página 1), la última («Más recientes», última página) o ninguna.
   */
  posicionSaldoInicial: "primera" | "ultima" | null;
  isLoading: boolean;
  error: boolean;
  onVer?: (fila: FilaEstadoCuentaDTO) => void;
  /** R34/R35 — `false` en `/mi-wallet`: la tienda no ve quién de Ordenex registró la fila. */
  conRegistro?: boolean;
  /** R19 — el despliegue de órdenes de las filas que nacen de un cierre. */
  detalleDeFila?: DetalleDeFila;
  /** R78 — acción de solo lectura por fila (en lugar de «Ver»). */
  accionDeFila?: AccionDeFila;
  descarga?: DataTableProps<LineaTabla>["descarga"];
  /** FICHA 463 — la zona del libro, en la cabecera de la tabla (nodo opaco: la tabla no lo mira). */
  filtros?: ReactNode;
}

/** La fila se puede abrir en el panel «Ver» si trae su destino de libro (la bodega no lo lleva). */
export function seAbre(fila: FilaEstadoCuentaDTO): boolean {
  return fila.ref !== null && "libro" in fila.ref;
}

/**
 * R19 — la fila despliega sus órdenes si nace de un cierre (lo decide el servidor) y trae su destino de
 * libro. Un contra-asiento no: las órdenes son las de su original.
 */
export function despliegaOrdenes(fila: FilaEstadoCuentaDTO): boolean {
  return fila.naceDeUnCierre && !fila.esContraAsiento && seAbre(fila);
}

function Importe({ valor, tachado, clase }: { valor: string | null; tachado: boolean; clase?: string }) {
  if (valor === null) return null;
  return <span className={cn("tabular-nums", tachado && "line-through", clase)}>{money(valor)}</span>;
}

/** R6–R8 — el origen con su entidad y, si el rol que mira accede a esa pantalla, el enlace. */
function OrigenDeFila({ fila, rotulos }: { fila: FilaEstadoCuentaDTO; rotulos: RotulosEstadoCuenta }) {
  const texto = origenDeFila(fila, rotulos);
  if (texto === null) return null;
  const enlace = fila.origen?.enlace ?? null;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
      <span>{texto}</span>
      {enlace === null ? null : (
        // El id va SOLO en `href`; el nombre accesible es la etiqueta del servidor, que EMPIEZA por el
        // texto visible (R7, «Label in Name»).
        <Link
          href={enlace.href}
          aria-label={enlace.etiqueta}
          className="rounded-sm text-primary-strong underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
        >
          {ORIGEN_ENLACE_VISIBLE}
        </Link>
      )}
    </span>
  );
}

export function TablaEstadoCuenta({
  estado,
  rotulos,
  desde,
  posicionSaldoInicial: posicionInicial,
  isLoading,
  error,
  onVer,
  conRegistro = true,
  detalleDeFila,
  accionDeFila,
  descarga,
  filtros,
}: Readonly<TablaEstadoCuentaProps>) {
  const tipo = estado?.cuenta.tipo ?? "tienda";
  const t = COLUMNAS_TEXTO[tipo];
  const nombre = estado?.cuenta.nombre ?? "";

  const lineaInicial: LineaTabla[] = [{ tipo: "inicial", clave: "saldo-inicial" }];
  const lineas: LineaTabla[] =
    estado === undefined
      ? []
      : [
          ...(posicionInicial === "primera" ? lineaInicial : []),
          ...estado.filas.map((fila, i) => ({
            tipo: "movimiento" as const,
            // La clave de React: el destino si lo hay (nunca se pinta), si no la posición en la página.
            clave: fila.ref !== null && "movimientoId" in fila.ref ? fila.ref.movimientoId : `fila-${estado.page}-${i}`,
            fila,
          })),
          ...(posicionInicial === "ultima" ? lineaInicial : []),
        ];

  const columnas: Column<LineaTabla>[] = [
    {
      id: "fecha",
      value: t.fecha,
      render: (l) => (l.tipo === "inicial" ? (desde === "" ? "—" : desde) : l.fila.fecha),
    },
    {
      id: "movimiento",
      value: t.movimiento,
      render: (l) => {
        if (l.tipo === "inicial") {
          const inicial = estado === undefined ? null : lineaSaldoInicial(estado, desde);
          return <span className="font-medium">{inicial?.movimiento}</span>;
        }
        const f = l.fila;
        const anulado = f.anulacion !== null;
        const leyenda = estadoDeFila(f, rotulos);
        const pago = pagoDeFila(f);
        return (
          <div className="flex min-w-[16rem] flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-2">
              <span className={cn("font-medium text-foreground", anulado && "line-through text-muted-foreground")}>
                {rotulos.concepto(f)}
              </span>
              {f.esContraAsiento ? <Badge variant="outline">{ESTADO_CUENTA_TEXTO.anulacion}</Badge> : null}
              {f.tieneComprobante ? <Badge variant="secondary">{ESTADO_CUENTA_TEXTO.conComprobante}</Badge> : null}
            </span>
            {f.descripcion ? <span className="text-sm text-muted-foreground">{f.descripcion}</span> : null}
            <OrigenDeFila fila={f} rotulos={rotulos} />
            {pago !== null ? (
              <span className="text-xs text-muted-foreground">{ESTADO_CUENTA_TEXTO.como(pago)}</span>
            ) : null}
            {conRegistro ? (
              <span className="text-xs text-muted-foreground">
                {ESTADO_CUENTA_TEXTO.registro(textoRegistro(f.registro))}
              </span>
            ) : null}
            {anulado && leyenda !== null ? <span className="text-xs font-medium text-foreground">{leyenda}</span> : null}
          </div>
        );
      },
    },
    {
      id: "cargo",
      value: t.cargo,
      align: "right",
      render: (l) =>
        l.tipo === "inicial" ? null : (
          <Importe valor={l.fila.cargo} tachado={l.fila.anulacion !== null} clase="text-danger-strong" />
        ),
    },
    {
      id: "abono",
      value: t.abono,
      align: "right",
      render: (l) =>
        l.tipo === "inicial" ? null : (
          <Importe valor={l.fila.abono} tachado={l.fila.anulacion !== null} clase="text-success-strong" />
        ),
    },
    {
      id: "saldo",
      value: t.saldo,
      align: "right",
      render: (l) => (
        <span className="font-medium tabular-nums">
          {money(l.tipo === "inicial" ? (estado?.saldoInicial ?? null) : l.fila.saldoCorrido)}
        </span>
      ),
    },
    {
      id: "ver",
      value: accionDeFila?.titulo ?? t.ver,
      render: (l) => {
        if (l.tipo !== "movimiento") return null;
        if (accionDeFila !== undefined) return accionDeFila.render(l.fila);
        return onVer !== undefined && seAbre(l.fila) ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={PANEL_TEXTO.verNombre(rotulos.concepto(l.fila), l.fila.fecha, money(l.fila.cargo ?? l.fila.abono))}
            onClick={() => onVer(l.fila)}
          >
            {PANEL_TEXTO.ver}
          </Button>
        ) : null;
      },
    },
  ];

  return (
    <div className="overflow-x-auto">
      <DataTable
        columns={columnas}
        data={lineas}
        rowKey={(l) => l.clave}
        ariaLabel={ESTADO_CUENTA_TEXTO.tabla(nombre)}
        emptyMessage={ESTADO_CUENTA_TEXTO.vacio}
        isLoading={isLoading}
        error={error ? ESTADO_CUENTA_TEXTO.error : null}
        rowClassName={(l) =>
          l.tipo === "inicial"
            ? "bg-muted/40"
            : l.fila.anulacion !== null
              ? "text-muted-foreground"
              : undefined
        }
        // R19 — el despliegue SOLO en las filas que nacen de un cierre; `null` = la primitiva no pinta
        // el botón. El contenido se monta al abrir: la tabla cerrada no lee ninguna orden.
        renderExpanded={
          detalleDeFila === undefined
            ? undefined
            : (l) =>
                l.tipo === "movimiento" && despliegaOrdenes(l.fila)
                  ? detalleDeFila.render(l.fila, { concepto: rotulos.concepto(l.fila), fecha: l.fila.fecha })
                  : null
        }
        expandAriaLabel={(l) =>
          l.tipo === "movimiento" && detalleDeFila !== undefined
            ? detalleDeFila.nombre({ concepto: rotulos.concepto(l.fila), fecha: l.fila.fecha })
            : ""
        }
        descarga={descarga}
        filtros={filtros}
      />
    </div>
  );
}
