import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { quitarComentarios } from "../../fixtures/sin-comentarios";

/**
 * 💰 FICHA 393 (2026-09-08) — GUARDIA: **«Para la central» se ve en LAS DOS pantallas donde
 * aparece la tarjeta de un cierre de bodega, y en NINGUNA otra superficie del comprobante.**
 *
 * ── LA RED PERENNE DE R38, Y POR QUÉ HACE FALTA
 * El número que la bodega satélite necesita para operar —lo que le entrega a la central— vive en
 * la TARJETA, porque la satélite **sólo ve la tarjeta**: su módulo de consolidación monta el
 * listado de cierres solicitados sin acción de abrir detalle. Hoy las tres superficies que montan
 * `<CierreBodegaFacturaResumen>` le pasan la fila entera del servidor, así que la cascada les
 * llega por construcción. Lo que esta guardia impide es que **una cuarta nazca sin ella**: si
 * alguien montara la tarjeta con un objeto compuesto a mano, el compilador se lo exigiría campo a
 * campo… y quien lo escriba rellenará `paraLaCentral: "0.00"` para que compile. Un cero inventado
 * en una pantalla de dinero es peor que no tener el número.
 *
 * ── LA OTRA MITAD: R21/R39
 * El comprobante lo comparten CUATRO superficies. La prop `cascadaCentral` es **opcional** —tiene
 * que serlo: las otras tres no tienen cierre de bodega del que hablar— y por eso el typecheck no
 * dice ni una palabra si alguien se la pasa al comprobante del cierre de mensajero o al del
 * `cierre_dia` consolidable. El resultado sería una cascada de bodega en una pantalla que no es
 * de bodega, con los rótulos de otra cosa.
 *
 * ── LO QUE NO AFIRMA
 * Que el VALOR sea correcto. Aquí se comprueba de dónde sale el dato —del servidor, no de un
 * literal—; que ese dato sea la resta correcta lo sostienen `cascadas-cierre-bodega.test.ts` (la
 * aritmética), `cierre-bodega-repository.test.ts` (que las ocho lecturas lo traen igual) y
 * `DineroIdentidadesEnPantalla` (que la resta cierra en pantalla).
 */

const RAIZ = path.resolve(__dirname, "../../..");
const APP = path.join(RAIZ, "app");

/** El archivo que DECLARA los cuatro comprobantes: no es una superficie, se salta por ruta. */
const DECLARANTE = "cierre-factura.tsx";

/** El comprobante que SÍ lleva la cascada. */
const TARJETA_DE_BODEGA = "CierreBodegaFacturaResumen";

/** Los tres que NO pueden recibirla nunca (R21/R39). */
const COMPROBANTES_AJENOS = [
  "CierreFacturaResumen",
  "CierreFacturaResumenPropio",
  "CierreConsolidableFacturaResumen",
] as const;

/** Todos los `.tsx` de `app/**`, recursivo. */
function tsxDeApp(dir: string = APP): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completa = path.join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...tsxDeApp(completa));
    else if (entrada.name.endsWith(".tsx")) salida.push(completa);
  }
  return salida;
}

interface Uso {
  archivo: string;
  componente: string;
  etiqueta: string;
}

/**
 * Los usos de un componente por su etiqueta JSX, con la prosa ya fuera: un ejemplo dentro de un
 * comentario no es una superficie.
 *
 * El nombre se exige COMPLETO —el carácter siguiente no puede ser parte de un identificador—, y
 * no es un detalle: `<CierreFacturaResumen` es prefijo de `<CierreFacturaResumenPropio`, así que
 * un `indexOf` a secas contaría el segundo como el primero y los dos casos de abajo se estarían
 * mintiendo el uno al otro.
 */
function usosDe(componente: string): Uso[] {
  const usos: Uso[] = [];
  for (const archivo of tsxDeApp()) {
    if (path.basename(archivo) === DECLARANTE) continue;
    const fuente = quitarComentarios(readFileSync(archivo, "utf8"));

    let desde = fuente.indexOf(`<${componente}`);
    while (desde !== -1) {
      const siguiente = fuente[desde + componente.length + 1] ?? "";
      let llaves = 0;
      let i = desde;
      for (; i < fuente.length; i += 1) {
        const c = fuente[i];
        if (c === "{") llaves += 1;
        else if (c === "}") llaves -= 1;
        else if (c === ">" && llaves === 0) break;
      }
      if (!/[\w$]/.test(siguiente)) {
        usos.push({
          archivo: path.relative(RAIZ, archivo).replaceAll("\\", "/"),
          componente,
          etiqueta: fuente.slice(desde, i + 1),
        });
      }
      desde = fuente.indexOf(`<${componente}`, i);
    }
  }
  return usos;
}

/**
 * El CUERPO de una función exportada, contando llaves desde el `) {` que lo abre.
 *
 * No vale cortar «hasta la siguiente `export function`»: entre dos comprobantes exportados vive
 * `HojaResumen`, que NO se exporta y que sí menciona la prop. Un corte por texto la metería
 * dentro del comprobante anterior y este archivo denunciaría a quien no es.
 */
function cuerpoDeFuncion(fuente: string, nombre: string): string {
  const desde = fuente.indexOf(`export function ${nombre}(`);
  expect(desde, `${nombre} desapareció del comprobante`).toBeGreaterThanOrEqual(0);
  const abre = fuente.indexOf(") {", desde);
  let llaves = 0;
  let visto = false;
  let i = abre === -1 ? desde : abre;
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
  return fuente.slice(desde, i + 1);
}

const USOS_BODEGA = usosDe(TARJETA_DE_BODEGA);
const USOS_AJENOS = COMPROBANTES_AJENOS.flatMap((c) => usosDe(c));

describe("393 — autocomprobación: el censo encuentra de verdad las superficies", () => {
  it("el barrido ve `app/**`, y no una carpeta vacía", () => {
    expect(
      tsxDeApp().length,
      "el barrido de `app/**` no encontró apenas archivos: está midiendo un árbol vacío",
    ).toBeGreaterThan(50);
  });

  it("las TRES superficies que montan la tarjeta de bodega están, y son éstas", () => {
    const archivos = [...new Set(USOS_BODEGA.map((u) => u.archivo))].sort();
    expect(
      archivos,
      "o apareció una superficie nueva —y entonces hay que revisarla a mano y añadirla aquí— o " +
        "una de las tres desapareció y esta guardia se quedó vigilando un nombre muerto.",
    ).toEqual([
      // El maestro: la COLA de decisión.
      "app/(app)/cierres-admin/_components/CierresBodegaAdminModule.tsx",
      // El maestro: el HISTÓRICO de resueltos.
      "app/(app)/cierres-admin/_components/CierresBodegaResueltosLista.tsx",
      // El `adminSatelite`: su única superficie, y la que motivó la ficha.
      "app/(app)/cierres-admin/_components/CierresBodegaSolicitadosLista.tsx",
    ]);
  });

  it("y el extractor distingue los cuatro comprobantes, que comparten prefijo", () => {
    // Sin esto, `<CierreFacturaResumenPropio>` contaría como `<CierreFacturaResumen>` y el caso
    // de R21 estaría midiendo otra cosa.
    expect(usosDe("CierreFacturaResumen").every((u) => u.componente === "CierreFacturaResumen")).toBe(
      true,
    );
    expect(USOS_AJENOS.length, "no se encontró ningún comprobante de los otros tres").toBeGreaterThan(
      2,
    );
    const propio = USOS_AJENOS.filter((u) => u.componente === "CierreFacturaResumenPropio");
    expect(propio.length, "el comprobante propio del mensajero dejó de montarse").toBeGreaterThan(0);
  });
});

describe("393 — la cascada a la central llega a las DOS pantallas (R38)", () => {
  it.each(USOS_BODEGA.map((u) => [u.archivo, u] as const))(
    "%s le pasa a la tarjeta el `cierre` del servidor, no un literal",
    (archivo, uso) => {
      expect(
        uso.etiqueta.length,
        `no se pudo aislar la etiqueta de <${TARJETA_DE_BODEGA}> en ${archivo}`,
      ).toBeGreaterThan(20);

      expect(
        uso.etiqueta,
        `${archivo} monta la tarjeta del cierre de bodega SIN pasarle \`cierre\`.`,
      ).toContain("cierre=");

      const valor = uso.etiqueta.match(/cierre=\{([^}]*)\}/)?.[1];
      expect(valor, `\`cierre\` en ${archivo} no se pasa como expresión`).toBeTruthy();
      expect(
        (valor ?? "").trim(),
        `${archivo} compone el \`cierre\` a mano en vez de pasar la fila del servidor. El " +
          "compilador exigiría \`paraLaCentral\` campo a campo, y quien lo escriba pondrá un " +
          "«0.00» para que compile: un cero inventado en una pantalla de dinero es peor que no " +
          "tener el número.`,
      ).toMatch(/^[A-Za-z_$][\w$]*(?:\.[\w$]+)*$/);
    },
  );
});

describe("393 — y NO se cuela en las otras tres superficies (R21/R39)", () => {
  it.each(USOS_AJENOS.map((u) => [`${u.archivo} · <${u.componente}>`, u] as const))(
    "%s no recibe `cascadaCentral`",
    (donde, uso) => {
      expect(
        uso.etiqueta,
        `${donde} recibe la cascada del cierre de bodega. La prop es OPCIONAL —tiene que serlo, ` +
          "esas superficies no tienen cierre de bodega del que hablar— así que el typecheck no " +
          "caza este error: pintaría «Para la central» en el comprobante de un mensajero.",
      ).not.toContain("cascadaCentral");
    },
  );

  it("dentro del archivo que los declara, sólo la tarjeta de bodega pasa la prop", () => {
    const declarante = quitarComentarios(
      readFileSync(path.join(APP, "(app)", "cierres-admin", "_components", DECLARANTE), "utf8"),
    );
    // SIETE menciones, y cada una tiene su sitio (medido el 2026-09-08, con la prosa fuera):
    //   1 · la prop en `HojaResumenProps`
    //   2 · la desestructuración de `HojaResumen`
    //   3 · el `=== undefined` que decide si la columna es «Ajustes» o la cascada
    //   4 · el importe del resultado
    //   5 · el `esMontoNegativo(...)` que enciende la nota del negativo
    //   6 · el `efectivoCubreDescuentos` que enciende la nota del efectivo
    //   7 · el paso desde `CierreBodegaFacturaResumen`
    // Una octava es que alguien la pasó desde otro comprobante. Es una FOTO a propósito: se
    // actualiza a mano, y ese rojo es el momento de mirar dónde está cada una.
    const apariciones = declarante.match(/cascadaCentral/g) ?? [];
    expect(
      apariciones.length,
      "cambió el número de menciones de `cascadaCentral` en el comprobante. Si es un refactor " +
        "legítimo, actualiza este número A MANO después de mirar dónde está cada una.",
    ).toBe(7);

    // Y las otras tres superficies siguen sin mencionarla en su propio cuerpo.
    for (const ajeno of COMPROBANTES_AJENOS) {
      const cuerpo = cuerpoDeFuncion(declarante, ajeno);
      expect(cuerpo.length, `${ajeno} salió cortado a nada`).toBeGreaterThan(200);
      expect(cuerpo, `${ajeno} pasa \`cascadaCentral\``).not.toContain("cascadaCentral");
    }
    // Y la que SÍ la pasa, la pasa: si esto fallara, los tres casos de arriba estarían pasando
    // por vacío —midiendo un archivo donde la prop no existe— en vez de por corrección.
    expect(cuerpoDeFuncion(declarante, TARJETA_DE_BODEGA)).toContain("cascadaCentral");
  });
});
