import { describe, it, expect, vi } from "vitest";
import type {
  CrearNotificacionInput,
  INotificacionRepository,
} from "@/lib/interfaces/repositories/INotificacionRepository";
import {
  emitirCargaMasivaTerminada,
  emitirCierreDiaPorAprobar,
  emitirPostulacionPendiente,
} from "@/lib/notificaciones/emitir";
import { emitirBestEffort } from "@/lib/notificaciones/notificadores";

// Feature 146 — B12/B14/B15/B16. Productores BEST-EFFORT (postulacion, cierre por aprobar y
// carga masiva) y su dedupe. Cubre R22, R23, R24, R25 y R27.

/** Repositorio falso que aplica de verdad la dedupe por (evento, entidad, destinatario). */
class RepoFake implements INotificacionRepository {
  creadas: CrearNotificacionInput[] = [];
  /** Entidades cuya notificacion ya fue LEIDA (y por tanto vuelven a ser emitibles). */
  leidas = new Set<string>();

  async crear(input: CrearNotificacionInput): Promise<boolean> {
    this.creadas.push(input);
    return true;
  }

  async existeNoLeidaPara(
    evento: string,
    entidadId: string,
    destinatario: { tipo: string; rol?: string; usuarioId?: string },
  ): Promise<boolean> {
    const clave = `${evento}|${entidadId}|${JSON.stringify(destinatario)}`;
    if (this.leidas.has(clave)) return false;
    return this.creadas.some(
      (c) =>
        c.evento === evento &&
        c.entidadId === entidadId &&
        JSON.stringify(c.destinatario) === JSON.stringify(destinatario),
    );
  }

  listarParaUsuario = vi.fn().mockResolvedValue([]);
  verificarVisible = vi.fn().mockResolvedValue("visible" as const);
  marcarTodasLeidas = vi.fn().mockResolvedValue(0);
  descartar = vi.fn().mockResolvedValue(undefined);
}

describe("R23 — la postulacion de mensajero avisa a maestro y admin", () => {
  it("emite DOS filas warning sin alcance, referenciando al postulante", async () => {
    const repo = new RepoFake();

    const emitidas = await emitirPostulacionPendiente(repo, {
      postulanteId: "u-9",
      nombre: "Ana Pérez",
    });

    expect(emitidas).toBe(2);
    expect(repo.creadas.map((c) => c.destinatario)).toEqual([
      { tipo: "rol", rol: "maestro" },
      { tipo: "rol", rol: "admin" },
    ]);
    for (const fila of repo.creadas) {
      expect(fila.tipo).toBe("warning");
      expect(fila.evento).toBe("postulacion_mensajero_pendiente");
      expect(fila.entidadTipo).toBe("usuario");
      expect(fila.entidadId).toBe("u-9");
      expect(fila.anexo).toBe("Ana Pérez");
      expect(fila.descripcion).toBe(
        "Una postulación de mensajero está pendiente de aprobación.",
      );
    }
  });

  it("no emite a ningun otro rol (mensajero, adminTienda, adminSatelite ni apiKey)", async () => {
    const repo = new RepoFake();
    await emitirPostulacionPendiente(repo, { postulanteId: "u-9", nombre: "Ana" });
    const roles = repo.creadas.map((c) =>
      c.destinatario.tipo === "rol" ? c.destinatario.rol : "usuario",
    );
    expect(roles).not.toContain("mensajero");
    expect(roles).not.toContain("adminTienda");
    expect(roles).not.toContain("adminSatelite");
    expect(roles).not.toContain("apiKey");
  });
});

describe("R24 — el cierre por aprobar avisa a maestro, admin y al satelite de la zona", () => {
  it("emite TRES filas warning, la tercera acotada a la zona destino del cierre", async () => {
    const repo = new RepoFake();

    const emitidas = await emitirCierreDiaPorAprobar(repo, {
      cierreId: "c-1",
      zonaId: "zona-3",
      mensajeroNombre: "Luis",
    });

    expect(emitidas).toBe(3);
    expect(repo.creadas.map((c) => c.destinatario)).toEqual([
      { tipo: "rol", rol: "maestro" },
      { tipo: "rol", rol: "admin" },
      { tipo: "rol", rol: "adminSatelite", zonaId: "zona-3" },
    ]);
    for (const fila of repo.creadas) {
      expect(fila.tipo).toBe("warning");
      expect(fila.evento).toBe("cierre_dia_por_aprobar");
      expect(fila.entidadTipo).toBe("cierre_dia");
      expect(fila.entidadId).toBe("c-1");
      expect(fila.descripcion).toBe("Un mensajero envió su cierre del día para aprobación.");
      expect(fila.anexo).toBe("Luis");
    }
  });

  it("omite la fila del satelite si el cierre no tiene zona destino", async () => {
    const repo = new RepoFake();

    const emitidas = await emitirCierreDiaPorAprobar(repo, {
      cierreId: "c-1",
      zonaId: null,
      mensajeroNombre: "Luis",
    });

    expect(emitidas).toBe(2);
    expect(repo.creadas.map((c) => c.destinatario)).toEqual([
      { tipo: "rol", rol: "maestro" },
      { tipo: "rol", rol: "admin" },
    ]);
  });
});

describe("R27 — la re-solicitud del mismo cierre no genera un segundo aviso", () => {
  it("la segunda emision del mismo cierre no crea ninguna fila", async () => {
    const repo = new RepoFake();
    const ctx = { cierreId: "c-1", zonaId: "zona-3", mensajeroNombre: "Luis" };

    expect(await emitirCierreDiaPorAprobar(repo, ctx)).toBe(3);
    expect(await emitirCierreDiaPorAprobar(repo, ctx)).toBe(0);

    expect(repo.creadas).toHaveLength(3);
  });

  it("vuelve a emitir para el destinatario que YA leyo el aviso anterior", async () => {
    const repo = new RepoFake();
    const ctx = { cierreId: "c-1", zonaId: "zona-3", mensajeroNombre: "Luis" };
    await emitirCierreDiaPorAprobar(repo, ctx);
    // el maestro leyo el suyo; los otros dos siguen sin leer.
    repo.leidas.add(
      `cierre_dia_por_aprobar|c-1|${JSON.stringify({ tipo: "rol", rol: "maestro" })}`,
    );

    expect(await emitirCierreDiaPorAprobar(repo, ctx)).toBe(1);
    expect(repo.creadas).toHaveLength(4);
  });

  it("un cierre DISTINTO si genera su propio aviso", async () => {
    const repo = new RepoFake();
    await emitirCierreDiaPorAprobar(repo, { cierreId: "c-1", zonaId: null, mensajeroNombre: null });
    await emitirCierreDiaPorAprobar(repo, { cierreId: "c-2", zonaId: null, mensajeroNombre: null });

    expect(repo.creadas).toHaveLength(4);
  });
});

describe("R22 — la carga masiva terminada avisa al ejecutor con el numero de creadas", () => {
  it("emite UNA fila box al usuario ejecutor con las creadas en la descripcion", async () => {
    const repo = new RepoFake();

    const emitidas = await emitirCargaMasivaTerminada(repo, {
      usuarioId: "api-user-1",
      creadas: 128,
      total: 130,
      loteId: "lote-1",
    });

    expect(emitidas).toBe(1);
    expect(repo.creadas[0]).toMatchObject({
      tipo: "box",
      evento: "carga_masiva_terminada",
      entidadTipo: "carga",
      entidadId: "lote-1",
      destinatario: { tipo: "usuario", usuarioId: "api-user-1" },
    });
    expect(repo.creadas[0].descripcion).toBe("Carga masiva terminada: 128 órdenes cargadas.");
    expect(repo.creadas[0].anexo).toBe("130 filas");
  });

  it("singulariza el texto cuando se cargo una sola orden", async () => {
    const repo = new RepoFake();
    await emitirCargaMasivaTerminada(repo, {
      usuarioId: "u-1",
      creadas: 1,
      total: 1,
      loteId: "lote-2",
    });
    expect(repo.creadas[0].descripcion).toBe("Carga masiva terminada: 1 orden cargada.");
    expect(repo.creadas[0].anexo).toBe("1 fila");
  });

  it("no notifica a ningun rol: el evento tiene dueño natural, no destinatario por rol", async () => {
    const repo = new RepoFake();
    await emitirCargaMasivaTerminada(repo, {
      usuarioId: "u-1",
      creadas: 3,
      total: 3,
      loteId: "lote-3",
    });
    expect(repo.creadas.every((c) => c.destinatario.tipo === "usuario")).toBe(true);
  });
});

describe("R25 — un productor que falla no rompe la operacion de negocio", () => {
  it("emitirBestEffort absorbe el error y lo registra con la operacion", async () => {
    const logError = vi.fn();

    await expect(
      emitirBestEffort(
        "cierre_dia_por_aprobar",
        async () => {
          throw new Error("DB caida");
        },
        { logError },
      ),
    ).resolves.toBeUndefined();

    expect(logError).toHaveBeenCalledTimes(1);
    const registrado = logError.mock.calls[0][0] as Error;
    expect(registrado.message).toContain("cierre_dia_por_aprobar");
    expect((registrado.cause as Error).message).toBe("DB caida");
  });

  it("no registra nada cuando el productor termina bien", async () => {
    const logError = vi.fn();
    await emitirBestEffort("carga_masiva_terminada", async () => 1, { logError });
    expect(logError).not.toHaveBeenCalled();
  });
});
