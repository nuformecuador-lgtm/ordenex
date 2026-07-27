// Feature 141 (design §3.1) — helper transaccional del LOTE de carga masiva, mismo patron
// que `appendCambioEstado(tx, ...)`: una funcion pura que opera sobre el `tx` de la
// transaccion EN CURSO, para que asegurar el lote y escribir las ordenes sean atomicos (R23).
import { randomUUID } from "crypto";
import type { PrismaClient } from "@prisma/client";
import { CargaLoteAjenoError } from "@/lib/interfaces/repositories/IOrdenRepository";

/** Cara del `tx` que necesita el helper: solo el delegate de `carga`. */
export type CargaTxClient = Pick<PrismaClient, "carga">;

export interface EnsureCargaParams {
  /** id del lote propuesto por el cliente (via sesion) o `null` para generarlo (via API). */
  id: string | null;
  /** `carga.usuario_carga` esperado: el actor de la carga (R2/R20). */
  usuarioCargaId: string;
  /** `carga.total_files`: tamano TOTAL del lote (R7/R18/R21). */
  totalFiles: number;
}

/**
 * Asegura —de forma IDEMPOTENTE— la fila de `carga` del lote dentro de la transaccion en
 * curso y devuelve su id.
 *
 * 1. `id ?? randomUUID()`: la via sesion propone el id (uno por sesion de carga, repetido en
 *    los N chunks); la via API key no lo propone y el repo lo genera una vez por llamada.
 * 2. `createMany([...], skipDuplicates: true)` = `INSERT ... ON CONFLICT (id) DO NOTHING`: el
 *    primer chunk que persiste ordenes crea la fila y los siguientes la reutilizan (R12/R13).
 *    Deliberadamente NO acumula ni reescribe `total_files` (R18): el valor lo fija el INSERT
 *    que gana, y como todos los chunks envian el total de la SESION, el resultado es el mismo
 *    gane el que gane; acumular romperia la idempotencia ante un reintento de red del chunk.
 * 3. Relee el propietario: si el lote es de OTRO usuario lanza `CargaLoteAjenoError`, que el
 *    borde traduce a 403 (R17). La `$transaction` del call-site revierte, asi que la peticion
 *    no crea ninguna orden ni modifica el lote ajeno.
 *
 * El llamador DEBE invocarlo solo cuando el batch tiene al menos una orden por insertar: asi
 * no nacen lotes huerfanos (R15/R24).
 */
export async function ensureCargaEnTx(
  tx: CargaTxClient,
  params: EnsureCargaParams,
): Promise<string> {
  const id = params.id ?? randomUUID();
  await tx.carga.createMany({
    data: [
      {
        id,
        usuarioCarga: params.usuarioCargaId,
        totalFiles: params.totalFiles,
        // `downloadUrl` NO se envia: nace NULL y ninguna ruta de esta feature la escribe (R29).
      },
    ],
    skipDuplicates: true,
  });
  const fila = await tx.carga.findUnique({ where: { id }, select: { usuarioCarga: true } });
  if (fila === null) {
    // Defensivo: el INSERT idempotente acaba de correr en esta misma tx, asi que la fila
    // existe. Se documenta en vez de asumir; si ocurriera, la tx revierte.
    throw new Error(`carga ${id} no encontrada tras asegurarla`);
  }
  if (fila.usuarioCarga !== params.usuarioCargaId) throw new CargaLoteAjenoError(id);
  return id;
}
