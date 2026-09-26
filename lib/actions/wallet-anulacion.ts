"use server";

import { getPrismaClient } from "@/lib/db/prisma-client";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { withErrorHandler, isAppErrorShape, UnauthenticatedError } from "@/lib/errors";
import type { AppErrorShape } from "@/lib/errors";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IEgresoCajaAnulacionService } from "@/lib/interfaces/services/IEgresoCajaAnulacionService";
import type { IWalletAnulacionService } from "@/lib/interfaces/services/IWalletAnulacionService";
import { AjusteCajaAnulacionRepository } from "@/lib/repositories/AjusteCajaAnulacionRepository";
import { WalletAnulacionDestinoRepository } from "@/lib/repositories/WalletAnulacionDestinoRepository";
import { WalletMovimientoRepository } from "@/lib/repositories/WalletMovimientoRepository";
import { EgresoCajaAnulacionService } from "@/lib/services/EgresoCajaAnulacionService";
import { WalletAnulacionService } from "@/lib/services/WalletAnulacionService";
import {
  anularEgresoCajaSchema,
  anularMovimientoSchema,
  type AnularEgresoCajaResult,
  type AnularMovimientoResult,
  type CaminoAnulacion,
  type MotivoNoAnulable,
} from "@/lib/types/wallet-anulacion";
import { anularAbonoTiendaAction } from "@/lib/actions/abono-tienda";
import { anularAporteCapitalAction } from "@/lib/actions/aporte-capital";
import { anularPagoAction } from "@/lib/actions/liquidacion";
import { anularPagoPorCuentaTiendaAction } from "@/lib/actions/pago-por-cuenta-tienda";
import { anularPremioAction } from "@/lib/actions/premio-ranking-devengo";
import { anularCobroRechazoTiendaAction } from "@/lib/actions/rechazo-tienda-cobro";
import { anularAjusteCajaAction } from "@/lib/actions/wallet";
import { anularCobroTiendaAction } from "@/lib/actions/wallet-tienda";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 458-B (design §4.2, R63–R73, R82) — LA ANULACION UNIFORME, en el borde.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
//  · `anularEgresoCajaAction` — el camino NUEVO de los egresos sin documento (D13).
//  · `anularMovimientoAction` — la accion UNICA que usara el panel «Ver» (458-C): recibe un DESTINO
//    y un motivo, decide el camino con `WalletAnulacionService` (rol ANTES de leer) y llama a la
//    action que ya existe (172, 293, 459, 461, 457) o a la nueva, con el MISMO actor. La respuesta se
//    normaliza a una sola forma (`AnularMovimientoResult`).
//
// Molde de todas: sesion primero (`UnauthenticatedError` antes de tocar nada), forma despues
// (`.strict()`: ni un monto), el resto lo decide el dominio.

function toAnulacionActionError(
  shape: AppErrorShape,
):
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "unauthenticated" } {
  switch (shape.code) {
    case "VALIDATION_ERROR":
      return {
        status: "validation_error",
        fieldErrors: (shape.details?.fieldErrors as Record<string, string[]> | undefined) ?? {},
      };
    case "UNAUTHORIZED":
      return { status: "unauthenticated" };
    default:
      throw new Error(`wallet-anulacion: AppErrorCode inesperado ${shape.code}`);
  }
}

function buildEgresoService(): IEgresoCajaAnulacionService {
  const prisma = getPrismaClient();
  return new EgresoCajaAnulacionService(
    new WalletMovimientoRepository(prisma),
    new AjusteCajaAnulacionRepository(prisma),
    (fn) => prisma.$transaction((tx) => fn(tx)),
  );
}

function buildRouter(): IWalletAnulacionService {
  return new WalletAnulacionService(new WalletAnulacionDestinoRepository(getPrismaClient()));
}

export interface WalletAnulacionDeps {
  egresos?: IEgresoCajaAnulacionService;
  router?: IWalletAnulacionService;
  getActor?: () => Promise<Actor | null>;
  /** Solo tests: sustituye la action de un camino (con el MISMO actor ya resuelto). */
  caminos?: Partial<Record<CaminoAnulacion, (id: string, motivo: string, actor: Actor) => Promise<ResultadoDeCamino>>>;
}

/**
 * FICHA 458-B (D13, R63–R67) — ANULA con motivo un sueldo, un gasto de Ordenex, un gasto fijo
 * cobrado o una indemnizacion por incidente. Contra-asiento por el monto del original, constancia
 * y historial en UNA transaccion; el segundo intento responde `ya_anulado`.
 *
 * @sin-superficie FICHA 458-B: ninguna pantalla la importa directamente; la llama `anularMovimientoAction` (este mismo archivo), que SI tiene superficie. «Reversar» del libro sigue llamando a `reversarEgresoAdministrativoAction` hasta que la 458-C lo sustituya (D11). Esta anotacion CADUCA con la 458-C.
 */
export async function anularEgresoCajaAction(
  input: unknown,
  deps: WalletAnulacionDeps = {},
): Promise<AnularEgresoCajaResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError(); // antes de evaluar ningun otro dato
    const data = anularEgresoCajaSchema.parse(input); // ZodError -> VALIDATION_ERROR
    const service = deps.egresos ?? buildEgresoService();
    return service.anular(data, actor);
  });
  return isAppErrorShape(r) ? toAnulacionActionError(r) : r;
}

/** Lo que devuelve cualquier camino, visto por el normalizador (solo el estado y el motivo). */
type ResultadoDeCamino = { status: string; motivo?: string };

/** La action REAL de cada camino, con la clave que su schema `.strict()` espera. */
const ACCION_DEL_CAMINO: Record<
  CaminoAnulacion,
  (id: string, motivo: string, actor: Actor) => Promise<ResultadoDeCamino>
> = {
  egreso_caja: (movimientoId, motivo, actor) =>
    anularEgresoCajaAction({ movimientoId, motivo }, { getActor: async () => actor }),
  ajuste_caja: (movimientoId, motivo, actor) =>
    anularAjusteCajaAction({ movimientoId, motivo }, { getActor: async () => actor }),
  cobro_tienda: (cobroId, motivo, actor) =>
    anularCobroTiendaAction({ cobroId, motivo }, { getActor: async () => actor }),
  pago_por_cuenta_tienda: (pagoId, motivo, actor) =>
    anularPagoPorCuentaTiendaAction({ pagoId, motivo }, { getActor: async () => actor }),
  aporte_capital: (aporteId, motivo, actor) =>
    anularAporteCapitalAction({ aporteId, motivo }, { getActor: async () => actor }),
  abono_tienda: (abonoId, motivo, actor) =>
    anularAbonoTiendaAction({ abonoId, motivo }, { getActor: async () => actor }),
  liquidacion_pago: (pagoId, motivo, actor) =>
    anularPagoAction({ pagoId, motivo }, { getActor: async () => actor }),
  rechazo_tienda_cobro: (cobroId, motivo, actor) =>
    anularCobroRechazoTiendaAction({ cobroId, motivo }, { getActor: async () => actor }),
  premio_del_ranking: (filaId, motivo, actor) =>
    anularPremioAction({ filaId, motivo }, { getActor: async () => actor }),
};

const MOTIVOS: readonly MotivoNoAnulable[] = [
  "contra_asiento",
  "nace_de_un_cierre",
  "reclasificado",
  "no_aprobado",
  "sin_linea_de_caja",
  "no_es_anulable",
];

/**
 * Cada camino habla su dialecto (`not_found`, `no_registrado`, …); la pantalla recibe UNO. Un
 * estado que no se reconoce es un fallo de programacion y se lanza: convertirlo en un «ok» o en un
 * «no encontrado» mentiroso esconderia dinero que no se anulo.
 */
function normalizar(camino: CaminoAnulacion, r: ResultadoDeCamino): AnularMovimientoResult {
  switch (r.status) {
    case "ok":
      return { status: "ok", camino };
    case "ya_anulado":
    case "already_reversed":
      return { status: "ya_anulado", camino };
    case "no_encontrado":
    case "not_found":
    case "no_registrado":
      return { status: "no_encontrado" };
    case "no_anulable": {
      const motivo = MOTIVOS.find((m) => m === r.motivo) ?? "no_es_anulable";
      return { status: "no_anulable", motivo };
    }
    case "forbidden":
      return { status: "forbidden" };
    case "unauthenticated":
      return { status: "unauthenticated" };
    case "validation_error":
      return {
        status: "validation_error",
        fieldErrors: ((r as { fieldErrors?: Record<string, string[]> }).fieldErrors ?? {}),
      };
    default:
      throw new Error(`wallet-anulacion: el camino ${camino} respondio un estado inesperado ${r.status}`);
  }
}

/**
 * FICHA 458-B (design §4.2, R63–R73, R82) — la accion UNICA de anular. `{ destino, motivo }`,
 * `.strict()`, sin monto. Sesion → forma → `enrutar` (rol ANTES de leer ninguna fila) → la action del
 * camino con el MISMO actor → respuesta normalizada.
 *
 * Superficie HOY: `DocumentoCajaAcciones` la usa para anular la indemnizacion y el cobro por
 * rechazo desde el libro de la caja. La 458-C la lleva al panel «Ver» y la 458-D a los estados de
 * cuenta.
 */
export async function anularMovimientoAction(
  input: unknown,
  deps: WalletAnulacionDeps = {},
): Promise<AnularMovimientoResult> {
  const r = await withErrorHandler(async () => {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    if (!actor) throw new UnauthenticatedError();
    const data = anularMovimientoSchema.parse(input);
    const router = deps.router ?? buildRouter();
    const ruta = await router.enrutar(data.destino, actor);
    if (ruta.status !== "ruta") return ruta;
    const accion = deps.caminos?.[ruta.camino] ?? ACCION_DEL_CAMINO[ruta.camino];
    return normalizar(ruta.camino, await accion(ruta.id, data.motivo, actor));
  });
  return isAppErrorShape(r) ? toAnulacionActionError(r) : r;
}
