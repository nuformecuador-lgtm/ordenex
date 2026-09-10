import { describe, it, expect, vi } from "vitest";

import {
  claveDeCicloVida,
  claveDeCohorteCarga,
  claveDeConteoCargadasPorDia,
  claveDeConteoDevoluciones,
  claveDeConteoEntregas,
  claveDeConteoHoyGestion,
  claveDeConteoPorStatus,
  prepararConteoEntregas,
  TAG_COHORTE_CARGA,
  type ConsultaConteoEntregas,
} from "@/lib/analytics/entregas-conteo";
import {
  claveDeConteoProductos,
  prepararConsultaProductos,
} from "@/lib/analytics/productos-consulta";
import { resolverRango } from "@/lib/analytics/ranges";
import { CohorteCargaService, promedioDeCubo } from "@/lib/services/CohorteCargaService";
import type { IAnaliticaCache } from "@/lib/interfaces/external/IAnaliticaCache";
import type {
  CohorteCuboCrudo,
  ICohorteCargaRepository,
} from "@/lib/interfaces/repositories/ICohorteCargaRepository";

// Ficha 411 / T5.1 y T1.3 — el SERVICIO de la cohorte y su clave de cache, con dobles.
//
// Lo que este archivo mide vive todo fuera del SQL: la agregacion, los derivados, el sello y la
// clave. Lo que NO mide —y no puede— es la consulta: eso es `tests/integration/db/cohorte-*`.

const AHORA = new Date("2026-08-17T12:00:00.000Z");
const RANGO = { rango: "personalizado" as const, desde: "2026-08-10", hasta: "2026-08-16" };

function consultaDe(raw: object = {}, rol = "maestro", extra: object = {}): ConsultaConteoEntregas {
  const preparada = prepararConteoEntregas(
    { ...RANGO, ...raw },
    { usuarioId: "u1", rol, ...extra } as never,
    AHORA,
  );
  if (preparada.status !== "ok") throw new Error(`filtro de prueba invalido: ${preparada.status}`);
  return preparada.consulta;
}

function repoQueDevuelve(filas: CohorteCuboCrudo[]): ICohorteCargaRepository {
  return { contarCohortes: vi.fn().mockResolvedValue(filas) };
}

/** Cache de mentira con memoria real: sirve lo guardado sin re-ejecutar el productor. */
function cacheConMemoria() {
  const entradas = new Map<string, unknown>();
  const tags: string[][] = [];
  const cache: IAnaliticaCache = {
    async envolver(clave, tagsDeLaEntrada, producir) {
      tags.push([...tagsDeLaEntrada]);
      if (entradas.has(clave)) return entradas.get(clave) as never;
      const valor = await producir();
      entradas.set(clave, valor);
      return valor;
    },
    async invalidar() {},
  };
  return { cache, entradas, tags };
}

/** Dos dias, con la cohorte mas reciente PRIMERO, como los emite el repositorio. */
const FILAS: CohorteCuboCrudo[] = [
  { fecha: "2026-08-16", desenlace: "entregada", n: 2, segundosAcum: 6 * 3600 },
  { fecha: "2026-08-16", desenlace: "viva", n: 3, segundosAcum: null },
  { fecha: "2026-08-15", desenlace: "devuelta_a_tienda", n: 1, segundosAcum: 4 * 3600 },
  { fecha: "2026-08-15", desenlace: "entregada", n: 4, segundosAcum: 8 * 3600 },
];

function servicioCon(filas: CohorteCuboCrudo[], reloj: () => Date = () => AHORA) {
  const memoria = cacheConMemoria();
  return {
    service: new CohorteCargaService(repoQueDevuelve(filas), memoria.cache, { now: reloj }),
    ...memoria,
  };
}

/* -------------------------------------------------------------------------- */
/* El promedio                                                                 */
/* -------------------------------------------------------------------------- */

describe("R17 · el promedio se DERIVA, y su ausencia no es un cero", () => {
  it("divide el numerador entre el denominador", () => {
    expect(promedioDeCubo(6 * 3600, 2)).toBe(3 * 3600);
  });

  // ⚠ `null` Y NO CERO, por los dos motivos. Cero segundos es una AFIRMACION —«cerraron al
  // instante»— y lo que pasa es que no hay reloj que parar o no hay a quien dividir.
  it("sin numerador es `null`: el cubo `viva` no tiene reloj", () => {
    expect(promedioDeCubo(null, 5)).toBeNull();
  });

  it("sin denominador es `null`, nunca cero", () => {
    expect(promedioDeCubo(0, 0)).toBeNull();
    expect(promedioDeCubo(100, 0)).toBeNull();
  });

  // No se redondea: redondear aqui le quita al consumidor la posibilidad de elegir unidad
  // (segundos, horas, dias) sin arrastrar el error.
  it("no redondea", () => {
    expect(promedioDeCubo(10, 3)).toBeCloseTo(3.3333, 3);
  });
});

/* -------------------------------------------------------------------------- */
/* La forma del DTO                                                            */
/* -------------------------------------------------------------------------- */

describe("R15 · el DTO lleva numerador Y denominador, no solo el promedio", () => {
  it("cada cubo trae `n`, `segundosAcum` y `promedioSegundos`", async () => {
    const { service } = servicioCon(FILAS);

    const dto = await service.consultar(consultaDe());
    const cubo = dto.porDia[0].cubos[0];

    expect(cubo).toEqual({
      desenlace: "entregada",
      n: 2,
      segundosAcum: 6 * 3600,
      promedioSegundos: 3 * 3600,
    });
    // Dos recortes se vuelven a agregar sumando numeradores y denominadores. Sin el numerador
    // crudo eso es imposible: promediar promedios da un numero que no corresponde a nada.
    expect(cubo.segundosAcum).not.toBeUndefined();
  });

  it("el cubo `viva` trae el numerador y el promedio AUSENTES, no en cero", async () => {
    const { service } = servicioCon(FILAS);

    const viva = (await service.consultar(consultaDe())).porDia[0].cubos.find(
      (c) => c.desenlace === "viva",
    );

    expect(viva?.n).toBe(3);
    expect(viva?.segundosAcum).toBeNull();
    expect(viva?.promedioSegundos).toBeNull();
  });

  it("un dia sin ninguna cerrada no inventa un promedio de cero", async () => {
    const { service } = servicioCon([
      { fecha: "2026-08-16", desenlace: "viva", n: 7, segundosAcum: null },
    ]);

    const dto = await service.consultar(consultaDe());

    expect(dto.porDia[0].cargadas).toBe(7);
    expect(dto.porDia[0].cubos[0].promedioSegundos).toBeNull();
    expect(dto.totalPorDesenlace[0].promedioSegundos).toBeNull();
  });
});

describe("R11/R30 · los totales se derivan de las MISMAS filas", () => {
  it("`cargadas` es la suma exacta de los cubos del dia", async () => {
    const { service } = servicioCon(FILAS);

    const dto = await service.consultar(consultaDe());

    expect(dto.porDia.map((d) => [d.fecha, d.cargadas])).toEqual([
      ["2026-08-16", 5],
      ["2026-08-15", 5],
    ]);
    for (const dia of dto.porDia) {
      expect(dia.cubos.reduce((suma, c) => suma + c.n, 0)).toBe(dia.cargadas);
    }
  });

  it("`total` es la suma de las cargadas, no una segunda consulta", async () => {
    const { service } = servicioCon(FILAS);
    const dto = await service.consultar(consultaDe());

    expect(dto.total).toBe(10);
    expect(dto.total).toBe(dto.porDia.reduce((suma, d) => suma + d.cargadas, 0));
  });

  it("`totalPorDesenlace` agrega los mismos cubos sobre todos los dias", async () => {
    const { service } = servicioCon(FILAS);

    const dto = await service.consultar(consultaDe());

    expect(dto.totalPorDesenlace).toEqual([
      { desenlace: "devuelta_a_tienda", n: 1, segundosAcum: 4 * 3600, promedioSegundos: 4 * 3600 },
      { desenlace: "entregada", n: 6, segundosAcum: 14 * 3600, promedioSegundos: (14 / 6) * 3600 },
      { desenlace: "viva", n: 3, segundosAcum: null, promedioSegundos: null },
    ]);
    // Y suma el mismo universo que los dias: si saliera de otra consulta, podrian discrepar.
    expect(dto.totalPorDesenlace.reduce((suma, c) => suma + c.n, 0)).toBe(dto.total);
  });

  // El repositorio nunca emite un grupo vacio (`GROUP BY` no puede), pero el contrato del DTO
  // dice que un hueco significa cero — y la pantalla, que si conoce los cuatro cubos, los
  // rellena. Que el servicio no los fabrique se comprueba, no se supone.
  it("los cubos con `n = 0` no viajan, y tampoco se inventan los que faltan", async () => {
    const { service } = servicioCon([
      { fecha: "2026-08-16", desenlace: "entregada", n: 3, segundosAcum: 3600 },
      { fecha: "2026-08-16", desenlace: "incidente", n: 0, segundosAcum: null },
    ]);

    const dto = await service.consultar(consultaDe());

    expect(dto.porDia[0].cubos.map((c) => c.desenlace)).toEqual(["entregada"]);
    expect(dto.porDia[0].cargadas).toBe(3);
    expect(dto.totalPorDesenlace.map((c) => c.desenlace)).toEqual(["entregada"]);
  });
});

describe("R6 · el servicio NO reordena", () => {
  // El orden lo decide el `ORDER BY` del repositorio, en un solo sitio. Si el servicio ordenara
  // tambien, habria dos criterios y la tabla se pintaria distinto segun quien la tocara al final.
  it("conserva el orden descendente tal y como llega", async () => {
    const { service } = servicioCon(FILAS);

    const dto = await service.consultar(consultaDe());

    expect(dto.porDia.map((d) => d.fecha)).toEqual(["2026-08-16", "2026-08-15"]);
  });

  it("si el repositorio devolviera otro orden, el servicio lo respeta igual", async () => {
    // Anti-vacio del caso anterior: si el servicio ordenara por su cuenta, este caso saldria
    // igual que el de arriba y el primero no estaria demostrando nada.
    const { service } = servicioCon([...FILAS].reverse());

    const dto = await service.consultar(consultaDe());

    expect(dto.porDia.map((d) => d.fecha)).toEqual(["2026-08-15", "2026-08-16"]);
  });
});

/* -------------------------------------------------------------------------- */
/* El sello y la cache                                                         */
/* -------------------------------------------------------------------------- */

describe("R27 · `lastSync` se sella DENTRO del productor", () => {
  it("dos lecturas de la MISMA entrada llevan el mismo sello", async () => {
    let tic = 0;
    const relojQueAvanza = () => new Date(AHORA.getTime() + tic++ * 60_000);
    const { service } = servicioCon(FILAS, relojQueAvanza);
    const consulta = consultaDe();

    const primera = await service.consultar(consulta);
    const segunda = await service.consultar(consulta);

    // Si el sello se pusiera FUERA del productor, la segunda llevaria la hora del render y la
    // pantalla juraria que la cifra es de este segundo llevando hasta 15 minutos de retraso.
    expect(segunda.lastSync).toBe(primera.lastSync);
    expect(primera.lastSync).toBe("2026-08-17T12:00:00.000Z");
  });

  it("una consulta DISTINTA vuelve a producir, y sella de nuevo", async () => {
    // Anti-vacio: si el reloj no avanzara, el caso de arriba pasaria pase lo que pase.
    let tic = 0;
    const relojQueAvanza = () => new Date(AHORA.getTime() + tic++ * 60_000);
    const { service } = servicioCon(FILAS, relojQueAvanza);

    const primera = await service.consultar(consultaDe());
    const otra = await service.consultar(consultaDe({ zona_id: ["z9"] }));

    expect(otra.lastSync).not.toBe(primera.lastSync);
  });

  it("la entrada se guarda bajo el tag propio de esta vertical", async () => {
    const { service, tags } = servicioCon(FILAS);

    await service.consultar(consultaDe());

    expect(tags[0]).toEqual([TAG_COHORTE_CARGA]);
  });
});

/* -------------------------------------------------------------------------- */
/* La clave (T1.3 / R28)                                                       */
/* -------------------------------------------------------------------------- */

describe("R28 · la clave lleva prefijo PROPIO y el alcance dentro", () => {
  it("empieza por su propio tag", () => {
    expect(claveDeCohorteCarga(consultaDe()).startsWith(TAG_COHORTE_CARGA)).toBe(true);
  });

  // ⚠ NO ES COSMETICA. Las ocho lecturas comparten `ConsultaConteoEntregas` entera —el filtro es
  // identico a proposito, para que la barra las mueva a todas a la vez— asi que sin prefijo
  // producirian LA MISMA CLAVE con valores de FORMA DISTINTA: quien pidiera la cohorte recibiria
  // el `porDesenlace` que dejo el anillo. No es una cifra equivocada, es un objeto de otro tipo
  // llegando a un consumidor que no lo espera.
  it("difiere de las otras SIETE con la MISMA consulta", () => {
    const consulta = consultaDe({ tienda_id: ["t1"] });
    const productos = prepararConsultaProductos(
      { ...RANGO, tienda_id: ["t1"] },
      { usuarioId: "u1", rol: "maestro" } as never,
      AHORA,
    );
    if (productos.status !== "ok") throw new Error("filtro de productos invalido");

    const cohorte = claveDeCohorteCarga(consulta);
    const otras = [
      claveDeConteoEntregas(consulta),
      claveDeConteoPorStatus(consulta),
      claveDeConteoCargadasPorDia(consulta),
      claveDeConteoHoyGestion(consulta, resolverRango({ preset: "dia" }, AHORA)),
      claveDeConteoDevoluciones(consulta),
      claveDeCicloVida(consulta),
      claveDeConteoProductos(productos.consulta),
    ];

    expect(otras).toHaveLength(7);
    for (const clave of otras) expect(cohorte).not.toBe(clave);
    expect(new Set([...otras, cohorte]).size).toBe(otras.length + 1);
  });

  // Una clave que no distingue el alcance no da una cifra equivocada: FILTRA DATOS ENTRE ROLES.
  it("dos actores con alcance distinto no comparten entrada", () => {
    const maestro = claveDeCohorteCarga(consultaDe({ tienda_id: ["u1"] }, "maestro"));
    const tienda = claveDeCohorteCarga(consultaDe({}, "adminTienda", { usuarioId: "u1" }));

    expect(maestro).not.toBe(tienda);
  });

  it("el rango RESUELTO entra en la clave, y nunca el centinela `*`", () => {
    const clave = claveDeCohorteCarga(consultaDe());

    expect(clave).toContain("d=2026-08-10");
    expect(clave).toContain("h=2026-08-16");
    // Esta lectura EXIGE rango: el borde responde `sin_rango` antes de mirar la cache, asi que
    // los componentes de fecha no pueden valer el centinela de «sin ventana».
    expect(clave).not.toContain("d=*");
    expect(clave).not.toContain("h=*");
  });

  it("el filtro entra en la clave: cambiarlo cambia la clave", () => {
    expect(claveDeCohorteCarga(consultaDe({ zona_id: ["z1"] }))).not.toBe(
      claveDeCohorteCarga(consultaDe({ zona_id: ["z2"] })),
    );
  });
});
