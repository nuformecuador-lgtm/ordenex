import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { OrdenHabilitacionApiRepository } from "@/lib/repositories/OrdenHabilitacionApiRepository";

// Feature 266 · T3.2 (R21/R23/R24) — la BITACORA de habilitaciones por API key. Prisma espiado: se
// afirma el `data` que LLEGA al `create`, no el codigo fuente.
//
// El caso que sostiene R24 es el ultimo: la clase no expone NINGUN metodo de actualizacion ni de
// borrado, y eso se comprueba sobre el prototipo real. Es lo que hace la bitacora append-only en
// la practica y no solo en el comentario: una segunda habilitacion de la misma orden con otra nota
// es un HECHO NUEVO, y quien quisiera «corregir» la anterior tendria que anadir un metodo aqui —y
// ponerse este caso en rojo.

function buildPrisma() {
  return { ordenHabilitacionApi: { create: vi.fn().mockResolvedValue({ id: "log-1" }) } };
}

function repoCon(prisma: ReturnType<typeof buildPrisma>) {
  return new OrdenHabilitacionApiRepository(prisma as unknown as PrismaClient);
}

const RAMA_A = {
  ordenId: "orden-1",
  actorUsuarioId: "usuario-dedicado-de-la-key",
  nota: "el cliente pidio reintento manana",
  cambioDeEstado: true,
  estadoResultante: "en_reparto",
} as const;

const RAMA_B = {
  ordenId: "orden-2",
  actorUsuarioId: "usuario-dedicado-de-la-key",
  nota: "direccion corregida por el call center",
  cambioDeEstado: false,
  estadoResultante: "devuelta",
} as const;

describe("Feature 266 · T3.2 — OrdenHabilitacionApiRepository.registrar", () => {
  it("R21: el create recibe los CINCO campos de la fila de la rama A", async () => {
    const prisma = buildPrisma();
    await repoCon(prisma).registrar({ ...RAMA_A });
    expect(prisma.ordenHabilitacionApi.create).toHaveBeenCalledTimes(1);
    expect(prisma.ordenHabilitacionApi.create.mock.calls[0][0].data).toEqual({
      ordenId: "orden-1",
      actorUsuarioId: "usuario-dedicado-de-la-key",
      nota: "el cliente pidio reintento manana",
      cambioDeEstado: true,
      estadoResultante: "en_reparto",
    });
  });

  it("la rama B queda escrita como tal: `cambioDeEstado` false y el estado en el que se quedo", async () => {
    // `cambioDeEstado` es un booleano ESCRITO y no derivado del par de estados: asi la fila se
    // explica sola y este caso la puede afirmar.
    const prisma = buildPrisma();
    await repoCon(prisma).registrar({ ...RAMA_B });
    expect(prisma.ordenHabilitacionApi.create.mock.calls[0][0].data).toMatchObject({
      cambioDeEstado: false,
      estadoResultante: "devuelta",
    });
  });

  it("no lee ninguna fila previa antes de insertar: un solo `create` y nada mas", async () => {
    const prisma = {
      ordenHabilitacionApi: {
        create: vi.fn().mockResolvedValue({ id: "log-1" }),
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
    };
    await new OrdenHabilitacionApiRepository(prisma as unknown as PrismaClient).registrar({
      ...RAMA_A,
    });
    expect(prisma.ordenHabilitacionApi.findFirst).not.toHaveBeenCalled();
    expect(prisma.ordenHabilitacionApi.findMany).not.toHaveBeenCalled();
  });

  it("R24: append-only — dos habilitaciones de la MISMA orden hacen DOS inserts, sin tocar la primera", async () => {
    const prisma = buildPrisma();
    const repo = repoCon(prisma);
    await repo.registrar({ ...RAMA_B });
    await repo.registrar({ ...RAMA_B, nota: "segunda nota, hecho nuevo" });
    expect(prisma.ordenHabilitacionApi.create).toHaveBeenCalledTimes(2);
    expect(prisma.ordenHabilitacionApi.create.mock.calls[1][0].data.nota).toBe(
      "segunda nota, hecho nuevo",
    );
  });

  it("R24: la clase NO expone ningun metodo de actualizacion ni de borrado", () => {
    const proto = OrdenHabilitacionApiRepository.prototype as unknown as Record<string, unknown>;
    for (const prohibido of [
      "actualizar",
      "editar",
      "update",
      "marcarBorrada",
      "borrar",
      "eliminar",
      "delete",
      "softDelete",
    ]) {
      expect(typeof proto[prohibido], `no debe existir: ${prohibido}`).not.toBe("function");
    }
    // Y la superficie publica es EXACTAMENTE `registrar`: un metodo nuevo obliga a pasar por aqui.
    const metodos = Object.getOwnPropertyNames(proto).filter((n) => n !== "constructor");
    expect(metodos).toEqual(["registrar"]);
  });
});
