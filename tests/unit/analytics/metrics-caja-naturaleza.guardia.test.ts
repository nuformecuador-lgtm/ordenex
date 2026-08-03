import { describe, it, expect } from "vitest";
import { METRICAS, getMetrica, listarMetricas } from "@/lib/analytics/metrics";
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
/* R53 / R54 — LO QUE LAS DESCRIPCIONES DECLARAN (no lo que declaran las       */
/* categorias: eso es el bloque de arriba y NO es lo que estos dos R piden)    */
/* -------------------------------------------------------------------------- */

/**
 * La `descripcion` de `egresos` TAL Y COMO ESTABA ANTES DE LA 173, copiada literal de
 * `git diff origin/dev...HEAD -- lib/analytics/metrics.ts`. Vive aqui como fixture y no como
 * recuerdo: es el texto contra el que se demuestra que la asercion de R53 discrimina. Si alguien
 * revierte la descripcion a este texto, el primer caso de abajo se pone rojo — y el segundo
 * explica por que ninguno de los guardias que ya existian lo habria notado.
 */
const DESCRIPCION_EGRESOS_PRE_173 =
  "Salidas de la caja principal (pagos a tienda y mensajero, sueldos, gastos fijos y variables, " +
  "indemnizaciones y ajustes) segun el libro append-only de la wallet; se lee del ledger, no de " +
  "ordenes, y las gestiones anuladas no generan movimiento que contar.";

/**
 * Lo que R53 exige DE UN TEXTO: que nombre el dinero entregado a las tiendas, desde cuando y por
 * que feature, y que lo diga como una INCLUSION nueva en la cifra. Se escribe como predicado, y
 * no como tres `expect` sueltos, para poder aplicarselo tambien al texto pre-173 y demostrar en
 * el propio archivo que separa los dos casos.
 */
function declaraElCambioDe173(descripcion: string): boolean {
  const d = descripcion.toLowerCase();
  return (
    /dinero entregado a las tiendas/.test(d) && // QUE entra en la cifra
    /(desde|a partir de)[^.]*\b173\b/.test(d) && // DESDE CUANDO, y por que feature
    /incluye/.test(d) // dicho como inclusion, no como un aviso vago
  );
}

describe("R53/R54 · lo que las descripciones del catalogo declaran de la caja en tesoreria", () => {
  it("R53 · la de `egresos` dice que DESDE LA 173 incluye el dinero entregado a las tiendas", () => {
    // R53 (`requirements.md:263-264`) habla de la DESCRIPCION, no de `definicion.categorias`:
    // `egreso_pago_tienda` ya estaba declarada antes de la 173, y la cifra no la contenia porque
    // ninguna via la emitia. Lo que cambia el 2026-08-03 es el NUMERO, no la lista — y esta frase
    // es la unica mitigacion de ese salto donde lo lee quien mira la cifra (⟨P4⟩ del humano,
    // `progress/decision_F2_173.md:26-28`).
    const descripcion = getMetrica("egresos")?.descripcion ?? "";
    const d = descripcion.toLowerCase();

    // Las tres piezas por separado, para que el rojo diga CUAL falta y no solo que algo falta.
    expect(d, "no nombra el dinero entregado a las tiendas").toMatch(
      /dinero entregado a las tiendas/,
    );
    expect(d, "no dice desde cuando ni por que feature").toMatch(/(desde|a partir de)[^.]*\b173\b/);
    expect(d, "no lo declara como una inclusion en la cifra").toMatch(/incluye/);
    expect(declaraElCambioDe173(descripcion), "la descripcion de `egresos` no cumple R53").toBe(
      true,
    );

    // Y el resto de la frase sigue en pie: la advertencia no sustituyo a lo que ya decia.
    expect(d).toContain("salidas de la caja principal");
    expect(d).toMatch(/gestion(es)? anulada/);
  });

  it("y la asercion discrimina: el texto pre-173 NO la pasa, aunque ya nombraba «tienda»", () => {
    // AUTOCOMPROBACION. Sin esto, `toMatch(/tienda/)` habria bastado para dar verde: el texto
    // viejo ya decia «pagos a tienda y mensajero» en su enumeracion. La diferencia entre los dos
    // textos no es que uno nombre a las tiendas: es que uno declara el CAMBIO de significado.
    expect(DESCRIPCION_EGRESOS_PRE_173.toLowerCase()).toContain("pagos a tienda");
    expect(declaraElCambioDe173(DESCRIPCION_EGRESOS_PRE_173)).toBe(false);
    expect(declaraElCambioDe173(getMetrica("egresos")?.descripcion ?? "")).toBe(true);

    // POR QUE ESTE CASO TIENE QUE EXISTIR: el unico guardia que hasta ahora miraba TODAS las
    // descripciones (`tests/unit/analytics/metrics.test.ts`, «cita las gestiones anuladas en la
    // descripcion de toda metrica») lo pasa el texto viejo igual de bien que el nuevo, porque
    // ambos terminan en la misma coletilla. Es decir: R53 podia revertirse con la suite entera en
    // verde. Se comprueba aqui, sobre el texto viejo, en vez de confiarlo a la lectura del PR.
    expect(DESCRIPCION_EGRESOS_PRE_173.toLowerCase()).toMatch(/gestion(es)? anulada|anulada_at/);
  });

  it("R54 · `dinero_en_caja` y `ganancia_ordenex` tienen descripcion PROPIA, no prestada", () => {
    // La otra mitad de R54 («id propio y descripcion propia»): el id ya lo fija el catalogo, pero
    // nada afirmaba que las descripciones fueran distintas ENTRE SI y del resto. Dos metricas que
    // existen precisamente para no confundirse pueden acabar contando lo mismo con dos nombres.
    const enCaja = getMetrica("dinero_en_caja")?.descripcion ?? "";
    const ganancia = getMetrica("ganancia_ordenex")?.descripcion ?? "";

    expect(enCaja.length).toBeGreaterThan(80);
    expect(ganancia.length).toBeGreaterThan(80);
    expect(enCaja).not.toBe(ganancia);

    // Distintas tambien de las de TODAS las demas del catalogo: una descripcion copiada seria un
    // id propio con el significado de otra cifra.
    const ajenas = METRICAS.filter(
      (m) => m.id !== "dinero_en_caja" && m.id !== "ganancia_ordenex",
    ).map((m) => m.descripcion);
    expect(ajenas.length, "el censo mira un catalogo poblado").toBeGreaterThanOrEqual(23);
    expect(ajenas).not.toContain(enCaja);
    expect(ajenas).not.toContain(ganancia);

    // Y cada una dice LO SUYO, que es lo que las hace dos y no una: la de tesoreria INCLUYE el
    // dinero de terceros; la de resultado lo DEJA FUERA. Invertirlo pondria esto rojo.
    expect(enCaja.toLowerCase()).toMatch(/incluye el contra-entrega/);
    expect(ganancia.toLowerCase()).toMatch(/dejando fuera el dinero de terceros/);
    expect(enCaja.toLowerCase()).not.toMatch(/dejando fuera el dinero de terceros/);
    expect(ganancia.toLowerCase()).not.toMatch(/incluye el contra-entrega/);
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
