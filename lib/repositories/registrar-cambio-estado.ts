import type {
  CambioEstadoEntrada,
  OrdenHistorialTxClient,
} from "@/lib/interfaces/repositories/IOrdenHistorialRepository";

/**
 * Feature 49 (design §3.1, R6/R7) — CHOKE POINT del append al historial de estados.
 *
 * Funcion PURA reutilizable por los repos que ESCRIBEN `orden.estatus_id`
 * (`OrdenRepository`, `GestionOrdenRepository`, `LiberacionReprogramadaRepository`)
 * sin instanciar `OrdenHistorialRepository`. Inserta el LOTE de transiciones
 * (`createMany`) en el `tx` de la transaccion EN CURSO, garantizando que el cambio de
 * estado y su rastro son atomicos: si una falla, ambas se revierten (R7).
 *
 * REGLA (design §3.3): toda escritura de `orden.estatus_id` DEBE invocar esta funcion en
 * su MISMA transaccion, y SOLO para las ordenes que EFECTIVAMENTE transicionaron (R8).
 * `OrdenHistorialRepository.registrarCambioEstado` delega aqui: hay UN solo punto de
 * append (el inventario cerrado de los 11 call-sites vive en design §2; el test de
 * cobertura T5.2 lo fija como conjunto conocido).
 */
export async function appendCambioEstado(
  tx: OrdenHistorialTxClient,
  entradas: CambioEstadoEntrada[],
): Promise<void> {
  if (entradas.length === 0) return; // no-op: nada que registrar
  await tx.ordenHistorialEstado.createMany({
    data: entradas.map((e) => ({
      ordenId: e.ordenId,
      estatusOrigenId: e.estatusOrigenId, // null = creacion (R1/R20)
      estatusDestinoId: e.estatusDestinoId,
      actorUsuarioId: e.actorUsuarioId, // null = sistema/cron (R21)
      origenTipo: e.origenTipo, // clasificacion (R23)
      motivo: e.motivo ?? null, // de la gestion (R22)
      gestionOrdenId: e.gestionOrdenId ?? null,
    })),
  });
}
