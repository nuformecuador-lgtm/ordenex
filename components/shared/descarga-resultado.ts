/**
 * Feature 170 (T0.2, design §3) — adaptadores de CLIENTE entre el dato de un listado y el
 * contrato de descarga del `DataTable` (`DescargaFilasResult`).
 *
 * Por qué existe: la 151 dejó este bloque INLINE dentro de `OrdenesModule` (:378-403). La
 * 170 cablea 24 tablas más; copiado 24 veces, el bloque diverge (una tabla se salta el
 * tope, otra redacta el mensaje del límite de otra forma, otra deja pasar filas junto a un
 * error). Aquí vive una sola vez y `OrdenesModule` lo consume igual que las demás (T0.3),
 * para que no queden dos caminos.
 *
 * Módulo sin React y sin DOM: solo traduce datos. Vive en `components/shared/` —y no en
 * `lib/`— porque su salida es el contrato de un componente (`DescargaFilasResult`), igual
 * que `descargar-blob.ts`.
 */
import type { DescargaFilasResult } from "@/components/shared/DataTable";
import { descargaConfig } from "@/lib/config/descarga";
import type { DescargaFila } from "@/lib/types/descarga";
import type { ListarCompletoResult } from "@/lib/types/descarga-listado";
import { messageFromActionError } from "@/lib/utils/action-error-message";

/**
 * R20 — Mensaje ACCIONABLE del tope: dice el total encontrado, el tope vigente y qué
 * hacer (acotar los filtros). Solo lleva conteos, nunca PII. El tope lo decide y lo
 * aplica el SERVICIO; aquí solo se redacta lo que devolvió.
 *
 * Feature 170 (T0.2): PROMOVIDO tal cual desde `OrdenesModule.tsx:82-84`, sin editar el
 * texto. Las 25 tablas dicen lo mismo porque leen de aquí.
 */
export function mensajeLimite(total: number, limite: number): string {
  return `La descarga supera el máximo de ${limite} filas (hay ${total}). Acota los filtros —por ejemplo, el rango de fechas o el estado— y vuelve a intentarlo.`;
}

// R27 — Cola accionable del resto de fallos: el mensaje canónico del error dice QUÉ
// pasó; esto dice qué hacer a continuación.
//
// Feature 170 (T0.2): PROMOVIDO tal cual desde `OrdenesModule.tsx:88`.
export const SUFIJO_REINTENTO = "Vuelve a intentarlo; el listado no cambió.";

/**
 * FAMILIA A (la página visible es un recorte server-side): traduce el resultado de la
 * Server Action del dataset completo a filas de export.
 *
 * Admite la PROMESA sin resolver para que el cableado de cada tabla sea una línea
 * (`obtenerFilas: () => filasDesdeResultado(listarXCompleto(filtros), filaX)`), que es la
 * forma del design §5.
 *
 * - `limite_excedido` ⇒ error accionable con total y tope, y NINGUNA fila (R27).
 * - cualquier `ActionError` ⇒ mensaje canónico + qué hacer, sin datos personales (R36).
 * - `ok` ⇒ una fila por elemento, EN EL MISMO ORDEN que devolvió el servidor (R11). El
 *   dataset vacío se devuelve tal cual (`filas: []`): quien avisa «no hay datos que
 *   descargar» sin producir archivo es el control (R31).
 */
export async function filasDesdeResultado<T>(
  resultado: ListarCompletoResult<T> | Promise<ListarCompletoResult<T>>,
  proyectar: (item: T) => DescargaFila,
): Promise<DescargaFilasResult> {
  const res = await resultado;
  if (res.status === "limite_excedido") {
    return { status: "error", mensaje: mensajeLimite(res.total, res.limite) };
  }
  if (res.status !== "ok") {
    return {
      status: "error",
      mensaje: `${messageFromActionError(res)} ${SUFIJO_REINTENTO}`,
    };
  }
  return { status: "ok", filas: res.items.map(proyectar) };
}

/**
 * FAMILIA B (el dataset completo ya está en el cliente): proyecta a filas de export el
 * MISMO array que la tabla está pintando, después de los filtros de cliente que esa
 * pantalla aplique (R10), y sin releer nada del servidor (R30/R32).
 *
 * El tope se aplica igual que en Familia A: superarlo NO produce archivo y devuelve el
 * mismo mensaje accionable (R26/R27). Nunca trunca: o están todas las filas o no hay
 * archivo (R28).
 *
 * `descargaConfig.MAX_FILAS` es el tope ÚNICO de la app (P5). En el navegador
 * `DESCARGA_MAX_FILAS` no está definido (Next solo expone `NEXT_PUBLIC_*`), así que aquí
 * rige el default de 5000 de `lib/config/descarga.ts`; se lee de la config y no de un
 * literal para que el día que ese tope cambie no haya un segundo número que actualizar.
 *
 * Es `async` aunque no espere nada: `obtenerFilas` devuelve una promesa, y así el cableado
 * de cada tabla es la misma línea que en Familia A.
 */
export async function filasLocales<T>(
  filas: readonly T[],
  proyectar: (item: T) => DescargaFila,
): Promise<DescargaFilasResult> {
  const limite = descargaConfig.MAX_FILAS;
  if (filas.length > limite) {
    return { status: "error", mensaje: mensajeLimite(filas.length, limite) };
  }
  return { status: "ok", filas: filas.map(proyectar) };
}

/*
 * FAMILIA B **PAGINADA** — `filasDelConjuntoCompleto`, RETIRADO por la feature 184 (T H.2).
 *
 * Qué era y por qué existió: la 170 — FASE 2 (T I.2, R52) paginó trece listados de Familia B.
 * Al paginar una tabla así, `filasLocales(loQueLaTablaPinta)` deja de significar «el dataset» y
 * pasa a significar «lo que se ve» —un archivo de 25 filas de 300, sin fallar en ninguna
 * parte—, así que el conjunto se **releía** del servidor al pulsar el control: el mismo listado
 * SIN recorte que la pantalla ya llamaba antes de paginar. Era un puente, y estaba declarado
 * como tal (Q-I5/Q-K4).
 *
 * Por qué se retira: los doce listados que quedaban migraron en las tandas A–G a una lectura
 * DEDICADA con su tope en el SERVIDOR, y ese camino es `filasDesdeResultado`. Con cero llamadas
 * en `app/`, dejarlo exportado no era neutro: mantenía vivo el modo de fallo que la tanda G
 * midió como el único que sobrevivía a todo lo demás —la **media migración**, una pantalla que
 * llama a la acción nueva y aun así evalúa el tope en el CLIENTE, con lo que el aviso pierde el
 * total y el tope y deja de ser accionable (R6)—. Sin este adaptador, esa media migración deja
 * de ser posible por construcción y no por vigilancia.
 *
 * Lo que sigue vigilándolo, para que retirarlo no apague nada:
 *  - `tests/unit/descarga/adaptador-conjunto.guardia.test.ts` (R32) — ni el export vuelve ni
 *    ninguna pantalla lo llama;
 *  - la MITAD NEGATIVA de los dos censos de adaptador, conservada a propósito: si alguien lo
 *    rescatara del historial, dice CUÁL de los trece volvió a él.
 */
