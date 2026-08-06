import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { prepararConsultaAnalitica } from "@/lib/analytics/consulta";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type { ActorAnalitica } from "@/lib/analytics/alcance";
import { getMetrica } from "@/lib/analytics/metrics";
import { trocear, type CuboTemporal } from "@/lib/analytics/cubo-temporal";
import { IngresosAnaliticaRepository } from "@/lib/repositories/IngresosAnaliticaRepository";
import {
  fakePrismaDinero,
  fakePrismaQueFalla,
  type ConsultaCrudaFake,
} from "./_fake-prisma-dinero";

// Feature 180 / T2.5 — `IngresosAnaliticaRepository.sumarPorCuboYCategoria`.
//
// QUE MIDE ESTE ARCHIVO Y QUE NO, dicho antes de la primera asercion para que nadie lo confunda
// con el test de al lado (`financiera-ingresos-repo.test.ts`, que si ejecuta el `where` contra un
// libro en memoria):
//
//   - AQUI se mide la FORMA DE LA CONSULTA EMITIDA: el texto con sus `$n`, la lista de parametros
//     en su orden, y el formateo de la respuesta. Un fake NO puede ejecutar `width_bucket`, y
//     fingirlo seria escribir una segunda implementacion de Postgres cuyo acuerdo con Postgres
//     nadie comprueba.
//   - LA SEMANTICA —que `T05:59:59.999Z` y `T06:00:00.000Z` caigan en cubos distintos, que el cast
//     `::timestamp` sea el correcto, que un cubo vacio no aparezca— la mide la BASE DE VERDAD, en
//     `tests/integration/repositories/financiera-cubo-temporal.integration.test.ts`.
//
// Con lo de aqui muere quien quite la ventana, quien escriba las categorias a mano, quien cambie
// los limites de particion por algo que no salga de `trocear`, quien olvide el `ORDER BY`, quien
// se trague un error de base y quien pase el dinero por `number`.
//
// EL FIXTURE NO CRUZA `categoria` CON `tipo` (design §7). Los dobles viejos de esta carpeta tienen
// filas como `categoria: egreso_*` con `tipo: ingreso`, que el CHECK
// `wallet_movimiento_tipo_categoria_check` de la 173 RECHAZA con 23514 y que la aplicacion no emite
// jamas. Las filas de aqui son las que la base admite; el unico par legitimo de prefijos cruzados
// es `egreso_gasto`/`egreso` con su reverso `ingreso_ajuste`/`ingreso` (la anulacion de un egreso).

const MAESTRO: ActorAnalitica = { usuarioId: "u-maestro", rol: "maestro" };
const AHORA = new Date("2026-03-12T15:00:00.000Z");

/**
 * TRES dias de Costa Rica, para que la particion tenga mas de un cubo y el orden signifique algo.
 * Se elige `personalizado` y no el preset `dia` a proposito: con un solo cubo, "los limites son los
 * `desde` de cada cubo en orden" es una afirmacion vacia.
 */
const RANGO_CRUDO = { rango: "personalizado", desde: "2026-03-09", hasta: "2026-03-11" } as const;
const DESDE = new Date("2026-03-09T06:00:00.000Z");
const HASTA = new Date("2026-03-12T06:00:00.000Z");

function consultaDe(metricaId: string): ConsultaAnalitica {
  const r = prepararConsultaAnalitica(RANGO_CRUDO, MAESTRO, metricaId, AHORA);
  if (r.status !== "ok") throw new Error(`no se pudo preparar la consulta de ${metricaId}`);
  return r.consulta;
}

/** Los cubos SALEN DE `trocear` (R22): ni uno solo se escribe a mano en este archivo. */
function cubosDe(consulta: ConsultaAnalitica): readonly CuboTemporal[] {
  return trocear(consulta.rango);
}

type FilaCruda = Record<string, unknown>;

/** La respuesta por defecto: dos cubos con dinero, uno sin nada (ese no vuelve de la base). */
const RESPUESTA: readonly FilaCruda[] = [
  { indiceCubo: 0, categoria: "ingreso_flete", tipo: "ingreso", suma: new Prisma.Decimal("1000") },
  {
    indiceCubo: 0,
    categoria: "ingreso_flete_devolucion",
    tipo: "ingreso",
    suma: new Prisma.Decimal("250.5"),
  },
  { indiceCubo: 2, categoria: "ingreso_flete", tipo: "ingreso", suma: new Prisma.Decimal("7.25") },
];

function repositorio(respuesta: readonly FilaCruda[] = RESPUESTA) {
  const fake = fakePrismaDinero({ respuestaCruda: () => respuesta });
  return { repo: new IngresosAnaliticaRepository(fake.cliente), fake };
}

/** El `$queryRaw` que el repositorio emitio: su texto y sus parametros, en orden. */
function sqlEmitido(fake: ReturnType<typeof repositorio>["fake"], i = 0): ConsultaCrudaFake {
  const llamada = fake.llamadas[i];
  expect(llamada.operacion, "el repositorio no emitio ningun $queryRaw").toBe("queryRaw");
  return { texto: llamada.args.texto as string, valores: llamada.args.valores as unknown[] };
}

/* -------------------------------------------------------------------------- */
/* La ventana y los limites de particion                                       */
/* -------------------------------------------------------------------------- */

describe("la consulta por cubo lee la ventana del rango, no una propia", () => {
  it("filtra por `fecha_movimiento >= desde` y `< hasta`, con los dos instantes como parametros", async () => {
    const consulta = consultaDe("ingreso_flete");
    const { repo, fake } = repositorio();
    await repo.sumarPorCuboYCategoria(consulta, cubosDe(consulta));

    const { texto, valores } = sqlEmitido(fake);
    // La ventana es SEMIABIERTA: `>=` por abajo, `<` estricto por arriba. Un `<=` metería el
    // primer instante del dia siguiente, que pertenece al rango siguiente.
    expect(texto).toMatch(/fecha_movimiento\s*>=\s*\$\d+::timestamp/);
    expect(texto).toMatch(/fecha_movimiento\s*<\s+\$\d+::timestamp/);
    expect(texto).not.toMatch(/fecha_movimiento\s*<=/);
    expect(texto).not.toMatch(/fecha_movimiento\s*>\s+\$/);

    // Y los instantes son EXACTAMENTE los de `consulta.rango`, no unos construidos aqui.
    expect(valores).toContainEqual(consulta.rango.desde);
    expect(valores).toContainEqual(consulta.rango.hasta);
    expect(consulta.rango.desde).toEqual(DESDE);
    expect(consulta.rango.hasta).toEqual(HASTA);
  });

  it("ni una fecha viaja interpolada en el texto: todas van como parametro", async () => {
    const consulta = consultaDe("ingreso_flete");
    const { repo, fake } = repositorio();
    await repo.sumarPorCuboYCategoria(consulta, cubosDe(consulta));

    const { texto } = sqlEmitido(fake);
    // Con interpolacion de strings el año aparecería en el SQL. Es la diferencia entre
    // `Prisma.sql` y `$queryRawUnsafe`, y no se ve en el resultado.
    expect(texto).not.toContain("2026-");
    expect(texto).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("los limites de particion son los `desde` de cada cubo, en orden y sin ninguno mas", async () => {
    const consulta = consultaDe("ingreso_flete");
    const cubos = cubosDe(consulta);
    const { repo, fake } = repositorio();
    await repo.sumarPorCuboYCategoria(consulta, cubos);

    const { texto, valores } = sqlEmitido(fake);
    expect(cubos).toHaveLength(3);
    expect(valores.slice(0, cubos.length)).toEqual(cubos.map((c) => c.desde));
    // `width_bucket` con un ARRAY de parametros, uno por cubo: si alguien construyera el array
    // con texto, aqui habria fechas y no `$n`.
    expect(texto).toMatch(/width_bucket\(fecha_movimiento,\s*ARRAY\[(\$\d+::timestamp,?)+\]\)/);
    // El `- 1` que lleva el bucket 1-based de Postgres al indice 0-based del contrato.
    expect(texto).toMatch(/\)\s*-\s*1\s+AS\s+"indiceCubo"/);
  });

  it("el cast de los limites es `::timestamp` y NUNCA `::timestamptz`", async () => {
    // No es cosmetico y no se supuso: `fecha_movimiento` es `timestamp(3)` SIN zona. Con
    // `::timestamptz` Postgres interpretaria el texto en el huso de la SESION (el del proceso de
    // Node) y correria toda frontera de dia varias horas SIN QUE NADA FALLARA. Lo comprueba contra
    // la base el test de integracion; aqui se congela para que el cambio no pase de tapadillo.
    const consulta = consultaDe("ingreso_flete");
    const { repo, fake } = repositorio();
    await repo.sumarPorCuboYCategoria(consulta, cubosDe(consulta));

    const { texto } = sqlEmitido(fake);
    expect(texto).toContain("::timestamp");
    expect(texto).not.toContain("::timestamptz");
    // Y CERO zonas horarias en el SQL: una sola definicion del dia CR, la de `fecha-cr.ts`.
    expect(texto).not.toMatch(/AT TIME ZONE|Costa_Rica|date_trunc|interval/i);
  });
});

/* -------------------------------------------------------------------------- */
/* R17 — las categorias las manda el CATALOGO                                  */
/* -------------------------------------------------------------------------- */

describe("las categorias de la consulta por cubo salen del catalogo, no de un array escrito a mano", () => {
  it("el parametro de categorias es el que la metrica declara", async () => {
    const consulta = consultaDe("ingreso_flete");
    const { repo, fake } = repositorio();
    await repo.sumarPorCuboYCategoria(consulta, cubosDe(consulta));

    const { valores } = sqlEmitido(fake);
    expect(valores.at(-1)).toEqual([...(consulta.metrica.definicion.categorias ?? [])]);
    expect(valores.at(-1)).toEqual(["ingreso_flete", "ingreso_flete_devolucion"]);
  });

  it("alterar `definicion.categorias` en memoria CAMBIA el parametro emitido", async () => {
    // Con la lista clavada en el repositorio, el parametro seguiria siendo el de antes. Este es el
    // unico caso que distingue "el catalogo manda" de "el catalogo describe".
    const metrica = getMetrica("egresos");
    if (metrica === undefined) throw new Error("el catalogo perdio egresos");
    const definicion = metrica.definicion as { categorias?: readonly string[] };
    const original = definicion.categorias;

    const { repo, fake } = repositorio();
    try {
      definicion.categorias = ["egreso_indemnizacion"];
      const consulta = consultaDe("egresos");
      await repo.sumarPorCuboYCategoria(consulta, cubosDe(consulta));
      expect(sqlEmitido(fake).valores.at(-1)).toEqual(["egreso_indemnizacion"]);
    } finally {
      definicion.categorias = original;
    }

    // El catalogo queda como estaba: este test no contamina a los demas.
    expect(getMetrica("egresos")?.definicion.categorias).toEqual(original);
    const consulta = consultaDe("egresos");
    await repo.sumarPorCuboYCategoria(consulta, cubosDe(consulta));
    expect(sqlEmitido(fake, 1).valores.at(-1)).toEqual([...(original ?? [])]);
    expect((original ?? []).length).toBeGreaterThan(1);
  });

  it("una metrica que declara categorias ajenas a la caja NO se sirve en silencio", async () => {
    // Servirla filtrando lo que no encaje daria una cifra corta sin que nada fallara. Y revienta
    // ANTES de consultar: la base no llega a ver una pregunta que no puede significar lo prometido.
    const consulta = consultaDe("cod_recaudado");
    const { repo, fake } = repositorio();
    await expect(repo.sumarPorCuboYCategoria(consulta, cubosDe(consulta))).rejects.toThrow(
      /categorias que la caja principal no tiene/,
    );
    expect(fake.llamadas).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* R23 / R24 — una sola tabla del universo del dinero, y ni una persona        */
/* -------------------------------------------------------------------------- */

describe("la consulta cruda no abre una via nueva a ninguna tabla ni a ninguna identidad", () => {
  it("nombra `wallet_movimiento` y ninguna otra tabla (R23)", async () => {
    const consulta = consultaDe("ingreso_flete");
    const { repo, fake } = repositorio();
    await repo.sumarPorCuboYCategoria(consulta, cubosDe(consulta));

    const { texto } = sqlEmitido(fake);
    expect(texto).toMatch(/FROM\s+wallet_movimiento\b/);
    expect([...texto.matchAll(/\b(FROM|JOIN)\b/gi)]).toHaveLength(1);
    for (const prohibida of [
      "analytics_daily",
      "orden",
      "gestion_orden",
      "usuario",
      "zona",
      "wallet_tienda_movimiento",
      "pago_mensajero_movimiento",
    ]) {
      expect(texto, `el SQL nombra ${prohibida}`).not.toContain(prohibida);
    }
  });

  it("ni la consulta ni la respuesta llevan un identificador de persona (R24)", async () => {
    const consulta = consultaDe("ingreso_flete");
    const { repo, fake } = repositorio();
    const filas = await repo.sumarPorCuboYCategoria(consulta, cubosDe(consulta));

    expect(sqlEmitido(fake).texto).not.toMatch(/mensajero|tienda|usuario|registrado_por/i);
    expect(filas.length).toBeGreaterThan(0);
    for (const fila of filas) {
      // La coordenada de salida es un INDICE de cubo, no una fecha y no una entidad.
      expect(Object.keys(fila).sort()).toEqual(["categoria", "indiceCubo", "suma", "tipo"]);
      expect(typeof fila.indiceCubo).toBe("number");
    }
  });
});

/* -------------------------------------------------------------------------- */
/* R22 — la consulta entra ENTERA                                              */
/* -------------------------------------------------------------------------- */

describe("R22 · el metodo recibe la ConsultaAnalitica entera, no piezas sueltas", () => {
  it("su firma son DOS parametros: la consulta y los cubos; ni una fecha, tienda, zona o mensajero suelta", () => {
    // La arity es lo que se puede leer en ejecucion; el tipo hace el resto (`ConsultaAnalitica` es
    // opaco con `unique symbol`, asi que no se puede forjar). Si alguien añadiera un tercer
    // parametro —un `desde`, un `tiendaId`— este caso lo dice antes de que nadie lo use.
    expect(IngresosAnaliticaRepository.prototype.sumarPorCuboYCategoria).toHaveLength(2);
  });

  it("`cubos` no es un canal para colar otra ventana: el WHERE lo sigue mandando `consulta.rango`", async () => {
    // Se le pasa UN SOLO cubo, mucho mas estrecho que el rango. El reparto cambia (un limite en
    // vez de tres); lo que se LEE, no: la ventana emitida sigue siendo la del rango entero.
    const consulta = consultaDe("ingreso_flete");
    const unSoloCubo = [cubosDe(consulta)[1]];
    const { repo, fake } = repositorio();
    await repo.sumarPorCuboYCategoria(consulta, unSoloCubo);

    const { valores } = sqlEmitido(fake);
    expect(valores[0]).toEqual(unSoloCubo[0].desde);
    expect(valores).toContainEqual(consulta.rango.desde);
    expect(valores).toContainEqual(consulta.rango.hasta);
  });
});

/* -------------------------------------------------------------------------- */
/* R26 — orden estable y resultado reproducible                                */
/* -------------------------------------------------------------------------- */

describe("R26 · la secuencia de filas no depende del plan de la base", () => {
  it("pide `ORDER BY` explicito por las tres coordenadas", async () => {
    const consulta = consultaDe("ingreso_flete");
    const { repo, fake } = repositorio();
    await repo.sumarPorCuboYCategoria(consulta, cubosDe(consulta));
    expect(sqlEmitido(fake).texto).toMatch(/ORDER BY 1,\s*2,\s*3/);
  });

  it("mismo input, misma secuencia: dos ejecuciones dan exactamente lo mismo", async () => {
    const consulta = consultaDe("ingreso_flete");
    const cubos = cubosDe(consulta);
    const { repo, fake } = repositorio();

    const a = await repo.sumarPorCuboYCategoria(consulta, cubos);
    const b = await repo.sumarPorCuboYCategoria(consulta, cubos);

    expect(a).toHaveLength(3);
    expect(a).toEqual(b);
    // Y no solo el resultado: la PREGUNTA tambien es la misma, texto y parametros.
    expect(sqlEmitido(fake, 0)).toEqual(sqlEmitido(fake, 1));
    // El orden de salida respeta el de la base, sin reordenar en memoria.
    expect(a.map((f) => f.indiceCubo)).toEqual([0, 0, 2]);
  });
});

/* -------------------------------------------------------------------------- */
/* R16 — todo importe es cadena de escala 2, formateada desde Decimal          */
/* -------------------------------------------------------------------------- */

describe("R16 · el dinero sale como cadena de escala 2 y no pasa por `number`", () => {
  it("un Decimal sin decimales y otro con uno solo salen los dos con dos", async () => {
    const consulta = consultaDe("ingreso_flete");
    const { repo } = repositorio();
    const filas = await repo.sumarPorCuboYCategoria(consulta, cubosDe(consulta));

    expect(filas.map((f) => f.suma)).toEqual(["1000.00", "250.50", "7.25"]);
    for (const fila of filas) {
      expect(typeof fila.suma).toBe("string");
      expect(fila.suma).toMatch(/^-?\d+\.\d{2}$/);
    }
  });

  it("un total grande sale EXACTO: pasarlo por `number` perderia un centimo", async () => {
    // `SUM(monto)` es `numeric` sin limite de precision (la cota `Decimal(12,2)` es de la columna,
    // no del agregado), asi que un libro append-only de años llega aqui. Este importe es el que
    // separa formatear desde `Prisma.Decimal` de hacerlo desde un double: por `number` sale
    // ...99.98, un centimo menos, sin error y sin log.
    const consulta = consultaDe("ingreso_flete");
    const gordo = new Prisma.Decimal("99999999999999.99");
    const { repo } = repositorio([
      { indiceCubo: 0, categoria: "ingreso_flete", tipo: "ingreso", suma: gordo },
    ]);
    const filas = await repo.sumarPorCuboYCategoria(consulta, cubosDe(consulta));

    expect(filas[0].suma).toBe("99999999999999.99");
    expect(filas[0].suma).not.toBe(Number(gordo).toFixed(2));
    expect(Number(gordo).toFixed(2)).toBe("99999999999999.98"); // la mentira, dicha aparte
  });
});

/* -------------------------------------------------------------------------- */
/* Sin cubos no se pregunta                                                    */
/* -------------------------------------------------------------------------- */

describe("con `cubos: []` no hay ninguna coordenada a la que atribuir dinero", () => {
  it("devuelve [] y NO llega a consultar la base", async () => {
    const consulta = consultaDe("ingreso_flete");
    const { repo, fake } = repositorio();

    expect(await repo.sumarPorCuboYCategoria(consulta, [])).toEqual([]);
    // Lo que importa no es el `[]` —un WHERE roto tambien devuelve `[]`— sino que no hubo
    // consulta: no se traga ningun error, porque no hay ninguno que tragarse. Con `ARRAY[]`
    // Postgres rechazaria la consulta por un array sin tipo, que es un fallo sin significado.
    expect(fake.llamadas).toHaveLength(0);
  });

  it("y `trocear` nunca produce esa lista para un rango valido: el caso es artificial a proposito", () => {
    expect(cubosDe(consultaDe("ingreso_flete"))).not.toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* R25 — un fallo de base sube tal cual                                        */
/* -------------------------------------------------------------------------- */

describe("R25 · un fallo de la base se propaga; nunca se convierte en un cero", () => {
  it("deja subir EL MISMO error, no uno envuelto ni una lista vacia", async () => {
    // `toBe` y no `toThrow`: la identidad del objeto. Un `catch (e) { throw new Error(...) }`
    // pasaria un `toThrow` y perderia el codigo de Postgres por el camino.
    const caida = new Error("could not connect to server: Connection refused");
    const consulta = consultaDe("ingreso_flete");
    const repo = new IngresosAnaliticaRepository(fakePrismaQueFalla(caida));

    await expect(repo.sumarPorCuboYCategoria(consulta, cubosDe(consulta))).rejects.toBe(caida);
  });
});
