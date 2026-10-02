/**
 * Ficha 468 (design §7.2) — adaptador de CLIENTE que COLOCA el libro de la wallet en sus dos hojas: la
 * hoja «Movimientos» como kardex (`filasKardex`) y la hoja «Detalle por guía» agrupada
 * (`filasDetallePorGuia`). Sustituye al `enlazarHojas` de la 464 («N.º» y «Detalle por orden»).
 *
 * Módulo sin React y sin DOM. SOLO COLOCA (R54): pone cada `MontoEnColumna` del servidor en su clave
 * (`entra` / `sale` / `cobradoATiendas`), cada total en su fila y cada saldo en «Saldo». No suma, no
 * resta y no convierte: los saldos, los totales, los aportes y las diferencias llegan calculados con
 * `Prisma.Decimal` del servidor, que además AFIRMA que el TOTAL GENERAL de la hoja 2 es el «Total del
 * periodo» de la hoja 1 (R45). La única conversión a número de Excel la hace el generador
 * (`celdaMonto`, columnas con `formato: "monto"`).
 *
 * Lo que SÍ decide, y por eso vive una sola vez para las cinco superficies:
 *  - el orden de las filas fijas (saldo inicial, movimientos, total, aviso; cabecera, conceptos, total
 *    de la guía, «Movimientos sin guía», TOTAL GENERAL) y cuáles van en negrita (R23, R47);
 *  - que la hoja 1 habla del mismo conjunto que el kardex: si no están alineados, NO hay archivo.
 *
 * Ningún identificador llega a una celda: `movimientoId` es el enlace en memoria con la fila de la
 * hoja 1 (para su concepto y su detalle) y nunca se pinta.
 */
import type { GestionResultado } from "@prisma/client";

import type { DescargaCelda, DescargaFila } from "@/lib/types/descarga";
import type {
  BloqueDeGuiaDTO,
  DetallePorGuiaDTO,
  KardexDTO,
  MontoEnColumna,
  TotalesPorColumna,
} from "@/lib/types/libro-kardex";
import { money } from "@/lib/config/moneda";
import { fechaDiaMovimientoCR } from "@/lib/utils/fecha-dia-iso";

import { DETALLE_SIN_GUIA_MOTIVO, LIBRO_KARDEX_TEXTO, SEPARADOR_DETALLE } from "./libro-kardex-labels";

/** Las filas de una hoja y cuáles van en negrita (índice 0 = la primera fila de datos). */
export interface HojaColocada {
  filas: DescargaFila[];
  filasDestacadas: number[];
}

/** R18 — junta con « · » las partes de un Detalle, en su orden, saltándose las vacías. */
export function textoDetalle(partes: ReadonlyArray<string | null | undefined>): string {
  return partes.filter((p): p is string => typeof p === "string" && p.trim() !== "").join(SEPARADOR_DETALLE);
}

/** R18 — «1 guía» / «N guías» si el movimiento es repartible; `null` si no lo es (no se escribe nada). */
export function textoGuias(ordenes: number | null): string | null {
  return typeof ordenes === "number" ? LIBRO_KARDEX_TEXTO.guias(ordenes) : null;
}

/** Las tres columnas de monto vacías: la fila que no lleva importe. */
const SIN_MONTO = { entra: null, sale: null, cobradoATiendas: null } as const;

/** R9/R10 — el importe en SU columna (la decidió el servidor) y las otras dos vacías. */
function enSuColumna(monto: MontoEnColumna): Record<"entra" | "sale" | "cobradoATiendas", DescargaCelda> {
  return {
    entra: monto.columna === "entra" ? monto.monto : null,
    sale: monto.columna === "sale" ? monto.monto : null,
    cobradoATiendas: monto.columna === "cobrado_a_tiendas" ? monto.monto : null,
  };
}

/** R8/R36/R44 — los totales de cada columna, tal como los sumó el servidor. */
function totales(t: TotalesPorColumna): Record<"entra" | "sale" | "cobradoATiendas", DescargaCelda> {
  return { entra: t.entra, sale: t.sale, cobradoATiendas: t.cobradoATiendas };
}

export interface FilasKardexArgs<M> {
  /** Los movimientos de la respuesta, EN SU ORDEN (cronológico ascendente, R7). */
  movimientos: readonly M[];
  /** El kardex de la MISMA respuesta: `filas[i]` es la de `movimientos[i]`. */
  kardex: KardexDTO;
  /**
   * La fila de un movimiento SIN montos ni saldo: fecha, concepto, detalle y lo propio de la superficie
   * (a quién, es dinero de, registró). Recibe el «N guía(s)» de ese movimiento para su Detalle (R18).
   */
  filaBase: (movimiento: M, ordenes: number | null) => DescargaFila;
  /** R16 — qué aviso va bajo el total: el de una cuenta o el de la caja. */
  variante: "cuenta" | "caja";
  /** La fecha de la fila del saldo inicial (el inicio del periodo), o `null` sin periodo. */
  fechaInicial: string | null;
}

/**
 * R5–R8, R16, R23 — la hoja «Movimientos»: «Saldo al inicio del periodo» (sin montos), una fila por
 * movimiento con su monto en su columna y su saldo, «Total del periodo» con los totales y el saldo
 * final, y —con otros filtros— el aviso. Negrita: la primera y la del total.
 */
export function filasKardex<M>(args: FilasKardexArgs<M>): HojaColocada {
  const { movimientos, kardex } = args;
  if (movimientos.length !== kardex.filas.length) {
    throw new Error("el kardex y los movimientos de la respuesta no hablan del mismo conjunto");
  }
  const filas: DescargaFila[] = [
    {
      fecha: args.fechaInicial,
      concepto: LIBRO_KARDEX_TEXTO.saldoInicial,
      detalle: null,
      ...SIN_MONTO,
      saldo: kardex.saldoInicial,
    },
  ];
  movimientos.forEach((m, i) => {
    const f = kardex.filas[i];
    filas.push({ ...args.filaBase(m, f.ordenes), ...enSuColumna(f.monto), saldo: f.saldo });
  });
  const indiceTotal = filas.length;
  filas.push({
    fecha: null,
    concepto: LIBRO_KARDEX_TEXTO.totalPeriodo,
    detalle: null,
    ...totales(kardex.totales),
    saldo: kardex.saldoFinal,
  });
  if (kardex.conOtrosFiltros) {
    filas.push({ fecha: null, concepto: LIBRO_KARDEX_TEXTO.avisoFiltros[args.variante], detalle: null, ...SIN_MONTO, saldo: null });
  }
  return { filas, filasDestacadas: [0, indiceTotal] };
}

/**
 * R34/R37/R38 — la fila de CABECERA de un bloque de guía: Guía (o «Sin guía · remisión …»), Remisión,
 * Destinatario, Tienda, Mensajero, los días de sus cierres separados por comas y sus resultados; Concepto
 * y las columnas de monto, vacías. Cada superficie la expone en su módulo de columnas
 * (`filaCabeceraGuia*`) con SU etiqueta de resultados; las columnas que la hoja no tiene (Tienda en la
 * de una tienda, Mensajero en la del mensajero y en `/mi-wallet`) no se emiten porque no se declaran.
 */
export function filaCabeceraDeGuia(
  bloque: BloqueDeGuiaDTO,
  resultadosTexto: (resultados: readonly GestionResultado[]) => string,
): DescargaFila {
  return {
    guia: bloque.guia ?? LIBRO_KARDEX_TEXTO.sinGuia(bloque.remision),
    remision: bloque.remision,
    destinatario: bloque.destinatario,
    tienda: bloque.tiendaNombre,
    mensajero: bloque.mensajeroNombre,
    cierre: bloque.cierres.map((c) => fechaDiaMovimientoCR(c)).join(", "),
    resultado: resultadosTexto(bloque.resultados),
    concepto: null,
    detalle: null,
    ...SIN_MONTO,
  };
}

export interface FilasDetallePorGuiaArgs<M> {
  porGuia: DetallePorGuiaDTO;
  /** La fila de cabecera de un bloque, con lo que la superficie muestra (`filaCabeceraGuia*`). */
  cabeceraDe: (bloque: BloqueDeGuiaDTO) => DescargaFila;
  /** El movimiento de la hoja 1 por su id (el enlace en memoria; nunca se pinta). */
  movimientoPorId: ReadonlyMap<string, M>;
  /** El Concepto del movimiento: la MISMA etiqueta que en la hoja «Movimientos» (R35, R40). */
  conceptoDe: (movimiento: M) => string;
  /** La fecha del movimiento, como la pinta la hoja 1 (R40). */
  fechaDe: (movimiento: M) => string;
  /** El Detalle del movimiento en la hoja 1 (R40). */
  detalleDe: (movimiento: M) => string;
  /** La etiqueta de pantalla de los resultados de una gestión (la del detalle de la fila). */
  resultadosTexto: (resultados: readonly GestionResultado[]) => string;
}

/**
 * R33–R47 — la hoja «Detalle por guía»: por cada bloque (ya ordenado por el servidor, R37) su cabecera,
 * una fila por concepto y «Total de la guía»; después el título «Movimientos sin guía» con sus filas
 * (movimientos no repartibles y diferencias); al final el TOTAL GENERAL. Negrita: cabeceras, totales de
 * guía, el título y el TOTAL GENERAL.
 */
export function filasDetallePorGuia<M>(args: FilasDetallePorGuiaArgs<M>): HojaColocada {
  const filas: DescargaFila[] = [];
  const filasDestacadas: number[] = [];
  const destacar = (fila: DescargaFila) => {
    filasDestacadas.push(filas.length);
    filas.push(fila);
  };
  const movimiento = (id: string): M => {
    const m = args.movimientoPorId.get(id);
    if (m === undefined) throw new Error("la hoja de detalle habla de un movimiento que no está en la hoja 1");
    return m;
  };

  for (const bloque of args.porGuia.bloques) {
    const guia = bloque.guia ?? LIBRO_KARDEX_TEXTO.sinGuia(bloque.remision);
    destacar(args.cabeceraDe(bloque));
    for (const fila of bloque.filas) {
      filas.push({
        guia,
        cierre: fechaDiaMovimientoCR(fila.cierreFecha),
        resultado: args.resultadosTexto(fila.resultados),
        concepto: args.conceptoDe(movimiento(fila.movimientoId)),
        detalle: null,
        ...enSuColumna(fila.monto),
      });
    }
    destacar({ guia, concepto: LIBRO_KARDEX_TEXTO.totalGuia, detalle: null, ...totales(bloque.total) });
  }

  destacar({ concepto: LIBRO_KARDEX_TEXTO.movimientosSinGuia, detalle: null, ...SIN_MONTO });
  for (const fila of args.porGuia.sinGuia) {
    const m = movimiento(fila.movimientoId);
    if (fila.tipo === "movimiento") {
      filas.push({
        concepto: args.conceptoDe(m),
        detalle: textoDetalle([args.fechaDe(m), args.detalleDe(m), DETALLE_SIN_GUIA_MOTIVO[fila.motivo]]),
        ...enSuColumna(fila.monto),
      });
      continue;
    }
    filas.push({
      concepto: LIBRO_KARDEX_TEXTO.diferencia,
      detalle: LIBRO_KARDEX_TEXTO.detalleDiferencia(
        fechaDiaMovimientoCR(fila.cierreFecha),
        args.conceptoDe(m),
        money(fila.montoMovimiento),
        money(fila.sumaGuias),
      ),
      ...enSuColumna(fila.monto),
    });
  }

  destacar({ concepto: LIBRO_KARDEX_TEXTO.totalGeneral, detalle: null, ...totales(args.porGuia.totalGeneral) });
  return { filas, filasDestacadas };
}
