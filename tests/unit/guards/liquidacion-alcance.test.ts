import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { quitarComentarios } from "../../fixtures/money-safe";

/**
 * Feature 172 (T H.4) — LOS NO OBJETIVOS, medidos sobre el código.
 *
 * R66, R67 y R68 son prohibiciones. Hasta esta task se «verificaban» leyendo el diff, y una
 * revisión de diff caduca el día que se mergea: dentro de seis meses nadie recordará que la
 * 172 prometió no tocar estas tres cosas. `docs/verification.md` lo dice sin rodeos —«si un
 * requisito no tiene test, o un test no verifica el requisito que dice cubrir, es hallazgo
 * bloqueante»—, así que aquí quedan escritas como aserciones.
 *
 * Lo que NO pretende ser: una demostración de que la caja está intacta. Eso lo mide R40 con
 * los espías del repositorio de la caja (`liquidacion-service` / `liquidacion-anulacion`) y
 * lo respalda la suite de analítica, que sigue verde sin editarse. Esto es la mitad
 * estructural: que el código de la feature ni siquiera tenga por dónde hacerlo.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠️ **ACTUALIZADA POR LA FEATURE 173 / TANDA C (2026-08-03). La frontera se movió, y solo del
 * lado de la TIENDA.**
 *
 * Lo que este archivo afirmaba: que **ningún** archivo de la 172 podía escribir en la caja
 * principal, y en particular que `lib/actions/liquidacion.ts` no nombraba
 * `WalletMovimientoRepository`. La premisa de aquel no-objetivo (R40, [P2]) era que emitir
 * `egreso_pago_tienda` restaría de la caja «un dinero que nunca entró en ella».
 *
 * Esa premisa cayó **del lado de la tienda**: la Tanda B de la 173 mete el contra-entrega en la
 * caja al aprobar el cierre, así que ese dinero SÍ está ahí y entregarlo tiene que restar. Del
 * lado del **mensajero** sigue viva y es decisión humana explícita ([P2] = (a), 2026-08-03): la
 * caja carga `egreso_pago_mensajero = P` al aprobar, y la liquidación al mensajero no la roza.
 *
 * Por eso la guardia no se relaja, se **afila**: pasa de «la caja no entra» a «la caja entra por
 * UNA sola puerta, esa puerta emite EXACTAMENTE dos filas, y ninguna es la del mensajero». Lo que
 * antes era una prohibición total es ahora un **alcance cerrado**, que es más específico y más
 * difícil de satisfacer por accidente.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */

const RAIZ = path.resolve(__dirname, "../../..");

const MIGRACION = "db/migrations/20260802120000_liquidacion_pago/migration.sql";
const DOWN = "db/migrations/20260802120000_liquidacion_pago/down.sql";

/** Los archivos de CÓDIGO de la feature que podrían tocar la caja o la analítica. */
const CODIGO_DE_LA_FEATURE: readonly string[] = [
  "lib/actions/liquidacion.ts",
  "lib/interfaces/repositories/ILiquidacionPagoRepository.ts",
  "lib/interfaces/services/ILiquidacionService.ts",
  "lib/repositories/LiquidacionPagoRepository.ts",
  "lib/services/LiquidacionService.ts",
  "lib/types/liquidacion.ts",
  "lib/utils/descripcion-pago.ts",
  "lib/utils/pendiente-cierre.ts",
  "components/shared/liquidacion/AnularPagoDialog.tsx",
  "components/shared/liquidacion/PagosRegistradosTabla.tsx",
  "components/shared/liquidacion/RegistrarPagoDialog.tsx",
  "components/shared/liquidacion/clave-idempotencia.ts",
  "components/shared/liquidacion/liquidacion-labels.ts",
  "components/shared/liquidacion/pagos-registrados-descarga-columnas.ts",
  "app/(app)/cierres-admin/_components/PagoMensajeroSeccion.tsx",
  "app/(app)/cierres-admin/_components/PendienteLiquidarBadge.tsx",
  "app/(app)/cierres-admin/_components/RegistrarPagoMensajeroDialog.tsx",
  "app/(app)/wallet/tiendas/_components/PagoTiendaAcciones.tsx",
];

/**
 * Feature 173 — el ÚNICO archivo de la lista de arriba que puede nombrar el repositorio de la
 * caja, y solo para construir el puerto estrecho. Es el composition root: el sitio donde se
 * cablea, por definición, todo lo que el servicio recibe.
 */
const COMPOSITION_ROOT = "lib/actions/liquidacion.ts";

/** La única puerta por la que la liquidación puede escribir en la caja (feature 173, design §4). */
const PUERTO = "lib/services/CajaPagoTiendaFeedService.ts";

/**
 * Lo que NINGÚN archivo de la feature puede nombrar, ni siquiera el composition root.
 *
 * `egreso_pago_mensajero` es el corazón de este bloque y lo que de verdad protege ([P2] = (a)):
 * la liquidación al mensajero NO puede restar de la caja, porque el cierre ya cargó ese costo
 * al aprobarse. Las tres categorías de la tienda están aquí por un motivo distinto y también
 * deliberado: **las fija el puerto, no quien lo llama** (R23), así que verlas escritas en un
 * archivo de la liquidación significaría que alguien recuperó la capacidad de elegir categoría.
 */
const PROHIBIDO_EN_TODOS: readonly string[] = [
  "egreso_pago_mensajero", // [P2] = (a): la frontera que NO se movió
  "egreso_pago_tienda",
  "ingreso_reverso_pago_tienda",
  "ingreso_ajuste",
  "reversarEgreso",
  "WalletEgresoService",
  "wallet_movimiento",
];

/**
 * Lo que sigue prohibido en todos MENOS en el composition root. Que el SERVICIO no pueda
 * nombrarlos es lo que hace que el puerto sea estrecho de verdad: sin el repositorio y sin el
 * delegado de Prisma, lo único que puede escribir en la caja es lo que el puerto sabe emitir.
 */
const PROHIBIDO_FUERA_DEL_ROOT: readonly string[] = [
  "IWalletMovimientoRepository",
  "WalletMovimientoRepository",
  "walletMovimiento",
];

function leer(ruta: string): string {
  return readFileSync(path.join(RAIZ, ruta), "utf8");
}

function codigo(ruta: string): string {
  return quitarComentarios(leer(ruta));
}

/** Quita los comentarios `--` de un SQL para no leer una prohibición citada como una sentencia. */
function sqlSinComentarios(fuente: string): string {
  return fuente.replace(/^\s*--[^\n]*$/gm, "");
}

describe("feature 172 — los no objetivos, verificados sobre el código", () => {
  it("R66: no introduce ningún ciclo de corte, cierre ni período POR TIENDA", () => {
    // Lo que R66 prohíbe es una pieza de MODELO: una tabla, un estado o una fecha de corte
    // que obligue a «cerrar» el mes de una tienda antes de pagarle. La 172 paga contra el
    // saldo acumulado y no necesita nada de eso.
    const up = sqlSinComentarios(leer(MIGRACION));

    const tablasCreadas = [...up.matchAll(/CREATE TABLE\s+"([^"]+)"/gi)].map((m) => m[1]);
    expect(tablasCreadas).toEqual(["liquidacion_pago", "liquidacion_anulacion"]);

    // Ni un estado nuevo, ni una columna nueva en una tabla existente: lo único que los
    // libros GANAN es una restricción (R64, aditiva).
    expect(up).not.toMatch(/ADD COLUMN/i);
    expect(up).not.toMatch(/CREATE TYPE/i);
    expect(up).not.toMatch(/ALTER TYPE/i);
    for (const palabra of ["corte", "periodo", "período", "ciclo"]) {
      expect(up.toLowerCase(), `la migración nombra «${palabra}»`).not.toContain(palabra);
    }

    // Y el modelo tampoco: los dos modelos que la 172 añade a Prisma son los del documento.
    const schema = leer("db/schema.prisma");
    for (const modelo of ["LiquidacionPago", "LiquidacionAnulacion"]) {
      expect(schema).toMatch(new RegExp(`model ${modelo} \\{`));
    }
    expect(schema).not.toMatch(/model\s+\w*CorteTienda\w*\s*\{/);
    expect(schema).not.toMatch(/model\s+\w*(Periodo|Ciclo)\w*Tienda\w*\s*\{/);
  });

  it("R67: `aprobado` NO cuenta para el bloqueo del mensajero, y la 172 no toca esa regla", () => {
    // La regla vive en un solo sitio y la 172 no la toca. Se lee del código, no del diff: así el
    // día que alguien la cambie, este test lo dirá aunque la rama de la 172 haga años que se mergeó.
    //
    // ⚠️ ACTUALIZADO DOS VECES, Y LAS DOS ESTE TRIPWIRE HIZO SU TRABAJO —se puso rojo en el commit
    // que cambió la regla, que es exactamente para lo que existe—:
    //
    //   · FEATURE 241 (2026-08-20): exigía `["solicitado","vencido","rechazado"]` sobre
    //     `ESTADOS_CIERRE_BLOQUEANTES`. El humano firmó que `solicitado` NO bloquea y la constante
    //     pasó a `ESTADOS_CIERRE_BLOQUEAN_GESTION = ["vencido","rechazado"]`.
    //   · FEATURE 271 (2026-08-23): la regla DEJA DE SER UNA LISTA DE ESTADOS Y PASA A SER UN
    //     CONTEO. Con N = cierres sin aprobar y V = cuántos son re-solicitables: LIBRE si `N <= 1`
    //     y `V = 0`. `ESTADOS_CIERRE_BLOQUEAN_GESTION` desapareció con ella, y la regla se mudó al
    //     módulo puro `lib/utils/bloqueo-cierre.ts`.
    //
    // Lo que R67 protege NO cambia: la 172 (pagar a las tiendas) no toca ni lee esta regla, y en
    // particular `aprobado` sigue sin bloquear — es la mitad que hace posible pagar DESPUÉS de
    // aprobar (R18), y la que un descuido convertiría en un mensajero bloqueado por un pago
    // pendiente. El literal se REEXPRESA con la regla nueva en vez de relajarse a un `toContain`,
    // porque un tripwire que acepta cualquier regla no vigila nada.
    const regla = codigo("lib/utils/bloqueo-cierre.ts");

    const abiertos = regla.match(/CIERRE_ESTADOS_ABIERTOS\s*=\s*\[([^\]]*)\]/);
    expect(abiertos, "no se encontró CIERRE_ESTADOS_ABIERTOS").not.toBeNull();
    expect([...abiertos![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1])).toEqual([
      "solicitado",
      "vencido",
      "rechazado",
    ]);

    const resolicitables = regla.match(/CIERRE_ESTADOS_RESOLICITABLES\s*=\s*\[([^\]]*)\]/);
    expect(resolicitables, "no se encontró CIERRE_ESTADOS_RESOLICITABLES").not.toBeNull();
    expect([...resolicitables![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1])).toEqual([
      "vencido",
      "rechazado",
    ]);

    // Lo que R67 vigila de verdad: `aprobado` no entra en ninguna de las dos listas.
    expect(regla).not.toMatch(/"aprobado"/);

    // Ningún archivo de la 172 nombra la regla: no la lee, no la extiende, no la copia.
    // (Ni las viejas ni las nuevas: un rename no puede ser la vía por la que la 172 se cuele.)
    const PROHIBIDOS = [
      "ESTADOS_CIERRE_BLOQUEAN_GESTION",
      "ESTADOS_CIERRE_BLOQUEANTES",
      "estaBloqueadoPorCierres",
      "CIERRE_ESTADOS_ABIERTOS",
      "CIERRE_ESTADOS_RESOLICITABLES",
    ];
    for (const ruta of CODIGO_DE_LA_FEATURE) {
      const fuente = codigo(ruta);
      for (const nombre of PROHIBIDOS) {
        expect(fuente, `${ruta} nombra ${nombre}`).not.toContain(nombre);
      }
    }
  });

  it("R68 / R40 [P2] / R62: la caja entra SOLO por la puerta de la tienda, y el catálogo de métricas no entra", () => {
    // (a) ⚠️ ACTUALIZADO POR LA 173/T C.2. Antes: los 8 nombres de abajo estaban prohibidos en
    //     TODOS los archivos, incluido `WalletMovimientoRepository` en el composition root.
    //     Ahora la lista se parte en dos, y la mitad que importa —la del MENSAJERO— se queda
    //     donde estaba: `egreso_pago_mensajero` sigue prohibido en TODOS, sin excepción.
    for (const ruta of CODIGO_DE_LA_FEATURE) {
      const fuente = codigo(ruta);
      for (const nombre of PROHIBIDO_EN_TODOS) {
        expect(fuente, `${ruta} nombra ${nombre}`).not.toContain(nombre);
      }
      if (ruta !== COMPOSITION_ROOT) {
        for (const nombre of PROHIBIDO_FUERA_DEL_ROOT) {
          expect(fuente, `${ruta} nombra ${nombre}`).not.toContain(nombre);
        }
      }
      // (b) Y ninguno importa nada de analítica: el catálogo de métricas financieras es de
      //     la 173, no de esta feature.
      expect(fuente, `${ruta} importa analítica`).not.toMatch(
        /from\s+"@\/lib\/analytics/,
      );
    }

    // (c) R62 [P8]: la restricción tipo↔categoría NO se le añade a la caja. Se comprueba
    //     sobre el SQL sin comentarios, porque la migración EXPLICA por qué no lo hace y un
    //     `toContain` sobre el texto crudo confundiría la explicación con la sentencia.
    const up = sqlSinComentarios(leer(MIGRACION));
    const down = sqlSinComentarios(leer(DOWN));
    for (const sql of [up, down]) {
      expect(sql).not.toContain("wallet_movimiento");
    }
    // Las dos tablas que sí la reciben, y solo esas dos.
    const alteradas = [...up.matchAll(/ALTER TABLE\s+"([^"]+)"\s+ADD CONSTRAINT[^\n]*_tipo_categoria_check/gi)].map(
      (m) => m[1],
    );
    expect(alteradas.sort()).toEqual(["pago_mensajero_movimiento", "wallet_tienda_movimiento"]);
  });

  /**
   * Feature 173 / T C.1 (R23) — LO QUE SUSTITUYE A LA MITAD DEROGADA DE R40.
   *
   * La prohibición vieja («la caja no entra») se cambia por un ALCANCE CERRADO, que es más
   * exigente: la caja entra por una sola puerta, esa puerta emite exactamente dos filas y
   * ninguna de las dos es la del mensajero. Una guardia que solo dijera «ya no está prohibido»
   * sería una guardia vacía.
   */
  it("R23 [173]: la caja entra por UNA puerta, con DOS filas, y ninguna es la del mensajero", () => {
    const root = codigo(COMPOSITION_ROOT);

    // (a) El repositorio de la caja se construye UNA sola vez en toda la feature, y siempre
    //     envuelto en el puerto: no hay una segunda instancia suelta que pudiera acabar en el
    //     constructor del servicio.
    expect(root.match(/new WalletMovimientoRepository\(/g)).toHaveLength(1);
    expect(root).toMatch(
      /new CajaPagoTiendaFeedService\(\s*new WalletMovimientoRepository\(prisma\),?\s*\)/,
    );

    // (b) El puerto emite EXACTAMENTE dos categorías del catálogo de la caja, y son estas.
    //     Ampliarlo con un tercer método —o cambiarle una categoría— rompe esta lista.
    const puerto = codigo(PUERTO);
    const CATALOGO_DE_LA_CAJA = [
      "ingreso_flete",
      "ingreso_flete_devolucion",
      "ingreso_comision_cod",
      "ingreso_iva_flete",
      "ingreso_iva_flete_devolucion",
      "ingreso_iva_comision_cod",
      "ingreso_ajuste",
      "ingreso_cod_recaudado",
      "ingreso_reverso_pago_tienda",
      "egreso_pago_mensajero",
      "egreso_pago_tienda",
      "egreso_gasto",
      "egreso_sueldo",
      "egreso_ajuste",
      "egreso_gasto_fijo",
      "egreso_gasto_variable",
      "egreso_indemnizacion",
    ];
    const emitidas = CATALOGO_DE_LA_CAJA.filter((c) => puerto.includes(c));
    expect(emitidas.sort()).toEqual(["egreso_pago_tienda", "ingreso_reverso_pago_tienda"]);

    // (c) Y la frontera que NO se movió, dicha en voz alta sobre el único módulo capaz de
    //     escribir: el pago al MENSAJERO se sigue cargando a la caja al APROBAR el cierre
    //     ([P2] = (a)), así que la liquidación no puede volver a restarlo.
    expect(puerto, "el puerto puede emitir egreso_pago_mensajero").not.toContain(
      "egreso_pago_mensajero",
    );

    // (d) El puerto expone DOS métodos públicos y ninguno más: un tercero sería un tercer
    //     tipo de fila que este alcance ya no cubriría.
    const metodos = [...puerto.matchAll(/^\s{2}async\s+(\w+)\(/gm)].map((m) => m[1]);
    expect(metodos.sort()).toEqual(["emitirEgresoDePago", "emitirReversoDeAnulacion"]);
  });
});
