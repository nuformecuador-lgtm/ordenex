import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, afterEach } from "vitest";

import { loadCierreConfig } from "@/lib/config/cierre";
import { loadCierreBodegaConfig } from "@/lib/config/cierre-bodega";
import { loadIncidentesConfig } from "@/lib/config/incidentes";
import { loadWalletTiendaConfig } from "@/lib/config/wallet-tienda";
import { loadGastoFijoConfig } from "@/lib/config/gasto-fijo";
import { loadRecepcionSateliteConfig } from "@/lib/config/recepcion-satelite";

// Feature 170 — FASE 2, T H.1 (R40): tamano de pagina POR DOMINIO de los 13 listados que
// pasan a paginacion server-side (Anexo III).
//
// Que se prueba y por que, porque «una config con dos numeros» parece no necesitar test:
//  1. que los SEIS dominios nuevos declaren default y maximo, y que el default no supere al
//     maximo (R40: «tamano de pagina maximo acotado por configuracion»). Un default por
//     encima del maximo es una consulta que el clamp del schema recorta en silencio, o sea
//     una pantalla que muestra menos filas de las que su propia config promete;
//  2. que sigan siendo sobreescribibles por entorno y que un valor basura NO se cuele
//     (patron `readPositiveInt`, docs/architecture.md: «sin hardcode de contexto»);
//  3. que las pantallas de esos 13 listados no se inventen su tamano de pagina con un
//     literal — el criterio «ningun literal de tamano en app/» de T H.1.
//
// Q2 (requirements.md) queda instrumentada como se propuso: NO hay un tamano unico global,
// hay uno por dominio, con los MISMOS valores que ya usan ordenes/usuarios/plantillas/API
// keys (25 por defecto, tope 100) para que las opciones 10/25/50 de la UI sigan valiendo.

const RAIZ = path.resolve(__dirname, "../../..");

interface DominioPaginado {
  /** Nombre del dominio tal como lo nombra T H.1. */
  nombre: string;
  /** Modulo de config. */
  cargar: () => { DEFAULT_PAGE_SIZE: number; MAX_PAGE_SIZE: number };
  /** Variables de entorno que lo sobreescriben. */
  envDefault: string;
  envMax: string;
  /** Listados del Anexo III que sirve este dominio (para que la lista no sea abstracta). */
  listados: string[];
}

const DOMINIOS: DominioPaginado[] = [
  {
    nombre: "cierres del dia",
    cargar: loadCierreConfig,
    envDefault: "CIERRE_DEFAULT_PAGE_SIZE",
    envMax: "CIERRE_MAX_PAGE_SIZE",
    listados: [
      "Cierres del dia pendientes de decision",
      "Cierres del dia — historico",
      "Cierres del dia a consolidar",
      "Cierres solicitados por el mensajero",
    ],
  },
  {
    nombre: "cierre de bodega",
    cargar: loadCierreBodegaConfig,
    envDefault: "CIERRE_BODEGA_DEFAULT_PAGE_SIZE",
    envMax: "CIERRE_BODEGA_MAX_PAGE_SIZE",
    listados: [
      "Cierres de bodega pendientes",
      "Cierres de bodega resueltos",
      "Cierres de bodega solicitados",
    ],
  },
  {
    nombre: "incidentes",
    cargar: loadIncidentesConfig,
    envDefault: "INCIDENTES_DEFAULT_PAGE_SIZE",
    envMax: "INCIDENTES_MAX_PAGE_SIZE",
    listados: ["Incidentes pendientes de decision", "Incidentes — historico"],
  },
  {
    nombre: "wallet-tienda",
    cargar: loadWalletTiendaConfig,
    envDefault: "WALLET_TIENDA_DEFAULT_PAGE_SIZE",
    envMax: "WALLET_TIENDA_MAX_PAGE_SIZE",
    listados: ["Saldos de tiendas"],
  },
  {
    nombre: "gasto fijo",
    cargar: loadGastoFijoConfig,
    envDefault: "GASTO_FIJO_DEFAULT_PAGE_SIZE",
    envMax: "GASTO_FIJO_MAX_PAGE_SIZE",
    listados: ["Plantillas de gasto fijo"],
  },
  {
    nombre: "recepcion satelite",
    cargar: loadRecepcionSateliteConfig,
    envDefault: "RECEPCION_SATELITE_DEFAULT_PAGE_SIZE",
    envMax: "RECEPCION_SATELITE_MAX_PAGE_SIZE",
    listados: ["Ordenes de la bodega satelite"],
  },
];

afterEach(() => {
  for (const d of DOMINIOS) {
    delete process.env[d.envDefault];
    delete process.env[d.envMax];
  }
});

describe("configuracion de paginacion por dominio (T H.1, R40)", () => {
  it("cada dominio nuevo declara default y maximo, y el default no supera el maximo", () => {
    // Los seis dominios de T H.1. La lista se afirma para que anadir un dominio sin
    // configurarlo no pase por aqui de largo.
    expect(DOMINIOS.map((d) => d.nombre)).toEqual([
      "cierres del dia",
      "cierre de bodega",
      "incidentes",
      "wallet-tienda",
      "gasto fijo",
      "recepcion satelite",
    ]);

    for (const dominio of DOMINIOS) {
      const cfg = dominio.cargar();
      expect(cfg.DEFAULT_PAGE_SIZE, `${dominio.nombre}: DEFAULT_PAGE_SIZE`).toBeGreaterThan(0);
      expect(cfg.MAX_PAGE_SIZE, `${dominio.nombre}: MAX_PAGE_SIZE`).toBeGreaterThan(0);
      expect(
        cfg.DEFAULT_PAGE_SIZE,
        `${dominio.nombre}: el default no puede superar al maximo`,
      ).toBeLessThanOrEqual(cfg.MAX_PAGE_SIZE);
    }
  });

  it("los seis dominios cubren 12 de los 13 listados del Anexo III", () => {
    // R40 habla de «cada listado del Anexo III». Sin esta cuenta, configurar cinco dominios
    // de seis pasaria el test de arriba igual de verde.
    const listados = DOMINIOS.flatMap((d) => d.listados);
    expect(new Set(listados).size).toBe(listados.length); // ninguno declarado dos veces
    expect(listados).toHaveLength(12);
    // El 13.º es «Cuentas por pagar a mensajeros» (dominio wallet-mensajero, tanda L), que
    // NO figura entre los seis dominios que enumera T H.1. Se deja como PREGUNTA ABIERTA en
    // progress/impl_170-fase2-tanda-h.md en vez de inventar aqui una config que el spec no
    // pidio: quien haga la tanda L decide si nace `lib/config/wallet-mensajero.ts` o si ese
    // listado se cuelga de otro dominio. El numero 12 es el que hace visible el hueco.
  });

  it("respeta overrides validos de entorno, dominio a dominio", () => {
    for (const dominio of DOMINIOS) {
      process.env[dominio.envDefault] = "10";
      process.env[dominio.envMax] = "50";
      const cfg = dominio.cargar();
      expect(cfg.DEFAULT_PAGE_SIZE, dominio.nombre).toBe(10);
      expect(cfg.MAX_PAGE_SIZE, dominio.nombre).toBe(50);
      delete process.env[dominio.envDefault];
      delete process.env[dominio.envMax];
    }
  });

  it("ignora env no positivo o no numerico y cae al default de 25/100", () => {
    for (const dominio of DOMINIOS) {
      process.env[dominio.envDefault] = "abc";
      process.env[dominio.envMax] = "-5";
      const cfg = dominio.cargar();
      expect(cfg.DEFAULT_PAGE_SIZE, dominio.nombre).toBe(25);
      expect(cfg.MAX_PAGE_SIZE, dominio.nombre).toBe(100);
      delete process.env[dominio.envDefault];
      delete process.env[dominio.envMax];
    }
  });
});

/**
 * Archivos de `app/` que pintan los 13 listados del Anexo III (design §11.3, verificado
 * contra `tests/unit/descarga/censo-tablas.ts`). Ocho archivos para trece listados: cuatro
 * modulos montan dos tablas cada uno.
 */
const PANTALLAS_ANEXO_III = [
  "app/(app)/cierre-dia/_components/CierreDiaModule.tsx",
  "app/(app)/cierres-admin/_components/CierresAdminModule.tsx",
  "app/(app)/cierres-admin/_components/CierresBodegaAdminModule.tsx",
  "app/(app)/cierres-admin/_components/ConsolidacionBodegaModule.tsx",
  "app/(app)/incidentes/_components/IncidentesAdminModule.tsx",
  "app/(app)/recepcion-satelite/_components/SateliteOrdenesListado.tsx",
  "app/(app)/wallet/_components/GastosFijosPlantillasPanel.tsx",
  "app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable.tsx",
  "app/(app)/wallet/tiendas/_components/SaldosTiendasTable.tsx",
  // Feature 170 — FASE 2 (T I.2): cuatro de esos listados se llevaron su tabla y su control
  // de paginación a un componente propio. La guardia los sigue: si no, dejaría de vigilar
  // exactamente los archivos donde se escribe hoy el `pageSize`.
  "app/(app)/cierres-admin/_components/CierresAdminHistoricoTabla.tsx",
  "app/(app)/cierres-admin/_components/CierresBodegaResueltosTabla.tsx",
  "app/(app)/cierres-admin/_components/CierresBodegaSolicitadosTabla.tsx",
  "app/(app)/incidentes/_components/IncidentesHistoricoTabla.tsx",
];

/**
 * `pageSize: 20`, `pageSize={20}`, `const PAGE_SIZE = 20`, `const DESGLOSE_PAGE_SIZE = 20`.
 * El prefijo opcional importa: el literal que existe hoy en el repo se llama
 * `DESGLOSE_PAGE_SIZE`, y un `\b` delante de `PAGE_SIZE` no lo habria visto.
 */
const LITERAL_TAMANO = /(?:\bpageSize|[A-Z_]*PAGE_SIZE[A-Z_]*)\s*[:=]\s*\{?\s*\d+/g;

describe("el tamano de pagina no se inventa en la pantalla (T H.1)", () => {
  it("ninguna pantalla del Anexo III declara un literal de tamano de pagina", () => {
    // El criterio de «Hecho» de T H.1 dice «ningun literal de tamano en app/». Esta guardia
    // lo acota a las pantallas que la FASE 2 va a cablear, que es donde el literal se
    // introduciria: hoy NINGUNA de las nueve pagina, asi que la guardia esta verde por
    // ausencia — y ese es su valor, porque se pone ROJA en cuanto la tanda I/J/K escriba
    // `pageSize: 20` en vez de leer `<dominio>Config.DEFAULT_PAGE_SIZE`.
    //
    // Deuda PREEXISTENTE y declarada, fuera del Anexo III (no se toca aqui):
    // `DesglosePagosMensajero.tsx` y `DesgloseMovimientosTienda.tsx` tienen
    // `const DESGLOSE_PAGE_SIZE = 20`, y `TiendasModule`/`ZonasTarifasModule` tienen
    // `const PAGE_SIZE = 100`. Ver progress/impl_170-fase2-tanda-h.md.
    const infractoras: string[] = [];

    for (const relativa of PANTALLAS_ANEXO_III) {
      const archivo = path.join(RAIZ, relativa);
      // Anti-vacuidad: si una pantalla se renombra, la guardia deja de vigilarla en
      // silencio. Falla en vez de encogerse.
      expect(existsSync(archivo), `${relativa} no existe: actualiza PANTALLAS_ANEXO_III`).toBe(
        true,
      );
      const fuente = readFileSync(archivo, "utf8");
      for (const encontrado of fuente.matchAll(LITERAL_TAMANO)) {
        infractoras.push(`${relativa}: ${encontrado[0]}`);
      }
    }

    expect(
      infractoras,
      "el tamano de pagina sale de lib/config/<dominio>.ts, no de un literal en la pantalla",
    ).toEqual([]);
  });
});
