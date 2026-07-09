import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { TrustedDeviceRepository } from "@/lib/repositories/TrustedDeviceRepository";

type MockedPrisma = Pick<PrismaClient, "trustedDevice">;

describe("TrustedDeviceRepository", () => {
  it("da de alta un dispositivo nuevo", async () => {
    const upsert = vi.fn().mockResolvedValue({
      id: "td-1",
      usuarioId: "usr-1",
      deviceHash: "hash-device",
      ipAddress: "1.2.3.4",
      lastSeenAt: new Date(),
      createdAt: new Date(),
    });
    const prisma = { trustedDevice: { upsert } } as unknown as MockedPrisma;
    const repo = new TrustedDeviceRepository(prisma);

    const record = await repo.upsert({
      usuarioId: "usr-1",
      deviceHash: "hash-device",
      ipAddress: "1.2.3.4",
    });

    expect(record.id).toBe("td-1");
    expect(upsert).toHaveBeenCalledWith({
      where: { usuarioId_deviceHash: { usuarioId: "usr-1", deviceHash: "hash-device" } },
      update: { ipAddress: "1.2.3.4", lastSeenAt: expect.any(Date) },
      create: { usuarioId: "usr-1", deviceHash: "hash-device", ipAddress: "1.2.3.4" },
    });
  });

  it("actualiza lastSeenAt de forma idempotente si el dispositivo ya existia", async () => {
    const upsert = vi.fn().mockResolvedValue({
      id: "td-1",
      usuarioId: "usr-1",
      deviceHash: "hash-device",
      ipAddress: "5.6.7.8",
      lastSeenAt: new Date(),
      createdAt: new Date("2020-01-01"),
    });
    const prisma = { trustedDevice: { upsert } } as unknown as MockedPrisma;
    const repo = new TrustedDeviceRepository(prisma);

    await repo.upsert({ usuarioId: "usr-1", deviceHash: "hash-device", ipAddress: "5.6.7.8" });
    await repo.upsert({ usuarioId: "usr-1", deviceHash: "hash-device", ipAddress: "5.6.7.8" });

    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it("findByUsuarioAndDevice busca por la clave compuesta", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const prisma = { trustedDevice: { findUnique } } as unknown as MockedPrisma;
    const repo = new TrustedDeviceRepository(prisma);

    const result = await repo.findByUsuarioAndDevice("usr-1", "hash-device");

    expect(result).toBeNull();
    expect(findUnique).toHaveBeenCalledWith({
      where: { usuarioId_deviceHash: { usuarioId: "usr-1", deviceHash: "hash-device" } },
    });
  });
});
