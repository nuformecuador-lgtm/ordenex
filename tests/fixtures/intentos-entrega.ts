import { vi } from "vitest";
import type { IOrdenHistorialService } from "@/lib/interfaces/services/IOrdenHistorialService";

// Feature 160 — doble compartido del derivador de intentos EN LOTE. Existe para que las 7
// suites que ganaron la dependencia no dupliquen el mismo `vi.fn(async () => new Map())` (la
// deuda "fakes de repositorio a mano y duplicados" de `progress/current.md`): si mañana cambia
// la firma de `contarIntentosEnLote`, se arregla AQUI y no en siete archivos.

/** Lo que consumen los servicios de lectura: solo el conteo en lote. */
export type IntentosSvcDoble = Pick<IOrdenHistorialService, "contarIntentosEnLote">;

/**
 * Doble del derivador. Sin argumento devuelve el Map VACIO, que es el caso "ninguna orden
 * tiene intentos" y ejerce el default `?? 0` de los servicios (R14: el `0` se expone, no se
 * omite). Con `porOrden` devuelve exactamente esos conteos.
 *
 * El `vi.fn` queda expuesto para asertar R12 (exactamente 1 llamada por listado) y R13
 * (0 llamadas con lote vacio).
 */
export function fakeIntentosEnLote(
  porOrden: Record<string, number> = {},
): IntentosSvcDoble {
  return {
    contarIntentosEnLote: vi.fn(async () => new Map(Object.entries(porOrden))),
  };
}

/** Atajo tipado para leer las llamadas del doble en las aserciones. */
export function llamadasIntentos(doble: IntentosSvcDoble): string[][] {
  return (doble.contarIntentosEnLote as ReturnType<typeof vi.fn>).mock.calls.map(
    (c) => c[0] as string[],
  );
}

// --- Evaluador SEMANTICO del predicado de intentos -----------------------------------------
//
// Un mini-interprete del `where` de Prisma que produce `whereIntentosVigentes`, para poder
// probar el SIGNIFICADO del criterio sin DB. Vive aqui, y no copiado en cada suite, porque el
// criterio es UNO solo (160/R4): dos evaluadores que se desincronizaran harian exactamente el
// daño que la feature vino a evitar.

/** Fila de historial de ejemplo, con lo justo que el predicado mira. */
export interface FilaHistorialFake {
  ordenId: string;
  estatusDestinoId: string;
  origenTipo: string;
  gestionOrdenId: string | null;
  gestion: { anuladaAt: Date | null } | null;
}

type RamaDestino = { estatusDestinoId: string; origenTipo?: { in: string[] } };
type RamaVigencia = {
  gestionOrdenId?: null;
  origenTipo?: { notIn: string[] };
  gestion?: { anuladaAt: null };
};

/** `true` si la fila casa el `where` de `whereIntentosVigentes` (AND de destinos y vigencia). */
export function filaCasaIntento(
  where: Record<string, unknown>,
  fila: FilaHistorialFake,
): boolean {
  const [ramaDestinos, ramaVigencia] = where.AND as [{ OR: RamaDestino[] }, { OR: RamaVigencia[] }];
  const casaDestino = ramaDestinos.OR.some(
    (r) =>
      fila.estatusDestinoId === r.estatusDestinoId &&
      (r.origenTipo === undefined || r.origenTipo.in.includes(fila.origenTipo)),
  );
  const casaVigencia = ramaVigencia.OR.some((r) => {
    // `{ gestion: { anuladaAt: null } }` exige gestion ENLAZADA y no anulada: una fila con el
    // enlace vacio no tiene relacion que casar.
    if (r.gestion !== undefined) return fila.gestion !== null && fila.gestion.anuladaAt === null;
    return (
      fila.gestionOrdenId === null &&
      !(r.origenTipo as { notIn: string[] }).notIn.includes(fila.origenTipo)
    );
  });
  return casaDestino && casaVigencia;
}

/** `true` si el `where` acota a esa orden (id suelto o lote `{ in: [...] }`). */
export function whereAlcanzaOrden(where: Record<string, unknown>, ordenId: string): boolean {
  const filtro = where.ordenId as string | { in: string[] };
  return typeof filtro === "string" ? filtro === ordenId : filtro.in.includes(ordenId);
}

/**
 * Doble de Prisma que EVALUA de verdad el predicado contra `filas`, en vez de devolver un
 * numero fijo. Con el, `OrdenHistorialRepository` deja de estar mockeado: `count` y `groupBy`
 * responden lo que el criterio realmente dice de esas filas.
 */
export function prismaHistorialSobreFilas(filas: FilaHistorialFake[]) {
  const casan = (where: Record<string, unknown>): FilaHistorialFake[] =>
    filas.filter((f) => whereAlcanzaOrden(where, f.ordenId) && filaCasaIntento(where, f));
  return {
    ordenHistorialEstado: {
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => casan(where).length),
      groupBy: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const porOrden = new Map<string, number>();
        for (const f of casan(where)) porOrden.set(f.ordenId, (porOrden.get(f.ordenId) ?? 0) + 1);
        return [...porOrden].map(([ordenId, n]) => ({ ordenId, _count: { _all: n } }));
      }),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      createMany: vi.fn(),
    },
  };
}
