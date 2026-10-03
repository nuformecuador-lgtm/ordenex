import type { SentidoDelSaldo, TipoDeCuenta } from "@/lib/types/estado-cuenta";
import { CHIPS_BODEGA, CHIPS_MENSAJERO, CHIPS_TIENDA, type ChipEstadoCuenta } from "@/lib/utils/estado-cuenta-chips";

// FICHA 458-D (T D.1, design §3.2/§5.1; R18–R25, R32) — los textos del ESTADO DE CUENTA de una tienda,
// un mensajero o una bodega satélite. Fuera del JSX (docs/conventions), sin siglas y sin ningún
// identificador interno (H6): la cuenta se nombra por su nombre y cada fila por su concepto y su día.
//
// Money-safe (R90): este módulo NO convierte montos. La frase de las tarjetas recibe el monto ya
// pintado por `money` y sin signo (`sinSigno` quita el guion de TEXTO): el sentido lo dice la frase.

/** «Todo» no es un chip del servidor: es no filtrar. */
export const CHIP_TODO = "todo" as const;
export type ChipOTodo = ChipEstadoCuenta | typeof CHIP_TODO;

/** R24 / D10 — el rótulo de cada chip. `Record` total sobre los chips de los tres libros + «Todo». */
export const CHIP_LABEL: Record<ChipOTodo, string> = {
  todo: "Todo",
  cierres: "Cierres",
  pagos: "Pagos",
  cobros: "Cobros",
  correcciones: "Correcciones",
  premios: "Premios",
  declarado: "Declarado",
  recibido: "Recibido",
};

/**
 * FICHA 458-D (T D.1, D10; R24) — los chips del estado de cuenta, por tipo de cuenta: tienda «Todo ·
 * Cierres · Pagos · Cobros · Correcciones», mensajero «Todo · Cierres · Pagos · Premios · Correcciones»,
 * bodega «Todo · Declarado · Recibido». La lista sale de las MISMAS constantes con las que el servidor
 * decide el chip de cada fila (`lib/utils/estado-cuenta-chips.ts`): el filtro y la fila no pueden
 * discrepar.
 *
 * FICHA 467 — se muda aquí desde `ChipsEstadoCuenta.tsx` (retirado): los chips ya no son un conmutador
 * a la vista sino las opciones de la casilla «Tipo de movimiento» de la barra única (R21).
 */
export const CHIPS_POR_TIPO: Record<TipoDeCuenta, readonly ChipOTodo[]> = {
  tienda: [CHIP_TODO, ...CHIPS_TIENDA],
  mensajero: [CHIP_TODO, ...CHIPS_MENSAJERO],
  bodega: [CHIP_TODO, ...CHIPS_BODEGA],
};

/**
 * FICHA 467 (design §4.5, §8; R7) — las casillas de la barra única del estado de cuenta, en su orden.
 * «Cierre» solo se ofrece donde la superficie ya filtra por cierre (tienda, mensajero, `/mi-wallet`).
 */
export const CASILLA_ESTADO_CUENTA = {
  periodo: "periodo",
  tipoMovimiento: "tipoMovimiento",
  cierre: "cierre",
} as const;

export const CASILLAS_ESTADO_CUENTA_TEXTO = {
  periodo: "Periodo",
  tipoMovimiento: "Tipo de movimiento",
  cierre: "Cierre",
} as const;

/** El monto sin su signo, como TEXTO (no se convierte a número): la frase dice el sentido. */
export function sinSigno(monto: string): string {
  return monto.startsWith("-") ? monto.slice(1) : monto;
}

/**
 * R18 — la frase de la tarjeta del saldo: quién le debe a quién y cuánto, en palabras. `monto` llega
 * YA pintado (`money(sinSigno(saldo))`).
 */
export function fraseDelSaldo(tipo: TipoDeCuenta, sentido: SentidoDelSaldo, nombre: string, monto: string): string {
  if (tipo === "bodega") {
    if (sentido === "por_entregar") return `${nombre} tiene ${monto} por entregar`;
    if (sentido === "en_cero") return `${nombre} no tiene nada por entregar`;
    return `${nombre} entregó ${monto} de más`;
  }
  if (sentido === "ordenex_debe") return `Ordenex le debe ${monto} a ${nombre}`;
  if (sentido === "cuenta_debe") return `${nombre} le debe ${monto} a Ordenex`;
  return `Ordenex y ${nombre} no se deben nada`;
}

/**
 * FICHA 458-D (R34) — la MISMA frase leída por la propia tienda en `/mi-wallet`, en segunda persona
 * (como el resto de esa pantalla). `monto` llega ya pintado y sin signo, igual que arriba.
 */
export function fraseDelSaldoParaLaTienda(sentido: SentidoDelSaldo, monto: string): string {
  if (sentido === "ordenex_debe") return `Ordenex te debe ${monto}`;
  if (sentido === "cuenta_debe") return `Le debés ${monto} a Ordenex`;
  return "Ordenex y vos no se deben nada";
}

/** R18 — las tarjetas. En la bodega el cargo es lo DECLARADO y el abono lo RECIBIDO. */
export const TARJETAS_TEXTO: Record<
  TipoDeCuenta,
  { saldo: string; abonos: string; cargos: string; inicial: string; final: string }
> = {
  tienda: {
    saldo: "Saldo actual",
    abonos: "Abonos del periodo",
    cargos: "Cargos del periodo",
    inicial: "Saldo inicial",
    final: "Saldo al final del periodo",
  },
  mensajero: {
    saldo: "Saldo actual",
    abonos: "Abonos del periodo",
    cargos: "Cargos del periodo",
    inicial: "Saldo inicial",
    final: "Saldo al final del periodo",
  },
  bodega: {
    saldo: "Por entregar hoy",
    abonos: "Recibido en el periodo",
    cargos: "Declarado en el periodo",
    inicial: "Por entregar al inicio",
    final: "Por entregar al final del periodo",
  },
};

/** R19 — las columnas del extracto (pantalla y descarga dicen lo mismo). */
export const COLUMNAS_TEXTO: Record<
  TipoDeCuenta,
  { fecha: string; movimiento: string; cargo: string; abono: string; saldo: string; ver: string }
> = {
  tienda: { fecha: "Fecha", movimiento: "Movimiento y motivo", cargo: "Cargo", abono: "Abono", saldo: "Saldo", ver: "Ver" },
  mensajero: {
    fecha: "Fecha",
    movimiento: "Movimiento y motivo",
    cargo: "Cargo",
    abono: "Abono",
    saldo: "Saldo",
    ver: "Ver",
  },
  bodega: {
    fecha: "Fecha",
    movimiento: "Movimiento",
    cargo: "Declarado",
    abono: "Recibido",
    saldo: "Por entregar",
    ver: "Ver",
  },
};

export const ESTADO_CUENTA_TEXTO = {
  /** R20 — la primera fila del extracto. */
  saldoInicial: "Saldo inicial del periodo",
  saldoInicialSinPeriodo: "Saldo inicial",
  /** R25 — el contra-asiento se rotula como anulación de su original. */
  anulacion: "Anulación",
  anulado: "Anulado",
  /** R72 — anulado antes de la 458 sin constancia. */
  motivoNoRegistrado: "motivo no registrado",
  conComprobante: "Con comprobante",
  registro: (quien: string) => `Registró: ${quien}`,
  vacio: "No hay movimientos en este periodo.",
  error: "No se pudo cargar el estado de cuenta.",
  /**
   * FICHA 463 (R49) — una lectura falló y la pantalla se queda con la última buena: lo dice junto al
   * libro (no en su lugar) y explica que los filtros volvieron a los de esa lectura.
   */
  errorConservado: "Se sigue mostrando lo último que se cargó, con sus filtros.",
  errorDescarga: "No se pudo leer el estado de cuenta para descargarlo.",
  tabla: (nombre: string) => `Estado de cuenta de ${nombre}`,
  chips: (nombre: string) => `Filtrar el estado de cuenta de ${nombre}`,
  paginacion: (nombre: string) => `Paginación del estado de cuenta de ${nombre}`,
  tarjetas: (nombre: string) => `Saldo de ${nombre}`,
  periodo: (nombre: string) => `Periodo del estado de cuenta de ${nombre}`,
  desde: "Desde",
  hasta: "Hasta",
  /**
   * FICHA 463 (R23/R26/R27) — el placeholder del buscador del extracto. En la oficina alcanza la
   * descripción y quién registró; en `/mi-wallet` SOLO la descripción (la tienda no ve los nombres de
   * la gente de Ordenex, R27), así que no la nombra.
   *
   * FICHA 469 (R24, R36) — la oficina (tienda y mensajero) y `/mi-wallet` nombran además la guía y la
   * remisión (búsqueda por guía). La bodega satélite NO: su buscador sigue siendo solo de texto, y por eso
   * tiene su clave propia (antes compartía la de la oficina).
   */
  buscarPlaceholder: {
    oficina: "Buscar por guía, remisión, descripción o quién registró",
    tienda: "Buscar por guía, remisión o descripción",
    bodega: "Buscar por descripción o quién registró",
  },
  acciones: (nombre: string) => `Acciones sobre la cuenta de ${nombre}`,
  volver: "Volver al listado",
  /** FICHA 458-D (R19, 172/457/459) — el método y la referencia del pago de la fila, en palabras. */
  como: (texto: string) => `Cómo se pagó: ${texto}`,
  /** FICHA 458-D (R10) — el rótulo visible del filtro por cierre. */
  cierre: "Cierre",
  /**
   * FICHA 458-D (TD.6/R32) — la descarga supera el tope del servidor: no hay archivo (nunca uno al que
   * le falten filas), y se dice qué hacer.
   */
  limiteDescarga: (total: number, limite: number) =>
    `El estado de cuenta tiene ${total} movimientos con estos filtros y la descarga admite hasta ${limite}. ` +
    "Elegí un periodo más corto, un tipo de movimiento o un cierre y volvé a descargar.",
} as const;

/** R25 — la leyenda de una fila anulada: quién, cuándo y por qué (o «motivo no registrado»). */
export function textoAnulado(a: { motivo: string | null; por: string | null; fecha: string | null }): string {
  const partes = [
    ESTADO_CUENTA_TEXTO.anulado,
    a.fecha === null ? null : `el ${a.fecha}`,
    a.por === null ? null : `por ${a.por}`,
  ].filter((x): x is string => x !== null);
  return `${partes.join(" ")} · ${a.motivo ?? ESTADO_CUENTA_TEXTO.motivoNoRegistrado}`;
}
