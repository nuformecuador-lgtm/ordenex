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
import type { NotificacionEvento } from "@/lib/types/notificacion";
import type { IVigenciaAvisoAgregado } from "@/lib/interfaces/services/IVigenciaAvisoAgregado";
// FICHA 417 (T4.1) — el resolutor REAL, para que R9 se afirme de extremo a extremo.
import { VigenciaAvisoAgregadoService } from "@/lib/services/VigenciaAvisoAgregadoService";
import type { IAvisoAgregadoRepository } from "@/lib/interfaces/repositories/IAvisoAgregadoRepository";

// Feature 146 — B9. Tests unit del service con repositorio FALSO en memoria (sin DB): el
// repo aplica de verdad el descarte, el limite y la ventana, para que el test compruebe
// COMPORTAMIENTO y no llamadas. Cubre R3, R28-R33, R35 y R37.
//
// FICHA 409 (T5.3) — se AMPLIA con R8, R9, R31, R55, R56, R57 y R58: `porHacer`, el instante
// relativo resuelto en el servidor y los avisos agregados que se apagan solos.
//
// ⚠️ POR QUE ESTOS CASOS SI VALEN CON UN DOBLE, y no es una excusa: `porHacer` NO depende de
// ningun `where` nuevo — se deriva en el servicio sobre la lista ya cargada—, asi que aqui no hay
// SQL escondido que el doble pueda estar tapando. Lo que SI es SQL —el conteo de la cifra viva y
// el predicado de represamiento— vive en `tests/integration/db/aviso-agregado-repository.test.ts`,
// contra Postgres real. Es la leccion «probar el WHERE donde vive».

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
  /** FICHA 409: el evento es el discriminante de todo (clase, atajo, cifra viva). */
  evento: NotificacionEvento;
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

  // FICHA 410 (design 6.1): `crear` devuelve el id de la fila creada, nunca un booleano.
  crear = vi.fn(async () => "n-1");
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
        evento: f.evento,
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
    // `orden_rechazada` es INFORMATIVA para los cuatro roles que la reciben (una notificacion por
    // orden: en el momento del rechazo nadie decide nada). Sirve de fondo neutro para los casos
    // que no hablan de `porHacer`.
    evento: "orden_rechazada",
    ...opts,
  };
}

const ADMIN_1: Actor = { usuarioId: "admin-1", rol: "admin", zonaId: null };
const ADMIN_2: Actor = { usuarioId: "admin-2", rol: "admin", zonaId: null };

/** Resolutor de vigencia FALSO: devuelve lo que se le diga, o lanza si se le pide. */
function vigenciaFake(
  respuesta: Partial<Record<NotificacionEvento, number>> | "lanza",
): IVigenciaAvisoAgregado & { llamadas: Array<{ evento: NotificacionEvento; actor: Actor }> } {
  const llamadas: Array<{ evento: NotificacionEvento; actor: Actor }> = [];
  return {
    llamadas,
    async cifra(evento, actor) {
      llamadas.push({ evento, actor });
      if (respuesta === "lanza") throw new Error("la base no responde");
      return respuesta[evento] ?? 0;
    },
  };
}

function servicioCon(repo: RepoFake, vigencia?: IVigenciaAvisoAgregado) {
  return new NotificacionService(repo, now, vigencia ?? vigenciaFake({}));
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

    // FICHA 409: el literal se AMPLIA con los seis campos nuevos y sigue siendo un `toEqual`
    // exacto —es el contrato del DTO, no un poliz0n—: un campo de mas o de menos lo pone rojo.
    // Los seis vienen RESUELTOS por el servidor; la campana no clasifica ni compone nada.
    expect(r.items[0]).toEqual({
      id: "n-1",
      notification_type: "box",
      description: "desc n-1",
      anexo: "REM-0042",
      read: false,
      createdAt: AHORA.toISOString(),
      evento: "orden_rechazada",
      accionable: false,
      titulo: "desc n-1",
      detalle: "REM-0042",
      cuando: "hace un momento",
      atajo: null,
    });
    expect(r.items[1]).not.toHaveProperty("anexo");
    expect(r.items[1].detalle).toBeNull();
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
    // `marcarLeida` se borro el 2026-08-07, pero lo que prueba este caso es el CONTADOR de
    // `listar` (R30), que sigue vivo. La lectura se siembra en el doble: hace falta una
    // mezcla leida/no-leida, y `marcarTodasLeidas` —la unica via viva— las marcaria todas.
    repo.lecturas.push({
      notificacionId: "n-2",
      usuarioId: ADMIN_1.usuarioId,
      leidaAt: AHORA,
      descartadaAt: null,
    });

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

    // Lectura sembrada (ver R30): lo que se prueba es que la fila de lectura de un usuario
    // NO altera el listado de otro, y eso no depende de que exista `marcarLeida`.
    repo.lecturas.push({
      notificacionId: "n-1",
      usuarioId: ADMIN_1.usuarioId,
      leidaAt: AHORA,
      descartadaAt: null,
    });

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

// R31 («marcar UNA como leida») se borro el 2026-08-07 junto con su accion, su metodo de
// service y su metodo de repositorio: nunca tuvo control en la campana. R30 y R3 conservan
// la lectura por usuario, que es la parte del modelo que sigue viva.

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

    expect(await service.descartar("n-1", ADMIN_1)).toEqual({ status: "forbidden" });
    expect(repo.lecturas).toHaveLength(0);
  });

  it("responde not_found cuando la notificacion no existe, sin crear fila de lectura", async () => {
    const repo = new RepoFake([]);
    const service = servicioCon(repo);

    expect(await service.descartar("n-x", ADMIN_1)).toEqual({ status: "not_found" });
    expect(repo.lecturas).toHaveLength(0);
  });
});

describe("R37 — repetir la operacion termina con exito y con una sola fila de lectura", () => {
  it("descartar dos veces la misma notificacion deja una unica fila", async () => {
    const repo = new RepoFake([fila("n-1")]);
    const service = servicioCon(repo);

    expect(await service.descartar("n-1", ADMIN_1)).toEqual({ status: "ok" });
    expect(await service.descartar("n-1", ADMIN_1)).toEqual({ status: "ok" });

    expect(repo.lecturas).toHaveLength(1);
    expect((await service.listar(ADMIN_1)).items).toHaveLength(0);
  });
});

// ===========================================================================================
// FICHA 409 — `porHacer`, el instante relativo y los avisos agregados que se apagan solos
// ===========================================================================================

describe("409/R8 — el distintivo cuenta LO ACCIONABLE Y VIGENTE, no los mensajes", () => {
  it("2 accionables + 3 informativas + 1 accionable con cifra viva CERO -> porHacer === 2", async () => {
    const repo = new RepoFake([
      // accionables para el rol `admin`
      fila("acc-1", { evento: "postulacion_mensajero_pendiente" }),
      fila("acc-2", { evento: "cierre_dia_por_aprobar" }),
      // informativas para el rol `admin`
      fila("info-1", { evento: "orden_rechazada" }),
      fila("info-2", { evento: "carga_masiva_terminada" }),
      // `cierre_dia_vencido` es ACCIONABLE para el mensajero e INFORMATIVA para la bodega y la
      // administracion: con la pelota en el tejado del mensajero, el admin no puede aprobar lo
      // que no se ha enviado.
      fila("info-3", { evento: "cierre_dia_vencido" }),
      // accionable PERO agregada, y su cifra viva es 0: no sale y no cuenta (R55).
      fila("agg-0", { evento: "devoluciones_represadas" }),
    ]);

    const r = await servicioCon(repo, vigenciaFake({ devoluciones_represadas: 0 })).listar(ADMIN_1);

    expect(r.porHacer).toBe(2);
    expect(r.items.filter((i) => i.accionable).map((i) => i.id)).toEqual(["acc-1", "acc-2"]);
    expect(r.items.map((i) => i.id)).not.toContain("agg-0");
  });

  it("el mismo evento cuenta o no segun el ROL de quien consulta", async () => {
    // `cierre_dia_vencido` le llega al mensajero como fila dirigida A USUARIO (su
    // `destinatario_rol` es NULL): quien decide la clase es el rol del ACTOR, no la columna.
    const repo = new RepoFake([
      fila("v-1", { evento: "cierre_dia_vencido", visiblePara: ["admin-1", "men-1"] }),
    ]);
    const mensajero: Actor = { usuarioId: "men-1", rol: "mensajero", zonaId: null };

    expect((await servicioCon(repo).listar(ADMIN_1)).porHacer).toBe(0);
    expect((await servicioCon(repo).listar(mensajero)).porHacer).toBe(1);
  });
});

describe("409/R9 — el estado de LECTURA no interviene en el conteo", () => {
  it("marcar todas como leidas no baja porHacer", async () => {
    const repo = new RepoFake([
      fila("acc-1", { evento: "postulacion_mensajero_pendiente" }),
      fila("acc-2", { evento: "cierre_dia_por_aprobar" }),
    ]);
    const service = servicioCon(repo);

    expect((await service.listar(ADMIN_1)).porHacer).toBe(2);
    await service.marcarTodasLeidas(ADMIN_1);
    const despues = await service.listar(ADMIN_1);

    expect(despues.items.every((i) => i.read)).toBe(true);
    expect(despues.noLeidas).toBe(0); // los MENSAJES si bajan
    expect(despues.porHacer).toBe(2); // el TRABAJO no
  });
});

describe("409/R31 — el instante relativo se resuelve en el SERVIDOR y viaja como texto", () => {
  it("un aviso de hace 2 h llega con `cuando` ya en palabras", async () => {
    const repo = new RepoFake([
      fila("n-1", { createdAt: new Date(AHORA.getTime() - 2 * 60 * 60 * 1000) }),
      fila("n-2", { createdAt: new Date(AHORA.getTime() - 40 * 60 * 1000) }),
    ]);

    const r = await servicioCon(repo).listar(ADMIN_1);

    expect(r.items.find((i) => i.id === "n-1")?.cuando).toBe("hace 2 h");
    expect(r.items.find((i) => i.id === "n-2")?.cuando).toBe("hace 40 min");
  });
});

describe("409/R55 y R56 — un aviso agregado se apaga y se enciende SOLO, sin escribir nada", () => {
  it("cifra 0 -> ni se ve ni cuenta, y NO se crea fila de lectura ni de descarte", async () => {
    const repo = new RepoFake([fila("agg", { evento: "novedades_sin_gestionar" })]);
    const tienda: Actor = { usuarioId: "tienda-1", rol: "adminTienda", zonaId: null };
    repo.filas[0].visiblePara = ["tienda-1"];

    const r = await servicioCon(repo, vigenciaFake({ novedades_sin_gestionar: 0 })).listar(tienda);

    expect(r.items).toHaveLength(0);
    expect(r.porHacer).toBe(0);
    expect(repo.lecturas).toHaveLength(0); // nadie lo leyo, lo marco ni lo descarto
  });

  it("la MISMA fila vuelve a salir cuando la cifra sube, sin crear una segunda", async () => {
    const repo = new RepoFake([fila("agg", { evento: "novedades_sin_gestionar" })]);
    const tienda: Actor = { usuarioId: "tienda-1", rol: "adminTienda", zonaId: null };
    repo.filas[0].visiblePara = ["tienda-1"];

    const apagada = await servicioCon(repo, vigenciaFake({ novedades_sin_gestionar: 0 })).listar(
      tienda,
    );
    const encendida = await servicioCon(repo, vigenciaFake({ novedades_sin_gestionar: 3 })).listar(
      tienda,
    );

    expect(apagada.items).toHaveLength(0);
    expect(encendida.items.map((i) => i.id)).toEqual(["agg"]);
    expect(encendida.porHacer).toBe(1);
    expect(repo.crear).not.toHaveBeenCalled(); // no hay segunda fila: la de hoy ya existe
    expect(repo.lecturas).toHaveLength(0);
  });
});

describe("409/R57 — el numero del panel es la cifra VIVA, no la del instante de la emision", () => {
  it("la fila se emitio con 5 y el resolutor dice 3: el titulo dice 3", async () => {
    const repo = new RepoFake([
      fila("agg", {
        evento: "novedades_sin_gestionar",
        descripcion: "La más antigua lleva 3 días en bodega. A los 5 días se rechaza automáticamente.",
        visiblePara: ["tienda-1"],
      }),
    ]);
    const tienda: Actor = { usuarioId: "tienda-1", rol: "adminTienda", zonaId: null };

    const r = await servicioCon(repo, vigenciaFake({ novedades_sin_gestionar: 3 })).listar(tienda);

    // Literal ESCRITO A MANO, nunca comparado contra la funcion que lo compone.
    expect(r.items[0].titulo).toBe("3 novedades esperan tu decisión");
    expect(r.items[0].detalle).toBe(
      "La más antigua lleva 3 días en bodega. A los 5 días se rechaza automáticamente.",
    );
    expect(r.items[0].atajo).toEqual({
      href: "/novedades?superficie=devolucion",
      etiqueta: "Gestionar novedades",
    });
  });

  it("con UNA sola novedad el titulo va en singular", async () => {
    const repo = new RepoFake([
      fila("agg", { evento: "novedades_sin_gestionar", visiblePara: ["tienda-1"] }),
    ]);
    const tienda: Actor = { usuarioId: "tienda-1", rol: "adminTienda", zonaId: null };

    const r = await servicioCon(repo, vigenciaFake({ novedades_sin_gestionar: 1 })).listar(tienda);

    expect(r.items[0].titulo).toBe("1 novedad espera tu decisión");
  });

  it("la cifra se pide UNA vez por evento y con el ACTOR que consulta", async () => {
    const vigencia = vigenciaFake({ devoluciones_represadas: 4 });
    const repo = new RepoFake([
      fila("a", { evento: "devoluciones_represadas" }),
      fila("b", { evento: "devoluciones_represadas" }),
      fila("c", { evento: "orden_rechazada" }),
    ]);

    await servicioCon(repo, vigencia).listar(ADMIN_1);

    expect(vigencia.llamadas).toHaveLength(1);
    expect(vigencia.llamadas[0].evento).toBe("devoluciones_represadas");
    expect(vigencia.llamadas[0].actor).toBe(ADMIN_1);
  });

  it("un actor SIN avisos agregados no paga ni una consulta de vigencia", async () => {
    const vigencia = vigenciaFake({});
    const repo = new RepoFake([fila("n-1"), fila("n-2")]);

    await servicioCon(repo, vigencia).listar(ADMIN_1);

    expect(vigencia.llamadas).toHaveLength(0);
  });
});

describe("409/R58 — si la cifra viva no se puede resolver, el aviso SALE (nunca campana en blanco)", () => {
  it("el resolutor lanza: el agregado sale, cuenta, y el resto del listado tambien", async () => {
    const repo = new RepoFake([
      fila("agg", { evento: "devoluciones_represadas", descripcion: "La más antigua lleva 8 días en bodega. Coordiná la devolución." }),
      fila("otra", { evento: "orden_rechazada" }),
    ]);

    const r = await servicioCon(repo, vigenciaFake("lanza")).listar(ADMIN_1);

    expect(r.items.map((i) => i.id)).toEqual(["agg", "otra"]);
    expect(r.porHacer).toBe(1);
    // Sin cifra no se puede componer el titulo con un numero: cae al texto PERSISTIDO, que es real.
    expect(r.items[0].titulo).toBe(
      "La más antigua lleva 8 días en bodega. Coordiná la devolución.",
    );
  });
});

// ⚠️ FICHA 417 (T4.1, R9) — DONDE ATERRIZA EL FALLO NUEVO, afirmado de extremo a extremo y no
// heredado de palabra. El caso de arriba usa el resolutor FALSO; este usa el de VERDAD
// (`VigenciaAvisoAgregadoService` + un repositorio espia) para que lo que se prueba sea la cadena
// entera: la guarda de la 417 lanza -> `cifrasVivas` lo registra con su causa -> el aviso SALE SIN
// NUMERO. Las dos mitades importan y por eso las dos se afirman.
//
// NOTA DE HONESTIDAD: este caso construye a mano un estado que hoy el predicado de visibilidad de
// la 146 no deja llegar (un `adminSatelite` sin zona no recibe filas acotadas por zona). Es
// DELIBERADO: lo que se esta probando es una defensa en profundidad, no un camino alcanzable
// (`specs/417-.../design.md` §9.6). Si esa capa cambiara, esta seguiria en pie.
describe("417/R9 — un actor sin ambito: el aviso sale SIN numero y el fallo queda REGISTRADO", () => {
  function repoAgregadoEspia(): IAvisoAgregadoRepository {
    return {
      resumenNovedadesPorTienda: vi.fn(async () => []),
      contarNovedadesDeTienda: vi.fn(async () => 5),
      resumenRepresadasPorZona: vi.fn(async () => []),
      resumenRepresadasGlobal: vi.fn(async () => ({ total: 0, masAntiguaAt: null })),
      contarRepresadas: vi.fn(async () => 7),
    };
  }

  it("adminSatelite sin zona + un aviso de represadas: se ve el texto, no el total, y el log lo dice", async () => {
    const SAT_SIN_ZONA: Actor = { usuarioId: "sat-9", rol: "adminSatelite", zonaId: null };
    const repoAgregado = repoAgregadoEspia();
    const repo = new RepoFake([
      fila("agg", {
        evento: "devoluciones_represadas",
        descripcion: "La más antigua lleva 8 días en bodega. Coordiná la devolución.",
        visiblePara: ["sat-9"],
      }),
    ]);
    const logger = { logError: vi.fn() };
    const servicio = new NotificacionService(
      repo,
      now,
      new VigenciaAvisoAgregadoService(repoAgregado, 3, now),
      logger,
    );

    const r = await servicio.listar(SAT_SIN_ZONA);

    // Mitad 1 — el aviso SALE, y sin numero: el titulo es el texto persistido, no
    // «7 órdenes esperan volver a su tienda», que es el TOTAL DEL SISTEMA que el repositorio
    // espia tiene cargado. Si la guarda desapareciera, ese 7 seria justo lo que se leeria.
    expect(r.items.map((i) => i.id)).toEqual(["agg"]);
    expect(r.items[0].titulo).toBe(
      "La más antigua lleva 8 días en bodega. Coordiná la devolución.",
    );
    // Lo que NO se lee, con el literal escrito a mano: el titulo compuesto con el total del
    // sistema. `contarRepresadas` del espia devuelve 7, asi que sin la guarda de la 417 esto es
    // exactamente lo que este satelite tendria delante.
    expect(r.items[0].titulo).not.toBe("7 órdenes esperan volver a su tienda");
    // ...y el ambito ni se llego a consultar.
    expect(repoAgregado.contarRepresadas).not.toHaveBeenCalled();

    // Mitad 2 — queda REGISTRADO, y con la causa nombrada. Literales escritos a mano.
    expect(logger.logError).toHaveBeenCalledTimes(1);
    const registrado = logger.logError.mock.calls[0][0] as Error;
    expect(registrado.message).toMatch(/vigencia del aviso agregado/i);
    expect((registrado.cause as Error).message).toMatch(/no tiene zona asignada/i);
    // Y no lleva PII: el id del usuario no viaja en el mensaje del error (design §4).
    expect(`${registrado.message} ${(registrado.cause as Error).message}`).not.toContain("sat-9");
  });
});

// ⚠️ FICHA 418 (T4.1, R10) — EL MISMO ATERRIZAJE, PARA EL FALLO NUEVO. La 417 dijo «basta uno»
// porque los dos fallos caen en el mismo `catch` de `cifrasVivas`, y sigue siendo cierto. Este se
// pide por otra razon: es EL UNICO ASERTO QUE ENSEÑA EL DEFECTO EN PALABRAS. Con la lista negra
// de antes (`rol !== "adminSatelite"` => ambito global), este mensajero tendria delante
// «7 órdenes esperan volver a su tienda» —el TOTAL DEL SISTEMA que el repositorio espia tiene
// cargado—, y ningun test del repo lo decia.
//
// NOTA DE HONESTIDAD, igual que arriba: este caso construye a mano un estado que hoy el predicado
// de visibilidad de la 146 no deja llegar (un `mensajero` no recibe filas de este evento, porque
// el emisor solo las escribe para `maestro`, `admin` y `adminSatelite`). Es DELIBERADO: lo que se
// prueba es una defensa en profundidad, no un camino alcanzable (`specs/418-.../design.md` §9.7).
describe("418/R10 — un rol fuera de la lista blanca: el aviso sale SIN numero y el fallo queda REGISTRADO", () => {
  // Espia propio, para no tocar ni una linea del bloque de la 417 de arriba.
  function repoAgregadoEspia418(): IAvisoAgregadoRepository {
    return {
      resumenNovedadesPorTienda: vi.fn(async () => []),
      contarNovedadesDeTienda: vi.fn(async () => 5),
      resumenRepresadasPorZona: vi.fn(async () => []),
      resumenRepresadasGlobal: vi.fn(async () => ({ total: 0, masAntiguaAt: null })),
      contarRepresadas: vi.fn(async () => 7),
    };
  }

  it("mensajero + un aviso de represadas: se ve el texto, NUNCA el total del sistema, y el log lo dice", async () => {
    const MENSAJERO: Actor = { usuarioId: "men-9", rol: "mensajero", zonaId: null };
    const repoAgregado = repoAgregadoEspia418();
    const repo = new RepoFake([
      fila("agg", {
        evento: "devoluciones_represadas",
        descripcion: "La más antigua lleva 8 días en bodega. Coordiná la devolución.",
        visiblePara: ["men-9"],
      }),
    ]);
    const logger = { logError: vi.fn() };
    const servicio = new NotificacionService(
      repo,
      now,
      new VigenciaAvisoAgregadoService(repoAgregado, 3, now),
      logger,
    );

    const r = await servicio.listar(MENSAJERO);

    // Mitad 1 — el aviso SALE, y sin numero: el titulo es el texto persistido.
    expect(r.items.map((i) => i.id)).toEqual(["agg"]);
    expect(r.items[0].titulo).toBe(
      "La más antigua lleva 8 días en bodega. Coordiná la devolución.",
    );
    // Lo que NO se lee, con el literal escrito a mano: el titulo compuesto con el total del
    // sistema. `contarRepresadas` del espia devuelve 7, asi que con la lista negra de antes esto
    // era EXACTAMENTE lo que este mensajero tendria delante — un numero creible y falso.
    expect(r.items[0].titulo).not.toBe("7 órdenes esperan volver a su tienda");
    // ...y el ambito ni se llego a consultar: ni el global, ni el de ninguna zona.
    expect(repoAgregado.contarRepresadas).not.toHaveBeenCalled();

    // Mitad 2 — queda REGISTRADO, y con la causa nombrada. Literales escritos a mano.
    expect(logger.logError).toHaveBeenCalledTimes(1);
    const registrado = logger.logError.mock.calls[0][0] as Error;
    expect(registrado.message).toMatch(/vigencia del aviso agregado/i);
    expect((registrado.cause as Error).message).toMatch(/no define ambito para el rol/i);
    // Y no lleva PII: el id del usuario no viaja en el mensaje del error (design §4).
    expect(`${registrado.message} ${(registrado.cause as Error).message}`).not.toContain("men-9");
  });
});
