// Ficha 476 (design §4.5, R10-R15, R18, R20, R23, R25-R28) — EL MODELO del picking. PURO: sin
// base, sin reloj propio (`ahora` llega del contexto), sin IO.
//
// De aqui salen a la vez las cifras que imprime el PDF y los `valores` de las variables (R27): no
// hay una segunda cuenta en ningun otro sitio.
//
// Productos: el parser de la 345 (`parsearProducto`) y SU clave (`claveDeProducto`, via
// `ItemProducto.clave`), que es lo que no puede divergir entre fichas. Las dos reglas privadas de
// `ConteoProductosService` —fundir por clave dentro de una orden (R26 de la 345) y la forma visible
// (R18 de la 345)— se REPLICAN aqui (alternativa E del design: no se toca un servicio de analitica
// con dinero por una ficha que no lo necesita).
import { parsearProducto, type ItemProducto } from "@/lib/analytics/producto-parse";
import { diasNaturalesCRDesde, fechaCalendarioCR } from "@/lib/utils/fecha-cr";
import { fechaCRLegible, horaCRLegible } from "@/lib/whatsapp-envios/informes/formato";
import type { FilaPicking } from "@/lib/whatsapp-envios/informes/picking/tipos";

export const NOMBRE_SIN_PRODUCTO = "Sin producto indicado";

/** Las variables del informe, en el orden en que se declaran (R25). */
export const CLAVES_VARIABLES_PICKING = [
  "tienda",
  "ordenes",
  "unidades",
  "productos",
  "atrasadas",
  "dias_atraso",
  "remision_desde",
  "remision_hasta",
  "fecha",
  "hora",
] as const;

export type ClaveVariablePicking = (typeof CLAVES_VARIABLES_PICKING)[number];

/** Una orden dentro de la fila de un producto. */
export interface OrdenDelProducto {
  ordenId: string;
  /** «<remision>» o «<remision> (guía <n>)» (R18). */
  identificador: string;
  /** Unidades de ESTE producto en esta orden, ya fundidas (R11). `0` en «Sin producto indicado». */
  cantidad: number;
  dias: number;
  atrasada: boolean;
}

export interface GrupoPicking {
  /** Clave de la 345; `null` = la fila «Sin producto indicado» (R13). */
  clave: string | null;
  nombre: string;
  unidades: number;
  /** En el orden natural de remision (el de las filas). */
  ordenes: OrdenDelProducto[];
}

export interface OrdenAtrasada {
  ordenId: string;
  identificador: string;
  dias: number;
}

export interface ModeloPicking {
  tienda: string;
  ahora: Date;
  diasAtraso: number;
  /** Productos (unidades desc, nombre asc) y, al final si existe, «Sin producto indicado». */
  grupos: GrupoPicking[];
  totales: { ordenes: number; unidades: number; productos: number; atrasadas: number };
  /** Dias desc; empate, orden natural de remision (R19). */
  atrasadas: OrdenAtrasada[];
  remisionDesde: string;
  remisionHasta: string;
  valores: Record<ClaveVariablePicking, string>;
  nombreArchivo: string;
}

/** Comparacion por UNIDADES DE CODIGO (no `localeCompare`): determinista en cualquier entorno. */
export function compararCodigo(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** R18 — la remision y, si la orden tiene guia, «(guía N)». */
export function identificadorDeOrden(numRemision: string, numGuia: number | null): string {
  return numGuia === null ? numRemision : `${numRemision} (guía ${numGuia})`;
}

/** R11 — los items de UNA orden fundidos por clave: cantidades sumadas, formas escritas recogidas. */
function fundirPorClave(items: readonly ItemProducto[]): Map<string, { cantidad: number; nombres: string[] }> {
  const fundidos = new Map<string, { cantidad: number; nombres: string[] }>();
  for (const item of items) {
    const previo = fundidos.get(item.clave);
    if (previo === undefined) {
      fundidos.set(item.clave, { cantidad: item.cantidad, nombres: [item.nombre] });
      continue;
    }
    previo.cantidad += item.cantidad;
    if (!previo.nombres.includes(item.nombre)) previo.nombres.push(item.nombre);
  }
  return fundidos;
}

/** R12 — la forma escrita que aparece en MAS ordenes; empate, la menor por unidades de codigo. */
function formaVisible(variantes: Map<string, number>): string {
  let elegida = "";
  let peso = -1;
  for (const [nombre, ordenes] of variantes) {
    if (ordenes > peso || (ordenes === peso && compararCodigo(nombre, elegida) < 0)) {
      elegida = nombre;
      peso = ordenes;
    }
  }
  return elegida;
}

/**
 * R23 — `picking-<tienda>-<AAAA-MM-DD>.pdf`: tienda en minusculas ASCII separadas por guiones (sin
 * diacriticos), fecha calendario de Costa Rica. Una tienda sin ningun caracter util → `tienda`.
 */
export function nombreArchivoPicking(tienda: string, ahora: Date): string {
  const slug = tienda
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `picking-${slug === "" ? "tienda" : slug}-${fechaCalendarioCR(ahora)}.pdf`;
}

/** R14 — dias calendario CR entre la entrada a `en_preparacion` y `ahora` (nunca negativo). */
export function diasEnPreparacion(entrada: Date, ahora: Date): number {
  return diasNaturalesCRDesde(entrada, ahora);
}

/** R15 — atrasada = ESTRICTAMENTE mas de `diasAtraso` dias. */
export function estaAtrasada(dias: number, diasAtraso: number): boolean {
  return dias > diasAtraso;
}

interface Acumulado {
  clave: string;
  unidades: number;
  variantes: Map<string, number>;
  ordenes: OrdenDelProducto[];
}

/**
 * El modelo de UNA generacion. `filas` llega ya en el orden natural de remision (lo da la consulta,
 * `ORDER BY clave_remision`), y ese orden se conserva dentro de cada producto y en los empates.
 */
export function construirModeloPicking(
  filas: readonly FilaPicking[],
  opciones: { ahora: Date; diasAtraso: number; tienda: string },
): ModeloPicking {
  const { ahora, diasAtraso, tienda } = opciones;
  const porClave = new Map<string, Acumulado>();
  const sinProducto: OrdenDelProducto[] = [];
  const atrasadas: (OrdenAtrasada & { posicion: number })[] = [];

  filas.forEach((f, posicion) => {
    const dias = diasEnPreparacion(f.entrada, ahora);
    const atrasada = estaAtrasada(dias, diasAtraso);
    const identificador = identificadorDeOrden(f.numRemision, f.numGuia);
    if (atrasada) atrasadas.push({ ordenId: f.ordenId, identificador, dias, posicion });

    const fundidos = fundirPorClave(parsearProducto(f.producto));
    if (fundidos.size === 0) {
      sinProducto.push({ ordenId: f.ordenId, identificador, cantidad: 0, dias, atrasada });
      return;
    }
    for (const [clave, item] of fundidos) {
      let g = porClave.get(clave);
      if (g === undefined) {
        g = { clave, unidades: 0, variantes: new Map(), ordenes: [] };
        porClave.set(clave, g);
      }
      g.unidades += item.cantidad;
      // R12: cada forma escrita suma UNA orden (una orden con dos formas cuenta para las dos).
      for (const nombre of item.nombres) g.variantes.set(nombre, (g.variantes.get(nombre) ?? 0) + 1);
      g.ordenes.push({ ordenId: f.ordenId, identificador, cantidad: item.cantidad, dias, atrasada });
    }
  });

  const productos: GrupoPicking[] = [...porClave.values()]
    .map((g) => ({ clave: g.clave, nombre: formaVisible(g.variantes), unidades: g.unidades, ordenes: g.ordenes }))
    .sort((a, b) => b.unidades - a.unidades || compararCodigo(a.nombre, b.nombre) || compararCodigo(a.clave ?? "", b.clave ?? ""));
  const grupos: GrupoPicking[] =
    sinProducto.length > 0
      ? [...productos, { clave: null, nombre: NOMBRE_SIN_PRODUCTO, unidades: 0, ordenes: sinProducto }]
      : productos;

  const totales = {
    ordenes: filas.length,
    unidades: productos.reduce((n, g) => n + g.unidades, 0),
    productos: productos.length,
    atrasadas: atrasadas.length,
  };
  const listaAtrasadas = atrasadas
    .sort((a, b) => b.dias - a.dias || a.posicion - b.posicion)
    .map(({ ordenId, identificador, dias }) => ({ ordenId, identificador, dias }));

  const remisionDesde = filas[0]?.numRemision ?? "";
  const remisionHasta = filas[filas.length - 1]?.numRemision ?? "";

  return {
    tienda,
    ahora,
    diasAtraso,
    grupos,
    totales,
    atrasadas: listaAtrasadas,
    remisionDesde,
    remisionHasta,
    valores: {
      tienda,
      ordenes: String(totales.ordenes),
      unidades: String(totales.unidades),
      productos: String(totales.productos),
      atrasadas: String(totales.atrasadas),
      dias_atraso: String(diasAtraso),
      remision_desde: remisionDesde,
      remision_hasta: remisionHasta,
      fecha: fechaCRLegible(ahora),
      hora: horaCRLegible(ahora),
    },
    nombreArchivo: nombreArchivoPicking(tienda, ahora),
  };
}

/**
 * R3 — conteos del selector de tienda con la MISMA definicion de «atrasada» que el PDF
 * (`diasEnPreparacion` + `estaAtrasada`): el resumen no hace aritmetica de dias en SQL, asi que las
 * dos cuentas no pueden divergir.
 */
export function contarPorTienda(
  entradas: readonly { tiendaId: string; entrada: Date }[],
  ahora: Date,
  diasAtraso: number,
): Map<string, { ordenes: number; atrasadas: number }> {
  const conteo = new Map<string, { ordenes: number; atrasadas: number }>();
  for (const e of entradas) {
    const c = conteo.get(e.tiendaId) ?? { ordenes: 0, atrasadas: 0 };
    c.ordenes += 1;
    if (estaAtrasada(diasEnPreparacion(e.entrada, ahora), diasAtraso)) c.atrasadas += 1;
    conteo.set(e.tiendaId, c);
  }
  return conteo;
}
