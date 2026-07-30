import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  appendCambioEstado,
  resetCatalogoEstadosCache,
} from "@/lib/repositories/registrar-cambio-estado";
import { type OrderStatusValue } from "@/lib/types/order-status";
import {
  TransicionIlegalError,
  TransicionNoValidableError,
} from "@/lib/types/order-status-transiciones";
import type { CambioEstadoEntrada } from "@/lib/interfaces/repositories/IOrdenHistorialRepository";
import {
  INVENTARIO_CREACION,
  INVENTARIO_FLUJO,
  RECUENTO_INVENTARIO,
} from "@/tests/fixtures/inventario-transiciones-140";
import { filasCatalogoEstados, idEstado } from "@/tests/fixtures/catalogo-estados";

// Feature 140 — T3.3 (R7/R11/R13) + T3.4 (R8 data-driven sobre el inventario COMPLETO):
// la GUARDIA en el choke point `appendCambioEstado`.
//
// El `tx` es un doble con SEMANTICA: su `$queryRaw` responde el catalogo `order_status`
// completo (id sintetico `os-<value>` por cada uno de los 18 `value` del SEED), que es
// exactamente lo que hace la tabla real tras el seed. Asi la guardia corre de verdad
// (resuelve `id -> value` y valida el par), sin Postgres.

const idDe = idEstado;

/** Argumento que el choke point pasa a `createMany` (se inspecciona en los tests de R11). */
interface CreateManyArg {
  data: Record<string, unknown>[];
}

function buildTx(conCatalogo = true) {
  const createMany = vi.fn(async (arg: CreateManyArg) => ({ count: arg.data.length }));
  const $queryRaw = vi.fn(async (strings: TemplateStringsArray) => {
    const sql = strings.join(" ");
    if (conCatalogo && sql.includes("order_status")) return filasCatalogoEstados();
    return [];
  });
  const tx = { ordenHistorialEstado: { createMany }, $queryRaw, $executeRaw: vi.fn() };
  return { tx, createMany, $queryRaw };
}

/** Cuenta SOLO las consultas del catalogo (las demas del call-site no cuentan). */
function consultasDeCatalogo($queryRaw: ReturnType<typeof vi.fn>): number {
  return $queryRaw.mock.calls.filter((call) =>
    (call[0] as TemplateStringsArray).join(" ").includes("order_status"),
  ).length;
}

function entrada(
  origen: OrderStatusValue | null,
  destino: OrderStatusValue,
  origenTipo: CambioEstadoEntrada["origenTipo"] = "gestion",
  ordenId = "o1",
): CambioEstadoEntrada {
  return {
    ordenId,
    estatusOrigenId: origen === null ? null : idDe(origen),
    estatusDestinoId: idDe(destino),
    actorUsuarioId: "u1",
    origenTipo,
  };
}

beforeEach(() => {
  resetCatalogoEstadosCache(); // la cache es por proceso: cada test parte de frio
});

describe("R8/T3.4 — ninguna transicion del inventario empieza a fallar por la guardia", () => {
  it.each(INVENTARIO_FLUJO.map((a) => [a.n, a.origen, a.destino, a.via] as const))(
    "#%s deja pasar %s -> %s (origen_tipo %s) y registra el historial",
    async (_n, origen, destino, via) => {
      const { tx, createMany } = buildTx();
      const emitir = vi.fn(async () => {});
      await appendCambioEstado(tx as never, [entrada(origen, destino, via)], emitir);
      expect(createMany).toHaveBeenCalledTimes(1);
      expect(emitir).toHaveBeenCalledTimes(1);
    },
  );

  it.each(INVENTARIO_CREACION.map((a) => [a.destino, a.via] as const))(
    "creacion null -> %s (origen_tipo %s) pasa la guardia",
    async (destino, via) => {
      const { tx, createMany } = buildTx();
      const emitir = vi.fn(async () => {});
      await appendCambioEstado(tx as never, [entrada(null, destino, via)], emitir);
      expect(createMany).toHaveBeenCalledTimes(1);
    },
  );

  it("el test recorre el inventario COMPLETO de flujo y de creacion, sin muestreo", () => {
    expect(INVENTARIO_FLUJO).toHaveLength(RECUENTO_INVENTARIO.aristasFlujo);
    expect(INVENTARIO_CREACION).toHaveLength(RECUENTO_INVENTARIO.aristasCreacion);
  });

  it("un lote con TODAS las aristas de flujo a la vez pasa en una sola llamada", async () => {
    const { tx, createMany } = buildTx();
    const emitir = vi.fn(async () => {});
    const lote = INVENTARIO_FLUJO.map((a, i) => entrada(a.origen, a.destino, a.via, `o${i}`));
    await appendCambioEstado(tx as never, lote, emitir);
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany.mock.calls[0][0].data).toHaveLength(RECUENTO_INVENTARIO.aristasFlujo);
  });
});

describe("R7 — un lote con una sola transicion ilegal se rechaza ENTERO", () => {
  it("lanza TransicionIlegalError y NO escribe historial ni encola webhook", async () => {
    const { tx, createMany } = buildTx();
    const emitir = vi.fn(async () => {});
    const lote = [
      entrada("en_reparto", "entregada"), // legal (#12)
      entrada("entregada", "devuelta_a_tienda"), // ILEGAL
      entrada("por_recoger", "en_reparto", "recoleccion"), // legal (#11)
    ];
    await expect(appendCambioEstado(tx as never, lote, emitir)).rejects.toBeInstanceOf(
      TransicionIlegalError,
    );
    expect(createMany).not.toHaveBeenCalled(); // sin efectos parciales
    expect(emitir).not.toHaveBeenCalled(); // sin webhook de una transicion que no ocurrio
  });

  it("valida el lote ANTES del createMany, sea cual sea la posicion de la ilegal", async () => {
    for (const posicion of [0, 1, 2]) {
      const { tx, createMany } = buildTx();
      const emitir = vi.fn(async () => {});
      const lote = [
        entrada("en_reparto", "devuelta"),
        entrada("en_reparto", "rechazada"),
        entrada("en_reparto", "reprogramada"),
      ];
      lote[posicion] = entrada("devuelta_a_tienda", "en_reparto"); // ilegal
      await expect(appendCambioEstado(tx as never, lote, emitir)).rejects.toBeInstanceOf(
        TransicionIlegalError,
      );
      expect(createMany).not.toHaveBeenCalled();
      expect(emitir).not.toHaveBeenCalled();
    }
  });

  it("el error identifica el par ofensor sin filtrar el id de la orden ni el actor", async () => {
    const { tx } = buildTx();
    const emitir = vi.fn(async () => {});
    const lote = [entrada("rechazada", "devolviendo_a_tienda", "ajuste_estado", "orden-secreta")];
    await expect(appendCambioEstado(tx as never, lote, emitir)).rejects.toThrow(
      "transicion ilegal: rechazada -> devolviendo_a_tienda",
    );
    await expect(appendCambioEstado(tx as never, lote, emitir)).rejects.not.toThrow(
      /orden-secreta|u1|os-/,
    );
  });

  it("R9/Q3: el ajuste administrativo generico NO tiene override ANY -> ANY", async () => {
    const { tx, createMany } = buildTx();
    const emitir = vi.fn(async () => {});
    // Un maestro/admin "rescatando" una orden a un estado arbitrario (origen_tipo ajuste_estado).
    const lote = [entrada("sin_gestionar", "entregada", "ajuste_estado")];
    await expect(appendCambioEstado(tx as never, lote, emitir)).rejects.toBeInstanceOf(
      TransicionIlegalError,
    );
    expect(createMany).not.toHaveBeenCalled();
  });

  it("R10: nacer (origen null) fuera de ESTADOS_CREACION se rechaza en el choke point", async () => {
    const { tx, createMany } = buildTx();
    const emitir = vi.fn(async () => {});
    const lote = [entrada(null, "entregada", "creacion_manual")];
    await expect(appendCambioEstado(tx as never, lote, emitir)).rejects.toBeInstanceOf(
      TransicionIlegalError,
    );
    expect(createMany).not.toHaveBeenCalled();
  });
});

describe("R11 — con transiciones legales el comportamiento es identico al previo", () => {
  it("hace el mismo append del historial y el mismo encolado del webhook", async () => {
    const { tx, createMany } = buildTx();
    const emitir = vi.fn(async () => {});
    const lote = [
      {
        ...entrada("en_reparto", "entregada"),
        motivo: "entregada al cliente",
        gestionOrdenId: "g1",
      },
    ];
    await appendCambioEstado(tx as never, lote, emitir);
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany.mock.calls[0][0]).toEqual({
      data: [
        {
          ordenId: "o1",
          estatusOrigenId: idDe("en_reparto"),
          estatusDestinoId: idDe("entregada"),
          actorUsuarioId: "u1",
          origenTipo: "gestion",
          motivo: "entregada al cliente",
          gestionOrdenId: "g1",
        },
      ],
    });
    expect(emitir).toHaveBeenCalledWith(tx, lote); // outbox del webhook (feature 99), intacto
  });

  it("un lote vacio sigue siendo no-op: ni consulta el catalogo ni escribe", async () => {
    const { tx, createMany, $queryRaw } = buildTx();
    const emitir = vi.fn(async () => {});
    await appendCambioEstado(tx as never, [], emitir);
    expect(createMany).not.toHaveBeenCalled();
    expect(emitir).not.toHaveBeenCalled();
    expect($queryRaw).not.toHaveBeenCalled();
  });
});

describe("R13 — validacion O(1) sin round-trips de DB adicionales", () => {
  it("resuelve el catalogo UNA sola vez por proceso, aunque se llame muchas veces", async () => {
    const { tx, $queryRaw } = buildTx();
    const emitir = vi.fn(async () => {});
    for (let i = 0; i < 5; i += 1) {
      await appendCambioEstado(tx as never, [entrada("en_reparto", "entregada")], emitir);
    }
    expect(consultasDeCatalogo($queryRaw)).toBe(1); // cache por proceso
  });

  it("un lote de 50 transiciones no dispara una consulta por transicion", async () => {
    const { tx, $queryRaw } = buildTx();
    const emitir = vi.fn(async () => {});
    const lote = Array.from({ length: 50 }, (_, i) => entrada("por_recoger", "en_reparto", "recoleccion", `o${i}`));
    await appendCambioEstado(tx as never, lote, emitir);
    expect(consultasDeCatalogo($queryRaw)).toBe(1);
  });

  it("la cache se comparte entre llamadas con distintos tx (el catalogo es inmutable)", async () => {
    const emitir = vi.fn(async () => {});
    const primero = buildTx();
    await appendCambioEstado(primero.tx as never, [entrada("en_reparto", "devuelta")], emitir);
    const segundo = buildTx();
    await appendCambioEstado(segundo.tx as never, [entrada("en_reparto", "rechazada")], emitir);
    expect(consultasDeCatalogo(primero.$queryRaw)).toBe(1);
    expect(consultasDeCatalogo(segundo.$queryRaw)).toBe(0);
  });
});

describe("resolvedor de catalogo inyectable (patron del emisor de webhooks)", () => {
  it("acepta un resolvedor inyectado y valida con el, sin tocar el tx", async () => {
    const { tx, createMany, $queryRaw } = buildTx();
    const emitir = vi.fn(async () => {});
    const catalogo = vi.fn(async () =>
      new Map<string, OrderStatusValue>([
        [idDe("en_reparto"), "en_reparto"],
        [idDe("entregada"), "entregada"],
      ]),
    );
    await appendCambioEstado(tx as never, [entrada("en_reparto", "entregada")], emitir, catalogo);
    expect(catalogo).toHaveBeenCalledTimes(1);
    expect(consultasDeCatalogo($queryRaw)).toBe(0);
    expect(createMany).toHaveBeenCalledTimes(1);
  });

  it("con el catalogo inyectado, una transicion ilegal sigue lanzando", async () => {
    const { tx, createMany } = buildTx();
    const emitir = vi.fn(async () => {});
    const catalogo = vi.fn(async () =>
      new Map<string, OrderStatusValue>([
        [idDe("entregada"), "entregada"],
        [idDe("devuelta_a_tienda"), "devuelta_a_tienda"],
      ]),
    );
    await expect(
      appendCambioEstado(
        tx as never,
        [entrada("entregada", "devuelta_a_tienda")],
        emitir,
        catalogo,
      ),
    ).rejects.toBeInstanceOf(TransicionIlegalError);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("con el catalogo inyectado, un id que no resuelve tambien lanza", async () => {
    const { tx, createMany } = buildTx();
    const emitir = vi.fn(async () => {});
    const catalogo = vi.fn(async () =>
      new Map<string, OrderStatusValue>([[idDe("entregada"), "entregada"]]),
    );
    await expect(
      appendCambioEstado(tx as never, [entrada("en_reparto", "entregada")], emitir, catalogo),
    ).rejects.toBeInstanceOf(TransicionNoValidableError);
    expect(createMany).not.toHaveBeenCalled();
  });
});

// FALLO CERRADO (Q7). Antes existia aqui un test que consagraba lo contrario ("un tx que no
// puede leer el catalogo no rompe el append"): era el contrato del fail-open. Se elimino y se
// sustituye por estos, que exigen el RECHAZO. Si la guardia no puede DEMOSTRAR que la
// transicion es legal, no se escribe: "no sé" se trata como "no".
describe("Q7 — fallo CERRADO: sin catalogo no hay escritura", () => {
  it("un tx sin $queryRaw (doble parcial) RECHAZA el append", async () => {
    const createMany = vi.fn(async () => ({ count: 1 }));
    const tx = { ordenHistorialEstado: { createMany } };
    const emitir = vi.fn(async () => {});
    await expect(
      appendCambioEstado(tx as never, [entrada("en_reparto", "entregada")], emitir),
    ).rejects.toBeInstanceOf(TransicionNoValidableError);
    expect(createMany).not.toHaveBeenCalled();
    expect(emitir).not.toHaveBeenCalled();
  });

  it("un $queryRaw que no devuelve filas de catalogo RECHAZA el append", async () => {
    const { tx, createMany } = buildTx(false); // responde [] a la consulta del catalogo
    const emitir = vi.fn(async () => {});
    await expect(
      appendCambioEstado(tx as never, [entrada("en_reparto", "entregada")], emitir),
    ).rejects.toBeInstanceOf(TransicionNoValidableError);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("un fallo de lectura del catalogo se propaga y revierte la tx (no degrada)", async () => {
    const createMany = vi.fn(async () => ({ count: 1 }));
    const tx = {
      ordenHistorialEstado: { createMany },
      $queryRaw: vi.fn(async () => {
        throw new Error("connection terminated");
      }),
    };
    const emitir = vi.fn(async () => {});
    await expect(
      appendCambioEstado(tx as never, [entrada("en_reparto", "entregada")], emitir),
    ).rejects.toThrow("connection terminated");
    expect(createMany).not.toHaveBeenCalled();
  });

  it("DRIFT DB->build: un value que el build no conoce NO pasa sin validar", async () => {
    // La tabla `order_status` tiene un value que este build todavia no lista en el SEED
    // (deploy con el catalogo por delante del codigo). Antes esa transicion se colaba: el id
    // existe, la FK es feliz y la guardia la saltaba. Ahora se RECHAZA.
    const createMany = vi.fn(async () => ({ count: 1 }));
    const tx = {
      ordenHistorialEstado: { createMany },
      $queryRaw: vi.fn(async () => [
        ...filasCatalogoEstados(),
        { id: "os-estado-del-futuro", value: "estado_del_futuro" },
      ]),
    };
    const emitir = vi.fn(async () => {});
    await expect(
      appendCambioEstado(
        tx as never,
        [
          {
            ordenId: "o1",
            estatusOrigenId: idDe("en_reparto"),
            estatusDestinoId: "os-estado-del-futuro",
            actorUsuarioId: "u1",
            origenTipo: "gestion",
          },
        ],
        emitir,
      ),
    ).rejects.toBeInstanceOf(TransicionNoValidableError);
    expect(createMany).not.toHaveBeenCalled();
    expect(emitir).not.toHaveBeenCalled();
  });

  // Feature 154 (R32): la 154 hace crecer el catalogo, asi que el drift DB->build vuelve a estar
  // sobre la mesa (base migrada, build viejo). El contrato no cambia: se RECHAZA con
  // `TransicionNoValidableError` y motivo `estatus_desconocido`, sin permitirla ni registrarla.
  it("154/R32: un estado de la DB que el build no reconoce -> motivo `estatus_desconocido`", async () => {
    const createMany = vi.fn(async () => ({ count: 1 }));
    const tx = {
      ordenHistorialEstado: { createMany },
      // La tabla ya tiene un value del flujo v3 que este build no lista en ORDER_STATUS_SEED.
      $queryRaw: vi.fn(async () => [
        ...filasCatalogoEstados(),
        { id: "os-estado-de-otra-feature", value: "estado_de_otra_feature" },
      ]),
    };
    const emitir = vi.fn(async () => {});
    let capturado: unknown;
    try {
      await appendCambioEstado(
        tx as never,
        [
          {
            ordenId: "o1",
            estatusOrigenId: idDe("en_reparto"),
            estatusDestinoId: "os-estado-de-otra-feature",
            actorUsuarioId: "u1",
            origenTipo: "gestion",
          },
        ],
        emitir,
      );
    } catch (error) {
      capturado = error;
    }
    expect(capturado).toBeInstanceOf(TransicionNoValidableError);
    expect((capturado as TransicionNoValidableError).motivo).toBe("estatus_desconocido");
    expect((capturado as TransicionNoValidableError).lado).toBe("destino");
    expect(createMany).not.toHaveBeenCalled();
    expect(emitir).not.toHaveBeenCalled();
  });

  // Feature 154 (R33): la direccion contraria del drift — el BUILD conoce los dos values nuevos
  // pero la DB todavia no los tiene (codigo desplegado antes de migrar). Todas las transiciones
  // PREEXISTENTES deben seguir validando exactamente igual.
  it("154/R33: con la DB sin los dos values nuevos, las transiciones previas siguen validando", async () => {
    const createMany = vi.fn(async (arg: CreateManyArg) => ({ count: arg.data.length }));
    const sinLosNuevos = filasCatalogoEstados().filter(
      (fila) => fila.value !== "por_recolectar_en_tienda" && fila.value !== "incidente",
    );
    // 17 y no 18: la foto de la DB pre-154 tenia 18 values, pero la feature 155 retiro uno de
    // ellos del catalogo TS (y de la DB, con su migracion), asi que este fixture ya no lo
    // fabrica. El invariante que el test prueba —las transiciones PREEXISTENTES siguen
    // validando con una DB que no conoce los values nuevos— no depende del numero.
    expect(sinLosNuevos).toHaveLength(17);
    const tx = {
      ordenHistorialEstado: { createMany },
      $queryRaw: vi.fn(async () => sinLosNuevos),
      $executeRaw: vi.fn(),
    };
    const emitir = vi.fn(async () => {});
    const previas = INVENTARIO_FLUJO.filter(
      (a) =>
        a.origen !== "por_recolectar_en_tienda" &&
        a.destino !== "por_recolectar_en_tienda" &&
        a.origen !== "incidente" &&
        a.destino !== "incidente",
    );
    // Feature 158: las aristas que TOCAN los values de la 154 pasan de 2 a 13. El PR 1 anadio
    // #53 (`incidente -> en_reparto`, el deshacer del mensajero) y el PR 2 las DIEZ del camino
    // del ADMIN (#48-#52 entradas + #54-#58 inversas). El descuento se mueve con ellas.
    const ARISTAS_QUE_TOCAN_LOS_VALUES_154 = 13; // #43, #44 (154) + #53 + #48-#52/#54-#58 (158)
    expect(previas).toHaveLength(
      RECUENTO_INVENTARIO.aristasFlujo - ARISTAS_QUE_TOCAN_LOS_VALUES_154,
    );
    await appendCambioEstado(
      tx as never,
      previas.map((a, i) => entrada(a.origen, a.destino, a.via, `o${i}`)),
      emitir,
    );
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany.mock.calls[0][0].data).toHaveLength(previas.length);
  });

  it("el error de no-validable no filtra ids ni PII", async () => {
    const createMany = vi.fn(async () => ({ count: 1 }));
    const tx = { ordenHistorialEstado: { createMany } };
    const emitir = vi.fn(async () => {});
    await expect(
      appendCambioEstado(
        tx as never,
        [entrada("en_reparto", "entregada", "gestion", "orden-secreta")],
        emitir,
      ),
    ).rejects.toThrow("transicion no validable: el catalogo de estados no esta disponible");
    await expect(
      appendCambioEstado(
        tx as never,
        [entrada("en_reparto", "entregada", "gestion", "orden-secreta")],
        emitir,
      ),
    ).rejects.not.toThrow(/orden-secreta|u1|os-/);
  });
});
