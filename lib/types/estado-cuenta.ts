import { z } from "zod";

import { estadoCuentaConfig } from "@/lib/config/estado-cuenta";
import { diaCalendarioSchema } from "@/lib/types/filtro-dias-cr";
import type { DestinoMovimiento } from "@/lib/types/wallet-anulacion";
import { CHIPS_BODEGA, CHIPS_MENSAJERO, CHIPS_TIENDA, type ChipEstadoCuenta } from "@/lib/utils/estado-cuenta-chips";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-B (design §3.2/§6, R16–R25, R81) — EL ESTADO DE CUENTA de una tienda, un mensajero o una
// bodega satelite: contratos de borde.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Montos SIEMPRE STRING escala 2 (R90); fechas `YYYY-MM-DD` del calendario de Costa Rica (R16) con las
// piezas de la 461 (`diaCalendarioSchema`; el servicio convierte con `inicioDelDiaCREnUtc` /
// `inicioDelDiaSiguienteCREnUtc`: `desde` inclusivo, `hasta` cota exclusiva del dia siguiente).
//
// LOS IDENTIFICADORES VIAJAN Y NO SE PINTAN (H6/D1): `cuenta.id`, `ref` y `consolidacionId` son la
// direccion del dato. Los NOMBRES de concepto y origen NO van aqui: la fila lleva `categoria` y
// `origenTipo` y la pantalla los rotula con los diccionarios de la 461 (una sola fuente de textos).

export const TIPOS_DE_CUENTA = ["tienda", "mensajero", "bodega"] as const;
export type TipoDeCuenta = (typeof TIPOS_DE_CUENTA)[number];

const CHIPS = [...new Set<string>([...CHIPS_TIENDA, ...CHIPS_MENSAJERO, ...CHIPS_BODEGA])] as [
  ChipEstadoCuenta,
  ...ChipEstadoCuenta[],
];

export const estadoCuentaSchema = z
  .object({
    cuenta: z.object({ tipo: z.enum(TIPOS_DE_CUENTA), id: z.string().uuid() }).strict(),
    desde: diaCalendarioSchema.optional(),
    hasta: diaCalendarioSchema.optional(),
    /** Ausente = «Todo». Un chip que no es de ESE tipo de cuenta lo rechaza el servicio (`validation_error`). */
    chip: z.enum(CHIPS).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(estadoCuentaConfig.MAX_PAGE_SIZE).default(estadoCuentaConfig.PAGE_SIZE),
  })
  .strict()
  .refine((v) => v.desde === undefined || v.hasta === undefined || v.desde <= v.hasta, {
    message: "«Desde» no puede ser posterior a «hasta».",
    path: ["hasta"],
  });

export type EstadoCuentaInput = z.infer<typeof estadoCuentaSchema>;

/** Quien le debe a quien (R18). La pantalla compone la frase con sus textos. */
export type SentidoDelSaldo =
  | "ordenex_debe" // saldo a favor del titular (tienda / mensajero)
  | "cuenta_debe" // la tienda le debe a Ordenex (saldo en contra)
  | "por_entregar" // la bodega tiene efectivo por entregar
  | "en_cero";

/** R57 — quien registro la fila: una persona, o una accion automatica (con quien la decidio). */
export interface RegistroDTO {
  nombre: string | null;
  automatico: {
    accion: "aprobacion_cierre" | "plantilla_gasto_fijo" | "cobro_por_rechazo" | "incidente" | "premio_del_ranking" | "sistema";
    por: string | null;
  } | null;
}

/** R25/R71/R72 — la anulacion de una fila ORIGINAL, decidida en el servidor. */
export interface AnulacionDeFilaDTO {
  /** `null` = anulada por una via de antes de la 458 sin constancia («motivo no registrado», R72). */
  motivo: string | null;
  por: string | null;
  /** Dia CR de la anulacion. */
  fecha: string | null;
}

export interface FilaEstadoCuentaDTO {
  /** El destino para «Ver» / «Anular…» / comprobante. `null` en las filas de una bodega. */
  ref: DestinoMovimiento | null;
  /** Solo bodega: la consolidacion (marcar/desmarcar recibido). Viaja, no se pinta. */
  consolidacionId: string | null;
  /** Dia CR del movimiento (R16). */
  fecha: string;
  categoria: string;
  origenTipo: string;
  /** Descripcion / motivo del movimiento, tal como se guardo (texto libre). */
  descripcion: string | null;
  registro: RegistroDTO;
  /** En contra del titular, o `null`. STRING escala 2. */
  cargo: string | null;
  /** A favor del titular, o `null`. STRING escala 2. */
  abono: string | null;
  /** R21 — el saldo de la cuenta COMPLETA inmediatamente despues de esta fila, sea cual sea el chip. */
  saldoCorrido: string;
  chip: ChipEstadoCuenta;
  anulacion: AnulacionDeFilaDTO | null;
  esContraAsiento: boolean;
  tieneComprobante: boolean;
  /** R65 — se ofrece «Anular…» (original, vigente y no nacida de un cierre). */
  anulable: boolean;
  naceDeUnCierre: boolean;
}

export interface EstadoCuentaDTO {
  cuenta: { tipo: TipoDeCuenta; id: string; nombre: string };
  /** R18 — el saldo HOY de la cuenta entera (sin periodo), con su signo y su sentido. */
  saldoActual: string;
  signo: "positivo" | "negativo" | "cero";
  sentido: SentidoDelSaldo;
  /** R20 — el saldo al terminar el dia CR anterior a `desde` ("0.00" sin `desde`). */
  saldoInicial: string;
  /** D3 — abonos y cargos del periodo SIN los pares anulados dentro del periodo. */
  abonos: string;
  cargos: string;
  /** R22 — saldoInicial ± abonos/cargos: el saldo al terminar el periodo. */
  saldoFinal: string;
  filas: FilaEstadoCuentaDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export type VerEstadoCuentaResult =
  | { status: "ok"; estado: EstadoCuentaDTO }
  | { status: "no_encontrado" }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" };
