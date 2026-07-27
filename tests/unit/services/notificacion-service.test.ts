import { describe, it, expect, vi } from "vitest";
import type {
  INotificacionRepository,
  ListarParaUsuarioInput,
  NotificacionActor,
  NotificacionRow,
} from "@/lib/interfaces/repositories/INotificacionRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { NotificacionService } from "@/lib/services/NotificacionService";
import { notificacionesConfig } from "@/lib/config/notificaciones";

// Feature 146 — B9. Tests unit del service con repositorio FALSO en memoria (sin DB): el
// repo aplica de verdad el descarte, el limite y la ventana, para que el test compruebe
// COMPORTAMIENTO y no llamadas. Cubre R3, R28-R33, R35 y R37.

const AHORA = new Date("2026-07-27T12:00:00.000Z");
const now = () => AHORA;

interface FilaFake {
  id: string;
  tipo: "alert" | "box" | "warning";
  descripcion: string;
  anexo: string | null;
  createdAt: Date;
  /** Destinatarios que la ven (simplificacion: el alcance real se prueba en B7). */
  visiblePara: string[];
}

interface LecturaFake {
  notificacionId: string;
  usuarioId: string;
  leidaAt: Date | null;
  descartadaAt: Date | null;
}

/**
 * Repositorio FALSO en memoria. Implementa la semantica del real (ausencia de fila = no
 * leida y no descartada; ventana; limite; unico por (notificacion, usuario)) sin Prisma.
 */
class RepoFake implements INotificacionRepository {
  lecturas: LecturaFake[] = [];

  constructor(public filas: FilaFake[] = []) {}

  crear = vi.fn(async () => true);
  existeNoLeidaPara = vi.fn(async () => false);

  async listarParaUsuario(input: ListarParaUsuarioInput): Promise<NotificacionRow[]> {
    return this.filas
      .filter((f) => f.visiblePara.includes(input.actor.usuarioId))
      .filter((f) => f.createdAt.getTime() >= input.desde.getTime())
      .filter((f) => !this.marca(f.id, input.actor.usuarioId)?.descartadaAt)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, input.limite)
      .map((f) => ({
        id: f.id,
        tipo: f.tipo,
        descripcion: f.descripcion,
        anexo: f.anexo,
        createdAt: f.createdAt,
        leida: this.marca(f.id, input.actor.usuarioId)?.leidaAt != null,
      }));
  }

  async verificarVisible(
    id: string,
    actor: NotificacionActor,
  ): Promise<"visible" | "no_visible" | "no_existe"> {
    const fila = this.filas.find((f) => f.id === id);
    if (!fila) return "no_existe";
    return fila.visiblePara.includes(actor.usuarioId) ? "visible" : "no_visible";
  }

  async marcarLeida(notificacionId: string, usuarioId: string, ahora: Date): Promise<void> {
    const existente = this.marca(notificacionId, usuarioId);
    if (existente) return; // la primera lectura manda (idempotente, R37)
    this.lecturas.push({ notificacionId, usuarioId, leidaAt: ahora, descartadaAt: null });
  }

  async marcarTodasLeidas(
    actor: NotificacionActor,
    desde: Date,
    ahora: Date,
  ): Promise<number> {
    const pendientes = await this.listarParaUsuario({
      actor,
      desde,
      limite: Number.MAX_SAFE_INTEGER,
    });
    let marcadas = 0;
    for (const fila of pendientes) {
      if (this.marca(fila.id, actor.usuarioId)) continue;
      this.lecturas.push({
        notificacionId: fila.id,
        usuarioId: actor.usuarioId,
        leidaAt: ahora,
        descartadaAt: null,
      });
      marcadas += 1;
    }
    return marcadas;
  }

  async descartar(notificacionId: string, usuarioId: string, ahora: Date): Promise<void> {
    const existente = this.marca(notificacionId, usuarioId);
    if (existente) {
      existente.descartadaAt = ahora;
      existente.leidaAt = existente.leidaAt ?? ahora;
      return;
    }
    this.lecturas.push({ notificacionId, usuarioId, leidaAt: ahora, descartadaAt: ahora });
  }

  private marca(notificacionId: string, usuarioId: string): LecturaFake | undefined {
    return this.lecturas.find(
      (l) => l.notificacionId === notificacionId && l.usuarioId === usuarioId,
    );
  }
}

function fila(id: string, opts: Partial<FilaFake> = {}): FilaFake {
  return {
    id,
    tipo: "alert",
    descripcion: `desc ${id}`,
    anexo: null,
    createdAt: AHORA,
    visiblePara: ["admin-1", "admin-2"],
    ...opts,
  };
}

const ADMIN_1: Actor = { usuarioId: "admin-1", rol: "admin", zonaId: null };
const ADMIN_2: Actor = { usuarioId: "admin-2", rol: "admin", zonaId: null };

function servicioCon(repo: RepoFake) {
  return new NotificacionService(repo, now);
}

describe("R28 — el listado devuelve lo visible y no descartado, de mas reciente a mas antiguo", () => {
  it("ordena por fecha descendente", async () => {
    const repo = new RepoFake([
      fila("vieja", { createdAt: new Date("2026-07-20T00:00:00.000Z") }),
      fila("nueva", { createdAt: new Date("2026-07-26T00:00:00.000Z") }),
      fila("media", { createdAt: new Date("2026-07-24T00:00:00.000Z") }),
    ]);

    const r = await servicioCon(repo).listar(ADMIN_1);

    expect(r.items.map((i) => i.id)).toEqual(["nueva", "media", "vieja"]);
  });

  it("mapea la fila al DTO que consume la campana, con el anexo solo si existe", async () => {
    const repo = new RepoFake([fila("n-1", { tipo: "box", anexo: "REM-0042" }), fila("n-2")]);

    const r = await servicioCon(repo).listar(ADMIN_1);

    expect(r.items[0]).toEqual({
      id: "n-1",
      notification_type: "box",
      description: "desc n-1",
      anexo: "REM-0042",
      read: false,
      createdAt: AHORA.toISOString(),
    });
    expect(r.items[1]).not.toHaveProperty("anexo");
  });
});

describe("R29 — el listado se acota a 30 dias y a 50 elementos", () => {
  it("pide al repositorio la ventana de VENTANA_DIAS y el limite PAGE_SIZE", async () => {
    const repo = new RepoFake([]);
    const spy = vi.spyOn(repo, "listarParaUsuario");

    await servicioCon(repo).listar(ADMIN_1);

    const arg = spy.mock.calls[0][0];
    expect(arg.limite).toBe(notificacionesConfig.PAGE_SIZE);
    expect(arg.limite).toBe(50);
    const dias = (AHORA.getTime() - arg.desde.getTime()) / (24 * 60 * 60 * 1000);
    expect(dias).toBe(notificacionesConfig.VENTANA_DIAS);
    expect(dias).toBe(30);
  });

  it("deja fuera lo creado antes de la ventana", async () => {
    const repo = new RepoFake([
      fila("dentro", { createdAt: new Date("2026-07-26T00:00:00.000Z") }),
      fila("fuera", { createdAt: new Date("2026-05-01T00:00:00.000Z") }),
    ]);

    const r = await servicioCon(repo).listar(ADMIN_1);

    expect(r.items.map((i) => i.id)).toEqual(["dentro"]);
  });

  it("nunca devuelve mas de 50 elementos", async () => {
    const repo = new RepoFake(
      Array.from({ length: 120 }, (_, i) =>
        fila(`n-${i}`, { createdAt: new Date(AHORA.getTime() - i * 1000) }),
      ),
    );

    const r = await servicioCon(repo).listar(ADMIN_1);

    expect(r.items).toHaveLength(50);
  });
});

describe("R30 — el listado indica lectura por usuario y cuenta las no leidas", () => {
  it("el contador se calcula sobre el mismo conjunto que se devuelve", async () => {
    const repo = new RepoFake([fila("n-1"), fila("n-2"), fila("n-3")]);
    const service = servicioCon(repo);
    await service.marcarLeida("n-2", ADMIN_1);

    const r = await service.listar(ADMIN_1);

    expect(r.items.filter((i) => i.read).map((i) => i.id)).toEqual(["n-2"]);
    expect(r.noLeidas).toBe(2);
    expect(r.noLeidas).toBeLessThanOrEqual(r.items.length);
  });

  it("el contador nunca supera el limite de la pagina", async () => {
    const repo = new RepoFake(
      Array.from({ length: 120 }, (_, i) =>
        fila(`n-${i}`, { createdAt: new Date(AHORA.getTime() - i * 1000) }),
      ),
    );

    const r = await servicioCon(repo).listar(ADMIN_1);

    expect(r.noLeidas).toBe(50);
  });
});

describe("R3 — la lectura de un usuario no altera el estado de los demas del mismo rol", () => {
  it("lo que lee el admin 1 sigue no leido para el admin 2", async () => {
    const repo = new RepoFake([fila("n-1"), fila("n-2")]);
    const service = servicioCon(repo);

    await service.marcarLeida("n-1", ADMIN_1);

    const delUno = await service.listar(ADMIN_1);
    const delDos = await service.listar(ADMIN_2);
    expect(delUno.noLeidas).toBe(1);
    expect(delDos.noLeidas).toBe(2);
    expect(delDos.items.every((i) => !i.read)).toBe(true);
  });

  it("lo que descarta el admin 1 sigue en el listado del admin 2", async () => {
    const repo = new RepoFake([fila("n-1"), fila("n-2")]);
    const service = servicioCon(repo);

    await service.descartar("n-1", ADMIN_1);

    expect((await service.listar(ADMIN_1)).items.map((i) => i.id)).toEqual(["n-2"]);
    expect((await service.listar(ADMIN_2)).items.map((i) => i.id)).toEqual(["n-1", "n-2"]);
  });
});

describe("R31 — marcar como leida se refleja en el siguiente listado", () => {
  it("la notificacion aparece con read=true tras marcarla", async () => {
    const repo = new RepoFake([fila("n-1")]);
    const service = servicioCon(repo);

    expect(await service.marcarLeida("n-1", ADMIN_1)).toEqual({ status: "ok" });

    const r = await service.listar(ADMIN_1);
    expect(r.items[0].read).toBe(true);
    expect(r.noLeidas).toBe(0);
  });
});

describe("R32 — marcar todas deja el contador en cero", () => {
  it("marca todas las visibles y no descartadas del actor", async () => {
    const repo = new RepoFake([fila("n-1"), fila("n-2"), fila("n-3")]);
    const service = servicioCon(repo);
    await service.descartar("n-3", ADMIN_1);

    const r = await service.marcarTodasLeidas(ADMIN_1);

    expect(r).toEqual({ status: "ok", marcadas: 2 });
    expect((await service.listar(ADMIN_1)).noLeidas).toBe(0);
  });

  it("no altera el contador de otro usuario del mismo rol", async () => {
    const repo = new RepoFake([fila("n-1"), fila("n-2")]);
    const service = servicioCon(repo);

    await service.marcarTodasLeidas(ADMIN_1);

    expect((await service.listar(ADMIN_2)).noLeidas).toBe(2);
  });
});

describe("R33 — descartar retira la notificacion del listado de ESE usuario", () => {
  it("deja de listarse sin borrar la fila subyacente", async () => {
    const repo = new RepoFake([fila("n-1"), fila("n-2")]);
    const service = servicioCon(repo);

    expect(await service.descartar("n-1", ADMIN_1)).toEqual({ status: "ok" });

    expect((await service.listar(ADMIN_1)).items.map((i) => i.id)).toEqual(["n-2"]);
    expect(repo.filas.map((f) => f.id)).toEqual(["n-1", "n-2"]); // la fila sigue ahi
  });

  it("descartar una no leida no descuadra el contador", async () => {
    const repo = new RepoFake([fila("n-1"), fila("n-2")]);
    const service = servicioCon(repo);

    await service.descartar("n-1", ADMIN_1);

    const r = await service.listar(ADMIN_1);
    expect(r.items).toHaveLength(1);
    expect(r.noLeidas).toBe(1);
  });
});

describe("R35 — no se puede marcar ni descartar lo que no es visible", () => {
  it("responde forbidden y no crea fila de lectura cuando la notificacion es de otro", async () => {
    const repo = new RepoFake([fila("n-1", { visiblePara: ["admin-2"] })]);
    const service = servicioCon(repo);

    expect(await service.marcarLeida("n-1", ADMIN_1)).toEqual({ status: "forbidden" });
    expect(await service.descartar("n-1", ADMIN_1)).toEqual({ status: "forbidden" });
    expect(repo.lecturas).toHaveLength(0);
  });

  it("responde not_found cuando la notificacion no existe, sin crear fila de lectura", async () => {
    const repo = new RepoFake([]);
    const service = servicioCon(repo);

    expect(await service.marcarLeida("n-x", ADMIN_1)).toEqual({ status: "not_found" });
    expect(await service.descartar("n-x", ADMIN_1)).toEqual({ status: "not_found" });
    expect(repo.lecturas).toHaveLength(0);
  });
});

describe("R37 — repetir la operacion termina con exito y con una sola fila de lectura", () => {
  it("marcar dos veces la misma notificacion deja una unica fila", async () => {
    const repo = new RepoFake([fila("n-1")]);
    const service = servicioCon(repo);

    expect(await service.marcarLeida("n-1", ADMIN_1)).toEqual({ status: "ok" });
    expect(await service.marcarLeida("n-1", ADMIN_1)).toEqual({ status: "ok" });

    expect(repo.lecturas).toHaveLength(1);
  });

  it("descartar dos veces la misma notificacion deja una unica fila", async () => {
    const repo = new RepoFake([fila("n-1")]);
    const service = servicioCon(repo);

    expect(await service.descartar("n-1", ADMIN_1)).toEqual({ status: "ok" });
    expect(await service.descartar("n-1", ADMIN_1)).toEqual({ status: "ok" });

    expect(repo.lecturas).toHaveLength(1);
    expect((await service.listar(ADMIN_1)).items).toHaveLength(0);
  });
});
