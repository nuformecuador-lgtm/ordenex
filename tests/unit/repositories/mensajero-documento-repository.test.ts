import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { MensajeroDocumentoRepository } from "@/lib/repositories/MensajeroDocumentoRepository";
import type { MensajeroDocumentoDTO } from "@/lib/interfaces/repositories/IMensajeroDocumentoRepository";

// Feature 21 / R17: el perfil DEBE poder referenciar la foto_rostro a partir del
// documento almacenado. findByUsuario expone los documentos del usuario para que
// el perfil resuelva ese tipo.

type MockedPrisma = Pick<PrismaClient, "mensajeroDocumento">;

const docsUsuario: MensajeroDocumentoDTO[] = [
  {
    id: "doc-1",
    usuarioId: "usr-1",
    tipo: "cedula_anverso",
    storagePath: "usr-1/cedula_anverso.jpg",
    contentType: "image/jpeg",
  },
  {
    id: "doc-2",
    usuarioId: "usr-1",
    tipo: "foto_rostro",
    storagePath: "usr-1/foto_rostro.jpg",
    contentType: "image/jpeg",
  },
];

describe("MensajeroDocumentoRepository", () => {
  it("R17: findByUsuario consulta los documentos del usuario dado, ordenados por tipo", async () => {
    const findMany = vi.fn().mockResolvedValue(docsUsuario);
    const prisma = { mensajeroDocumento: { findMany } } as unknown as MockedPrisma;
    const repo = new MensajeroDocumentoRepository(prisma);

    const result = await repo.findByUsuario("usr-1");

    expect(result).toEqual(docsUsuario);
    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({ usuarioId: "usr-1" });
    expect(args.orderBy).toEqual({ tipo: "asc" });
    // Proyecta los campos necesarios para referenciar el archivo en Storage.
    expect(args.select).toMatchObject({ tipo: true, storagePath: true });
  });

  it("R17: el resultado permite al perfil resolver la foto_rostro del usuario", async () => {
    const findMany = vi.fn().mockResolvedValue(docsUsuario);
    const prisma = { mensajeroDocumento: { findMany } } as unknown as MockedPrisma;
    const repo = new MensajeroDocumentoRepository(prisma);

    const documentos = await repo.findByUsuario("usr-1");
    const fotoRostro = documentos.find((d) => d.tipo === "foto_rostro");

    expect(fotoRostro).toBeDefined();
    expect(fotoRostro?.usuarioId).toBe("usr-1");
    expect(fotoRostro?.storagePath).toBe("usr-1/foto_rostro.jpg");
  });

  it("devuelve lista vacia si el usuario no tiene documentos", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { mensajeroDocumento: { findMany } } as unknown as MockedPrisma;
    const repo = new MensajeroDocumentoRepository(prisma);

    await expect(repo.findByUsuario("usr-sin-docs")).resolves.toEqual([]);
  });
});
