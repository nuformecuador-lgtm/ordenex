import { describe, it, expect } from "vitest";

import { claveDeConteoProductos, prepararConsultaProductos } from "@/lib/analytics/productos-consulta";
import type { ConsultaProductos } from "@/lib/analytics/productos-consulta";
import { TAG_CONTEO_PRODUCTOS } from "@/lib/analytics/productos-consulta";
import { ConteoProductosService, fundir } from "@/lib/services/ConteoProductosService";
import type {
  FilaProductoCruda,
  IConteoProductosRepository,
} from "@/lib/interfaces/repositories/IConteoProductosRepository";
import { cacheFalsa } from "./_cache-falsa";

// Ficha 345 / T4.3 — LA FUSION (R18, R24, R25, R26, R31, R33, R34, R35, R37, R38, R58).
//
// La base agrupa por `(tienda, texto CRUDO, desenlace)`; el servicio interpreta el texto y funde.
// Aqui se prueba esa aritmetica con dobles del repositorio y de la cache, que es donde vive: el
// `WHERE` NO se prueba aqui (los dobles no ven el SQL) sino contra Postgres.

const AHORA = new Date("2026-09-01T12:00:00.000Z");

function consultaDe(raw: object = {}, rol = "maestro", usuarioId = "u1"): ConsultaProductos {
  const preparada = prepararConsultaProductos(raw, { usuarioId, rol } as never, AHORA);
  if (preparada.status !== "ok") throw new Error(`filtro de prueba invalido: ${preparada.status}`);
  return preparada.consulta;
}

function fila(
  producto: string,
  status = "entregada",
  n = 1,
  tiendaId = "t1",
  tiendaNombre = "Tienda Uno",
): FilaProductoCruda {
  return { tiendaId, tiendaNombre, producto, status, n };
}

function repoFalso(filas: FilaProductoCruda[]): IConteoProductosRepository & { llamadas: number } {
  return {
    llamadas: 0,
    async contarProductos() {
      this.llamadas += 1;
      return filas;
    },
  } as IConteoProductosRepository & { llamadas: number };
}

describe("R24 / R25 · unidades y ordenes", () => {
  it("las unidades son la suma de las cantidades; las ordenes, cuantas ordenes lo llevan", () => {
    const { filas } = fundir([
      fila("2 * Creatina Monohidratada", "entregada", 3),
      fila("1 * Creatina Monohidratada", "rechazada", 2),
    ]);

    expect(filas).toHaveLength(1);
    // 2 unidades x 3 ordenes + 1 unidad x 2 ordenes = 8
    expect(filas[0].unidades).toBe(8);
    expect(filas[0].ordenes).toBe(5);
    expect(filas[0].producto).toBe("Creatina Monohidratada");
  });

  it("la cantidad multiplica por el numero de ordenes de la fila cruda, no lo sustituye", () => {
    // La mutacion que este caso mata: `unidades += cantidad` (olvidar el `x n`). Con `n = 1` en
    // todas las filas pasaria inadvertida, por eso aqui `n` es 7.
    const { filas } = fundir([fila("3 * Base C", "entregada", 7)]);
    expect(filas[0].unidades).toBe(21);
    expect(filas[0].ordenes).toBe(7);
  });
});

describe("R26 · el mismo producto dos veces en la MISMA orden", () => {
  it("suma las cantidades y cuenta la orden UNA vez", () => {
    const { filas } = fundir([fila("2 * Base C. 1 * base c.", "entregada", 1)]);

    expect(filas).toHaveLength(1);
    expect(filas[0].unidades).toBe(3);
    // Lo que este caso protege: sin deduplicar, `ordenes` seria 2 y la tabla diria que dos
    // ordenes distintas compraron el producto.
    expect(filas[0].ordenes).toBe(1);
  });

  it("y lo hace tambien con `n > 1`", () => {
    const { filas } = fundir([fila("1 * BASE C. 1 * Base C.", "entregada", 5)]);
    expect(filas[0].unidades).toBe(10);
    expect(filas[0].ordenes).toBe(5);
  });

  it("dos productos DISTINTOS de la misma orden cuentan en los dos (R36)", () => {
    const { filas, ordenes } = fundir([fila("1 * Base Dr. 1 * BASE C.", "entregada", 4)]);

    expect(filas).toHaveLength(2);
    expect(filas.map((f) => f.ordenes)).toEqual([4, 4]);
    // El universo del recorte son 4 ordenes, pero la columna «Órdenes» suma 8: es correcto y es
    // exactamente lo que el rotulo de la pantalla tiene que advertir.
    expect(ordenes).toBe(4);
    expect(filas.reduce((s, f) => s + f.ordenes, 0)).toBe(8);
  });
});

describe("R35 · el universo y las ordenes sin producto interpretable", () => {
  it("`ordenes` cuenta TODAS las filas crudas, den producto o no", () => {
    const { ordenes, ordenesSinProducto } = fundir([
      fila("1 * Base C", "entregada", 10),
      fila("   ", "entregada", 3),
      fila("...", "rechazada", 2),
    ]);

    expect(ordenes).toBe(15);
    expect(ordenesSinProducto).toBe(5);
  });

  it("una orden sin producto interpretable NO produce fila fantasma", () => {
    const { filas } = fundir([fila("", "entregada", 4)]);
    expect(filas).toEqual([]);
  });

  it("las cadenas de PRUEBA si producen fila: no son «sin producto»", () => {
    const { filas, ordenesSinProducto } = fundir([
      fila("PRUEBA", "entregada", 4),
      fila("Camiseta talla M", "entregada", 1),
    ]);
    expect(filas.map((f) => f.producto).sort()).toEqual(["Camiseta talla M", "PRUEBA"]);
    expect(ordenesSinProducto).toBe(0);
  });
});

describe("R37 / R38 / R39 · separados POR TIENDA", () => {
  it("dos tiendas con el MISMO texto son DOS filas", () => {
    const { filas } = fundir([
      fila("1 * Crema Especial MLX", "entregada", 3, "t1", "Tienda Uno"),
      fila("1 * Crema Especial MLX", "entregada", 5, "t2", "Tienda Dos"),
    ]);

    expect(filas).toHaveLength(2);
    // Nunca se funden: que dos tiendas escriban lo mismo no prueba que sea el mismo articulo.
    expect(filas.map((f) => [f.tienda, f.ordenes])).toEqual([
      ["Tienda Dos", 5],
      ["Tienda Uno", 3],
    ]);
  });

  it("la fila lleva el NOMBRE de la tienda y su id como clave", () => {
    const { filas } = fundir([fila("1 * Base C", "entregada", 1, "t-uuid", "Tienda Uno")]);
    expect(filas[0].tienda).toBe("Tienda Uno");
    expect(filas[0].tiendaId).toBe("t-uuid");
  });

  it("el mismo texto de la misma tienda en dos desenlaces es UNA fila", () => {
    const { filas } = fundir([
      fila("1 * Base C", "entregada", 3),
      fila("1 * Base C", "rechazada", 1),
    ]);

    expect(filas).toHaveLength(1);
    expect(filas[0].ordenes).toBe(4);
    expect(filas[0].porStatus).toEqual([
      { status: "entregada", conteo: 3 },
      { status: "rechazada", conteo: 1 },
    ]);
  });
});

describe("R18 · la forma visible es DETERMINISTA", () => {
  it("gana la variante con MAS ordenes", () => {
    const { filas } = fundir([
      fila("1 * base c", "entregada", 2),
      fila("1 * BASE C", "entregada", 9),
    ]);

    expect(filas).toHaveLength(1);
    expect(filas[0].producto).toBe("BASE C");
  });

  it("en empate gana la menor por comparacion de cadena, no el orden de llegada", () => {
    const orden1 = fundir([
      fila("1 * base c", "entregada", 3),
      fila("1 * BASE C", "entregada", 3),
    ]);
    const orden2 = fundir([
      fila("1 * BASE C", "entregada", 3),
      fila("1 * base c", "entregada", 3),
    ]);

    // `BASE C` < `base c` por unidades de codigo (mayusculas primero). Lo importante no es CUAL
    // gane, es que las dos entradas —que difieren solo en el orden de llegada— den lo mismo.
    expect(orden1.filas[0].producto).toBe("BASE C");
    expect(orden2.filas[0].producto).toBe("BASE C");
  });

  it("la misma entrada produce siempre la misma salida", () => {
    const crudas = [
      fila("2 * Base Dr. 1 * BASE C.", "entregada", 3),
      fila("1 * base dr", "rechazada", 1, "t2", "Tienda Dos"),
      fila("1 * Base C.", "en_reparto", 2),
    ];
    expect(fundir(crudas)).toEqual(fundir(crudas));
    expect(fundir(crudas)).toEqual(fundir([...crudas]));
  });
});

describe("R33 · el orden de las filas es determinista, con cuatro criterios", () => {
  it("unidades desc, ordenes desc, producto asc, tienda asc", () => {
    const { filas } = fundir([
      // mismas unidades (4) y mismas ordenes (4): desempata el nombre
      fila("1 * Zeta", "entregada", 4, "t1", "Tienda Uno"),
      fila("1 * Alfa", "entregada", 4, "t1", "Tienda Uno"),
      // mismas unidades (4) y mismas ordenes (4) y MISMO nombre: desempata la tienda
      fila("1 * Alfa", "entregada", 4, "t2", "Aurora"),
      // mas unidades: va primero
      fila("5 * Beta", "entregada", 2, "t1", "Tienda Uno"),
      // mismas unidades que Alfa/Zeta pero menos ordenes
      fila("2 * Gamma", "entregada", 2, "t1", "Tienda Uno"),
    ]);

    expect(filas.map((f) => [f.producto, f.tienda, f.unidades, f.ordenes])).toEqual([
      ["Beta", "Tienda Uno", 10, 2],
      ["Alfa", "Aurora", 4, 4],
      ["Alfa", "Tienda Uno", 4, 4],
      ["Zeta", "Tienda Uno", 4, 4],
      ["Gamma", "Tienda Uno", 4, 2],
    ]);
  });

  it("el orden NO depende del orden en que la base devolvio las filas", () => {
    const crudas = [
      fila("1 * Zeta", "entregada", 4),
      fila("1 * Alfa", "entregada", 4),
      fila("5 * Beta", "entregada", 2),
    ];
    const directo = fundir(crudas).filas.map((f) => f.producto);
    const invertido = fundir([...crudas].reverse()).filas.map((f) => f.producto);
    expect(invertido).toEqual(directo);
  });

  it("`porStatus` tambien sale ordenado y estable", () => {
    const { filas } = fundir([
      fila("1 * Base C", "rechazada", 2),
      fila("1 * Base C", "entregada", 9),
      fila("1 * Base C", "en_reparto", 2),
    ]);
    // conteo desc, y el nombre como desempate entre los dos que valen 2.
    expect(filas[0].porStatus).toEqual([
      { status: "entregada", conteo: 9 },
      { status: "en_reparto", conteo: 2 },
      { status: "rechazada", conteo: 2 },
    ]);
  });
});

describe("R31 / R34 · lo que NO se emite", () => {
  it("ninguna fila con cero ordenes", () => {
    const { filas } = fundir([
      fila("1 * Base C", "entregada", 1),
      fila("", "entregada", 3),
      fila("1 * Otro", "rechazada", 2),
    ]);
    for (const f of filas) expect(f.ordenes).toBeGreaterThan(0);
    expect(filas).toHaveLength(2);
  });

  it("un producto que no aparece en el recorte no genera fila en cero", () => {
    const { filas } = fundir([fila("1 * Base C", "entregada", 1)]);
    expect(filas.map((f) => f.producto)).toEqual(["Base C"]);
  });

  it("unidades y ordenes son ENTEROS", () => {
    const { filas, ordenes, ordenesSinProducto } = fundir([
      fila("3 * Base C", "entregada", 7),
      fila("1 * Base Dr. 2 * Otro.", "rechazada", 5),
    ]);
    for (const f of filas) {
      expect(Number.isSafeInteger(f.unidades), f.producto).toBe(true);
      expect(Number.isSafeInteger(f.ordenes), f.producto).toBe(true);
      for (const s of f.porStatus) expect(Number.isSafeInteger(s.conteo)).toBe(true);
    }
    expect(Number.isSafeInteger(ordenes)).toBe(true);
    expect(Number.isSafeInteger(ordenesSinProducto)).toBe(true);
  });

  it("NINGUNA cifra de dinero por producto: el DTO no tiene mas campos que los declarados", () => {
    // El limite innegociable de la ficha, escrito como asercion: si alguien añade `ingreso`,
    // `flete` o `monto` a la fila, este caso lo dice.
    const { filas } = fundir([fila("1 * Base C", "entregada", 2)]);
    expect(Object.keys(filas[0]).sort()).toEqual([
      "ordenes",
      "porStatus",
      "producto",
      "tienda",
      "tiendaId",
      "unidades",
    ]);
  });
});

describe("El corpus REAL, fundido", () => {
  it("las cadenas de produccion producen las filas contadas a mano", () => {
    const { filas, ordenes, ordenesSinProducto } = fundir([
      fila("1 * Dr Melaxin. 1 * BASE C.", "entregada", 2),
      fila("1 * Base Dr. 1 * BASE C.", "rechazada", 1),
      fila("2 * Creatina Monohidratada. 1 * BASE C.", "entregada", 1),
      fila("PRUEBA", "entregada", 1),
    ]);

    expect(ordenes).toBe(5);
    expect(ordenesSinProducto).toBe(0);
    expect(filas.map((f) => [f.producto, f.unidades, f.ordenes])).toEqual([
      ["BASE C", 4, 4],
      ["Dr Melaxin", 2, 2],
      ["Creatina Monohidratada", 2, 1],
      ["Base Dr", 1, 1],
      ["PRUEBA", 1, 1],
    ]);
  });
});

describe("R58 · cache: clave con prefijo propio, tag propio y `lastSync` DENTRO del productor", () => {
  it("escribe bajo la clave de `claveDeConteoProductos` y con el tag de productos", async () => {
    const cache = cacheFalsa();
    const consulta = consultaDe();
    const service = new ConteoProductosService(
      repoFalso([fila("1 * Base C", "entregada", 1)]),
      cache,
      { now: () => AHORA },
    );

    await service.consultar(consulta);

    expect(cache.claves).toEqual([claveDeConteoProductos(consulta)]);
    expect(cache.claves[0].startsWith(TAG_CONTEO_PRODUCTOS)).toBe(true);
  });

  it("el segundo `consultar` sale de la cache y NO vuelve a tocar el repositorio", async () => {
    const cache = cacheFalsa();
    const repo = repoFalso([fila("1 * Base C", "entregada", 1)]);
    const service = new ConteoProductosService(repo, cache, { now: () => AHORA });
    const consulta = consultaDe();

    await service.consultar(consulta);
    await service.consultar(consulta);

    expect(repo.llamadas).toBe(1);
  });

  it("invalidar el tag de productos vacia la entrada y la siguiente lectura vuelve a la base", async () => {
    const cache = cacheFalsa();
    const repo = repoFalso([fila("1 * Base C", "entregada", 1)]);
    const service = new ConteoProductosService(repo, cache, { now: () => AHORA });

    await service.consultar(consultaDe());
    await cache.invalidar("manual", [TAG_CONTEO_PRODUCTOS]);
    await service.consultar(consultaDe());

    expect(repo.llamadas).toBe(2);
  });

  it("`lastSync` se sella DENTRO del productor: un ACIERTO devuelve el sello viejo", async () => {
    const cache = cacheFalsa();
    let ahora = new Date("2026-09-01T12:00:00.000Z");
    const service = new ConteoProductosService(
      repoFalso([fila("1 * Base C", "entregada", 1)]),
      cache,
      { now: () => ahora },
    );

    const primera = await service.consultar(consultaDe());
    ahora = new Date("2026-09-01T12:10:00.000Z");
    const segunda = await service.consultar(consultaDe());

    expect(primera.lastSync).toBe("2026-09-01T12:00:00.000Z");
    // Si el sello se pusiera FUERA del productor, aqui saldrian las 12:10 y la pantalla diria
    // que acaba de traer de la base algo que lleva diez minutos guardado.
    expect(segunda.lastSync).toBe("2026-09-01T12:00:00.000Z");
  });

  it("dos actores con alcance distinto NO comparten entrada de cache", async () => {
    const cache = cacheFalsa();
    const service = new ConteoProductosService(
      repoFalso([fila("1 * Base C", "entregada", 1)]),
      cache,
      { now: () => AHORA },
    );

    await service.consultar(consultaDe({ tienda_id: ["t1"] }, "maestro"));
    await service.consultar(consultaDe({}, "adminTienda", "t1"));

    // Una clave que no distingue el alcance no da una cifra equivocada: filtra datos entre roles.
    expect(new Set(cache.claves).size).toBe(2);
  });

  it("el DTO cruza la cache SERIALIZADO sin perder forma (como `unstable_cache`)", async () => {
    const cache = cacheFalsa();
    const service = new ConteoProductosService(
      repoFalso([fila("2 * Base C", "entregada", 3)]),
      cache,
      { now: () => AHORA },
    );

    const fallo = await service.consultar(consultaDe());
    const acierto = await service.consultar(consultaDe());

    expect(acierto).toEqual(fallo);
    expect(acierto.filas[0].unidades).toBe(6);
    expect(acierto.ordenes).toBe(3);
  });
});
