import { describe, it, expect, vi } from "vitest";
import { NotaPrivadaMensajeroService } from "@/lib/services/NotaPrivadaMensajeroService";
import type { IOrdenMensajeroMetaRepository } from "@/lib/interfaces/repositories/IOrdenMensajeroMetaRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 116 — C1: logica de negocio de la nota privada (R1/R2/R3/R5/R9/R10/R16). Se prueba con
// un doble del meta-repo (sin Prisma ni DB): el service es logica pura y NUNCA recibe un
// `usuario_id` del input (lo fija con el actor). La persistencia real (upsert/limpiar) y la
// preservacion de `marcar_luego` se cubren en el int test del repo.

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };
const ADMIN_TIENDA: Actor = { usuarioId: "a1", rol: "adminTienda" };

const ORDEN = "11111111-1111-4111-8111-111111111111";

// Doble del meta-repo: solo los metodos `nota` que el service usa. Los spies permiten afirmar
// CON QUE argumentos se llaman (R9) y que la rama en blanco NO llama a `upsertNota` (R5).
function fakeMetaRepo(
  over: Partial<Pick<IOrdenMensajeroMetaRepository, "upsertNota" | "limpiarNota">> = {},
): Pick<IOrdenMensajeroMetaRepository, "upsertNota" | "limpiarNota"> {
  return {
    upsertNota: vi.fn(async () => {}),
    limpiarNota: vi.fn(async () => {}),
    ...over,
  };
}

describe("R10 — solo el rol mensajero puede escribir/limpiar su nota", () => {
  it("guardar con rol != mensajero -> forbidden, sin tocar el repo", async () => {
    const repo = fakeMetaRepo();
    const service = new NotaPrivadaMensajeroService(repo);
    const r = await service.guardar(ORDEN, "hola", ADMIN_TIENDA);
    expect(r.status).toBe("forbidden");
    expect(repo.upsertNota).not.toHaveBeenCalled();
    expect(repo.limpiarNota).not.toHaveBeenCalled();
  });

  it("limpiar con rol != mensajero -> forbidden, sin tocar el repo", async () => {
    const repo = fakeMetaRepo();
    const service = new NotaPrivadaMensajeroService(repo);
    const r = await service.limpiar(ORDEN, ADMIN_TIENDA);
    expect(r.status).toBe("forbidden");
    expect(repo.limpiarNota).not.toHaveBeenCalled();
  });
});

describe("R1/R2/R9 — guardar crea/edita con el usuario_id del actor", () => {
  it("R1: guardar delega en upsertNota con (actor, orden, texto) y devuelve la nota", async () => {
    const repo = fakeMetaRepo();
    const service = new NotaPrivadaMensajeroService(repo);
    const r = await service.guardar(ORDEN, "recoger en porton azul", MENSAJERO);
    expect(r).toEqual({ status: "ok", nota: "recoger en porton azul" });
    expect(repo.upsertNota).toHaveBeenCalledWith("m1", ORDEN, "recoger en porton azul");
  });

  it("R9: el usuario_id persistido es SIEMPRE el del actor (nunca del input)", async () => {
    const repo = fakeMetaRepo();
    const service = new NotaPrivadaMensajeroService(repo);
    await service.guardar(ORDEN, "x", MENSAJERO);
    // El primer argumento de upsertNota es el usuario_id: debe ser el del actor.
    expect(repo.upsertNota).toHaveBeenCalledTimes(1);
    const [usuarioId] = (repo.upsertNota as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(usuarioId).toBe("m1");
  });

  it("R2: editar (guardar con nota nueva) tambien va por upsertNota con el texto nuevo", async () => {
    const repo = fakeMetaRepo();
    const service = new NotaPrivadaMensajeroService(repo);
    await service.guardar(ORDEN, "b", MENSAJERO);
    expect(repo.upsertNota).toHaveBeenCalledWith("m1", ORDEN, "b");
  });

  it("recorta espacios de los bordes antes de persistir", async () => {
    const repo = fakeMetaRepo();
    const service = new NotaPrivadaMensajeroService(repo);
    const r = await service.guardar(ORDEN, "  con espacios  ", MENSAJERO);
    expect(r).toEqual({ status: "ok", nota: "con espacios" });
    expect(repo.upsertNota).toHaveBeenCalledWith("m1", ORDEN, "con espacios");
  });
});

describe("R5 — una nota en blanco tras recortar equivale a limpiar (nota = NULL)", () => {
  it("guardar con solo espacios -> limpiarNota, NO upsertNota; devuelve nota null", async () => {
    const repo = fakeMetaRepo();
    const service = new NotaPrivadaMensajeroService(repo);
    const r = await service.guardar(ORDEN, "   ", MENSAJERO);
    expect(r).toEqual({ status: "ok", nota: null });
    expect(repo.upsertNota).not.toHaveBeenCalled();
    expect(repo.limpiarNota).toHaveBeenCalledWith("m1", ORDEN);
  });

  it("guardar con cadena vacia -> limpiar", async () => {
    const repo = fakeMetaRepo();
    const service = new NotaPrivadaMensajeroService(repo);
    const r = await service.guardar(ORDEN, "", MENSAJERO);
    expect(r).toEqual({ status: "ok", nota: null });
    expect(repo.limpiarNota).toHaveBeenCalledTimes(1);
  });
});

describe("R4/R9 — limpiar es idempotente y acotado al actor", () => {
  it("limpiar delega en limpiarNota con (actor, orden) y devuelve ok", async () => {
    const repo = fakeMetaRepo();
    const service = new NotaPrivadaMensajeroService(repo);
    const r = await service.limpiar(ORDEN, MENSAJERO);
    expect(r).toEqual({ status: "ok" });
    expect(repo.limpiarNota).toHaveBeenCalledWith("m1", ORDEN);
  });
});

describe("R16 — orden inexistente: violacion de FK -> forbidden (sin excepcion cruda)", () => {
  it("un error P2003 del repo se traduce a forbidden", async () => {
    const repo = fakeMetaRepo({
      upsertNota: vi.fn(async () => {
        // Forma minima del error de FK de Prisma (duck-typed por `code`).
        throw Object.assign(new Error("Foreign key constraint failed"), { code: "P2003" });
      }),
    });
    const service = new NotaPrivadaMensajeroService(repo);
    const r = await service.guardar(ORDEN, "x", MENSAJERO);
    expect(r.status).toBe("forbidden");
  });

  it("un error EXCEPCIONAL que NO es P2003 se re-lanza (no se traga)", async () => {
    const repo = fakeMetaRepo({
      upsertNota: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    const service = new NotaPrivadaMensajeroService(repo);
    await expect(service.guardar(ORDEN, "x", MENSAJERO)).rejects.toThrow("db down");
  });
});
