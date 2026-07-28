import { describe, it, expect, vi } from "vitest";
import {
  ManifiestoService,
  BODEGA_CENTRAL_FALLBACK,
  RESPONSABLE_FALLBACK,
} from "@/lib/services/ManifiestoService";
import type {
  IOrdenRepository,
  ManifiestoOrdenRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { MANIFIESTO_FLUJOS, type ManifiestoFlujo } from "@/lib/types/manifiesto";

// Feature 148 — unit del SERVICIO UNICO del manifiesto (T15). Dobles a mano, sin
// Prisma ni HTTP: el service se instancia con repos falsos por constructor.

const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };
const ADMIN_TIENDA: Actor = { usuarioId: "tienda-1", rol: "adminTienda" };
const ACTOR_NOMBRE = "Ana Maestra";
const CENTRAL_NOMBRE = "Bodega Central GAM";

// Reloj fijo: 2026-07-16T02:00:00Z son las 20:00 del 15 de julio en CR (UTC-6). Si
// el service usara toISOString() la fecha saldria "2026-07-16" (off-by-one, R10).
const AHORA = new Date("2026-07-16T02:00:00.000Z");
const FECHA_CR = "2026-07-15";

function row(overrides: Partial<ManifiestoOrdenRow> = {}): ManifiestoOrdenRow {
  return {
    id: "o1",
    tiendaId: "tienda-1",
    numGuia: 501,
    numRemision: "REM-1",
    destinatario: "Juan Perez",
    telefonoDest: "88880000",
    direccion: "Av. Siempre Viva 742",
    montoCobrar: 25.5,
    tiendaNombre: "Tienda Uno",
    zonaNombre: "Cartago",
    zonaEsCentral: false,
    mensajeroAsignadoNombre: null,
    ...overrides,
  };
}

// Los 3 UNICOS metodos que el manifiesto puede tocar (R24). El Proxy delata
// cualquier otro acceso al repositorio: si el service intentara `update`,
// `generarGuiaLote`, `softDelete`... el nombre queda registrado en `prohibidas` y el
// test de R24 falla. No basta con el tipo `Pick<>`: esto lo verifica en ejecucion.
const METODOS_LECTURA = new Set([
  "findManifiestoByIds",
  "findManifiestoByRemisiones",
  "findUsuarioNombre",
]);

function fakeOrdenRepo(rows: ManifiestoOrdenRow[] = [row()], nombre: string | null = ACTOR_NOMBRE) {
  const prohibidas: string[] = [];
  const lectura = {
    // Simula el `where id in (...) and deleted_at is null` del repo.
    findManifiestoByIds: vi.fn(async (ids: string[]) => rows.filter((r) => ids.includes(r.id))),
    // Simula el `where num_remision in (...) and tienda_id = ? and deleted_at is null`.
    findManifiestoByRemisiones: vi.fn(async (remisiones: string[], tiendaId: string) =>
      rows.filter((r) => remisiones.includes(r.numRemision) && r.tiendaId === tiendaId),
    ),
    findUsuarioNombre: vi.fn(async () => nombre),
  };
  const repo = new Proxy(lectura as Record<string, unknown>, {
    get(target, prop) {
      const key = String(prop);
      if (METODOS_LECTURA.has(key)) return target[key];
      if (typeof prop === "string") prohibidas.push(key);
      return undefined;
    },
  }) as unknown as IOrdenRepository;
  return { repo, lectura, prohibidas };
}

function fakeZonaRepo(central: { id: string; nombre: string } | null = { id: "z-c", nombre: CENTRAL_NOMBRE }) {
  return {
    findCentralZonaId: vi.fn(async () => central?.id ?? null),
    findById: vi.fn(async (id: string) =>
      central && central.id === id
        ? { id, nombre: central.nombre, cobroVehiculo: false, distritosCount: 0, esCentral: true }
        : null,
    ),
  } as unknown as IZonaRepository;
}

function build(
  rows: ManifiestoOrdenRow[] = [row()],
  opts: { central?: { id: string; nombre: string } | null; nombre?: string | null } = {},
) {
  const { repo, lectura, prohibidas } = fakeOrdenRepo(
    rows,
    // `?? ACTOR_NOMBRE` colapsaria un `nombre: null` explicito (usuario no
    // resoluble), que es justo lo que fija el test del respaldo de `responsable`.
    opts.nombre === undefined ? ACTOR_NOMBRE : opts.nombre,
  );
  const zonaRepo = fakeZonaRepo(opts.central === undefined ? { id: "z-c", nombre: CENTRAL_NOMBRE } : opts.central);
  const service = new ManifiestoService(repo, zonaRepo, () => AHORA);
  return { service, repo, lectura, prohibidas, zonaRepo };
}

async function unaFila(flujo: ManifiestoFlujo, fila: ManifiestoOrdenRow, actor: Actor = MAESTRO) {
  const { service } = build([fila]);
  const r = await service.armar({ flujo, ordenIds: [fila.id] }, actor);
  if (r.status !== "ok") throw new Error(`esperaba ok, llego ${r.status}`);
  expect(r.filas).toHaveLength(1);
  return r.filas[0];
}

describe("R1 — un unico modulo arma el manifiesto de TODOS los flujos", () => {
  it("arma las filas de los 6 flujos con el mismo servicio", async () => {
    const { service, lectura } = build([row({ mensajeroAsignadoNombre: "Carlos Mensajero" })]);

    for (const flujo of MANIFIESTO_FLUJOS) {
      const r = await service.armar({ flujo, ordenIds: ["o1"] }, MAESTRO);
      expect(r.status).toBe("ok");
      if (r.status !== "ok") throw new Error("unreachable");
      // Cada flujo produce su fila con las 11 columnas: ninguno construye las suyas.
      expect(r.filas).toHaveLength(1);
      expect(Object.keys(r.filas[0])).toHaveLength(11);
    }
    expect(lectura.findManifiestoByIds).toHaveBeenCalledTimes(MANIFIESTO_FLUJOS.length);
  });

  it("la carga masiva usa el MISMO servicio por num_remision (unica via sin ids)", async () => {
    const { service, lectura } = build([row({ numRemision: "REM-9" })]);

    const r = await service.armar(
      { flujo: "carga_masiva", numRemisiones: ["REM-9"] },
      ADMIN_TIENDA,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.filas.map((f) => f.numRemision)).toEqual(["REM-9"]);
    expect(lectura.findManifiestoByIds).not.toHaveBeenCalled();
  });
});

describe("R3 — una fila por orden, en el orden recibido", () => {
  it("devuelve N filas para N ordenes validas, en el orden en que se pidieron", async () => {
    const rows = [
      row({ id: "o1", numRemision: "REM-1" }),
      row({ id: "o2", numRemision: "REM-2" }),
      row({ id: "o3", numRemision: "REM-3" }),
    ];
    // El repo devuelve en OTRO orden (findMany no garantiza el del `in`).
    const { service } = build([rows[2], rows[0], rows[1]]);

    const r = await service.armar(
      { flujo: "ruteo_satelite", ordenIds: ["o1", "o2", "o3"] },
      MAESTRO,
    );

    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.filas).toHaveLength(3);
    expect(r.filas.map((f) => f.numRemision)).toEqual(["REM-1", "REM-2", "REM-3"]);
  });

  it("un id repetido no duplica la fila", async () => {
    const { service } = build([row({ id: "o1" })]);
    const r = await service.armar(
      { flujo: "ruteo_satelite", ordenIds: ["o1", "o1"] },
      MAESTRO,
    );
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.filas).toHaveLength(1);
  });
});

describe("R4 — datos vigentes de la orden en las 5 columnas descriptivas", () => {
  it("proyecta num_guia, num_remision, destinatario, telefono y direccion tal cual", async () => {
    const fila = await unaFila("ruteo_satelite", row());

    expect(fila.numGuia).toBe(501);
    expect(fila.numRemision).toBe("REM-1");
    expect(fila.destinatario).toBe("Juan Perez");
    expect(fila.telefono).toBe("88880000"); // §9.4: telefono del DESTINATARIO
    expect(fila.direccion).toBe("Av. Siempre Viva 742");
  });
});

describe("R5 — num_guia ausente", () => {
  it("deja num_guia vacio cuando la orden aun no tiene guia, sin abortar el manifiesto", async () => {
    const { service } = build([row({ id: "o1", numGuia: null }), row({ id: "o2", numGuia: 777 })]);

    const r = await service.armar(
      { flujo: "carga_masiva", ordenIds: ["o1", "o2"] },
      ADMIN_TIENDA,
    );

    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.filas.map((f) => f.numGuia)).toEqual([null, 777]);
    expect(r.omitidas).toEqual([]);
  });
});

describe("R6 — zona por NOMBRE", () => {
  it("usa el nombre de la zona, no su id", async () => {
    const fila = await unaFila("ruteo_satelite", row({ zonaNombre: "Guanacaste" }));

    expect(fila.zona).toBe("Guanacaste");
    expect(JSON.stringify(fila)).not.toContain("z-"); // ningun id de zona se filtra
  });
});

describe("R7 — monto de cobro", () => {
  it("deja monto vacio cuando la orden no tiene monto de cobro", async () => {
    const fila = await unaFila("ruteo_satelite", row({ montoCobrar: null }));
    expect(fila.monto).toBeNull();
  });

  it("un monto de cero se emite como 0, no como celda vacia", async () => {
    const fila = await unaFila("ruteo_satelite", row({ montoCobrar: 0 }));
    expect(fila.monto).toBe(0);
  });

  it("propaga el monto de cobro al destinatario (COD, §9.3)", async () => {
    const fila = await unaFila("ruteo_satelite", row({ montoCobrar: 25.5 }));
    expect(fila.monto).toBe(25.5);
  });
});

describe("R8/R9 — origen, destino y responsable por flujo (design.md §4)", () => {
  // Un caso por FILA de la tabla de design.md §4.
  it("carga_masiva: TIENDA -> CENTRAL, responsable el actor", async () => {
    const fila = await unaFila("carga_masiva", row(), ADMIN_TIENDA);
    expect(fila.origen).toBe("Tienda Uno");
    expect(fila.destino).toBe(CENTRAL_NOMBRE);
    expect(fila.responsable).toBe(ACTOR_NOMBRE);
  });

  it("generacion_guia, orden GAM CON mensajero: CENTRAL -> ZONA, responsable el mensajero", async () => {
    const fila = await unaFila(
      "generacion_guia",
      row({ zonaEsCentral: true, zonaNombre: "GAM", mensajeroAsignadoNombre: "Carlos Mensajero" }),
    );
    expect(fila.origen).toBe(CENTRAL_NOMBRE);
    expect(fila.destino).toBe("GAM");
    expect(fila.responsable).toBe("Carlos Mensajero");
  });

  it("generacion_guia, orden GAM SIN mensajero: CENTRAL -> CENTRAL, responsable el actor", async () => {
    const fila = await unaFila(
      "generacion_guia",
      row({ zonaEsCentral: true, zonaNombre: "GAM", mensajeroAsignadoNombre: null }),
    );
    expect(fila.origen).toBe(CENTRAL_NOMBRE);
    expect(fila.destino).toBe(CENTRAL_NOMBRE);
    expect(fila.responsable).toBe(ACTOR_NOMBRE);
  });

  it("generacion_guia, orden no-GAM (se rutea): CENTRAL -> ZONA, responsable el actor", async () => {
    const fila = await unaFila(
      "generacion_guia",
      row({ zonaEsCentral: false, zonaNombre: "Cartago" }),
    );
    expect(fila.origen).toBe(CENTRAL_NOMBRE);
    expect(fila.destino).toBe("Cartago");
    expect(fila.responsable).toBe(ACTOR_NOMBRE);
  });

  it("ruteo_satelite: CENTRAL -> ZONA, responsable el actor", async () => {
    const fila = await unaFila("ruteo_satelite", row({ zonaNombre: "Cartago" }));
    expect(fila.origen).toBe(CENTRAL_NOMBRE);
    expect(fila.destino).toBe("Cartago");
    expect(fila.responsable).toBe(ACTOR_NOMBRE);
  });

  it("asignacion_satelite: ZONA -> ZONA, responsable el mensajero", async () => {
    const fila = await unaFila(
      "asignacion_satelite",
      row({ zonaNombre: "Cartago", mensajeroAsignadoNombre: "Carlos Mensajero" }),
    );
    expect(fila.origen).toBe("Cartago");
    expect(fila.destino).toBe("Cartago");
    expect(fila.responsable).toBe("Carlos Mensajero");
  });

  it("devolucion_central: ZONA -> CENTRAL, responsable el actor", async () => {
    const fila = await unaFila("devolucion_central", row({ zonaNombre: "Cartago" }));
    expect(fila.origen).toBe("Cartago");
    expect(fila.destino).toBe(CENTRAL_NOMBRE);
    expect(fila.responsable).toBe(ACTOR_NOMBRE);
  });

  it("envio_tienda: CENTRAL -> TIENDA, responsable el actor", async () => {
    const fila = await unaFila("envio_tienda", row({ tiendaNombre: "Tienda Uno" }));
    expect(fila.origen).toBe(CENTRAL_NOMBRE);
    expect(fila.destino).toBe("Tienda Uno");
    expect(fila.responsable).toBe(ACTOR_NOMBRE);
  });

  // §9.2 (gate F1.4): la descarga NUNCA falla ni deja la celda vacia por un dato de catalogo.
  it("sin zona central configurada, origen/destino caen al literal de respaldo", async () => {
    const { service } = build([row()], { central: null });
    const r = await service.armar({ flujo: "carga_masiva", ordenIds: ["o1"] }, ADMIN_TIENDA);

    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.filas[0].destino).toBe(BODEGA_CENTRAL_FALLBACK);
    expect(BODEGA_CENTRAL_FALLBACK).toBe("Bodega central");
  });
});

describe("R9 — responsable: mensajero si el flujo lo asigna, si no el actor (§9.8)", () => {
  it("responsable es el mensajero asignado cuando el flujo asigna mensajero", async () => {
    const fila = await unaFila(
      "asignacion_satelite",
      row({ mensajeroAsignadoNombre: "Carlos Mensajero" }),
    );
    expect(fila.responsable).toBe("Carlos Mensajero");
  });

  it("responsable es el nombre del usuario que ejecuto cuando no hay mensajero", async () => {
    const fila = await unaFila("devolucion_central", row({ mensajeroAsignadoNombre: null }));
    expect(fila.responsable).toBe(ACTOR_NOMBRE);
    // Sin textos de rol (§9.8): es el nombre de la persona, no "Bodega central".
    expect(fila.responsable).not.toBe(BODEGA_CENTRAL_FALLBACK);
  });

  // Decision del humano tras el review de la 148: si el nombre del ejecutor no se
  // puede resolver (usuario borrado entre la operacion y la descarga), la celda sale
  // con un guion largo, NUNCA vacia y NUNCA con un texto de rol (§9.8).
  it("sin nombre resoluble del ejecutor, responsable cae al guion largo y no a cadena vacia", async () => {
    const { service } = build([row({ mensajeroAsignadoNombre: null })], { nombre: null });
    const r = await service.armar(
      { flujo: "devolucion_central", ordenIds: ["o1"] },
      MAESTRO,
    );
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.filas[0].responsable).toBe(RESPONSABLE_FALLBACK);
    expect(RESPONSABLE_FALLBACK).toBe("—"); // em dash, no guion corto ni ""
    expect(r.filas[0].responsable).not.toBe("");
  });

  // El mensajero sigue mandando aunque el nombre del actor no se resuelva: el
  // respaldo es SOLO del actor, no de la columna entera.
  it("con mensajero asignado, el respaldo del actor no contamina responsable", async () => {
    const { service } = build(
      [row({ mensajeroAsignadoNombre: "Carlos Mensajero" })],
      { nombre: null },
    );
    const r = await service.armar(
      { flujo: "asignacion_satelite", ordenIds: ["o1"] },
      MAESTRO,
    );
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.filas[0].responsable).toBe("Carlos Mensajero");
  });
});

describe("R10 — fecha calendario de Costa Rica de la operacion", () => {
  it("fecha es la fecha calendario CR de la operacion (no la UTC, no created_at)", async () => {
    const fila = await unaFila("ruteo_satelite", row());
    expect(fila.fecha).toBe(FECHA_CR);
    expect(fila.fecha).not.toBe(AHORA.toISOString().slice(0, 10)); // off-by-one de UTC
  });

  it("todas las filas del lote comparten la misma fecha de operacion", async () => {
    const { service } = build([row({ id: "o1" }), row({ id: "o2", numRemision: "REM-2" })]);
    const r = await service.armar({ flujo: "ruteo_satelite", ordenIds: ["o1", "o2"] }, MAESTRO);
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.filas.map((f) => f.fecha)).toEqual([FECHA_CR, FECHA_CR]);
  });
});

describe("R2/R11 — exactamente las 11 columnas y nada mas", () => {
  it("no expone ids internos ni campos fuera de las 11 columnas", async () => {
    const fila = await unaFila("ruteo_satelite", row());

    expect(Object.keys(fila)).toEqual([
      "numGuia",
      "numRemision",
      "destinatario",
      "telefono",
      "direccion",
      "zona",
      "monto",
      "origen",
      "destino",
      "responsable",
      "fecha",
    ]);
    // Ni el id de la orden, ni el de la tienda, ni deleted_at, ni notas/producto.
    const serializada = JSON.stringify(fila);
    expect(serializada).not.toContain("o1");
    expect(serializada).not.toContain("tienda-1");
    expect(serializada).not.toContain("deleted");
  });
});

describe("R12 — ordenes inexistentes o borradas", () => {
  it("omite las que no existen (o estan borradas) y NO aborta el lote", async () => {
    // "o2" no lo devuelve el repo: no existe o su deleted_at no es null.
    const { service } = build([row({ id: "o1" }), row({ id: "o3", numRemision: "REM-3" })]);

    const r = await service.armar(
      { flujo: "ruteo_satelite", ordenIds: ["o1", "o2", "o3"] },
      MAESTRO,
    );

    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.filas.map((f) => f.numRemision)).toEqual(["REM-1", "REM-3"]);
    expect(r.omitidas).toEqual([{ ref: "o2", motivo: "no_encontrada" }]);
  });

  it("reporta la remision omitida con la referencia recibida, no con un id", async () => {
    const { service } = build([]);
    const r = await service.armar(
      { flujo: "carga_masiva", numRemisiones: ["REM-X"] },
      ADMIN_TIENDA,
    );

    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.filas).toEqual([]);
    expect(r.omitidas).toEqual([{ ref: "REM-X", motivo: "no_encontrada" }]);
  });
});

describe("R24 — el manifiesto no modifica ningun dato de negocio", () => {
  it("no invoca ningun metodo de escritura del repositorio en ninguno de los 6 flujos", async () => {
    const { service, prohibidas, lectura } = build([
      row({ mensajeroAsignadoNombre: "Carlos Mensajero" }),
    ]);

    for (const flujo of MANIFIESTO_FLUJOS) {
      await service.armar({ flujo, ordenIds: ["o1"] }, MAESTRO);
    }
    await service.armar({ flujo: "carga_masiva", numRemisiones: ["REM-1"] }, ADMIN_TIENDA);

    // El Proxy registra CUALQUIER acceso fuera de los 3 metodos de lectura.
    expect(prohibidas).toEqual([]);
    expect(lectura.findManifiestoByIds).toHaveBeenCalled();
    expect(lectura.findManifiestoByRemisiones).toHaveBeenCalled();
  });
});

describe("R29 — aislamiento por dueño cuando el actor es una API key", () => {
  const KEY_TIENDA_1: Actor = { usuarioId: "tienda-1", rol: "apiKey" };
  const KEY_TIENDA_2: Actor = { usuarioId: "tienda-2", rol: "apiKey" };

  it("con actor apiKey solo incluye ordenes de su tienda", async () => {
    const { service } = build([
      row({ id: "o1", tiendaId: "tienda-1", numRemision: "REM-1" }),
      row({ id: "o2", tiendaId: "tienda-2", numRemision: "REM-2" }),
    ]);

    const r = await service.armar(
      { flujo: "generacion_guia", ordenIds: ["o1", "o2"] },
      KEY_TIENDA_1,
    );

    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.filas.map((f) => f.numRemision)).toEqual(["REM-1"]);
    // La ajena se reporta como no_encontrada: no revela que exista.
    expect(r.omitidas).toEqual([{ ref: "o2", motivo: "no_encontrada" }]);
  });

  it("una API key de otra tienda no obtiene NINGUNA fila del lote", async () => {
    const { service } = build([row({ id: "o1", tiendaId: "tienda-1" })]);

    const r = await service.armar(
      { flujo: "generacion_guia", ordenIds: ["o1"] },
      KEY_TIENDA_2,
    );

    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.filas).toEqual([]);
    expect(r.omitidas).toEqual([{ ref: "o1", motivo: "no_encontrada" }]);
  });

  it("un rol de sesion SI ve la orden (el filtro por dueño es exclusivo de apiKey)", async () => {
    const { service } = build([row({ id: "o1", tiendaId: "tienda-9" })]);
    const r = await service.armar({ flujo: "generacion_guia", ordenIds: ["o1"] }, MAESTRO);
    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.filas).toHaveLength(1);
  });

  it("la via por num_remision se acota SIEMPRE a la tienda del actor", async () => {
    const { service, lectura } = build([row({ tiendaId: "tienda-1", numRemision: "REM-1" })]);

    await service.armar({ flujo: "carga_masiva", numRemisiones: ["REM-1"] }, ADMIN_TIENDA);

    expect(lectura.findManifiestoByRemisiones).toHaveBeenCalledWith(["REM-1"], "tienda-1");
  });

  it("un actor de otra tienda no alcanza las remisiones ajenas", async () => {
    const { service } = build([row({ tiendaId: "tienda-1", numRemision: "REM-1" })]);
    const otra: Actor = { usuarioId: "tienda-2", rol: "adminTienda" };

    const r = await service.armar({ flujo: "carga_masiva", numRemisiones: ["REM-1"] }, otra);

    if (r.status !== "ok") throw new Error("unreachable");
    expect(r.filas).toEqual([]);
    expect(r.omitidas).toEqual([{ ref: "REM-1", motivo: "no_encontrada" }]);
  });
});
