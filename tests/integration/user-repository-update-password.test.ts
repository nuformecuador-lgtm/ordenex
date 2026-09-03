import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { UserRepository } from "@/lib/repositories/UserRepository";

// Feature 20 / R9: updatePasswordHash actualiza solo password_hash.

// FICHA 362: el alta pasa a `$transaction` y registra su accion en ella.
type MockedPrisma = Pick<
  PrismaClient,
  "usuario" | "tipoIdentificacion" | "rol" | "$transaction" | "historialAccion"
>;

describe("UserRepository.updatePasswordHash (R9)", () => {
  it("actualiza password_hash del usuario indicado y no toca otros campos", async () => {
    const update = vi.fn().mockResolvedValue({ id: "usr-1" });
    const prisma = { usuario: { update } } as unknown as MockedPrisma;
    const repo = new UserRepository(prisma);

    await repo.updatePasswordHash("usr-1", "hash-nuevo");

    expect(update).toHaveBeenCalledWith({
      where: { id: "usr-1" },
      data: { passwordHash: "hash-nuevo" },
    });
    const dataArg = update.mock.calls[0][0].data;
    expect(Object.keys(dataArg)).toEqual(["passwordHash"]);
  });

  it("no devuelve el hash (retorna void)", async () => {
    const update = vi.fn().mockResolvedValue({ id: "usr-1", passwordHash: "x" });
    const prisma = { usuario: { update } } as unknown as MockedPrisma;
    const repo = new UserRepository(prisma);

    const result = await repo.updatePasswordHash("usr-1", "hash-nuevo");
    expect(result).toBeUndefined();
  });
});
