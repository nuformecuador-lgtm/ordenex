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
// Feature 207 — el lector vive ahora en su propio módulo, con su propio test (antes no tenía
// ninguno). Lo que cambió al mudarse: quita los comentarios ANTES de escanear, para que una
// mención de la etiqueta en prosa deje de contar como una tabla del archivo. Los totales de
// abajo NO se movieron por ello — se midieron contra el árbol antes y después.
import { etiquetasDataTable } from "./etiquetas-datatable";
// Feature 207 — mismo tratamiento para el detector de montajes: se extrae el predicado (el
// recorrido del árbol se queda aquí, que es quien sabe qué árboles se miran) y deja de leer
// prosa. Los montajes de las dos tablas compartidas NO se movieron: 2 y 2, antes y después.
import { montaComponente } from "./montajes-componente";

const RAIZ = path.resolve(__dirname, "../../..");

/**
 * Feature 172 (T H.1) — los DOS árboles de UI, no solo `app/`.
 *
 * Hasta hoy la guardia recorría únicamente `app/`, y eso NO era una elección: era el punto
 * ciego de que ninguna tabla hubiera nacido todavía fuera de ahí. La 172 monta la lista de
 * comprobantes en DOS pantallas y por eso su `<DataTable>` vive en `components/shared/`:
 * con el recorrido viejo, esa tabla no existía para el censo y R57 se habría dado por
 * cumplido sin que nada lo vigilara. Al abrir el recorrido apareció además una tabla
 * PREEXISTENTE que el censo nunca había visto (`components/private/analytics/TablaResumen`),
 * declarada abajo con su estado real.
 */
const ARBOLES_UI = ["app", "components"] as const;

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
//
// Feature 172 (T H.1): 29 → 31 archivos y 30 → 32 instancias, y NINGUNA de las dos de más es
// una tabla que naciera hoy: son las dos que el recorrido viejo no veía por pararse en `app/`
// (`components/shared/liquidacion/PagosRegistradosTabla` de esta feature y
// `components/private/analytics/TablaResumen`, de la 130). Los números se leyeron del ÁRBOL
// —la guardia se vio fallar con `31 recibido / 29 esperado` antes de tocarlos—, no de ningún
// documento. Censo total: 33 tablas = 32 `<DataTable>` + 1 `<table>` cruda.
//
// chore «borrar código muerto de UI» (2026-08-07): 31 → 30 archivos y 32 → 31 instancias. La
// que falta NO es una tabla que se haya dejado de vigilar: es `ZonasModule.tsx`, borrada por
// decisión humana junto con `ZonaForm` y `zonas-columns` porque NINGUNA ruta la montaba (no
// existe `configuracion/zonas/page.tsx`). Estaba censada `fuera` por ese mismo motivo, así
// que baja también el nº de exclusiones con `<DataTable>` (6 → 5) y el censo total (33 → 32).
// El caso es idéntico al de `OrdenesApartado.tsx` del 2026-07-31, con una diferencia que
// importa: aquélla descargaba y ésta no, así que aquí NO se pierde ninguna descarga.
//
// Feature 196 (T5.2): 30 → 31 archivos y 31 → 32 instancias. La de más es el ranking
// CONGELADO (`ranking/historico/_components/RankingHistoricoModule.tsx`), una pantalla nueva
// que nace `con_descarga`. Censo total: 33 tablas = 32 `<DataTable>` + 1 `<table>` cruda.
// Pedido humano del 2026-08-16: 31 → 25 archivos y 32 → 25 instancias. Las SIETE de menos son
// los listados de CIERRES, que pasaron de tabla a tira de comprobantes; tres de sus archivos
// desaparecieron con ellas y los otros cuatro siguen vivos (uno, `CierreDiaModule`, conserva su
// otra tabla, la de gestiones del día — por eso caen siete instancias pero sólo seis archivos).
// Ninguna descarga se pierde —se mudó al nuevo envoltorio— y por eso esto NO es una baja de
// alcance: el detalle, con los siete nombres, está en `censo-tablas.ts`.
// FEATURE 258 (F3.1): 25 → 26 archivos y 25 → 26 instancias. La de más es el detalle de un
// mensajero del tablero del día (`monitoreo/_components/DetalleMensajeroPanel.tsx`), que pasó
// de una `<Table>` cruda a `<DataTable>`. **No es una tabla nueva para el usuario**: es la
// misma que la feature 192 ya pintaba, ahora sobre la primitiva. Nace `fuera` con su motivo
// escrito en `censo-tablas.ts` (es una vista de lectura dentro de un modal, y R34 de esa
// ficha le prohíbe ofrecer acciones).
// FEATURE 304: 26 → 27 archivos y 26 → 27 instancias. La de más es la tabla que dice qué
// filas de la carga masiva entraron con el monto REDONDEADO y de cuánto a cuánto (el aviso de
// la 299, que hasta ahora moría en el cliente). Nace `fuera`, con su motivo en
// `censo-tablas.ts`: son filas del archivo que la propia tienda acaba de subir, y los dos
// pasos que la montan ya ofrecen sus descargas. Censo total: 28 = 27 `<DataTable>` + 1 cruda.
// FICHA 333 (H1): 27 → 28 archivos y 27 → 28 instancias. La de más es la COLA de cobros de gasto
// fijo por aprobar (`wallet/_components/CobrosGastoFijoPendientesPanel.tsx`), la sección nueva de
// `/wallet`. Nace `fuera` con su motivo en `censo-tablas.ts`: es una cola de decisión efímera y lo
// que se aprueba aterriza en el libro de la caja, que sí descarga. Los números son los MEDIDOS
// contra el árbol —la guardia los cotejó y dijo 28—, no una suma de escritorio. Censo total:
// 29 = 28 `<DataTable>` + 1 cruda.
// FICHA 337 (segunda mitad): 28 → 29 archivos y 28 → 29 instancias. La de más es la COLA DE
// COBROS POR RECHAZO DE TIENDA de `/wallet`, espejo de la que trajo la 333. Nace `fuera` con su
// motivo escrito en el censo. Los números se leyeron del ÁRBOL —esta guardia se vio fallar con
// «29 recibido / 28 esperado» antes de tocarlos—, no de una suma de escritorio. Censo total:
// 30 = 29 `<DataTable>` + 1 cruda.
// FICHA 336 «borrar /mis-pagos y /qr» (2026-08-30): 29 → 28 archivos y 29 → 28 instancias, y es
// la SEGUNDA vez que estos números BAJAN (la primera fue `ZonasModule`, el 2026-08-07). La que
// falta es «Desglose de pagos del mensajero» (`mis-pagos/_components/DesglosePagos.tsx`), que
// desaparece con la pantalla `/mis-pagos`, borrada por decisión humana. A diferencia de
// `ZonasModule`, ésta SÍ descargaba: es la primera descarga que este repo pierde, y se pierde a
// propósito. Los números son los MEDIDOS —esta guardia se vio fallar con «28 recibido /
// 29 esperado» antes de tocarlos—, no una resta de escritorio. Censo total: 29 = 28
// `<DataTable>` + 1 cruda.
// FICHA 339 (B6.1): 28 → 29 archivos y 28 → 29 instancias. La de más es el DESPLEGABLE de una
// fila de la tarjeta «Cómo se compone la ganancia de Ordenex»
// (`wallet/_components/DetalleFilaComposicion.tsx`), que enseña los movimientos que componen el
// importe de esa fila. Nace `fuera` con su motivo escrito en `censo-tablas.ts`: es un recorte
// del mismo libro que «Libro de movimientos de la caja principal», que sí descarga el conjunto
// completo con sus filtros. Esta guardia se vio fallar primero con «hay tablas sin registrar:
// app/(app)/wallet/_components/DetalleFilaComposicion.tsx #1» antes de tocar estos números, que
// es la convención escrita en este propio archivo. Censo total: 30 = 29 `<DataTable>` + 1 cruda.
const TOTAL_ARCHIVOS_CON_DATATABLE = 29;
const TOTAL_INSTANCIAS_DATATABLE = 29;

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

interface InstanciaEnArbol {
  ruta: string;
  indice: number;
  declaraDescarga: boolean;
}

function instanciasDelArbol(): InstanciaEnArbol[] {
  return ARBOLES_UI.flatMap((arbol) => listarTsx(path.join(RAIZ, arbol)))
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

/**
 * Feature 172 (T H.1) — pantallas que MONTAN un componente de tabla compartido.
 *
 * Una tabla que vive en `components/` es UNA instancia de `<DataTable>` en el código y
 * tantas tablas como pantallas la monten para quien las usa. Se exige lo mismo que para
 * importar y para renderizar, porque solo con lo primero un re-export contaría como montaje, y
 * solo con lo segundo lo haría cualquier archivo que nombre el componente de pasada
 * (`AnularPagoDialog` lo cita en su cabecera).
 *
 * Feature 207 — el predicado se mudó a `montajes-componente.ts` y ahora quita los comentarios
 * antes de mirar: exigir import Y JSX mitigaba la prosa pero no la cerraba (un archivo que
 * importe el componente de verdad y lo cite entre ángulos en un comentario colaba). Aquí queda
 * solo el recorrido del árbol.
 */
function montajesEnElArbol(rutaComponente: string): string[] {
  return ARBOLES_UI.flatMap((arbol) => listarTsx(path.join(RAIZ, arbol)))
    .map(rutaRelativa)
    .filter((ruta) => ruta !== rutaComponente)
    .filter((ruta) => montaComponente(readFileSync(path.join(RAIZ, ruta), "utf8"), rutaComponente))
    .sort();
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
    // R2. Las seis exclusiones vigentes: cinco `<DataTable>` y la `<table>` cruda del podio.
    // Ninguna puede acabar ofreciendo la descarga "de paso".
    //
    // Feature 172 (T H.1): entre las excluidas entró `TablaResumen` (analítica), que el
    // recorrido viejo no veía. No es una decisión de alcance nueva de la 172: es una
    // tabla preexistente que pasa a estar vigilada.
    //
    // chore «borrar código muerto de UI» (2026-08-07): 6 → 5 `<DataTable>` excluidas. Sale la
    // de `ZonasModule`, borrada con su módulo. Ninguna decisión de alcance cambia: se retira
    // el archivo que la contenía, no la razón por la que estaba fuera.
    const instancias = instanciasDelArbol();
    const registro = registroPorRuta(CENSO_DATATABLE);

    const excluidas = instancias.filter(
      (inst) => registro.get(inst.ruta)?.tablas[inst.indice]?.estado === "fuera",
    );
    // FEATURE 258 (F3.1): 5 -> 6 exclusiones. La de mas es el detalle del tablero del dia,
    // que pasa de `<Table>` cruda a `<DataTable>` sin cambiar de alcance.
    // FEATURE 304: 6 -> 7. La de mas es el aviso de los montos redondeados de la carga masiva,
    // que nace `fuera` y sin control de descarga (motivo en `censo-tablas.ts`).
    // FICHA 333 (H1): 7 -> 8. La de mas es la cola de cobros de gasto fijo por aprobar, que nace
    // `fuera` y sin control: lo que se aprueba se descarga desde el LIBRO de la caja.
    // FICHA 337 (segunda mitad): 8 -> 9. La de mas es la cola de cobros por rechazo de tienda,
    // `fuera` y sin control por el mismo motivo, palabra por palabra, que su hermana de la 333: lo
    // que se aprueba se descarga desde los libros donde aterriza, no desde la cola.
    // FICHA 339 (B6.1): 9 -> 10. La de mas es el desplegable de una fila de la tarjeta de la
    // ganancia: `fuera` y sin control, porque es un recorte del MISMO libro de la caja, que ya
    // descarga el conjunto completo con sus filtros.
    expect(excluidas.length).toBe(10);
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

    // El censo total vigente: 32 instancias + 1 tabla cruda = 33 tablas (feature 172, T H.1,
    // menos `ZonasModule` —borrada el 2026-08-07 con el árbol de zonas sin montar—, más el
    // ranking congelado que suma la feature 196).
    const totalCensado =
      CENSO_DATATABLE.reduce((n, e) => n + e.tablas.length, 0) +
      CENSO_TABLAS_CRUDAS.reduce((n, e) => n + e.tablas.length, 0);
    // FEATURE 304: 27 → 28, por la tabla del aviso de montos redondeados de la carga masiva.
    // FICHA 333 (H1): 28 → 29, por la cola de cobros de gasto fijo por aprobar.
    // FICHA 337 (segunda mitad): 29 → 30, por la cola de cobros por rechazo de tienda.
    // FICHA 336: 30 → 29, por el desglose de pagos del mensajero, que se va con `/mis-pagos`.
    // FICHA 339 (B6.1): 29 → 30, por el desplegable de una fila de la tarjeta de la ganancia.
    expect(totalCensado).toBe(30);
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
    //
    // Feature 172 (T H.1): 25 → 26 y 6 → 7 al abrir el recorrido a `components/`. La de más
    // dentro de alcance es la lista de comprobantes de la liquidación (nace `con_descarga`);
    // la de más fuera es `TablaResumen`, preexistente y sin consumidor montado.
    //
    // chore «borrar código muerto de UI» (2026-08-07): 7 → 6 fuera de alcance, y las 26
    // dentro de alcance NO se mueven. Esa asimetría es el dato: lo borrado (`ZonasModule`)
    // era una exclusión declarada, no una tabla que descargara — ninguna descarga se pierde.
    //
    // Feature 196 (T5.2): 26 → 27 dentro de alcance y las 6 exclusiones NO se mueven. La de
    // más es el ranking congelado del histórico, que nace descargando: ninguna decisión de
    // alcance previa cambia.
    //
    // FEATURE 258 (F3.1): 6 -> 7 fuera de alcance, y las 20 dentro de alcance NO se mueven.
    // La de mas es el detalle del tablero del dia, que pasa de `<Table>` cruda a
    // `<DataTable>`: cambia la primitiva con la que se pinta, no lo que el usuario puede
    // hacer con ella. Ninguna descarga se gana ni se pierde.
    //
    // FEATURE 304: 7 -> 8 fuera de alcance, y las 20 dentro de alcance NO se mueven. La de más
    // es el aviso de los montos redondeados de la carga masiva: una tabla que EXPLICA un dato
    // del archivo que la tienda acaba de subir, no un conjunto que nadie pueda llevarse.
    //
    // FICHA 333 (H1): 8 -> 9 fuera de alcance, y las 20 dentro de alcance NO se mueven. La de más
    // es la cola de cobros de gasto fijo por aprobar. Esa asimetría es el dato: la ficha añade una
    // pantalla de DECISIÓN, no un listado que alguien quiera llevarse — y ninguna descarga
    // existente se gana ni se pierde con ella.
    //
    // FICHA 337 (segunda mitad): 9 -> 10 fuera de alcance, y las 20 dentro de alcance NO se
    // mueven. La de mas es la cola de cobros por RECHAZO DE TIENDA, espejo de la anterior. La
    // asimetria vuelve a ser el dato: esta ficha anade otra pantalla de DECISION, no un listado
    // que alguien quiera llevarse, y ninguna descarga existente se gana ni se pierde.
    //
    // FICHA 336 (borrar `/mis-pagos` y `/qr`): 20 -> 19 dentro de alcance, y las 10 exclusiones
    // NO se mueven. La asimetria es, otra vez, el dato — pero invertida respecto a todas las
    // anteriores: lo que se fue era una tabla que DESCARGABA, no una exclusion. Es la primera
    // descarga que este censo pierde, y desaparece porque desaparecio su pantalla («Desglose de
    // pagos del mensajero», `/mis-pagos`), no porque alguien le quitara el control.
    //
    // FICHA 339 (B6.1): 10 -> 11 fuera de alcance, y las 19 dentro de alcance NO se mueven. La
    // de mas es el desplegable de una fila de la tarjeta de la ganancia. La asimetria vuelve a
    // ser el dato, y aqui con un motivo que ninguna de las anteriores tenia: lo que este panel
    // enseña YA SE DESCARGA por otra puerta —el libro de la caja, con sus filtros—, asi que una
    // descarga propia seria un segundo archivo del mismo hecho.
    expect(censadas.filter((t) => t.estado === "con_descarga")).toHaveLength(19);
    expect(censadas.filter((t) => t.estado === "fuera")).toHaveLength(11);
  });

  it("una tabla compartida declara TODAS las pantallas que la montan", () => {
    // Feature 172 (T H.1, R57). El censo cuenta `<DataTable>` del código; una tabla que vive
    // en `components/` la ven los usuarios tantas veces como pantallas la monten. Sin esta
    // comprobación, montar la misma tabla en una tercera pantalla no dejaría rastro en
    // ningún sitio: los totales no se moverían y el registro seguiría verde.
    const compartidas = CENSO_DATATABLE.flatMap((entrada) =>
      entrada.tablas
        .filter((tabla) => tabla.montajes !== undefined)
        .map((tabla) => ({ ruta: entrada.ruta, tabla })),
    );
    expect(compartidas.length, "ninguna tabla declara montajes").toBeGreaterThan(0);

    for (const { ruta, tabla } of compartidas) {
      const donde = `${ruta} :: ${tabla.nombre}`;
      // Compartida quiere decir compartida: con un solo montaje, la tabla debería vivir en
      // la pantalla que la usa y no en el árbol común.
      expect(tabla.montajes!.length, `${donde}: un solo montaje`).toBeGreaterThan(1);
      expect([...tabla.montajes!].sort(), `${donde}: montajes declarados`).toEqual(
        montajesEnElArbol(ruta),
      );
    }

    // Y al revés: una tabla de `components/` que gane un consumidor obliga a volver aquí.
    // Es lo que hace que `TablaResumen` no pueda montarse en una pantalla en silencio.
    const montadaSinDeclarar = CENSO_DATATABLE.filter((entrada) =>
      entrada.ruta.startsWith("components/"),
    ).flatMap((entrada) =>
      entrada.tablas
        .filter(
          (tabla) => tabla.montajes === undefined && montajesEnElArbol(entrada.ruta).length > 0,
        )
        .map((tabla) => `${entrada.ruta} :: ${tabla.nombre}`),
    );
    expect(montadaSinDeclarar, "tabla compartida montada sin declarar sus pantallas").toEqual([]);
  });
});
