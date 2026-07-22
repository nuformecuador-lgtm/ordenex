import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { WebhookSuscripcionRepository } from "@/lib/repositories/WebhookSuscripcionRepository";

// Feature 99 (R6, habilita R12/R21/R24/R25) — Prisma mockeado con semantica (patron del
// resto de tests/integration/repositories: la suite NO levanta Postgres). El fake ejecuta el
// comportamiento que importa: upsert por owner (no duplica), lectura sin secreto, baja logica
// y el guard de rol apiKey.

interface Fila {
  ownerUsuarioId: string;
  url: string;
  secret: string;
  activa: boolean;
}

function buildPrisma(filas: Fila[] = [], rolPorUsuario: Record<string, string> = {}) {
  const webhookSuscripcion = {
    upsert: vi.fn(async (args: { where: { ownerUsuarioId: string }; create: Fila; update: Partial<Fila> }) => {
      const existente = filas.find((f) => f.ownerUsuarioId === args.where.ownerUsuarioId);
      if (existente) Object.assign(existente, args.update);
      else filas.push({ ...(args.create as Fila) });
    }),
    findUnique: vi.fn(async (args: { where: { ownerUsuarioId: string }; select: Record<string, boolean> }) => {
      const f = filas.find((x) => x.ownerUsuarioId === args.where.ownerUsuarioId);
      if (!f) return null;
      const proj: Record<string, unknown> = {};
      for (const k of Object.keys(args.select)) proj[k] = (f as unknown as Record<string, unknown>)[k];
      return proj;
    }),
    updateMany: vi.fn(async (args: { where: { ownerUsuarioId: string }; data: Partial<Fila> }) => {
      const f = filas.find((x) => x.ownerUsuarioId === args.where.ownerUsuarioId);
      if (f) Object.assign(f, args.data);
      return { count: f ? 1 : 0 };
    }),
  };
  const usuario = {
    findUnique: vi.fn(async (args: { where: { id: string } }) => {
      const rol = rolPorUsuario[args.where.id];
      return rol ? { rol: { value: rol } } : null;
    }),
  };
  return { prisma: { webhookSuscripcion, usuario } as unknown as PrismaClient, filas };
}

describe("R6 — upsert por owner", () => {
  it("un segundo registro del mismo owner actualiza la fila, no crea otra", async () => {
    const { prisma, filas } = buildPrisma();
    const repo = new WebhookSuscripcionRepository(prisma);

    await repo.upsertByOwner({ ownerUsuarioId: "owner-1", url: "https://a.example.com", secret: "enc1" });
    await repo.upsertByOwner({ ownerUsuarioId: "owner-1", url: "https://b.example.com", secret: "enc2" });

    expect(filas).toHaveLength(1);
    expect(filas[0].url).toBe("https://b.example.com");
    expect(filas[0].secret).toBe("enc2");
    expect(filas[0].activa).toBe(true); // re-registrar reactiva
  });
});

describe("R33 (gate P4) — actualizarUrlByOwner conserva el secreto", () => {
  it("actualiza solo la url y reactiva, sin tocar el secreto", async () => {
    const { prisma, filas } = buildPrisma([
      { ownerUsuarioId: "o1", url: "https://a", secret: "enc-original", activa: false },
      { ownerUsuarioId: "o2", url: "https://b", secret: "enc-o2", activa: true },
    ]);
    const repo = new WebhookSuscripcionRepository(prisma);
    await repo.actualizarUrlByOwner("o1", "https://nueva");
    const o1 = filas.find((f) => f.ownerUsuarioId === "o1")!;
    expect(o1.url).toBe("https://nueva");
    expect(o1.secret).toBe("enc-original"); // secreto intacto: editar no rota
    expect(o1.activa).toBe(true); // reactiva
    expect(filas.find((f) => f.ownerUsuarioId === "o2")!.url).toBe("https://b"); // R9
  });

  it("es no-op si el owner no tiene fila", async () => {
    const { prisma, filas } = buildPrisma();
    const repo = new WebhookSuscripcionRepository(prisma);
    await repo.actualizarUrlByOwner("inexistente", "https://x");
    expect(filas).toHaveLength(0);
  });
});

describe("R34 (gate P4) — actualizarSecretoByOwner rota solo el secreto", () => {
  it("actualiza solo el ciphertext del secreto, conservando url y activa", async () => {
    const { prisma, filas } = buildPrisma([
      { ownerUsuarioId: "o1", url: "https://a", secret: "enc-viejo", activa: true },
      { ownerUsuarioId: "o2", url: "https://b", secret: "enc-o2", activa: true },
    ]);
    const repo = new WebhookSuscripcionRepository(prisma);
    await repo.actualizarSecretoByOwner("o1", "enc-nuevo");
    const o1 = filas.find((f) => f.ownerUsuarioId === "o1")!;
    expect(o1.secret).toBe("enc-nuevo"); // invalida el anterior
    expect(o1.url).toBe("https://a"); // url intacta
    expect(o1.activa).toBe(true);
    expect(filas.find((f) => f.ownerUsuarioId === "o2")!.secret).toBe("enc-o2"); // R9
  });
});

describe("findActivaByOwner / findByOwner (habilita R21/R24, R7)", () => {
  it("findActivaByOwner devuelve el ciphertext solo si esta activa", async () => {
    const { prisma } = buildPrisma([
      { ownerUsuarioId: "o1", url: "https://a", secret: "enc", activa: true },
      { ownerUsuarioId: "o2", url: "https://b", secret: "enc2", activa: false },
    ]);
    const repo = new WebhookSuscripcionRepository(prisma);
    expect(await repo.findActivaByOwner("o1")).toEqual({ url: "https://a", secret: "enc" });
    expect(await repo.findActivaByOwner("o2")).toBeNull(); // inactiva -> null (R21)
    expect(await repo.findActivaByOwner("otro")).toBeNull();
  });

  it("findByOwner (vista de consulta) NUNCA proyecta el secreto (R7)", async () => {
    const { prisma } = buildPrisma([
      { ownerUsuarioId: "o1", url: "https://a", secret: "enc", activa: true },
    ]);
    const repo = new WebhookSuscripcionRepository(prisma);
    const vista = await repo.findByOwner("o1");
    expect(vista).toEqual({ url: "https://a", activa: true });
    expect(JSON.stringify(vista)).not.toContain("enc");
  });
});

describe("R8 — desactivarByOwner", () => {
  it("marca inactiva la fila del owner sin tocar otras", async () => {
    const { prisma, filas } = buildPrisma([
      { ownerUsuarioId: "o1", url: "https://a", secret: "e1", activa: true },
      { ownerUsuarioId: "o2", url: "https://b", secret: "e2", activa: true },
    ]);
    const repo = new WebhookSuscripcionRepository(prisma);
    await repo.desactivarByOwner("o1");
    expect(filas.find((f) => f.ownerUsuarioId === "o1")!.activa).toBe(false);
    expect(filas.find((f) => f.ownerUsuarioId === "o2")!.activa).toBe(true); // R9: aislamiento
  });
});

describe("D3 — ownerEsApiKey", () => {
  it("true solo si el owner es rol apiKey; excluye un adminTienda u owner inexistente", async () => {
    const { prisma } = buildPrisma([], { "u-api": "apiKey", "u-tienda": "adminTienda" });
    const repo = new WebhookSuscripcionRepository(prisma);
    expect(await repo.ownerEsApiKey("u-api")).toBe(true);
    expect(await repo.ownerEsApiKey("u-tienda")).toBe(false);
    expect(await repo.ownerEsApiKey("u-inexistente")).toBe(false);
  });
});
