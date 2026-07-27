import { vi } from "vitest";
import type { LoteContexto } from "@/lib/interfaces/repositories/IOrdenRepository";

// Feature 141 — dobles del LOTE de carga masiva compartidos por los tests de repositorio.
// El delegate `carga` fake honra la semantica que importa del helper `ensureCargaEnTx`:
// `createMany` con `skipDuplicates` = INSERT ... ON CONFLICT (id) DO NOTHING (la primera
// escritura gana; las siguientes NO reescriben `total_files`), y `findUnique` devuelve la
// fila almacenada para que la verificacion de propietario (R17) sea observable.

export interface CargaFilaFake {
  id: string;
  usuarioCarga: string;
  totalFiles: number;
  downloadUrl: string | null;
}

export interface CargaDelegateFake {
  filas: Map<string, CargaFilaFake>;
  createMany: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
}

/**
 * Delegate `carga` en memoria. `preexistentes` siembra lotes ya creados (p. ej. el de otro
 * usuario, para el caso 403 de R17, o el de un chunk anterior de la misma sesion).
 */
export function buildCargaDelegate(preexistentes: CargaFilaFake[] = []): CargaDelegateFake {
  const filas = new Map<string, CargaFilaFake>(preexistentes.map((f) => [f.id, f]));
  const createMany = vi.fn(
    async ({ data }: { data: Array<Record<string, unknown>>; skipDuplicates?: boolean }) => {
      let count = 0;
      for (const fila of data) {
        const id = String(fila.id);
        if (filas.has(id)) continue; // ON CONFLICT DO NOTHING
        filas.set(id, {
          id,
          usuarioCarga: String(fila.usuarioCarga),
          totalFiles: Number(fila.totalFiles),
          downloadUrl: (fila.downloadUrl as string | null) ?? null,
        });
        count += 1;
      }
      return { count };
    },
  );
  const findUnique = vi.fn(async ({ where }: { where: { id: string } }) => filas.get(where.id) ?? null);
  return { filas, createMany, findUnique };
}

/** Contexto de lote por defecto para los tests que no ejercitan sus variantes. */
export function loteCtx(overrides: Partial<LoteContexto> = {}): LoteContexto {
  return { cargaId: null, usuarioCargaId: "tienda-1", totalFiles: 1, ...overrides };
}
