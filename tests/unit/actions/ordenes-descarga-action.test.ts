import { describe, it, expect, vi } from "vitest";
import { listarOrdenesCompleto } from "@/lib/actions/ordenes";
import type { Actor, IOrdenService } from "@/lib/interfaces/services/IOrdenService";
import type { OrdenListItemDTO } from "@/lib/types/orden";

// Feature 151/T7 (R13/R15 + refuerzo R11/R14/R20) — borde del dataset completo.
// Lo que se afirma aqui es el CONTRATO del borde: quien no pasa el control no recibe
// filas, y lo que el servicio decide viaja intacto. El servicio va inyectado.

const ADMIN: Actor = { usuarioId: "a1", rol: "admin" };

const ITEM = {
  id: "o1",
  numGuia: 101,
  numRemision: "R-1",
  estatusId: "os1",
  destinatario: "Ana",
  telefonoDest: "88880000",
  tiendaId: "store1",
  zonaId: "z1",
  provinciaId: "p1",
  cantonId: "c1",
  distritoId: null,
  producto: "caja",
  peso: null,
  notas: null,
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  updatedAt: new Date("2026-07-01T00:00:00.000Z"),
  tiendaNombre: "Tienda",
} satisfies OrdenListItemDTO;

function fakeService(resultado: unknown) {
  const listarCompleto = vi.fn().mockResolvedValue(resultado);
  return { service: { listarCompleto } as unknown as IOrdenService, listarCompleto };
}

describe("listarOrdenesCompleto (borde)", () => {
  it("devuelve unauthenticated y ninguna fila cuando no hay sesion (R13)", async () => {
    const { service, listarCompleto } = fakeService({ status: "ok", items: [ITEM], total: 1 });

    const r = await listarOrdenesCompleto(
      {},
      { ordenService: service, getActor: async () => null },
    );

    expect(r.status).toBe("unauthenticated");
    expect(r).not.toHaveProperty("items");
    expect(listarCompleto).not.toHaveBeenCalled(); // ni se llega a consultar el dato
  });

  it("devuelve validation_error y ninguna fila cuando llega una clave de filtro fuera de la lista blanca (R15)", async () => {
    const { service, listarCompleto } = fakeService({ status: "ok", items: [ITEM], total: 1 });

    const r = await listarOrdenesCompleto(
      { filter: { tienda_id: ["t1"], deleted_at: "2026-01-01" } },
      { ordenService: service, getActor: async () => ADMIN },
    );

    expect(r.status).toBe("validation_error");
    expect(r).not.toHaveProperty("items");
    expect(listarCompleto).not.toHaveBeenCalled();
  });

  it("propaga limite_excedido con total y limite tal como lo devuelve el servicio (R20)", async () => {
    const { service } = fakeService({ status: "limite_excedido", total: 12_480, limite: 5000 });

    const r = await listarOrdenesCompleto(
      { filter: { zona_id: ["z1"] } },
      { ordenService: service, getActor: async () => ADMIN },
    );

    expect(r).toEqual({ status: "limite_excedido", total: 12_480, limite: 5000 });
    expect(r).not.toHaveProperty("items");
  });

  it("propaga forbidden sin filas (R14)", async () => {
    const { service } = fakeService({ status: "forbidden" });

    const r = await listarOrdenesCompleto(
      {},
      { ordenService: service, getActor: async () => ({ usuarioId: "x", rol: "otroRol" as Actor["rol"] }) },
    );

    expect(r).toEqual({ status: "forbidden" });
    expect(r).not.toHaveProperty("items");
  });

  it("entrega los items del servicio cuando todo va bien (R11)", async () => {
    const { service, listarCompleto } = fakeService({ status: "ok", items: [ITEM], total: 1 });

    const r = await listarOrdenesCompleto(
      { filter: { zona_id: ["z1"] } },
      { ordenService: service, getActor: async () => ADMIN },
    );

    expect(r).toEqual({ status: "ok", items: [ITEM], total: 1 });
    // El input llega al servicio ya parseado y SIN page/pageSize: no hay paginacion.
    const [data, actor] = listarCompleto.mock.calls[0];
    expect(actor).toEqual(ADMIN);
    expect(data).toEqual({
      filter: { zona_id: ["z1"] },
      sortBy: "created_at",
      sortDir: "asc", // pedido humano: lo más antiguo primero, igual que el listado
    });
    expect(data).not.toHaveProperty("page");
    expect(data).not.toHaveProperty("pageSize");
  });
});
