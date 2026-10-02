/**
 * Ficha 468 (design §7.4; R5, R8, R16, R18, R24, R34–R44, R60) — los TEXTOS del libro de la wallet en
 * Excel: la hoja «Movimientos» como kardex y la hoja «Detalle por guía» agrupada.
 *
 * Módulo PURO (sin React). Español claro, sin siglas ni jerga técnica (R19, R60): ninguno dice
 * «snapshot», «productor», «ledger», «feed» ni «SLA» (`tests/unit/descarga/libro-kardex-textos-468.test.ts`).
 *
 * Los montos que aparecen DENTRO de un texto (el detalle de una «Diferencia sin repartir») llegan ya
 * formateados por quien llama (`money`, presentación): aquí no se convierte nada.
 */
import type { DescargaColumna } from "@/lib/types/descarga";
import type { MotivoSinReparto } from "@/lib/types/detalle-movimiento";

/** El separador de la casa entre las partes de un texto compuesto (R18). */
export const SEPARADOR_DETALLE = " · ";

/** Las dos opciones del selector y el nombre de la hoja 2 (R24, R26). */
export const LIBRO_KARDEX_HOJAS = {
  detalle: "Detalle por guía",
  conDetalle: "Movimientos y detalle por guía · dos hojas",
  sinDetalle: "Solo los movimientos · una hoja",
} as const;

/** Las filas que pone el kardex y la hoja 2, y sus textos (R5, R8, R16, R34–R44). */
export const LIBRO_KARDEX_TEXTO = {
  saldoInicial: "Saldo al inicio del periodo",
  totalPeriodo: "Total del periodo",
  /** R16 — el aviso bajo el total cuando la descarga lleva otros filtros además del periodo. */
  avisoFiltros: {
    cuenta: "Con filtros: Entra y Sale suman solo los movimientos de esta hoja; el saldo es el de toda la cuenta.",
    caja: "Con filtros: Entra y Sale suman solo los movimientos de esta hoja; el saldo es el de toda la caja.",
  },
  totalGuia: "Total de la guía",
  movimientosSinGuia: "Movimientos sin guía",
  diferencia: "Diferencia sin repartir",
  totalGeneral: "TOTAL GENERAL",
  /** R37 — la orden que nunca tuvo guía se nombra por su remisión. */
  sinGuia: (remision: string) => `Sin guía · remisión ${remision}`,
  /** R18 (decisión 3 del humano) — cuántas guías componen el importe: «1 guía» / «N guías». */
  guias: (n: number) => (n === 1 ? "1 guía" : `${n} guías`),
  /** R41 — el detalle de una «Diferencia sin repartir»: el día, el concepto, el monto y lo que suman sus guías. */
  detalleDiferencia: (dia: string, concepto: string, monto: string, suma: string) =>
    `Cierre del ${dia} · ${concepto}: el movimiento es ${monto} y sus guías suman ${suma}`,
} as const;

/**
 * R43 — lo que se añade al Detalle de un movimiento de «Movimientos sin guía» según por qué no se reparte.
 * `null` = nada que añadir (su Detalle de la hoja 1 ya dice de dónde sale). El pago tomado del efectivo
 * del mensajero dice de dónde salió el dinero.
 */
export const DETALLE_SIN_GUIA_MOTIVO: Readonly<Record<MotivoSinReparto, string | null>> = {
  no_nace_de_un_cierre: null,
  snapshot_del_cierre: "Se tomó del efectivo que el mensajero entregó en el cierre de ese día.",
};

/**
 * Las columnas que pueden salir en las dos hojas, con su encabezado (R1–R3, R29–R32). Cada superficie
 * elige las suyas y su orden en su `*-descarga-columnas.ts`; las de monto llevan `formato: "monto"`
 * (celda numérica en Excel, R22; texto en csv, R58).
 */
export const COLUMNA_LIBRO = {
  fecha: { clave: "fecha", encabezado: "Fecha" },
  concepto: { clave: "concepto", encabezado: "Concepto" },
  detalle: { clave: "detalle", encabezado: "Detalle" },
  aQuien: { clave: "aQuien", encabezado: "A quién" },
  esDineroDe: { clave: "esDineroDe", encabezado: "Es dinero de" },
  entra: { clave: "entra", encabezado: "Entra", formato: "monto" },
  sale: { clave: "sale", encabezado: "Sale", formato: "monto" },
  cobradoATiendas: { clave: "cobradoATiendas", encabezado: "Cobrado a tiendas", formato: "monto" },
  saldo: { clave: "saldo", encabezado: "Saldo", formato: "monto" },
  registro: { clave: "registro", encabezado: "Registró" },
  guia: { clave: "guia", encabezado: "Guía" },
  remision: { clave: "remision", encabezado: "Remisión" },
  destinatario: { clave: "destinatario", encabezado: "Destinatario" },
  tienda: { clave: "tienda", encabezado: "Tienda" },
  mensajero: { clave: "mensajero", encabezado: "Mensajero" },
  cierre: { clave: "cierre", encabezado: "Cierre" },
  resultado: { clave: "resultado", encabezado: "Resultado" },
} as const satisfies Record<string, DescargaColumna>;

/** R51 — en la hoja «Movimientos», Concepto, las columnas de monto y Saldo no se pueden desmarcar. */
export const FIJAS_MOVIMIENTOS: readonly string[] = ["concepto", "entra", "sale", "cobradoATiendas", "saldo"];

/** R51 — en la hoja «Detalle por guía», Guía, Concepto y las columnas de monto tampoco. */
export const FIJAS_DETALLE_POR_GUIA: readonly string[] = ["guia", "concepto", "entra", "sale", "cobradoATiendas"];
