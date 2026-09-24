import { vi } from "vitest";

import type { AplicacionGestionesConfig } from "@/lib/interfaces/repositories/ICierresAdminRepository";
import { idEstado } from "@/tests/fixtures/catalogo-estados";

// Feature 239 (T2.1) — el cableado MINIMO que toda suite de `resolverCierre` necesita desde que
// `anclajeDevolucion` es obligatorio en la rama `aprobado`.
//
// El coste de hacerlo obligatorio esta declarado en el design (§3.3) y es este: todos los dobles
// de `resolverCierre` tienen que pasarlo. Se acepta a cambio de que un olvido de cableado en el
// composition root rompa el TYPECHECK en vez de dejar devoluciones congeladas en produccion.
//
// Los ids salen del MISMO catalogo de test que usa la guardia de transiciones
// (`idEstado`), no de literales sueltos: asi el par `(origen, destino)` que el bloque de anclaje
// registra es un par REAL del mapa `TRANSICIONES` y la guardia lo valida de verdad.

// ⏳ 2026-09-23 (FICHA 454, T1.7): el anclaje de la 239 se GENERALIZA a la aplicacion de las cinco
// gestiones al aprobar (`aplicacionGestiones`, obligatorio). Aqui vivia `ANCLAJE_DEVOLUCION`
// (`preEstadoId` = `devolucion_por_confirmar`); el pre-estado muere con la ficha.

/** Config de la APLICACION DE GESTIONES con los ids del catalogo de test. */
export const APLICACION_GESTIONES: AplicacionGestionesConfig = {
  enRepartoId: idEstado("en_reparto"),
  destinoPorResultado: {
    entregada: idEstado("entregada"),
    reprogramada: idEstado("reprogramada"),
    rechazada: idEstado("rechazada"),
    devuelta: idEstado("devuelta"),
    incidente: idEstado("incidente"),
  },
};

/**
 * Doble de `tx.gestionOrden` para las suites que NO miden el anclaje.
 *
 * Devuelve lista vacia: un cierre sin gestiones `devuelta` deja el bloque en no-op sin ninguna
 * consulta extra, que es exactamente lo que esas suites necesitan (y lo que afirma su propio
 * caso «cierre sin devoluciones = cero consultas extra» en
 * `cierres-admin-anclaje-devolucion.test.ts`).
 *
 * NO es un atajo que esconda la escritura nueva: la suite que SI la mide la monta con datos.
 */
export function gestionOrdenSinDevoluciones() {
  return { findMany: vi.fn().mockResolvedValue([]) };
}
