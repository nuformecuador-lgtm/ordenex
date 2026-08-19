import { describe, it, expect, vi } from "vitest";

import { prepararConteoEntregas, type ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";
import { consultarConteoDevoluciones } from "@/lib/actions/conteo-devoluciones";
import {
  condicionesDeDevoluciones,
  ConteoDevolucionesRepository,
} from "@/lib/repositories/ConteoDevolucionesRepository";
import {
  ConteoDevolucionesService,
  traducirCausa,
} from "@/lib/services/ConteoDevolucionesService";
import type { IAnaliticaCache } from "@/lib/interfaces/external/IAnaliticaCache";
import type { IConteoDevolucionesRepository } from "@/lib/interfaces/repositories/IConteoDevolucionesRepository";
import {
  CAUSA_SIN_TIPIFICAR,
  MOTIVO_DE_CAUSA,
  type ConteoDevolucionesDTO,
} from "@/lib/types/conteo-devoluciones";

const AHORA = new Date("2026-08-18T12:00:00.000Z");

function consultaDe(raw: object = {}, rol = "maestro", extra: object = {}): ConsultaConteoEntregas {
  const preparada = prepararConteoEntregas(raw, { usuarioId: "u1", rol, ...extra } as never, AHORA);
  if (preparada.status !== "ok") throw new Error(`filtro de prueba inválido: ${preparada.status}`);
  return preparada.consulta;
}

const sqlDe = (c: ConsultaConteoEntregas) =>
  condicionesDeDevoluciones(c)
    .map((x) => x.sql)
    .join(" AND ");
const paramsDe = (c: ConsultaConteoEntregas) =>
  condicionesDeDevoluciones(c).flatMap((x) => x.values);

/* -------------------------------------------------------------------------- */
/* La traducción                                                               */
/* -------------------------------------------------------------------------- */

// La razón de que la traducción viva en el SERVIDOR, y no en el cliente como las etiquetas de
// `order_status`: los valores de este enum están en INGLÉS por decisión documentada del
// esquema. De `not_found` no se deriva «Cliente no localizado» con una regla de formato — hace
// falta una traducción, y una traducción es un dato, no un algoritmo.
describe("El motivo viaja YA traducido", () => {
  it("traduce las tres causas tipificadas del enum", () => {
    expect(traducirCausa("not_found", 3).motivo).toBe("Cliente no localizado");
    expect(traducirCausa("wrong_number", 1).motivo).toBe("Número de celular errado");
    expect(traducirCausa("wrong_address", 2).motivo).toBe("Dirección errada");
  });

  // ⚠ `causa_devolucion` es NULLABLE y su `null` significa «devolución anterior a la feature
  // 73», que NO se backfilleó. Dejarlas fuera daría un total menor que las devoluciones reales;
  // meterlas en una de las tres sería inventar por qué se devolvió un paquete.
  it("las devoluciones sin causa tienen su propio bucket, con nombre", () => {
    expect(traducirCausa(CAUSA_SIN_TIPIFICAR, 5).motivo).toBe("Sin causa registrada");
  });

  it("el valor crudo viaja junto al motivo, para poder agrupar y depurar", () => {
    expect(traducirCausa("not_found", 3)).toEqual({
      causa: "not_found",
      motivo: "Cliente no localizado",
      conteo: 3,
    });
  });

  // Las tres salidas posibles ante una causa que el mapa no conoce, por orden de lo mala que es
  // cada una: traducir (correcto), mostrar el valor crudo (feo y evidentemente un bug), u
  // omitir la fila (una devolución que desaparece y un total que no cuadra). Se elige la
  // segunda: fea pero honesta y detectable.
  it("una causa desconocida viaja con su valor crudo, no se descarta", () => {
    const fila = traducirCausa("causa_inventada", 7);

    expect(fila.motivo).toBe("causa_inventada");
    expect(fila.conteo).toBe(7);
  });

  it("el mapa cubre el enum entero más el centinela", () => {
    expect(Object.keys(MOTIVO_DE_CAUSA).sort()).toEqual(
      ["not_found", "wrong_address", "wrong_number", CAUSA_SIN_TIPIFICAR].sort(),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* El `where`                                                                  */
/* -------------------------------------------------------------------------- */

describe("El universo: gestiones vigentes con resultado `devuelta`", () => {
  it("filtra por el resultado, casteado al enum de Postgres", () => {
    const sql = sqlDe(consultaDe());

    expect(sql).toContain('g."resultado"');
    expect(sql).toContain('"gestion_resultado"');
    expect(paramsDe(consultaDe())).toContain("devuelta");
  });

  // Una gestión anulada (feature 67) no es una devolución: es una devolución DESHECHA.
  it("excluye las gestiones anuladas", () => {
    expect(sqlDe(consultaDe())).toContain('g."anulada_at" IS NULL');
  });

  it("excluye las órdenes borradas, aunque su gestión siga en la tabla", () => {
    expect(sqlDe(consultaDe())).toContain('o."deleted_at" IS NULL');
  });
});

describe("El recorte por ROL pasa por la ORDEN, no por la gestión", () => {
  // ⚠ FRONTERA MULTI-TENANT. `lib/analytics/alcance-columnas.ts` lo dice con todas las letras:
  // «los TRES recortes de `gestion_orden` pasan por la relación `orden`». Recortar la gestión
  // por columnas propias daría un recorte DISTINTO al de la orden.
  it("va en la POSICIÓN 0 y sobre columnas de `orden`", () => {
    const primera = condicionesDeDevoluciones(consultaDe({}, "adminTienda"))[0];

    expect(primera?.sql).toContain('o."tienda_id"');
    expect(primera?.values).toEqual(["u1"]);
  });

  it("adminSatelite se recorta por `o.zona_id`", () => {
    const primera = condicionesDeDevoluciones(consultaDe({}, "adminSatelite", { zonaId: "z7" }))[0];

    expect(primera?.sql).toContain('o."zona_id"');
    expect(primera?.values).toEqual(["z7"]);
  });
});

describe("Las siete facetas", () => {
  it("las cinco de orden van sobre `o`, y el mensajero sobre `g`", () => {
    const sql = sqlDe(
      consultaDe({
        zona_id: ["z1"],
        provincia_id: ["p1"],
        canton_id: ["c1"],
        distrito_id: ["d1"],
        tienda_id: ["t1"],
        mensajero_id: ["m1"],
      }),
    );

    for (const col of ["zona_id", "provincia_id", "canton_id", "distrito_id", "tienda_id"]) {
      expect(sql, col).toContain(`o."${col}" IN (`);
    }
    // El mensajero SÍ es columna propia de la gestión, y aquí es además la lectura natural:
    // quien registró ESTA devolución. Sin `EXISTS` correlacionado, al revés que en las
    // lecturas cuyo universo es la orden.
    expect(sql).toContain(`g."mensajero_id" IN (`);
    expect(sql).not.toContain("EXISTS");
  });

  it("una faceta no pedida NO escribe su condición", () => {
    expect(sqlDe(consultaDe())).not.toContain(" IN (");
  });

  it("todos los ids viajan como parámetros", () => {
    expect(paramsDe(consultaDe({ zona_id: ["z1", "z2"] }))).toEqual(
      expect.arrayContaining(["z1", "z2"]),
    );
  });
});

describe("La ventana cae sobre la fecha de la GESTIÓN", () => {
  // ⚠ DIVERGENCIA DELIBERADA. La fila que se cuenta ES la gestión, así que su fecha es la suya.
  // Filtrarla por la fecha efectiva de su orden —que puede ser la de una gestión POSTERIOR—
  // metería devoluciones fuera del rango pedido y dejaría fuera otras que sí están dentro.
  it("compara `g.created_at`, no la fecha efectiva de la orden", () => {
    const sql = sqlDe(consultaDe({ rango: "dia" }));

    expect(sql).toContain(`g."created_at"`);
    expect(sql).not.toContain("COALESCE");
  });

  it("es semiabierta: `>=` abajo y `<` arriba, nunca `<=`", () => {
    const sql = sqlDe(consultaDe({ rango: "dia" }));

    expect(sql).toContain(">=");
    expect(sql).not.toContain("<=");
  });

  it("los bordes son los que resolvió el rango", () => {
    const consulta = consultaDe({ rango: "dia" });

    expect(paramsDe(consulta)).toEqual(
      expect.arrayContaining([consulta.rango?.desde, consulta.rango?.hasta]),
    );
  });

  it("SIN rango no escribe ninguna condición de fecha", () => {
    expect(sqlDe(consultaDe())).not.toContain("created_at");
  });
});

describe("La consulta que se ejecuta", () => {
  it("agrupa por causa y devuelve el conteo como número", async () => {
    const prisma = { $queryRaw: () => Promise.resolve([{ causa: "not_found", n: 9 }]) };

    await expect(
      new ConteoDevolucionesRepository(prisma as never).contarDevolucionesPorCausa(consultaDe()),
    ).resolves.toEqual([{ causa: "not_found", conteo: 9 }]);
  });
});

/* -------------------------------------------------------------------------- */
/* El servicio                                                                 */
/* -------------------------------------------------------------------------- */

function repoQueDevuelve(
  filas: { causa: string; conteo: number }[],
): IConteoDevolucionesRepository {
  return { contarDevolucionesPorCausa: vi.fn().mockResolvedValue(filas) };
}

function cacheConMemoria() {
  const entradas = new Map<string, unknown>();
  const ejecuciones: string[] = [];
  const cache: IAnaliticaCache = {
    async envolver(clave, _tags, producir) {
      if (entradas.has(clave)) return entradas.get(clave) as never;
      ejecuciones.push(clave);
      const valor = await producir();
      entradas.set(clave, valor);
      return valor;
    },
    async invalidar() {},
  };
  return { cache, entradas, ejecuciones };
}

describe("El servicio de devoluciones", () => {
  it("traduce cada fila y deriva el total", async () => {
    const service = new ConteoDevolucionesService(
      repoQueDevuelve([
        { causa: "not_found", conteo: 9 },
        { causa: "wrong_address", conteo: 4 },
        { causa: CAUSA_SIN_TIPIFICAR, conteo: 2 },
      ]),
      cacheConMemoria().cache,
      { now: () => AHORA },
    );

    const datos = await service.consultar(consultaDe());

    expect(datos.porCausa.map((f) => f.motivo)).toEqual([
      "Cliente no localizado",
      "Dirección errada",
      "Sin causa registrada",
    ]);
    expect(datos.total).toBe(15);
    expect(datos.porCausa.reduce((s, f) => s + f.conteo, 0)).toBe(datos.total);
  });

  // El orden lo fija el repositorio (mayor a menor). El servicio NO reordena: el color de cada
  // segmento se asigna por posición, así que dos criterios repintarían lo mismo distinto.
  it("conserva el orden que trajo el repositorio", async () => {
    const service = new ConteoDevolucionesService(
      repoQueDevuelve([
        { causa: "wrong_number", conteo: 8 },
        { causa: "not_found", conteo: 3 },
      ]),
      cacheConMemoria().cache,
      { now: () => AHORA },
    );

    expect((await service.consultar(consultaDe())).porCausa.map((f) => f.causa)).toEqual([
      "wrong_number",
      "not_found",
    ]);
  });

  it("sin devoluciones es una lista vacía y total 0", async () => {
    const service = new ConteoDevolucionesService(repoQueDevuelve([]), cacheConMemoria().cache, {
      now: () => AHORA,
    });

    expect(await service.consultar(consultaDe())).toMatchObject({ porCausa: [], total: 0 });
  });

  // Mismo caso que en los otros cuatro servicios, y por el mismo motivo: el sello dice cuándo
  // se LEYÓ, no cuándo se sirvió.
  it("con la caché caliente no refresca el sello y la base se toca una vez", async () => {
    const { cache } = cacheConMemoria();
    let reloj = new Date("2026-08-18T12:00:00.000Z");
    const repo = repoQueDevuelve([{ causa: "not_found", conteo: 1 }]);
    const service = new ConteoDevolucionesService(repo, cache, { now: () => reloj });

    const primera = await service.consultar(consultaDe());
    reloj = new Date("2026-08-18T12:10:00.000Z");
    const segunda = await service.consultar(consultaDe());

    expect(segunda.lastSync).toBe(primera.lastSync);
    expect(repo.contarDevolucionesPorCausa).toHaveBeenCalledTimes(1);
  });

  // Lo que se cachea es el DTO YA traducido: un acierto de caché no vuelve a mapear nada.
  it("guarda en caché el DTO ya traducido", async () => {
    const { cache, entradas } = cacheConMemoria();
    const service = new ConteoDevolucionesService(
      repoQueDevuelve([{ causa: "not_found", conteo: 1 }]),
      cache,
      { now: () => AHORA },
    );

    await service.consultar(consultaDe());

    expect([...entradas.values()][0]).toMatchObject({
      porCausa: [{ motivo: "Cliente no localizado" }],
    });
  });
});

/* -------------------------------------------------------------------------- */
/* El borde                                                                    */
/* -------------------------------------------------------------------------- */

const DATOS: ConteoDevolucionesDTO = {
  porCausa: [{ causa: "not_found", motivo: "Cliente no localizado", conteo: 9 }],
  total: 9,
  lastSync: "2026-08-18T12:00:00.000Z",
};

function deps(actor: unknown) {
  const service = { consultar: vi.fn(async (_c: ConsultaConteoEntregas) => DATOS) };
  const logger = { logError: vi.fn() };
  return {
    deps: { service, logger, getActor: async () => actor as never, now: () => AHORA },
    service,
    logger,
  };
}

describe("El borde de devoluciones", () => {
  it("devuelve el desglose ya traducido", async () => {
    const { deps: d } = deps({ usuarioId: "u1", rol: "maestro" });

    expect(await consultarConteoDevoluciones({}, d)).toEqual({ status: "ok", datos: DATOS });
  });

  it("acepta las MISMAS siete facetas que las otras cuatro lecturas", async () => {
    const { deps: d, service } = deps({ usuarioId: "u1", rol: "maestro" });

    const res = await consultarConteoDevoluciones(
      {
        rango: "personalizado",
        desde: "2026-08-01",
        hasta: "2026-08-16",
        zona_id: ["z1"],
        provincia_id: ["p1"],
        canton_id: ["c1"],
        distrito_id: ["d1"],
        tienda_id: ["t1"],
        mensajero_id: ["m1"],
      },
      d,
    );

    expect(res.status).toBe("ok");
    expect(service.consultar).toHaveBeenCalledTimes(1);
  });

  it("el servicio recibe la consulta YA recortada por el alcance", async () => {
    const { deps: d, service } = deps({ usuarioId: "u1", rol: "adminTienda" });

    await consultarConteoDevoluciones({}, d);

    expect(service.consultar.mock.lastCall?.[0] as never).toMatchObject({
      alcance: { tipo: "tienda", tiendaId: "u1" },
    });
  });

  it("un filtro inválido no toca el servicio ni el log", async () => {
    const { deps: d, service, logger } = deps({ usuarioId: "u1", rol: "maestro" });

    expect((await consultarConteoDevoluciones({ rango: "trimestre" }, d)).status).toBe(
      "validation_error",
    );
    expect(service.consultar).not.toHaveBeenCalled();
    expect(logger.logError).not.toHaveBeenCalled();
  });

  // ⚠ La trampa heredada de la 126: `normalizeError` sólo llama al logger en la rama del error
  // DESCONOCIDO, así que lanzar un `ForbiddenError` daría un 403 MUDO. Este caso espía el
  // LOGGER, no el status.
  it("el mensajero es `forbidden` y queda AUDITADO, con su propio nombre", async () => {
    const { deps: d, service, logger } = deps({ usuarioId: "m1", rol: "mensajero" });

    expect(await consultarConteoDevoluciones({}, d)).toEqual({ status: "forbidden" });
    expect(service.consultar).not.toHaveBeenCalled();
    expect(logger.logError.mock.calls[0]?.[0]).toMatchObject({
      evento: "analitica_denegado",
      motivo: "metrica_prohibida",
      metricaId: "conteo_devoluciones",
    });
  });

  it("sin sesión es `unauthenticated`, no `forbidden`", async () => {
    const { deps: d } = deps(null);

    expect(await consultarConteoDevoluciones({}, d)).toEqual({ status: "unauthenticated" });
  });

  it("pedir datos ajenos es `forbidden` y no una lista vacía", async () => {
    const { deps: d, service } = deps({ usuarioId: "u1", rol: "adminTienda" });

    const res = await consultarConteoDevoluciones({ tienda_id: ["otra"] }, d);

    expect(res).toEqual({ status: "forbidden" });
    expect(res).not.toHaveProperty("datos");
    expect(service.consultar).not.toHaveBeenCalled();
  });
});
