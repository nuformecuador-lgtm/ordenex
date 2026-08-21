import { describe, it, expect, vi } from "vitest";
import type {
  CrearNotificacionInput,
  INotificacionRepository,
} from "@/lib/interfaces/repositories/INotificacionRepository";
import {
  TEXTO_POSTULACION_RECURSO_PENDIENTE,
  emitirPostulacionRecursoPendiente,
} from "@/lib/notificaciones/emitir";
import {
  notificadorNoOp,
  notificarPostulacionRecursoPendienteCon,
} from "@/lib/notificaciones/notificadores";
import { PostulacionRecursoService } from "@/lib/services/PostulacionRecursoService";
import type { IPostulacionRecursoRepository } from "@/lib/interfaces/repositories/IPostulacionRecursoRepository";
import type { ErrorLogger } from "@/lib/errors";

// Feature 253 (D6, FIRMADA EN CONTRA de la recomendacion del spec) — el aviso de la campana
// cuando llega una postulacion de vehiculo o bodega. Camino REAL del notificador, con el
// repositorio de notificaciones inyectado: la misma funcion que usa el binding de produccion.

class RepoNotificaciones implements INotificacionRepository {
  creadas: CrearNotificacionInput[] = [];
  async crear(input: CrearNotificacionInput): Promise<boolean> {
    this.creadas.push(input);
    return true;
  }
  existeNoLeidaPara = vi.fn().mockResolvedValue(false);
  listarParaUsuario = vi.fn().mockResolvedValue([]);
  verificarVisible = vi.fn().mockResolvedValue("visible" as const);
  marcarTodasLeidas = vi.fn().mockResolvedValue(0);
  descartar = vi.fn().mockResolvedValue(undefined);
}

class RepoQueFalla extends RepoNotificaciones {
  override async crear(): Promise<boolean> {
    throw new Error("base caida");
  }
}

describe("253 / D6 — el emisor produce DOS filas, a maestro y admin", () => {
  it("una por rol, `warning`, con el evento y la entidad nuevos", async () => {
    const repo = new RepoNotificaciones();

    const creadas = await emitirPostulacionRecursoPendiente(repo, {
      postulacionId: "pr-1",
      tipo: "vehiculo",
    });

    expect(creadas).toBe(2);
    expect(repo.creadas.map((c) => c.destinatario)).toEqual([
      { tipo: "rol", rol: "maestro" },
      { tipo: "rol", rol: "admin" },
    ]);
    for (const fila of repo.creadas) {
      expect(fila.tipo).toBe("warning");
      expect(fila.evento).toBe("postulacion_recurso_pendiente");
      // ⛔ `postulacion_recurso`, NO `usuario`: esta postulacion no crea ninguna cuenta.
      expect(fila.entidadTipo).toBe("postulacion_recurso");
      expect(fila.entidadId).toBe("pr-1");
    }
  });

  it("el anexo es el TIPO, no la persona: el aviso no lleva ni un dato personal (R19)", async () => {
    const repo = new RepoNotificaciones();
    await emitirPostulacionRecursoPendiente(repo, { postulacionId: "pr-1", tipo: "bodega" });
    expect(repo.creadas[0].anexo).toBe("Bodega");

    const repo2 = new RepoNotificaciones();
    await emitirPostulacionRecursoPendiente(repo2, { postulacionId: "pr-2", tipo: "vehiculo" });
    expect(repo2.creadas[0].anexo).toBe("Vehiculo");
  });

  it("el texto es literal y no promete nada que no ocurra", () => {
    // Literal a proposito: es lo que lee una persona en la campana.
    expect(TEXTO_POSTULACION_RECURSO_PENDIENTE).toBe(
      "Alguien ofreció un vehículo o una bodega desde la web.",
    );
  });

  it("la dedupe de la 146 aplica: con un aviso NO leido vivo, no se emite otro", async () => {
    const repo = new RepoNotificaciones();
    repo.existeNoLeidaPara = vi.fn().mockResolvedValue(true);

    const creadas = await emitirPostulacionRecursoPendiente(repo, {
      postulacionId: "pr-1",
      tipo: "vehiculo",
    });

    expect(creadas).toBe(0);
    expect(repo.creadas).toHaveLength(0);
  });
});

describe("253 / D6 — el notificador es BEST-EFFORT: su fallo no tumba la postulacion", () => {
  it("absorbe el fallo del repositorio y lo registra, sin propagarlo", async () => {
    const registros: unknown[] = [];
    const logger: ErrorLogger = { logError: (e) => registros.push(e) };

    await expect(
      notificarPostulacionRecursoPendienteCon(new RepoQueFalla(), logger)({
        postulacionId: "pr-1",
        tipo: "vehiculo",
      }),
    ).resolves.toBeUndefined();

    expect(registros).toHaveLength(1);
    expect((registros[0] as Error).message).toContain("postulacion_recurso_pendiente");
  });

  it("un aviso que revienta NO impide que la postulacion quede registrada (`ok`)", async () => {
    // Es la parte que importa de verdad: la campana no puede decidir si se guarda lo que alguien
    // escribio en la landing. Si pudiera, un fallo de la campana se leeria en la pantalla publica
    // como "no pudimos registrar tu postulacion" — la mentira que esta ficha viene a cerrar.
    const repoPostulaciones: IPostulacionRecursoRepository = {
      crear: vi.fn().mockResolvedValue({ id: "pr-1", createdAt: new Date() }),
      listar: vi.fn(),
      marcarAtendida: vi.fn(),
      findById: vi.fn(),
      purgarAtendidasAnterioresA: vi.fn(),
    };
    const logger: ErrorLogger = { logError: () => {} };
    const notificador = notificarPostulacionRecursoPendienteCon(new RepoQueFalla(), logger);

    const r = await new PostulacionRecursoService(repoPostulaciones, notificador).registrar({
      tipo: "vehiculo",
      nombre: "Ana",
      telefono: "88888888",
      correo: "ana@ejemplo.com",
      mensaje: "camion",
    });

    expect(r).toEqual({ status: "ok" });
    expect(repoPostulaciones.crear).toHaveBeenCalledTimes(1);
  });

  it("el NO-OP compartido acepta tambien este contexto (default de un service sin cablear)", async () => {
    await expect(
      notificadorNoOp({ postulacionId: "pr-1", tipo: "bodega" }),
    ).resolves.toBeUndefined();
  });
});
