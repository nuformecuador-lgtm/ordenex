import { describe, it, expect, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PostulacionRepository } from "@/lib/repositories/PostulacionRepository";
import { UsuarioDuplicadoError } from "@/lib/interfaces/repositories/IUserRepository";

// tx mock que reciben las operaciones dentro de $transaction.
function buildTx(usuarioCreate: ReturnType<typeof vi.fn>) {
  return {
    usuario: { create: usuarioCreate },
    mensajeroDocumento: { createMany: vi.fn().mockResolvedValue({ count: 5 }) },
  };
}

function buildPrisma(usuarioCreate: ReturnType<typeof vi.fn>) {
  const tx = buildTx(usuarioCreate);
  return {
    $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
    usuario: { findUnique: vi.fn() },
    rol: { findUnique: vi.fn() },
    tipoIdentificacion: { findUnique: vi.fn() },
    vehiculo: { findUnique: vi.fn() },
  } as unknown as PrismaClient;
}

const USUARIO = {
  id: "usr-1",
  nombre: "Ana",
  email: "ana@example.com",
  telefono: "0991234567",
  passwordHash: "hash",
  cedula: "1710034065",
  tipoIdentificacionId: "tipo-1",
  rolId: "rol-1",
};

const DOCS = [
  { tipo: "cedula_anverso", storagePath: "p1", contentType: "image/jpeg" },
  { tipo: "cedula_reverso", storagePath: "p2", contentType: "image/jpeg" },
] as never;

// Forma NATIVA del P2002 (motor sin adapter): el campo violado viene en meta.target.
function p2002Nativo(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "7.8.0",
    meta: { target },
  });
}

// Forma ADAPTER (PrismaPg): meta.target === undefined; el nombre de la constraint
// vive en meta.driverAdapterError.cause.originalMessage.
function p2002Adapter(constraint: string) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "7.8.0",
    meta: {
      modelName: "Usuario",
      driverAdapterError: {
        name: "DriverAdapterError",
        cause: {
          originalCode: "23505",
          originalMessage: `llave duplicada viola restriccion de unicidad «${constraint}»`,
          kind: "UniqueConstraintViolation",
        },
      },
    },
  });
}

describe("PostulacionRepository.crearMensajeroConDocumentos — mapeo P2002 (registro publico)", () => {
  it("adapter: P2002 de email (sin meta.target) -> UsuarioDuplicadoError('email') (R19)", async () => {
    const create = vi.fn().mockRejectedValue(p2002Adapter("usuario_email_key"));
    const repo = new PostulacionRepository(buildPrisma(create));

    const error = await repo.crearMensajeroConDocumentos(USUARIO, DOCS).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UsuarioDuplicadoError);
    expect((error as UsuarioDuplicadoError).campo).toBe("email");
  });

  it("adapter: P2002 de cedula (sin meta.target) -> UsuarioDuplicadoError('cedula') (R20)", async () => {
    const create = vi.fn().mockRejectedValue(p2002Adapter("usuario_cedula_key"));
    const repo = new PostulacionRepository(buildPrisma(create));

    const error = await repo.crearMensajeroConDocumentos(USUARIO, DOCS).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UsuarioDuplicadoError);
    expect((error as UsuarioDuplicadoError).campo).toBe("cedula");
  });

  it("nativo: P2002 de email (meta.target) sigue funcionando (no regresion)", async () => {
    const create = vi.fn().mockRejectedValue(p2002Nativo(["email"]));
    const repo = new PostulacionRepository(buildPrisma(create));

    const error = await repo.crearMensajeroConDocumentos(USUARIO, DOCS).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UsuarioDuplicadoError);
    expect((error as UsuarioDuplicadoError).campo).toBe("email");
  });

  it("nativo: P2002 de cedula (meta.target) sigue funcionando (no regresion)", async () => {
    const create = vi.fn().mockRejectedValue(p2002Nativo(["cedula"]));
    const repo = new PostulacionRepository(buildPrisma(create));

    const error = await repo.crearMensajeroConDocumentos(USUARIO, DOCS).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UsuarioDuplicadoError);
    expect((error as UsuarioDuplicadoError).campo).toBe("cedula");
  });

  it("P2002 de constraint desconocida -> re-lanza el error original (no traduce)", async () => {
    const original = p2002Adapter("usuario_otra_key");
    const create = vi.fn().mockRejectedValue(original);
    const repo = new PostulacionRepository(buildPrisma(create));

    await expect(repo.crearMensajeroConDocumentos(USUARIO, DOCS)).rejects.toBe(original);
  });

  it("crea el usuario cuando no hay conflicto de unicidad", async () => {
    const create = vi.fn().mockResolvedValue({ id: "usr-1" });
    const repo = new PostulacionRepository(buildPrisma(create));

    const res = await repo.crearMensajeroConDocumentos(USUARIO, DOCS);
    expect(res.id).toBe("usr-1");
  });
});
