import { vi, type Mock } from "vitest";

// FICHA 362 — EL DOBLE DEL REGISTRO DE ACCIONES para los tests de repositorio que usan un cliente
// Prisma falso.
//
// POR QUE EXISTE. Los 42 puntos de escritura instrumentados por esta ficha pasaron a correr dentro
// de `prisma.$transaction(...)` y a llamar a `appendAccion` con ese `tx`. Un doble de Prisma que no
// tenga `$transaction` ni `historialAccion` revienta con «$transaction is not a function» en cada
// uno de esos tests, y ese rojo no dice nada del codigo que el test vino a comprobar.
//
// QUE HACE, Y QUE NO. Ensancha el doble que ya existia con TRES cosas y ni una mas:
//   - `$transaction(fn)` como PASO A TRAVES: llama a `fn` con el MISMO doble. NO simula
//     atomicidad — la atomicidad se mide contra Postgres real
//     (`tests/integration/db/historial-accion-atomicidad.test.ts`), porque «una imposibilidad
//     razonada no es medida»;
//   - `historialAccion.createMany`, para poder afirmar QUE se registro sin abrir una base;
//   - `usuario.findUnique`, que es lo que `resolverActorCongelado` consulta para congelar el
//     nombre y el rol. Devuelve un actor por defecto para que el camino no se caiga.
//
// Los dobles NO prueban el `WHERE` y este archivo no pretende lo contrario: en este repo esta
// medido que una mutacion del `WHERE` pasa en verde con dobles.

/** El actor que el doble devuelve por defecto cuando alguien congela un actor. */
export const ACTOR_DOBLE = {
  nombre: "Fulano",
  primerApellido: "De Tal",
  rol: { value: "maestro" as const },
};

export interface DobleDeRegistro {
  historialAccion: { createMany: Mock };
  $transaction: Mock;
  usuario: { findUnique: Mock };
}

/**
 * Ensancha un doble de Prisma con lo que el registro de acciones necesita. Devuelve EL MISMO
 * objeto (mutado), para que las aserciones que el test ya tenia sobre `prisma.tarifa.create` sigan
 * apuntando a donde apuntaban.
 */
export function conRegistroDeAcciones<T extends Record<string, unknown>>(
  doble: T,
): T & DobleDeRegistro {
  const usuarioPrevio = (doble as { usuario?: Record<string, unknown> }).usuario ?? {};
  const usuario = {
    ...usuarioPrevio,
    findUnique:
      (usuarioPrevio as { findUnique?: Mock }).findUnique ??
      vi.fn().mockResolvedValue(ACTOR_DOBLE),
  };

  const ensanchado = Object.assign(doble, {
    historialAccion: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    usuario,
    // Paso a traves: el callback recibe el MISMO doble, asi que las aserciones del test siguen
    // viendo las llamadas donde ya las miraban.
    $transaction: vi.fn(async (fn: unknown) =>
      typeof fn === "function" ? await (fn as (tx: unknown) => unknown)(ensanchado) : undefined,
    ),
  }) as T & DobleDeRegistro;

  return ensanchado;
}

/** Las entradas que se le pasaron a `historialAccion.createMany` en la llamada `n` (0 por defecto). */
export function entradasRegistradas(
  doble: DobleDeRegistro,
  llamada = 0,
): Record<string, unknown>[] {
  const args = doble.historialAccion.createMany.mock.calls[llamada]?.[0] as
    | { data?: Record<string, unknown>[] }
    | undefined;
  return args?.data ?? [];
}
