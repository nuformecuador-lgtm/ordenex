import { describe, it, expect, vi } from "vitest";
import {
  listarPostulacionesRecurso,
  marcarPostulacionRecursoAtendida,
} from "@/lib/actions/atencion-postulaciones-recurso";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IPostulacionRecursoService } from "@/lib/interfaces/services/IPostulacionRecursoService";
import { postulacionRecursoConfig } from "@/lib/config/postulacion-recurso";

// Feature 253 (T5.1) — el borde del ADMIN. Molde de
// `tests/integration/actions/aprobacion-postulaciones-action.test.ts`. Cubre R27, R28, R30, R33 y
// la traduccion de los desenlaces (R31/R32/R34).

const ACTOR: Actor = { usuarioId: "actor-1", rol: "maestro" };
const getActor = async (): Promise<Actor | null> => ACTOR;
const sinActor = async (): Promise<Actor | null> => null;

function serviceDoble(
  overrides: Partial<IPostulacionRecursoService> = {},
): IPostulacionRecursoService {
  return {
    registrar: vi.fn(),
    listar: vi
      .fn()
      .mockResolvedValue({ status: "ok", items: [], page: 1, pageSize: 20, total: 0 }),
    atender: vi
      .fn()
      .mockResolvedValue({ status: "ok", id: "pr-1", atendidaAt: "2026-08-20T12:00:00.000Z" }),
    ...overrides,
  };
}

describe("253 — sin sesion valida: `unauthenticated` SIN tocar el servicio", () => {
  it("listarPostulacionesRecurso", async () => {
    const service = serviceDoble();
    const r = await listarPostulacionesRecurso({}, { service, getActor: sinActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.listar).not.toHaveBeenCalled();
  });

  it("marcarPostulacionRecursoAtendida", async () => {
    const service = serviceDoble();
    const r = await marcarPostulacionRecursoAtendida("pr-1", { service, getActor: sinActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.atender).not.toHaveBeenCalled();
  });
});

describe("253 / R28 — rol no autorizado: `forbidden` traducido del dominio", () => {
  it("listar", async () => {
    const service = serviceDoble({ listar: vi.fn().mockResolvedValue({ status: "forbidden" }) });
    const r = await listarPostulacionesRecurso({}, { service, getActor });
    expect(r.status).toBe("forbidden");
  });

  it("atender", async () => {
    const service = serviceDoble({ atender: vi.fn().mockResolvedValue({ status: "forbidden" }) });
    const r = await marcarPostulacionRecursoAtendida("pr-1", { service, getActor });
    expect(r.status).toBe("forbidden");
  });
});

describe("253 — el borde valida su entrada", () => {
  it.each([
    ["cadena vacia", ""],
    ["un numero", 123],
    ["null", null],
    ["un objeto", { id: "pr-1" }],
  ])("id invalido (%s) -> validation_error sin llamar al servicio", async (_caso, id) => {
    const service = serviceDoble();
    const r = await marcarPostulacionRecursoAtendida(id, { service, getActor });
    expect(r.status).toBe("validation_error");
    expect(service.atender).not.toHaveBeenCalled();
  });

  it("una `page` de cero llega como validation_error, no como pagina rara", async () => {
    const service = serviceDoble();
    const r = await listarPostulacionesRecurso({ page: 0 }, { service, getActor });
    expect(r.status).toBe("validation_error");
    expect(service.listar).not.toHaveBeenCalled();
  });
});

describe("253 / R30 + R33 — el listado pagina y tiene dos pestanas", () => {
  it("sin entrada, pide la primera pagina de PENDIENTES con el tamano por defecto", async () => {
    const service = serviceDoble();
    await listarPostulacionesRecurso(undefined, { service, getActor });
    expect(service.listar).toHaveBeenCalledWith(
      {
        atendidas: false,
        page: 1,
        pageSize: postulacionRecursoConfig.PAGE_SIZE_DEFAULT,
      },
      ACTOR,
    );
  });

  it("R33: `atendidas: true` viaja al servicio", async () => {
    const service = serviceDoble();
    await listarPostulacionesRecurso({ atendidas: true, page: 2 }, { service, getActor });
    expect(service.listar).toHaveBeenCalledWith(
      expect.objectContaining({ atendidas: true, page: 2 }),
      ACTOR,
    );
  });

  it("R30: un pageSize desmedido se acota ANTES de llegar al servicio", async () => {
    const service = serviceDoble();
    await listarPostulacionesRecurso({ pageSize: 5000 }, { service, getActor });
    expect(service.listar).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: postulacionRecursoConfig.PAGE_SIZE_MAX }),
      ACTOR,
    );
  });

  it("devuelve los items del servicio tal cual, con page/pageSize/total", async () => {
    const item = {
      id: "pr-1",
      tipo: "bodega" as const,
      nombre: "Ana",
      telefono: "88888888",
      correo: "ana@ejemplo.com",
      mensaje: "200 m2",
      createdAt: "2026-08-19T10:00:00.000Z",
      atendidaAt: null,
      atendidaPor: null,
    };
    const service = serviceDoble({
      listar: vi
        .fn()
        .mockResolvedValue({ status: "ok", items: [item], page: 1, pageSize: 20, total: 1 }),
    });

    const r = await listarPostulacionesRecurso({}, { service, getActor });

    expect(r).toEqual({ status: "ok", items: [item], page: 1, pageSize: 20, total: 1 });
  });
});

describe("253 / R31 + R32 + R34 — atender, y sus fallos NO son mudos", () => {
  it("R31: el desenlace feliz trae el id y el instante", async () => {
    const r = await marcarPostulacionRecursoAtendida("pr-1", {
      service: serviceDoble(),
      getActor,
    });
    expect(r).toEqual({ status: "ok", id: "pr-1", atendidaAt: "2026-08-20T12:00:00.000Z" });
  });

  it("R32: `conflict` y `not_found` llegan DISTINGUIBLES a la pantalla", async () => {
    const conflicto = await marcarPostulacionRecursoAtendida("pr-1", {
      service: serviceDoble({ atender: vi.fn().mockResolvedValue({ status: "conflict" }) }),
      getActor,
    });
    expect(conflicto.status).toBe("conflict");

    const inexistente = await marcarPostulacionRecursoAtendida("pr-9", {
      service: serviceDoble({ atender: vi.fn().mockResolvedValue({ status: "not_found" }) }),
      getActor,
    });
    expect(inexistente.status).toBe("not_found");
  });

  it("R34: un fallo inesperado del servicio NO deja la accion muda ni cuelga la promesa", async () => {
    // `withErrorHandler` normaliza el throw a INTERNAL y `toActionError` lo re-lanza como
    // `Error("internal")`. Lo que NO puede pasar es que la promesa quede pendiente o que se
    // devuelva `ok`: la pantalla tiene que poder decir algo y la fila tiene que seguir ahi.
    const service = serviceDoble({
      atender: vi.fn().mockRejectedValue(new Error("la base se cayo")),
    });
    await expect(
      marcarPostulacionRecursoAtendida("pr-1", { service, getActor }),
    ).rejects.toThrowError("internal");
  });
});

describe("253 — el modulo del admin y el publico son DOS cosas distintas", () => {
  it("estas dos acciones SI exigen sesion; la publica no la mira siquiera", async () => {
    // Control cruzado: si alguien fusionase los dos modulos, esta asercion caeria junto con la
    // del test de la accion publica (que afirma que alli NO hay `resolveActorFromSession`).
    const service = serviceDoble();
    expect((await listarPostulacionesRecurso({}, { service, getActor: sinActor })).status).toBe(
      "unauthenticated",
    );
    expect(
      (await marcarPostulacionRecursoAtendida("pr-1", { service, getActor: sinActor })).status,
    ).toBe("unauthenticated");
  });
});
