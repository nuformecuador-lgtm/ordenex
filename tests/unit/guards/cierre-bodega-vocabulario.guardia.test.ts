import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { quitarComentarios } from "../../fixtures/sin-comentarios";
import { LLAMADAS_PROHIBIDAS_EN_DINERO } from "../../fixtures/money-safe";
import {
  CASCADA_CENTRAL_TITULO,
  CASCADA_DUENO_TITULO,
  COBRADO_SOBRE_RECAUDADO_LABEL,
  EFECTIVO_NO_CUBRE_NOTA,
  FACTURADO_ORDENEX_LABEL,
  FLETE_RECHAZO_NO_DEDUCIBLE_NOTA,
  GANA_BODEGA_SATELITE_LABEL,
  GANA_BODEGA_SATELITE_NOTA,
  NETO_ORDENEX_LABEL,
  PARA_LA_CENTRAL_LABEL,
  PARA_LA_CENTRAL_NEGATIVO_NOTA,
  PARA_LA_CENTRAL_NOTA,
  PARA_LA_TIENDA_LABEL,
} from "@/app/(app)/cierres-admin/_components/cierre-labels";

/**
 * 💰 FICHA 393 (2026-09-08) — GUARDIA PERENNE DEL VOCABULARIO DEL CIERRE DE BODEGA.
 *
 * ── QUÉ PROTEGE
 * En las superficies de un cierre de BODEGA, cada cifra se llama de UNA sola forma y ninguna
 * aparece dos veces con dos nombres (R23/R24). Esta guardia vigila tres cosas que el compilador
 * no puede ver, porque son literales y ausencias:
 *
 *  1. **«Ajustes» no vuelve** (R35). Era el rótulo de la columna que contenía el pago al
 *     mensajero y el ingreso de bodega: **ninguno de los dos es un ajuste**, y con ese nombre la
 *     tarjeta escondía justo el número que la satélite necesita para operar.
 *  2. **Ninguna cifra que ya es LÍNEA de una cascada vuelve como tarjeta suelta** (R34/R24). El
 *     detalle tenía cinco —«Ingreso bruto», «Pago a mensajeros», «Ganancia», «Ingreso de bodega
 *     por rechazos» y «Pago a tienda»—: las mismas cifras, sin cascada y con nombres que no son
 *     los que usa quien las lee. Ahí empezó la ficha.
 *  3. **`CENTRAL_DEBE_LABEL` no se reusa** (D6/A8). «Central debe» ya significa algo muy
 *     concreto y distinto —el pago a mensajeros que el EFECTIVO no alcanzó a cubrir, en la
 *     pantalla de consolidación, ANTES de solicitar—. Darle un segundo significado en la
 *     pantalla de al lado es exactamente lo que R24 prohíbe.
 *
 * Y una cuarta, de la familia money-safe (R14): en las superficies de las cascadas no hay
 * `Number(`, `parseFloat(`, `parseInt(` ni `.toFixed(` — el navegador no hace aritmética de
 * dinero.
 *
 * ── EL BARRIDO MONEY-SAFE LEE `cierre-factura.tsx` ENTERO, Y EL DEL VOCABULARIO NO
 * Corregido el 2026-09-08 tras la revisión de la ficha (BLOQUEANTE 1), con la mutación que lo
 * demostró: `money(String(Number(monto)))` en el importe de «Para la central» dejaba **197
 * archivos de guardias y 2914 tests en verde**. El motivo era que los dos trozos de bodega que
 * se cortan más abajo NO contienen `LineaMonto` ni `conOperador` —viven arriba, fuera de la
 * `<section>` y fuera del componente— y son justo la función que formatea CADA línea de dinero
 * de la cascada B en la tarjeta.
 *
 * Las dos mitades de esta guardia leen cosas distintas A PROPÓSITO, y la asimetría no es un
 * descuido:
 *
 *  · El **censo del vocabulario** (Ajustes / cifra suelta / Central debe) se queda en los DOS
 *    TROZOS: el archivo sirve a cuatro superficies y las otras tres siguen diciendo «Ajustes»
 *    a propósito (R21). Barrer el archivo entero lo pondría rojo por un motivo legítimo.
 *  · El barrido **money-safe** lee el ARCHIVO ENTERO: «no se hace aritmética de dinero en el
 *    navegador» vale para las cuatro superficies por igual, no hay ninguna a la que se le
 *    permita, y los formateadores son COMPARTIDOS. Hoy sale verde sin excepciones: el archivo
 *    no tiene ni un `Number(` ni un `.toFixed(` en sus 2.000 líneas.
 *
 * ── QUÉ ES «UNA SUPERFICIE DEL CIERRE DE BODEGA», Y QUÉ NO
 * Decisión del frontend_dev, escrita aquí porque de ella depende el veredicto:
 *
 *  · SÍ lo son los tres listados de cierres de bodega, el detalle del maestro, el componente de
 *    la cascada y —dentro del comprobante compartido— **sólo** la rama del cierre de bodega.
 *  · NO lo es `ConsolidacionBodegaModule.tsx`. Esa pantalla enseña los agregados de los
 *    `cierre_dia` que TODAVÍA NO están consolidados: ahí no hay cierre de bodega, y sus tarjetas
 *    de pago al mensajero, ingreso de bodega y «Central debe» hablan de otra cosa. Incluirla
 *    pondría roja esta guardia por un motivo legítimo, que es la forma más rápida de que una
 *    guardia se acabe ignorando. El listado que esa pantalla monta —el de los solicitados— SÍ
 *    está censado, en su propio archivo.
 *  · `cierre-factura.tsx` es de CUATRO superficies (cierre de mensajero del admin, cierre propio
 *    del mensajero, `cierre_dia` consolidable y cierre de bodega). Las tres primeras siguen
 *    diciendo «Ajustes» a propósito (R21), así que del archivo se extraen sólo los dos trozos
 *    que son de bodega y se censan ESOS.
 *
 * ── EL BLOQUE DE AUTOCOMPROBACIÓN, Y POR QUÉ ES OBLIGATORIO
 * Una guardia estática rota no falla: **calla**. Si el recorrido no encontrara archivos, o el
 * quitador de comentarios devolviera vacío, o el extractor del trozo de bodega cortara una
 * cadena de dos caracteres, el censo saldría sin infractores y el verde no significaría nada.
 * Mismo patrón que `flete-por-rechazo-censo.guardia.test.ts` (ficha 338).
 */

const RAIZ = path.resolve(__dirname, "../../..");
const COMPONENTES = path.join(RAIZ, "app", "(app)", "cierres-admin", "_components");
const HOJA = path.join(COMPONENTES, "cierre-factura.tsx");

/** Los archivos que son ENTEROS una superficie del cierre de bodega. */
const SUPERFICIES_ENTERAS = [
  "CierresBodegaAdminModule.tsx",
  "CierresBodegaSolicitadosLista.tsx",
  "CierresBodegaResueltosLista.tsx",
  "CascadaDinero.tsx",
] as const;

/** Un trozo de código censado, con el nombre por el que se reporta un hallazgo. */
interface Superficie {
  nombre: string;
  codigo: string;
}

/** Todos los `.ts`/`.tsx` de `app/(app)/cierres-admin/`, recursivo. Sólo para la autocomprobación. */
function fuentesDeCierresAdmin(dir: string = path.join(RAIZ, "app", "(app)", "cierres-admin")): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completa = path.join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...fuentesDeCierresAdmin(completa));
    else if (/\.tsx?$/.test(entrada.name)) salida.push(completa);
  }
  return salida;
}

/**
 * El trozo del comprobante que es del CIERRE DE BODEGA.
 *
 * Se cortan dos: la `<section>` de la cascada —la que sustituye a la columna «Ajustes» cuando
 * hay `cascadaCentral`— y el cuerpo de `CierreBodegaFacturaResumen`. El corte cuenta llaves para
 * no partirse dentro de una expresión, igual que hace `cierre-detalle-superficies.guardia`.
 */
function trozosDeBodegaEnLaHoja(fuente: string): Superficie[] {
  const trozos: Superficie[] = [];

  const inicioSeccion = fuente.indexOf("<section aria-label={CASCADA_CENTRAL_TITULO}>");
  if (inicioSeccion !== -1) {
    const fin = fuente.indexOf("</section>", inicioSeccion);
    trozos.push({
      nombre: "cierre-factura.tsx › la columna de la cascada",
      codigo: fuente.slice(inicioSeccion, fin === -1 ? fuente.length : fin),
    });
  }

  const inicioFn = fuente.indexOf("export function CierreBodegaFacturaResumen(");
  if (inicioFn !== -1) {
    // El conteo arranca en el `) {` que abre el CUERPO, no en la firma: la lista de props se
    // desestructura con llaves, y contar desde el nombre cerraría el bloque al acabar la firma
    // — devolviendo 68 caracteres que pasarían el censo sin haber mirado el componente.
    const cuerpo = fuente.indexOf(") {", inicioFn);
    let llaves = 0;
    let visto = false;
    let i = cuerpo === -1 ? inicioFn : cuerpo;
    for (; i < fuente.length; i += 1) {
      const c = fuente[i];
      if (c === "{") {
        llaves += 1;
        visto = true;
      } else if (c === "}") {
        llaves -= 1;
        if (visto && llaves === 0) break;
      }
    }
    trozos.push({
      nombre: "cierre-factura.tsx › CierreBodegaFacturaResumen",
      codigo: fuente.slice(inicioFn, i + 1),
    });
  }

  return trozos;
}

/** El código de un componente de `cierres-admin`, ya sin comentarios. */
function leer(archivo: string): string {
  return quitarComentarios(readFileSync(path.join(COMPONENTES, archivo), "utf8"));
}

/** Los cuatro archivos que son ENTEROS del cierre de bodega, ya leídos. */
function superficiesEnteras(): Superficie[] {
  return SUPERFICIES_ENTERAS.map((archivo) => ({ nombre: archivo, codigo: leer(archivo) }));
}

/** El censo del VOCABULARIO: los cuatro archivos completos + los dos trozos del comprobante. */
function superficies(): Superficie[] {
  return [...superficiesEnteras(), ...trozosDeBodegaEnLaHoja(quitarComentarios(readFileSync(HOJA, "utf8")))];
}

/**
 * El censo MONEY-SAFE: los cuatro archivos completos + `cierre-factura.tsx` **entero**.
 *
 * No los dos trozos: `LineaMonto` y `conOperador` —las funciones que pintan CADA importe de la
 * cascada B en la tarjeta— quedan fuera de ellos, y ahí es donde se pierde un céntimo. La
 * prohibición de hacer aritmética de dinero en el navegador no tiene excepción por superficie,
 * así que aquí el recorte no se justifica y no se hace.
 */
function superficiesMoneySafe(): Superficie[] {
  return [
    ...superficiesEnteras(),
    {
      nombre: "cierre-factura.tsx › el archivo ENTERO",
      codigo: quitarComentarios(readFileSync(HOJA, "utf8")),
    },
  ];
}

const SUPERFICIES = superficies();
const SUPERFICIES_MONEY_SAFE = superficiesMoneySafe();

/** Las líneas de un código que casan un patrón (los comentarios ya están fuera). */
function lineasQueCasan(codigo: string, patron: RegExp): number[] {
  const salida: number[] = [];
  codigo.split("\n").forEach((linea, i) => {
    if (patron.test(linea)) salida.push(i + 1);
  });
  return salida;
}

/** Un hallazgo por línea infractora, con la superficie donde vive. */
function censar(patron: RegExp): string[] {
  return SUPERFICIES.flatMap((s) =>
    lineasQueCasan(s.codigo, patron).map((linea) => `${s.nombre}:${linea}`),
  );
}

/**
 * El rótulo retirado y su identificador. Se persiguen los DOS: quitar el literal y dejar la
 * constante importada deja la puerta abierta a volver a pintarla, y quitar la constante y
 * escribir el literal a mano es el mismo defecto con otra letra.
 */
const AJUSTES = /(?:\bAjustes\b|RESUMEN_AJUSTES_TITULO)/u;

/** Las cinco tarjetas sueltas que la ficha absorbió: rótulos y componentes. */
const CIFRA_SUELTA =
  /(?:INGRESO_BRUTO_LABEL|GANANCIA_LABEL|GANANCIA_NOTA|GANANCIA_NOTA_BODEGA|PAGO_TIENDA_LABEL|PAGO_TIENDA_NOTA|INGRESO_BODEGA_RECHAZOS_LABEL|MontoDerivadoCard|PagoMensajeroTotal|IngresoBodegaRechazosTotal|Ingreso bruto|Pago a tienda|Total a pagar a mensajeros)/u;

/** La etiqueta que YA significa otra cosa en la consolidación (D6/A8). */
const CENTRAL_DEBE = /(?:CENTRAL_DEBE_LABEL|CENTRAL_DEBE_NOTA|CentralDebeTotal|\bCentral debe\b)/u;

/** Los rótulos que la ficha SÍ pone: si el extractor no los ve, no está leyendo nada. */
const ROTULOS_NUEVOS =
  /(?:CASCADA_CENTRAL_TITULO|PARA_LA_CENTRAL_LABEL|GANA_BODEGA_SATELITE_LABEL)/u;

describe("393 — autocomprobación del censo (una guardia estática rota no falla: calla)", () => {
  it("los archivos censados existen y el recorrido ve `cierres-admin` entero", () => {
    for (const archivo of SUPERFICIES_ENTERAS) {
      expect(
        existsSync(path.join(COMPONENTES, archivo)),
        `${archivo} no existe: la guardia se quedó vigilando un archivo muerto`,
      ).toBe(true);
    }
    expect(existsSync(HOJA)).toBe(true);
    // El 2026-09-08 había 31 fuentes en `cierres-admin`. El umbral es holgado a propósito: mide
    // que el recorrido FUNCIONA, no cuántos componentes tiene la pantalla.
    expect(fuentesDeCierresAdmin().length).toBeGreaterThan(15);
  });

  it("los dos trozos del comprobante se cortaron de verdad, y son de bodega", () => {
    const trozos = trozosDeBodegaEnLaHoja(quitarComentarios(readFileSync(HOJA, "utf8")));
    expect(
      trozos.length,
      "no se pudo aislar la parte de bodega de `cierre-factura.tsx`. O el componente se renombró, " +
        "o la columna de la cascada dejó de existir. En los dos casos, mirar ESTO antes de creerle " +
        "al censo de abajo.",
    ).toBe(2);
    for (const trozo of trozos) {
      expect(trozo.codigo.length, `${trozo.nombre} salió cortado a nada`).toBeGreaterThan(200);
    }
    // El trozo de la columna es el de la cascada, no el de «Ajustes» de las otras tres.
    expect(trozos[0].codigo).toMatch(/PARA_LA_CENTRAL_LABEL/);
    expect(trozos[1].codigo).toMatch(/cascadaCentral/);
  });

  it("el barrido money-safe SÍ ve `LineaMonto` y `conOperador`, que los dos trozos no alcanzan", () => {
    // La autocomprobación que faltaba, y que costó un bloqueante: los dos trozos de arriba
    // dejan fuera precisamente la función que formatea cada importe de la cascada B en la
    // tarjeta, así que un `Number(monto)` puesto ahí no lo veía nadie. Se afirman las DOS
    // cosas: que el trozo NO llega y que el barrido money-safe SÍ.
    const trozos = trozosDeBodegaEnLaHoja(quitarComentarios(readFileSync(HOJA, "utf8")));
    for (const trozo of trozos) {
      expect(
        trozo.codigo,
        `${trozo.nombre} pasó a contener el formateador; si eso es a propósito, este caso hay ` +
          "que reescribirlo, no borrarlo",
      ).not.toMatch(/function (?:LineaMonto|conOperador)\(/);
    }

    const hoja = SUPERFICIES_MONEY_SAFE.find((s) => s.nombre.startsWith("cierre-factura.tsx"));
    expect(hoja, "el barrido money-safe dejó de leer el comprobante").toBeDefined();
    expect(hoja?.codigo).toMatch(/function LineaMonto\(/);
    expect(hoja?.codigo).toMatch(/function conOperador\(/);
    // Y lee el archivo ENTERO, no un recorte: los dos trozos juntos son una fracción de él.
    const recortado = trozos.reduce((n, t) => n + t.codigo.length, 0);
    expect(hoja?.codigo.length ?? 0).toBeGreaterThan(recortado * 2);
  });

  it("el MISMO extractor encuentra los rótulos NUEVOS: sí lee código, y el cambio está puesto", () => {
    // Si esto sale vacío, el censo de abajo no prueba nada: o el barrido no lee, o las cascadas
    // no están montadas. En cualquiera de los dos casos, el verde de abajo es falso.
    const nuevos = censar(ROTULOS_NUEVOS);
    expect(nuevos.length, "los rótulos de las cascadas no aparecen en ninguna superficie").toBeGreaterThan(
      4,
    );
    // Y aparecen en el comprobante Y en el detalle: las dos superficies, no una.
    const donde = new Set(nuevos.map((h) => h.split(":")[0]));
    expect([...donde]).toContain("CierresBodegaAdminModule.tsx");
    expect([...donde].some((n) => n.startsWith("cierre-factura.tsx"))).toBe(true);
  });

  it("el detector marca el literal y NO marca el comentario", () => {
    const conLiteral = 'const X = "Ajustes";';
    const enComentario = "// La columna se llamaba Ajustes hasta la ficha 393.\nconst y = 1;";
    const enBloque = "/**\n * Ajustes: el rótulo que se retiró.\n */\nconst z = 2;";

    expect(lineasQueCasan(quitarComentarios(conLiteral), AJUSTES)).toEqual([1]);
    expect(lineasQueCasan(quitarComentarios(enComentario), AJUSTES)).toEqual([]);
    expect(lineasQueCasan(quitarComentarios(enBloque), AJUSTES)).toEqual([]);
    // Y los otros dos detectores, con su canario y su contraprueba.
    expect(lineasQueCasan('label={GANANCIA_LABEL}', CIFRA_SUELTA)).toEqual([1]);
    expect(lineasQueCasan('label={NETO_ORDENEX_LABEL}', CIFRA_SUELTA)).toEqual([]);
    expect(lineasQueCasan('<CentralDebeTotal value={x} />', CENTRAL_DEBE)).toEqual([1]);
    expect(lineasQueCasan('<CascadaDinero titulo={x} />', CENTRAL_DEBE)).toEqual([]);
  });
});

describe("393 — censo: el vocabulario del cierre de bodega (R23/R24/R34/R35)", () => {
  it("ninguna superficie del cierre de bodega dice «Ajustes» (R35)", () => {
    expect(
      censar(AJUSTES),
      "«Ajustes» volvió a una superficie del cierre de bodega. Ese bloque contiene el pago al " +
        "mensajero y lo que gana la bodega satélite: ninguno de los dos es un ajuste, y con ese " +
        "nombre la tarjeta esconde el número que la satélite necesita para operar.",
    ).toEqual([]);
  });

  it("ninguna cifra que ya es LÍNEA de una cascada vuelve como tarjeta suelta (R24/R34)", () => {
    expect(
      censar(CIFRA_SUELTA),
      "una cifra que ya es línea de una cascada volvió a montarse suelta en una superficie del " +
        "cierre de bodega. Es el defecto con el que empezó la ficha: la misma cifra dos veces, " +
        "con dos nombres, en la misma pantalla. Los componentes siguen existiendo para el cierre " +
        "de MENSAJERO (R30), pero aquí no se montan.",
    ).toEqual([]);
  });

  it("«Central debe» NO se reusa para el resultado de la cascada (D6/A8)", () => {
    expect(
      censar(CENTRAL_DEBE),
      "«Central debe» ya significa otra cosa: el pago a mensajeros que el EFECTIVO no alcanzó a " +
        "cubrir, en la consolidación, antes de solicitar. El resultado de la cascada se llama " +
        "«Para la central» y no cambia de nombre ni cuando sale negativo.",
    ).toEqual([]);
  });

  it("money-safe: el navegador no hace aritmética de dinero en estas superficies (R14)", () => {
    const infractoras: string[] = [];
    for (const s of SUPERFICIES_MONEY_SAFE) {
      for (const prohibida of LLAMADAS_PROHIBIDAS_EN_DINERO) {
        for (const linea of lineasQueCasan(s.codigo, prohibida)) {
          infractoras.push(`${s.nombre}:${linea} (${prohibida.source})`);
        }
      }
    }
    expect(
      infractoras,
      "una superficie de las cascadas convierte un importe a número. Los importes viajan como " +
        "STRING de punta a punta y llegan YA derivados del servidor: aquí sólo se formatean. " +
        "`cierre-factura.tsx` se lee ENTERO (no los dos trozos de bodega): sus formateadores " +
        "—`LineaMonto`, `conOperador`— los comparten las cuatro superficies del comprobante.",
    ).toEqual([]);
  });
});

/**
 * ── EL VALOR DE LOS RÓTULOS, ESCRITO A MANO
 *
 * Añadido el 2026-09-08 tras la revisión de la ficha (BLOQUEANTE 2). Todos los tests que tocan
 * estas líneas importaban la constante y la comparaban CONSIGO MISMA, así que su valor no
 * estaba anclado en ningún sitio: cambiar `GANA_BODEGA_SATELITE_LABEL` a «Ingreso bodega
 * rechazos» —el vocabulario de columna que **R25 prohíbe expresamente**— dejaba 68 tests de las
 * tres superficies y 2914 de las 197 guardias **en verde**.
 *
 * Aquí los esperados se escriben A MANO, nunca derivados de la constante: es el mismo patrón
 * con el que `cierres-bodega-descarga-columnas.test.ts` ancla «Para la central» como encabezado
 * del archivo, y el único que hace que un renombrado se note. Cambiar uno de estos literales es
 * legítimo —el vocabulario lo decide el humano—, pero entonces se cambia AQUÍ también, a mano y
 * a la vista, que es justo lo que se quiere que pase.
 *
 * Y no es una hipótesis: **Q4 sigue abierta** (renombrar `INGRESO_BODEGA_RECHAZOS_LABEL` en
 * toda la app). Si alguien ejecuta ese rename con un buscar-y-reemplazar, esta es la red que
 * distingue «la línea del cierre de bodega» de «la del cierre de mensajero».
 */
describe("393 — el VALOR de los rótulos y las notas, escrito a mano (R19/R23/R25/R33)", () => {
  it.each([
    ["CASCADA_DUENO_TITULO", CASCADA_DUENO_TITULO, "De quién es el dinero"],
    ["CASCADA_CENTRAL_TITULO", CASCADA_CENTRAL_TITULO, "Lo que va a la central"],
    ["PARA_LA_TIENDA_LABEL", PARA_LA_TIENDA_LABEL, "Para la tienda"],
    ["PARA_LA_CENTRAL_LABEL", PARA_LA_CENTRAL_LABEL, "Para la central"],
    ["NETO_ORDENEX_LABEL", NETO_ORDENEX_LABEL, "Neto de Ordenex"],
    ["COBRADO_SOBRE_RECAUDADO_LABEL", COBRADO_SOBRE_RECAUDADO_LABEL, "Cobrado sobre lo recaudado"],
    ["FACTURADO_ORDENEX_LABEL", FACTURADO_ORDENEX_LABEL, "Lo que Ordenex facturó"],
    ["GANA_BODEGA_SATELITE_LABEL", GANA_BODEGA_SATELITE_LABEL, "Gana la bodega satélite"],
  ])("%s dice exactamente lo aprobado", (_nombre, constante, literal) => {
    expect(constante).toBe(literal);
  });

  it.each([
    [
      "PARA_LA_CENTRAL_NOTA",
      PARA_LA_CENTRAL_NOTA,
      "Lo recaudado menos el pago a los mensajeros y menos lo que gana la bodega satélite por los rechazos.",
    ],
    [
      "PARA_LA_CENTRAL_NEGATIVO_NOTA",
      PARA_LA_CENTRAL_NEGATIVO_NOTA,
      "Los descuentos superan lo recaudado en este cierre: la satélite no entrega nada y la central pone la diferencia.",
    ],
    [
      "EFECTIVO_NO_CUBRE_NOTA",
      EFECTIVO_NO_CUBRE_NOTA,
      "El efectivo recaudado no cubre los descuentos: parte de lo recaudado entró por SINPE o transferencia.",
    ],
    [
      "GANA_BODEGA_SATELITE_NOTA",
      GANA_BODEGA_SATELITE_NOTA,
      "Lo que se le reconoce a la bodega satélite por los rechazos. No es un movimiento de caja registrado.",
    ],
    [
      "FLETE_RECHAZO_NO_DEDUCIBLE_NOTA",
      FLETE_RECHAZO_NO_DEDUCIBLE_NOTA,
      "Se le factura a la tienda, pero no sale de lo recaudado: un rechazo no cobra contra entrega.",
    ],
  ])("%s dice exactamente lo aprobado", (_nombre, constante, literal) => {
    // Las notas son la mitad del requisito, no adorno: R26 pide que se diga de qué resta sale
    // el número, R36 qué significa el negativo y R37 por qué el efectivo puede no alcanzar.
    // Una nota vaciada o cambiada por otra deja el número igual de solo que antes de la ficha.
    expect(constante).toBe(literal);
  });

  it("«Gana la bodega satélite» NO repite el vocabulario de la columna (R25)", () => {
    // R25 no pide UN texto concreto: pide que la línea se nombre desde el punto de vista de
    // quien mira y NO repitiendo el nombre de la columna `total_ingreso_bodega_rechazos`. El
    // caso de arriba fija el texto de hoy; éste fija la REGLA, así que el siguiente rótulo que
    // se proponga tiene que cumplirla también.
    const prohibidos = [
      "Ingreso de bodega por rechazos", // el rótulo del cierre de MENSAJERO, que sigue vivo allí
      "Ingreso bodega rechazos",
      "total_ingreso_bodega_rechazos",
      "ingreso_bodega_rechazos",
    ];
    for (const prohibido of prohibidos) {
      expect(
        GANA_BODEGA_SATELITE_LABEL.toLowerCase(),
        `la línea del cierre de bodega volvió a llamarse «${prohibido}»: es el nombre de la ` +
          "COLUMNA, no el de lo que la satélite lee. Y colisiona con el rótulo del cierre de " +
          "mensajero, donde la bodega puede ser la central y por eso allí sí se llama así.",
      ).not.toContain(prohibido.toLowerCase());
    }
    // Y sigue diciendo QUIÉN gana: sin sujeto, el número vuelve a no tener dueño.
    expect(GANA_BODEGA_SATELITE_LABEL.toLowerCase()).toContain("satélite");
  });

  it("los dos resultados RIMAN, y ninguno reusa «Central debe» (D2′/D6)", () => {
    // «Para la tienda» y «Para la central» son la misma pregunta contestada dos veces; que
    // tengan la misma forma es lo que hace que las dos cascadas se lean como una sola historia.
    expect(PARA_LA_TIENDA_LABEL.startsWith("Para la")).toBe(true);
    expect(PARA_LA_CENTRAL_LABEL.startsWith("Para la")).toBe(true);
    expect(PARA_LA_CENTRAL_LABEL).not.toBe("Central debe");
    expect(PARA_LA_CENTRAL_LABEL).not.toBe(PARA_LA_TIENDA_LABEL);
  });
});
