import { z } from "zod";
import { Prisma } from "@prisma/client";
import type {
  WalletMovimientoTipo as PrismaWalletMovimientoTipo,
  WalletMovimientoCategoria as PrismaWalletMovimientoCategoria,
  WalletOrigenTipo as PrismaWalletOrigenTipo,
} from "@prisma/client";
import type { ListarCompletoResult } from "@/lib/types/descarga-listado";
import { composicionDetalleConfig } from "@/lib/config/composicion-detalle";
import { walletMovimientoConfig } from "@/lib/config/wallet-movimiento";
import {
  esFechaCalendarioValida,
  fechaCalendarioCR,
  ultimosNDiasCalendarioCR,
} from "@/lib/utils/fecha-cr";

// Feature 42 (design §1.1/§3) — fuente unica de verdad de tipos/categorias/origenes de
// la wallet, respaldada por los enums Postgres nativos (patron METODO_PAGO_SEED). El
// `satisfies` rompe el build si el SEED tuviera un valor que el enum NO tiene; el chequeo
// `_Ensure*` rompe el build si el enum gana un valor que el SEED NO lista.

export const WALLET_MOVIMIENTO_TIPO_SEED = [
  "ingreso",
  "egreso",
] as const satisfies readonly PrismaWalletMovimientoTipo[];

export type WalletMovimientoTipo = (typeof WALLET_MOVIMIENTO_TIPO_SEED)[number];

type _EnsureTipoExhaustive = Exclude<PrismaWalletMovimientoTipo, WalletMovimientoTipo> extends never
  ? true
  : never;
const _tipoExhaustive: _EnsureTipoExhaustive = true;
void _tipoExhaustive;

export const WALLET_MOVIMIENTO_CATEGORIA_SEED = [
  "ingreso_flete",
  "ingreso_flete_devolucion",
  "ingreso_comision_cod",
  "ingreso_iva_flete",
  "ingreso_iva_flete_devolucion",
  "ingreso_iva_comision_cod",
  "ingreso_ajuste",
  "egreso_pago_tienda",
  "egreso_pago_mensajero",
  "egreso_gasto",
  "egreso_sueldo",
  "egreso_ajuste",
  "egreso_gasto_fijo", // feature 45: gasto fijo (lo emite el CRON, no el form manual)
  "egreso_gasto_variable", // feature 45: gasto variable (manual)
  // Feature 158 (R2/R3): indemnizacion por incidente. La EMITE la aprobacion del cierre del
  // dia (nunca el formulario manual de la 45, que solo admite gasto_variable/sueldo).
  "egreso_indemnizacion",
  // Feature 173 (R49, design §2.1): los DOS conceptos de TESORERIA. Dinero de TERCEROS que
  // solo PASA por la caja; su naturaleza la declara `NATURALEZA_POR_CATEGORIA`
  // (lib/utils/caja-tesoreria.ts), que es un `Record` TOTAL sobre este union.
  "ingreso_cod_recaudado", // R11: entra al aprobar el cierre del dia
  "ingreso_reverso_pago_tienda", // R24/R26: vuelve al anular un pago a tienda (NUNCA ingreso_ajuste)
] as const satisfies readonly PrismaWalletMovimientoCategoria[];

export type WalletMovimientoCategoria = (typeof WALLET_MOVIMIENTO_CATEGORIA_SEED)[number];

type _EnsureCategoriaExhaustive = Exclude<
  PrismaWalletMovimientoCategoria,
  WalletMovimientoCategoria
> extends never
  ? true
  : never;
const _categoriaExhaustive: _EnsureCategoriaExhaustive = true;
void _categoriaExhaustive;

export const WALLET_ORIGEN_TIPO_SEED = [
  "cierre_dia",
  "gestion_orden",
  "manual",
  "pago_tienda",
  "pago_mensajero",
  "gasto",
  // Feature 158 (R37): origen del egreso de indemnizacion del camino del ADMIN. Valor PROPIO y
  // NO el reservado `gestion_orden` (design §9.12): el indice `(origen_tipo, origen_id)` existe
  // para responder "movimientos de este origen", y un `origen_id` que apunta a `orden_incidente`
  // etiquetado como `gestion_orden` devolveria basura.
  "orden_incidente",
  // Feature 293 (T1.5, design §3.4, R20): origen del EGRESO DE CAJA del premio del ranking y de
  // su reverso — la FILA DEL PODIO (`ranking_snapshot_fila.id`), no el cierre. Valor PROPIO por
  // el mismo motivo que `orden_incidente`: el indice `(origen_tipo, origen_id)` existe para
  // responder «movimientos de este origen», y un `origen_id` que apunta a la fila del podio
  // etiquetado como `cierre_dia` ademas de devolver basura CHOCARIA con el
  // `egreso_pago_mensajero` que el feed del cierre ya escribio.
  "ranking_snapshot_fila",
] as const satisfies readonly PrismaWalletOrigenTipo[];

export type WalletOrigenTipo = (typeof WALLET_ORIGEN_TIPO_SEED)[number];

type _EnsureOrigenExhaustive = Exclude<PrismaWalletOrigenTipo, WalletOrigenTipo> extends never
  ? true
  : never;
const _origenExhaustive: _EnsureOrigenExhaustive = true;
void _origenExhaustive;

// Las 6 categorias de ingreso de Ordenex (design §4) que emite el feed del cierre. El
// resto (ingreso_ajuste, egreso_*) NO viene del feed automatico.
export const WALLET_INGRESO_CONCEPTO_SEED = [
  "ingreso_flete",
  "ingreso_flete_devolucion",
  "ingreso_comision_cod",
  "ingreso_iva_flete",
  "ingreso_iva_flete_devolucion",
  "ingreso_iva_comision_cod",
] as const satisfies readonly WalletMovimientoCategoria[];

export type WalletIngresoConcepto = (typeof WALLET_INGRESO_CONCEPTO_SEED)[number];

// Feature 231 (design §2.2, D5 firmada el 2026-08-18) — las SIETE categorias de ingreso de
// naturaleza `propio` del catalogo: las seis del feed MAS el ajuste manual. Se escribe como
// EXTENSION del seed del feed, no como una segunda lista a mano, para que el dia que el feed
// gane un concepto entre solo en el desglose de la ganancia (R23).
//
// La totalidad —que estas siete son EXACTAMENTE las categorias que `NATURALEZA_POR_CATEGORIA`
// declara `propio` con tipo ingreso— la comprueba en RUNTIME
// `tests/unit/guards/caja-composicion-exhaustiva.guardia.test.ts` (R23/R32): un `satisfies`
// no puede afirmarlo, porque la naturaleza es un VALOR y no un tipo.
export const WALLET_INGRESO_PROPIO_SEED = [
  ...WALLET_INGRESO_CONCEPTO_SEED,
  "ingreso_ajuste",
] as const satisfies readonly WalletMovimientoCategoria[];

export type WalletIngresoPropio = (typeof WALLET_INGRESO_PROPIO_SEED)[number];

// Feature 231 (design §2.2) — las CUATRO categorias de egreso propio que `DesgloseEgresosDTO`
// (features 45/158) ya abre concepto por concepto. Existe para poder derivar su COMPLEMENTO
// (`ComposicionGananciaDTO.otrosEgresos`, R26) sin copiar a mano la lista de las que faltan:
// lo que no esta aqui y es un egreso propio, cae en «otros gastos» por construccion.
export const WALLET_EGRESO_DESGLOSADO_SEED = [
  "egreso_gasto_fijo",
  "egreso_gasto_variable",
  "egreso_sueldo",
  "egreso_indemnizacion",
] as const satisfies readonly WalletMovimientoCategoria[];

export type WalletEgresoDesglosado = (typeof WALLET_EGRESO_DESGLOSADO_SEED)[number];

/**
 * Ficha 339 (T1.1, design §2.1, R1/R2) — los egresos propios que ganan FILA PROPIA en la
 * tarjeta de la ganancia y que hasta hoy caian dentro de «Otros gastos de Ordenex».
 *
 * `egreso_pago_mensajero` es el motivo de la ficha: en produccion era el 100 % de «Otros»
 * (227.300,00 en 9 movimientos), un concepto con nombre propio escondido en un cubo anonimo.
 * `egreso_ajuste` entra con el —y no se queda en el cubo— porque su espejo del lado de los
 * ingresos (`ingreso_ajuste`) ya tiene fila con nombre, y porque el dialogo «Registrar
 * movimiento» le PROMETE al usuario que ese gasto se llamara «Ajuste (egreso)»: sin fila
 * propia, la tarjeta rompe esa promesa.
 */
export const WALLET_EGRESO_NOMBRADO_SEED = [
  "egreso_pago_mensajero",
  "egreso_ajuste",
] as const satisfies readonly WalletMovimientoCategoria[];

export type WalletEgresoNombrado = (typeof WALLET_EGRESO_NOMBRADO_SEED)[number];

/**
 * Ficha 339 (T1.1, design §2.1) — TODO egreso propio con fila propia en la columna: los cuatro
 * conceptos que `DesgloseEgresosDTO` ya abria MAS los dos que la 339 saca del cubo.
 *
 * Se escribe como EXTENSION (spread) y no como una segunda lista a mano —el mismo patron con el
 * que `WALLET_INGRESO_PROPIO_SEED` extiende a `WALLET_INGRESO_CONCEPTO_SEED`—: el dia que un
 * concepto gane fila entra por UN solo sitio, y el COMPLEMENTO (`otrosEgresos`) se recalcula
 * solo. `WALLET_EGRESO_DESGLOSADO_SEED` NO se toca: sigue significando «los cuatro que
 * `DesgloseEgresosDTO` abre», que es lo que usan las fichas 45/158.
 */
export const WALLET_EGRESO_CON_FILA_SEED = [
  ...WALLET_EGRESO_DESGLOSADO_SEED,
  ...WALLET_EGRESO_NOMBRADO_SEED,
] as const satisfies readonly WalletMovimientoCategoria[];

export type WalletEgresoConFila = (typeof WALLET_EGRESO_CON_FILA_SEED)[number];

/**
 * Ficha 339 (T1.2, design §2.2) — el token de la fila «Otros gastos de Ordenex».
 *
 * NO es un valor del enum de categorias A PROPOSITO: el complemento no es una categoria, es una
 * operacion de conjuntos («todo egreso propio que no tiene fila»). Darle un valor de enum lo
 * convertiria en una categoria mas y abriria la puerta a que alguien la escribiera en el libro.
 */
export const COMPOSICION_FILA_OTROS = "otros_egresos";

/**
 * Ficha 339 (T1.2, design §2.2) — el catalogo de FILAS de la tarjeta de la ganancia: 7 de
 * ingreso + 6 de egreso + el token del complemento = 14.
 *
 * Es lo que el cliente manda para pedir el detalle de una fila (`listarMovimientosDeFilaSchema`).
 * Manda el TOKEN y NUNCA una lista de categorias (design §10-A1): si el navegador pudiera
 * declarar que categorias componen «Otros», existirian DOS definiciones del complemento —una
 * para el importe y otra para el detalle— y podrian divergir sin que nada fallara.
 */
export const COMPOSICION_FILA_SEED = [
  ...WALLET_INGRESO_PROPIO_SEED,
  ...WALLET_EGRESO_CON_FILA_SEED,
  COMPOSICION_FILA_OTROS,
] as const;

export type ComposicionFilaId = (typeof COMPOSICION_FILA_SEED)[number];

/**
 * Feature 231 — de quien es el dinero de una categoria: de Ordenex, o de un tercero que lo
 * tiene aparcado en la caja.
 *
 * Lo DECLARO la 173 dentro de `lib/utils/caja-tesoreria.ts`, junto a la tabla que lo usa. Se
 * muda aqui —y aquel modulo lo re-exporta, asi que ningun importador cambia— porque desde
 * esta feature es tambien el tipo de un campo de `WalletMovimientoDTO` (R31): dejarlo alli
 * obligaria a `lib/types/` a importar de `lib/utils/`, invirtiendo la direccion de la
 * dependencia. La clasificacion en si (`NATURALEZA_POR_CATEGORIA`) NO se mueve.
 */
export type NaturalezaMovimiento = "propio" | "terceros";

// ── Contratos I/O (frontera Server Action -> cliente). Montos SIEMPRE STRING (R4/R25) ──

export type WalletMovimientoDTO = {
  id: string;
  tipo: WalletMovimientoTipo;
  categoria: WalletMovimientoCategoria;
  monto: string; // Decimal -> STRING 2 dec (R4/R25)
  origenTipo: WalletOrigenTipo;
  origenId: string | null;
  descripcion: string | null;
  registradoPor: string | null;
  fechaMovimiento: string; // ISO
  /**
   * Feature 231 (R31/R32) — de quien es este dinero, derivado EN EL SERVIDOR a partir de la
   * categoria y del unico `Record` que la clasifica. El cliente no lo deduce (R36): asi la
   * tabla y la descarga no pueden decir cosas distintas.
   */
  dueno: NaturalezaMovimiento;
};

export type WalletBalanceSigno = "positivo" | "negativo" | "cero";

export type WalletBalanceDTO = {
  ingresos: string; // STRING 2 dec
  egresos: string; // STRING 2 dec
  balance: string; // STRING 2 dec (puede venir "-123.45")
  signo: WalletBalanceSigno;
};

export type ListarMovimientosResult = {
  movimientos: WalletMovimientoDTO[];
  total: number;
  page: number;
  pageSize: number;
};

// ── Feature 173 — la caja en modo TESORERIA: DOS cifras, un solo libro ──

// design §5.1 — fila del agregado `groupBy(categoria, tipo) + SUM(monto)` del libro de la
// caja, con los MISMOS filtros del listado (R8). Es la ENTRADA de `derivarCaja`: la
// derivacion es PURA (R10) y no conoce ni el repositorio ni la base.
export interface AgregadoCajaRow {
  categoria: WalletMovimientoCategoria;
  tipo: WalletMovimientoTipo;
  total: string; // STRING escala 2 (money-safe)
}

// design §5.2 — las DOS cifras que sustituyen al «Balance general», ya derivadas en el
// SERVIDOR (R64: el navegador no recalcula dinero). Montos SIEMPRE STRING escala 2 (R7).
//
//  - `enCaja`   = entradas - salidas, sin distinguir de quien es el dinero (R4).
//  - `ganancia` = ingresos propios - egresos propios (R5). Es, numero por numero, lo que hoy
//                 se rotula «Balance general»: no cambia de valor, cambia de nombre.
//  - `deTerceros` [P6] = la diferencia entre ambas. NO es la deuda con las tiendas (R34): es
//                 MAYOR, porque de ese dinero Ordenex aun descuenta flete, comision e IVA.
export type CajaResumenDTO = {
  entradas: string;
  salidas: string;
  enCaja: string;
  signoEnCaja: WalletBalanceSigno;
  ingresosPropios: string;
  egresosPropios: string;
  ganancia: string;
  signoGanancia: WalletBalanceSigno;
  deTerceros: string;
  // [P7]: con filtros puestos, «Dinero en caja» ya no es el dinero que hay sino el neto del
  // periodo. El numero NO cambia; lo que cambia es el rotulo, y esta bandera es lo unico que
  // la pantalla necesita para no mentir.
  periodoFiltrado: boolean;
  /**
   * Feature 231 (R9/R10) — porcion de las TIENDAS sobre el total de la caja, "0.00"–"100.00".
   *
   * STRING plano y no un numero (D3, firmada): `tests/integration/wallet-page.test.tsx` barre
   * `Object.entries(props.resumen)` exigiendo STRING en todo salvo `periodoFiltrado`, y sobre
   * todo el navegador tiene PROHIBIDO convertir un importe a numero (R12). Solo es una
   * proporcion de reparto cuando `modoComposicion` vale `dos_bolsillos`.
   */
  porcentajeTiendas: string;
  /**
   * Feature 231 (R14/R21) — que forma admite la barra de composicion. Lo decide el SERVIDOR
   * comparando los DOS importes derivados; la pantalla no compara nada.
   */
  modoComposicion: ModoComposicionCaja;
};

// Feature 231 (design §3.1) — los CUATRO estados posibles del reparto de la caja. Seed
// primero para que la pantalla pueda montar un `Record` TOTAL sobre ellos (design §4.2): un
// modo nuevo rompe el build en vez de caer en un `default` silencioso.
export const MODO_COMPOSICION_CAJA_SEED = [
  "dos_bolsillos", // R19: hay algo de los dos lados y la barra se parte
  "solo_tiendas", // R15: Ordenex esta en perdida y el dinero de las tiendas cubre el saldo
  "solo_ordenex", // R17: el espejo — `deTerceros` negativo (D4, firmada)
  "sin_reparto", // R18: no hay nada que repartir
] as const;

export type ModoComposicionCaja = (typeof MODO_COMPOSICION_CAJA_SEED)[number];

/**
 * Feature 231 (design §2.2, R22-R28) — la ganancia de Ordenex abierta concepto por concepto.
 *
 * Viaja HERMANO de `CajaResumenDTO` y no anidado dentro (D3): el barrido de STRING de la 173
 * sobre el resumen sigue afirmando exactamente lo que afirma hoy, sin ampliar excepciones.
 * Money-safe: todos los importes son STRING escala 2.
 */
export type ComposicionGananciaDTO = {
  /** Un importe por categoria de ingreso propio. `Record` TOTAL: no admite huecos (R23). */
  ingresos: Record<WalletIngresoPropio, string>;
  /** Σ de `ingresos`. Identico, importe a importe, a `CajaResumenDTO.ingresosPropios` (R23). */
  totalIngresos: string;
  /**
   * Ficha 339 (T1.3, R1/R2/R4) — un importe por egreso propio CON FILA que no viene ya en
   * `DesgloseEgresosDTO`: hoy el pago al mensajero y el ajuste. `Record` TOTAL, sin huecos.
   *
   * Va tecleado POR CATEGORIA y no como dos campos camelCase sueltos por tres motivos: (a) la
   * pantalla construye sus filas recorriendo el seed, igual que hace ya la columna de ingresos;
   * (b) un concepto nuevo entra anadiendo una entrada al seed, sin tocar este DTO; (c)
   * `caja-173-alcance.guardia.test.ts` prohibe que `lib/utils/caja-tesoreria.ts` nombre claves
   * camelCase de formulas, y el docstring de ese modulo ya dice «se teclea POR CATEGORIA».
   */
  egresos: Record<WalletEgresoNombrado, string>;
  /**
   * Egresos propios que NO tienen fila propia (D2 de la 231; ficha 339: el conjunto contra el
   * que se complementa pasa de `WALLET_EGRESO_DESGLOSADO_SEED` a `WALLET_EGRESO_CON_FILA_SEED`).
   * Se deriva por COMPLEMENTO, no por lista, para que la columna de la tarjeta siga sumando
   * `egresosPropios` aunque el catalogo gane un egreso propio (R26 de la 231, R11 de la 339).
   */
  otrosEgresos: string;
  /** Σ de egresos propios. Identico a `CajaResumenDTO.egresosPropios` (R26). */
  totalEgresos: string;
  /**
   * Ficha 339 (T1.3, R9) — si la fila «Otros gastos de Ordenex» tiene algo que ensenar.
   *
   * Lo decide el SERVIDOR y no el navegador: comparar `otrosEgresos !== "0.00"` en el cliente
   * abriria una segunda definicion de «esto esta en cero» en el lado que tiene PROHIBIDO juzgar
   * dinero, y dependeria de que el formato canonico nunca produjera `"-0.00"`. Se deriva con
   * `!otrosEgresos.isZero()` —y no con `.gt(0)`— porque un importe negativo es precisamente lo
   * que mas falta haria ver, y `.gt(0)` lo esconderia.
   */
  hayOtrosEgresos: boolean;
};

// Feature 45 (R11) — desglose de egresos administrativos por tipo para el conjunto
// filtrado. Derivado por agregacion (no almacenado). Montos SIEMPRE STRING (R12).
// Feature 158 (R32): + `indemnizacion` como fila PROPIA y sumada al total. El desglose deja de
// ser solo de egresos "administrativos": la indemnizacion es operativa.
export type DesgloseEgresosDTO = {
  gastoFijo: string; // total egreso_gasto_fijo
  gastoVariable: string; // total egreso_gasto_variable
  sueldo: string; // total egreso_sueldo
  indemnizacion: string; // total egreso_indemnizacion (feature 158/R32)
  total: string; // suma de los cuatro
};

// ── Schemas zod de borde ──

// Un monto de dinero como STRING con hasta 2 decimales, > 0 (R2/R15; feature 45 R4/R24).
// Se valida como STRING (nunca number) para no perder precision en la frontera
// money-critical. Se EXPORTA para reutilizarlo en los schemas de la feature 45 (egresos
// administrativos y plantillas de gasto fijo).
export const montoPositivoSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "El monto debe ser un numero con hasta 2 decimales.")
  // Money-safe: comparacion con Prisma.Decimal (nunca parseFloat/Number sobre montos). Zod v4
  // corre este refine AUNQUE el regex ya haya fallado (p. ej. monto vacio/no numerico), y
  // `new Prisma.Decimal("")` lanza -> el borde veria un error INTERNAL en vez de validation.
  // Se blinda con try/catch: un formato invalido devuelve false (su propio issue) y el regex
  // emite el suyo -> ZodError limpio -> validation_error (R4: vacio/no numerico se rechaza).
  .refine((v) => {
    try {
      return new Prisma.Decimal(v).gt(0);
    } catch {
      return false;
    }
  }, "El monto debe ser mayor que 0.");

// ── Ficha 334 — la FECHA del movimiento manual (R19/R20/R21) ──

/** La forma `YYYY-MM-DD`. Se declara una vez: la usan el regex del schema y su superRefine. */
const FORMATO_FECHA_CALENDARIO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Ficha 334 — el dia calendario de Costa Rica MAS ANTIGUO que admite un movimiento manual.
 *
 * `ultimosNDiasCalendarioCR` cuenta N dias calendario INCLUIDO hoy, asi que la ventana de
 * `DIAS_HACIA_ATRAS` dias hacia atras son esos dias MAS el de hoy: de ahi el `+ 1`. Se deriva
 * de la config (`lib/config/wallet-movimiento.ts`) y no de un literal, porque es una cota de
 * negocio (docs/architecture.md).
 */
export function primerDiaMovimientoAdmisible(now: Date = new Date()): string {
  return ultimosNDiasCalendarioCR(walletMovimientoConfig.DIAS_HACIA_ATRAS + 1, now).desde;
}

/**
 * Que le pasa a `value` como fecha de un movimiento manual, o `null` si no le pasa nada.
 *
 * Devuelve el MOTIVO y no un booleano porque los tres rechazos son distintos y el dialogo los
 * pinta bajo el mismo campo: «no existe», «es del futuro» y «se sale de la ventana» no se
 * arreglan igual. Las dos piezas comunes salen de `lib/utils/fecha-cr.ts` — el ROUND-TRIP, que
 * es lo unico que caza `2026-02-31` (un dia desbordado RUEDA al mes siguiente en vez de dar
 * `Invalid Date`), y el dia calendario CR sin off-by-one, que es lo unico que impide que a las
 * 20:00 de Costa Rica «hoy» sea ya el dia siguiente.
 */
export function problemaDeFechaMovimiento(value: string, now: Date = new Date()): string | null {
  if (!esFechaCalendarioValida(value)) return "Esa fecha no existe en el calendario.";
  if (value > fechaCalendarioCR(now)) return "La fecha no puede ser posterior a hoy."; // R20
  const primerDia = primerDiaMovimientoAdmisible(now);
  if (value < primerDia) return `No se admiten movimientos anteriores al ${primerDia}.`;
  return null;
}

/** Dia calendario `YYYY-MM-DD` existente y dentro de la ventana admisible (R19/R20/R21). */
export function esFechaMovimientoValida(value: string, now: Date = new Date()): boolean {
  return problemaDeFechaMovimiento(value, now) === null;
}

export const fechaMovimientoSchema = z
  .string()
  .regex(FORMATO_FECHA_CALENDARIO, "La fecha debe tener el formato YYYY-MM-DD.")
  .superRefine((v, ctx) => {
    // Zod v4 corre los refines AUNQUE el regex ya haya fallado (lo mismo que documenta
    // `montoPositivoSchema` aqui arriba). Sin esta salida temprana, `29-08-2026` emitiria DOS
    // mensajes bajo el mismo campo diciendo la misma cosa.
    if (!FORMATO_FECHA_CALENDARIO.test(v)) return;
    const problema = problemaDeFechaMovimiento(v);
    if (problema !== null) ctx.addIssue({ code: "custom", message: problema });
  });

// Manual (R15/F1.4-Q6): ingreso/egreso de AJUSTE, descripcion obligatoria, monto > 0.
// Solo las categorias de ajuste; el tipo debe casar con la categoria (ingreso<->ingreso_ajuste).
// Ficha 334 (R19/R22/R23): + `fecha` OPCIONAL. Ausente ⇒ el movimiento se fecha con el instante
// del registro, byte a byte como hasta hoy; ese es todo el coste de la ampliacion.
export const registrarMovimientoManualSchema = z
  .object({
    tipo: z.enum(WALLET_MOVIMIENTO_TIPO_SEED),
    categoria: z.enum(["ingreso_ajuste", "egreso_ajuste"] as const),
    monto: montoPositivoSchema,
    descripcion: z.string().trim().min(1, "La descripcion es obligatoria."),
    fecha: fechaMovimientoSchema.optional(),
  })
  .refine(
    (v) =>
      (v.tipo === "ingreso" && v.categoria === "ingreso_ajuste") ||
      (v.tipo === "egreso" && v.categoria === "egreso_ajuste"),
    { message: "La categoria de ajuste no corresponde al tipo.", path: ["categoria"] },
  );

export type RegistrarMovimientoManualInput = z.infer<typeof registrarMovimientoManualSchema>;

// Listado (R20): paginado acotado + filtros opcionales tipo/categoria/rango de fechas.
export const listarMovimientosSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  tipo: z.enum(WALLET_MOVIMIENTO_TIPO_SEED).optional(),
  categoria: z.enum(WALLET_MOVIMIENTO_CATEGORIA_SEED).optional(),
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
});

export type ListarMovimientosInput = z.infer<typeof listarMovimientosSchema>;

// Feature 170 (T C.1) — entrada del modo SIN paginacion del LIBRO DE CAJA (descarga del
// dataset completo). Derivada del schema del listado quitando `page`/`pageSize` (molde: la
// 151 con `listarOrdenesCompletoSchema`), para que el modo completo no pueda aceptar una
// entrada que el listado paginado rechazaria y para que ambos resuelvan los MISMOS filtros.
// `.strict()`: una clave desconocida es `validation_error` sin devolver fila alguna (R18).
export const listarMovimientosCompletoSchema = listarMovimientosSchema
  .omit({ page: true, pageSize: true })
  .strict();

export type ListarMovimientosCompletoInput = z.infer<typeof listarMovimientosCompletoSchema>;

/**
 * Ficha 339 (T1.4, design §4.1 — R20/R29/R32) — entrada del DETALLE de una fila de la tarjeta.
 *
 * Se DERIVA del schema del listado y no se copia: asi `tipo`, `categoria`, `desde` y `hasta` son
 * por construccion los MISMOS filtros que el libro (R20 — el detalle y el importe de la fila
 * hablan siempre del mismo conjunto), y el dia que el libro gane un filtro lo gana el detalle
 * solo. Es el precedente literal de `listarMovimientosCompletoSchema` (ficha 170).
 *
 * `page`/`pageSize` se REDECLARAN porque los del listado llevan literales (`max(100).default(20)`)
 * y R29 exige que el tope y el tamano salgan de configuracion. Un `pageSize` por encima del tope
 * es `validation_error` y NO devuelve ni una fila (R32).
 *
 * `fila` es un TOKEN del catalogo de filas, nunca una lista de categorias (design §10-A1): el
 * complemento de «Otros» lo resuelve el SERVIDOR con la misma definicion que deriva el importe.
 */
export const listarMovimientosDeFilaSchema = listarMovimientosSchema
  .omit({ page: true, pageSize: true })
  .extend({
    fila: z.enum(COMPOSICION_FILA_SEED),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(composicionDetalleConfig.MAX_PAGE_SIZE)
      .default(composicionDetalleConfig.DEFAULT_PAGE_SIZE),
  });

export type ListarMovimientosDeFilaInput = z.infer<typeof listarMovimientosDeFilaSchema>;

// Feature 170 (T C.2): resultado del modo completo en el BORDE. `limite_excedido` lleva
// SOLO conteos (R27) y ninguna rama de error viaja con filas (R16/R17/R18). Money-safe: los
// montos siguen siendo STRING dentro del DTO.
export type ListarMovimientosCompletoResult = ListarCompletoResult<WalletMovimientoDTO>;

// ── Feature 45 — egresos administrativos (manual) + reversa ──

// Los DOS tipos de egreso administrativo que se registran A MANO (R2/R19). El gasto FIJO
// NO entra aqui: lo EMITE el cron mensual (R27), no el formulario manual.
export const TIPO_EGRESO_MANUAL_SEED = ["gasto_variable", "sueldo"] as const;
export type TipoEgresoManual = (typeof TIPO_EGRESO_MANUAL_SEED)[number];

// Mapa tipo de egreso manual -> categoria del libro (R2). Se reutiliza `egreso_sueldo`
// (existente en la 42) para el sueldo; `egreso_gasto_variable` (nuevo, R21) para el gasto
// variable. `gasto_fijo` NO se mapea aqui (lo emite el cron con `egreso_gasto_fijo`).
export const TIPO_EGRESO_MANUAL_A_CATEGORIA = {
  gasto_variable: "egreso_gasto_variable",
  sueldo: "egreso_sueldo",
} as const satisfies Record<TipoEgresoManual, WalletMovimientoCategoria>;

// R2/R4/R5/R19 (borde): egreso manual = tipo del conjunto {gasto_variable, sueldo}, monto
// STRING > 0 con hasta 2 decimales, descripcion no vacia. `gasto_fijo` u otro valor cae
// fuera del enum -> ZodError -> validation_error (R19).
// Ficha 334 (R19/R22/R23): + `fecha` OPCIONAL, la MISMA pieza que el ajuste manual. El
// `z.enum(TIPO_EGRESO_MANUAL_SEED)` NO se toca: es el tercero de los cuatro sitios donde vive
// la regla «el gasto FIJO no se registra a mano» (R11, heredada del R19 de la ficha 45).
export const registrarEgresoAdministrativoSchema = z.object({
  tipoEgreso: z.enum(TIPO_EGRESO_MANUAL_SEED),
  monto: montoPositivoSchema,
  descripcion: z.string().trim().min(1, "La descripcion es obligatoria."),
  fecha: fechaMovimientoSchema.optional(),
});

export type RegistrarEgresoAdministrativoInput = z.infer<
  typeof registrarEgresoAdministrativoSchema
>;

// R13: reversa de un egreso administrativo por su id (el monto se lee server-side, no lo
// provee el cliente).
export const reversarEgresoSchema = z.object({ movimientoId: z.string().uuid() });

export type ReversarEgresoInput = z.infer<typeof reversarEgresoSchema>;
