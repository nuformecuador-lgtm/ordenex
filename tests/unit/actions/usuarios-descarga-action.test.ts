import { describe, it, expect, vi } from "vitest";
import { listarUsuariosCompleto } from "@/lib/actions/usuarios";
import type { Actor, IUsuarioService } from "@/lib/interfaces/services/IUsuarioService";
import type { UsuarioListItemDTO } from "@/lib/types/usuario";

// Feature 170 / T B.2 (R16/R18 + refuerzo R9/R17/R27) — borde del dataset completo de
// usuarios. Lo que se afirma aquí es el CONTRATO del borde: quien no pasa el control no
// recibe filas, y lo que el servicio decide viaja intacto. El servicio va inyectado.

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };

const ITEM: UsuarioListItemDTO = {
  id: "u1",
  nombre: "Ana Torres",
  email: "ana@example.com",
  rolValue: "mensajero",
  estado: "activo",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

function fakeService(resultado: unknown) {
  const listarCompleto = vi.fn().mockResolvedValue(resultado);
  return { service: { listarCompleto } as unknown as IUsuarioService, listarCompleto };
}

describe("listarUsuariosCompleto (borde)", () => {
  it("devuelve unauthenticated y ninguna fila cuando no hay sesion (R16)", async () => {
    const { service, listarCompleto } = fakeService({ status: "ok", items: [ITEM], total: 1 });

    const r = await listarUsuariosCompleto(
      {},
      { usuarioService: service, getActor: async () => null },
    );

    expect(r.status).toBe("unauthenticated");
    expect(r).not.toHaveProperty("items");
    expect(listarCompleto).not.toHaveBeenCalled(); // ni se llega a consultar el dato
  });

  it("devuelve validation_error y ninguna fila cuando llega una clave fuera de la lista blanca (R18)", async () => {
    const { service, listarCompleto } = fakeService({ status: "ok", items: [ITEM], total: 1 });

    const r = await listarUsuariosCompleto(
      { sortBy: "nombre", deletedAt: null },
      { usuarioService: service, getActor: async () => MAESTRO },
    );

    expect(r.status).toBe("validation_error");
    expect(r).not.toHaveProperty("items");
    expect(listarCompleto).not.toHaveBeenCalled();
  });

  it("rechaza tambien page/pageSize: el modo completo NO pagina (R18)", async () => {
    const { service, listarCompleto } = fakeService({ status: "ok", items: [ITEM], total: 1 });

    const r = await listarUsuariosCompleto(
      { page: 1, pageSize: 25 },
      { usuarioService: service, getActor: async () => MAESTRO },
    );

    expect(r.status).toBe("validation_error");
    expect(listarCompleto).not.toHaveBeenCalled();
  });

  it("propaga limite_excedido con total y limite tal como lo devuelve el servicio (R27)", async () => {
    const { service } = fakeService({ status: "limite_excedido", total: 12_480, limite: 5000 });

    const r = await listarUsuariosCompleto(
      {},
      { usuarioService: service, getActor: async () => MAESTRO },
    );

    expect(r).toEqual({ status: "limite_excedido", total: 12_480, limite: 5000 });
    expect(r).not.toHaveProperty("items");
  });

  it("propaga forbidden sin filas (R17)", async () => {
    const { service } = fakeService({ status: "forbidden" });

    const r = await listarUsuariosCompleto(
      {},
      {
        usuarioService: service,
        getActor: async () => ({ usuarioId: "a1", rol: "admin" }),
      },
    );

    expect(r).toEqual({ status: "forbidden" });
    expect(r).not.toHaveProperty("items");
  });

  it("entrega los items del servicio, con el input parseado y SIN paginacion (R9)", async () => {
    const { service, listarCompleto } = fakeService({ status: "ok", items: [ITEM], total: 1 });

    const r = await listarUsuariosCompleto(
      { sortBy: "nombre", sortDir: "asc" },
      { usuarioService: service, getActor: async () => MAESTRO },
    );

    expect(r).toEqual({ status: "ok", items: [ITEM], total: 1 });
    const [data, actor] = listarCompleto.mock.calls[0];
    expect(actor).toEqual(MAESTRO);
    expect(data).toEqual({ sortBy: "nombre", sortDir: "asc" });
    expect(data).not.toHaveProperty("page");
    expect(data).not.toHaveProperty("pageSize");
  });
});
