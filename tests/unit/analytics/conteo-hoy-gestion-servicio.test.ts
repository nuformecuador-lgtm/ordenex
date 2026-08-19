import { describe, it, expect, vi } from "vitest";

import {
  claveDeConteoCargadasPorDia,
  claveDeConteoHoyGestion,
  prepararConteoEntregas,
  type ConsultaConteoEntregas,
} from "@/lib/analytics/entregas-conteo";
import { resolverRango } from "@/lib/analytics/ranges";
import type { IAnaliticaCache } from "@/lib/interfaces/external/IAnaliticaCache";
import type { IConteoHoyGestionRepository } from "@/lib/interfaces/repositories/IConteoHoyGestionRepository";
import {
  condicionesDeHoy,
  ConteoHoyGestionRepository,
} from "@/lib/repositories/ConteoHoyGestionRepository";
import { ConteoHoyGestionService } from "@/lib/services/ConteoHoyGestionService";

/** Mediodía CR del 17 (18:00Z sería otro día; 12:00Z son las 06:00 de Costa Rica). */
const AHORA = new Date("2026-08-17T12:00:00.000Z");
const HOY = resolverRango({ preset: "dia" }, AHORA);

function consultaDe(raw: object = {}, rol = "maestro", extra: object = {}): ConsultaConteoEntregas {
  const preparada = prepararConteoEntregas(raw, { usuarioId: "u1", rol, ...extra } as never, AHORA);
  if (preparada.status !== "ok") throw new Error(`filtro de prueba inválido: ${preparada.status}`);
  return preparada.consulta;
}

function repoQueDevuelve(sinGestion: number, conGestion: number): IConteoHoyGestionRepository {
  return { contarDeHoy: vi.fn().mockResolvedValue({ sinGestion, conGestion }) };
}

/** Caché de mentira con memoria real: sirve lo guardado sin re-ejecutar el productor. */
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

describe("Contador de hoy — las dos cifras y su total", () => {
  // El total se DERIVA de las dos cifras que viajan. Si saliera de una segunda consulta, una
  // gestión registrada entre las dos dejaría dos números que no suman lo que dicen sumar.
  it("`total` es exactamente `sinGestion + conGestion`", async () => {
    const service = new ConteoHoyGestionService(repoQueDevuelve(14, 6), cacheConMemoria().cache, {
      now: () => AHORA,
    });

    const datos = await service.consultar(consultaDe());

    expect(datos).toMatchObject({ sinGestion: 14, conGestion: 6, total: 20 });
  });

  // Ceros REALES, nunca `null`: un día sin cargas son dos ceros, y eso es un hecho, no una
  // ausencia de dato. El «no se pudo saber» viaja por el discriminante del resultado.
  it("un día sin cargas son dos ceros y total 0", async () => {
    const service = new ConteoHoyGestionService(repoQueDevuelve(0, 0), cacheConMemoria().cache, {
      now: () => AHORA,
    });

    expect(await service.consultar(consultaDe())).toMatchObject({
      sinGestion: 0,
      conGestion: 0,
      total: 0,
    });
  });

  // La fecha la resuelve el SERVIDOR en hora de Costa Rica y viaja en el DTO: un navegador en
  // otro huso —o abierto desde ayer— deduciría otra.
  it("devuelve el día CR que contó", async () => {
    const service = new ConteoHoyGestionService(repoQueDevuelve(1, 1), cacheConMemoria().cache, {
      now: () => AHORA,
    });

    expect((await service.consultar(consultaDe())).fecha).toBe("2026-08-17");
  });
});

describe("Contador de hoy — no recibe filtro de fecha", () => {
  // ⚠ EL CASO QUE DEFINE ESTA LECTURA. Un contador «de hoy» que obedeciera al selector de
  // fechas dejaría de ser el contador de hoy sin cambiar de rótulo.
  it("ignora el rango del filtro y cuenta SIEMPRE el día en curso", async () => {
    const repo = repoQueDevuelve(1, 1);
    const service = new ConteoHoyGestionService(repo, cacheConMemoria().cache, { now: () => AHORA });

    await service.consultar(
      consultaDe({ rango: "personalizado", desde: "2026-01-01", hasta: "2026-01-31" }),
    );

    const dia = (repo.contarDeHoy as ReturnType<typeof vi.fn>).mock.lastCall?.[1];
    expect(dia).toMatchObject({ desdeFecha: "2026-08-17", hastaFecha: "2026-08-17" });
    expect(dia.desde).toEqual(new Date("2026-08-17T06:00:00.000Z"));
    expect(dia.hasta).toEqual(new Date("2026-08-18T06:00:00.000Z"));
  });

  // El día lo pone el reloj INYECTADO y nada más: misma consulta, distinto `now`, distinto día.
  it("el día sale del reloj inyectado, no de un `Date.now()` escondido", async () => {
    const repo = repoQueDevuelve(1, 1);
    const service = new ConteoHoyGestionService(repo, cacheConMemoria().cache, {
      now: () => new Date("2026-12-31T23:00:00.000Z"), // 17:00 en Costa Rica
    });

    expect((await service.consultar(consultaDe())).fecha).toBe("2026-12-31");
  });
});

describe("Contador de hoy — la caché y el sello", () => {
  it("`lastSync` sale del reloj inyectado", async () => {
    const service = new ConteoHoyGestionService(repoQueDevuelve(1, 1), cacheConMemoria().cache, {
      now: () => AHORA,
    });

    expect((await service.consultar(consultaDe())).lastSync).toBe("2026-08-17T12:00:00.000Z");
  });

  it("con la caché caliente NO se refresca el sello, y la base se toca una vez", async () => {
    const { cache } = cacheConMemoria();
    let reloj = new Date("2026-08-17T12:00:00.000Z");
    const repo = repoQueDevuelve(3, 4);
    const service = new ConteoHoyGestionService(repo, cache, { now: () => reloj });

    const primera = await service.consultar(consultaDe());
    reloj = new Date("2026-08-17T12:10:00.000Z");
    const segunda = await service.consultar(consultaDe());

    expect(segunda.lastSync).toBe(primera.lastSync);
    expect(repo.contarDeHoy).toHaveBeenCalledTimes(1);
  });

  // ⚠ EL CASO QUE JUSTIFICA EL COMPONENTE `hoy=` DE LA CLAVE. Esta lectura ignora el rango del
  // filtro, así que sin ese componente la petición de las 23:55 y la de las 00:05 producirían
  // la MISMA clave: el contador empezaría el día mostrando el cierre de ayer durante lo que
  // quedara del TTL de 15 minutos.
  it("al cruzar medianoche CR la entrada de ayer NO se reutiliza", async () => {
    const { cache } = cacheConMemoria();
    let reloj = new Date("2026-08-18T05:55:00.000Z"); // 23:55 del 17 en Costa Rica
    const repo = repoQueDevuelve(9, 1);
    const service = new ConteoHoyGestionService(repo, cache, { now: () => reloj });

    const ayer = await service.consultar(consultaDe());
    reloj = new Date("2026-08-18T06:05:00.000Z"); // 00:05 del 18 en Costa Rica
    const hoy = await service.consultar(consultaDe());

    expect(ayer.fecha).toBe("2026-08-17");
    expect(hoy.fecha).toBe("2026-08-18");
    expect(repo.contarDeHoy).toHaveBeenCalledTimes(2);
  });

  // El prefijo, como en las otras tres: comparten `ConsultaConteoEntregas` entera, así que sin
  // él producirían la misma clave con valores de forma distinta.
  it("no colisiona con la clave de la serie de cargadas", () => {
    const consulta = consultaDe({ zona_id: ["z1"] });

    expect(claveDeConteoHoyGestion(consulta, HOY)).not.toBe(claveDeConteoCargadasPorDia(consulta));
  });

  // El ALCANCE dentro de la clave es seguridad, no higiene: sin él, la entrada cacheada para un
  // admin la serviría un adminTienda.
  it("sigue distinguiendo alcance y facetas dentro de su propio espacio", () => {
    const base = consultaDe();
    const conZona = consultaDe({ zona_id: ["z1"] });
    const otroAlcance: ConsultaConteoEntregas = {
      ...base,
      alcance: { tipo: "tienda", tiendaId: "t1" },
    };

    const claves = [base, conZona, otroAlcance].map((c) => claveDeConteoHoyGestion(c, HOY));
    expect(new Set(claves).size).toBe(3);
  });
});

/* -------------------------------------------------------------------------- */
/* El `where` y la consulta                                                     */
/* -------------------------------------------------------------------------- */

function sqlDe(consulta: ConsultaConteoEntregas): string {
  return condicionesDeHoy(consulta, HOY)
    .map((c) => c.sql)
    .join(" AND ");
}

function parametrosDe(consulta: ConsultaConteoEntregas): unknown[] {
  return condicionesDeHoy(consulta, HOY).flatMap((c) => c.values);
}

describe("El `where` del contador de hoy", () => {
  // FRONTERA MULTI-TENANT: sin policies RLS debajo, esta condición es la única separación entre
  // inquilinos. Va en la posición 0 para que se lea de un vistazo.
  it("el recorte por rol es la primera condición", () => {
    const primera = condicionesDeHoy(consultaDe({}, "adminTienda"), HOY)[0];

    expect(primera?.sql).toContain('o."tienda_id"');
    expect(primera?.values).toEqual(["u1"]);
  });

  it("aplica las cinco facetas de recorte y el soft delete", () => {
    const consulta = consultaDe({ zona_id: ["z1"], tienda_id: ["t1"] });

    expect(sqlDe(consulta)).toContain('o."zona_id" IN (');
    expect(sqlDe(consulta)).toContain('o."tienda_id" IN (');
    expect(sqlDe(consulta)).toContain('o."deleted_at" IS NULL');
  });

  // Mismo criterio que la serie de cargadas: una orden no la carga un mensajero.
  it("NO aplica la faceta de mensajero", () => {
    const consulta = consultaDe({ mensajero_id: ["m1"] });

    expect(sqlDe(consulta)).toBe(sqlDe(consultaDe({})));
    expect(parametrosDe(consulta)).not.toContain("m1");
  });

  // La ventana es la del día en curso, semiabierta `[00:00 CR, 00:00 CR de mañana)`. Un `<=`
  // metería mañana entero.
  it("la ventana es el día CR en curso, semiabierta y sobre `created_at`", () => {
    const consulta = consultaDe({ rango: "personalizado", desde: "2026-01-01", hasta: "2026-01-31" });

    expect(sqlDe(consulta)).toContain('o."created_at" >=');
    expect(sqlDe(consulta)).toContain('o."created_at" <  ');
    expect(sqlDe(consulta)).not.toContain('o."created_at" <=');
    // Los bordes son los de HOY, no los del rango que pidió el filtro.
    expect(parametrosDe(consulta).filter((v) => v instanceof Date)).toEqual([HOY.desde, HOY.hasta]);
  });
});

describe("La consulta que se ejecuta", () => {
  /** Doble del cliente Prisma: captura la plantilla del tagged template y devuelve filas fijas. */
  function prismaFalso(filas: { sin_gestion: number; con_gestion: number }[]) {
    const capturado = { sql: "" };
    const prisma = {
      $queryRaw: (plantilla: TemplateStringsArray, ...valores: { sql?: string }[]) => {
        capturado.sql = [...plantilla].map((t, i) => t + (valores[i]?.sql ?? "")).join("");
        return Promise.resolve(filas);
      },
    };
    return { prisma, capturado };
  }

  it("reparte las mismas filas en dos buckets con `FILTER`, en UNA consulta", async () => {
    const { prisma, capturado } = prismaFalso([{ sin_gestion: 14, con_gestion: 6 }]);

    const crudo = await new ConteoHoyGestionRepository(prisma as never).contarDeHoy(
      consultaDe({}),
      HOY,
    );

    expect(crudo).toEqual({ sinGestion: 14, conGestion: 6 });
    expect(capturado.sql).toContain("FILTER");
    // Una sola pasada por `orden`: sin subconsulta de conteo aparte.
    expect(capturado.sql.match(/FROM "orden"/g)).toHaveLength(1);
  });

  // «¿La ha tocado alguien?», no «¿cómo acabó?»: el lateral no mira el `resultado` y para en la
  // primera gestión vigente que encuentra.
  it("mira si existe ALGUNA gestión vigente, sin importar su resultado", async () => {
    const { prisma, capturado } = prismaFalso([{ sin_gestion: 0, con_gestion: 0 }]);

    await new ConteoHoyGestionRepository(prisma as never).contarDeHoy(consultaDe({}), HOY);

    expect(capturado.sql).toContain("LEFT JOIN LATERAL");
    expect(capturado.sql).toContain("LIMIT 1");
    expect(capturado.sql).toContain('g."anulada_at" IS NULL');
    expect(capturado.sql).not.toContain("resultado");
  });

  it("una respuesta sin filas son dos ceros, no un `undefined` colándose al DTO", async () => {
    const { prisma } = prismaFalso([]);

    expect(
      await new ConteoHoyGestionRepository(prisma as never).contarDeHoy(consultaDe({}), HOY),
    ).toEqual({ sinGestion: 0, conGestion: 0 });
  });
});
