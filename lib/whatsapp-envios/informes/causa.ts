// Fichas 475/476 — el motivo saneado de un fallo de lectura de un informe, compartido por el picking
// y el informe de transito (revision 476, m1).

/**
 * El motivo SANEADO de un fallo de lectura: el nombre de la clase y, si lo trae, el codigo
 * (`P2028`, `40P01`…). Nunca el `message` de la causa: el de Prisma copia la invocacion con sus
 * argumentos. Sin esto, `jobs.last_error` (que guarda solo `error.message`) decia «falló» sin el
 * porque, y el `cause` se perdia en el salto por la cola.
 */
export function detalleDeCausa(cause: unknown): string {
  if (!(cause instanceof Error)) return "error desconocido";
  const codigo = (cause as { code?: unknown }).code;
  return typeof codigo === "string" && /^[A-Za-z0-9_]{1,20}$/.test(codigo) ? `${cause.name} ${codigo}` : cause.name;
}
