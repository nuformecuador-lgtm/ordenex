import { describe, it, expect, vi, beforeEach } from "vitest";
import { appendCambioEstado } from "@/lib/repositories/registrar-cambio-estado";
import type { ChokePointTx } from "@/lib/repositories/registrar-cambio-estado";
import { GestionOrdenRepository } from "@/lib/repositories/GestionOrdenRepository";
import { emisorNotificacionReal, emitirOrdenRechazada } from "@/lib/notificaciones/emitir";
import type { CrearNotificacionInput } from "@/lib/interfaces/repositories/INotificacionRepository";
import type { GestionResultado } from "@prisma/client";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

// Feature 146 — B13. Productor TRANSACCIONAL del aviso «orden rechazada por el destinatario».
// Cubre R18, R19, R20 y R21 de la 146.
//
// ⏳ 2026-09-23 — FICHA 454 (design DD, R35): EL DISPARO SE MUDA. Hasta hoy el aviso salia del choke
// point `appendCambioEstado`, al escribirse la transicion `en_reparto -> rechazada` de familia
// `gestion`. Con la 454 la gestion ya NO transiciona al registrarse: esa transicion la escribe la
// APROBACION del cierre, horas despues. Dejar el emisor en el choke point haria que el aviso llegara
// TARDE —y dos veces—. El aviso sale ahora en `GestionOrdenRepository.registrarGestionPendiente`,
// dentro de SU transaccion, en el MISMO instante que antes (el registro del mensajero). Las
// garantias de la 146 se conservan, reapuntadas:
//   R18 (cuatro avisos con su alcance)     -> al registrar una gestion `rechazada`
//   R19 (el escalado por SLA no notifica)  -> el choke point ya no notifica NADA (ni SLA, ni tienda)
//   R20 (rollback sin avisos)              -> el aviso vive en la tx del registro
//   R21 (si la emision falla, no persiste) -> el error del aviso tumba el registro entero
// Y la 237/D4 y la 240/R45 (la tienda no emite «rechazada POR EL DESTINATARIO»): la via de la tienda
// (`crearGestionDesdeAyuda`) no llama al emisor.

const ORDEN = {
  id: "o-1",
  tiendaId: "tienda-1",
  zonaId: "zona-1",
  numGuia: 4242,
  numRemision: "REM-0042",
};

function colaFake() {
  return {
    enqueue: vi.fn(async () => null),
    claimBatch: vi.fn(async () => []),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    findByDedupeKeys: vi.fn(async () => []),
  };
}

/**
 * La transaccion del registro, con lo que `registrarGestionPendiente` toca: candado + re-lectura
 * (`$queryRaw`), la gestion, el evento, la lectura de la orden para el aviso y las notificaciones.
 * `aplicada` emula el COMMIT: las notificaciones solo sobreviven si el callback resuelve.
 */
function buildRegistro(orden: Record<string, unknown> = ORDEN, cola = colaFake()) {
  const comprometidas: Record<string, unknown>[] = [];
  let buffer: Record<string, unknown>[] = [];
  const tx = {
    $queryRaw: vi.fn(async (q: unknown) => {
      const partes = Array.isArray(q) ? q : ((q as { strings?: string[] }).strings ?? []);
      return partes.join(" ").includes("webhook_suscripcion") ? [] : [{ id: orden.id }];
    }),
    ordenEvento: { create: vi.fn(async () => ({ id: "ev-1" })) },
    gestionOrden: { create: vi.fn(async () => ({ id: "g-1" })) },
    gestionOrdenEvidencia: { createMany: vi.fn(async () => ({ count: 0 })) },
    gestionOrdenPago: { createMany: vi.fn(async () => ({ count: 0 })) },
    orden: {
      findUniqueOrThrow: vi.fn(async () => orden),
      update: vi.fn(async () => ({})),
    },
    usuario: { update: vi.fn(async () => ({})) },
    ordenHistorialEstado: { createMany: vi.fn(async () => ({ count: 0 })) },
    notificacion: {
      create: vi.fn(async (arg: { data: Record<string, unknown> }) => {
        buffer.push(arg.data);
        return { id: `n-${buffer.length}` };
      }),
      findFirst: vi.fn(async () => null), // sin dedupe previa
    },
    notificacionLectura: {},
  };
  const $transaction = vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => {
    buffer = [];
    const r = await cb(tx); // si lanza, `buffer` no se compromete (ROLLBACK)
    comprometidas.push(...buffer);
    return r;
  });
  const repo = new GestionOrdenRepository({ $transaction } as never, cola as never);
  return { repo, tx, comprometidas };
}

function registrar(repo: GestionOrdenRepository, resultado: GestionResultado = "rechazada") {
  return repo.registrarGestionPendiente({
    ordenId: "o-1",
    mensajeroId: "men-1",
    gestion:
      resultado === "entregada"
        ? { resultado, montoRecibido: 100, metodoPago: "efectivo", evidencias: [] }
        : { resultado, motivo: "no la quiso", evidencias: [] },
  });
}

beforeEach(async () => {
  await sembrarCatalogoEstados();
});

describe("R18 → 454/R35 — registrar un rechazo crea cuatro avisos con su alcance", () => {
  it("emite maestro y admin sin alcance, adminTienda por tienda y adminSatelite por zona", async () => {
    const { repo, comprometidas } = buildRegistro();

    await registrar(repo);

    expect(comprometidas).toHaveLength(4);
    expect(
      comprometidas.map((c) => ({
        rol: c.destinatarioRol,
        tiendaId: c.tiendaId,
        zonaId: c.zonaId,
      })),
    ).toEqual([
      { rol: "maestro", tiendaId: null, zonaId: null },
      { rol: "admin", tiendaId: null, zonaId: null },
      { rol: "adminTienda", tiendaId: "tienda-1", zonaId: null },
      { rol: "adminSatelite", tiendaId: null, zonaId: "zona-1" },
    ]);
  });

  it("las cuatro son de tipo alert, referencian la orden y llevan la guia como anexo", async () => {
    const { repo, comprometidas } = buildRegistro();

    await registrar(repo);

    for (const fila of comprometidas) {
      expect(fila.tipo).toBe("alert");
      expect(fila.evento).toBe("orden_rechazada");
      expect(fila.entidadTipo).toBe("orden");
      expect(fila.entidadId).toBe("o-1");
      expect(fila.anexo).toBe("4242");
      expect(fila.descripcion).toBe("Una orden fue rechazada por el destinatario.");
      // §4.6: nunca direccion, telefono ni monto.
      expect(String(fila.descripcion)).not.toMatch(/\d+[,.]\d{2}/);
    }
  });

  it("usa el numero de remision como anexo cuando la orden aun no tiene guia", async () => {
    const { repo, comprometidas } = buildRegistro({ ...ORDEN, numGuia: null });

    await registrar(repo);

    expect(comprometidas.every((c) => c.anexo === "REM-0042")).toBe(true);
  });

  it("omite SOLO la fila del adminSatelite si la zona de la orden no se resuelve", async () => {
    const { repo, comprometidas } = buildRegistro({ ...ORDEN, zonaId: null });

    await registrar(repo);

    expect(comprometidas).toHaveLength(3);
    expect(comprometidas.map((c) => c.destinatarioRol)).toEqual(["maestro", "admin", "adminTienda"]);
  });

  it("CONTROL: registrar un resultado que no es `rechazada` NO avisa ni lee la orden", async () => {
    for (const resultado of ["entregada", "devuelta", "reprogramada", "incidente"] as const) {
      const { repo, tx, comprometidas } = buildRegistro();
      await registrar(repo, resultado);
      expect(comprometidas, resultado).toHaveLength(0);
      expect(tx.orden.findUniqueOrThrow, resultado).not.toHaveBeenCalled();
    }
  });

  it("454: el registro que NO pasa la re-lectura (ya no gestionable) no avisa", async () => {
    const { repo, tx, comprometidas } = buildRegistro();
    tx.$queryRaw.mockImplementation(async () => []); // la re-lectura bajo candado no la ve

    const r = await registrar(repo);

    expect(r).toBeNull();
    expect(comprometidas).toHaveLength(0);
  });
});

describe("R19/R45 → 454/DD — el choke point ya NO emite el aviso, venga de donde venga", () => {
  function buildChokeTx() {
    const tx = {
      ordenHistorialEstado: { createMany: vi.fn(async () => ({ count: 1 })) },
      orden: { findMany: vi.fn(async () => [ORDEN]) },
      notificacion: { create: vi.fn(async () => ({ id: "n" })), findFirst: vi.fn(async () => null) },
      notificacionLectura: {},
    };
    return tx;
  }
  const entrada = (origenTipo: "gestion" | "escalado_devuelta_sla" | "rechazo_tienda") => ({
    ordenId: "o-1",
    estatusOrigenId: idEstado(origenTipo === "gestion" ? "en_reparto" : "devuelta"),
    estatusDestinoId: idEstado("rechazada"),
    actorUsuarioId: origenTipo === "escalado_devuelta_sla" ? null : "x",
    origenTipo,
  });

  it("la transicion `en_reparto -> rechazada` de familia `gestion` (la APLICACION al aprobar) no avisa", async () => {
    // Es la que antes avisaba. Ahora la escribe la aprobacion, horas despues del hecho: el aviso ya
    // salio al registrar. Si este emisor volviera, el aviso llegaria dos veces.
    const tx = buildChokeTx();

    await appendCambioEstado(tx as unknown as ChokePointTx, [entrada("gestion")], async () => {});

    expect(tx.notificacion.create).not.toHaveBeenCalled();
    expect(tx.orden.findMany).not.toHaveBeenCalled(); // ni siquiera consulta la orden
  });

  it("las TRES vias a `rechazada` en un lote: ninguna avisa desde el choke point", async () => {
    const tx = buildChokeTx();

    await appendCambioEstado(
      tx as unknown as ChokePointTx,
      [entrada("escalado_devuelta_sla"), entrada("rechazo_tienda"), entrada("gestion")],
      async () => {},
    );

    expect(tx.notificacion.create).not.toHaveBeenCalled();
  });

  it("el emisor real es un no-op: no consulta nada ni con un rechazo por gestion", async () => {
    const tx = buildChokeTx();
    await emisorNotificacionReal(
      tx as unknown as ChokePointTx,
      [entrada("gestion")],
      new Map([[idEstado("rechazada"), "rechazada"]]),
    );
    expect(tx.orden.findMany).not.toHaveBeenCalled();
    expect(tx.notificacion.create).not.toHaveBeenCalled();
  });
});

describe("R20 — si la transaccion del registro revierte, no queda ninguna notificacion", () => {
  it("el aviso vive dentro de la MISMA tx que la gestion (no hay canal fuera de la tx)", async () => {
    // Un paso POSTERIOR al aviso falla (el encolado de la re-optimizacion): la tx entera revierte.
    const colaQueFalla = {
      ...colaFake(),
      enqueue: vi.fn(async () => {
        throw new Error("transaccion abortada");
      }),
    };
    const { repo, tx, comprometidas } = buildRegistro(ORDEN, colaQueFalla);

    await expect(registrar(repo)).rejects.toThrow("transaccion abortada");

    // Se INTENTO avisar (si no, este caso pasaria por no haber llegado al aviso)...
    expect(tx.notificacion.create).toHaveBeenCalled();
    // ...y aun asi no sobrevivio ni uno.
    expect(comprometidas).toHaveLength(0);
  });
});

describe("R21 — si la emision falla, la gestion no se persiste", () => {
  it("el error de la emision propaga y tumba el registro entero", async () => {
    const { repo, tx } = buildRegistro();
    tx.notificacion.create.mockImplementation(async () => {
      throw new Error("emision caida");
    });

    await expect(registrar(repo)).rejects.toThrow("emision caida");
  });

  it("el fallo de la lectura de la orden dentro de la tx tambien propaga", async () => {
    const { repo, tx } = buildRegistro();
    tx.orden.findUniqueOrThrow.mockRejectedValue(new Error("lectura caida"));

    await expect(registrar(repo)).rejects.toThrow("lectura caida");
  });
});

describe("compatibilidad del choke point con los call-sites existentes", () => {
  it("la firma sigue aceptando (tx, entradas) sin el quinto parametro", async () => {
    const tx = {
      ordenHistorialEstado: { createMany: vi.fn(async () => ({ count: 1 })) },
    };
    await expect(
      appendCambioEstado(
        tx as unknown as ChokePointTx,
        [
          {
            ordenId: "o-1",
            estatusOrigenId: idEstado("en_reparto"),
            estatusDestinoId: idEstado("rechazada"),
            actorUsuarioId: "men-1",
            origenTipo: "gestion" as const,
          },
        ],
        async () => {},
      ),
    ).resolves.toBeUndefined();
  });
});

describe("emitirOrdenRechazada — dedupe (R27) sobre el rechazo", () => {
  it("no crea una segunda tanda si ya existe una no leida para la misma orden", async () => {
    const creadas: CrearNotificacionInput[] = [];
    const repo = {
      // FICHA 410 (design 6.1): `crear` devuelve el id de la fila creada, nunca un booleano.
      crear: vi.fn(async (input: CrearNotificacionInput) => {
        creadas.push(input);
        return `n-${creadas.length}`;
      }),
      existeNoLeidaPara: vi.fn(async () => true),
      listarParaUsuario: vi.fn(),
      verificarVisible: vi.fn(),
      marcarTodasLeidas: vi.fn(),
      descartar: vi.fn(),
    };

    const emitidas = await emitirOrdenRechazada(repo, {
      ordenId: "o-1",
      tiendaId: "tienda-1",
      zonaId: "zona-1",
      numGuia: 1,
      numRemision: "REM-1",
    });

    expect(emitidas).toBe(0);
    expect(repo.crear).not.toHaveBeenCalled();
  });
});
