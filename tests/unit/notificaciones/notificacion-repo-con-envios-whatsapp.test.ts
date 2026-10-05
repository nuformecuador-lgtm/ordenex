import { describe, expect, it, vi } from "vitest";
import { conEnviosWhatsapp, OPERACION_PUENTE } from "@/lib/notificaciones/notificacion-repo-con-envios-whatsapp";
import type {
  CrearNotificacionInput,
  INotificacionRepository,
  NotificacionTxClient,
} from "@/lib/interfaces/repositories/INotificacionRepository";

// Ficha 474 (T7.3, R26/R50/R51) — el decorador del puente con dobles: cuando NO toca nada (tx,
// dedupe, evento no disponible, fila a usuario o con alcance, sin entidad), que encola UN trabajo
// con su dedupe_key y la foto del aviso SIN anexo, y que un fallo NO llega al aviso.

const AHORA = new Date("2026-10-05T11:00:00.000Z");

function input(o: Partial<CrearNotificacionInput> = {}): CrearNotificacionInput {
  return {
    tipo: "alert",
    evento: "geocodificacion_caida",
    descripcion: "El servicio de mapas está rechazando…",
    anexo: "Juan Pérez (dato personal)",
    entidadTipo: "geocodificacion_caida_dia",
    entidadId: "2026-10-05",
    destinatario: { tipo: "rol", rol: "maestro" },
    ...o,
  };
}

function montar(o: { id?: string | null; hay?: boolean; hayLanza?: boolean } = {}) {
  const base = {
    crear: vi.fn(async () => (o.id === undefined ? "noti-1" : o.id)),
    existeNoLeidaPara: vi.fn(),
    listarParaUsuario: vi.fn(),
    verificarVisible: vi.fn(),
    marcarTodasLeidas: vi.fn(),
    descartar: vi.fn(),
  } as unknown as INotificacionRepository & { crear: ReturnType<typeof vi.fn> };
  const envios = {
    hayEncendidosConEvento: vi.fn(async () => {
      if (o.hayLanza) throw new Error("conexion caida");
      return o.hay ?? true;
    }),
  };
  const cola = { enqueue: vi.fn(async () => null) };
  const errores: unknown[] = [];
  const repo = conEnviosWhatsapp(base, { envios, cola, now: () => AHORA, logger: { logError: (e: unknown) => errores.push(e) } });
  return { repo, base, envios, cola, errores };
}

describe("474/R26 — encola UN trabajo por aviso", () => {
  it("con un envio encendido: dedupe por la ENTIDAD y payload sin anexo", async () => {
    const { repo, cola, envios } = montar();
    expect(await repo.crear(input())).toBe("noti-1");
    expect(envios.hayEncendidosConEvento).toHaveBeenCalledWith("geocodificacion_caida");
    expect(cola.enqueue).toHaveBeenCalledWith(
      "whatsapp_envio_evento",
      {
        evento: "geocodificacion_caida",
        referencia: "2026-10-05",
        notificacionId: "noti-1",
        datos: { texto: "El servicio de mapas está rechazando…", rolFila: "maestro", creadoAt: AHORA.toISOString() },
      },
      { dedupeKey: "wa_envio_evento:geocodificacion_caida:2026-10-05", maxIntentos: 3 },
    );
  });

  it("R51: el payload NO lleva el anexo (nombre de persona) en ninguna parte", async () => {
    const { repo, cola } = montar();
    await repo.crear(input());
    expect(JSON.stringify(cola.enqueue.mock.calls[0])).not.toContain("Juan");
  });

  it("todos apagados: una consulta y CERO escrituras", async () => {
    const { repo, cola, envios } = montar({ hay: false });
    await repo.crear(input());
    expect(envios.hayEncendidosConEvento).toHaveBeenCalledTimes(1);
    expect(cola.enqueue).not.toHaveBeenCalled();
  });
});

describe("474/R50 — no toca nada", () => {
  const casos: [string, Partial<CrearNotificacionInput>][] = [
    ["evento no disponible (orden_rechazada)", { evento: "orden_rechazada" }],
    ["fila a un usuario", { destinatario: { tipo: "usuario", usuarioId: "u1" } }],
    ["fila acotada a una zona", { destinatario: { tipo: "rol", rol: "adminSatelite", zonaId: "z1" } }],
    ["fila acotada a una tienda", { destinatario: { tipo: "rol", rol: "adminTienda", tiendaId: "t1" } }],
    ["entidad nula", { entidadId: null }],
  ];
  for (const [nombre, o] of casos) {
    it(`${nombre}: cero consultas al repo de envios y a la cola`, async () => {
      const { repo, envios, cola } = montar();
      expect(await repo.crear(input(o))).toBe("noti-1");
      expect(envios.hayEncendidosConEvento).not.toHaveBeenCalled();
      expect(cola.enqueue).not.toHaveBeenCalled();
    });
  }

  it("con `tx` (transaccion de negocio): delega con el tx y CERO consultas", async () => {
    const { repo, base, envios, cola } = montar();
    const tx = {} as NotificacionTxClient;
    await repo.crear(input(), tx);
    expect(base.crear).toHaveBeenCalledWith(expect.anything(), tx);
    expect(envios.hayEncendidosConEvento).not.toHaveBeenCalled();
    expect(cola.enqueue).not.toHaveBeenCalled();
  });

  it("la dedupe de la campana devolvio null: devuelve null y no hace nada mas", async () => {
    const { repo, envios, cola } = montar({ id: null });
    expect(await repo.crear(input())).toBeNull();
    expect(envios.hayEncendidosConEvento).not.toHaveBeenCalled();
    expect(cola.enqueue).not.toHaveBeenCalled();
  });

  it("⭑ el repo de envios LANZA: el aviso queda creado y el error va al log con su operacion", async () => {
    const { repo, errores } = montar({ hayLanza: true });
    expect(await repo.crear(input())).toBe("noti-1");
    expect(errores).toHaveLength(1);
    const e = errores[0] as Error;
    expect(e.message).toContain(OPERACION_PUENTE);
    expect((e.cause as Error).message).toBe("conexion caida");
  });
});

describe("474 — delegacion pura del resto", () => {
  it("listar/verificar/marcar/descartar van al repo base sin tocar envios", async () => {
    const { repo, base, envios } = montar();
    const actor = { usuarioId: "u", rol: "maestro" as const, zonaId: null };
    await repo.listarParaUsuario({ actor, desde: AHORA, limite: 1 });
    await repo.verificarVisible("x", actor);
    await repo.marcarTodasLeidas(actor, AHORA, AHORA);
    await repo.descartar("x", "u", AHORA);
    await repo.existeNoLeidaPara("geocodificacion_caida", "e", { tipo: "rol", rol: "maestro" });
    expect(base.listarParaUsuario).toHaveBeenCalled();
    expect(base.verificarVisible).toHaveBeenCalled();
    expect(base.marcarTodasLeidas).toHaveBeenCalled();
    expect(base.descartar).toHaveBeenCalled();
    expect(base.existeNoLeidaPara).toHaveBeenCalled();
    expect(envios.hayEncendidosConEvento).not.toHaveBeenCalled();
  });
});
