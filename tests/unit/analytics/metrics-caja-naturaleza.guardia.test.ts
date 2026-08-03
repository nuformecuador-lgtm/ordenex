import { describe, it, expect } from "vitest";
import { getMetrica, listarMetricas } from "@/lib/analytics/metrics";
import {
  VISTA_COD_RECAUDADO_POR_METODO,
  VISTA_COD_RECAUDADO_POR_TIENDA,
} from "@/lib/types/analitica-financiera";
import { WALLET_MOVIMIENTO_CATEGORIA_SEED } from "@/lib/types/wallet";
import {
  NATURALEZA_POR_CATEGORIA,
  type NaturalezaMovimiento,
} from "@/lib/utils/caja-tesoreria";
import { armarServicio, consultaDe } from "../services/_dobles-analitica-financiera";

// Feature 173 / T F.1 — GUARDIA: LAS METRICAS DE INGRESO NO SE INFLAN (R51, R52).
//
// El problema que vigila, en una frase: la 173 mete en `wallet_movimiento` dinero que NO es de
// Ordenex —el contra-entrega cobrado a nombre de las tiendas y su reverso—, y las metricas de
// ingreso de la 127 salen de ESE mismo libro. Si alguna de ellas ganara una de las categorias
// nuevas, el "ingreso de Ordenex" pasaria a incluir dinero ajeno y nadie lo notaria: la cifra
// seguiria saliendo, solo que mas grande.
//
// DE DONDE SE LEE LA VERDAD. De `NATURALEZA_POR_CATEGORIA` (T A.4), que es un `Record` TOTAL
// sobre el union de categorias de la caja, no de una lista de categorias "prohibidas" copiada
// aqui a mano. La diferencia no es de estilo: con la lista copiada, el dia que el enum gane una
// tercera categoria de terceros este archivo seguiria verde sin haberla mirado nunca. Con el
// `Record`, la clasificacion la decide quien anade la categoria —y no compila si no la decide—,
// y este guardia solo la consulta. El caso «el guardia lee el Record de verdad» de mas abajo lo
// demuestra MUTANDOLO en memoria.
//
// R52 tiene una trampa que conviene nombrar: `cod_recaudado` mide el MISMO dinero que la caja
// acaba de empezar a registrar, pero ya se sirve en DOS vistas que no suman entre si (el
// snapshot del cierre y el credito del ledger de tienda). Anadirle la caja como TERCERA fuente
// no seria "mas informacion": seria una tercera definicion del mismo colon, y el repo prohibe
// por escrito tener dos. Por eso aqui se afirma lo que NO cambio, que es justo lo que un
// guardia sirve para conservar.

/** Las tres metricas de INGRESO de Ordenex que R51 protege. Escritas, porque son el sujeto. */
const METRICAS_DE_INGRESO = ["ingreso_flete", "ingreso_comision_cod", "ingreso_iva"] as const;

/**
 * La naturaleza de una categoria SEGUN EL RECORD, o `undefined` si esa categoria no es de la
 * caja principal (`efectivo` y el `cod_recaudado` del ledger de tienda son de otros
 * vocabularios: no tienen —ni deben tener— naturaleza aqui).
 */
function naturalezaDe(categoria: string): NaturalezaMovimiento | undefined {
  return (NATURALEZA_POR_CATEGORIA as Readonly<Record<string, NaturalezaMovimiento>>)[categoria];
}

/** Las categorias de una lista que el `Record` clasifica como dinero DE TERCEROS. */
export function categoriasDeTerceros(categorias: readonly string[]): readonly string[] {
  return categorias.filter((c) => naturalezaDe(c) === "terceros");
}

/** Las categorias de terceros que UNA metrica del catalogo declara. Falla si no existe. */
function tercerosDeclaradasPor(metricaId: string): readonly string[] {
  const metrica = getMetrica(metricaId);
  if (metrica === undefined) throw new Error(`el catalogo perdio la metrica ${metricaId}`);
  return categoriasDeTerceros(metrica.definicion.categorias ?? []);
}

/* -------------------------------------------------------------------------- */
/* R51 — ninguna metrica de ingreso declara dinero de terceros                 */
/* -------------------------------------------------------------------------- */

describe("R51 · las tres metricas de ingreso de Ordenex no ven el dinero de terceros", () => {
  it("ninguna de las tres declara una categoria de naturaleza terceros", () => {
    for (const id of METRICAS_DE_INGRESO) {
      expect(tercerosDeclaradasPor(id), `${id} declara dinero que no es de Ordenex`).toEqual([]);
    }
  });

  it("y siguen declarando exactamente las categorias con las que la 127 las publico", () => {
    // La otra mitad: "no gano ninguna de terceros" es compatible con "perdio una propia".
    expect(getMetrica("ingreso_flete")?.definicion.categorias).toEqual([
      "ingreso_flete",
      "ingreso_flete_devolucion",
    ]);
    expect(getMetrica("ingreso_comision_cod")?.definicion.categorias).toEqual([
      "ingreso_comision_cod",
    ]);
    expect(getMetrica("ingreso_iva")?.definicion.categorias).toEqual([
      "ingreso_iva_flete",
      "ingreso_iva_flete_devolucion",
      "ingreso_iva_comision_cod",
    ]);
  });

  it("el fixture no es inocuo: el Record SI clasifica categorias como terceros", () => {
    // Si todas fueran "propio", el caso de arriba pasaria por conjunto vacio para siempre.
    const terceros = Object.entries(NATURALEZA_POR_CATEGORIA)
      .filter(([, n]) => n === "terceros")
      .map(([c]) => c)
      .sort();
    expect(terceros).toEqual([
      "egreso_pago_tienda",
      "ingreso_cod_recaudado",
      "ingreso_reverso_pago_tienda",
    ]);
  });

  it("el guardia lee el Record de verdad: moverle una categoria lo pone rojo", () => {
    // LA MUTACION. Con una lista de prohibidas copiada a mano, esto seguiria dando `[]` y el
    // guardia estaria afirmando algo que no mide.
    const original = NATURALEZA_POR_CATEGORIA.ingreso_flete;
    try {
      NATURALEZA_POR_CATEGORIA.ingreso_flete = "terceros";
      expect(tercerosDeclaradasPor("ingreso_flete")).toEqual(["ingreso_flete"]);
    } finally {
      NATURALEZA_POR_CATEGORIA.ingreso_flete = original;
    }
    // Y el catalogo queda como estaba: este test no contamina a los de abajo.
    expect(tercerosDeclaradasPor("ingreso_flete")).toEqual([]);
    expect(NATURALEZA_POR_CATEGORIA.ingreso_flete).toBe("propio");
  });

  it("autocomprobacion: una metrica de ingreso que SI declarara la caja se detecta", () => {
    const infractora = ["ingreso_flete", "ingreso_cod_recaudado"];
    expect(categoriasDeTerceros(infractora)).toEqual(["ingreso_cod_recaudado"]);
  });
});

/* -------------------------------------------------------------------------- */
/* La frontera de `egresos`: lo que SI cambia y lo que NO ⟨decision_F2_173⟩    */
/* -------------------------------------------------------------------------- */

describe("egresos: gana el pago a tienda por diseno, y nada mas", () => {
  it("declara UNA sola categoria de terceros, y es el pago a la tienda", () => {
    // No es una infraccion de R51: `egresos` es la metrica de SALIDAS de la caja, y el dinero
    // entregado a la tienda sale de la caja de verdad. Es exactamente el cambio de significado
    // que `progress/decision_F2_173.md` autoriza y que la `descripcion` declara (R53).
    expect(tercerosDeclaradasPor("egresos")).toEqual(["egreso_pago_tienda"]);
  });

  it("y NO gana el reverso de la anulacion ni ningun ingreso: eso es territorio de la 175", () => {
    // El reverso (`ingreso_reverso_pago_tienda`) y `ingreso_ajuste` son INGRESOS. Meterlos en
    // una metrica llamada «Egresos» cambiaria el numero de una cifra de dinero ya publicada, y
    // la autorizacion de la 173 lo excluye por escrito. El hallazgo del neto/bruto (§H7/§H10 de
    // `progress/impl_173-caja-tesoreria.md`) esta dirigido a la 175.
    const categorias = getMetrica("egresos")?.definicion.categorias ?? [];
    expect(categorias).toHaveLength(8);
    expect(categorias.every((c) => c.startsWith("egreso_"))).toBe(true);
    expect(categorias).not.toContain("ingreso_reverso_pago_tienda");
    expect(categorias).not.toContain("ingreso_ajuste");
  });
});

/* -------------------------------------------------------------------------- */
/* R52 — `cod_recaudado` conserva sus DOS vistas y no gana una tercera fuente  */
/* -------------------------------------------------------------------------- */

describe("R52 · cod_recaudado sigue con dos vistas y la caja NO es una tercera fuente", () => {
  it("no declara ninguna categoria de la caja principal", () => {
    const categorias = getMetrica("cod_recaudado")?.definicion.categorias ?? [];
    expect(categorias).toEqual(["efectivo", "SINPE", "transferencia", "cod_recaudado"]);
    // Ninguna de las cuatro es de `wallet_movimiento`: son metodos de pago y la categoria del
    // ledger de TIENDA. El `Record` de la caja no las conoce, y esa es la comprobacion.
    expect(categorias.map((c) => naturalezaDe(c))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    // En particular, NO gano `ingreso_cod_recaudado`, que es como se colaria la tercera vista.
    expect(categorias).not.toContain("ingreso_cod_recaudado");
  });

  it("sus fuentes declaradas siguen siendo dos, y `wallet_movimiento` no esta", () => {
    const fuente = getMetrica("cod_recaudado")?.fuente;
    expect(fuente?.tipo).toBe("snapshot_cierre");
    expect([...(fuente?.tablas ?? [])].sort()).toEqual(["cierre_dia", "wallet_tienda_movimiento"]);
  });

  it("y en ejecucion produce DOS vistas sin preguntarle nada al libro de la caja", async () => {
    const { servicio, ingresos } = armarServicio({
      caja: [{ categoria: "ingreso_cod_recaudado", tipo: "ingreso", suma: "9999.00" }],
      porMetodo: [{ metodo: "efectivo", suma: "300.00" }],
      porTienda: [{ tiendaId: "t-1", tipo: "credito", suma: "300.00" }],
    });
    const r = await servicio.consultar(consultaDe("cod_recaudado"));
    if (r.status !== "ok" || r.datos.tipo !== "vistas") throw new Error("no son vistas");

    expect(r.datos.vistas.map((v) => v.id)).toEqual([
      VISTA_COD_RECAUDADO_POR_METODO,
      VISTA_COD_RECAUDADO_POR_TIENDA,
    ]);
    // LA COMPROBACION QUE IMPORTA: el repositorio de la caja no se toca. El fixture siembra
    // 9999.00 de contra-entrega EN LA CAJA a proposito; si alguien anadiera esa tercera fuente,
    // ese numero aparecerian en el DTO y este caso se pondria rojo por los dos lados.
    expect(ingresos.sumarPorCategoria).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain("9999.00");
  });
});

/* -------------------------------------------------------------------------- */
/* T F.2 — las dos metricas nuevas declaran lo que el Record dice, no otra cosa */
/* -------------------------------------------------------------------------- */

describe("las listas de las dos metricas nuevas se comprueban contra el Record", () => {
  it("`dinero_en_caja` declara LAS DIECISIETE categorias de la caja, sin faltar ninguna", () => {
    // El catalogo es un modulo puro y no puede importar `NATURALEZA_POR_CATEGORIA` (arrastraria
    // `Prisma` como valor), asi que su lista esta escrita a mano. Esto es lo que impide que las
    // dos se separen: tres fuentes independientes —el catalogo, el `Record` y el SEED del enum—
    // comparadas entre si. Si el enum gana una categoria, el `Record` no compila sin ella y este
    // caso se pone rojo hasta que el catalogo tambien la tenga.
    const declaradas = [...(getMetrica("dinero_en_caja")?.definicion.categorias ?? [])].sort();
    expect(declaradas).toEqual(Object.keys(NATURALEZA_POR_CATEGORIA).sort());
    expect(declaradas).toEqual([...WALLET_MOVIMIENTO_CATEGORIA_SEED].sort());
    expect(declaradas).toHaveLength(17);
  });

  it("`ganancia_ordenex` declara EXACTAMENTE las de naturaleza propio, y ni una de terceros", () => {
    const propiasDelRecord = Object.entries(NATURALEZA_POR_CATEGORIA)
      .filter(([, n]) => n === "propio")
      .map(([c]) => c)
      .sort();
    const declaradas = [...(getMetrica("ganancia_ordenex")?.definicion.categorias ?? [])].sort();

    expect(declaradas).toEqual(propiasDelRecord);
    expect(declaradas).toHaveLength(14);
    // Dicho por el otro lado, que es el que rompe la cifra: el contra-entrega y su reverso no
    // pueden entrar en la ganancia. Si entraran, anular un pago a una tienda subiria la ganancia
    // de Ordenex — el fallo exacto que `design.md §10-C` descarto.
    expect(categoriasDeTerceros(declaradas)).toEqual([]);
    expect(declaradas).not.toContain("ingreso_cod_recaudado");
    expect(declaradas).not.toContain("ingreso_reverso_pago_tienda");
    expect(declaradas).not.toContain("egreso_pago_tienda");
  });

  it("la diferencia entre las dos listas son las TRES de terceros, ni una mas", () => {
    const enCaja = getMetrica("dinero_en_caja")?.definicion.categorias ?? [];
    const ganancia = new Set(getMetrica("ganancia_ordenex")?.definicion.categorias ?? []);
    expect(enCaja.filter((c) => !ganancia.has(c)).sort()).toEqual([
      "egreso_pago_tienda",
      "ingreso_cod_recaudado",
      "ingreso_reverso_pago_tienda",
    ]);
  });

  it("las dos son financieras del catalogo, `live` y sobre el libro de la caja", () => {
    for (const id of ["dinero_en_caja", "ganancia_ordenex"]) {
      const metrica = getMetrica(id);
      expect(metrica?.dominio, id).toBe("financiera");
      expect(metrica?.clase, id).toBe("live");
      expect(metrica?.unidad, id).toBe("moneda");
      expect(metrica?.fuente.tipo, id).toBe("ledger");
      expect([...(metrica?.fuente.tablas ?? [])], id).toEqual(["wallet_movimiento"]);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* El guardia mira el catalogo entero, no solo las cuatro que nombra           */
/* -------------------------------------------------------------------------- */

describe("censo: toda financiera que lea la caja pasa por esta clasificacion", () => {
  it("las categorias de caja que declaran las financieras estan TODAS en el Record", () => {
    // Una financiera que declarara una categoria de `wallet_movimiento` sin naturaleza seria
    // dinero sin duenio declarado. No puede pasar (el `Record` es total y no compila
    // incompleto), y esto lo comprueba en RUNTIME, que es donde vive el catalogo.
    const sinClasificar: string[] = [];
    for (const metrica of listarMetricas({ dominio: "financiera" })) {
      if (!(metrica.fuente.tablas as readonly string[]).includes("wallet_movimiento")) continue;
      for (const categoria of metrica.definicion.categorias ?? []) {
        if (naturalezaDe(categoria) === undefined) sinClasificar.push(`${metrica.id}: ${categoria}`);
      }
    }
    expect(sinClasificar).toEqual([]);
  });

  it("y ese censo no pasa por conjunto vacio: hay financieras que leen la caja", () => {
    const deLaCaja = listarMetricas({ dominio: "financiera" }).filter((m) =>
      (m.fuente.tablas as readonly string[]).includes("wallet_movimiento"),
    );
    // Las cuatro de la 127 (tres ingresos + egresos) y `conciliacion_cierres`, que la declara
    // desde ⟨D10⟩. Si el catalogo perdiera una, el censo de arriba mediria menos sin avisar.
    expect(deLaCaja.length).toBeGreaterThanOrEqual(5);
  });
});
