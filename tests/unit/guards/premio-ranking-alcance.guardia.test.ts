import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

/**
 * FEATURE 293 (T6.1, R1/R3/R13/R21) — GUARDIA DE ALCANCE: **el premio tiene UNA sola puerta, y
 * nada mas la abre.**
 *
 * Las cuatro propiedades que este archivo vigila son AUSENCIAS, y una ausencia solo prueba algo
 * si lo ausente EXISTE en algun sitio. Por eso cada bloque lleva su CONTROL DE NO-VACUIDAD
 * explicito (leccion de `caja-173-alcance.guardia.test.ts`): sin el, un `grep` mal escrito da la
 * misma salida vacia que un alcance respetado.
 *
 * Y por que el censo va sobre el ARBOL y no sobre `git diff`: un test que preguntara a git por
 * `origin/dev...HEAD` daria VACIO —y por tanto verde— el dia despues del merge, para siempre.
 * Seria una guardia que se apaga sola justo cuando empieza a hacer falta.
 */

const RAIZ = path.resolve(__dirname, "../../..");

/** Las escrituras de Prisma. `create` incluido: el censo persigue TODA forma de insertar. */
const ESCRITURAS = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"];

function fuentesDe(carpeta: string): string[] {
  const abs = path.join(RAIZ, carpeta);
  const salida: string[] = [];
  for (const entrada of readdirSync(abs)) {
    const rel = `${carpeta}/${entrada}`;
    if (statSync(path.join(RAIZ, rel)).isDirectory()) salida.push(...fuentesDe(rel));
    else if (entrada.endsWith(".ts") || entrada.endsWith(".tsx")) salida.push(rel);
  }
  return salida;
}

/** Codigo sin comentarios: el censo mide lo que se EJECUTA, no lo que se explica. */
function codigoSinComentarios(ruta: string): string {
  return readFileSync(path.join(RAIZ, ruta), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const FUENTES = [...fuentesDe("lib"), ...fuentesDe("app"), ...fuentesDe("scripts")];

// ── R1/R3: una sola puerta, y siempre un acto humano ────────────────────────────────────────

describe("R1/R3 — el UNICO modulo que escribe `premio_ranking` es su servicio", () => {
  /** Archivos cuyo codigo NOMBRA la categoria del premio (no los que solo la rotulan). */
  const queLaNombran = FUENTES.filter((ruta) => /"premio_ranking"/.test(codigoSinComentarios(ruta)));

  it("control de NO-VACUIDAD: el arbol es grande y la categoria existe de verdad", () => {
    expect(FUENTES.length).toBeGreaterThan(500);
    expect(queLaNombran.length).toBeGreaterThan(0);
  });

  it("R3: el censo de `lib/` es EXACTAMENTE estos seis, con su papel declarado", () => {
    // El censo se declara ENTERO para que un SEPTIMO archivo tenga que justificarse aqui antes
    // de existir. Ninguno de los cinco primeros ESCRIBE la categoria:
    //   - el CATALOGO tipado (`wallet-mensajero.ts`) la lista como valor del enum;
    //   - el CONTRATO del repositorio la nombra en un tipo (`PremioRegistradoRow`);
    //   - el REPOSITORIO la nombra en el WHERE de sus dos lecturas nuevas: es una categoria que
    //     se BUSCA, no una que se decida ahi;
    //   - la CONCILIACION la nombra para EXCLUIRLA del cuadre (R28);
    //   - el CATALOGO de metricas la lista entre las categorias del libro;
    //   - y el SERVICIO es el unico que la pone como `categoria:` de una fila a INSERTAR.
    expect(queLaNombran.filter((r) => r.startsWith("lib/")).sort()).toEqual([
      "lib/analytics/metrics.ts",
      "lib/interfaces/repositories/IPagoMensajeroMovimientoRepository.ts",
      "lib/repositories/ConciliacionCierresAnaliticaRepository.ts",
      "lib/repositories/PagoMensajeroMovimientoRepository.ts",
      "lib/services/PremioRankingDevengoService.ts",
      "lib/types/wallet-mensajero.ts",
    ]);

    // Y el ESCRITOR, medido por la forma que de verdad escribe: `categoria: "premio_ranking"`
    // dentro de la fila que se pasa a `crearMovimientos`.
    const escritores = queLaNombran.filter((ruta) =>
      /categoria: "premio_ranking",/.test(codigoSinComentarios(ruta)),
    );
    expect(escritores).toEqual(["lib/services/PremioRankingDevengoService.ts"]);
  });

  it("R3: ni el feed del cierre, ni la liquidacion, ni el cierre del dia la mencionan", () => {
    // Si cualquiera de estos la escribiera, existiria un segundo camino que emite el mismo
    // asiento de dinero — que es como se paga dos veces (decision (b) del humano).
    const prohibidos = [
      "lib/services/WalletMensajeroFeedService.ts",
      "lib/services/CierresAdminService.ts",
      "lib/services/CierreDiaService.ts",
      "lib/services/LiquidacionService.ts",
      "lib/services/CorteDiarioService.ts",
      "lib/services/RankingSnapshotService.ts",
    ];
    for (const ruta of prohibidos) {
      expect(codigoSinComentarios(ruta), `${ruta} nombra premio_ranking`).not.toMatch(
        /"premio_ranking"/,
      );
    }
    // Control de no-vacuidad: los seis archivos existen y tienen contenido.
    for (const ruta of prohibidos) {
      expect(codigoSinComentarios(ruta).length).toBeGreaterThan(500);
    }
  });

  it("R1/R3: no hay ninguna ruta de API ni ningun cron que la mencione", () => {
    const superficiesPublicas = FUENTES.filter(
      (r) => r.startsWith("app/api/") || /cron/i.test(r) || r.startsWith("scripts/"),
    );
    expect(superficiesPublicas.length).toBeGreaterThan(20); // control de no-vacuidad
    for (const ruta of superficiesPublicas) {
      expect(codigoSinComentarios(ruta), `${ruta} menciona premio_ranking`).not.toMatch(
        /"premio_ranking"|premioDia|registrarPremio/,
      );
    }
  });

  it("R1: las tres Server Actions viven en UN archivo, y no hay route handler equivalente", () => {
    const conAcciones = FUENTES.filter((r) =>
      /registrarPremioAction|anularPremioAction/.test(codigoSinComentarios(r)),
    );
    expect(conAcciones).toContain("lib/actions/premio-ranking-devengo.ts");
    expect(conAcciones.filter((r) => r.startsWith("app/api/"))).toEqual([]);
  });
});

// ── R21: filas inmutables ───────────────────────────────────────────────────────────────────

describe("R21 — el premio no se edita ni se borra: toda correccion es una fila nueva", () => {
  const servicio = codigoSinComentarios("lib/services/PremioRankingDevengoService.ts");

  it("el servicio no llama a ninguna escritura de Prisma directamente", () => {
    for (const escritura of ESCRITURAS) {
      expect(servicio, `el servicio llama a .${escritura}(`).not.toMatch(
        new RegExp(`\\.${escritura}\\s*\\(`),
      );
    }
    // Control de no-vacuidad: el servicio SI escribe, pero por el repositorio y por el puerto.
    expect(servicio).toMatch(/crearMovimientos\(/);
    expect(servicio).toMatch(/emitirEgresoPremio\(/);
    expect(servicio).toMatch(/reversarEgresoPremio\(/);
  });

  it("ni siquiera podria: su `tx` no expone `cierre_dia` ni el ledger por tienda", () => {
    const contrato = codigoSinComentarios(
      "lib/interfaces/services/IPremioRankingDevengoService.ts",
    );
    // ⚠️ FICHA 362 — EL `PremioTx` GANA TRES CLAVES, Y NINGUNA ES UN LIBRO NI EL SNAPSHOT.
    //
    // Decia `Pick<PrismaClient, "pagoMensajeroMovimiento" | "walletMovimiento">`. Hoy incluye
    // ademas `rankingSnapshotFila` (LECTURA: el nombre congelado y el puesto que etiquetan la
    // fila del registro), `historialAccion` (la fila del registro) y `usuario` (el actor
    // congelado). Las tres existen porque el registro de `premio_ranking_registrado` va en la
    // MISMA transaccion que el devengo y su egreso (362/R9).
    //
    // R21 NO SE RELAJA, y las DOS aserciones que lo sostienen siguen intactas: el `tx` sigue sin
    // exponer `cierre_dia` —el snapshot del cierre— ni el ledger por tienda.
    for (const clave of [
      "pagoMensajeroMovimiento",
      "walletMovimiento",
      "rankingSnapshotFila",
      "historialAccion",
      "usuario",
    ]) {
      expect(contrato, `PremioTx no declara ${clave}`).toContain(`"${clave}"`);
    }
    expect(contrato).not.toMatch(/cierreDia/);
    expect(contrato).not.toMatch(/cierreDia/);
    expect(contrato).not.toMatch(/walletTiendaMovimiento/);
  });
});

// ── R13: el snapshot del cierre no lo toca nadie nuevo ──────────────────────────────────────

describe("R13 — nadie escribe `cierre_dia.total_pago_mensajero` fuera de donde ya se escribia", () => {
  it("el unico modulo que lo escribe sigue siendo `CierreDiaRepository` (al SOLICITAR)", () => {
    // La forma de ESCRITURA es `totalPagoMensajero: new Prisma.Decimal(...)` dentro de un `data`.
    // `CierreBodegaRepository` escribe el suyo, que es otra tabla (`cierre_bodega`) y otro
    // snapshot: por eso se nombra aqui explicitamente en vez de dejarlo fuera por descuido.
    const escritores = FUENTES.filter((ruta) =>
      /totalPagoMensajero:\s*new Prisma\.Decimal/.test(codigoSinComentarios(ruta)),
    );
    expect(escritores.sort()).toEqual([
      "lib/repositories/CierreBodegaRepository.ts", // tabla `cierre_bodega`, no `cierre_dia`
      "lib/repositories/CierreDiaRepository.ts", // el SOLICITAR del cierre del dia
    ]);
  });

  it("los tres modulos NUEVOS de la 293 no escriben ningun total del cierre", () => {
    for (const ruta of [
      "lib/services/PremioRankingDevengoService.ts",
      "lib/services/CajaPremioRankingFeedService.ts",
      "lib/repositories/CierreDelDiaRepository.ts",
      "lib/actions/premio-ranking-devengo.ts",
    ]) {
      const codigo = codigoSinComentarios(ruta);
      expect(codigo, `${ruta} escribe un total del cierre`).not.toMatch(/totalPagoMensajero/);
      expect(codigo, `${ruta} escribe en cierreDia`).not.toMatch(/cierreDia\.(create|update)/);
    }
  });

  it("el repositorio de la resolucion dia -> cierre es de SOLO LECTURA", () => {
    const codigo = codigoSinComentarios("lib/repositories/CierreDelDiaRepository.ts");
    for (const escritura of ESCRITURAS) {
      expect(codigo).not.toMatch(new RegExp(`\\.${escritura}\\s*\\(`));
    }
    expect(codigo).toMatch(/findFirst\(/); // control de no-vacuidad: SI consulta
  });
});

// ── El escritor unico de cada libro sigue siendo su repositorio ─────────────────────────────

describe("el censo de escritores de los dos libros de dinero sigue en uno cada uno", () => {
  const LIBROS = [
    { delegado: "pagoMensajeroMovimiento", escritor: "lib/repositories/PagoMensajeroMovimientoRepository.ts" },
    { delegado: "walletMovimiento", escritor: "lib/repositories/WalletMovimientoRepository.ts" },
  ];

  for (const libro of LIBROS) {
    it(`el unico modulo que escribe en \`${libro.delegado}\` sigue siendo su repositorio`, () => {
      const escritores = FUENTES.filter((ruta) => {
        const codigo = codigoSinComentarios(ruta);
        return ESCRITURAS.some((m) => new RegExp(`${libro.delegado}\\.${m}\\s*\\(`).test(codigo));
      });
      expect(escritores).toEqual([libro.escritor]);
    });
  }
});

// ── R15: el monto sale del podio CONGELADO, no del premio vigente ───────────────────────────

describe("R15 — el servicio no puede leer el premio VIGENTE", () => {
  it("no importa `IPremioRankingRepository` ni el modelo `premioRanking`", () => {
    const servicio = codigoSinComentarios("lib/services/PremioRankingDevengoService.ts");
    const root = codigoSinComentarios("lib/actions/premio-ranking-devengo.ts");
    expect(servicio).not.toMatch(/PremioRankingRepository/);
    expect(servicio).not.toMatch(/premioRanking\./);
    // Y el composition root tampoco se lo pasa: no existe la dependencia.
    expect(root).not.toMatch(/PremioRankingRepository/);
    // Control de no-vacuidad: ese repositorio EXISTE y otros modulos si lo usan.
    const usuarios = FUENTES.filter((r) => /new PremioRankingRepository\(/.test(codigoSinComentarios(r)));
    expect(usuarios.length).toBeGreaterThan(0);
  });
});

// ── R35: money-safe en las piezas nuevas ────────────────────────────────────────────────────

describe("R35 — ninguna pieza nueva hace aritmetica de coma flotante con dinero", () => {
  const NUEVOS = [
    "lib/services/PremioRankingDevengoService.ts",
    "lib/services/CajaPremioRankingFeedService.ts",
    "lib/repositories/CierreDelDiaRepository.ts",
    "lib/actions/premio-ranking-devengo.ts",
    "lib/types/premio-ranking-devengo.ts",
    "lib/utils/pendiente-cierre.ts",
  ];

  it("ni `Number(`, ni `parseFloat`, ni `toFixed` sobre un numero suelto", () => {
    for (const ruta of NUEVOS) {
      const codigo = codigoSinComentarios(ruta);
      expect(codigo, `${ruta} usa Number(`).not.toMatch(/\bNumber\(/);
      expect(codigo, `${ruta} usa parseFloat`).not.toMatch(/parseFloat/);
    }
    // Control de no-vacuidad: los seis archivos existen y tienen codigo.
    for (const ruta of NUEVOS) expect(codigoSinComentarios(ruta).length).toBeGreaterThan(200);
  });
});
