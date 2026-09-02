import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";

import { prepararConsultaProductos } from "@/lib/analytics/productos-consulta";
import type { ConsultaProductos } from "@/lib/analytics/productos-consulta";
import { descargaConfig } from "@/lib/config/descarga";
import { condicionesDeConsulta } from "@/lib/repositories/ConteoPorStatusRepository";
import { DineroProductosRepository } from "@/lib/repositories/DineroProductosRepository";
import { RESULTADOS_QUE_APORTAN } from "@/lib/utils/dinero-por-producto";

// FICHA 347 / B3.2 — EL `WHERE` Y LA FORMA DEL SQL DEL DINERO. Cubre R7, R24, R74, R75, R76.
//
// ⚠ QUE PRUEBA ESTE ARCHIVO Y QUE NO. Prueba que el recorte que el repositorio de DINERO manda a
// la base es EXACTAMENTE el mismo array de fragmentos que el del volumen —o sea, que el dinero
// NO escribe ninguna condicion de recorte propia (R75, y es la pieza que cierra el choque con
// `alcance-dinero.guardia`)— y que la forma del SQL es la que la ficha necesita. NO prueba que
// ese `WHERE` recorte de verdad: eso solo lo dice Postgres, y vive en
// `tests/integration/repositories/dinero-productos.int.test.ts`. En este repo esta MEDIDO que
// una mutacion del `WHERE` pasa en verde con dobles.

const AHORA = new Date("2026-09-01T12:00:00.000Z");

function consultaDe(raw: object, rol = "maestro", usuarioId = "u1"): ConsultaProductos {
  const preparada = prepararConsultaProductos(raw, { usuarioId, rol } as never, AHORA);
  if (preparada.status !== "ok") throw new Error(`filtro de prueba invalido: ${preparada.status}`);
  return preparada.consulta;
}

/** Doble del cliente Prisma que RECONSTRUYE la consulta entera, con sus parametros. */
function prismaFalso(filas: unknown[] = []) {
  const capturado = { sql: "", valores: [] as unknown[] };
  const prisma = {
    $queryRaw: (plantilla: TemplateStringsArray, ...valores: unknown[]) => {
      const consulta = Prisma.sql(plantilla, ...valores);
      capturado.sql = consulta.sql;
      capturado.valores = consulta.values;
      return Promise.resolve(filas);
    },
  };
  return { prisma, capturado };
}

async function sqlDe(consulta: ConsultaProductos, filas: unknown[] = []) {
  const { prisma, capturado } = prismaFalso(filas);
  await new DineroProductosRepository(prisma as never).leerDineroPorOrden(consulta);
  return capturado;
}

describe("R75 · el `where` del dinero es EL MISMO del volumen, fragmento a fragmento", () => {
  const CASOS: [string, object, string][] = [
    ["sin filtro, maestro", {}, "maestro"],
    ["zona", { zona_id: ["z1", "z2"] }, "maestro"],
    ["provincia", { provincia_id: ["p1"] }, "maestro"],
    ["canton", { canton_id: ["c1"] }, "maestro"],
    ["distrito", { distrito_id: ["d1"] }, "maestro"],
    ["tienda", { tienda_id: ["u1"] }, "maestro"],
    ["mensajero", { mensajero_id: ["m1", "m2"] }, "maestro"],
    ["rango", { rango: "semana" }, "maestro"],
    ["alcance de tienda", {}, "adminTienda"],
    ["todo a la vez", { zona_id: ["z1"], tienda_id: ["u1"], rango: "dia" }, "adminTienda"],
  ];

  it.each(CASOS)("«%s»: el `where` es identico al de `condicionesDeConsulta`", async (_n, raw, rol) => {
    const consulta = consultaDe(raw, rol);
    const dondeEsperado = Prisma.join(condicionesDeConsulta(consulta), " AND ");
    const { sql, valores } = await sqlDe(consulta);

    expect(sql).toContain(dondeEsperado.sql);
    // Y los PARAMETROS de la consulta entera, en su orden real: primero los resultados que
    // aportan (van en el `JOIN`, que precede al `WHERE`), luego los del `where` compartido y por
    // ultimo el `LIMIT`. Se escribe la lista completa —y no solo un `toContain`— para que un
    // parametro de mas, uno de menos o uno reordenado se vea aqui.
    expect(valores).toEqual([
      ...RESULTADOS_QUE_APORTAN,
      ...dondeEsperado.values,
      descargaConfig.MAX_FILAS + 1,
    ]);
  });

  it("R7 · el ALCANCE es la PRIMERA condicion, antes que cualquier faceta del cliente", async () => {
    const consulta = consultaDe({ zona_id: ["z1"], tienda_id: ["u1"] }, "adminTienda", "u1");
    const condiciones = condicionesDeConsulta(consulta);

    expect(condiciones[0]?.sql).toContain('o."tienda_id"');
    expect(condiciones[0]?.values).toEqual(["u1"]);

    // Y esa condicion esta EN EL SQL emitido, no aplicada en memoria despues: el `WHERE` empieza
    // por el recorte de alcance.
    const { sql, valores } = await sqlDe(consulta);
    const where = sql.slice(sql.lastIndexOf("WHERE "));
    expect(where.startsWith(`WHERE ${condiciones[0].sql}`)).toBe(true);
    expect(valores).toContain("u1");
  });

  it("R7 · el id de la tienda viaja como PARAMETRO, nunca incrustado en el texto", async () => {
    const { sql, valores } = await sqlDe(consultaDe({}, "adminTienda", "tienda-secreta-42"));
    expect(sql).not.toContain("tienda-secreta-42");
    expect(valores).toContain("tienda-secreta-42");
  });

  it("EL REPOSITORIO NO ESCRIBE NINGUNA CONDICION DE RECORTE PROPIA", async () => {
    // ⚠ Es la afirmacion que cierra el choque con `alcance-dinero.guardia`. Se mide por
    // COMPORTAMIENTO: se cuentan las apariciones de las columnas de recorte en el SQL emitido y
    // se comparan con las que produce `condicionesDeConsulta`. Una condicion escrita a mano
    // subiria el numero.
    const consulta = consultaDe({ zona_id: ["z1"], tienda_id: ["u1"] }, "adminTienda", "u1");
    const { sql } = await sqlDe(consulta);
    // Solo el `WHERE`: en la lista del `SELECT` la columna aparece como PROYECCION
    // (`o."tienda_id" AS tienda_id`), que no recorta nada.
    const where = sql.slice(sql.lastIndexOf("WHERE "));
    const donde = Prisma.join(condicionesDeConsulta(consulta), " AND ").sql;

    for (const columna of ['o."tienda_id"', 'o."zona_id"', 'o."deleted_at"']) {
      const enElWhere = where.split(columna).length - 1;
      const enElCompartido = donde.split(columna).length - 1;
      expect(enElWhere, `${columna}: el repositorio anade recorte propio`).toBe(enElCompartido);
    }
    // Y el `WHERE` entero es EXACTAMENTE el compartido: ni una condicion mas.
    expect(where.trim().split("\n")[0].trim()).toBe(`WHERE ${donde}`);
  });
});

describe("R74 · las ordenes borradas quedan fuera", () => {
  it("el `where` lleva `deleted_at IS NULL` y sale de `condicionesDeConsulta`", async () => {
    const consulta = consultaDe({}, "maestro");
    const { sql } = await sqlDe(consulta);
    expect(sql).toContain('o."deleted_at" IS NULL');
    // Y viene del `where` compartido, no de una linea escrita en este repositorio.
    expect(condicionesDeConsulta(consulta).some((c) => c.sql.includes('o."deleted_at" IS NULL'))).toBe(
      true,
    );
  });
});

describe("La forma del SQL: LATERAL, resultados, joins y orden", () => {
  it("el `LEFT JOIN LATERAL` con alias `u` esta, y es OBLIGATORIO aunque no se use el desenlace", async () => {
    // `condicionesDeConsulta` referencia `u."created_at"` en la ventana de fecha: sin el lateral
    // el SQL NO COMPILA. Se comprueba con la consulta CON rango, que es la que lo referencia.
    const conRango = consultaDe({ rango: "semana" }, "maestro");
    const { sql } = await sqlDe(conRango);

    expect(sql).toContain("LEFT JOIN LATERAL");
    expect(sql).toContain(") u ON TRUE");
    expect(sql).toContain('u."created_at"');
    // El lateral filtra las gestiones ANULADAS y desempata: es copia literal del de la 345, para
    // que la ventana temporal de las dos lecturas sea la MISMA (R78).
    expect(sql).toContain('g2."anulada_at" IS NULL');
    expect(sql).toContain('ORDER BY g2."created_at" DESC, g2."id" DESC');
  });

  it("R24 · `resultado IN (...)` sale de `RESULTADOS_QUE_APORTAN`, con un parametro por resultado", async () => {
    const { sql, valores } = await sqlDe(consultaDe({}, "maestro"));

    expect(sql).toContain('g."resultado"::text IN (');
    for (const r of RESULTADOS_QUE_APORTAN) expect(valores, r).toContain(r);
    // Y no hay ningun resultado incrustado en el texto del SQL: si alguien escribiera la lista a
    // mano en el SQL, aparecerian como literales.
    expect(sql).not.toContain("'entregada'");
    expect(sql).not.toContain("'rechazada'");
  });

  it("⟨Q3⟩ · el JOIN a `gestion_orden` EXCLUYE las anuladas", async () => {
    const { sql } = await sqlDe(consultaDe({}, "maestro"));
    // Decision del humano, con medicion: 2 gestiones anuladas con recaudo (₡33.564) y las dos
    // FUERA de todo cierre y de todo snapshot. Ese dinero nunca entro en la contabilidad.
    expect(sql).toContain('g."anulada_at" IS NULL');
    // Y esta en el JOIN de las gestiones aportantes (`g`), no solo en el lateral (`g2`).
    const [antesDelLateral] = sql.split("LEFT JOIN LATERAL");
    const trasElLateral = sql.slice(sql.indexOf(") u ON TRUE"));
    expect(antesDelLateral.length).toBeGreaterThan(0);
    expect(trasElLateral).toContain('g."anulada_at" IS NULL');
  });

  it("el cierre y el detalle entran por LEFT JOIN: lo PENDIENTE tiene que aparecer (R28)", async () => {
    const { sql } = await sqlDe(consultaDe({}, "maestro"));
    expect(sql).toContain('LEFT JOIN "cierre_dia"');
    expect(sql).toContain('LEFT JOIN "cierre_detail"');
    // El detalle se cruza por el PAR (cierre, orden): una orden en dos cierres trae dos
    // snapshots, cada uno con el suyo (R18).
    expect(sql).toContain('d."cierre_id" = g."cierre_id" AND d."orden_id" = o."id"');
    expect(sql).not.toContain('INNER JOIN "cierre_dia"');
  });

  it("R25 · el `ORDER BY` es total y estable: `o.id, g.id`", async () => {
    const { sql } = await sqlDe(consultaDe({}, "maestro"));
    // Sin el, el `LIMIT` cortaria un conjunto distinto entre dos lecturas iguales.
    expect(sql).toContain('ORDER BY o."id", g."id"');
  });

  it("el grano de la fila es `(orden, gestion)`: se proyecta el id de la gestion", async () => {
    const { sql } = await sqlDe(consultaDe({}, "maestro"));
    expect(sql).toContain('g."id"             AS gestion_id');
    expect(sql).toContain('o."id"             AS orden_id');
  });
});

describe("R76 · el tope, y que NO sale de un numero nuevo", () => {
  it("pide `tope + 1` filas: el `+1` detecta el desbordamiento sin un `COUNT` aparte", async () => {
    const { valores } = await sqlDe(consultaDe({}, "maestro"));
    // El ultimo parametro es el LIMIT.
    expect(valores[valores.length - 1]).toBe(descargaConfig.MAX_FILAS + 1);
  });

  it("⟨Q4⟩ · el tope REUSA la configuracion de la 344, no un numero propio", () => {
    // Decision del humano: no se inventa una constante nueva. `descargaConfig.MAX_FILAS` es el
    // MISMO tope con el que `DetalleMovimientoService.comoArchivo` dice `limite_excedido`, y es
    // el mismo criterio —«o van todas, o no va ninguna»— sobre el mismo tipo de conjunto.
    expect(descargaConfig.MAX_FILAS).toBe(5000);
  });

  it("si vuelven MAS filas que el tope, NO se sirve ninguna cifra", async () => {
    const demasiadas = Array.from({ length: descargaConfig.MAX_FILAS + 1 }, () => ({
      orden_id: "o1",
      tienda_id: "t1",
      tienda_nombre: "T",
      producto: "1 * X",
      num_guia: null,
      num_remision: "r1",
      destinatario: "D",
      gestion_id: "g1",
      resultado: "entregada",
      monto_recibido: null,
      cierre_estado: null,
      detalle_id: null,
    }));
    const { prisma } = prismaFalso(demasiadas);
    const lectura = await new DineroProductosRepository(prisma as never).leerDineroPorOrden(
      consultaDe({}, "maestro"),
    );

    expect(lectura).toEqual({ estado: "limite_excedido", limite: descargaConfig.MAX_FILAS });
    // ⚠ Y NO viene con filas: `limite_excedido` NUNCA lleva un dataset truncado.
    expect(lectura).not.toHaveProperty("filas");
  });

  it("justo EN el tope si se sirve: el borde del `+1` esta donde debe", async () => {
    const justas = Array.from({ length: descargaConfig.MAX_FILAS }, (_, i) => ({
      orden_id: `o${i}`,
      tienda_id: "t1",
      tienda_nombre: "T",
      producto: "1 * X",
      num_guia: null,
      num_remision: `r${i}`,
      destinatario: "D",
      gestion_id: `g${i}`,
      resultado: "entregada",
      monto_recibido: null,
      cierre_estado: null,
      detalle_id: null,
    }));
    const { prisma } = prismaFalso(justas);
    const lectura = await new DineroProductosRepository(prisma as never).leerDineroPorOrden(
      consultaDe({}, "maestro"),
    );

    expect(lectura.estado).toBe("ok");
    if (lectura.estado !== "ok") throw new Error("imposible");
    expect(lectura.filas.length).toBe(descargaConfig.MAX_FILAS);
  });
});

describe("R22 · lo que sale del repositorio ya es money-safe", () => {
  it("los importes salen como STRING escala 2 y NUNCA como number ni Decimal", async () => {
    const { prisma } = prismaFalso([
      {
        orden_id: "o1",
        tienda_id: "t1",
        tienda_nombre: "Tienda Uno",
        producto: "1 * Base C",
        num_guia: 1234,
        num_remision: "r1",
        destinatario: "D",
        gestion_id: "g1",
        resultado: "entregada",
        monto_recibido: new Prisma.Decimal("10000"),
        cierre_estado: "aprobado",
        detalle_id: "d1",
        monto_cobrar: new Prisma.Decimal("10000"),
        cobra_comision: true,
        es_central: false,
        es_zona_especial: false,
        tarifa_id: "tar1",
        tarifa_valor_flete: new Prisma.Decimal("3000"),
        tarifa_valor_flete_gam: new Prisma.Decimal("2500"),
        tarifa_valor_flete_devuelto: new Prisma.Decimal("2000"),
        tarifa_valor_flete_devuelto_gam: new Prisma.Decimal("1800"),
        tarifa_comision_cod: new Prisma.Decimal("5"),
        tarifa_iva_flete: new Prisma.Decimal("13"),
        tarifa_iva_comision_cod: new Prisma.Decimal("13"),
        tarifa_especial: null,
        tarifa_especial_devuelta: null,
      },
    ]);
    const lectura = await new DineroProductosRepository(prisma as never).leerDineroPorOrden(
      consultaDe({}, "maestro"),
    );
    if (lectura.estado !== "ok") throw new Error("imposible");
    const f = lectura.filas[0];

    // `Decimal("10000")` -> `"10000.00"`: escala 2 FIJA al cruzar la frontera, igual que hacen
    // los dos feeds del cierre. Con `toString()` saldria `"10000"`, el mismo valor con distinto
    // texto — que es exactamente lo que la feature 69 existe para eliminar.
    expect(f.montoRecibido).toBe("10000.00");
    expect(f.congelada?.montoCobrar).toBe("10000.00");
    expect(f.congelada?.tarifa?.valorFlete).toBe("3000.00");
    expect(f.congelada?.tarifa?.ivaFlete).toBe("13.00");
    // La guia es un ENTERO de identificacion, no dinero: cruza como texto sin escala.
    expect(f.guia).toBe("1234");
    expect(f.numGuia).toBe(1234);
  });

  it("sin fila de snapshot, `congelada` es `null` (no un objeto con ceros)", async () => {
    const { prisma } = prismaFalso([
      {
        orden_id: "o1",
        tienda_id: "t1",
        tienda_nombre: "T",
        producto: "1 * X",
        num_guia: null,
        num_remision: "r-9",
        destinatario: "D",
        gestion_id: "g1",
        resultado: "entregada",
        monto_recibido: null,
        cierre_estado: null,
        detalle_id: null,
      },
    ]);
    const lectura = await new DineroProductosRepository(prisma as never).leerDineroPorOrden(
      consultaDe({}, "maestro"),
    );
    if (lectura.estado !== "ok") throw new Error("imposible");

    expect(lectura.filas[0].congelada).toBeNull();
    expect(lectura.filas[0].montoRecibido).toBeNull();
    // Sin guia, el numero visible es la REMISION (R36).
    expect(lectura.filas[0].guia).toBe("r-9");
  });
});
