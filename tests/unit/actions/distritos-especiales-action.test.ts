import { describe, it, expect, vi, beforeEach } from "vitest";

// Marca `distrito.zona_especial` desde el selector de "Costos por zona". La
// action no recibe deps (igual que `listarArbolGeografico`, en el mismo
// modulo), asi que se mockean la sesion y el cliente Prisma.
const resolveActorMock = vi.fn();
vi.mock("@/lib/auth/resolve-actor", () => ({
  resolveActorFromSession: () => resolveActorMock(),
}));

const updateManyMock = vi.fn();
const transactionMock = vi.fn();
vi.mock("@/lib/db/prisma-client", () => ({
  getPrismaClient: () => ({
    distrito: { updateMany: (...a: unknown[]) => updateManyMock(...a) },
    $transaction: (...a: unknown[]) => transactionMock(...a),
  }),
}));

const { actualizarDistritosEspeciales } = await import(
  "@/lib/actions/geografia"
);

const MAESTRO = { usuarioId: "u-1", rol: "maestro" };

beforeEach(() => {
  vi.clearAllMocks();
  resolveActorMock.mockResolvedValue(MAESTRO);
  updateManyMock.mockImplementation((args: { where: { id: { in: string[] } } }) => ({
    count: args.where.id.in.length,
  }));
  transactionMock.mockImplementation(async (ops: { count: number }[]) => ops);
});

describe("actualizarDistritosEspeciales", () => {
  it("sin sesion -> unauthenticated, sin tocar la base", async () => {
    resolveActorMock.mockResolvedValue(null);
    const res = await actualizarDistritosEspeciales({ marcar: ["d1"], desmarcar: [] });
    expect(res.status).toBe("unauthenticated");
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rol distinto de maestro -> forbidden, sin tocar la base", async () => {
    resolveActorMock.mockResolvedValue({ usuarioId: "u-2", rol: "adminSatelite" });
    const res = await actualizarDistritosEspeciales({ marcar: ["d1"], desmarcar: [] });
    expect(res.status).toBe("forbidden");
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("payload invalido -> validation_error", async () => {
    const res = await actualizarDistritosEspeciales({ marcar: [""], desmarcar: [] });
    expect(res.status).toBe("validation_error");
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("un id en marcar y desmarcar a la vez -> validation_error (orden contradictoria)", async () => {
    const res = await actualizarDistritosEspeciales({
      marcar: ["d1"],
      desmarcar: ["d1"],
    });
    expect(res.status).toBe("validation_error");
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("delta vacio -> ok sin ir a la base", async () => {
    const res = await actualizarDistritosEspeciales({ marcar: [], desmarcar: [] });
    expect(res).toEqual({ status: "ok", actualizados: 0 });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("escribe true y false en una sola transaccion", async () => {
    const res = await actualizarDistritosEspeciales({
      marcar: ["d1", "d2"],
      desmarcar: ["d3"],
    });
    expect(res).toEqual({ status: "ok", actualizados: 3 });
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(updateManyMock).toHaveBeenNthCalledWith(1, {
      where: { id: { in: ["d1", "d2"] } },
      data: { zonaEspecial: true },
    });
    expect(updateManyMock).toHaveBeenNthCalledWith(2, {
      where: { id: { in: ["d3"] } },
      data: { zonaEspecial: false },
    });
  });
});
