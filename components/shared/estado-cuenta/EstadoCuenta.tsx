"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import useSWR, { useSWRConfig } from "swr";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BuscadorFiltros } from "@/components/shared/BuscadorFiltros";
import { FilterComponent, type FilterDef, type FilterSelection } from "@/components/shared/FilterComponent";
import { SegmentedToggle } from "@/components/shared/SegmentedToggle";
import { DataTable, type Column, type DataTableProps, type DescargaFilasResult } from "@/components/shared/DataTable";
import { Pagination } from "@/components/shared/Pagination";
import { SUFIJO_REINTENTO } from "@/components/shared/descarga-resultado";
import { DetalleMovimientoPanel, type DetalleMovimiento } from "@/components/shared/wallet/DetalleMovimientoPanel";
import { PANEL_TEXTO, textoRegistro } from "@/components/shared/wallet/detalle-movimiento-panel-labels";
import { ORIGEN_ENLACE_VISIBLE } from "@/components/shared/wallet/origen-movimiento";
import {
  ORDEN_LIBRO,
  ORDEN_LIBRO_POR_DEFECTO,
  ZONA_LIBRO_TEXTO,
  ZONA_WALLET_TEXTO,
} from "@/components/shared/wallet/zonas-filtros-labels";
import { BUSQUEDA_LIBRO_MIN_CHARS } from "@/lib/config/libro-wallet";
import type { DireccionOrden } from "@/lib/types/ordenamiento-listado";
import { money } from "@/lib/config/moneda";
import { verEstadoCuentaAction, verEstadoCuentaCompletoAction } from "@/lib/actions/estado-cuenta";
import { estadoCuentaConfig } from "@/lib/config/estado-cuenta";
import type {
  EstadoCuentaDTO,
  FilaEstadoCuentaDTO,
  VerEstadoCuentaCompletoResult,
  VerEstadoCuentaResult,
} from "@/lib/types/estado-cuenta";
import type { ChipEstadoCuenta } from "@/lib/utils/estado-cuenta-chips";
import { cn } from "@/lib/utils";

import { ChipsEstadoCuenta } from "./ChipsEstadoCuenta";
import { TarjetasEstadoCuenta } from "./TarjetasEstadoCuenta";
import { claveEstadoCuenta, esClaveDeLaCuenta } from "./estado-cuenta-clave";
import {
  COLUMNAS_DESCARGA_ESTADO_CUENTA,
  COLUMNAS_DESCARGA_MI_ESTADO_CUENTA,
  filaDescargaEstadoCuenta,
} from "./estado-cuenta-descarga-columnas";
import { CHIP_TODO, COLUMNAS_TEXTO, ESTADO_CUENTA_TEXTO, type ChipOTodo } from "./estado-cuenta-labels";
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
 * (`verEstadoCuentaAction` / `verEstadoCuentaCompletoAction`); `/mi-wallet`, por la tienda de la SESIÓN
 * (`verMiEstadoCuentaAction` / `verMiEstadoCuentaCompletoAction`, sin ninguna clave de cuenta, R36). El
 * módulo no sabe cuál: pinta lo que devuelve.
 */
export interface LectorEstadoCuenta {
  leer: (f: FiltrosDeLectura & { page: number; pageSize: number }) => Promise<VerEstadoCuentaResult>;
  /** TD.6/R32 — el periodo filtrado ENTERO, con el tope en el servidor. */
  leerCompleto: (f: FiltrosDeLectura) => Promise<VerEstadoCuentaCompletoResult>;
}

/** El lector de la oficina: la cuenta de la página viaja como id (nunca se pinta). */
export function lectorDeLaCuenta(cuenta: Pick<EstadoCuentaDTO["cuenta"], "tipo" | "id">): LectorEstadoCuenta {
  const { tipo, id } = cuenta;
  return {
    leer: (f) => verEstadoCuentaAction({ cuenta: { tipo, id }, ...f }),
    leerCompleto: (f) => verEstadoCuentaCompletoAction({ cuenta: { tipo, id }, ...f }),
  };
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

/** FICHA 463 (R4) — el único filtro de la zona de la wallet de un estado de cuenta: el periodo. */
const CLAVE_PERIODO = "periodo";
const FILTROS_PERIODO: FilterDef[] = [{ key: CLAVE_PERIODO, label: ZONA_WALLET_TEXTO.periodo, kind: "dateRange" }];

async function leer(
  lector: LectorEstadoCuenta,
  filtros: FiltrosDeLectura,
  page: number,
  pageSize: number,
): Promise<EstadoCuentaDTO> {
  const r = await lector.leer({ ...filtros, page, pageSize });
  if (r.status !== "ok") throw new Error(r.status);
  return r.estado;
}

/**
 * R32 / TD.6 — el periodo filtrado ENTERO (periodo, chip, cierre y —463— término), en UNA lectura: la
 * acción «completa» del servidor, que aplica el tope. Por encima del tope no hay archivo
 * (`limite_excedido`: nunca uno al que le falten filas) y se dice con un aviso claro.
 *
 * FICHA 463 (R43) — en el orden vigente, y la línea del saldo inicial donde cae en el tiempo: la
 * PRIMERA fila con «Más antiguas» y la ÚLTIMA con «Más recientes».
 */
export async function filasDelPeriodo(
  lector: LectorEstadoCuenta,
  filtros: FiltrosDeLectura,
  rotulos: RotulosEstadoCuenta,
): Promise<DescargaFilasResult> {
  try {
    const r = await lector.leerCompleto(filtros);
    if (r.status === "limite_excedido") {
      return { status: "error", mensaje: ESTADO_CUENTA_TEXTO.limiteDescarga(r.total, r.limite) };
    }
    if (r.status !== "ok") throw new Error(r.status);
    const inicial = filaDescargaEstadoCuenta(lineaSaldoInicial(r.estado, filtros.desde ?? ""));
    const movimientos = r.estado.filas.map((f) => filaDescargaEstadoCuenta(lineaDeFila(f, rotulos)));
    return {
      status: "ok",
      filas: ordenDe(filtros) === "asc" ? [inicial, ...movimientos] : [...movimientos, inicial],
    };
  } catch {
    return { status: "error", mensaje: `${ESTADO_CUENTA_TEXTO.errorDescarga} ${SUFIJO_REINTENTO}` };
  }
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
  const filtros = filtrosDeLectura(periodo, chip, cierreId, { termino, sortDir });
  const { data, error, isLoading } = useSWR(
    // R41 — el término y el orden van en la clave: dos lecturas que difieran en ellos no comparten caché.
    claveEstadoCuenta(tipo, id, { ...periodo, chip, page, pageSize, cierre: cierreId ?? "", termino, sortDir }),
    () => leer(lector, filtros, page, pageSize),
    // `revalidateIfStale: false`: la primera página YA la leyó el servidor; sin esto SWR la vuelve a
    // pedir al montar (medido: una lectura de más por visita) y, si esa segunda lectura fallara, la
    // tabla cambiaría las filas buenas por el aviso de error. Una clave nueva (periodo, chip, cierre,
    // página) no tiene datos y se lee igual; tras registrar o anular, `refrescarCuenta` relee.
    { fallbackData: esLaInicial ? inicial : undefined, keepPreviousData: true, revalidateIfStale: false },
  );

  const vigente = data ?? inicial;

  /** R30 — TODAS las claves de ESTA cuenta; ninguna de otra. */
  async function refrescarCuenta() {
    await mutate(esClaveDeLaCuenta(tipo, id));
  }

  /**
   * FICHA 463 (R10/R16/R19) — la zona de la wallet aplica (o quita) el periodo: tarjetas y extracto se
   * releen con él, desde la página 1. Los filtros del libro (chip, cierre, término, orden) se quedan.
   */
  function aplicarPeriodo(seleccion: FilterSelection) {
    const [, desde = "", hasta = ""] = seleccion[CLAVE_PERIODO] ?? [];
    setPeriodo({ desde, hasta });
    setPage(1);
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

  /** R30 — «Limpiar todo» del libro: fuera término, chip y cierre; el periodo y el orden se quedan. */
  function limpiarLibro() {
    setTermino("");
    setChip(CHIP_TODO);
    setCierreId(null);
    setPage(1);
  }

  const detalle = abierta !== null && panel !== undefined ? detalleDe(abierta, rotulos, panel) : null;
  const registroAbierta = abierta?.registro ?? null;
  // R38/R39 — la línea del saldo inicial, con el orden de lo que se PINTA (la lectura vigente).
  const posicion =
    data === undefined ? null : posicionSaldoInicial(sortDir, page, pageSize, data.total);

  return (
    <div className="flex flex-col gap-6">
      {/* FICHA 463 (R1/R2/R4) — la ZONA DE LA WALLET, antes de todo lo demás: el periodo, con «Aplicar».
          Mueve las tarjetas del periodo y el extracto. */}
      <section
        aria-label={ZONA_WALLET_TEXTO.nombre}
        className="flex flex-col gap-2 rounded-xl border bg-muted/30 px-4 py-3"
      >
        <p className="text-xs text-muted-foreground">{ZONA_WALLET_TEXTO.alcance}</p>
        <FilterComponent
          filters={FILTROS_PERIODO}
          onChange={aplicarPeriodo}
          leerDeUrl={false}
          aplicarConBoton={{
            etiqueta: ZONA_WALLET_TEXTO.aplicar,
            etiquetaQuitar: ZONA_WALLET_TEXTO.quitar,
            avisoRangoInvertido: ESTADO_CUENTA_TEXTO.periodoInvalido,
          }}
          className="items-start"
        />
      </section>

      {encabezado ? encabezado(vigente) : null}
      <TarjetasEstadoCuenta estado={vigente} vista={vista} />

      {acciones ? (
        <section aria-label={ESTADO_CUENTA_TEXTO.acciones(nombre)} className="flex flex-col gap-3">
          {acciones(vigente, refrescarCuenta)}
        </section>
      ) : null}

      <TablaEstadoCuenta
        estado={data}
        rotulos={rotulos}
        desde={periodo.desde}
        posicionSaldoInicial={posicion}
        // FICHA 463 (R1/R2/R6/R7/R23/R33) — la ZONA DEL LIBRO, encima de la tabla y junto a la descarga:
        // el buscador canónico, el orden, los chips y —si la superficie lo ofrece— el cierre.
        filtros={
          <section aria-label={ZONA_LIBRO_TEXTO.nombre} className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">{ZONA_LIBRO_TEXTO.alcance}</p>
            <BuscadorFiltros
              label={ZONA_LIBRO_TEXTO.buscar}
              placeholder={ESTADO_CUENTA_TEXTO.buscarPlaceholder[vista]}
              minChars={BUSQUEDA_LIBRO_MIN_CHARS}
              leerDeUrl={false}
              onChange={cambiarTermino}
              onLimpiarTodo={limpiarLibro}
              hayFiltrosAplicados={termino !== "" || chip !== CHIP_TODO || cierreId !== null}
            >
              <SegmentedToggle<DireccionOrden>
                options={ORDEN_LIBRO.opciones}
                valor={sortDir}
                onChange={cambiarOrden}
                ariaLabel={ORDEN_LIBRO.nombre}
              />
              <ChipsEstadoCuenta
                tipo={tipo}
                nombre={nombre}
                valor={chip}
                onChange={(c) => {
                  setChip(c);
                  setPage(1);
                }}
              />
              {selectorCierre
                ? selectorCierre(cierreId, (c) => {
                    setCierreId(c);
                    setPage(1);
                  })
                : null}
            </BuscadorFiltros>
          </section>
        }
        isLoading={data === undefined && isLoading}
        error={error !== undefined}
        onVer={panel === undefined ? undefined : (f) => (seAbre(f) ? setAbierta(f) : undefined)}
        conRegistro={vista === "oficina"}
        detalleDeFila={detalleDeFila}
        accionDeFila={accionDeFila}
        descarga={{
          titulo: ESTADO_CUENTA_TEXTO.tabla(nombre),
          columnas: vista === "oficina" ? COLUMNAS_DESCARGA_ESTADO_CUENTA : COLUMNAS_DESCARGA_MI_ESTADO_CUENTA,
          obtenerFilas: () => filasDelPeriodo(lector, filtros, rotulos),
        }}
      />
      {data !== undefined && data.filas.length === 0 ? (
        <p className="text-sm text-muted-foreground">{ESTADO_CUENTA_TEXTO.vacio}</p>
      ) : null}

      <Pagination
        page={page}
        pageSize={pageSize}
        total={data?.total ?? 0}
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
