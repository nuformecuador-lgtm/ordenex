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

  it("R67: los estados que bloquean al mensajero siguen siendo exactamente los tres de la 111", () => {
    // La lista vive en un solo sitio y la 172 no la toca. Se lee del código, no del diff:
    // así el día que alguien le añada (o le quite) un estado, este test lo dirá aunque la
    // rama de la 172 haga años que se mergeó.
    const repo = codigo("lib/repositories/OrdenRepository.ts");
    const declaracion = repo.match(/ESTADOS_CIERRE_BLOQUEANTES\s*:\s*CierreEstado\[\]\s*=\s*\[([^\]]*)\]/);
    expect(declaracion, "no se encontró ESTADOS_CIERRE_BLOQUEANTES").not.toBeNull();

    const estados = [...declaracion![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(estados).toEqual(["solicitado", "vencido", "rechazado"]);
    // `aprobado` NO bloquea: es la mitad que hace que pagar después de aprobar sea posible
    // (R18) y la que un descuido convertiría en un mensajero bloqueado por un pago pendiente.
    expect(estados).not.toContain("aprobado");

    // Ningún archivo de la 172 nombra esa constante: no la lee, no la extiende, no la copia.
    for (const ruta of CODIGO_DE_LA_FEATURE) {
      expect(codigo(ruta), `${ruta} nombra ESTADOS_CIERRE_BLOQUEANTES`).not.toContain(
        "ESTADOS_CIERRE_BLOQUEANTES",
      );
    }
  });

  it("R68 / R40 / R62: ni la caja principal ni el catálogo de métricas entran en la feature", () => {
    // (a) Ningún archivo de la 172 tiene por dónde escribir en la caja: no importa su
    //     repositorio, no nombra su delegado de Prisma y no emite sus categorías de egreso.
    const prohibido = [
      "IWalletMovimientoRepository",
      "WalletMovimientoRepository",
      "walletMovimiento",
      "wallet_movimiento",
      "egreso_pago_tienda",
      "egreso_pago_mensajero",
      "reversarEgreso",
      "WalletEgresoService",
    ];
    for (const ruta of CODIGO_DE_LA_FEATURE) {
      const fuente = codigo(ruta);
      for (const nombre of prohibido) {
        expect(fuente, `${ruta} nombra ${nombre}`).not.toContain(nombre);
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
});
