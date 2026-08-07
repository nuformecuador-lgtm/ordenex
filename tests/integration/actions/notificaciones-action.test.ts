import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import {
  listarNotificaciones,
  marcarTodasLeidas,
  descartarNotificacion,
  notificarCargaMasivaTerminada,
} from "@/lib/actions/notificaciones";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { INotificacionService } from "@/lib/interfaces/services/INotificacionService";
import { NotificacionService } from "@/lib/services/NotificacionService";
import type {
  CrearNotificacionInput,
  INotificacionRepository,
} from "@/lib/interfaces/repositories/INotificacionRepository";

// Feature 146 — B11. Integration del BORDE (Server Actions) con actor y service falsos.
// Cubre R34, R36, R38 y R39.

const ACTOR: Actor = { usuarioId: "actor-1", rol: "adminTienda", zonaId: null };
const getActor = async (): Promise<Actor | null> => ACTOR;
const sinActor = async (): Promise<Actor | null> => null;

function fakeService(overrides: Partial<INotificacionService> = {}): INotificacionService {
  return {
    listar: vi.fn().mockResolvedValue({ status: "ok", items: [], noLeidas: 0 }),
    marcarLeida: vi.fn().mockResolvedValue({ status: "ok" }),
    marcarTodasLeidas: vi.fn().mockResolvedValue({ status: "ok", marcadas: 0 }),
    descartar: vi.fn().mockResolvedValue({ status: "ok" }),
    notificarCargaTerminada: vi.fn().mockResolvedValue({ status: "ok" }),
    ...overrides,
  };
}

const LOTE = "3f1d1e3a-9a1e-4a53-8f6c-2a5b0f6c7d81";

describe("R34 — sin sesion valida ninguna accion lee ni escribe notificaciones", () => {
  it("listarNotificaciones responde unauthenticated sin tocar el service", async () => {
    const service = fakeService();
    const r = await listarNotificaciones({ service, getActor: sinActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.listar).not.toHaveBeenCalled();
  });

  it("marcarTodasLeidas responde unauthenticated sin tocar el service", async () => {
    const service = fakeService();
    const r = await marcarTodasLeidas({ service, getActor: sinActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.marcarTodasLeidas).not.toHaveBeenCalled();
  });

  it("descartarNotificacion responde unauthenticated sin tocar el service", async () => {
    const service = fakeService();
    const r = await descartarNotificacion("n-1", { service, getActor: sinActor });
    expect(r.status).toBe("unauthenticated");
    expect(service.descartar).not.toHaveBeenCalled();
  });

  it("notificarCargaMasivaTerminada responde unauthenticated sin tocar el service", async () => {
    const service = fakeService();
    const r = await notificarCargaMasivaTerminada(
      { creadas: 1, total: 1, loteId: LOTE },
      { service, getActor: sinActor },
    );
    expect(r.status).toBe("unauthenticated");
    expect(service.notificarCargaTerminada).not.toHaveBeenCalled();
  });
});

describe("R36 — entrada mal formada -> validation_error sin tocar la base de datos", () => {
  // Ejercia `marcarNotificacionLeida`, borrada el 2026-08-07. La rama del schema que probaba
  // (cadena VACIA, distinta de «no es texto») vive en `idValidado`, compartido por las acciones
  // que quedan, asi que se reapunta a `descartarNotificacion` en vez de perderse.
  it("rechaza un id vacio al descartar", async () => {
    const service = fakeService();
    const r = await descartarNotificacion("", { service, getActor });
    expect(r.status).toBe("validation_error");
    expect(service.descartar).not.toHaveBeenCalled();
  });

  it("rechaza un id que no es texto al descartar", async () => {
    const service = fakeService();
    const r = await descartarNotificacion(42, { service, getActor });
    expect(r.status).toBe("validation_error");
    expect(service.descartar).not.toHaveBeenCalled();
  });

  it("rechaza contadores no enteros o negativos en la carga terminada", async () => {
    const service = fakeService();
    for (const input of [
      { creadas: -1, total: 5, loteId: LOTE },
      { creadas: 1.5, total: 5, loteId: LOTE },
      { creadas: 2, total: -3, loteId: LOTE },
    ]) {
      const r = await notificarCargaMasivaTerminada(input, { service, getActor });
      expect(r.status).toBe("validation_error");
    }
    expect(service.notificarCargaTerminada).not.toHaveBeenCalled();
  });

  it("rechaza que las creadas superen el total", async () => {
    const service = fakeService();
    const r = await notificarCargaMasivaTerminada(
      { creadas: 9, total: 5, loteId: LOTE },
      { service, getActor },
    );
    expect(r.status).toBe("validation_error");
    expect(service.notificarCargaTerminada).not.toHaveBeenCalled();
  });

  it("rechaza un loteId que no es uuid", async () => {
    const service = fakeService();
    const r = await notificarCargaMasivaTerminada(
      { creadas: 1, total: 1, loteId: "lote-1" },
      { service, getActor },
    );
    expect(r.status).toBe("validation_error");
    expect(service.notificarCargaTerminada).not.toHaveBeenCalled();
  });
});

describe("R38 — las operaciones son Server Actions, no rutas API internas", () => {
  const ROOT = path.join(__dirname, "..", "..", "..");

  it("el modulo de acciones declara 'use server'", () => {
    const fuente = fs.readFileSync(path.join(ROOT, "lib", "actions", "notificaciones.ts"), "utf8");
    expect(fuente.trimStart().startsWith('"use server"')).toBe(true);
  });

  it("no existe ninguna ruta API de notificaciones bajo app/api", () => {
    const apiDir = path.join(ROOT, "app", "api");
    const rutas = fs
      .readdirSync(apiDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    expect(rutas).not.toContain("notificaciones");
    expect(rutas).not.toContain("notificacion");
  });

  it("ningun modulo de la feature hace fetch a una ruta de notificaciones", () => {
    for (const relativo of [
      ["lib", "actions", "notificaciones.ts"],
      ["lib", "services", "NotificacionService.ts"],
      ["lib", "repositories", "NotificacionRepository.ts"],
      ["lib", "notificaciones", "emitir.ts"],
    ]) {
      const fuente = fs.readFileSync(path.join(ROOT, ...relativo), "utf8");
      expect(fuente).not.toMatch(/fetch\(/);
    }
  });

  // Eran cinco hasta el 2026-08-07; `marcarNotificacionLeida` se borro por no tener boton.
  it("las cuatro acciones estan exportadas como funciones async", () => {
    for (const accion of [
      listarNotificaciones,
      marcarTodasLeidas,
      descartarNotificacion,
      notificarCargaMasivaTerminada,
    ]) {
      expect(typeof accion).toBe("function");
    }
  });
});

describe("R39 — la carga terminada notifica SOLO al ejecutor y una sola vez por lote", () => {
  /** Repositorio falso que aplica la dedupe real por (evento, entidad, destinatario). */
  class RepoDedupe implements INotificacionRepository {
    creadas: CrearNotificacionInput[] = [];

    async crear(input: CrearNotificacionInput): Promise<boolean> {
      this.creadas.push(input);
      return true;
    }
    async existeNoLeidaPara(evento: string, entidadId: string): Promise<boolean> {
      return this.creadas.some((c) => c.evento === evento && c.entidadId === entidadId);
    }
    listarParaUsuario = vi.fn().mockResolvedValue([]);
    verificarVisible = vi.fn().mockResolvedValue("visible" as const);
    marcarLeida = vi.fn().mockResolvedValue(undefined);
    marcarTodasLeidas = vi.fn().mockResolvedValue(0);
    descartar = vi.fn().mockResolvedValue(undefined);
  }

  it("usa siempre el actor autenticado como destinatario, sin parametro para designarlo", async () => {
    const repo = new RepoDedupe();
    const service = new NotificacionService(repo);

    const r = await notificarCargaMasivaTerminada(
      // el input trae un intento de designar a otro usuario: la accion lo ignora porque
      // el schema no lo contempla y el destinatario se fija server-side.
      { creadas: 3, total: 4, loteId: LOTE, destinatarioUsuarioId: "otro-usuario" },
      { service, getActor },
    );

    expect(r.status).toBe("ok");
    expect(repo.creadas).toHaveLength(1);
    expect(repo.creadas[0].destinatario).toEqual({ tipo: "usuario", usuarioId: "actor-1" });
    expect(repo.creadas[0].entidadId).toBe(LOTE);
    expect(repo.creadas[0].descripcion).toContain("3");
  });

  it("una segunda invocacion con el mismo loteId no crea otra notificacion", async () => {
    const repo = new RepoDedupe();
    const service = new NotificacionService(repo);
    const input = { creadas: 3, total: 4, loteId: LOTE };

    const primera = await notificarCargaMasivaTerminada(input, { service, getActor });
    const segunda = await notificarCargaMasivaTerminada(input, { service, getActor });

    expect(primera.status).toBe("ok");
    expect(segunda.status).toBe("ok"); // el reintento del cliente no es un error
    expect(repo.creadas).toHaveLength(1);
  });

  it("un lote DISTINTO si produce su propia notificacion", async () => {
    const repo = new RepoDedupe();
    const service = new NotificacionService(repo);

    await notificarCargaMasivaTerminada({ creadas: 1, total: 1, loteId: LOTE }, { service, getActor });
    await notificarCargaMasivaTerminada(
      { creadas: 2, total: 2, loteId: "9c2f2c1b-5f4a-4c6d-9a3e-1b7c8d9e0f11" },
      { service, getActor },
    );

    expect(repo.creadas).toHaveLength(2);
  });
});

describe("las acciones traducen el resultado de dominio al contrato de la campana", () => {
  // El `forbidden` lo propagaba `marcarNotificacionLeida` (borrada el 2026-08-07); los dos
  // status siguen probados sobre `descartarNotificacion`, que recorre el mismo `toActionError`.
  it("propaga forbidden y not_found del service", async () => {
    const forbidden = fakeService({
      descartar: vi.fn().mockResolvedValue({ status: "forbidden" }),
    });
    const noEncontrado = fakeService({
      descartar: vi.fn().mockResolvedValue({ status: "not_found" }),
    });
    expect(await descartarNotificacion("n-1", { service: forbidden, getActor })).toEqual({
      status: "forbidden",
    });
    expect(await descartarNotificacion("n-1", { service: noEncontrado, getActor })).toEqual({
      status: "not_found",
    });
  });

  it("devuelve items y contador del listado", async () => {
    const service = fakeService({
      listar: vi.fn().mockResolvedValue({
        status: "ok",
        items: [
          {
            id: "n-1",
            notification_type: "alert",
            description: "d",
            read: false,
            createdAt: "2026-07-27T12:00:00.000Z",
          },
        ],
        noLeidas: 1,
      }),
    });

    const r = await listarNotificaciones({ service, getActor });

    expect(r).toMatchObject({ status: "ok", noLeidas: 1 });
  });
});
