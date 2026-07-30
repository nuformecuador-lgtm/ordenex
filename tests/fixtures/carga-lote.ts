import { vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { LoteContexto } from "@/lib/interfaces/repositories/IOrdenRepository";

// Feature 141 — dobles del LOTE de carga masiva compartidos por los tests de repositorio.
// El delegate `carga` fake honra la semantica que importa de `ensureCargaEnTx`:
//   - `create` = INSERT real (el id lo trae el helper, generado en el SERVIDOR) y revienta con
//     P2002 sobre (usuario_carga, name) si el MISMO usuario repite nombre — igual que el
//     indice unico compuesto `carga_usuario_carga_name_key` (R9/R24). Los NULL conviven (R10).
//   - `findUnique` = la lectura de la rama de REUTILIZACION (R17/R19).
//   - `update` = la escritura POST-COMMIT de `download_url` (R47).

export interface CargaFilaFake {
  id: string;
  usuarioCarga: string;
  name: string | null;
  totalFiles: number;
  downloadUrl: string | null;
}

export interface CargaDelegateFake {
  filas: Map<string, CargaFilaFake>;
  create: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

/** Error de unicidad tal como lo emite Prisma para el indice (usuario_carga, name). */
export function errorNombreDuplicado(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "7.8.0",
    meta: { target: ["usuario_carga", "name"] },
  });
}

/**
 * Delegate `carga` en memoria. `preexistentes` siembra lotes ya creados: el de otro usuario
 * (403 de R19), el del mismo usuario con un nombre ya usado (409 de R24) o el emitido por un
 * chunk anterior de la misma sesion (R17).
 */
export function buildCargaDelegate(preexistentes: CargaFilaFake[] = []): CargaDelegateFake {
  const filas = new Map<string, CargaFilaFake>(preexistentes.map((f) => [f.id, f]));
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    const id = String(data.id);
    const usuarioCarga = String(data.usuarioCarga);
    const name = (data.name as string | null) ?? null;
    if (name !== null) {
      for (const fila of filas.values()) {
        if (fila.usuarioCarga === usuarioCarga && fila.name === name) throw errorNombreDuplicado();
      }
    }
    const fila: CargaFilaFake = {
      id,
      usuarioCarga,
      name,
      totalFiles: Number(data.totalFiles ?? 0),
      downloadUrl: (data.downloadUrl as string | null) ?? null,
    };
    filas.set(id, fila);
    return fila;
  });
  const findUnique = vi.fn(
    async ({ where }: { where: { id: string } }) => filas.get(where.id) ?? null,
  );
  const update = vi.fn(
    async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const fila = filas.get(where.id);
      if (!fila) throw new Error(`carga ${where.id} no existe`);
      if ("downloadUrl" in data) fila.downloadUrl = (data.downloadUrl as string | null) ?? null;
      return fila;
    },
  );
  return { filas, create, findUnique, update };
}

/** Contexto de lote por defecto: CREACION (sin token previo) y sin nombre. */
export function loteCtx(overrides: Partial<LoteContexto> = {}): LoteContexto {
  return { cargaId: null, usuarioCargaId: "tienda-1", totalFiles: 1, ...overrides };
}
