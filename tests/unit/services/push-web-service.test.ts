import { describe, it, expect, vi } from "vitest";
import type { RolValue } from "@prisma/client";
import { PushWebService, type PushCarga } from "@/lib/services/PushWebService";
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import type {
  AvisoParaPush,
  DestinatarioDeAviso,
  IPushNotificacionReader,
} from "@/lib/interfaces/repositories/IPushNotificacionReader";
import type {
  IPushSuscripcionRepository,
  SuscripcionDeUsuario,
} from "@/lib/interfaces/repositories/IPushSuscripcionRepository";
import type { IPushSender, PushOutcome } from "@/lib/interfaces/external/IPushSender";
import type { IVigenciaAvisoAgregado } from "@/lib/interfaces/services/IVigenciaAvisoAgregado";
import type { ErrorLogger } from "@/lib/errors";

// FICHA 410 (T3.7/T3.7b) — LA POLITICA DEL ENVIO. Cubre R8 (aviso borrado / leido -> termina), R9 y
// R52 (el texto es el de la 409 y NO promete cantidades que no ha contado), R23 (sin endpoint en
// los logs), R26 (varias suscripciones, y el fallo de una no impide las demas), R30 (sin
// configuracion termina y no lanza), R33 (caducada -> se borra y NO se reintenta), R34/R36 (solo lo
// transitorio reintenta; todo lo demas TERMINA) y R48 (nada viaja que el aviso no trajera).
//
// ⚠️ LOS DOBLES NO VEN LA RED NI EL SQL. Aqui se mide la POLITICA: que se envia, a quien, con que
// texto y que se hace con cada desenlace. Quien resuelve a los destinatarios de verdad se mide
// contra Postgres en `tests/integration/db/push-destinatarios-equivalencia.test.ts`.

const AHORA = new Date("2026-09-12T18:00:00.000Z");

function job(over: Partial<JobDTO> = {}): JobDTO {
  return {
    id: "job-1",
    tipo: "push_web",
    payload: { notificacionId: "n-1" },
    estado: "processing",
    intentos: 1,
    maxIntentos: 3,
    runAfter: AHORA,
    lockedAt: AHORA,
    lastError: null,
    dedupeKey: "push:n-1",
    createdAt: AHORA,
    updatedAt: AHORA,
    ...over,
  };
}

function destinatario(usuarioId: string, rol: RolValue, zonaId: string | null = null): DestinatarioDeAviso {
  return { usuarioId, rol, zonaId };
}

function suscripcion(id: string, usuarioId: string): SuscripcionDeUsuario {
  return {
    id,
    usuarioId,
    endpoint: `https://fcm.googleapis.com/fcm/send/ENDPOINT-SECRETO-${id}`,
    p256dh: `P256DH-${id}`,
    auth: `AUTH-${id}`,
  };
}

class LectorDoble implements IPushNotificacionReader {
  constructor(
    public aviso: AvisoParaPush | null,
    public destinatarios: DestinatarioDeAviso[] = [],
  ) {}
  leerAviso = vi.fn(async () => this.aviso);
  destinatariosPendientes = vi.fn(async () => this.destinatarios);
}

class CanalDoble implements IPushSuscripcionRepository {
  constructor(
    public conCupo: string[] = [],
    public suscripciones: SuscripcionDeUsuario[] = [],
  ) {}
  registrar = vi.fn(async () => undefined);
  eliminarDeUsuario = vi.fn(async () => 0);
  eliminarPorId = vi.fn(async (id: string) => {
    this.suscripciones = this.suscripciones.filter((s) => s.id !== id);
  });
  listarPorUsuarios = vi.fn(async (ids: readonly string[]) =>
    this.suscripciones.filter((s) => ids.includes(s.usuarioId)),
  );
  sellarEnvioOk = vi.fn(async () => undefined);
  tomarCupoDelDia = vi.fn(async () => true);
  usuariosConCupoDe = vi.fn(async () => this.conCupo);
}

class SenderDoble implements IPushSender {
  readonly enviados: { id: string; payload: string }[] = [];
  constructor(private readonly respuestas: Record<string, PushOutcome> = {}) {}
  enviar = vi.fn(async (s: { id: string }, payload: string): Promise<PushOutcome> => {
    this.enviados.push({ id: s.id, payload });
    return this.respuestas[s.id] ?? { status: "ok" };
  });
}

function loggerDoble(): ErrorLogger & { mensajes: string[] } {
  const mensajes: string[] = [];
  return {
    mensajes,
    logError: (e: unknown) => mensajes.push(e instanceof Error ? e.message : String(e)),
  };
}

/** Resolutor de cifra viva que devuelve lo que se le diga; por defecto LANZA (nadie lo pide). */
function vigencia(cifra?: number): IVigenciaAvisoAgregado {
  return {
    cifra: vi.fn(async () => {
      if (cifra === undefined) throw new Error("no deberia pedirse");
      return cifra;
    }),
  };
}

const AVISO_MENSAJERO: AvisoParaPush = {
  id: "n-1",
  evento: "cierre_dia_vencido",
  descripcion: "Tu cierre del 2026-09-11 venció. No podés salir a ruta hasta que lo envíes.",
  anexo: "Cierre del 2026-09-11",
};

function montar(opciones: {
  aviso?: AvisoParaPush | null;
  destinatarios?: DestinatarioDeAviso[];
  conCupo?: string[];
  suscripciones?: SuscripcionDeUsuario[];
  respuestas?: Record<string, PushOutcome>;
  sender?: IPushSender | null;
  vigencia?: IVigenciaAvisoAgregado;
  logger?: ErrorLogger;
  piezasAusentes?: () => string[];
}) {
  const lector = new LectorDoble(
    opciones.aviso === undefined ? AVISO_MENSAJERO : opciones.aviso,
    opciones.destinatarios ?? [destinatario("u-m", "mensajero")],
  );
  const canal = new CanalDoble(
    opciones.conCupo ?? ["u-m"],
    opciones.suscripciones ?? [suscripcion("s-1", "u-m")],
  );
  const sender =
    opciones.sender === undefined ? new SenderDoble(opciones.respuestas) : opciones.sender;
  const service = new PushWebService({
    lector,
    canal,
    sender,
    vigencia: opciones.vigencia ?? vigencia(),
    now: () => AHORA,
    logger: opciones.logger,
    piezasAusentes: opciones.piezasAusentes,
  });
  return { service, lector, canal, sender: sender as SenderDoble | null };
}

/** Lo que viajo cifrado hasta el navegador, ya deserializado. */
function cargaDe(sender: SenderDoble, i = 0): PushCarga {
  return JSON.parse(sender.enviados[i].payload) as PushCarga;
}

describe("410/R8 — si el aviso ya no esta, o ya lo vieron, el trabajo TERMINA", () => {
  it("⭑ el aviso fue borrado: no se envia nada y NO se lanza (no reintentable)", async () => {
    const logger = loggerDoble();
    const { service, sender } = montar({ aviso: null, logger });
    await expect(service.ejecutar(job())).resolves.toBeUndefined();
    expect(sender!.enviados).toHaveLength(0);
    expect(logger.mensajes.join(" ")).toContain("ya no existe");
  });

  it("⭑ todos lo leyeron o lo descartaron: termina sin enviar", async () => {
    // `destinatariosPendientes` ya excluye a quien lo leyo o lo descarto; si no queda nadie, el
    // desenlace es FINAL. Reintentarlo seria volver cada minuto a descubrir lo mismo.
    const logger = loggerDoble();
    const { service, sender } = montar({ destinatarios: [], logger });
    await expect(service.ejecutar(job())).resolves.toBeUndefined();
    expect(sender!.enviados).toHaveLength(0);
    expect(logger.mensajes.join(" ")).toContain("destinatarios pendientes");
  });

  it("un payload sin `notificacionId` termina: no va a interpretarse mejor al tercer intento", async () => {
    const logger = loggerDoble();
    const { service } = montar({ logger });
    await expect(service.ejecutar(job({ payload: {} }))).resolves.toBeUndefined();
    expect(logger.mensajes.join(" ")).toContain("payload sin notificacionId");
  });
});

describe("410/R6 — solo suena quien gano el cupo del dia CON ESTE aviso", () => {
  it("⭑ un destinatario pendiente SIN cupo no recibe nada", async () => {
    const { service, sender } = montar({
      destinatarios: [destinatario("u-a", "mensajero"), destinatario("u-b", "mensajero")],
      conCupo: ["u-a"], // el cupo de `u-b` se lo llevo OTRO aviso del mismo tipo, antes
      suscripciones: [suscripcion("s-a", "u-a"), suscripcion("s-b", "u-b")],
    });
    await service.ejecutar(job());
    expect(sender!.enviados.map((e) => e.id)).toEqual(["s-a"]);
  });

  it("sin cupo para nadie, el trabajo termina sin consultar suscripciones", async () => {
    const { service, canal, sender } = montar({ conCupo: [] });
    await service.ejecutar(job());
    expect(canal.listarPorUsuarios).not.toHaveBeenCalled();
    expect(sender!.enviados).toHaveLength(0);
  });
});

describe("410/R9+R48 — el texto es el de la 409, entero y sin nada mas", () => {
  it("⭑ titulo, cuerpo, destino y evento; y NADA que el aviso no trajera", async () => {
    const { service, sender } = montar({});
    await service.ejecutar(job());

    const carga = cargaDe(sender!);
    // LITERALES ESCRITOS A MANO: es el contrato. Compararlos contra `presentacionDe` estaria
    // siempre verde — y el mockup aprobado es lo que manda.
    expect(carga.titulo).toBe(
      "Tu cierre del 2026-09-11 venció. No podés salir a ruta hasta que lo envíes.",
    );
    expect(carga.cuerpo).toBe("Cierre del 2026-09-11");
    // El atajo del mensajero para `cierre_dia_vencido`, que decide la 409.
    expect(carga.destino).toBe("/cierre-dia");
    expect(carga.evento).toBe("cierre_dia_vencido");
    // R48: cuatro campos y ni uno mas. Nada de direccion, telefono, monto ni nombre.
    expect(Object.keys(carga).sort()).toEqual(["cuerpo", "destino", "evento", "titulo"]);
  });

  it("⭑ el `rolLector` decide el destino: la MISMA fila leida por bodega no tendria atajo", async () => {
    // Si el servicio resolviera el atajo con `destinatario_rol` (que en esta fila es NULL), el
    // mensajero recibiria un push sin destino. Este caso fija que el rol viene del USUARIO.
    const { service, sender } = montar({ destinatarios: [destinatario("u-m", "mensajero")] });
    await service.ejecutar(job());
    expect(cargaDe(sender!).destino).toBe("/cierre-dia");
  });

  it("un aviso accionable SIN atajo (`geocodificacion_caida`) lleva la portada como destino", async () => {
    const { service, sender } = montar({
      aviso: {
        id: "n-1",
        evento: "geocodificacion_caida",
        descripcion: "El servicio de mapas está rechazando nuestras peticiones.",
        anexo: null,
      },
      destinatarios: [destinatario("u-maestro", "maestro")],
      conCupo: ["u-maestro"],
      suscripciones: [suscripcion("s-1", "u-maestro")],
    });
    await service.ejecutar(job());
    const carga = cargaDe(sender!);
    expect(carga.destino).toBe("/");
    expect(carga.cuerpo).toBe(""); // sin anexo: el push lleva solo el titulo
  });
});

describe("410/R52 — el texto NUNCA promete un numero que no ha contado", () => {
  const AVISO_AGREGADO: AvisoParaPush = {
    id: "n-1",
    evento: "novedades_sin_gestionar",
    descripcion: "La más antigua lleva 3 días en bodega. A los 5 días se rechaza automáticamente.",
    anexo: null,
  };

  it("⭑ CON conteo: el titulo lleva la cifra viva y el cuerpo el contexto", async () => {
    const { service, sender } = montar({
      aviso: AVISO_AGREGADO,
      destinatarios: [destinatario("u-tienda", "adminTienda")],
      conCupo: ["u-tienda"],
      suscripciones: [suscripcion("s-1", "u-tienda")],
      vigencia: vigencia(5),
    });
    await service.ejecutar(job());

    const carga = cargaDe(sender!);
    // Los DOS literales, escritos a mano y copiados del lienzo aprobado (`Push.dc.html`).
    expect(carga.titulo).toBe("5 novedades esperan tu decisión");
    expect(carga.cuerpo).toBe(
      "La más antigua lleva 3 días en bodega. A los 5 días se rechaza automáticamente.",
    );
  });

  it("⭑ SIN conteo (el resolutor falla): singular, sin cantidad, y NO se inventa un numero", async () => {
    const logger = loggerDoble();
    const vigenciaRota: IVigenciaAvisoAgregado = {
      cifra: vi.fn(async () => {
        throw new Error("la consulta del conteo se cayo");
      }),
    };
    const { service, sender } = montar({
      aviso: AVISO_AGREGADO,
      destinatarios: [destinatario("u-tienda", "adminTienda")],
      conCupo: ["u-tienda"],
      suscripciones: [suscripcion("s-1", "u-tienda")],
      vigencia: vigenciaRota,
      logger,
    });
    await service.ejecutar(job());

    const carga = cargaDe(sender!);
    // El texto PERSISTIDO, que no afirma cantidad alguna. Un push que dijera «1 novedad espera tu
    // decisión» con tres esperando es peor que uno que no cuenta: se lee como un dato y es falso.
    expect(carga.titulo).toBe(
      "La más antigua lleva 3 días en bodega. A los 5 días se rechaza automáticamente.",
    );
    expect(carga.titulo).not.toMatch(/\d+ novedad/);
    // Y el fallo queda registrado: nada se absorbe en silencio (R28).
    expect(logger.mensajes.join(" ")).toContain("cifra viva");
  });

  it("⭑ MUTACION R52: si se pasara `1` cuando el conteo no esta, el titulo AFIRMARIA una cantidad", async () => {
    // Se reproduce la mutacion 11 del design §15 sobre el mismo camino: con cifra `1` el titulo
    // pasa a afirmar «1 novedad espera tu decisión». El caso de arriba es el que se pone rojo.
    const { service, sender } = montar({
      aviso: AVISO_AGREGADO,
      destinatarios: [destinatario("u-tienda", "adminTienda")],
      conCupo: ["u-tienda"],
      suscripciones: [suscripcion("s-1", "u-tienda")],
      vigencia: vigencia(1),
    });
    await service.ejecutar(job());
    expect(cargaDe(sender!).titulo).toBe("1 novedad espera tu decisión");
  });

  it("⭑ el aviso AGREGADO se APAGA SOLO: con cifra 0 no se envia nada", async () => {
    const { service, sender } = montar({
      aviso: AVISO_AGREGADO,
      destinatarios: [destinatario("u-tienda", "adminTienda")],
      conCupo: ["u-tienda"],
      suscripciones: [suscripcion("s-1", "u-tienda")],
      vigencia: vigencia(0),
    });
    await service.ejecutar(job());
    // La tienda gestiono las novedades mientras el trabajo esperaba en la cola. No hay nada que
    // decir, asi que no se dice nada — tercera regla antirruido.
    expect(sender!.enviados).toHaveLength(0);
  });

  it("un evento NO agregado no le pide la cifra a nadie", async () => {
    // `vigencia()` sin argumento LANZA si alguien la llama: si el servicio la pidiera para
    // `cierre_dia_vencido`, este caso se pondria rojo.
    const { service, sender } = montar({});
    await service.ejecutar(job());
    expect(sender!.enviados).toHaveLength(1);
  });
});

describe("410/R26 — varias suscripciones, y el fallo de una no impide las demas", () => {
  it("⭑ tres dispositivos: la del medio falla y las otras dos se entregan igual", async () => {
    const { service, sender, canal } = montar({
      suscripciones: [
        suscripcion("s-1", "u-m"),
        suscripcion("s-2", "u-m"),
        suscripcion("s-3", "u-m"),
      ],
      respuestas: { "s-2": { status: "rechazada", detalle: "suscripcion s-2: HTTP 400" } },
    });

    await service.ejecutar(job());

    expect(sender!.enviados.map((e) => e.id)).toEqual(["s-1", "s-2", "s-3"]);
    // Las dos buenas quedaron selladas; la rechazada no, y tampoco se borro.
    expect(canal.sellarEnvioOk).toHaveBeenCalledTimes(2);
    expect(canal.eliminarPorId).not.toHaveBeenCalled();
  });

  it("una suscripcion que REVIENTA de forma imprevista no detiene a las siguientes", async () => {
    const logger = loggerDoble();
    const sender = new SenderDoble();
    sender.enviar = vi.fn(async (s: { id: string }) => {
      if (s.id === "s-1") throw new Error("algo inesperado");
      return { status: "ok" } as PushOutcome;
    });
    const { service, canal } = montar({
      suscripciones: [suscripcion("s-1", "u-m"), suscripcion("s-2", "u-m")],
      sender,
      logger,
    });

    // Un fallo imprevisto se trata como transitorio: la cola reintenta.
    await expect(service.ejecutar(job())).rejects.toThrow(/transitoria/);
    expect(canal.sellarEnvioOk).toHaveBeenCalledWith("s-2", AHORA);
  });

  it("R46: un destinatario SIN suscripciones no es un fallo", async () => {
    const { service } = montar({ suscripciones: [] });
    await expect(service.ejecutar(job())).resolves.toBeUndefined();
  });
});

describe("410/R33+R34+R36 — la tabla de desenlaces decide quien reintenta", () => {
  it("⭑ `caducada`: la suscripcion se BORRA y el trabajo TERMINA (no se reintenta)", async () => {
    const { service, canal } = montar({
      respuestas: { "s-1": { status: "caducada" } },
    });
    // No lanza: 404/410 es un desenlace FINAL. Reintentarlo es escribir a un buzon que ya no existe.
    await expect(service.ejecutar(job())).resolves.toBeUndefined();
    expect(canal.eliminarPorId).toHaveBeenCalledWith("s-1");
  });

  it("⭑ MUTACION R33: si `caducada` se tratara como `transitorio`, la muerta sobreviviria", async () => {
    // Mutacion 3 del design §15, reproducida sobre el mismo camino con el doble del emisor.
    const { service, canal } = montar({
      respuestas: { "s-1": { status: "transitorio", detalle: "suscripcion s-1: HTTP 500" } },
    });
    await expect(service.ejecutar(job())).rejects.toThrow();
    expect(canal.eliminarPorId).not.toHaveBeenCalled(); // sigue viva, y la cola volvera
  });

  it("⭑ `transitorio`: LANZA, que es como la cola sabe que tiene que reintentar con backoff", async () => {
    const { service } = montar({
      respuestas: { "s-1": { status: "transitorio", detalle: "suscripcion s-1: HTTP 503" } },
    });
    await expect(service.ejecutar(job())).rejects.toThrow(/job-1/);
  });

  it("⭑ `rechazada`: NO lanza y NO borra — el problema es nuestro, no de la persona", async () => {
    const { service, canal } = montar({
      respuestas: { "s-1": { status: "rechazada", detalle: "suscripcion s-1: HTTP 400" } },
    });
    await expect(service.ejecutar(job())).resolves.toBeUndefined();
    expect(canal.eliminarPorId).not.toHaveBeenCalled();
  });

  it("⭑ `ok`: sella el envio y termina", async () => {
    const { service, canal } = montar({});
    await expect(service.ejecutar(job())).resolves.toBeUndefined();
    expect(canal.sellarEnvioOk).toHaveBeenCalledWith("s-1", AHORA);
  });
});

describe("410/R30 — sin claves VAPID el trabajo TERMINA, citando el NOMBRE de la variable", () => {
  it("⭑ no lanza, no envia, y el log nombra la variable ausente", async () => {
    const logger = loggerDoble();
    const { service } = montar({
      sender: null,
      logger,
      piezasAusentes: () => ["VAPID_PRIVATE_KEY"],
    });

    // R36: termina. Un trabajo que no puede progresar y no termina se reclama cada minuto y
    // desplaza a los otros nueve tipos de la cola.
    await expect(service.ejecutar(job())).resolves.toBeUndefined();
    expect(logger.mensajes.join(" ")).toContain("VAPID_PRIVATE_KEY");
  });

  it("⭑ R31: el log NO lleva ningun valor de clave, solo el nombre", async () => {
    const logger = loggerDoble();
    const { service } = montar({
      sender: null,
      logger,
      piezasAusentes: () => ["VAPID_PRIVATE_KEY"],
    });
    await service.ejecutar(job());
    expect(logger.mensajes.join(" ")).not.toMatch(/BN[A-Za-z0-9_-]{20,}/);
  });
});

describe("410/R23 — ni el endpoint ni las claves aparecen en un log", () => {
  it("⭑ barrido sobre todos los mensajes de una corrida con desenlaces mixtos", async () => {
    const logger = loggerDoble();
    const { service } = montar({
      suscripciones: [suscripcion("s-1", "u-m"), suscripcion("s-2", "u-m")],
      respuestas: {
        "s-1": { status: "caducada" },
        "s-2": { status: "rechazada", detalle: "suscripcion s-2: HTTP 400" },
      },
      logger,
    });
    await service.ejecutar(job());

    // AUTOCOMPROBACION: sin mensajes, el barrido de abajo seria verde por vacio.
    expect(logger.mensajes.length).toBeGreaterThan(0);
    const todo = logger.mensajes.join(" | ");
    expect(todo).not.toContain("ENDPOINT-SECRETO");
    expect(todo).not.toContain("P256DH-");
    expect(todo).not.toContain("AUTH-");
    expect(todo).toContain("s-1"); // el identificador PROPIO si
  });
});
