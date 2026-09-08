import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { quitarComentarios } from "../../fixtures/sin-comentarios";
import { LLAMADAS_PROHIBIDAS_EN_DINERO } from "../../fixtures/money-safe";

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

/** El censo entero: los cuatro archivos completos + los dos trozos del comprobante. */
function superficies(): Superficie[] {
  const enteras = SUPERFICIES_ENTERAS.map((archivo) => ({
    nombre: archivo,
    codigo: quitarComentarios(readFileSync(path.join(COMPONENTES, archivo), "utf8")),
  }));
  return [...enteras, ...trozosDeBodegaEnLaHoja(quitarComentarios(readFileSync(HOJA, "utf8")))];
}

const SUPERFICIES = superficies();

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
    for (const s of SUPERFICIES) {
      for (const prohibida of LLAMADAS_PROHIBIDAS_EN_DINERO) {
        for (const linea of lineasQueCasan(s.codigo, prohibida)) {
          infractoras.push(`${s.nombre}:${linea} (${prohibida.source})`);
        }
      }
    }
    expect(
      infractoras,
      "una superficie de las cascadas convierte un importe a número. Los importes viajan como " +
        "STRING de punta a punta y llegan YA derivados del servidor: aquí sólo se formatean.",
    ).toEqual([]);
  });
});
