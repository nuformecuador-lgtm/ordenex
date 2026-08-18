import { describe, it, expect, vi } from "vitest";

import { prepararConteoEntregas, type ConsultaConteoEntregas } from "@/lib/analytics/entregas-conteo";
import { consultarCicloVida } from "@/lib/actions/ciclo-vida";
import {
  CicloVidaRepository,
  condicionDeVentanaTerminal,
  condicionesDeCiclo,
} from "@/lib/repositories/CicloVidaRepository";
import { CicloVidaService, promedioDeCiclo } from "@/lib/services/CicloVidaService";
import type { IAnaliticaCache } from "@/lib/interfaces/external/IAnaliticaCache";
import type { ICicloVidaRepository } from "@/lib/interfaces/repositories/ICicloVidaRepository";
import { ESTADOS_TERMINALES } from "@/lib/types/order-status-transiciones";
import type { CicloVidaDTO } from "@/lib/types/conteo-ciclo-vida";

const AHORA = new Date("2026-08-18T12:00:00.000Z");

function consultaDe(raw: object = {}, rol = "maestro", extra: object = {}): ConsultaConteoEntregas {
  const preparada = prepararConteoEntregas(raw, { usuarioId: "u1", rol, ...extra } as never, AHORA);
  if (preparada.status !== "ok") throw new Error(`filtro de prueba inválido: ${preparada.status}`);
  return preparada.consulta;
}

const sqlDe = (c: ConsultaConteoEntregas) =>
  condicionesDeCiclo(c)
    .map((x) => x.sql)
    .join(" AND ");

/* -------------------------------------------------------------------------- */
/* La definición                                                               */
/* -------------------------------------------------------------------------- */

// ⚠ ESTA DEFINICIÓN NO ES NUEVA. Es la misma que ya usa el rollup diario para la métrica
// `tiempo_ciclo` del catálogo (consulta Q5 de `AnaliticaRollupRepository`). Estos casos son lo
// que impide que se separen: si alguien cambia una de las dos, el criterio deja de ser uno.
describe("El reloj: de la creación al último terminal", () => {
  it("los terminales salen del dominio, no de una lista escrita en el repositorio", () => {
    // Los tres que el humano nombró son exactamente `ESTADOS_TERMINALES`.
    expect([...ESTADOS_TERMINALES].sort()).toEqual(
      ["devuelta_a_tienda", "entregada", "incidente"].sort(),
    );
  });
});

describe("La ventana cae sobre la TRANSICIÓN TERMINAL", () => {
  // Una orden creada en enero y cerrada en agosto cuenta en AGOSTO. Atribuyendo por creación,
  // el mes en curso saldría siempre artificialmente rápido: sólo habrían cerrado las fáciles.
  it("compara `h.created_at`, la fecha del cierre", () => {
    const ventana = condicionDeVentanaTerminal(consultaDe({ rango: "dia" }));

    expect(ventana.sql).toContain(`h."created_at"`);
    expect(ventana.sql).not.toContain(`o."created_at"`);
  });

  it("es semiabierta: `>=` abajo y `<` arriba, nunca `<=`", () => {
    const ventana = condicionDeVentanaTerminal(consultaDe({ rango: "dia" }));

    expect(ventana.sql).toContain(">=");
    expect(ventana.sql).not.toContain("<=");
  });

  it("los bordes son los que resolvió el rango", () => {
    const consulta = consultaDe({ rango: "dia" });

    expect(condicionDeVentanaTerminal(consulta).values).toEqual([
      consulta.rango?.desde,
      consulta.rango?.hasta,
    ]);
  });

  // `TRUE` y no un fragmento vacío: va unido con `AND` dentro del CTE y un hueco rompería el
  // SQL. Sin rango entran todos los cierres registrados.
  it("SIN rango no filtra por fecha, pero deja el `AND` válido", () => {
    const ventana = condicionDeVentanaTerminal(consultaDe());

    expect(ventana.sql.trim()).toBe("TRUE");
    expect(ventana.values).toEqual([]);
  });
});

describe("El recorte por ROL y las facetas", () => {
  // FRONTERA MULTI-TENANT: primera condición, siempre.
  it("el alcance va en la POSICIÓN 0", () => {
    const primera = condicionesDeCiclo(consultaDe({}, "adminTienda"))[0];

    expect(primera?.sql).toContain(`o."tienda_id"`);
    expect(primera?.values).toEqual(["u1"]);
  });

  it("excluye las órdenes borradas", () => {
    expect(sqlDe(consultaDe())).toContain(`o."deleted_at" IS NULL`);
  });

  it("las cinco facetas de orden se traducen a su columna", () => {
    const sql = sqlDe(
      consultaDe({
        zona_id: ["z1"],
        provincia_id: ["p1"],
        canton_id: ["c1"],
        distrito_id: ["d1"],
        tienda_id: ["t1"],
      }),
    );

    for (const col of ["zona_id", "provincia_id", "canton_id", "distrito_id", "tienda_id"]) {
      expect(sql, col).toContain(`o."${col}" IN (`);
    }
  });

  // Mismo criterio que las lecturas cuyo universo es la orden: quien REGISTRÓ una gestión, no
  // el asignado actual (que pudo cambiar después del cierre).
  it("mensajero filtra por `gestion_orden`, no por el asignado de la orden", () => {
    const sql = sqlDe(consultaDe({ mensajero_id: ["m1"] }));

    expect(sql).toContain("EXISTS");
    expect(sql).toContain(`gm."mensajero_id" IN (`);
    expect(sql).toContain(`gm."anulada_at" IS NULL`);
    expect(sql).not.toContain("mensajero_asignado_id");
  });

  it("una faceta no pedida NO escribe su condición", () => {
    expect(sqlDe(consultaDe())).not.toContain(" IN (");
  });
});

describe("La consulta que se ejecuta", () => {
  /**
   * Doble del cliente. `$queryRaw` recibe el `TemplateStringsArray` COMO PRIMER ARGUMENTO —no
   * un objeto que lo contenga—, así que se une ese array para recuperar el SQL literal. Los
   * fragmentos `Prisma.sql` interpolados viajan como VALORES y no aparecen aquí, que es
   * justamente lo que interesa: lo que se afirma es el esqueleto de la consulta.
   */
  function prismaQueDevuelve(filas: unknown[]) {
    const capturado: { sql: string } = { sql: "" };
    const prisma = {
      $queryRaw: (plantilla: readonly string[]) => {
        capturado.sql = [...plantilla].join("?");
        return Promise.resolve(filas);
      },
    };
    return { prisma, capturado };
  }

  // ⚠ LAS TRES DECISIONES HEREDADAS DEL ROLLUP, en una sola aserción sobre el SQL.
  //
  // `DISTINCT ON` + `DESC`: la ÚLTIMA transición terminal, no la primera. El caso real que
  // resuelve: una orden entra a terminal, alguien la revierte y vuelve a entrar — con la
  // primera, el reloj pararía en un cierre que se deshizo. Y garantiza UNA contribución por
  // orden, nunca dos.
  //
  // El desempate por `id` no sobra: dos transiciones pueden compartir `created_at`, y sin él
  // Postgres podría elegir una u otra entre ejecuciones.
  it("se queda con la ÚLTIMA transición terminal por orden, con desempate estable", async () => {
    const { prisma, capturado } = prismaQueDevuelve([{ seg: "0", n: 0 }]);

    await new CicloVidaRepository(prisma as never).acumularCiclos(consultaDe());

    expect(capturado.sql).toContain(`DISTINCT ON (h."orden_id")`);
    expect(capturado.sql).toContain(`ORDER BY h."orden_id", h."created_at" DESC, h."id" DESC`);
  });

  it("el reloj arranca en `orden.created_at` y para en el cierre", async () => {
    const { prisma, capturado } = prismaQueDevuelve([{ seg: "0", n: 0 }]);

    await new CicloVidaRepository(prisma as never).acumularCiclos(consultaDe());

    expect(capturado.sql).toContain(`EXTRACT(EPOCH FROM (u.cerrado_at - o."created_at"))`);
  });

  // El driver devuelve los `bigint` como STRING. Sin la coerción, `segundosAcum` sería una
  // cadena y el promedio saldría concatenado en vez de dividido.
  it("normaliza el `bigint` que llega como string", async () => {
    const { prisma } = prismaQueDevuelve([{ seg: "86400", n: 2 }]);

    await expect(
      new CicloVidaRepository(prisma as never).acumularCiclos(consultaDe()),
    ).resolves.toEqual({ segundosAcum: 86400, n: 2 });
  });

  it("sin ninguna orden cerrada devuelve cero y cero, no `null`", async () => {
    const { prisma } = prismaQueDevuelve([{ seg: null, n: 0 }]);

    await expect(
      new CicloVidaRepository(prisma as never).acumularCiclos(consultaDe()),
    ).resolves.toEqual({ segundosAcum: 0, n: 0 });
  });

  it("una respuesta sin filas tampoco revienta", async () => {
    const { prisma } = prismaQueDevuelve([]);

    await expect(
      new CicloVidaRepository(prisma as never).acumularCiclos(consultaDe()),
    ).resolves.toEqual({ segundosAcum: 0, n: 0 });
  });
});

/* -------------------------------------------------------------------------- */
/* El promedio                                                                 */
/* -------------------------------------------------------------------------- */

describe("El promedio", () => {
  it("divide el acumulado entre el denominador", () => {
    expect(promedioDeCiclo(86400, 2)).toBe(43200);
  });

  // ⚠ `null` Y NO CERO. Cero segundos de ciclo es una AFIRMACIÓN —«se cerraron al instante»— y
  // lo que ocurrió es que no hubo ninguna que cerrar. Un cero en pantalla se lee como una
  // operación instantánea, justo lo contrario de «no hay dato».
  it("sin denominador es `null`, nunca cero", () => {
    expect(promedioDeCiclo(0, 0)).toBeNull();
  });

  // No se redondea: redondear aquí le quita al consumidor la posibilidad de elegir unidad
  // (segundos, horas, días) sin arrastrar el error.
  it("no redondea", () => {
    expect(promedioDeCiclo(10, 3)).toBeCloseTo(3.3333, 3);
  });
});

/* -------------------------------------------------------------------------- */
/* El servicio                                                                 */
/* -------------------------------------------------------------------------- */

function repoQueDevuelve(segundosAcum: number, n: number): ICicloVidaRepository {
  return { acumularCiclos: vi.fn().mockResolvedValue({ segundosAcum, n }) };
}

function cacheConMemoria() {
  const entradas = new Map<string, unknown>();
  const cache: IAnaliticaCache = {
    async envolver(clave, _tags, producir) {
      if (entradas.has(clave)) return entradas.get(clave) as never;
      const valor = await producir();
      entradas.set(clave, valor);
      return valor;
    },
    async invalidar() {},
  };
  return { cache, entradas };
}

describe("El servicio del ciclo de vida", () => {
  // Numerador y denominador viajan JUNTO al promedio, no en su lugar: son lo único que se
  // puede volver a agregar. Dos recortes se suman por numerador y denominador; promediar
  // promedios da un número que no corresponde a nada.
  it("devuelve numerador, denominador y promedio", async () => {
    const service = new CicloVidaService(repoQueDevuelve(86400, 2), cacheConMemoria().cache, {
      now: () => AHORA,
    });

    expect(await service.consultar(consultaDe())).toEqual({
      segundosAcum: 86400,
      n: 2,
      promedioSegundos: 43200,
      lastSync: "2026-08-18T12:00:00.000Z",
    });
  });

  it("sin órdenes cerradas el promedio es `null` y el denominador cero", async () => {
    const service = new CicloVidaService(repoQueDevuelve(0, 0), cacheConMemoria().cache, {
      now: () => AHORA,
    });

    const datos = await service.consultar(consultaDe());
    expect(datos.promedioSegundos).toBeNull();
    expect(datos.n).toBe(0);
  });

  // Mismo caso que en los otros cinco servicios: el sello dice cuándo se LEYÓ, no cuándo se
  // sirvió.
  it("con la caché caliente no refresca el sello y la base se toca una vez", async () => {
    const { cache } = cacheConMemoria();
    let reloj = new Date("2026-08-18T12:00:00.000Z");
    const repo = repoQueDevuelve(100, 1);
    const service = new CicloVidaService(repo, cache, { now: () => reloj });

    const primera = await service.consultar(consultaDe());
    reloj = new Date("2026-08-18T12:10:00.000Z");
    const segunda = await service.consultar(consultaDe());

    expect(segunda.lastSync).toBe(primera.lastSync);
    expect(repo.acumularCiclos).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------- */
/* El borde                                                                    */
/* -------------------------------------------------------------------------- */

const DATOS: CicloVidaDTO = {
  segundosAcum: 86400,
  n: 2,
  promedioSegundos: 43200,
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

describe("El borde del ciclo de vida", () => {
  it("devuelve las tres cifras", async () => {
    const { deps: d } = deps({ usuarioId: "u1", rol: "maestro" });

    expect(await consultarCicloVida({}, d)).toEqual({ status: "ok", datos: DATOS });
  });

  it("acepta las MISMAS siete facetas que las otras cinco lecturas", async () => {
    const { deps: d, service } = deps({ usuarioId: "u1", rol: "maestro" });

    const res = await consultarCicloVida(
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

    await consultarCicloVida({}, d);

    expect(service.consultar.mock.lastCall?.[0] as never).toMatchObject({
      alcance: { tipo: "tienda", tiendaId: "u1" },
    });
  });

  it("un filtro inválido no toca el servicio ni el log", async () => {
    const { deps: d, service, logger } = deps({ usuarioId: "u1", rol: "maestro" });

    expect((await consultarCicloVida({ rango: "trimestre" }, d)).status).toBe("validation_error");
    expect(service.consultar).not.toHaveBeenCalled();
    expect(logger.logError).not.toHaveBeenCalled();
  });

  it("el mensajero es `forbidden` y queda AUDITADO, con su propio nombre", async () => {
    const { deps: d, service, logger } = deps({ usuarioId: "m1", rol: "mensajero" });

    expect(await consultarCicloVida({}, d)).toEqual({ status: "forbidden" });
    expect(service.consultar).not.toHaveBeenCalled();
    expect(logger.logError.mock.calls[0]?.[0]).toMatchObject({
      evento: "analitica_denegado",
      motivo: "metrica_prohibida",
      // Distinto al `tiempo_ciclo` del catálogo a propósito: confundirlos haría creer que la
      // denegación vino del tablero del rollup.
      metricaId: "ciclo_vida",
    });
  });

  it("sin sesión es `unauthenticated`, no `forbidden`", async () => {
    const { deps: d } = deps(null);

    expect(await consultarCicloVida({}, d)).toEqual({ status: "unauthenticated" });
  });

  it("pedir datos ajenos es `forbidden` y no un promedio de cero", async () => {
    const { deps: d, service } = deps({ usuarioId: "u1", rol: "adminTienda" });

    const res = await consultarCicloVida({ tienda_id: ["otra"] }, d);

    expect(res).toEqual({ status: "forbidden" });
    expect(res).not.toHaveProperty("datos");
    expect(service.consultar).not.toHaveBeenCalled();
  });
});
