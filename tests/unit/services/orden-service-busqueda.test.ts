import { describe, it, expect, vi } from "vitest";
import { OrdenService } from "@/lib/services/OrdenService";
import type {
  IOrdenRepository,
  ListOrdenesParams,
  ListOrdenesResult,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import {
  listarOrdenesCompletoSchema,
  listarOrdenesSchema,
  type OrdenListItemDTO,
} from "@/lib/types/orden";
import { fakeIntentosEnLote } from "@/tests/fixtures/intentos-entrega";

// Feature 169 / T2.3 + T2.4 — traduccion del TERMINO al `where` y fallback de la ruta
// rapida (R2, R9, R10, R11, R12, R13, R14, R18, R20, R21).
//
// El repositorio va MOCKEADO: lo que se afirma es el objeto `where` que el service
// construye y CUANTAS veces consulta, porque ahi viven las dos decisiones que no pueden
// fallar — que el termino solo pueda ESTRECHAR (nunca aparece dentro de un OR) y que el
// fallback numerico se dispare por `total` y no por `items.length`.

const MAESTRO: Actor = { usuarioId: "m1", rol: "maestro" };
const AHORA = new Date("2026-07-15T20:00:00.000Z");

/** Repo que siempre devuelve vacio: sirve para leer el `where` que se le paso. */
function repoVacio() {
  const list = vi.fn<(params: ListOrdenesParams) => Promise<ListOrdenesResult>>(
    async () => ({ items: [], total: 0 }),
  );
  return { repo: { list } as unknown as IOrdenRepository, list };
}

/**
 * Repo que responde con un `total` distinto segun la clave del `where`. Es lo que permite
 * probar el fallback sin base: "la guia existe" = la consulta con `numGuia` trae total > 0.
 */
function repoConGuia(totalPorGuia: number, totalPorBusqueda: number) {
  const list = vi.fn(async (params: ListOrdenesParams): Promise<ListOrdenesResult> => {
    const total = params.where.numGuia !== undefined ? totalPorGuia : totalPorBusqueda;
    const visibles = Math.max(0, Math.min(total - params.skip, params.take));
    return {
      items: Array.from({ length: visibles }, (_, i) => ({ id: `o${i}` })) as OrdenListItemDTO[],
      total,
    };
  });
  return { repo: { list } as unknown as IOrdenRepository, list };
}

function servicio(repo: IOrdenRepository) {
  return new OrdenService(repo, fakeIntentosEnLote(), () => AHORA);
}

/** El `where` de la PRIMERA consulta que el service lanzo. */
async function wherePrimero(
  filter: Record<string, unknown>,
  actor: Actor = MAESTRO,
): Promise<ListOrdenesParams["where"]> {
  const { repo, list } = repoVacio();
  await servicio(repo).listar(listarOrdenesSchema.parse({ filter }), actor);
  return list.mock.calls[0][0].where;
}

describe("ruta rapida por num_guia (R9/R12)", () => {
  it("R9: un termino de SOLO DIGITOS se resuelve por igualdad contra la guia", async () => {
    const where = await wherePrimero({ q: "12345" });
    expect(where.numGuia).toBe(12345);
    // Y NO por coincidencia parcial: la guia exacta devuelve esa orden y solo esa, no
    // todas las que llevan "12345" dentro de un telefono.
    expect(where.busqueda).toBeUndefined();
  });

  it("R12: un numero por encima del rango de int4 NO se intenta como guia, va a parcial", async () => {
    // 2 147 483 648 = INT4_MAX + 1. Intentarlo como guia seria un error de cast en la base.
    const where = await wherePrimero({ q: "2147483648" });
    expect(where.numGuia).toBeUndefined();
    expect(where.busqueda).toBe("2147483648");
  });

  it("R12: un termino de 30 digitos tampoco falla: cae a parcial", async () => {
    const where = await wherePrimero({ q: "9".repeat(30) });
    expect(where.numGuia).toBeUndefined();
    expect(where.busqueda).toBe("9".repeat(30));
  });

  it("un termino de solo ceros no es una guia (0 no existe): va a parcial", async () => {
    const where = await wherePrimero({ q: "000" });
    expect(where.numGuia).toBeUndefined();
    expect(where.busqueda).toBe("000");
  });

  it("INT4_MAX exacto SI es una guia representable", async () => {
    const where = await wherePrimero({ q: "2147483647" });
    expect(where.numGuia).toBe(2147483647);
  });
});

describe("coincidencia parcial (R2/R13)", () => {
  it("un termino de texto llega NORMALIZADO: minusculas, sin acentos, espacios simples", async () => {
    const where = await wherePrimero({ q: "  JOSÉ   Peña " });
    expect(where.busqueda).toBe("jose pena");
    expect(where.numGuia).toBeUndefined();
  });

  it("R13: digitos con separadores de telefono viajan TAMBIEN en su forma SOLO DIGITOS", async () => {
    // La columna indexa el telefono en las dos formas, asi que la forma solo-digitos cubre
    // el telefono guardado SIN separadores. Sigue viajando; lo que cambia (M1) es que ya no
    // viaja SOLA.
    expect((await wherePrimero({ q: "8888-0000" })).busquedaDigitos).toBe("88880000");
    expect((await wherePrimero({ q: "(506) 8888 0000" })).busquedaDigitos).toBe("50688880000");
  });

  it("R13: un telefono con separadores NO entra por la ruta rapida de la guia", async () => {
    const where = await wherePrimero({ q: "8888-0000" });
    expect(where.numGuia).toBeUndefined();
  });

  it("R2: el termino se escribe en UNA clave escalar, nunca dentro de un OR", async () => {
    // Regla de review del design §7: cualquier construccion que meta el termino en un `OR`
    // con otra cosa es un rechazo automatico — ahi es donde nacen las fugas de alcance.
    const where = await wherePrimero({ q: "juan" });
    expect(where).toEqual({ busqueda: "juan" });
    expect(JSON.stringify(where)).not.toContain("OR");
  });
});

// M1 del review: el termino de digitos CON separadores viajaba solo reducido a digitos, y
// eso hacia inencontrable una remision numerica con guiones (`2026-0912` no casaba
// `REM-2026-0912`, que la columna indexa TAL CUAL). Falso negativo silencioso: sin error,
// sin log, la orden "no aparece". El contrato ahora manda las DOS formas; la union la hace
// el repositorio, siempre sobre la misma columna.
describe("las DOS formas del termino numerico con separadores (M1: R5 sin romper R13)", () => {
  it("el termino tecleado viaja TAL CUAL, ademas de reducido a digitos", async () => {
    const where = await wherePrimero({ q: "2026-0912" });
    // La forma tal cual es la que encuentra `REM-2026-0912`...
    expect(where.busqueda).toBe("2026-0912");
    // ...y la reducida sigue siendo la que encuentra un telefono guardado sin separadores.
    expect(where.busquedaDigitos).toBe("20260912");
    expect(where.numGuia).toBeUndefined();
  });

  it("el termino tal cual llega NORMALIZADO, no crudo", async () => {
    const where = await wherePrimero({ q: "  2026 - 0912  " });
    expect(where.busqueda).toBe("2026 - 0912");
    expect(where.busquedaDigitos).toBe("20260912");
  });

  it("las dos claves son HERMANAS del resto: el service NUNCA construye un OR", async () => {
    // El `OR` (de las dos formas, sobre la MISMA columna) es dialecto del repositorio. Lo
    // que este nivel garantiza es que el termino no se mezcla con nada mas: aqui hay dos
    // claves de busqueda y las del acotamiento, y ninguna anida a otra.
    const where = await wherePrimero({ q: "8888-0000", zona_id: ["z1"] }, {
      usuarioId: "store1",
      rol: "adminTienda",
    });
    expect(Object.keys(where).sort()).toEqual([
      "busqueda",
      "busquedaDigitos",
      "tiendaId",
      "zonaId",
    ]);
    expect(JSON.stringify(where)).not.toContain("OR");
    expect(where.tiendaId).toBe("store1");
  });

  it("un termino SIN separadores NO produce segunda forma: el `where` es el de siempre", async () => {
    // Importa para el plan de ejecucion: la ruta parcial numerica (y el fallback de R10)
    // siguen emitiendo UNA sola condicion, o sea el plan ya medido en T4.1.
    const digitos = await wherePrimero({ q: "2147483648" });
    expect(digitos.busqueda).toBe("2147483648");
    expect(digitos.busquedaDigitos).toBeUndefined();

    const texto = await wherePrimero({ q: "jose pena" });
    expect(texto.busqueda).toBe("jose pena");
    expect(texto.busquedaDigitos).toBeUndefined();
  });

  it("un termino con letras y guiones tampoco produce segunda forma", async () => {
    // `soloDigitosSiPareceNumero` devuelve null en cuanto hay una letra: ahi no hay nada
    // que reducir y el texto se busca tal cual, como siempre.
    const where = await wherePrimero({ q: "rem-2026-0912" });
    expect(where.busqueda).toBe("rem-2026-0912");
    expect(where.busquedaDigitos).toBeUndefined();
  });

  it("el fallback de la guia tambien manda las dos formas", async () => {
    // La ruta rapida solo la toma un termino de digitos PELADOS, asi que este caso entra
    // directo a parcial; se comprueba que la descarga y el listado ven lo mismo.
    const { repo, list } = repoConGuia(0, 3);
    await servicio(repo).listarCompleto(
      listarOrdenesCompletoSchema.parse({ filter: { q: "2026-0912" } }),
      MAESTRO,
    );
    expect(list).toHaveBeenCalledTimes(1);
    expect(list.mock.calls[0][0].where.busqueda).toBe("2026-0912");
    expect(list.mock.calls[0][0].where.busquedaDigitos).toBe("20260912");
  });
});

describe("composicion con el resto de filtros (R14)", () => {
  it("el termino es una clave HERMANA: AND con estado, catalogos y fechas", async () => {
    const where = await wherePrimero({
      q: "juan",
      status_id: ["os-1"],
      zona_id: ["z1"],
      created_desde: "2026-07-01",
    });
    expect(where.busqueda).toBe("juan");
    expect(where.estatusId).toEqual(["os-1"]);
    expect(where.zonaId).toEqual(["z1"]);
    expect(where.createdAt).toEqual({ gte: new Date("2026-07-01T06:00:00.000Z") });
  });

  it("la ruta rapida tambien compone: la guia no borra los demas filtros", async () => {
    const where = await wherePrimero({ q: "12345", zona_id: ["z1"] });
    expect(where.numGuia).toBe(12345);
    expect(where.zonaId).toEqual(["z1"]);
  });

  it("R21: el acotamiento por rol se escribe DESPUES y el termino no lo toca", async () => {
    const where = await wherePrimero({ q: "juan", tienda_id: ["ajena"] }, {
      usuarioId: "store1",
      rol: "adminTienda",
    });
    expect(where.busqueda).toBe("juan");
    expect(where.tiendaId).toBe("store1"); // escalar del rol, pisa la lista del filtro
  });
});

describe("fallback de la ruta rapida (R10/R11)", () => {
  it("R10: si la guia NO existe, se reintenta como coincidencia parcial", async () => {
    const { repo, list } = repoConGuia(0, 7);
    const res = await servicio(repo).listar(
      listarOrdenesSchema.parse({ filter: { q: "88880000" } }),
      MAESTRO,
    );
    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[0][0].where.numGuia).toBe(88880000);
    expect(list.mock.calls[1][0].where.numGuia).toBeUndefined();
    expect(list.mock.calls[1][0].where.busqueda).toBe("88880000");
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.total).toBe(7);
  });

  it("si la guia SI existe, NO hay segunda consulta (se devuelve esa orden y solo esa)", async () => {
    const { repo, list } = repoConGuia(1, 999);
    const res = await servicio(repo).listar(
      listarOrdenesSchema.parse({ filter: { q: "12345" } }),
      MAESTRO,
    );
    expect(list).toHaveBeenCalledTimes(1);
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.total).toBe(1);
  });

  it("R11: pedir la PAGINA 3 de una guia exacta NO cae al trigram", async () => {
    // Este es el bug sutil que el disparador por `total` existe para evitar: en la pagina 3
    // de una guia exacta, `items` viene VACIO y `total` vale 1. Con `items.length` como
    // condicion, el mismo termino se resolveria de una forma en la pagina 1 y de otra en
    // la 3, y la paginacion mostraria resultados distintos segun por donde se entrase.
    const { repo, list } = repoConGuia(1, 999);
    const res = await servicio(repo).listar(
      listarOrdenesSchema.parse({ filter: { q: "12345" }, page: 3, pageSize: 25 }),
      MAESTRO,
    );
    expect(list).toHaveBeenCalledTimes(1);
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.items).toHaveLength(0);
    expect(res.total).toBe(1); // el mismo total que en la pagina 1
  });

  it("R11: el criterio es el MISMO en la pagina 1 y en la 3", async () => {
    const { repo, list } = repoConGuia(1, 999);
    const svc = servicio(repo);
    const pagina1 = await svc.listar(
      listarOrdenesSchema.parse({ filter: { q: "12345" }, page: 1 }),
      MAESTRO,
    );
    const pagina3 = await svc.listar(
      listarOrdenesSchema.parse({ filter: { q: "12345" }, page: 3 }),
      MAESTRO,
    );
    expect(pagina1.status === "ok" && pagina1.total).toBe(1);
    expect(pagina3.status === "ok" && pagina3.total).toBe(1);
    // Dos listados, dos consultas: ninguno de los dos reintento.
    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls.every((c) => c[0].where.numGuia === 12345)).toBe(true);
  });

  it("un termino de TEXTO sin resultados NO reintenta nada (no hay ruta rapida que caer)", async () => {
    const { repo, list } = repoVacio();
    await servicio(repo).listar(
      listarOrdenesSchema.parse({ filter: { q: "nadie" } }),
      MAESTRO,
    );
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("un listado SIN termino y sin resultados tampoco reintenta", async () => {
    const { repo, list } = repoVacio();
    await servicio(repo).listar(listarOrdenesSchema.parse({}), MAESTRO);
    expect(list).toHaveBeenCalledTimes(1);
  });
});

describe("la descarga completa aplica el MISMO termino (R20)", () => {
  it("`listarCompleto` traduce el termino igual que el listado", async () => {
    const { repo, list } = repoVacio();
    await servicio(repo).listarCompleto(
      listarOrdenesCompletoSchema.parse({ filter: { q: "  JOSÉ Peña " } }),
      MAESTRO,
    );
    expect(list.mock.calls[0][0].where.busqueda).toBe("jose pena");
  });

  it("el `where` de la descarga es IDENTICO al del listado para el mismo filtro", async () => {
    // R20 dicho de la forma que se puede comprobar: lo descargado es lo listado porque las
    // dos rutas comparten `construirWhere`, no porque alguien recuerde mantenerlas iguales.
    const filter = { q: "Peña 100%", zona_id: ["z1"], status_id: ["os-1"] };
    const paginado = repoVacio();
    await servicio(paginado.repo).listar(
      listarOrdenesSchema.parse({ filter }),
      MAESTRO,
    );
    const completo = repoVacio();
    await servicio(completo.repo).listarCompleto(
      listarOrdenesCompletoSchema.parse({ filter }),
      MAESTRO,
    );
    expect(completo.list.mock.calls[0][0].where).toEqual(
      paginado.list.mock.calls[0][0].where,
    );
  });

  it("`listarCompleto` hereda el MISMO fallback numerico", async () => {
    // Sin esto, un termino numerico que no es guia devolveria filas en pantalla y un
    // archivo vacio: lo descargado dejaria de ser lo listado.
    const { repo, list } = repoConGuia(0, 4);
    const res = await servicio(repo).listarCompleto(
      listarOrdenesCompletoSchema.parse({ filter: { q: "88880000" } }),
      MAESTRO,
    );
    expect(list).toHaveBeenCalledTimes(2);
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.total).toBe(4);
  });
});

describe("sin termino, el contrato previo no cambia (R18)", () => {
  it("un listado sin `q` produce un `where` sin ninguna clave de busqueda", async () => {
    const { repo, list } = repoVacio();
    await servicio(repo).listar(
      listarOrdenesSchema.parse({ filter: { zona_id: ["z1"] } }),
      MAESTRO,
    );
    const where = list.mock.calls[0][0].where;
    expect(where).toEqual({ zonaId: ["z1"] });
    expect(where.busqueda).toBeUndefined();
    expect(where.numGuia).toBeUndefined();
  });

  it("un listado sin `filter` sigue mandando el `where` vacio de siempre", async () => {
    const { repo, list } = repoVacio();
    await servicio(repo).listar(listarOrdenesSchema.parse({}), MAESTRO);
    expect(list.mock.calls[0][0].where).toEqual({});
  });

  it("la entrada enviada al repositorio es identica con y sin la feature en juego", async () => {
    // Mismo sortBy/sortDir/skip/take: el buscador no reordena ni repagina nada (R16).
    const { repo, list } = repoVacio();
    await servicio(repo).listar(
      listarOrdenesSchema.parse({ page: 2, pageSize: 25, sortBy: "num_guia", sortDir: "asc" }),
      MAESTRO,
    );
    const conTermino = repoVacio();
    await servicio(conTermino.repo).listar(
      listarOrdenesSchema.parse({
        page: 2,
        pageSize: 25,
        sortBy: "num_guia",
        sortDir: "asc",
        filter: { q: "juan" },
      }),
      MAESTRO,
    );
    const sin = list.mock.calls[0][0];
    const con = conTermino.list.mock.calls[0][0];
    expect(con.sortBy).toBe(sin.sortBy);
    expect(con.sortDir).toBe(sin.sortDir);
    expect(con.skip).toBe(sin.skip);
    expect(con.take).toBe(sin.take);
  });
});
