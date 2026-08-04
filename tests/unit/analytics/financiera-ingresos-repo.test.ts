import { describe, it, expect } from "vitest";
import { prepararConsultaAnalitica } from "@/lib/analytics/consulta";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type { ActorAnalitica } from "@/lib/analytics/alcance";
import { getMetrica } from "@/lib/analytics/metrics";
import { IngresosAnaliticaRepository } from "@/lib/repositories/IngresosAnaliticaRepository";
import { fakePrismaDinero, type FilaCaja } from "./_fake-prisma-dinero";

// Feature 127 / T C.1 — `IngresosAnaliticaRepository`: R16, R17, R26, R28, R37 (material).
//
// Los dos "hecho cuando" de la tarea estan escritos como MUTACIONES, y asi se prueban:
//   1. un `ingreso_ajuste` DENTRO del rango no puede aparecer en `ingreso_flete`;
//   2. alterar `definicion.categorias` en memoria SI tiene que cambiar la consulta.
// El segundo es el que distingue "el catalogo manda" de "el catalogo describe": con la lista
// clavada en el repositorio, el test 2 sigue viendo el resultado viejo.
//
// La base es el fake de `_fake-prisma-dinero.ts`, que EJECUTA el `where` y el `orderBy` en vez
// de devolver lo esperado. Sin eso, quitarle el filtro de fecha al repositorio no pondria nada
// rojo, que es como se escriben las aserciones vacias.

const MAESTRO: ActorAnalitica = { usuarioId: "u-maestro", rol: "maestro" };
/** 09:00 de Costa Rica del 2026-08-02 → la ventana del preset `dia` es ese dia natural CR. */
const AHORA = new Date("2026-08-02T15:00:00.000Z");
const DESDE = new Date("2026-08-02T06:00:00.000Z");
const HASTA = new Date("2026-08-03T06:00:00.000Z");

function consultaDe(metricaId: string): ConsultaAnalitica {
  const r = prepararConsultaAnalitica({ rango: "dia" }, MAESTRO, metricaId, AHORA);
  if (r.status !== "ok") throw new Error(`no se pudo preparar la consulta de ${metricaId}`);
  return r.consulta;
}

/* -------------------------------------------------------------------------- */
/* El libro de la caja principal                                               */
/* -------------------------------------------------------------------------- */

/**
 * Cada fila esta aqui por un motivo, y varias estan para NO aparecer en el resultado. Si el
 * repositorio dejara de filtrar, las de abajo inflarian las cifras y los tests lo verian: no hay
 * forma de que este archivo pase por conjunto vacio (hay un caso dedicado a comprobarlo).
 */
const LIBRO: readonly FilaCaja[] = [
  // Dentro del rango y de `ingreso_flete`.
  { categoria: "ingreso_flete", tipo: "ingreso", monto: "1000.00", fechaMovimiento: new Date("2026-08-02T12:00:00.000Z") },
  // Borde INFERIOR, inclusivo: 00:00 de Costa Rica. Tiene que entrar.
  { categoria: "ingreso_flete", tipo: "ingreso", monto: "5.00", fechaMovimiento: DESDE },
  { categoria: "ingreso_flete_devolucion", tipo: "ingreso", monto: "250.50", fechaMovimiento: new Date("2026-08-02T20:00:00.000Z") },
  // LA MUTACION DE R16: un ajuste del mismo dia que NO es flete.
  { categoria: "ingreso_ajuste", tipo: "ingreso", monto: "999.99", fechaMovimiento: new Date("2026-08-02T13:00:00.000Z") },
  // Dia anterior: fuera.
  { categoria: "ingreso_flete", tipo: "ingreso", monto: "777.00", fechaMovimiento: new Date("2026-08-01T20:00:00.000Z") },
  // LAS 22:00 DE COSTA RICA DEL DIA ANTERIOR (= 04:00 UTC de hoy). Es del dia 1, no del 2. Una
  // ventana construida con la medianoche UTC en vez de con `rango.desde` se lo tragaria: es el
  // off-by-one de seis horas que R26 declara como mutacion.
  { categoria: "ingreso_flete", tipo: "ingreso", monto: "22.00", fechaMovimiento: new Date("2026-08-02T04:00:00.000Z") },
  // Borde SUPERIOR, exclusivo: 00:00 CR del dia siguiente. Fuera.
  { categoria: "ingreso_flete", tipo: "ingreso", monto: "888.00", fechaMovimiento: HASTA },
  // Egresos del mismo dia (para `egresos`, R18 material).
  { categoria: "egreso_indemnizacion", tipo: "egreso", monto: "300.00", fechaMovimiento: new Date("2026-08-02T10:00:00.000Z") },
  { categoria: "egreso_ajuste", tipo: "egreso", monto: "100.00", fechaMovimiento: new Date("2026-08-02T11:00:00.000Z") },
  { categoria: "ingreso_comision_cod", tipo: "ingreso", monto: "60.00", fechaMovimiento: new Date("2026-08-02T11:00:00.000Z") },
];

function repositorio(filas: readonly FilaCaja[] = LIBRO) {
  const fake = fakePrismaDinero({ caja: filas });
  return { repo: new IngresosAnaliticaRepository(fake.cliente), fake };
}

/* -------------------------------------------------------------------------- */
/* R16 — exactamente las categorias declaradas, exactamente la ventana         */
/* -------------------------------------------------------------------------- */

describe("R16 · la caja principal agrega solo lo que la metrica declara y solo del rango", () => {
  it("`ingreso_flete` suma sus dos categorias y NO ve el ingreso_ajuste del mismo dia", async () => {
    const { repo } = repositorio();
    const filas = await repo.sumarPorCategoria(consultaDe("ingreso_flete"));

    expect(filas).toEqual([
      { categoria: "ingreso_flete", tipo: "ingreso", suma: "1005.00" },
      { categoria: "ingreso_flete_devolucion", tipo: "ingreso", suma: "250.50" },
    ]);
    // La mutacion que R16 declara, dicha aparte para que el motivo del rojo sea legible.
    expect(filas.map((f) => f.categoria)).not.toContain("ingreso_ajuste");
    expect(filas.map((f) => f.suma)).not.toContain("999.99");
  });

  it("la ventana es semiabierta: entra el de las 00:00 CR y no el de las 00:00 del dia siguiente", async () => {
    const { repo, fake } = repositorio();
    const filas = await repo.sumarPorCategoria(consultaDe("ingreso_flete"));

    // 1000 + 5 = 1005: el borde inferior SI, el superior NO (si entrara, serian 1893.00), y el
    // de las 22:00 CR de ayer tampoco (con la medianoche UTC serian 1027.00).
    expect(filas[0].suma).toBe("1005.00");
    const where = fake.llamadas[0].args.where as { fechaMovimiento: Record<string, Date> };
    expect(where.fechaMovimiento.gte).toEqual(DESDE);
    expect(where.fechaMovimiento.lt).toEqual(HASTA);
    // R26: la ventana llega de `resolverRango`; el repositorio no construye ninguna fecha.
    expect(where.fechaMovimiento).not.toHaveProperty("lte");
  });

  it("`ingreso_comision_cod` (una sola categoria) no arrastra las de flete", async () => {
    const { repo } = repositorio();
    expect(await repo.sumarPorCategoria(consultaDe("ingreso_comision_cod"))).toEqual([
      { categoria: "ingreso_comision_cod", tipo: "ingreso", suma: "60.00" },
    ]);
  });

  it("`egresos` ve sus ocho categorias, incluida la indemnizacion (R18, material)", async () => {
    const { repo } = repositorio();
    const filas = await repo.sumarPorCategoria(consultaDe("egresos"));

    expect(filas).toEqual([
      { categoria: "egreso_ajuste", tipo: "egreso", suma: "100.00" },
      { categoria: "egreso_indemnizacion", tipo: "egreso", suma: "300.00" },
    ]);
    expect(filas.map((f) => f.categoria)).toContain("egreso_indemnizacion");
  });

  it("el material del bruto y del neto llega desglosado por tipo (R37)", async () => {
    // Un ingreso y su contraasiento de egreso en la MISMA categoria: el repositorio no los
    // cancela (eso es del servicio), los devuelve como dos filas con su `tipo`.
    const { repo } = repositorio([
      { categoria: "egreso_ajuste", tipo: "egreso", monto: "400.00", fechaMovimiento: new Date("2026-08-02T09:00:00.000Z") },
      { categoria: "egreso_ajuste", tipo: "ingreso", monto: "400.00", fechaMovimiento: new Date("2026-08-02T10:00:00.000Z") },
    ]);
    const filas = await repo.sumarPorCategoria(consultaDe("egresos"));

    expect(filas).toHaveLength(2);
    expect(new Set(filas.map((f) => f.tipo))).toEqual(new Set(["ingreso", "egreso"]));
    expect(filas.every((f) => f.suma === "400.00")).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* R17 — el catalogo MANDA: alterarlo cambia la consulta                       */
/* -------------------------------------------------------------------------- */

describe("R17 · las categorias salen del catalogo, no de un array escrito en el repositorio", () => {
  it("alterar `definicion.categorias` en memoria cambia lo que la consulta devuelve", async () => {
    const metrica = getMetrica("ingreso_flete");
    if (metrica === undefined) throw new Error("el catalogo perdio ingreso_flete");
    const definicion = metrica.definicion as { categorias?: readonly string[] };
    const original = definicion.categorias;

    const { repo } = repositorio();
    const antes = await repo.sumarPorCategoria(consultaDe("ingreso_flete"));

    try {
      definicion.categorias = ["ingreso_ajuste"];
      const despues = await repo.sumarPorCategoria(consultaDe("ingreso_flete"));

      // Con la lista clavada en el repositorio, `despues` seria igual a `antes`.
      expect(despues).toEqual([
        { categoria: "ingreso_ajuste", tipo: "ingreso", suma: "999.99" },
      ]);
      expect(despues).not.toEqual(antes);
    } finally {
      definicion.categorias = original;
    }

    // El catalogo queda como estaba: este test no puede contaminar a los demas.
    expect(getMetrica("ingreso_flete")?.definicion.categorias).toEqual(original);
    expect(await repo.sumarPorCategoria(consultaDe("ingreso_flete"))).toEqual(antes);
  });

  it("una metrica que declara categorias ajenas a la caja NO se sirve en silencio", async () => {
    // `cod_recaudado` declara `efectivo`/`SINPE`/`transferencia`, que no son de esta tabla.
    // Servirla filtrando lo que no encaje devolveria una cifra corta sin que nada fallara.
    const { repo } = repositorio();
    await expect(repo.sumarPorCategoria(consultaDe("cod_recaudado"))).rejects.toThrow(
      /categorias que la caja principal no tiene/,
    );
  });

  it("una metrica sin categorias no agrega el libro entero", async () => {
    const { repo } = repositorio();
    await expect(repo.sumarPorCategoria(consultaDe("conciliacion_cierres"))).rejects.toThrow(
      /no declara categorias/,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Feature 173 (T F.4) — las dos metricas de la caja, con este mismo repositorio */
/* -------------------------------------------------------------------------- */

/**
 * Un libro con las tres clases de dinero a la vez. Va en su PROPIO fixture y no dentro de
 * `LIBRO`: aquel tiene aserciones exactas sobre `egresos`, y meterle un `egreso_pago_tienda`
 * las cambiaria sin que este bloque tuviera nada que ver.
 */
const LIBRO_TESORERIA: readonly FilaCaja[] = [
  { categoria: "ingreso_flete", tipo: "ingreso", monto: "1000.00", fechaMovimiento: new Date("2026-08-02T12:00:00.000Z") },
  { categoria: "egreso_sueldo", tipo: "egreso", monto: "400.00", fechaMovimiento: new Date("2026-08-02T12:00:00.000Z") },
  // Dinero de TERCEROS: entra al aprobar el cierre y sale al pagarle a la tienda.
  { categoria: "ingreso_cod_recaudado", tipo: "ingreso", monto: "5000.00", fechaMovimiento: new Date("2026-08-02T13:00:00.000Z") },
  { categoria: "egreso_pago_tienda", tipo: "egreso", monto: "3000.00", fechaMovimiento: new Date("2026-08-02T14:00:00.000Z") },
  { categoria: "ingreso_reverso_pago_tienda", tipo: "ingreso", monto: "200.00", fechaMovimiento: new Date("2026-08-02T15:00:00.000Z") },
  // Fuera de la ventana: la metrica nueva no se salta el rango por ser nueva.
  { categoria: "ingreso_cod_recaudado", tipo: "ingreso", monto: "999.00", fechaMovimiento: new Date("2026-08-01T12:00:00.000Z") },
];

describe("R57 · las dos metricas de la 173 salen de este repositorio, con sus categorias", () => {
  it("`dinero_en_caja` ve el dinero de terceros ademas del propio, y respeta la ventana", async () => {
    const { repo } = repositorio(LIBRO_TESORERIA);
    const filas = await repo.sumarPorCategoria(consultaDe("dinero_en_caja"));

    expect(filas).toEqual([
      { categoria: "egreso_pago_tienda", tipo: "egreso", suma: "3000.00" },
      { categoria: "egreso_sueldo", tipo: "egreso", suma: "400.00" },
      { categoria: "ingreso_cod_recaudado", tipo: "ingreso", suma: "5000.00" },
      { categoria: "ingreso_flete", tipo: "ingreso", suma: "1000.00" },
      { categoria: "ingreso_reverso_pago_tienda", tipo: "ingreso", suma: "200.00" },
    ]);
    // Los 999.00 del dia anterior NO estan: la ventana sigue mandando.
    expect(filas.map((f) => f.suma)).not.toContain("5999.00");
  });

  it("`ganancia_ordenex` no llega a ver el dinero de terceros: lo excluye ya el WHERE", async () => {
    const { repo, fake } = repositorio(LIBRO_TESORERIA);
    const filas = await repo.sumarPorCategoria(consultaDe("ganancia_ordenex"));

    expect(filas).toEqual([
      { categoria: "egreso_sueldo", tipo: "egreso", suma: "400.00" },
      { categoria: "ingreso_flete", tipo: "ingreso", suma: "1000.00" },
    ]);
    // Y las tres categorias de terceros ni siquiera se le piden a la base (R17: manda el
    // catalogo). La proteccion es doble —aqui el `where`, y en el servicio `derivarCaja`—, y
    // esta es la que se mide donde vive: en el WHERE.
    const where = fake.llamadas[0].args.where as { categoria: { in: string[] } };
    expect(where.categoria.in).not.toContain("ingreso_cod_recaudado");
    expect(where.categoria.in).not.toContain("egreso_pago_tienda");
    expect(where.categoria.in).not.toContain("ingreso_reverso_pago_tienda");
    expect(where.categoria.in).toHaveLength(14);
  });

  it("y la validacion sigue reventando si una de ellas declarara una categoria ajena", async () => {
    // R57 — la misma comprobacion que protege a las cuatro de la 127, ejercida sobre una de las
    // nuevas: `cod_recaudado` es del ledger de TIENDA, no de la caja. Servirla filtrando lo que
    // no encaje daria una cifra corta sin que nada fallara.
    const metrica = getMetrica("dinero_en_caja");
    if (metrica === undefined) throw new Error("el catalogo perdio dinero_en_caja");
    const definicion = metrica.definicion as { categorias?: readonly string[] };
    const original = definicion.categorias;

    const { repo } = repositorio(LIBRO_TESORERIA);
    try {
      definicion.categorias = [...(original ?? []), "cod_recaudado"];
      await expect(repo.sumarPorCategoria(consultaDe("dinero_en_caja"))).rejects.toThrow(
        /categorias que la caja principal no tiene: cod_recaudado/,
      );
    } finally {
      definicion.categorias = original;
    }

    // El catalogo queda como estaba y la consulta vuelve a servirse.
    expect(getMetrica("dinero_en_caja")?.definicion.categorias).toEqual(original);
    expect((await repo.sumarPorCategoria(consultaDe("dinero_en_caja"))).length).toBe(5);
  });

  it("el fixture de tesoreria no es inocuo: lleva las tres categorias de terceros", () => {
    const categorias = new Set(LIBRO_TESORERIA.map((f) => f.categoria));
    expect(categorias.has("ingreso_cod_recaudado")).toBe(true);
    expect(categorias.has("egreso_pago_tienda")).toBe(true);
    expect(categorias.has("ingreso_reverso_pago_tienda")).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* R28 — orden estable                                                         */
/* -------------------------------------------------------------------------- */

describe("R28 · la secuencia de filas no depende del plan de la base", () => {
  it("pide orden explicito por (categoria, tipo) y dos corridas dan lo mismo", async () => {
    const { repo, fake } = repositorio();
    const a = await repo.sumarPorCategoria(consultaDe("ingreso_flete"));
    const b = await repo.sumarPorCategoria(consultaDe("ingreso_flete"));

    expect(a.length).toBeGreaterThan(1);
    expect(a).toEqual(b);
    expect(fake.llamadas[0].args.orderBy).toEqual([{ categoria: "asc" }, { tipo: "asc" }]);
  });
});

/* -------------------------------------------------------------------------- */
/* El fixture no esta vacio, y lo excluido existe de verdad                    */
/* -------------------------------------------------------------------------- */

describe("los tests de arriba no pasan por conjunto vacio", () => {
  it("el libro tiene filas y las que deben quedar FUERA estan sembradas", () => {
    expect(LIBRO.length).toBeGreaterThanOrEqual(8);
    expect(LIBRO.some((f) => f.categoria === "ingreso_ajuste")).toBe(true);
    expect(LIBRO.some((f) => f.fechaMovimiento < DESDE)).toBe(true);
    // La de las 22:00 CR de ayer, que es la que separa `rango.desde` de la medianoche UTC.
    expect(
      LIBRO.some((f) => f.fechaMovimiento.toISOString() === "2026-08-02T04:00:00.000Z"),
    ).toBe(true);
    expect(LIBRO.some((f) => f.fechaMovimiento.getTime() === HASTA.getTime())).toBe(true);
  });

  it("y la consulta que las excluye devuelve filas, no una lista vacia", async () => {
    const { repo } = repositorio();
    expect((await repo.sumarPorCategoria(consultaDe("ingreso_flete"))).length).toBe(2);
    expect((await repo.sumarPorCategoria(consultaDe("egresos"))).length).toBe(2);
  });
});
