import { describe, it, expect, vi } from "vitest";

import {
  claveDeConteoCargadasPorDia,
  claveDeConteoEntregas,
  claveDeConteoPorStatus,
  prepararConteoEntregas,
  type ConsultaConteoEntregas,
} from "@/lib/analytics/entregas-conteo";
import type { IAnaliticaCache } from "@/lib/interfaces/external/IAnaliticaCache";
import type { IConteoCargadasPorDiaRepository } from "@/lib/interfaces/repositories/IConteoCargadasPorDiaRepository";
import {
  condicionesDeCargadas,
  ConteoCargadasPorDiaRepository,
} from "@/lib/repositories/ConteoCargadasPorDiaRepository";
import { ConteoCargadasPorDiaService } from "@/lib/services/ConteoCargadasPorDiaService";

const AHORA = new Date("2026-08-17T12:00:00.000Z");

function consultaDe(raw: object = {}, rol = "maestro", extra: object = {}): ConsultaConteoEntregas {
  const preparada = prepararConteoEntregas(raw, { usuarioId: "u1", rol, ...extra } as never, AHORA);
  if (preparada.status !== "ok") throw new Error(`filtro de prueba inválido: ${preparada.status}`);
  return preparada.consulta;
}

function repoQueDevuelve(
  filas: { fecha: string; conteo: number }[],
): IConteoCargadasPorDiaRepository {
  return { contarCargadasPorDia: vi.fn().mockResolvedValue(filas) };
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

describe("Servicio de cargadas por día — el total", () => {
  // El total se DERIVA de los mismos días que viajan. Si saliera de una segunda consulta, una
  // escritura entre las dos dejaría en pantalla un total que no es la suma de lo de abajo.
  it("es la suma exacta de los días", async () => {
    const service = new ConteoCargadasPorDiaService(
      repoQueDevuelve([
        { fecha: "2026-08-15", conteo: 12 },
        { fecha: "2026-08-16", conteo: 7 },
        { fecha: "2026-08-17", conteo: 1 },
      ]),
      cacheConMemoria().cache,
      { now: () => AHORA },
    );

    const datos = await service.consultar(consultaDe());

    expect(datos.total).toBe(20);
    expect(datos.porDia.reduce((s, f) => s + f.conteo, 0)).toBe(datos.total);
  });

  it("un universo vacío es una serie vacía y total 0", async () => {
    const service = new ConteoCargadasPorDiaService(repoQueDevuelve([]), cacheConMemoria().cache, {
      now: () => AHORA,
    });

    expect(await service.consultar(consultaDe())).toMatchObject({ porDia: [], total: 0 });
  });

  // El orden cronológico lo fija el repositorio y el servicio NO reordena: es una serie
  // temporal, y reordenarla en cualquier capa posterior pintaría el eje al revés sin que nada
  // fallara. Tampoco RELLENA los días vacíos (ver `ConteoCargadasPorDiaDTO`): la consulta puede
  // venir sin ventana, y entonces no existe el conjunto de días que habría que rellenar.
  it("conserva la serie tal cual la trajo el repositorio, huecos incluidos", async () => {
    const service = new ConteoCargadasPorDiaService(
      repoQueDevuelve([
        { fecha: "2026-08-15", conteo: 12 },
        // El 16 no tuvo cargas y por eso no viene. El hueco significa cero.
        { fecha: "2026-08-17", conteo: 1 },
      ]),
      cacheConMemoria().cache,
      { now: () => AHORA },
    );

    expect((await service.consultar(consultaDe())).porDia.map((f) => f.fecha)).toEqual([
      "2026-08-15",
      "2026-08-17",
    ]);
  });
});

describe("Servicio de cargadas por día — el sello y la caché", () => {
  it("`lastSync` sale del reloj inyectado", async () => {
    const service = new ConteoCargadasPorDiaService(
      repoQueDevuelve([{ fecha: "2026-08-17", conteo: 1 }]),
      cacheConMemoria().cache,
      { now: () => AHORA },
    );

    expect((await service.consultar(consultaDe())).lastSync).toBe("2026-08-17T12:00:00.000Z");
  });

  // Mismo caso que en los dos servicios hermanos y por el mismo motivo: el sello dice cuándo se
  // LEYÓ, no cuándo se sirvió. Sellarlo fuera del productor mentiría en cada acierto de caché,
  // que son todas las peticiones menos la primera de cada ventana de 15 min.
  it("con la caché caliente NO se refresca el sello, y la base se toca una vez", async () => {
    const { cache } = cacheConMemoria();
    let reloj = new Date("2026-08-17T12:00:00.000Z");
    const repo = repoQueDevuelve([{ fecha: "2026-08-17", conteo: 1 }]);
    const service = new ConteoCargadasPorDiaService(repo, cache, { now: () => reloj });

    const primera = await service.consultar(consultaDe());
    reloj = new Date("2026-08-17T12:10:00.000Z");
    const segunda = await service.consultar(consultaDe());

    expect(segunda.lastSync).toBe(primera.lastSync);
    expect(repo.contarCargadasPorDia).toHaveBeenCalledTimes(1);
  });
});

describe("Las TRES lecturas comparten filtro pero NO entrada de caché", () => {
  // ⚠ EL CASO QUE JUSTIFICA EL TERCER PREFIJO. Las tres comparten `ConsultaConteoEntregas`
  // entera —el filtro es idéntico a propósito, para que la barra las mueva a la vez— así que
  // sin prefijo producirían LA MISMA CLAVE con valores de forma distinta: quien pidiera la
  // serie recibiría el `porDesenlace` del anillo.
  it("la misma consulta da tres claves distintas", () => {
    const consulta = consultaDe({ zona_id: ["z1"] });

    const claves = [
      claveDeConteoCargadasPorDia(consulta),
      claveDeConteoPorStatus(consulta),
      claveDeConteoEntregas(consulta),
    ];
    expect(new Set(claves).size).toBe(3);
  });

  // Y el resto de la clave sigue discriminando igual: el prefijo se añade, no sustituye. El
  // ALCANCE dentro de la clave es seguridad: sin él, la entrada cacheada para un admin la
  // serviría un adminTienda.
  it("sigue distinguiendo alcance y filtro dentro de su propio espacio", () => {
    const base = consultaDe();
    const conZona = consultaDe({ zona_id: ["z1"] });
    const otroAlcance: ConsultaConteoEntregas = {
      ...base,
      alcance: { tipo: "tienda", tiendaId: "t1" },
    };

    const claves = [base, conZona, otroAlcance].map(claveDeConteoCargadasPorDia);
    expect(new Set(claves).size).toBe(3);
  });
});

/* -------------------------------------------------------------------------- */
/* El `where`: las MISMAS facetas que las otras dos lecturas                    */
/* -------------------------------------------------------------------------- */

/** El SQL de todas las condiciones unidas, tal como llega al `WHERE`. */
function sqlDe(consulta: ConsultaConteoEntregas): string {
  return condicionesDeCargadas(consulta)
    .map((c) => c.sql)
    .join(" AND ");
}

/** Los parámetros, en orden. Lo que de verdad viaja: nada de esto se interpola. */
function parametrosDe(consulta: ConsultaConteoEntregas): unknown[] {
  return condicionesDeCargadas(consulta).flatMap((c) => c.values);
}

describe("El recorte por ROL es la primera condición, siempre", () => {
  // FRONTERA MULTI-TENANT: sin policies RLS debajo, esta condición es la única separación entre
  // inquilinos. Un fallo aquí no da una cifra equivocada, filtra órdenes de una tienda a otra.
  it("va en la POSICIÓN 0, antes que cualquier faceta del cliente", () => {
    const primera = condicionesDeCargadas(
      consultaDe({ zona_id: ["z1"], tienda_id: ["u1"] }, "adminTienda"),
    )[0];

    expect(primera?.sql).toContain('o."tienda_id"');
    expect(primera?.values).toEqual(["u1"]);
  });

  it("`global` produce `TRUE`, no un hueco que rompa el AND", () => {
    expect(sqlDe(consultaDe({}))).toMatch(/^TRUE AND /);
  });
});

describe("Las seis facetas y el soft delete, idénticos a las otras dos lecturas", () => {
  it("cada faceta se traduce a un `IN` parametrizado sobre su columna de `orden`", () => {
    const consulta = consultaDe({
      zona_id: ["z1"],
      provincia_id: ["p1"],
      canton_id: ["c1"],
      distrito_id: ["d1"],
      tienda_id: ["t1"],
    });
    const sql = sqlDe(consulta);

    for (const columna of ["zona_id", "provincia_id", "canton_id", "distrito_id", "tienda_id"]) {
      expect(sql).toContain(`o."${columna}" IN (`);
    }
    expect(parametrosDe(consulta)).toEqual(
      expect.arrayContaining(["z1", "p1", "c1", "d1", "t1"]),
    );
  });

  it("una orden borrada no cuenta en ningún día", () => {
    expect(sqlDe(consultaDe({}))).toContain('o."deleted_at" IS NULL');
  });

  // ⚠ LA EXCEPCIÓN, Y ES UNA DECISIÓN: esta lectura IGNORA `mensajero_id`. Una orden no la
  // carga un mensajero, así que recortar por él contestaría «de las cargadas ese día, cuántas
  // acabó tocando este mensajero» — otra pregunta, con forma de curva de carga.
  it("la faceta de mensajero NO recorta: ni condición, ni parámetro, ni tabla de gestiones", () => {
    const consulta = consultaDe({ mensajero_id: ["m1"] });

    expect(sqlDe(consulta)).not.toContain("gestion_orden");
    expect(sqlDe(consulta)).not.toContain("EXISTS");
    expect(parametrosDe(consulta)).not.toContain("m1");
  });

  // Anti-vacío del caso de arriba: la consulta con mensajero produce EXACTAMENTE el mismo
  // `where` que la de sin mensajero. Sin esta pareja, el test anterior también pasaría si el
  // `where` se hubiera roto entero.
  it("con y sin mensajero producen el mismo `where`", () => {
    expect(sqlDe(consultaDe({ mensajero_id: ["m1"] }))).toBe(sqlDe(consultaDe({})));
  });

  // Y la caché no se apoya en esa igualdad: el componente `x=` sigue en la clave. Es redundante
  // —dos entradas para el mismo resultado— y se acepta a propósito: una clave que ignora un
  // componente del filtro es la clase de atajo que un día sirve datos de un recorte en otro.
  it("aun así, dos consultas que solo difieren en el mensajero no comparten entrada de caché", () => {
    expect(claveDeConteoCargadasPorDia(consultaDe({ mensajero_id: ["m1"] }))).not.toBe(
      claveDeConteoCargadasPorDia(consultaDe({})),
    );
  });

  it("sin facetas no se escribe ningún `IN`: el filtro ausente no recorta", () => {
    expect(sqlDe(consultaDe({}))).not.toContain(" IN (");
  });
});

describe("La ventana cae sobre la fecha de CARGA, no sobre la fecha efectiva", () => {
  // Es la ÚNICA condición que no coincide con las otras dos lecturas, y es deliberado: allí la
  // ventana cae sobre `COALESCE(última gestión vigente, created_at)` («cuándo pasó algo con la
  // orden») y aquí sobre `created_at` («cuándo entró»). Filtrar por la efectiva y agrupar por
  // la de carga daría una serie con días fuera del rango pedido.
  it("compara `o.created_at` y NO usa el COALESCE de la gestión", () => {
    const sql = sqlDe(consultaDe({ rango: "personalizado", desde: "2026-08-01", hasta: "2026-08-16" }));

    expect(sql).toContain('o."created_at" >=');
    expect(sql).not.toContain("COALESCE");
  });

  // SEMIABIERTA `[desde, hasta)`: `resolverRango` devuelve `hasta` como las 00:00 CR del día
  // SIGUIENTE, justamente para que `hastaFecha` sea inclusiva. Un `<=` metería el día siguiente.
  it("la ventana es semiabierta y sus dos bordes viajan como parámetros", () => {
    const consulta = consultaDe({ rango: "personalizado", desde: "2026-08-01", hasta: "2026-08-16" });

    expect(sqlDe(consulta)).toContain('o."created_at" <  ');
    expect(sqlDe(consulta)).not.toContain('o."created_at" <=');
    expect(parametrosDe(consulta).filter((v) => v instanceof Date)).toEqual([
      new Date("2026-08-01T06:00:00.000Z"),
      new Date("2026-08-17T06:00:00.000Z"),
    ]);
  });

  // SIN rango no se escribe NINGUNA condición de fecha (decisión del 2026-08-18): la pantalla
  // no arranca con ventana puesta, y «sin filtrar» cuenta todas las órdenes, no las de una
  // semana. Un rango centinela «que lo abarca todo» seguiría dejando fuera lo que cayera fuera.
  it("sin rango no hay condición de fecha en absoluto", () => {
    expect(sqlDe(consultaDe({}))).not.toContain('o."created_at"');
  });
});

describe("El agrupamiento por DÍA: una sola definición del día CR", () => {
  /** Doble del cliente Prisma: captura la plantilla del tagged template y devuelve filas fijas. */
  function prismaFalso(filas: { dia: string; n: number }[]) {
    const capturado: { sql: string; valores: unknown[] } = { sql: "", valores: [] };
    const prisma = {
      $queryRaw: (plantilla: TemplateStringsArray, ...valores: { sql?: string }[]) => {
        // El texto que de verdad se envía: los trozos literales más el SQL de cada fragmento
        // `Prisma.sql` interpolado (el `WHERE` y la expresión del día son fragmentos, no
        // parámetros).
        capturado.sql = [...plantilla]
          .map((trozo, i) => trozo + (valores[i]?.sql ?? ""))
          .join("");
        capturado.valores = valores;
        return Promise.resolve(filas);
      },
    };
    return { prisma, capturado };
  }

  it("devuelve una fila por día, con la fecha calendario y el conteo como número", async () => {
    const { prisma } = prismaFalso([
      { dia: "2026-08-15", n: 12 },
      { dia: "2026-08-16", n: 7 },
    ]);

    const filas = await new ConteoCargadasPorDiaRepository(prisma as never).contarCargadasPorDia(
      consultaDe({}),
    );

    expect(filas).toEqual([
      { fecha: "2026-08-15", conteo: 12 },
      { fecha: "2026-08-16", conteo: 7 },
    ]);
  });

  // ⚠ LA REGLA HEREDADA DE LA 180, Y EL MOTIVO DE QUE ESTE ARCHIVO EXISTA: en este SQL no puede
  // haber NI UNA zona horaria. Cualquiera de estas sería una SEGUNDA definición del día
  // operativo fuera del alcance de `lib/utils/fecha-cr.ts` — el off-by-one de seis horas del
  // que avisa `lib/analytics/ranges.ts`.
  it("el SQL no nombra ninguna zona horaria ni ningún desfase escrito a mano", async () => {
    const { prisma, capturado } = prismaFalso([]);

    await new ConteoCargadasPorDiaRepository(prisma as never).contarCargadasPorDia(consultaDe({}));

    expect(capturado.sql).not.toMatch(/AT TIME ZONE/i);
    expect(capturado.sql).not.toMatch(/America|Costa_Rica/i);
    expect(capturado.sql).not.toMatch(/interval\s+'6 hours'/i);
    // La única unidad escrita es el segundo; el número de segundos entra como parámetro.
    expect(capturado.sql).toContain("interval '1 second'");
  });

  it("agrupa por la fecha `::date` del instante y la devuelve como texto `YYYY-MM-DD`", async () => {
    const { prisma, capturado } = prismaFalso([]);

    await new ConteoCargadasPorDiaRepository(prisma as never).contarCargadasPorDia(consultaDe({}));

    expect(capturado.sql).toContain('o."created_at"');
    expect(capturado.sql).toContain("::date");
    expect(capturado.sql).toContain("'YYYY-MM-DD'");
    expect(capturado.sql).toContain("GROUP BY 1");
    // Orden cronológico ascendente: es contrato del DTO, no presentación.
    expect(capturado.sql).toContain("ORDER BY 1 ASC");
  });

  // Ni un JOIN: el día de carga está en la propia fila de `orden`, así que esta consulta no
  // necesita el `LEFT JOIN LATERAL` sobre la última gestión vigente que sí necesitan las otras
  // dos. Que siga sin necesitarlo es la mitad de por qué esta lectura es barata.
  it("no arrastra el LATERAL de la última gestión", async () => {
    const { prisma, capturado } = prismaFalso([]);

    await new ConteoCargadasPorDiaRepository(prisma as never).contarCargadasPorDia(consultaDe({}));

    expect(capturado.sql).not.toContain("LATERAL");
  });
});
