import { describe, it, expect, vi, beforeEach } from "vitest";
import { appendCambioEstado } from "@/lib/repositories/registrar-cambio-estado";
import type { ChokePointTx } from "@/lib/repositories/registrar-cambio-estado";
import { emisorNotificacionReal, emitirOrdenRechazada } from "@/lib/notificaciones/emitir";
import type { CrearNotificacionInput } from "@/lib/interfaces/repositories/INotificacionRepository";
import { idEstado, sembrarCatalogoEstados } from "@/tests/fixtures/catalogo-estados";

// Feature 146 — B13. Productor TRANSACCIONAL del rechazo del destinatario, enganchado al
// choke point `appendCambioEstado`. Cubre R18, R19, R20 y R21.

const ORDEN = {
  id: "o-1",
  tiendaId: "tienda-1",
  zonaId: "zona-1",
  numGuia: 4242,
  numRemision: "REM-0042",
};

function buildTx(orden: Record<string, unknown> = ORDEN) {
  const creadas: unknown[] = [];
  const tx = {
    ordenHistorialEstado: { createMany: vi.fn(async () => ({ count: 1 })) },
    orden: { findMany: vi.fn(async () => [orden]) },
    notificacion: {
      create: vi.fn(async (arg: { data: unknown }) => {
        creadas.push(arg.data);
        return { id: `n-${creadas.length}` };
      }),
      findFirst: vi.fn(async () => null), // sin dedupe previa
    },
    notificacionLectura: {},
  };
  return { tx, creadas: creadas as Record<string, unknown>[] };
}

/** Entrada de lote: `en_reparto -> rechazada` por la GESTION del mensajero (transicion #15). */
function rechazoPorGestion() {
  return {
    ordenId: "o-1",
    estatusOrigenId: idEstado("en_reparto"),
    estatusDestinoId: idEstado("rechazada"),
    actorUsuarioId: "men-1",
    origenTipo: "gestion" as const,
  };
}

/** Entrada de lote: `devuelta -> rechazada` por el escalado automatico de SLA (transicion #21). */
function rechazoPorSla() {
  return {
    ordenId: "o-1",
    estatusOrigenId: idEstado("devuelta"),
    estatusDestinoId: idEstado("rechazada"),
    actorUsuarioId: null,
    origenTipo: "escalado_devuelta_sla" as const,
  };
}

beforeEach(async () => {
  await sembrarCatalogoEstados();
});

describe("R18 — el rechazo del destinatario crea cuatro avisos con su alcance", () => {
  it("emite maestro y admin sin alcance, adminTienda por tienda y adminSatelite por zona", async () => {
    const { tx, creadas } = buildTx();

    await appendCambioEstado(tx as unknown as ChokePointTx, [rechazoPorGestion()], async () => {});

    expect(creadas).toHaveLength(4);
    expect(
      creadas.map((c) => ({
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
    const { tx, creadas } = buildTx();

    await appendCambioEstado(tx as unknown as ChokePointTx, [rechazoPorGestion()], async () => {});

    for (const fila of creadas) {
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
    const { tx, creadas } = buildTx({ ...ORDEN, numGuia: null });

    await appendCambioEstado(tx as unknown as ChokePointTx, [rechazoPorGestion()], async () => {});

    expect(creadas.every((c) => c.anexo === "REM-0042")).toBe(true);
  });

  it("omite SOLO la fila del adminSatelite si la zona de la orden no se resuelve", async () => {
    const { tx, creadas } = buildTx({ ...ORDEN, zonaId: null });

    await appendCambioEstado(tx as unknown as ChokePointTx, [rechazoPorGestion()], async () => {});

    expect(creadas).toHaveLength(3);
    expect(creadas.map((c) => c.destinatarioRol)).toEqual(["maestro", "admin", "adminTienda"]);
  });
});

describe("R19 — el escalado automatico por SLA NO notifica", () => {
  it("no crea ninguna notificacion cuando el rechazo viene de escalado_devuelta_sla", async () => {
    const { tx, creadas } = buildTx();

    await appendCambioEstado(tx as unknown as ChokePointTx, [rechazoPorSla()], async () => {});

    expect(creadas).toHaveLength(0);
    expect(tx.orden.findMany).not.toHaveBeenCalled(); // ni siquiera consulta la orden
  });

  it("no notifica transiciones de gestion cuyo destino no es `rechazada`", async () => {
    const { tx, creadas } = buildTx();

    await appendCambioEstado(
      tx as unknown as ChokePointTx,
      [
        {
          ordenId: "o-1",
          estatusOrigenId: idEstado("en_reparto"),
          estatusDestinoId: idEstado("entregada"),
          actorUsuarioId: "men-1",
          origenTipo: "gestion" as const,
        },
      ],
      async () => {},
    );

    expect(creadas).toHaveLength(0);
  });

  it("dentro de un lote mixto solo notifica el rechazo por gestion", async () => {
    const { tx, creadas } = buildTx();

    await appendCambioEstado(
      tx as unknown as ChokePointTx,
      [rechazoPorSla(), rechazoPorGestion()],
      async () => {},
    );

    expect(creadas).toHaveLength(4);
  });
});

describe("R20 — si la transaccion revierte, no queda ninguna notificacion", () => {
  it("la emision vive dentro del mismo tx que el append (no hay canal fuera de la tx)", async () => {
    const { tx, creadas } = buildTx();
    // Simula el rollback: el `tx` deja de aceptar escrituras a mitad de la transaccion.
    tx.notificacion.create.mockImplementation(async () => {
      throw new Error("transaccion abortada");
    });

    await expect(
      appendCambioEstado(tx as unknown as ChokePointTx, [rechazoPorGestion()], async () => {}),
    ).rejects.toThrow("transaccion abortada");

    expect(creadas).toHaveLength(0);
  });

  it("si el append del historial falla, la emision no llega a ejecutarse", async () => {
    const { tx, creadas } = buildTx();
    tx.ordenHistorialEstado.createMany.mockRejectedValue(new Error("append boom"));

    await expect(
      appendCambioEstado(tx as unknown as ChokePointTx, [rechazoPorGestion()], async () => {}),
    ).rejects.toThrow("append boom");

    expect(creadas).toHaveLength(0);
    expect(tx.notificacion.create).not.toHaveBeenCalled();
  });
});

describe("R21 — si la emision falla, el cambio de estado no se persiste", () => {
  it("propaga el error del emisor para que la transaccion del call-site revierta", async () => {
    const { tx } = buildTx();
    const emisorQueFalla = vi.fn(async () => {
      throw new Error("emision caida");
    });

    await expect(
      appendCambioEstado(
        tx as unknown as ChokePointTx,
        [rechazoPorGestion()],
        async () => {},
        undefined,
        emisorQueFalla,
      ),
    ).rejects.toThrow("emision caida");
    expect(emisorQueFalla).toHaveBeenCalledTimes(1);
  });

  it("el fallo de la lectura de la orden dentro de la tx tambien propaga", async () => {
    const { tx } = buildTx();
    tx.orden.findMany.mockRejectedValue(new Error("lectura caida"));

    await expect(
      appendCambioEstado(tx as unknown as ChokePointTx, [rechazoPorGestion()], async () => {}),
    ).rejects.toThrow("lectura caida");
  });
});

describe("compatibilidad del choke point con los call-sites existentes", () => {
  it("la firma sigue aceptando (tx, entradas) sin el quinto parametro", async () => {
    const { tx } = buildTx();
    await expect(
      appendCambioEstado(tx as unknown as ChokePointTx, [rechazoPorGestion()], async () => {}),
    ).resolves.toBeUndefined();
  });

  it("un `tx` sin las tablas de notificacion es un no-op (dobles historicos de la 49)", async () => {
    const txViejo = {
      ordenHistorialEstado: { createMany: vi.fn(async () => ({ count: 1 })) },
    };

    await expect(
      appendCambioEstado(txViejo as unknown as ChokePointTx, [rechazoPorGestion()], async () => {}),
    ).resolves.toBeUndefined();
  });

  it("el emisor real no consulta nada cuando el lote no trae ningun rechazo por gestion", async () => {
    const { tx } = buildTx();
    await emisorNotificacionReal(
      tx as unknown as ChokePointTx,
      [rechazoPorSla()],
      new Map([[idEstado("rechazada"), "rechazada"]]),
    );
    expect(tx.orden.findMany).not.toHaveBeenCalled();
  });
});

describe("emitirOrdenRechazada — dedupe (R27) sobre el rechazo", () => {
  it("no crea una segunda tanda si ya existe una no leida para la misma orden", async () => {
    const creadas: CrearNotificacionInput[] = [];
    const repo = {
      crear: vi.fn(async (input: CrearNotificacionInput) => {
        creadas.push(input);
        return true;
      }),
      existeNoLeidaPara: vi.fn(async () => true),
      listarParaUsuario: vi.fn(),
      verificarVisible: vi.fn(),
      marcarLeida: vi.fn(),
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
