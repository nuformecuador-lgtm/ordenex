import { describe, it, expect, vi } from "vitest";
import type { RolValue } from "@prisma/client";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IPostulacionRecursoRepository } from "@/lib/interfaces/repositories/IPostulacionRecursoRepository";
import type { ErrorLogger } from "@/lib/errors";
import { PostulacionRecursoService } from "@/lib/services/PostulacionRecursoService";
import type { PostulacionRecursoInput } from "@/lib/types/postulacion-recurso";

// Feature 253 (T3.4) — logica de negocio. Cubre R20, R24, R27, R28, R31, R32, R33 y el aviso de
// la campana (D6).

const TODOS_LOS_ROLES: RolValue[] = [
  "maestro",
  "admin",
  "mensajero",
  "adminTienda",
  "adminSatelite",
  "apiKey",
];
const ROLES_AUTORIZADOS: RolValue[] = ["maestro", "admin"];
const ROLES_NO_AUTORIZADOS = TODOS_LOS_ROLES.filter((r) => !ROLES_AUTORIZADOS.includes(r));

function actorCon(rol: RolValue): Actor {
  return { usuarioId: `usr-${rol}`, rol };
}

function repoDoble(
  overrides: Partial<IPostulacionRecursoRepository> = {},
): IPostulacionRecursoRepository {
  return {
    crear: vi.fn().mockResolvedValue({ id: "pr-1", createdAt: new Date("2026-08-20T10:00:00Z") }),
    listar: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    marcarAtendida: vi.fn().mockResolvedValue(1),
    findById: vi.fn().mockResolvedValue(null),
    purgarAtendidasAnterioresA: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

function loggerDoble(): { logger: ErrorLogger; registros: unknown[] } {
  const registros: unknown[] = [];
  return { logger: { logError: (e) => registros.push(e) }, registros };
}

const ENTRADA: PostulacionRecursoInput = {
  tipo: "vehiculo",
  nombre: "Ana Solis",
  telefono: "88888888",
  correo: "ana@ejemplo.com",
  mensaje: "Camion de 3 toneladas en Heredia",
};

describe("253 / R1 + R20 — `registrar` persiste lo NORMALIZADO", () => {
  it("recorta y baja el correo a minusculas antes de escribir", async () => {
    const repo = repoDoble();
    const service = new PostulacionRecursoService(repo);

    const r = await service.registrar({
      ...ENTRADA,
      nombre: "  Ana Solis  ",
      telefono: " 88888888 ",
      correo: "  ANA@Ejemplo.COM ",
      mensaje: "  Camion  ",
    });

    expect(r).toEqual({ status: "ok" });
    expect(repo.crear).toHaveBeenCalledWith({
      tipo: "vehiculo",
      nombre: "Ana Solis",
      telefono: "88888888",
      correo: "ana@ejemplo.com",
      mensaje: "Camion",
    });
  });
});

describe("253 / R2 — `registrar` NUNCA lanza: un fallo del repositorio sale como `error`", () => {
  it("devuelve `{ status: 'error' }` y deja el fallo registrado", async () => {
    const { logger, registros } = loggerDoble();
    const repo = repoDoble({ crear: vi.fn().mockRejectedValue(new Error("boom de prueba")) });

    const r = await new PostulacionRecursoService(repo, undefined, logger).registrar(ENTRADA);

    expect(r).toEqual({ status: "error" });
    expect(registros).toHaveLength(1);
    expect((registros[0] as Error).message).toBe("registro de postulacion de recurso fallo");
    expect(((registros[0] as Error).cause as Error).message).toBe("boom de prueba");
  });

  it("si el registro falla, el aviso de la campana NO se emite (no se avisa de lo que no existe)", async () => {
    const notificar = vi.fn().mockResolvedValue(undefined);
    const { logger } = loggerDoble();
    const repo = repoDoble({ crear: vi.fn().mockRejectedValue(new Error("boom")) });

    await new PostulacionRecursoService(repo, notificar, logger).registrar(ENTRADA);

    expect(notificar).not.toHaveBeenCalled();
  });
});

describe("253 / R19 — lo que se registra en logs no lleva mensaje, correo ni telefono", () => {
  it("ni en el camino feliz ni cuando el repositorio lanza", async () => {
    const secretos = ["ana@ejemplo.com", "88888888", "Camion de 3 toneladas en Heredia"];

    for (const crear of [
      vi.fn().mockResolvedValue({ id: "pr-1", createdAt: new Date() }),
      vi.fn().mockRejectedValue(new Error("fallo generico del driver")),
    ]) {
      const { logger, registros } = loggerDoble();
      await new PostulacionRecursoService(repoDoble({ crear }), undefined, logger).registrar(
        ENTRADA,
      );

      // Se aplana TODO lo registrado —mensaje, stack y la cadena de `cause`— y se busca cada
      // secreto ahi dentro. Mirar solo `String(error)` dejaria pasar un dato escondido en la causa.
      const texto = registros.map(aplanar).join("\n");
      for (const secreto of secretos) expect(texto).not.toContain(secreto);
    }
  });
});

/** Serializa un error con su stack y toda su cadena de `cause`. */
function aplanar(valor: unknown, profundidad = 0): string {
  if (profundidad > 5) return "";
  if (valor instanceof Error) {
    return [valor.message, valor.stack ?? "", aplanar(valor.cause, profundidad + 1)].join("\n");
  }
  try {
    return JSON.stringify(valor) ?? String(valor);
  } catch {
    return String(valor);
  }
}

describe("253 / R24 — registrar NO crea cuenta, ni sesion, ni fila en `usuario`", () => {
  it("el service solo depende de `IPostulacionRecursoRepository`, y solo llama a `crear`", async () => {
    const repo = repoDoble();
    await new PostulacionRecursoService(repo).registrar(ENTRADA);

    expect(repo.crear).toHaveBeenCalledTimes(1);
    // Ningun otro metodo del unico repositorio que conoce; y no conoce ningun otro repositorio.
    expect(repo.listar).not.toHaveBeenCalled();
    expect(repo.marcarAtendida).not.toHaveBeenCalled();
    expect(repo.findById).not.toHaveBeenCalled();
    expect(repo.purgarAtendidasAnterioresA).not.toHaveBeenCalled();
  });
});

describe("253 / D6 — el aviso de la campana", () => {
  it("se emite con el id y el tipo, y SIN un solo dato personal", async () => {
    const notificar = vi.fn().mockResolvedValue(undefined);
    const repo = repoDoble({
      crear: vi.fn().mockResolvedValue({ id: "pr-77", createdAt: new Date() }),
    });

    await new PostulacionRecursoService(repo, notificar).registrar(ENTRADA);

    expect(notificar).toHaveBeenCalledTimes(1);
    expect(notificar).toHaveBeenCalledWith({ postulacionId: "pr-77", tipo: "vehiculo" });
    const [ctx] = notificar.mock.calls[0] as [Record<string, unknown>];
    expect(Object.keys(ctx).sort()).toEqual(["postulacionId", "tipo"]);
  });

  it("por DEFECTO no hay notificador: un service sin cablear no escribe en `notificacion`", async () => {
    // El default es el no-op de la feature 146. Que no lance y devuelva `ok` es la comprobacion.
    const r = await new PostulacionRecursoService(repoDoble()).registrar(ENTRADA);
    expect(r).toEqual({ status: "ok" });
  });
});

describe("253 / R27 + R28 — quien ve el panel, un caso por rol del enum", () => {
  it.each(ROLES_AUTORIZADOS)("%s SI lista", async (rol) => {
    const repo = repoDoble();
    const r = await new PostulacionRecursoService(repo).listar(
      { atendidas: false, page: 1, pageSize: 20 },
      actorCon(rol),
    );
    expect(r.status).toBe("ok");
    expect(repo.listar).toHaveBeenCalledTimes(1);
  });

  it.each(ROLES_NO_AUTORIZADOS)(
    "%s recibe `forbidden` y el repositorio NO se toca (ni un `count`)",
    async (rol) => {
      const repo = repoDoble();
      const r = await new PostulacionRecursoService(repo).listar(
        { atendidas: false, page: 1, pageSize: 20 },
        actorCon(rol),
      );
      expect(r).toEqual({ status: "forbidden" });
      expect(repo.listar).not.toHaveBeenCalled();
    },
  );

  it.each(ROLES_NO_AUTORIZADOS)("%s tampoco puede atender", async (rol) => {
    const repo = repoDoble();
    const r = await new PostulacionRecursoService(repo).atender("pr-1", actorCon(rol));
    expect(r).toEqual({ status: "forbidden" });
    expect(repo.marcarAtendida).not.toHaveBeenCalled();
    expect(repo.findById).not.toHaveBeenCalled();
  });
});

describe("253 / R30 + R33 — paginacion y las dos pestanas", () => {
  it("traduce page/pageSize a skip/take y devuelve el total", async () => {
    const repo = repoDoble({ listar: vi.fn().mockResolvedValue({ items: [], total: 37 }) });
    const r = await new PostulacionRecursoService(repo).listar(
      { atendidas: false, page: 3, pageSize: 10 },
      actorCon("admin"),
    );

    expect(repo.listar).toHaveBeenCalledWith({ atendidas: false, skip: 20, take: 10 });
    expect(r).toMatchObject({ status: "ok", page: 3, pageSize: 10, total: 37 });
  });

  it("R33: el filtro `atendidas` llega al repositorio en sus DOS valores", async () => {
    for (const atendidas of [false, true]) {
      const repo = repoDoble();
      await new PostulacionRecursoService(repo).listar(
        { atendidas, page: 1, pageSize: 20 },
        actorCon("maestro"),
      );
      expect(repo.listar).toHaveBeenCalledWith({ atendidas, skip: 0, take: 20 });
    }
  });

  it("R29: proyecta la fila entera a DTO, con instantes ISO y el NOMBRE de quien atendio", async () => {
    const repo = repoDoble({
      listar: vi.fn().mockResolvedValue({
        items: [
          {
            id: "pr-1",
            tipo: "bodega",
            nombre: "Ana Solis",
            telefono: "88888888",
            correo: "ana@ejemplo.com",
            mensaje: "200 m2 en Alajuela",
            createdAt: new Date("2026-08-19T15:04:05.000Z"),
            atendidaAt: new Date("2026-08-20T09:00:00.000Z"),
            atendidaPorNombre: "Marta",
          },
        ],
        total: 1,
      }),
    });

    const r = await new PostulacionRecursoService(repo).listar(
      { atendidas: true, page: 1, pageSize: 20 },
      actorCon("maestro"),
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.items[0]).toEqual({
      id: "pr-1",
      tipo: "bodega",
      nombre: "Ana Solis",
      telefono: "88888888",
      correo: "ana@ejemplo.com",
      mensaje: "200 m2 en Alajuela",
      createdAt: "2026-08-19T15:04:05.000Z",
      atendidaAt: "2026-08-20T09:00:00.000Z",
      atendidaPor: "Marta",
    });
  });
});

describe("253 / R31 + R32 — atender una vez, y la segunda es `conflict`", () => {
  it("R31: registra quien y cuando, y devuelve el instante", async () => {
    const ahora = new Date("2026-08-20T12:34:56.000Z");
    const repo = repoDoble();
    const service = new PostulacionRecursoService(repo, undefined, undefined, () => ahora);

    const r = await service.atender("pr-1", actorCon("admin"));

    expect(r).toEqual({ status: "ok", id: "pr-1", atendidaAt: "2026-08-20T12:34:56.000Z" });
    expect(repo.marcarAtendida).toHaveBeenCalledWith("pr-1", "usr-admin", ahora);
  });

  it("R32: `count === 0` y la fila existe -> `conflict`, sin sobrescribir nada", async () => {
    const repo = repoDoble({
      marcarAtendida: vi.fn().mockResolvedValue(0),
      findById: vi
        .fn()
        .mockResolvedValue({ id: "pr-1", atendidaAt: new Date("2026-08-19T00:00:00Z") }),
    });

    const r = await new PostulacionRecursoService(repo).atender("pr-1", actorCon("maestro"));

    expect(r).toEqual({ status: "conflict" });
    expect(repo.marcarAtendida).toHaveBeenCalledTimes(1); // no reintenta
  });

  it("R32: `count === 0` y la fila NO existe -> `not_found` (distinguible de `conflict`)", async () => {
    const repo = repoDoble({
      marcarAtendida: vi.fn().mockResolvedValue(0),
      findById: vi.fn().mockResolvedValue(null),
    });

    const r = await new PostulacionRecursoService(repo).atender("pr-1", actorCon("maestro"));

    expect(r).toEqual({ status: "not_found" });
  });

  it("cuando el update SI aplica, no se reconsulta la base", async () => {
    const repo = repoDoble();
    await new PostulacionRecursoService(repo).atender("pr-1", actorCon("admin"));
    expect(repo.findById).not.toHaveBeenCalled();
  });
});
