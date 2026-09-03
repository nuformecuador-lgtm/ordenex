import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { quitarComentarios, codigoSinComentarios } from "../../fixtures/sin-comentarios";

// Ficha 336 (R24/R25) — la AFIRMACIÓN DEL ESTADO FINAL de un borrado.
//
// El 2026-08-30 se borraron `/mis-pagos` (ficha 44) y `/qr` (ficha 65) por decisión humana
// explícita, tomada con los datos delante. Este archivo NO prueba el proceso: prueba que el
// árbol quedó como quedó, y por eso sigue teniendo sentido dentro de un año, cuando nadie
// recuerde la ficha.
//
// ## Por qué una guardia y no «ya lo verá el typecheck»
//
// Un borrado en este repo tiene tres formas conocidas de salir mal, y las tres son MUDAS:
//
//  1. **El nivel de abajo se queda colgando.** Se borra la página y sobrevive su `_components/`,
//     que ya nadie monta (incidente del 2026-07-31).
//  2. **La cobertura AJENA se va con la propia.** Borrar un componente borra su test, y con él
//     los requisitos de OTRA feature que se probaban ahí (incidente del 2026-08-07, `da544b30`:
//     el mensajero dejó de oír el tono del chat en producción).
//  3. **La superficie de servidor sobrevive sin lector.** Las Server Actions siguen exportadas,
//     alcanzables por la red, sin ninguna pantalla que las use ni nadie que las vigile.
//
// Ninguna de las tres rompe un tipo. El typecheck solo ve la (1) si alguien importaba el módulo
// borrado; las otras dos compilan perfectamente.
//
// ## Los números están escritos a mano, y son los MEDIDOS
//
// `QrScanner` tenía TRES importadores directos y quedan DOS. NO son «cuatro»: las cuatro
// pantallas que el alta de la ficha nombraba llegan a la cámara por la cadena
// `EscanerModal → EscanerGuiaCard → QrScanner`, no por un import propio. Una guardia que
// afirmara «cuatro» habría nacido roja el día de la implementación.

const RAIZ = path.resolve(__dirname, "../../..");

const ARBOLES_DE_PRODUCCION = ["app", "components", "lib", "hooks", "providers"];

/** Todos los `.ts`/`.tsx` de una carpeta, recursivamente, en ruta relativa a la raíz. */
function fuentesDe(carpeta: string): string[] {
  const abs = path.join(RAIZ, carpeta);
  if (!existsSync(abs)) return [];
  const salida: string[] = [];
  for (const entrada of readdirSync(abs)) {
    const rel = `${carpeta}/${entrada}`;
    if (statSync(path.join(RAIZ, rel)).isDirectory()) salida.push(...fuentesDe(rel));
    else if (entrada.endsWith(".ts") || entrada.endsWith(".tsx")) salida.push(rel);
  }
  return salida;
}

/** El árbol de producción entero, leído UNA vez y ya sin comentarios. */
const PRODUCCION: ReadonlyArray<{ ruta: string; codigo: string }> = [
  ...ARBOLES_DE_PRODUCCION.flatMap(fuentesDe),
  "middleware.ts",
].map((ruta) => ({ ruta, codigo: codigoSinComentarios(ruta) }));

/** Rutas de producción cuyo CÓDIGO (no su prosa) contiene el patrón. */
function quienNombra(patron: RegExp): string[] {
  return PRODUCCION.filter((f) => patron.test(f.codigo)).map((f) => f.ruta);
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// 0 — AUTOCOMPROBACIÓN (R25). Una guardia estática rota no falla: calla.
// ─────────────────────────────────────────────────────────────────────────────────────────

describe("336 · 0 — el detector se comprueba a sí mismo antes de afirmar nada", () => {
  it("AUTOCOMPROBACIÓN: el detector ve el código y no lee la prosa", () => {
    // Las DOS direcciones sobre texto sintético. Sin la primera, un quitador que se comiera
    // todo dejaría esta guardia verde con el árbol lleno de referencias; sin la segunda,
    // bastaría un comentario que nombre `/mis-pagos` —y este repo los escribe a propósito—
    // para que la guardia se pusiera roja sobre algo que no es una referencia.
    const codigoReal = 'import { useQrNavigate } from "@/hooks/useQrNavigate";\n';
    expect(quitarComentarios(codigoReal)).toContain("useQrNavigate");

    const enLinea = `// import { useQrNavigate } from "@/hooks/useQrNavigate";\n`;
    expect(quitarComentarios(enLinea)).not.toContain("useQrNavigate");

    const enBloque = `/*\n * la ruta /mis-pagos vivía aquí\n * import { MisPagosModule } from "x";\n */\n`;
    const limpio = quitarComentarios(enBloque);
    expect(limpio).not.toContain("mis-pagos");
    expect(limpio).not.toContain("MisPagosModule");

    // Y el caso que hace que la comprobación no sea una tautología: código y prosa en la MISMA
    // línea. Lo de la izquierda sobrevive; lo de la derecha, no.
    const mezcla = `const x = "DesglosePagosMensajero"; // ver /mis-pagos\n`;
    const mezclaLimpia = quitarComentarios(mezcla);
    expect(mezclaLimpia).toContain("DesglosePagosMensajero");
    expect(mezclaLimpia).not.toContain("mis-pagos");
  });

  it("anti-vacuidad: el árbol de producción se leyó ENTERO y ningún archivo salió vacío", () => {
    // Si `fuentesDe` devolviera `[]` —una carpeta renombrada, un `existsSync` que miente—, los
    // `toEqual([])` del bloque 2 pasarían sin haber mirado un solo archivo. Este número es lo
    // único que lo impide, y solo puede subir.
    expect(
      PRODUCCION.length,
      "el recorrido del árbol de producción devolvió menos archivos de los que este repo tiene: " +
        "el detector se rompió y todo lo que afirma este archivo es vacuo",
    ).toBeGreaterThan(800);

    const vacios = PRODUCCION.filter((f) => f.codigo.trim().length === 0).map((f) => f.ruta);
    expect(vacios, "estos archivos se leyeron vacíos: el quitador se los comió").toEqual([]);

    // Y un control positivo del propio recorrido: un archivo que SÍ tiene que estar.
    expect(PRODUCCION.map((f) => f.ruta)).toContain("components/shared/QrScanner.tsx");
    expect(PRODUCCION.map((f) => f.ruta)).toContain("middleware.ts");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// 1 — Las rutas no existen (R1, R2)
// ─────────────────────────────────────────────────────────────────────────────────────────

describe("336 · 1 — las dos rutas y sus carpetas no están en el árbol", () => {
  it("las dos rutas y sus carpetas no están en el árbol", () => {
    expect(existsSync(path.join(RAIZ, "app/(app)/mis-pagos")), "/mis-pagos sigue en el árbol").toBe(
      false,
    );
    expect(
      existsSync(path.join(RAIZ, "app/(app)/mis-pagos/_components")),
      "la página se borró y su carpeta de componentes se quedó colgando: es la forma exacta del " +
        "incidente del 2026-07-31",
    ).toBe(false);
    expect(existsSync(path.join(RAIZ, "app/(app)/qr")), "/qr sigue en el árbol").toBe(false);

    // CONTROL DE NO-VACUIDAD del `not`: una ausencia solo prueba algo si el resolvedor de rutas
    // funciona. `/mi-wallet` es la pantalla hermana —mismo defecto, decisión OPUESTA— y sigue
    // viva: si esto diera `false`, las tres aserciones de arriba no estarían midiendo nada.
    expect(
      existsSync(path.join(RAIZ, "app/(app)/mi-wallet/_components")),
      "el resolvedor de rutas está roto: `mi-wallet` tampoco existe, así que la ausencia de " +
        "`mis-pagos` no significa nada",
    ).toBe(true);
  });

  it("`hooks/useQrNavigate.ts` no existe", () => {
    expect(existsSync(path.join(RAIZ, "hooks/useQrNavigate.ts"))).toBe(false);
    // Su único importador era `app/(app)/qr/page.tsx`, verificado en el archivo real antes de
    // borrarlo. Control de no-vacuidad: la carpeta `hooks/` sigue existiendo y con hooks dentro.
    expect(fuentesDe("hooks").length).toBeGreaterThan(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// 2 — Cero referencias de EJECUCIÓN (R3)
// ─────────────────────────────────────────────────────────────────────────────────────────

describe("336 · 2 — ningún módulo de producción referencia las rutas ni los símbolos borrados", () => {
  it("ningún módulo de producción referencia las rutas ni los símbolos borrados (sin contar comentarios)", () => {
    // `DesglosePagos` va con frontera de palabra por la DERECHA a propósito:
    // `DesglosePagosMensajero` es el componente VIVO del maestro y no puede casar.
    const prohibidos: ReadonlyArray<[string, RegExp]> = [
      ["mis-pagos", /mis-pagos/],
      ["useQrNavigate", /\buseQrNavigate\b/],
      ["MisPagosModule", /\bMisPagosModule\b/],
      ["CuentaPorPagarCard", /\bCuentaPorPagarCard\b/],
      ["DesglosePagos (exacto, NO DesglosePagosMensajero)", /\bDesglosePagos\b/],
      ["COLUMNAS_DESCARGA_MIS_PAGOS", /\bCOLUMNAS_DESCARGA_MIS_PAGOS\b/],
      ["filaDescargaMiPago", /\bfilaDescargaMiPago\b/],
      ["CATEGORIA_PAGO_LABEL de mis-pagos", /mis-pagos-labels/],
      ["verMiCuentaPorPagarAction", /\bverMiCuentaPorPagarAction\b/],
      ["listarMisPagosAction", /\blistarMisPagosAction\b/],
      ["listarMisPagosCompletoAction", /\blistarMisPagosCompletoAction\b/],
      ["navegación a /qr", /["'`]\/qr["'`]/],
    ];

    const hallazgos = prohibidos.flatMap(([nombre, patron]) =>
      quienNombra(patron).map((ruta) => `${ruta} nombra ${nombre}`),
    );

    expect(
      hallazgos.sort(),
      "estos módulos de producción siguen REFERENCIANDO (no mencionando en prosa: el detector " +
        "quita los comentarios) algo que la ficha 336 borró. Un import, un `href` o un " +
        "`router.push` a una ruta que no existe no rompe el build de Next: rompe al usuario que " +
        "hace clic.",
    ).toEqual([]);
  });

  it("CONTROL POSITIVO del bloque anterior: el detector SÍ encuentra lo que sigue vivo", () => {
    // La lista de arriba está vacía. Vacía porque no queda nada, o vacía porque el detector no
    // mira: la diferencia la marca este caso. Los tres símbolos que SÍ sobreviven tienen que
    // aparecer, y con el mismo recorrido y el mismo quitador.
    expect(quienNombra(/\bDesglosePagosMensajero\b/).length).toBeGreaterThan(0);
    expect(quienNombra(/\blistarPagosDeMensajeroAction\b/).length).toBeGreaterThan(0);
    expect(quienNombra(/\bQrScanner\b/).length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// 3 — La cámara compartida sigue viva (R6, R7)
// ─────────────────────────────────────────────────────────────────────────────────────────

/** Las SEIS superficies de escaneo que llegan a la cámara por la tarjeta compartida. */
const SUPERFICIES_DE_ESCANEO = [
  "app/(app)/ordenes/_components/EscanerRecepcionOrigen.tsx",
  "app/(app)/ordenes/_components/EscanerRecepcionBodegaCentral.tsx",
  "app/(app)/recepcion-satelite/_components/EscanerRecepcion.tsx",
  "app/(app)/recoleccion/_components/RecoleccionModule.tsx",
  "app/(app)/mis-asignaciones/_components/RecogerPaqueteCard.tsx",
  "app/(app)/cierres-admin/_components/cierre-confirmacion-fisica.tsx",
];

/** Los importadores DIRECTOS de la cámara. Eran tres; `qr/page.tsx` se fue con la ficha. */
const IMPORTADORES_DIRECTOS = [
  "components/shared/EscanerGuiaCard.tsx",
  "app/(app)/mis-asignaciones/_components/VerificarGuiaGate.tsx",
];

describe("336 · 3 — `QrScanner` sigue exportado y con sus importadores directos", () => {
  it("`QrScanner` sigue exportado y con sus importadores directos", () => {
    const camara = "components/shared/QrScanner.tsx";
    expect(existsSync(path.join(RAIZ, camara)), "se borró la cámara compartida").toBe(true);
    expect(codigoSinComentarios(camara)).toMatch(/export\s+(function|const)\s+QrScanner\b/);

    // El import, no la mención: por eso se lee el código sin comentarios. Cinco archivos de
    // `app/` NOMBRAN `QrScanner` en un comentario explicando por qué montan el modal, y ninguno
    // lo importa.
    const importadores = PRODUCCION.filter((f) =>
      /import\s*\{[^}]*\bQrScanner\b[^}]*\}\s*from\s*["']@\/components\/shared\/QrScanner["']/.test(
        f.codigo,
      ),
    ).map((f) => f.ruta);

    for (const esperado of IMPORTADORES_DIRECTOS) {
      expect(importadores, `${esperado} dejó de importar la cámara`).toContain(esperado);
    }
    expect(
      importadores.length,
      "la cámara compartida se quedó con menos de dos importadores directos: o alguien se llevó " +
        "por delante una pantalla que sí escanea, o `QrScanner` está a un paso de ser código " +
        "muerto y nadie lo dijo",
    ).toBeGreaterThanOrEqual(2);
  });

  it("las seis superficies de escaneo siguen montando la tarjeta compartida", () => {
    const sinTarjeta = SUPERFICIES_DE_ESCANEO.filter((ruta) => {
      if (!existsSync(path.join(RAIZ, ruta))) return true;
      return !/<EscanerGuiaCard[\s/>]/.test(codigoSinComentarios(ruta));
    });

    expect(
      sinTarjeta,
      "estas pantallas ya no montan `EscanerGuiaCard`, que es como llegan a la cámara. Son las " +
        "SEIS superficies de escaneo de la app (recepción en origen, en bodega central, en " +
        "satélite, recolección en tienda, recogida del mensajero y confirmación física del " +
        "cierre): la ficha 336 borró `/qr`, no el escaneo.",
    ).toEqual([]);
    expect(SUPERFICIES_DE_ESCANEO.length).toBe(6);

    // `EscanerModal` es lo que MONTA y DESMONTA la tarjeta: sin él la cámara se quedaría
    // encendida. Se afirma aparte porque no es una superficie, es el envoltorio.
    const modal = "components/shared/EscanerModal.tsx";
    expect(existsSync(path.join(RAIZ, modal))).toBe(true);
    expect(codigoSinComentarios("components/shared/EscanerGuiaCard.tsx")).toMatch(/<QrScanner/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// 4 — Las acciones se RETIRARON, no se taparon (R4, R12)
// ─────────────────────────────────────────────────────────────────────────────────────────

describe("336 · 4 — el módulo de acciones del pago por mensajero no exporta las tres lecturas de `/mis-pagos`", () => {
  const MODULO = "lib/actions/wallet-mensajero.ts";

  it("el módulo de acciones del pago por mensajero no exporta las tres lecturas de `/mis-pagos`", () => {
    const codigo = codigoSinComentarios(MODULO);
    for (const accion of [
      "verMiCuentaPorPagarAction",
      "listarMisPagosAction",
      "listarMisPagosCompletoAction",
    ]) {
      expect(codigo, `${MODULO} sigue exportando ${accion}`).not.toMatch(
        new RegExp(`export\\s+async\\s+function\\s+${accion}\\b`),
      );
    }
  });

  it("CONTROL POSITIVO: las cuatro acciones de administración siguen exportadas", () => {
    // Sin esto, borrar el archivo entero dejaría el caso de arriba en verde. La wallet de
    // mensajeros del admin (`/wallet/mensajeros`) es lo que esta ficha NO toca.
    const codigo = codigoSinComentarios(MODULO);
    for (const accion of [
      "listarCuentasPorPagarAction",
      "listarCuentasPorPagarPaginadoAction",
      "listarCuentasPorPagarCompletoAction",
      "listarPagosDeMensajeroAction",
      "listarPagosDeMensajeroCompletoAction",
    ]) {
      expect(codigo, `${MODULO} dejó de exportar ${accion}`).toMatch(
        new RegExp(`export\\s+async\\s+function\\s+${accion}\\b`),
      );
    }
  });

  it("ninguna acción del pago por mensajero lleva `@sin-superficie` nueva", () => {
    // La salida elegida fue RETIRAR, no anotar (design §2). La anotación afirma «esto se queda
    // sin superficie por un motivo real», y aquí el motivo no existía: la capacidad desaparece.
    // Anotarlas habría escrito una excusa falsa junto al código, y tres excepciones eternas son
    // exactamente la allowlist que la guardia de superficie vino a evitar.
    //
    // Se lee el fuente CRUDO a propósito: la anotación vive dentro de un comentario, así que el
    // quitador se la llevaría y este caso pasaría siempre.
    const crudo = readFileSync(path.join(RAIZ, MODULO), "utf8");
    const anotaciones = [...crudo.matchAll(/@sin-superficie/g)];
    expect(
      anotaciones.length,
      "el módulo del pago por mensajero ganó (o perdió) anotaciones `@sin-superficie`. La única " +
        "admitida es la que ya vivía sobre `listarCuentasPorPagarAction` desde el 2026-08-01, y " +
        "es EXACTAMENTE una: las tres lecturas de `/mis-pagos` se retiraron, no se taparon.",
    ).toBe(1);
    expect(crudo).toMatch(/@sin-superficie[^\n]*listarCuentasPorPagarPaginadoAction/);
  });

  it("el servicio y su interfaz tampoco declaran ya los tres métodos", () => {
    // R5: la retirada llega hasta abajo. Si se quedaran en la interfaz, todo doble de test
    // tendría que seguir implementándolos y el contrato prometería una lectura que nadie sirve.
    const servicio = codigoSinComentarios("lib/services/WalletMensajeroService.ts");
    const interfaz = codigoSinComentarios("lib/interfaces/services/IWalletMensajeroService.ts");
    for (const metodo of ["verMiCuentaPorPagar", "listarMisPagos", "listarMisPagosCompleto"]) {
      expect(servicio, `el servicio sigue declarando ${metodo}`).not.toMatch(
        new RegExp(`\\basync\\s+${metodo}\\s*\\(`),
      );
      expect(interfaz, `la interfaz sigue declarando ${metodo}`).not.toMatch(
        new RegExp(`^\\s{2}${metodo}\\s*\\(`, "m"),
      );
    }

    // CONTROL POSITIVO: el repositorio y las cinco lecturas de administración siguen en pie.
    expect(existsSync(path.join(RAIZ, "lib/repositories/PagoMensajeroMovimientoRepository.ts"))).toBe(
      true,
    );
    expect(interfaz).toMatch(/\blistarPagosDeMensajero\s*\(/);
    expect(servicio).toMatch(/\basync\s+listarCuentasPorPagarPaginado\s*\(/);

    // R9: el schema BASE sobrevive. Se llama `listarPagosMensajeroSchema` y parece «el de mis
    // pagos», pero es del que `listarPagosDeMensajeroSchema` deriva con `.extend(...)`:
    // borrarlo rompe la vista del maestro sin que ningún nombre lo delate.
    const tipos = codigoSinComentarios("lib/types/wallet-mensajero.ts");
    expect(tipos).toMatch(/export const listarPagosMensajeroSchema\b/);
    expect(tipos).toMatch(/listarPagosDeMensajeroSchema = listarPagosMensajeroSchema\.extend/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// 5 — El baseline no ganó entradas de esta ficha (R13)
// ─────────────────────────────────────────────────────────────────────────────────────────

describe("336 · 5 — el baseline no ganó entradas de esta ficha", () => {
  it("el baseline no ganó entradas de esta ficha", () => {
    // POR QUÉ ESTE CASO EXISTE, y es la trampa que la ficha vino a esquivar: el gate compara el
    // baseline POR ARCHIVO, no por contenido. Cuando esta ficha (336) se escribió,
    // `superficie-de-uso.guardia.test.ts` YA estaba listado por una deuda AJENA
    // (`lib/actions/tarifas.ts:67 obtenerTarifa`, desde el 2026-08-28, retirada por la ficha 369
    // el 2026-09-03). Si esta ficha hubiera dejado sus tres acciones huérfanas dentro de esa
    // misma entrada, el gate habría salido VERDE MINTIENDO.
    const crudo = readFileSync(path.join(RAIZ, "tests/baseline-rojos.json"), "utf8");
    const baseline = JSON.parse(crudo) as {
      archivos: Record<string, { motivo: string; desde: string }>;
    };

    const textoDeLaLista = Object.entries(baseline.archivos)
      .map(([archivo, e]) => `${archivo} ${e.motivo}`)
      .join("\n");

    for (const rastro of ["mis-pagos", "useQrNavigate", "wallet-mensajero", "336"]) {
      expect(
        textoDeLaLista.includes(rastro),
        `el baseline menciona «${rastro}»: esta ficha metió un rojo PROPIO en la lista de rojos ` +
          "ajenos, que es exactamente el agujero que el baseline no cubre (R14). La ficha se " +
          "detiene y se reporta al humano.",
      ).toBe(false);
    }

    // Y la otra mitad: si la entrada de la guardia de superficie sigue viva, su motivo tiene que
    // seguir siendo la deuda ajena Y SOLO ELLA.
    const superficie = baseline.archivos["tests/unit/guards/superficie-de-uso.guardia.test.ts"];
    if (superficie) {
      expect(superficie.motivo).toMatch(/tarifas/);
      expect(superficie.motivo).toMatch(/obtenerTarifa/);
    }

    // Control de no-vacuidad: el JSON se leyó y tiene forma. Sin esto, un baseline vacío o mal
    // parseado dejaría los `false` de arriba en verde sin haber mirado nada.
    // NO se exige `archivos` no vacío (ficha 369, 2026-09-03): un baseline SIN deuda conocida es
    // un estado legítimo y deseable — es justo lo que pasó al arreglarse `obtenerTarifa`, la
    // última entrada que quedaba. Lo que sí tiene que seguir siendo cierto es que el archivo se
    // leyó de verdad y no vino vacío o truncado por un parseo fallido.
    expect(baseline.archivos).toBeTypeOf("object");
    expect(crudo.length, "el baseline se leyó vacío o truncado").toBeGreaterThan(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// 6 — La cobertura AJENA sobrevivió (R15, R20, R21, R22)
// ─────────────────────────────────────────────────────────────────────────────────────────

/** Los archivos de test de OTRAS features que esta ficha editó y que NO podían desaparecer. */
const COBERTURA_AJENA = [
  "tests/unit/actions/wallet-mensajero-actions.test.ts",
  "tests/unit/actions/wallet-mensajero-descarga-action.test.ts",
  "tests/unit/services/wallet-mensajero-service.test.ts",
  "tests/unit/services/wallet-cuentas-paginado.test.ts",
  "tests/unit/services/wallet-desglose-mensajero-descarga.test.ts",
  "tests/unit/descarga/wallet-mensajero-descarga-columnas.test.ts",
  "tests/components/descarga/WalletDescarga.test.tsx",
  "tests/components/PremioRankingRotulo.test.tsx",
  "tests/components/QrScanner.test.tsx",
  "tests/unit/guards/liquidacion-money-safe.test.ts",
  "tests/unit/guards/caja-173-alcance.guardia.test.ts",
  "tests/unit/descarga/censo-tablas.ts",
  "tests/unit/descarga/cobertura-tablas.guardia.test.ts",
  "tests/integration/db/pago-mensajero-liquidacion.test.ts",
  "tests/integration/wallet-mensajeros-page.test.tsx",
];

describe("336 · 6 — la cobertura ajena sobrevivió al borrado", () => {
  it("los archivos de test de OTRAS features siguen existiendo", () => {
    // El incidente del 2026-08-07 en una línea: se borró un componente, se borró su test, y con
    // él se fueron los R21-R23 de la feature 161. Nadie lo vio hasta producción.
    const desaparecidos = COBERTURA_AJENA.filter((r) => !existsSync(path.join(RAIZ, r)));
    expect(
      desaparecidos,
      "estos archivos cubren features AJENAS a la 336 y ya no están: la ficha se llevó por " +
        "delante cobertura que no era suya",
    ).toEqual([]);
    expect(COBERTURA_AJENA.length).toBe(15);
  });

  it("los censos compartidos conservan su contenido, no solo su nombre", () => {
    // Un archivo que existe pero que se quedó vacío por dentro pasa el caso anterior y no
    // prueba nada. Esto mira lo que cada uno tenía que CONSERVAR, uno por uno.

    // R21 — el control POSITIVO del test de esquema: al menos DOS acciones vivas como testigo.
    // Con una sola, el siguiente borrado lo deja vacuo sin que nada lo diga.
    const liquidacion = codigoSinComentarios(
      "tests/integration/db/pago-mensajero-liquidacion.test.ts",
    );
    const testigos = [...liquidacion.matchAll(/typeof actions\.(\w+)\)\.toBe\("function"\)/g)].map(
      (m) => m[1],
    );
    expect(
      testigos.length,
      "el control positivo del test de esquema bajó de dos testigos: una aserción NEGATIVA sobre " +
        "un módulo pasa sola si el módulo se queda vacío o cambia de ruta",
    ).toBeGreaterThanOrEqual(2);
    for (const retirada of ["verMiCuentaPorPagarAction", "listarMisPagosAction"]) {
      expect(testigos, `el testigo ${retirada} ya no existe: no puede seguir citado`).not.toContain(
        retirada,
      );
    }

    // R18/R19 — la guardia de alcance de la 173 conserva ≥ 2 carpetas congeladas.
    const caja = codigoSinComentarios("tests/unit/guards/caja-173-alcance.guardia.test.ts");
    const congeladas = [...caja.matchAll(/"(app\/\(app\)\/[^"]+_components)"/g)].map((m) => m[1]);
    expect(new Set(congeladas).size).toBeGreaterThanOrEqual(2);
    expect(caja).not.toMatch(/mis-pagos/);

    // R17 — el censo money-safe de la 172 sigue siendo largo y sin las rutas borradas.
    const moneySafe = codigoSinComentarios("tests/unit/guards/liquidacion-money-safe.test.ts");
    expect([...moneySafe.matchAll(/"(app|components|lib)\/[^"]+\.tsx?"/g)].length).toBeGreaterThan(
      30,
    );
    expect(moneySafe).not.toMatch(/mis-pagos/);

    // R22 — la aserción de orden que NOMBRA la constante que sobrevive. Es lo que la mantiene
    // fuera del censo de «constante sin aserción de orden» de `columnas-asercion-de-orden`.
    const columnas = codigoSinComentarios(
      "tests/unit/descarga/wallet-mensajero-descarga-columnas.test.ts",
    );
    expect(columnas).toMatch(/expect\(COLUMNAS_DESCARGA_DESGLOSE_MENSAJERO\b/);
    expect(columnas).not.toMatch(/COLUMNAS_DESCARGA_MIS_PAGOS/);

    // R15 — `WalletDescarga` conserva ≥ 3 ledgers en su tabla de casos. Y su lista de módulos
    // de presentación se lee con `readFileSync`: una ruta borrada ahí no falla con un
    // diagnóstico, revienta con ENOENT y tumba el archivo entero.
    const walletDescarga = codigoSinComentarios("tests/components/descarga/WalletDescarga.test.tsx");
    expect([...walletDescarga.matchAll(/montar:\s*render\w+/g)].length).toBeGreaterThanOrEqual(3);
    expect(walletDescarga).not.toMatch(/mis-pagos/);

    // R20 — la cobertura de la 293 sigue afirmándose sobre lo que sobrevive.
    const premio = codigoSinComentarios("tests/components/PremioRankingRotulo.test.tsx");
    expect(premio).toMatch(/filaDescargaDesgloseMensajero/);
    expect(premio).not.toMatch(/mis-pagos/);

    // R16 — el censo de tablas descargables no cita el archivo borrado.
    expect(codigoSinComentarios("tests/unit/descarga/censo-tablas.ts")).not.toMatch(/mis-pagos/);
  });

  it("los DOS tests que sí eran suyos se fueron con la pantalla", () => {
    // La otra mitad de la regla: lo que era SUYO no puede quedarse colgando probando un módulo
    // que ya no existe.
    for (const suyo of [
      "tests/integration/mis-pagos-page.test.tsx",
      "tests/unit/services/wallet-mis-pagos-descarga.test.ts",
    ]) {
      expect(existsSync(path.join(RAIZ, suyo)), `${suyo} sigue en el árbol`).toBe(false);
    }
  });
});
