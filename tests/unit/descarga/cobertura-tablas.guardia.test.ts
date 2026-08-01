// Feature 170 (T0.5) — GUARDIA de cobertura del censo de tablas. Cubre R4 y R2.
//
// El riesgo que cierra: dentro de un año alguien añade una pantalla con tabla y nadie se
// entera de que nació sin descarga (o de que la montó en una tabla declarada fuera de
// alcance). Esta guardia lee el árbol, enumera CADA instancia de `<DataTable>` y la
// contrasta contra el registro declarado en `censo-tablas.ts`:
//
//   - una tabla que no figure en el registro          -> falla (R4)
//   - una tabla registrada `fuera` que monte descarga -> falla (R2)
//   - una tabla registrada `con_descarga` que la haya perdido -> falla (no-regresión)
//   - una entrada del registro que ya no exista en el árbol   -> falla (registro caduco)
//
// La lectura es ESTÁTICA (lo que el archivo dice), como `datatable-descarga-contrato`.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import {
  CENSO_DATATABLE,
  CENSO_TABLAS_CRUDAS,
  type ArchivoCensado,
} from "./censo-tablas";

const RAIZ = path.resolve(__dirname, "../../..");
const ARBOL_UI = "app";

/**
 * Totales del censo VIGENTE: 31 tablas = 30 instancias de `<DataTable>` (en 25 archivos)
 * + 1 `<table>` cruda. Se afirman a propósito: si el árbol crece, este número cambia y
 * obliga a pasar por el registro en vez de sumar una tabla en silencio.
 *
 * Cómo se llegó hasta aquí, porque los números del spec 170 ya no valen como referencia:
 *  - el spec (design §1.4) censó 31 = 30 + 1 en 25 archivos;
 *  - el borrado de `OrdenesApartado.tsx` con la vista legacy `OrdenesRevisionMaestro`
 *    (chore del 2026-07-31) lo bajó a 30 = 29 + 1 en 24 archivos — una tabla menos, y era
 *    `con_descarga`;
 *  - la feature 171 suma el desglose por tienda (`DesgloseMovimientosTienda.tsx`, también
 *    `con_descarga`) y lo devuelve a 31 = 30 + 1 en 25 archivos.
 *
 * Que coincida con el total del spec es CASUALIDAD aritmética: el reparto no es el mismo
 * (allí estaba el apartado de órdenes, aquí el desglose por tienda). Ver la cabecera de
 * `censo-tablas.ts`.
 */
// Feature 170 — FASE 2 (T I.2): 25 → 29 archivos, MISMAS 30 instancias. Cuatro históricos se
// llevaron su `<DataTable>` a un componente propio al pasar a paginación server-side (ver la
// cabecera de `censo-tablas.ts`). Que las instancias no se muevan es justo lo que dice que fue
// una mudanza y no una tabla nueva ni una perdida por el camino.
const TOTAL_ARCHIVOS_CON_DATATABLE = 29;
const TOTAL_INSTANCIAS_DATATABLE = 30;

function listarTsx(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) listarTsx(completo, acc);
    else if (entrada.name.endsWith(".tsx")) acc.push(completo);
  }
  return acc;
}

function rutaRelativa(archivo: string): string {
  return path.relative(RAIZ, archivo).split(path.sep).join("/");
}

/**
 * Devuelve el TEXTO de la etiqueta de apertura de cada `<DataTable …>` del archivo.
 *
 * Hay que parsear de verdad y no partir por líneas: un archivo puede montar dos tablas
 * (`CierresAdminModule`) y solo una declarar `descarga`. Se respetan los parámetros
 * genéricos (`<DataTable<OrdenConError>`), las llaves anidadas de los atributos y las
 * cadenas, de modo que la etiqueta termina en el primer `>` de nivel cero.
 */
export function etiquetasDataTable(fuente: string): string[] {
  const etiquetas: string[] = [];
  const inicio = /<DataTable[\s<>]/g;
  let encontrado: RegExpExecArray | null;
  while ((encontrado = inicio.exec(fuente)) !== null) {
    let i = encontrado.index + "<DataTable".length;
    // Parámetro genérico: `<DataTable<Foo>` — se salta contando `<` y `>`.
    if (fuente[i] === "<") {
      let anguloProfundidad = 0;
      do {
        if (fuente[i] === "<") anguloProfundidad++;
        else if (fuente[i] === ">") anguloProfundidad--;
        i++;
      } while (i < fuente.length && anguloProfundidad > 0);
    }
    let llaveProfundidad = 0;
    let comilla: string | null = null;
    const desde = i;
    while (i < fuente.length) {
      const c = fuente[i];
      if (comilla !== null) {
        if (c === comilla && fuente[i - 1] !== "\\") comilla = null;
      } else if (c === '"' || c === "'" || c === "`") {
        comilla = c;
      } else if (c === "{") {
        llaveProfundidad++;
      } else if (c === "}") {
        llaveProfundidad--;
      } else if (c === ">" && llaveProfundidad === 0) {
        break;
      }
      i++;
    }
    etiquetas.push(fuente.slice(desde, i));
  }
  return etiquetas;
}

interface InstanciaEnArbol {
  ruta: string;
  indice: number;
  declaraDescarga: boolean;
}

function instanciasDelArbol(): InstanciaEnArbol[] {
  return listarTsx(path.join(RAIZ, ARBOL_UI))
    .sort()
    .flatMap((archivo) =>
      etiquetasDataTable(readFileSync(archivo, "utf8")).map((etiqueta, indice) => ({
        ruta: rutaRelativa(archivo),
        indice,
        declaraDescarga: /\bdescarga=/.test(etiqueta),
      })),
    );
}

function registroPorRuta(censo: ArchivoCensado[]): Map<string, ArchivoCensado> {
  return new Map(censo.map((entrada) => [entrada.ruta, entrada]));
}

describe("guardia de cobertura del censo de tablas", () => {
  it("toda tabla del árbol o declara descarga o figura como exclusión justificada", () => {
    // R4. Es el test que hace fallar a una tabla NUEVA sin registrar.
    const instancias = instanciasDelArbol();
    const registro = registroPorRuta(CENSO_DATATABLE);

    const sinRegistrar = instancias.filter((inst) => {
      const entrada = registro.get(inst.ruta);
      return entrada === undefined || entrada.tablas[inst.indice] === undefined;
    });
    expect(
      sinRegistrar.map((i) => `${i.ruta} #${i.indice + 1}`),
      "hay tablas sin registrar en tests/unit/descarga/censo-tablas.ts",
    ).toEqual([]);

    // El registro tampoco puede sobrar: una entrada de un archivo borrado o de una
    // instancia que ya no existe deja de vigilar nada.
    const archivosEnArbol = new Set(instancias.map((i) => i.ruta));
    const instanciasPorRuta = new Map<string, number>();
    for (const inst of instancias) {
      instanciasPorRuta.set(inst.ruta, (instanciasPorRuta.get(inst.ruta) ?? 0) + 1);
    }
    for (const entrada of CENSO_DATATABLE) {
      expect(archivosEnArbol.has(entrada.ruta), `${entrada.ruta} ya no monta DataTable`).toBe(true);
      expect(entrada.tablas.length, `${entrada.ruta}: nº de tablas registradas`).toBe(
        instanciasPorRuta.get(entrada.ruta),
      );
    }

    // Cada tabla registrada dice qué es: o está cableada, o declara la tanda que la
    // cablea, o declara por qué queda fuera. Ninguna sin decisión escrita.
    for (const entrada of CENSO_DATATABLE) {
      for (const tabla of entrada.tablas) {
        const donde = `${entrada.ruta} :: ${tabla.nombre}`;
        expect(tabla.nombre.length, donde).toBeGreaterThan(0);
        if (tabla.estado !== "con_descarga") {
          expect(tabla.nota ?? "", `${donde}: sin motivo/tanda declarados`).not.toBe("");
        }
      }
    }

    // Estado declarado == estado real del código, tabla a tabla.
    for (const inst of instancias) {
      const tabla = registro.get(inst.ruta)!.tablas[inst.indice];
      const donde = `${inst.ruta} #${inst.indice + 1} (${tabla.nombre})`;
      expect(inst.declaraDescarga, `${donde}: estado declarado "${tabla.estado}"`).toBe(
        tabla.estado === "con_descarga",
      );
    }

    // El censo del spec, verificado contra el árbol (design §1.4).
    expect(instanciasPorRuta.size).toBe(TOTAL_ARCHIVOS_CON_DATATABLE);
    expect(instancias.length).toBe(TOTAL_INSTANCIAS_DATATABLE);
  });

  it("las tablas declaradas fuera de alcance no montan control de descarga", () => {
    // R2. Las seis exclusiones del Anexo II: cinco `<DataTable>` y la `<table>` cruda del
    // podio. Ninguna puede acabar ofreciendo la descarga "de paso".
    const instancias = instanciasDelArbol();
    const registro = registroPorRuta(CENSO_DATATABLE);

    const excluidas = instancias.filter(
      (inst) => registro.get(inst.ruta)?.tablas[inst.indice]?.estado === "fuera",
    );
    expect(excluidas.length).toBe(5);
    for (const inst of excluidas) {
      const tabla = registro.get(inst.ruta)!.tablas[inst.indice];
      expect(inst.declaraDescarga, `${inst.ruta} :: ${tabla.nombre}`).toBe(false);
    }

    // La tabla cruda no pasa por `DataTable`, así que se comprueba distinto: el archivo
    // existe y su `<table>` sigue sin ningún control de descarga alrededor.
    for (const entrada of CENSO_TABLAS_CRUDAS) {
      const archivo = path.join(RAIZ, entrada.ruta);
      expect(existsSync(archivo), `${entrada.ruta} no existe`).toBe(true);
      const fuente = readFileSync(archivo, "utf8");
      expect(fuente).toMatch(/<table[\s>]/);
      expect(fuente).not.toMatch(/DescargarDatasetButton/);
      for (const tabla of entrada.tablas) {
        expect(tabla.estado).toBe("fuera");
        expect(tabla.nota ?? "", `${entrada.ruta} :: ${tabla.nombre}`).not.toBe("");
      }
    }

    // El censo total vigente: 30 instancias + 1 tabla cruda = 31 tablas.
    const totalCensado =
      CENSO_DATATABLE.reduce((n, e) => n + e.tablas.length, 0) +
      CENSO_TABLAS_CRUDAS.reduce((n, e) => n + e.tablas.length, 0);
    expect(totalCensado).toBe(31);
  });

  it("la FASE 1 del export queda cerrada: ninguna tabla del censo sigue pendiente", () => {
    // T G.1 — el estado `pendiente` fue el andamio del rollout por tandas: permitía que la
    // suite siguiera verde con 3 tablas cableadas y 22 por cablear. Cerrada la fase, ese
    // andamio se retira, y hace falta un test que lo exija: sin él, «FASE 1 terminada»
    // sería una afirmación de una bitácora, no una propiedad del repo, y una tabla a
    // medias podría convivir con el cierre sin que nada lo dijera.
    //
    // Vigila en los dos sentidos:
    //  (a) ningún `pendiente` en el registro  -> la fase no se cierra con tablas a medias;
    //  (b) los totales del Anexo I y del II   -> ni se cablea una exclusión ni se saca de
    //      alcance una tabla que sí debe descargar, «de paso».
    const censadas = [...CENSO_DATATABLE, ...CENSO_TABLAS_CRUDAS].flatMap((entrada) =>
      entrada.tablas.map((tabla) => ({ ...tabla, ruta: entrada.ruta })),
    );

    const pendientes = censadas
      .filter((tabla) => tabla.estado === "pendiente")
      .map((tabla) => `${tabla.ruta} :: ${tabla.nombre} (${tabla.nota ?? "sin tanda"})`);
    expect(
      pendientes,
      "la FASE 1 del export no puede cerrarse con tablas pendientes de cablear",
    ).toEqual([]);

    // Anexo I: las tablas dentro de alcance, todas descargando. Anexo II: las 6
    // exclusiones, ninguna con control. El reparto se verifica contra el registro, que a
    // su vez se contrasta contra el árbol en el test de arriba.
    //
    // 25: las 24 que quedaron tras borrarse el «Apartado de órdenes por estado» con su
    // vista legacy (2026-07-31) + el desglose por tienda que suma la feature 171. Las
    // exclusiones siguen siendo 6: ni el borrado ni la 171 cambiaron una sola decisión de
    // alcance — el borrado se llevó una tabla que descargaba y la 171 añade otra que
    // descarga.
    expect(censadas.filter((t) => t.estado === "con_descarga")).toHaveLength(25);
    expect(censadas.filter((t) => t.estado === "fuera")).toHaveLength(6);
  });
});
