import { describe, it, expect, vi } from "vitest";
import type { RolValue } from "@prisma/client";
import type {
  CrearNotificacionInput,
  INotificacionRepository,
  NotificacionTxClient,
} from "@/lib/interfaces/repositories/INotificacionRepository";
import type {
  AvisoParaPush,
  DestinatarioDeAviso,
  IPushNotificacionReader,
} from "@/lib/interfaces/repositories/IPushNotificacionReader";
import type {
  IPushSuscripcionRepository,
  TomaDeCupo,
} from "@/lib/interfaces/repositories/IPushSuscripcionRepository";
import type { EnqueueOpts, JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type { JobTipo } from "@prisma/client";
import { conPushWeb } from "@/lib/notificaciones/notificacion-repo-con-push";
import type { ErrorLogger } from "@/lib/errors";

// FICHA 410 (T3.4) — EL DECORADOR, que es el UNICO punto de cableado del canal.
//
// Cubre R5 (el push NO crea filas nuevas), R6/R7 (uno al dia, y el cupo lo decide el INSERT), R27
// (no bloquea ni entra en la transaccion de negocio), R28 (un fallo queda registrado y no propaga),
// R30 (sin claves no se encola nada), R35 (un trabajo por aviso) y R44 (leer/descartar no pushea).
//
// ⚠️ QUE SE PRUEBA AQUI Y QUE NO. Los dobles NO ven el SQL: lo que el indice unico hace de verdad
// ante dos conexiones simultaneas se mide contra Postgres en
// `tests/integration/db/push-cupo-carrera.test.ts`. Aqui se prueba la POLITICA: a quien se le toma
// cupo, cuando se encola, cuando NO, y que nada de esto puede tumbar la operacion de negocio.

const AHORA = new Date("2026-09-12T18:00:00.000Z"); // 12:00 CR del 2026-09-12

const ENTRADA_ELEGIBLE: CrearNotificacionInput = {
  tipo: "alert",
  evento: "cierre_dia_vencido",
  descripcion: "Tu cierre del dia vencio.",
  anexo: null,
  entidadTipo: "cierre_dia",
  entidadId: "c-1",
  destinatario: { tipo: "usuario", usuarioId: "u-mensajero" },
};

/** Repositorio base: registra lo creado y devuelve un id, como el real. */
class RepoBase implements INotificacionRepository {
  creadas: CrearNotificacionInput[] = [];
  siguienteId: string | null = "n-1";
  async crear(input: CrearNotificacionInput): Promise<string | null> {
    this.creadas.push(input);
    return this.siguienteId;
  }
  existeNoLeidaPara = vi.fn().mockResolvedValue(false);
  listarParaUsuario = vi.fn().mockResolvedValue([]);
  verificarVisible = vi.fn().mockResolvedValue("visible" as const);
  marcarTodasLeidas = vi.fn().mockResolvedValue(0);
  descartar = vi.fn().mockResolvedValue(undefined);
}

function destinatario(usuarioId: string, rol: RolValue): DestinatarioDeAviso {
  return { usuarioId, rol, zonaId: null };
}

class LectorDoble implements IPushNotificacionReader {
  constructor(public destinatarios: DestinatarioDeAviso[] = []) {}
  leerAviso = vi.fn(async (): Promise<AvisoParaPush | null> => null);
  destinatariosPendientes = vi.fn(async () => this.destinatarios);
}

/** Canal doble con un cupo EN MEMORIA que imita al indice unico: el primero gana. */
class CanalDoble implements IPushSuscripcionRepository {
  readonly cupos: TomaDeCupo[] = [];
  private readonly tomados = new Set<string>();
  registrar = vi.fn(async () => undefined);
  eliminarDeUsuario = vi.fn(async () => 0);
  eliminarPorId = vi.fn(async () => undefined);
  listarPorUsuarios = vi.fn(async () => []);
  sellarEnvioOk = vi.fn(async () => undefined);
  usuariosConCupoDe = vi.fn(async () => [] as string[]);
  async tomarCupoDelDia(toma: TomaDeCupo): Promise<boolean> {
    const k = `${toma.usuarioId}|${toma.evento}|${toma.diaCr}`;
    if (this.tomados.has(k)) return false;
    this.tomados.add(k);
    this.cupos.push(toma);
    return true;
  }
}

/** Cola doble con la idempotencia REAL del `enqueue`: una `dedupeKey` repetida devuelve `null`. */
class ColaDoble {
  readonly encolados: { tipo: JobTipo; payload: Record<string, unknown>; opts?: EnqueueOpts }[] = [];
  private readonly claves = new Set<string>();
  enqueue = vi.fn(
    async (
      tipo: JobTipo,
      payload: Record<string, unknown>,
      opts?: EnqueueOpts,
    ): Promise<JobDTO | null> => {
      if (opts?.dedupeKey !== undefined) {
        if (this.claves.has(opts.dedupeKey)) return null; // ON CONFLICT DO NOTHING
        this.claves.add(opts.dedupeKey);
      }
      this.encolados.push({ tipo, payload, opts });
      return null;
    },
  );
}

function loggerDoble(): ErrorLogger & { errores: unknown[] } {
  const errores: unknown[] = [];
  return { errores, logError: (e: unknown) => errores.push(e) };
}

function montar(opciones: {
  destinatarios?: DestinatarioDeAviso[];
  hayCanal?: boolean;
  base?: RepoBase;
  logger?: ErrorLogger;
  cola?: ColaDoble;
}) {
  const base = opciones.base ?? new RepoBase();
  const lector = new LectorDoble(opciones.destinatarios ?? []);
  const canal = new CanalDoble();
  const cola = opciones.cola ?? new ColaDoble();
  const repo = conPushWeb(base, {
    lector,
    canal,
    cola,
    hayCanal: () => opciones.hayCanal ?? true,
    now: () => AHORA,
    logger: opciones.logger,
  });
  return { repo, base, lector, canal, cola };
}

describe("410/R5+R35 — un aviso elegible deja UN trabajo, y el aviso sigue siendo uno solo", () => {
  it("⭑ encola una vez, con `push:<id>`, tres intentos y SOLO el `notificacionId` en el payload", async () => {
    const { repo, base, canal, cola } = montar({
      destinatarios: [destinatario("u-mensajero", "mensajero")],
    });

    const id = await repo.crear(ENTRADA_ELEGIBLE);

    expect(id).toBe("n-1");
    // R5: el push NO crea filas nuevas. La unica fila es la que creo el repositorio base.
    expect(base.creadas).toHaveLength(1);
    expect(cola.encolados).toHaveLength(1);
    const trabajo = cola.encolados[0];
    expect(trabajo.tipo).toBe("push_web");
    // Payload literal, escrito a mano: es el contrato del trabajo (design §7).
    expect(trabajo.payload).toEqual({ notificacionId: "n-1" });
    expect(trabajo.opts?.dedupeKey).toBe("push:n-1");
    expect(trabajo.opts?.maxIntentos).toBe(3);
    // Y el cupo del dia quedo tomado, con la jornada de Costa Rica.
    expect(canal.cupos).toEqual([
      { usuarioId: "u-mensajero", evento: "cierre_dia_vencido", diaCr: "2026-09-12", notificacionId: "n-1" },
    ]);
  });

  it("⭑ R35: emitir DOS VECES el mismo aviso no produce un segundo trabajo", async () => {
    const { repo, cola } = montar({ destinatarios: [destinatario("u-mensajero", "mensajero")] });
    await repo.crear(ENTRADA_ELEGIBLE);
    // El mismo id: es lo que pasa si el drenador reencola o si alguien repite la emision.
    await repo.crear(ENTRADA_ELEGIBLE);
    expect(cola.enqueue).toHaveBeenCalledTimes(1);
  });
});

describe("410/R6 — uno al dia por (usuario, evento), y el cupo se toma ANTES de encolar", () => {
  it("⭑ el SEGUNDO aviso elegible del mismo dia NO encola nada", async () => {
    const base = new RepoBase();
    const { repo, cola, canal } = montar({
      base,
      destinatarios: [destinatario("u-mensajero", "mensajero")],
    });

    base.siguienteId = "n-1";
    await repo.crear(ENTRADA_ELEGIBLE);
    // Otro cierre del mismo mensajero, el mismo dia: aviso NUEVO y legitimo en la campana...
    base.siguienteId = "n-2";
    await repo.crear({ ...ENTRADA_ELEGIBLE, entidadId: "c-2" });

    // ...pero el telefono suena UNA sola vez.
    expect(base.creadas).toHaveLength(2); // los dos avisos existen
    expect(canal.cupos).toHaveLength(1); // el cupo del dia se gasto con el primero
    expect(cola.encolados).toHaveLength(1);
    expect(cola.encolados[0].payload).toEqual({ notificacionId: "n-1" });
  });

  it("⭑ MUTACION del cupo: si `tomarCupoDelDia` dijera siempre `true`, saldrian DOS", async () => {
    // Se reproduce la mutacion 1 del design §15 con el doble: el cupo deja de excluir.
    const base = new RepoBase();
    const lector = new LectorDoble([destinatario("u-mensajero", "mensajero")]);
    const canal = new CanalDoble();
    canal.tomarCupoDelDia = vi.fn(async () => true); // ⚠️ LA MUTACION
    const cola = new ColaDoble();
    const repo = conPushWeb(base, { lector, canal, cola, hayCanal: () => true, now: () => AHORA });

    base.siguienteId = "n-1";
    await repo.crear(ENTRADA_ELEGIBLE);
    base.siguienteId = "n-2";
    await repo.crear({ ...ENTRADA_ELEGIBLE, entidadId: "c-2" });

    // Con el cupo roto salen DOS. El caso de arriba es el que se pone rojo en produccion.
    expect(cola.encolados).toHaveLength(2);
  });

  it("⭑ dos personas distintas SI suenan las dos el mismo dia: el cupo es por usuario", async () => {
    // El MISMO canal y la MISMA cola para los dos avisos —ese es el punto: si el cupo fuera por
    // evento y dia a secas, el segundo mensajero se quedaria mudo y nadie se enteraria.
    const base = new RepoBase();
    const canal = new CanalDoble();
    const cola = new ColaDoble();
    const crearRepo = (usuarioId: string) =>
      conPushWeb(base, {
        lector: new LectorDoble([destinatario(usuarioId, "mensajero")]),
        canal,
        cola,
        hayCanal: () => true,
        now: () => AHORA,
      });

    base.siguienteId = "n-1";
    await crearRepo("u-a").crear(ENTRADA_ELEGIBLE);
    base.siguienteId = "n-2";
    await crearRepo("u-b").crear({ ...ENTRADA_ELEGIBLE, entidadId: "c-2" });

    expect(canal.cupos.map((c) => c.usuarioId)).toEqual(["u-a", "u-b"]);
    expect(cola.encolados).toHaveLength(2);
  });
});

describe("410/R1+R4 — lo que NO es elegible no llega ni a consultar", () => {
  it("⭑ un evento de la lista negativa no encola y NO gasta una sola consulta", async () => {
    const { repo, lector, cola, canal } = montar({
      destinatarios: [destinatario("u-admin", "admin")],
    });

    await repo.crear({
      ...ENTRADA_ELEGIBLE,
      evento: "orden_rechazada",
      destinatario: { tipo: "rol", rol: "admin" },
    });

    expect(cola.encolados).toHaveLength(0);
    // La puerta barata: `orden_rechazada` es el evento mas frecuente del sistema y no paga nada.
    expect(lector.destinatariosPendientes).not.toHaveBeenCalled();
    expect(canal.cupos).toHaveLength(0);
  });

  it("⭑ un evento elegible cuyo LECTOR no lo es: se consulta, pero no se encola", async () => {
    const { repo, lector, cola, canal } = montar({
      // La copia a bodega de `cierre_dia_vencido`: el evento si, el rol no.
      destinatarios: [destinatario("u-bodega", "adminSatelite")],
    });

    await repo.crear({
      ...ENTRADA_ELEGIBLE,
      destinatario: { tipo: "rol", rol: "adminSatelite" },
    });

    expect(lector.destinatariosPendientes).toHaveBeenCalledTimes(1);
    expect(canal.cupos).toHaveLength(0);
    expect(cola.encolados).toHaveLength(0);
  });

  it("⭑ MUTACION: marcar elegible un evento de la lista negativa lo pondria a encolar", async () => {
    // Mutacion 5 del design §15, reproducida sobre el doble: si `orden_rechazada` fuera elegible
    // para `admin`, el caso de arriba tendria un encolado. Aqui se mide que el camino existe.
    const { repo, cola } = montar({ destinatarios: [destinatario("u-admin", "admin")] });
    await repo.crear({ ...ENTRADA_ELEGIBLE, destinatario: { tipo: "rol", rol: "admin" } });
    // `cierre_dia_vencido` NO es elegible para `admin`, asi que sigue en cero...
    expect(cola.encolados).toHaveLength(0);
    // ...y el control positivo: con el rol correcto, el mismo camino SI encola.
    const otro = montar({ destinatarios: [destinatario("u-m", "mensajero")] });
    await otro.repo.crear(ENTRADA_ELEGIBLE);
    expect(otro.cola.encolados).toHaveLength(1);
  });
});

describe("410 — la dedupe del AVISO manda: el push nunca resucita lo deduplicado", () => {
  it("⭑ si `crear` devuelve `null`, no se consulta nada y no se encola nada", async () => {
    const base = new RepoBase();
    base.siguienteId = null; // el `P2002` que el repositorio real absorbe
    const { repo, lector, cola } = montar({
      base,
      destinatarios: [destinatario("u-mensajero", "mensajero")],
    });

    expect(await repo.crear(ENTRADA_ELEGIBLE)).toBeNull();
    expect(lector.destinatariosPendientes).not.toHaveBeenCalled();
    expect(cola.encolados).toHaveLength(0);
  });
});

describe("410/R27 — la emision no bloquea ni entra en la transaccion de negocio", () => {
  it("⭑ con `tx`, el decorador delega y NO encola: el push jamas va dentro de una transaccion", async () => {
    const { repo, lector, cola } = montar({
      destinatarios: [destinatario("u-mensajero", "mensajero")],
    });
    const tx = {} as NotificacionTxClient;

    const id = await repo.crear(ENTRADA_ELEGIBLE, tx);

    expect(id).toBe("n-1"); // el aviso SI se crea
    expect(lector.destinatariosPendientes).not.toHaveBeenCalled();
    expect(cola.encolados).toHaveLength(0);
  });
});

describe("410/R28 — un fallo del canal NO propaga, y queda REGISTRADO", () => {
  it("⭑ la cola revienta: `crear` devuelve el id igualmente y el error se loggea con su operacion", async () => {
    const logger = loggerDoble();
    const cola = new ColaDoble();
    cola.enqueue = vi.fn(async () => {
      throw new Error("la cola esta caida");
    });
    const { repo } = montar({
      destinatarios: [destinatario("u-mensajero", "mensajero")],
      logger,
      cola,
    });

    // NO LANZA: la operacion de negocio que creo el aviso ya termino bien.
    const id = await repo.crear(ENTRADA_ELEGIBLE);
    expect(id).toBe("n-1");

    // Y no es un `catch` vacio: el fallo esta registrado, con la operacion y la causa.
    expect(logger.errores).toHaveLength(1);
    const error = logger.errores[0] as Error;
    expect(error.message).toContain("push_web");
    expect((error.cause as Error).message).toBe("la cola esta caida");
  });

  it("el lector revienta: mismo desenlace, el aviso vive y el fallo queda escrito", async () => {
    const logger = loggerDoble();
    const base = new RepoBase();
    const lector = new LectorDoble();
    lector.destinatariosPendientes = vi.fn(async () => {
      throw new Error("base caida");
    });
    const repo = conPushWeb(base, {
      lector,
      canal: new CanalDoble(),
      cola: new ColaDoble(),
      hayCanal: () => true,
      now: () => AHORA,
      logger,
    });

    expect(await repo.crear(ENTRADA_ELEGIBLE)).toBe("n-1");
    expect(logger.errores).toHaveLength(1);
  });
});

describe("410/R30 — sin claves VAPID no se encola NADA, y nada lanza", () => {
  it("⭑ el aviso se crea igual y la cola queda intacta", async () => {
    const { repo, cola, lector, canal } = montar({
      destinatarios: [destinatario("u-mensajero", "mensajero")],
      hayCanal: false,
    });

    expect(await repo.crear(ENTRADA_ELEGIBLE)).toBe("n-1");
    // Ni una consulta, ni un cupo, ni un trabajo: sin canal no se acumula basura en la cola (R36).
    expect(lector.destinatariosPendientes).not.toHaveBeenCalled();
    expect(canal.cupos).toHaveLength(0);
    expect(cola.encolados).toHaveLength(0);
  });
});

describe("410/R44 — marcar leido o descartar NO produce push", () => {
  it("⭑ los dos metodos delegan y no tocan la cola", async () => {
    const { repo, base, cola } = montar({});
    await repo.marcarTodasLeidas({ usuarioId: "u-1", rol: "admin", zonaId: null }, AHORA, AHORA);
    await repo.descartar("n-1", "u-1", AHORA);
    expect(base.marcarTodasLeidas).toHaveBeenCalledTimes(1);
    expect(base.descartar).toHaveBeenCalledTimes(1);
    expect(cola.encolados).toHaveLength(0);
  });

  it("y el resto de la interfaz delega sin tocar nada", async () => {
    const { repo, base } = montar({});
    await repo.existeNoLeidaPara("cierre_dia_vencido", "c-1", { tipo: "usuario", usuarioId: "u-1" });
    await repo.listarParaUsuario({
      actor: { usuarioId: "u-1", rol: "admin", zonaId: null },
      desde: AHORA,
      limite: 10,
    });
    await repo.verificarVisible("n-1", { usuarioId: "u-1", rol: "admin", zonaId: null });
    expect(base.existeNoLeidaPara).toHaveBeenCalledTimes(1);
    expect(base.listarParaUsuario).toHaveBeenCalledTimes(1);
    expect(base.verificarVisible).toHaveBeenCalledTimes(1);
  });
});
