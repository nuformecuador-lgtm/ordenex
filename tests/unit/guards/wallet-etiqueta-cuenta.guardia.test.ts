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
//     por lista): ni `etiquetaDePersona(` ni `nombreCompletoUsuario(`: solo `etiquetaDeCuenta(`.
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
];

/** Los repositorios y servicios que LEEN la wallet: por prefijo, para que uno nuevo entre solo. */
const PREFIJO_SERVIDOR_WALLET =
  /^lib\/(repositories|services)\/(Wallet(Tienda|Mensajero)|PagoMensajeroMovimiento|AbonoTienda|PagoPorCuentaTienda|SaldosSatelites|OrigenLegible|FiltrosWallet)\w*\.ts$/;

function hallazgos(fuente: string, patrones: readonly RegExp[]): string[] {
  return patrones.filter((p) => p.test(fuente)).map((p) => p.source);
}

function archivosDelServidor(): string[] {
  return archivosBajo(["lib/repositories", "lib/services"]).filter((r) => PREFIJO_SERVIDOR_WALLET.test(r));
}

describe("458-A R33 — el nombre de una cuenta de la wallet se compone en UN solo sitio", () => {
  it("no-vacuidad: el censo de superficies y el de lecturas del servidor tienen archivos", () => {
    expect(archivosDeLaWallet().length).toBeGreaterThan(50);
    const servidor = archivosDelServidor();
    expect(servidor).toContain("lib/repositories/WalletTiendaMovimientoRepository.ts");
    expect(servidor).toContain("lib/repositories/PagoMensajeroMovimientoRepository.ts");
    expect(servidor).toContain("lib/services/OrigenLegibleService.ts");
    expect(servidor).toContain("lib/repositories/OrigenLegibleRepository.ts");
    expect(servidor.length).toBeGreaterThanOrEqual(8);
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
});
