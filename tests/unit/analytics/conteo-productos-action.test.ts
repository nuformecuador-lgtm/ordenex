import { describe, it, expect, vi } from "vitest";

import { consultarConteoProductos } from "@/lib/actions/conteo-productos";
import type { ConsultaProductos } from "@/lib/analytics/productos-consulta";
import type { ConteoProductosDTO } from "@/lib/types/conteo-productos";

// Ficha 345 / T5.3 — EL BORDE (R4, R9, R53).
//
// El servicio entra por `deps`, asi que aqui no hay base de datos ni runtime de Next. Lo que se
// mide es el ORDEN de los pasos y QUE SALE por cada camino: una accion que consultara antes de
// resolver el alcance, o que revelara el motivo del denegado, seguiria compilando.

const AHORA = new Date("2026-09-01T12:00:00.000Z");

const DATOS: ConteoProductosDTO = {
  filas: [
    {
      tiendaId: "t1",
      tienda: "Tienda Uno",
      producto: "Base C",
      unidades: 4,
      ordenes: 4,
      porStatus: [{ status: "entregada", conteo: 4 }],
      ordenesAcompanadas: 0,
      dinero: null,
    },
  ],
  ordenes: 4,
  ordenesSinProducto: 0,
  dinero: { estado: "denegado" },
  lastSync: "2026-09-01T12:00:00.000Z",
};

function deps(actor: unknown) {
  const service = { consultar: vi.fn(async (_consulta: ConsultaProductos) => DATOS) };
  const logger = { logError: vi.fn() };
  return {
    deps: { service, logger, getActor: async () => actor as never, now: () => AHORA },
    service,
    logger,
  };
}

describe("El camino feliz", () => {
  it("maestro recibe las filas y el sello", async () => {
    const { deps: d } = deps({ usuarioId: "u1", rol: "maestro" });

    expect(await consultarConteoProductos({ rango: "semana" }, d)).toEqual({
      status: "ok",
      datos: DATOS,
    });
  });

  it("el servicio recibe la consulta YA recortada por el alcance", async () => {
    const { deps: d, service } = deps({ usuarioId: "t-propia", rol: "adminTienda" });

    await consultarConteoProductos({ rango: "semana" }, d);

    expect(service.consultar).toHaveBeenCalledTimes(1);
    expect(service.consultar.mock.lastCall?.[0] as never).toMatchObject({
      alcance: { tipo: "tienda", tiendaId: "t-propia" },
      filtro: { tienda_id: ["t-propia"] },
    });
  });

  it("el camino feliz no escribe nada en el log", async () => {
    const { deps: d, logger } = deps({ usuarioId: "u1", rol: "admin" });
    await consultarConteoProductos({}, d);
    expect(logger.logError).not.toHaveBeenCalled();
  });
});

describe("R53 · si la entrada no valida, ni base ni alcance", () => {
  it("un filtro invalido no toca el servicio NI el log", async () => {
    const { deps: d, service, logger } = deps({ usuarioId: "u1", rol: "maestro" });

    const res = await consultarConteoProductos({ rango: "trimestre" }, d);

    expect(res.status).toBe("validation_error");
    expect(service.consultar).not.toHaveBeenCalled();
    // Sin auditar: no hay denegado que registrar, y una entrada malformada tampoco puede servir
    // para sondear el modelo de permisos.
    expect(logger.logError).not.toHaveBeenCalled();
  });

  it("una clave desconocida es `validation_error` y no un extra inocuo (R8)", async () => {
    const { deps: d, service } = deps({ usuarioId: "u1", rol: "adminTienda" });

    const res = await consultarConteoProductos({ rol: "maestro", alcance: "global" }, d);

    expect(res.status).toBe("validation_error");
    expect(service.consultar).not.toHaveBeenCalled();
  });

  it("el parseo va ANTES que el alcance: filtro malo + rol prohibido = `validation_error`", async () => {
    // La prueba del orden sin espia adicional: si el alcance se resolviera primero, esto seria
    // `forbidden`.
    const { deps: d, logger } = deps({ usuarioId: "u1", rol: "mensajero" });

    expect((await consultarConteoProductos({ clave_inventada: 1 }, d)).status).toBe(
      "validation_error",
    );
    expect(logger.logError).not.toHaveBeenCalled();
  });

  it("`validation_error` lleva los campos que fallaron y ningun motivo de permisos", async () => {
    const { deps: d } = deps({ usuarioId: "u1", rol: "maestro" });

    const res = await consultarConteoProductos({ zona_id: [] }, d);

    expect(res.status).toBe("validation_error");
    if (res.status !== "validation_error") throw new Error("imposible");
    expect(Object.keys(res.fieldErrors)).toContain("zona_id");
    expect(JSON.stringify(res)).not.toContain("motivo");
  });
});

describe("R4 · adminSatelite y mensajero: `forbidden` SIN tocar el repositorio", () => {
  it.each(["adminSatelite", "mensajero"])("%s recibe `forbidden` y el servicio no se llama", async (rol) => {
    const { deps: d, service } = deps({ usuarioId: "u9", rol, zonaId: "z1" });

    const res = await consultarConteoProductos({}, d);

    // Ni recortada, ni agregada, ni en cero: `forbidden` a secas.
    expect(res).toEqual({ status: "forbidden" });
    expect(service.consultar).not.toHaveBeenCalled();
  });

  it("un rol inventado tambien es `forbidden`", async () => {
    const { deps: d, service } = deps({ usuarioId: "u9", rol: "superadmin" });

    expect(await consultarConteoProductos({}, d)).toEqual({ status: "forbidden" });
    expect(service.consultar).not.toHaveBeenCalled();
  });

  it("pedir una tienda ajena es `forbidden`, NO un `ok` con lista vacia", async () => {
    const { deps: d, service } = deps({ usuarioId: "t-propia", rol: "adminTienda" });

    const res = await consultarConteoProductos({ tienda_id: ["t-ajena"] }, d);

    expect(res).toEqual({ status: "forbidden" });
    expect(service.consultar).not.toHaveBeenCalled();
  });
});

describe("Sin sesion", () => {
  it("`null` es `unauthenticated`, que es distinto de `forbidden`", async () => {
    const { deps: d, service } = deps(null);

    // «No sabemos quien eres» se arregla volviendo a entrar; «no puedes» no. La pantalla tiene
    // dos textos distintos para eso.
    expect(await consultarConteoProductos({}, d)).toEqual({ status: "unauthenticated" });
    expect(service.consultar).not.toHaveBeenCalled();
  });

  it("un actor sin `usuarioId` tambien es `unauthenticated`", async () => {
    const { deps: d } = deps({ rol: "maestro" });
    expect(await consultarConteoProductos({}, d)).toEqual({ status: "unauthenticated" });
  });
});

describe("R9 · el rastro del denegado: con motivo, sin PII y sin revelarlo al cliente", () => {
  it("audita el motivo, el rol, el usuario y QUE se intento leer", async () => {
    const { deps: d, logger } = deps({ usuarioId: "u9", rol: "mensajero" });

    await consultarConteoProductos({ tienda_id: ["t1"] }, d);

    expect(logger.logError).toHaveBeenCalledTimes(1);
    expect(logger.logError.mock.lastCall?.[0]).toMatchObject({
      evento: "analitica_denegado",
      motivo: "metrica_prohibida",
      rol: "mensajero",
      usuarioId: "u9",
      // Id de auditoria PROPIO: si compartiera nombre con las otras acciones, una denegacion no
      // diria cual de las puertas se toco.
      metricaId: "conteo_productos",
    });
  });

  it("el id de auditoria es distinto del de las otras lecturas de la seccion", async () => {
    const { deps: d, logger } = deps({ usuarioId: "u9", rol: "mensajero" });
    await consultarConteoProductos({}, d);
    const registro = logger.logError.mock.lastCall?.[0] as { metricaId: string };
    expect(registro.metricaId).toBe("conteo_productos");
    expect(registro.metricaId).not.toBe("conteo_por_status");
    expect(registro.metricaId).not.toBe("conteo_entregas");
  });

  it("un filtro con claves de PII NI SIQUIERA LLEGA al log: el `.strict()` lo para antes", async () => {
    const { deps: d, logger } = deps({ usuarioId: "u9", rol: "adminSatelite", zonaId: "z1" });

    const res = await consultarConteoProductos(
      { tienda_id: ["t-ajena"], email: "cliente@example.test", telefono: "88887777" },
      d,
    );

    // La garantia mas fuerte de las dos: el esquema es `.strict()`, asi que un filtro con claves
    // desconocidas es `validation_error` y el canal de auditoria no llega a verlo.
    expect(res.status).toBe("validation_error");
    expect(logger.logError).not.toHaveBeenCalled();
  });

  it("del filtro VALIDO solo sobreviven las listas de ids del contrato", async () => {
    const { deps: d, logger } = deps({ usuarioId: "u9", rol: "adminSatelite", zonaId: "z1" });

    await consultarConteoProductos(
      { tienda_id: ["t-ajena"], mensajero_id: ["m1"], distrito_id: ["d1"] },
      d,
    );

    const registro = logger.logError.mock.lastCall?.[0] as {
      filtroRechazado?: Record<string, unknown>;
    };
    expect(registro.filtroRechazado).toBeDefined();
    // `describirDenegado` sanea: solo las dimensiones declaradas. Nada mas cruza al log.
    for (const clave of Object.keys(registro.filtroRechazado ?? {})) {
      expect(["zona_id", "tienda_id", "mensajero_id"], clave).toContain(clave);
    }
  });

  it("el registro NO lleva el contenido de la sesion", async () => {
    const { deps: d, logger } = deps({
      usuarioId: "u9",
      rol: "mensajero",
      email: "mensajero@example.test",
      nombre: "Nombre Apellido",
    });

    await consultarConteoProductos({}, d);

    const registro = JSON.stringify(logger.logError.mock.lastCall?.[0]);
    expect(registro).not.toContain("mensajero@example.test");
    expect(registro).not.toContain("Nombre Apellido");
  });

  it("la RESPUESTA no dice cual de los motivos fue", async () => {
    const casos: [unknown, string][] = [
      [{ usuarioId: "u9", rol: "mensajero" }, "metrica_prohibida"],
      [{ usuarioId: "u9", rol: "adminSatelite", zonaId: "z1" }, "metrica_prohibida"],
      [{ usuarioId: "u9", rol: "superadmin" }, "rol_desconocido"],
    ];

    for (const [actor, motivo] of casos) {
      const { deps: d, logger } = deps(actor);
      const res = await consultarConteoProductos({}, d);

      // El motivo SI esta en el log...
      expect(logger.logError.mock.lastCall?.[0]).toMatchObject({ motivo });
      // ...y NO en la respuesta: seria una pista sobre el modelo de permisos.
      expect(res).toEqual({ status: "forbidden" });
      expect(JSON.stringify(res)).not.toContain(motivo);
    }
  });

  it("los tres motivos distintos producen la MISMA respuesta al cliente", async () => {
    const respuestas = await Promise.all(
      [
        { usuarioId: "u9", rol: "mensajero" },
        { usuarioId: "u9", rol: "adminSatelite", zonaId: "z1" },
        { usuarioId: "u9", rol: "superadmin" },
      ].map((actor) => consultarConteoProductos({}, deps(actor).deps)),
    );

    expect(respuestas).toEqual([
      { status: "forbidden" },
      { status: "forbidden" },
      { status: "forbidden" },
    ]);
  });
});
