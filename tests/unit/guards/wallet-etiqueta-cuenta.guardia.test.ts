import { describe, expect, it } from "vitest";

import { quitarComentarios } from "@/tests/fixtures/sin-comentarios";
import { archivosBajo, archivosDeLaWallet, codigo } from "./_wallet-458-archivos";

// =================================================================================================
// GUARDIA — FICHA 458-A (TA.1, R33, P5) — UNA SOLA FUNCION NOMBRA LAS CUENTAS DE LA WALLET
// =================================================================================================
//
// La misma tienda se leia «Tania» en una tabla y «Tania Tienda» en un aviso porque cada lectura
// componia el nombre a su manera. Desde la 458-A lo compone `etiquetaDeCuenta`
// (`lib/utils/etiqueta-cuenta.ts`) y esta guardia prohibe cualquier OTRA composicion:
//
//  1. En las superficies de la wallet (`app/(app)/wallet/**`, `app/(app)/mi-wallet/**` y las carpetas
//     compartidas de la 458): el cliente NO compone nombres. Ni `etiquetaDePersona(`, ni
//     `nombreCompletoUsuario(`, ni leer `primerApellido`/`segundoApellido`, ni una plantilla que pegue
//     `nombre` con otra cosa. El nombre llega hecho del servidor.
//  2. En los repositorios y servicios de LECTURA de la wallet (descubiertos por prefijo de nombre, no
//     por lista) y en los que ESCRIBEN el historial de una cuenta de la wallet (descubiertos por
//     contenido: `etiquetaDeEntidad` de un cobro, pago, reparto, pago por cuenta o abono): ni
//     `etiquetaDePersona(`, ni `nombreCompletoUsuario(`, ni el `nombre` a secas, ni leer la cuenta
//     sin sus apellidos: solo `etiquetaDeCuenta(` con `CUENTA_USUARIO_SELECT`.
//
// Contraprueba: la fuente de antes (`listarSaldosTodasTiendas` con `u.nombre` a secas y el cobro con
// `etiquetaDePersona`) la pone roja. No-vacuidad: los dos censos tienen archivos.

const COMPOSICION_EN_CLIENTE: readonly RegExp[] = [
  /\betiquetaDePersona\s*\(/,
  /\bnombreCompletoUsuario\s*\(/,
  /\bprimerApellido\b/,
  /\bsegundoApellido\b/,
  /\$\{[^}]*\.nombre\}\s+\$\{/,
];

const COMPOSICION_EN_SERVIDOR: readonly RegExp[] = [
  /\betiquetaDePersona\s*\(/,
  /\bnombreCompletoUsuario\s*\(/,
  // El nombre de la cuenta leido a secas y metido en un mapa por id (la forma de P5).
  /\[\s*\w+\.id\s*,\s*\w+\.nombre\s*\]/,
  // El nombre de la cuenta leido a secas en un campo que NOMBRA la cuenta (la forma del B1 de la
  // revision: `tiendaNombre: cobro?.tienda.nombre` en la anulacion del cobro).
  /\b(tiendaNombre|beneficiarioNombre|mensajeroNombre)\s*:\s*[^,\n}]*\.nombre\b/,
  // La cuenta leida SIN sus apellidos (solo `nombre`, o `nombre` + primer apellido): quien la lee
  // asi no puede nombrarla como `etiquetaDeCuenta`. Se pide `CUENTA_USUARIO_SELECT`.
  /\b(tienda|mensajero)\s*:\s*\{\s*select\s*:\s*\{\s*nombre\s*:\s*true\s*(,\s*primerApellido\s*:\s*true\s*)?\}/,
];

/** Los repositorios y servicios que LEEN la wallet: por prefijo, para que uno nuevo entre solo. */
const PREFIJO_SERVIDOR_WALLET =
  /^lib\/(repositories|services)\/(Wallet(Tienda|Mensajero)|PagoMensajeroMovimiento|AbonoTienda|PagoPorCuentaTienda|SaldosSatelites|OrigenLegible|FiltrosWallet)\w*\.ts$/;

/**
 * Los que ESCRIBEN el historial de una cuenta de la wallet (revision 458-A, B1): todo archivo que
 * etiqueta una fila de `historial_accion` de una entidad de la wallet que se nombra por su CUENTA.
 * Descubiertos por CONTENIDO, no por nombre de archivo: el prefijo de arriba dejaba fuera
 * `CobroTiendaAnulacion*`, `LiquidacionPago*` y `LiquidacionReparto*`, y la guardia estaba verde con
 * el historial del cobro leyendo «Tania Tienda» al registrar y «Tania» al anular.
 */
const HISTORIAL_DE_CUENTA_WALLET =
  /\betiquetaDeEntidad\s*\(\s*"(wallet_tienda_movimiento|liquidacion_pago|liquidacion_reparto|pago_por_cuenta_tienda|abono_tienda)"/;

function hallazgos(fuente: string, patrones: readonly RegExp[]): string[] {
  return patrones.filter((p) => p.test(fuente)).map((p) => p.source);
}

function archivosDelServidor(): string[] {
  return archivosBajo(["lib/repositories", "lib/services"]).filter(
    (r) => PREFIJO_SERVIDOR_WALLET.test(r) || HISTORIAL_DE_CUENTA_WALLET.test(codigo(r)),
  );
}

describe("458-A R33 — el nombre de una cuenta de la wallet se compone en UN solo sitio", () => {
  it("no-vacuidad: el censo de superficies y el de lecturas del servidor tienen archivos", () => {
    expect(archivosDeLaWallet().length).toBeGreaterThan(50);
    const servidor = archivosDelServidor();
    expect(servidor).toContain("lib/repositories/WalletTiendaMovimientoRepository.ts");
    expect(servidor).toContain("lib/repositories/PagoMensajeroMovimientoRepository.ts");
    expect(servidor).toContain("lib/services/OrigenLegibleService.ts");
    expect(servidor).toContain("lib/repositories/OrigenLegibleRepository.ts");
    // Los del historial, que entran por contenido (B1 de la revision).
    expect(servidor).toContain("lib/repositories/CobroTiendaAnulacionRepository.ts");
    expect(servidor).toContain("lib/repositories/LiquidacionPagoRepository.ts");
    expect(servidor).toContain("lib/repositories/LiquidacionRepartoRepository.ts");
    expect(servidor.length).toBeGreaterThanOrEqual(11);
  });

  it("ninguna superficie de la wallet compone un nombre de persona o de tienda", () => {
    const rojos = archivosDeLaWallet()
      .map((r) => ({ r, h: hallazgos(codigo(r), COMPOSICION_EN_CLIENTE) }))
      .filter((x) => x.h.length > 0);
    expect(rojos).toEqual([]);
  });

  it("ninguna lectura de la wallet en el servidor nombra una cuenta con otra funcion", () => {
    const rojos = archivosDelServidor()
      .map((r) => ({ r, h: hallazgos(codigo(r), COMPOSICION_EN_SERVIDOR) }))
      .filter((x) => x.h.length > 0);
    expect(rojos).toEqual([]);
  });

  it("contraprueba: la fuente de antes (nombre a secas y `etiquetaDePersona`) la pone roja", () => {
    const antes = quitarComentarios(`
      const nombrePorId = new Map(usuarios.map((u) => [u.id, u.nombre]));
      return { tiendaNombre: etiquetaDePersona(fila.tienda) };
    `);
    expect(hallazgos(antes, COMPOSICION_EN_SERVIDOR)).toHaveLength(2);
    const cliente = "const t = `${tienda.nombre} ${tienda.primerApellido}`;";
    expect(hallazgos(cliente, COMPOSICION_EN_CLIENTE).length).toBeGreaterThanOrEqual(2);
  });

  it("contraprueba B1: la anulacion del cobro y los pagos/repartos de cd91bcf4 la ponen roja, y entran al censo", () => {
    // `CobroTiendaAnulacionRepository.anular` tal como estaba en cd91bcf4 (lineas 50-63).
    const anulacionDeAntes = quitarComentarios(`
      const cobro = await tx.walletTiendaMovimiento.findUnique({
        where: { id: input.cobroId },
        select: { monto: true, tienda: { select: { nombre: true } } },
      });
      await appendAccion(tx, [{
        entidadEtiqueta: etiquetaDeEntidad("wallet_tienda_movimiento", {
          tiendaNombre: cobro?.tienda.nombre ?? null,
        }),
      }]);
    `);
    expect(HISTORIAL_DE_CUENTA_WALLET.test(anulacionDeAntes)).toBe(true);
    expect(hallazgos(anulacionDeAntes, COMPOSICION_EN_SERVIDOR)).toHaveLength(2);

    // `LiquidacionPagoRepository` y `LiquidacionRepartoRepository` de cd91bcf4: nombre + primer apellido.
    const pagoDeAntes = quitarComentarios(`
      const INCLUDE = { mensajero: { select: { nombre: true, primerApellido: true } } };
      entidadEtiqueta: etiquetaDeEntidad("liquidacion_pago", {
        beneficiarioNombre: etiquetaDePersona(anulado?.mensajero ?? anulado?.tienda),
      }),
    `);
    expect(HISTORIAL_DE_CUENTA_WALLET.test(pagoDeAntes)).toBe(true);
    expect(hallazgos(pagoDeAntes, COMPOSICION_EN_SERVIDOR)).toHaveLength(2);

    // Y la forma correcta de hoy NO la pone roja (la guardia no prohibe nombrar cuentas).
    const hoy = quitarComentarios(`
      select: { monto: true, tienda: { select: CUENTA_USUARIO_SELECT } },
      tiendaNombre: cobro == null ? null : etiquetaDeCuenta(cobro.tienda),
      beneficiarioNombre: etiquetaDeCuenta(row.mensajero),
    `);
    expect(hallazgos(hoy, COMPOSICION_EN_SERVIDOR)).toEqual([]);
  });
});
