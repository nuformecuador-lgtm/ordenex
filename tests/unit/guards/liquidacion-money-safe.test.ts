import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import {
  COLUMNAS_DESCARGA_PAGOS_REGISTRADOS,
  filaDescargaPagoRegistrado,
} from "@/components/shared/liquidacion/pagos-registrados-descarga-columnas";
import type { PagoRegistradoDTO } from "@/lib/types/liquidacion";
import {
  LLAMADAS_PROHIBIDAS_EN_DINERO,
  quitarComentarios,
} from "../../fixtures/money-safe";

/**
 * Feature 172 (T H.2, R14 y R56) — BARRIDO TRANSVERSAL de la liquidación.
 *
 * Cada tanda barrió sus propios archivos. Este es el barrido de la feature ENTERA, y existe
 * por un motivo distinto: los barridos por tanda protegen lo que esa tanda escribió, y basta
 * con que la siguiente añada un archivo para que nadie lo mire. Aquí el censo de archivos es
 * explícito y se contrasta contra el disco, así que renombrar o mover una pieza rompe el
 * test en vez de sacarla del alcance en silencio.
 *
 * QUÉ PROHÍBE, Y DÓNDE:
 *
 *  - `Number(`, `parseFloat(`, `parseInt(`: en TODOS los archivos de la feature. Un
 *    `DECIMAL(12,2)` de 11 dígitos no cabe exacto en un `number`, así que convertirlo es
 *    perder céntimos, dé igual el lado del cable.
 *  - `.toFixed(`: solo en el CLIENTE (`app/**`, `components/**`). En `lib/**` es
 *    `Prisma.Decimal.toFixed(2)`, que es la serialización exacta a STRING de escala 2 —el
 *    formato en el que el dinero cruza la frontera— y prohibirla ahí no protegería nada:
 *    obligaría a escribirla de otra manera peor.
 *  - Aritmética de montos en el navegador: ningún archivo de cliente de la feature importa
 *    `Prisma` ni `decimal.js`. Sin la biblioteca de decimales y sin conversión a número, en
 *    el cliente no queda forma de operar con dinero: solo de pintarlo.
 *
 * El barrido se hace sobre el CÓDIGO, no sobre el texto crudo: los docstrings de este árbol
 * citan a propósito lo prohibido («money-safe: sin parseFloat/Number»), y un barrido literal
 * fallaría por CITARLO. La contraprueba de abajo mide las dos direcciones: caza la llamada
 * colada y no caza la cita.
 */

const RAIZ = path.resolve(__dirname, "../../..");

/**
 * Los archivos de CÓDIGO (no de test) que la 172 creó o modificó, leídos del diff de la rama
 * y escritos aquí uno a uno. La lista es el censo: si un archivo desaparece o cambia de
 * nombre, el primer test cae.
 */
const ARCHIVOS_DE_LA_FEATURE: readonly string[] = [
  "app/(app)/cierres-admin/_components/CierresAdminHistoricoTabla.tsx",
  "app/(app)/cierres-admin/_components/CierresAdminModule.tsx",
  "app/(app)/cierres-admin/_components/PagoMensajeroSeccion.tsx",
  "app/(app)/cierres-admin/_components/PendienteLiquidarBadge.tsx",
  "app/(app)/cierres-admin/_components/RegistrarPagoMensajeroDialog.tsx",
  "app/(app)/cierres-admin/_components/pago-mensajero-labels.ts",
  "app/(app)/cierres-admin/page.tsx",
  "app/(app)/mi-wallet/_components/MiWalletModule.tsx",
  "app/(app)/mi-wallet/_components/SaldoTiendaCard.tsx",
  "app/(app)/mi-wallet/_components/mi-wallet-labels.ts",
  "app/(app)/mi-wallet/page.tsx",
  "app/(app)/mis-pagos/_components/CuentaPorPagarCard.tsx",
  "app/(app)/mis-pagos/_components/mis-pagos-labels.ts",
  "app/(app)/wallet/_components/wallet-labels.ts",
  "app/(app)/wallet/tiendas/_components/PagoTiendaAcciones.tsx",
  "app/(app)/wallet/tiendas/_components/SaldosTiendasTable.tsx",
  "app/(app)/wallet/tiendas/page.tsx",
  "components/shared/liquidacion/AnularPagoDialog.tsx",
  "components/shared/liquidacion/PagosRegistradosTabla.tsx",
  "components/shared/liquidacion/RegistrarPagoDialog.tsx",
  "components/shared/liquidacion/clave-idempotencia.ts",
  "components/shared/liquidacion/liquidacion-labels.ts",
  "components/shared/liquidacion/pagos-registrados-descarga-columnas.ts",
  "components/shared/monto-cliente.ts",
  "lib/actions/cierres-admin.ts",
  "lib/actions/liquidacion.ts",
  "lib/interfaces/repositories/ILiquidacionPagoRepository.ts",
  "lib/interfaces/repositories/IPagoMensajeroMovimientoRepository.ts",
  "lib/interfaces/repositories/IWalletTiendaMovimientoRepository.ts",
  "lib/interfaces/services/ICierresAdminService.ts",
  "lib/interfaces/services/ILiquidacionService.ts",
  "lib/interfaces/services/IWalletTiendaService.ts",
  "lib/repositories/LiquidacionPagoRepository.ts",
  "lib/repositories/PagoMensajeroMovimientoRepository.ts",
  "lib/repositories/WalletTiendaMovimientoRepository.ts",
  "lib/services/CierresAdminService.ts",
  "lib/services/LiquidacionService.ts",
  "lib/services/WalletTiendaService.ts",
  "lib/types/liquidacion.ts",
  "lib/utils/descripcion-pago.ts",
  "lib/utils/pendiente-cierre.ts",
  // Feature 205 (T0.3, R16/R50) — la aritmética del reparto entre cierres. NO entró a mano:
  // entró porque la cláusula de auto-captura de abajo puso este test en ROJO al crearse el
  // archivo («expected [ "lib/utils/reparto-liquidacion-mensajero.ts" ] to deeply equal []»,
  // :146). El nombre lleva `liquidacion` a propósito para que eso ocurra (design §11).
  //
  // Su módulo de configuración hermano, `lib/config/reparto-mensajero.ts`, NO está aquí y
  // tampoco por olvido: no maneja ningún monto —exporta un cardinal leído del entorno— y el
  // `Number.parseInt` del patrón de config casa con `/\bparseInt\s*\(/`, así que censarlo
  // pondría este barrido en rojo por un FALSO POSITIVO. Por eso su ruta no casa
  // `/[Ll]iquidacion/` (design §2.5.2). La solución es el nombre, no una excepción aquí.
  "lib/utils/reparto-liquidacion-mensajero.ts",
  // Feature 205 (T2.1, R16/R50) — el repositorio del ACTO de repartir y su contrato. Tampoco
  // entraron a mano: la misma cláusula de auto-captura puso este test en ROJO al crearlos
  // («expected [ "lib/interfaces/repositories/ILiquidacionRepartoRepository.ts",
  // "lib/repositories/LiquidacionRepartoRepository.ts" ] to deeply equal []», :157). Manejan
  // `monto_total`, así que el barrido es exactamente donde tienen que estar (design §11).
  "lib/interfaces/repositories/ILiquidacionRepartoRepository.ts",
  "lib/repositories/LiquidacionRepartoRepository.ts",
  // Feature 205 (T4.1, R16/R46/R50) — los contratos I/O del reparto y sus dos schemas de borde.
  // Tercera vez que la cláusula de auto-captura hace el trabajo: al crearse el archivo, este
  // test cayó con «expected [ "lib/types/liquidacion-reparto.ts" ] to deeply equal []» (:164).
  // Declara los DTO por los que cruzan todos los importes del reparto, así que el barrido de
  // `Number(`/`parseFloat`/`parseInt` es exactamente donde tiene que estar.
  "lib/types/liquidacion-reparto.ts",
  // Feature 205 (T5.4, R16/R50) — los archivos de CLIENTE del reparto. Éstos NO los captura
  // ninguna cláusula: la auto-captura de abajo solo alcanza `components/shared/liquidacion/`
  // y `lib/**` con `liquidacion` en la ruta, y estos tres viven en `app/**`. Entran a mano, y
  // por eso el criterio de la tarea es que entren ELLOS: los tres pintan importes del
  // servidor y son exactamente donde la aritmética de dinero podría reaparecer en el
  // navegador (design §11).
  //
  // Sobre estos tres pesan las CUATRO aserciones, no dos: además de `Number(`/`parseFloat(`/
  // `parseInt(`, el `.toFixed(` está prohibido (son cliente) y no pueden importar
  // `@prisma/client` ni `decimal.js` — sin biblioteca de decimales y sin conversión a número,
  // en el navegador no queda forma de operar con dinero, solo de pintarlo.
  "app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero.tsx",
  "app/(app)/wallet/mensajeros/_components/PagoMensajeroAcciones.tsx",
  "app/(app)/wallet/mensajeros/_components/RepartoPrevisualizacion.tsx",
  // Feature 205 (review m2, R16/R50) — los RÓTULOS de esos tres. Entra por el mismo criterio de
  // T5.4 y con un motivo propio: la 205 le añadió cinco bloques que formatean dinero
  // (`money(totalImputado)`, `money(montoFuera)`, `money(pendienteDespues)`, `money(sobrante)`,
  // `money(imputable)`), así que el formateo de los importes del reparto vive AQUÍ y no en los
  // componentes que lo consumen —que sí estaban censados—. La red cubría a los lectores y dejaba
  // fuera el sitio donde se escribe.
  //
  // Hoy no hay nada que cazar (`money` opera sobre el STRING del servidor y no convierte a
  // número, `lib/config/moneda.ts`), y por eso la entrada podría parecer cosmética: NO lo es. Se
  // midió plantando un `Number(pendienteDespues)` en `REPARTO_APLICADO.quedaPendiente` con este
  // archivo FUERA del censo — `tests/unit/{guards,utils,services}` pasaba entero, 3530 verdes— y
  // con él DENTRO: rojo nombrando la ruta. Es un archivo de cliente, así que pesan las cuatro
  // aserciones, incluidas la de `.toFixed(` y la de la biblioteca de decimales.
  "app/(app)/wallet/mensajeros/_components/wallet-mensajeros-labels.ts",
];

/** Un archivo es de CLIENTE si vive en los árboles de UI. */
function esCliente(ruta: string): boolean {
  return ruta.startsWith("app/") || ruta.startsWith("components/");
}

function codigo(ruta: string): string {
  return quitarComentarios(readFileSync(path.join(RAIZ, ruta), "utf8"));
}

function listarArchivos(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) listarArchivos(completo, acc);
    else if (/\.tsx?$/.test(entrada.name)) acc.push(completo);
  }
  return acc;
}

function relativa(absoluta: string): string {
  return path.relative(RAIZ, absoluta).split(path.sep).join("/");
}

/** Nombre de campo que es un identificador interno (`id`, `xxxId`, `xxx_id`). */
const IDENTIFICADOR_INTERNO = /^(id|_id)$|(?<![a-z])Id$|_id$/;

/** Forma de uuid canónico en el VALOR de una celda. */
const FORMA_UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

/** Campos declarados por un `export type X = { … }` de un módulo de tipos. */
function camposDelTipo(fuente: string, nombre: string): string[] {
  const inicio = fuente.indexOf(`export type ${nombre} = {`);
  if (inicio < 0) throw new Error(`no se encontró el tipo ${nombre}`);
  const cuerpo = fuente.slice(inicio, fuente.indexOf("\n};", inicio));
  return [...cuerpo.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]);
}

describe("barrido transversal money-safe y de fuga de datos (feature 172)", () => {
  it("el censo de archivos de la feature existe entero y cubre sus propios árboles", () => {
    for (const ruta of ARCHIVOS_DE_LA_FEATURE) {
      expect(existsSync(path.join(RAIZ, ruta)), `${ruta} no existe`).toBe(true);
    }

    // Ningún archivo del árbol PROPIO de la feature puede quedarse fuera del censo. Es lo
    // que impide que la lista envejezca: un módulo nuevo en `components/shared/liquidacion/`
    // o un `*Liquidacion*` en `lib/` entran o el test cae.
    const censo = new Set(ARCHIVOS_DE_LA_FEATURE);
    const propios = [
      ...listarArchivos(path.join(RAIZ, "components/shared/liquidacion")),
      ...listarArchivos(path.join(RAIZ, "lib")).filter((a) => /[Ll]iquidacion/.test(a)),
    ].map(relativa);

    expect(propios.length).toBeGreaterThan(0);
    expect(propios.filter((ruta) => !censo.has(ruta))).toEqual([]);
  });

  it("ningún archivo de la feature convierte un monto a número", () => {
    // R14. `Number(`, `parseFloat(` y `parseInt(` en cualquier lado; `.toFixed(` solo en el
    // cliente (en `lib/**` es `Decimal.toFixed(2)`, la serialización exacta).
    const hallazgos: string[] = [];
    for (const ruta of ARCHIVOS_DE_LA_FEATURE) {
      const fuente = codigo(ruta);
      for (const patron of LLAMADAS_PROHIBIDAS_EN_DINERO) {
        const esToFixed = patron.source.includes("toFixed");
        if (esToFixed && !esCliente(ruta)) continue;
        const encontrado = fuente.match(patron);
        if (encontrado) hallazgos.push(`${ruta}: ${encontrado[0]}`);
      }
    }
    expect(hallazgos, "conversión de dinero a número en la feature 172").toEqual([]);
  });

  it("en el servidor, todo `toFixed` de la feature es de escala 2", () => {
    // La contracara del permiso de arriba: `toFixed` se admite en `lib/**` porque es la
    // serialización canónica del dinero, y eso solo vale si SIEMPRE lleva los dos decimales.
    // Un `toFixed()` sin argumento —o con otro— emitiría un STRING que la frontera no acepta.
    const malos: string[] = [];
    for (const ruta of ARCHIVOS_DE_LA_FEATURE.filter((r) => !esCliente(r))) {
      for (const uso of codigo(ruta).matchAll(/\.toFixed\(([^)]*)\)/g)) {
        if (uso[1].trim() !== "2") malos.push(`${ruta}: .toFixed(${uso[1]})`);
      }
    }
    expect(malos).toEqual([]);
  });

  it("ningún archivo de CLIENTE de la feature trae una biblioteca de decimales", () => {
    // R14, la mitad que el barrido de llamadas no ve: sin `Number(` pero con `Prisma.Decimal`
    // en el navegador, se podría operar con montos igualmente. Los archivos de cliente pintan
    // el STRING del servidor; no calculan con él. (`monto-cliente.ts` compara montos como
    // TEXTO, y por eso no necesita ninguna biblioteca.)
    const conDecimales: string[] = [];
    for (const ruta of ARCHIVOS_DE_LA_FEATURE.filter(esCliente)) {
      const fuente = codigo(ruta);
      if (/from\s+"(@prisma\/client|decimal\.js[^"]*)"/.test(fuente)) conDecimales.push(ruta);
      if (/\bnew\s+(Prisma\.)?Decimal\s*\(/.test(fuente)) conDecimales.push(`${ruta} (new Decimal)`);
    }
    expect(conDecimales, "aritmética de montos en el navegador").toEqual([]);
  });

  it("CONTRAPRUEBA: el barrido caza un `Number(monto)` colado y no caza su cita", () => {
    // Sin esto, los cuatro tests de arriba podrían estar pasando por no mirar nada.
    const colado = "const total = Number(monto) + 1;\nconst otro = parseFloat(saldo);\n";
    const citado = "// money-safe: aquí no se usa Number( ni parseFloat(\nconst m = pago.monto;\n";

    const cazadas = (fuente: string) =>
      LLAMADAS_PROHIBIDAS_EN_DINERO.filter((p) => p.test(quitarComentarios(fuente))).length;

    expect(cazadas(colado)).toBe(2);
    expect(cazadas(citado)).toBe(0);

    // Y la misma contraprueba sobre un archivo REAL de la feature: se le inyecta la llamada
    // en memoria y el barrido la encuentra donde antes no había nada.
    const real = codigo("components/shared/liquidacion/PagosRegistradosTabla.tsx");
    expect(cazadas(real)).toBe(0);
    expect(cazadas(`${real}\nconst x = Number(pago.monto);`)).toBe(1);
  });

  it("el DTO del comprobante no declara ningún identificador salvo el `id` del pago", () => {
    // R56. Estructural sobre el módulo de tipos: añadir `mensajeroId` o `cierreId` al DTO
    // —el error natural cuando una pantalla necesita «solo un id más»— rompe este test.
    const fuente = readFileSync(path.join(RAIZ, "lib/types/liquidacion.ts"), "utf8");

    const pago = camposDelTipo(fuente, "PagoRegistradoDTO");
    expect(pago).toHaveLength(9);
    expect(pago.filter((campo) => IDENTIFICADOR_INTERNO.test(campo))).toEqual(["id"]);

    const anulacion = camposDelTipo(fuente, "AnulacionDTO");
    expect(anulacion.filter((campo) => IDENTIFICADOR_INTERNO.test(campo))).toEqual([]);
  });

  it("la descarga del comprobante no emite NI UN uuid, ni siquiera el del pago", () => {
    // R56, medido con VALORES y no con nombres: se proyecta un comprobante en el que TODOS
    // los campos que podrían llevar un identificador son uuids distintos, y se comprueba que
    // ninguno sobrevive a la proyección. El `id` viaja en el DTO (la pantalla lo necesita
    // para pedir la anulación) y no sale en el archivo.
    const pago: PagoRegistradoDTO = {
      id: "11111111-1111-4111-8111-111111111111",
      monto: "15000.00",
      metodo: "SINPE",
      referencia: "22222222-2222-4222-8222-222222222222",
      nota: "33333333-3333-4333-8333-333333333333",
      fechaPago: "2026-07-30",
      registradoPorNombre: "Ana Maestra",
      registradoAt: "2026-08-02T15:04:05.000Z",
      repartoId: null, // feature 206: pago SUELTO, sin reparto
      anulacion: {
        motivo: "44444444-4444-4444-8444-444444444444",
        anuladoPorNombre: "Beto Admin",
        anuladoAt: "2026-08-05T10:00:00.000Z",
      },
    };

    const fila = filaDescargaPagoRegistrado(pago);
    const conUuid = Object.entries(fila)
      .filter(([, celda]) => typeof celda === "string" && FORMA_UUID.test(celda))
      .map(([clave]) => clave);

    // La referencia, la nota y el motivo SÍ son texto libre que el usuario escribió: si
    // alguien teclea ahí un uuid, sale en su columna y es correcto. Lo que no puede salir es
    // el `id`, que nadie tecleó.
    expect(conUuid.sort()).toEqual(["motivoAnulacion", "nota", "referencia"]);
    expect(Object.values(fila)).not.toContain(pago.id);

    // Y ninguna columna declarada se llama como un identificador.
    for (const columna of COLUMNAS_DESCARGA_PAGOS_REGISTRADOS) {
      expect(columna.clave, columna.clave).not.toMatch(IDENTIFICADOR_INTERNO);
    }
  });
});
