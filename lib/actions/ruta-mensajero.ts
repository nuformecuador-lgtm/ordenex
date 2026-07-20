"use server";

import { z } from "zod";

import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RutaResumen } from "@/lib/interfaces/services/IMisAsignacionesService";
import {
  simulacionRutaHabilitada,
  sincronizarRutaSimulado,
} from "@/lib/actions/_ruta-mensajero-simulado";

// TODO(92): EL CUERPO REAL DE ESTA ACTION LO ENTREGA LA FEATURE 92.
// =============================================================================
// La feature 93 (frontend) declara aqui la FIRMA y los RESULTADOS de
// `sincronizarRuta` (design §6.2, R31-R34) por adelantado, porque la 92 esta en
// `spec_ready` con cero commits y el contrato no existe todavia en `dev`. Cuando
// la 92 aterrice, sustituye el cuerpo por:
//   resolveActorFromSession -> rol != "mensajero" -> forbidden (R33)
//   -> zod en el borde (R22) -> OptimizacionRutaService.ejecutar(..., "manual")
//   sincrono -> ok
//
// ESTE PR NO DEBE MERGEARSE ANTES QUE EL DE LA 92. Sin la 92 esta action no
// optimiza nada: devuelve `no_implementado` y el boton queda muerto. El
// simulador de `_ruta-mensajero-simulado.ts` NO lo salva en produccion, porque
// esta fenced a proposito (ver `simulacionRutaHabilitada`).
// =============================================================================

/** R22: la ubicacion del navegador se valida en el borde, en rangos WGS84. */
const ubicacionSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

// Sin `export`: un modulo "use server" solo puede exportar funciones async.
const sincronizarRutaSchema = z.object({
  /** Opcional a proposito (R25): sin permiso de GPS la sync sigue adelante. */
  ubicacion: ubicacionSchema.optional(),
  /**
   * Ids de las ordenes en reparto que la UI esta mostrando. El backend real de
   * la 92 los ignora (lee la ruta de la DB); el simulador los usa para devolver
   * una secuencia reordenada visible.
   */
  ordenIds: z.array(z.string()).optional(),
});

export type SincronizarRutaInput = z.input<typeof sincronizarRutaSchema>;

export type SincronizarRutaResult =
  /** R32: la ruta se recalculo; la UI hace `router.refresh()`. */
  | { status: "ok"; ruta: RutaResumen; secuencia: string[] }
  /** R33: rol distinto de `mensajero`, sin efectos ni llamada al proveedor. */
  | { status: "forbidden" }
  /** R34: segunda pulsacion dentro de `RUTA_SYNC_MIN_INTERVALO_S`. */
  | { status: "conflict"; motivo: string }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  /** TODO(92): unico desenlace posible mientras la 92 no aterrice. */
  | { status: "no_implementado" };

export interface SincronizarRutaDeps {
  getActor?: () => Promise<Actor | null>;
}

/**
 * R31/R32: sincronizacion manual de la ruta del mensajero. Sincrona a proposito
 * (Q5): el modulo no tiene SWR con el que hacer polling.
 */
export async function sincronizarRuta(
  input: SincronizarRutaInput = {},
  deps: SincronizarRutaDeps = {},
): Promise<SincronizarRutaResult> {
  // Candado ANTES de cualquier otra cosa: sin simulacion habilitada esta action
  // no finge que funciona, dice la verdad.
  if (!simulacionRutaHabilitada()) {
    return { status: "no_implementado" };
  }

  const parsed = sincronizarRutaSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "validation_error",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  }

  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) return { status: "forbidden" };

  return sincronizarRutaSimulado({
    rol: actor.rol,
    ubicacion: parsed.data.ubicacion,
    ordenIds: parsed.data.ordenIds ?? [],
  });
}
