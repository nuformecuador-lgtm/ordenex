import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { LLAMADAS_PROHIBIDAS_EN_DINERO } from "../../fixtures/money-safe";
import { quitarComentarios } from "../../fixtures/sin-comentarios";

/**
 * FICHA 335 (A13) — GUARDIA DE ALCANCE: sin migracion, sin escritura y sin dinero convertido a
 * numero en la pantalla.
 *
 * ⛔ LO QUE ESTA GUARDIA NO HACE, Y ES DELIBERADO: no mira `git diff`. Una guardia que mide el
 * diff de una rama CADUCA en cuanto la rama se mergea, y a partir de ahi juzga el trabajo de
 * cualquier rama posterior. Lo que se mide aqui son PROPIEDADES del arbol —que no hay migracion
 * con el nombre de la ficha, que `/mi-wallet` no importa ninguna action que escriba, que sus
 * archivos no convierten un monto a numero—, y ninguna asercion depende de la rama.
 *
 * LOS BARRIDOS LEEN EL CODIGO, NO EL TEXTO CRUDO. Los comentarios de este arbol NOMBRAN a
 * proposito lo que esta prohibido («money-safe: sin `parseFloat`/`Number`»), asi que un barrido
 * literal fallaria por CITARLO. Cada barrido lleva ademas su CONTRAPRUEBA en las dos
 * direcciones: caza lo colado y no caza la cita. Sin eso, un detector roto pasaria en verde por
 * no encontrar NADA — que es como fallan las guardias estaticas.
 */

const RAIZ = path.resolve(__dirname, "../../..");
const MI_WALLET = "app/(app)/mi-wallet";

const MIGRACIONES = readdirSync(path.join(RAIZ, "db", "migrations"), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

const SCHEMA = readFileSync(path.join(RAIZ, "db", "schema.prisma"), "utf8");

function listarArchivos(dirRelativo: string, acc: string[] = []): string[] {
  const dir = path.join(RAIZ, dirRelativo);
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const relativo = `${dirRelativo}/${entrada.name}`;
    if (entrada.isDirectory()) listarArchivos(relativo, acc);
    else if (/\.tsx?$/.test(entrada.name)) acc.push(relativo);
  }
  return acc;
}

const ARCHIVOS_MI_WALLET = listarArchivos(MI_WALLET);

function codigo(rutaRelativa: string): string {
  return quitarComentarios(readFileSync(path.join(RAIZ, rutaRelativa), "utf8"));
}

// ───────────────────────────── R11 · sin migracion ─────────────────────────────

describe("335 / R11 — la ficha no anade ninguna migracion ni objeto de esquema", () => {
  it("CONTROL DE NO-VACUIDAD: el censo de migraciones no esta vacio", () => {
    // Sin esto, un `readdirSync` que devolviera [] por una ruta mal resuelta dejaria la guardia
    // verde en falso: el filtro de abajo tambien daria [].
    expect(MIGRACIONES.length).toBeGreaterThan(100);
  });

  it("ninguna carpeta de `db/migrations/` corresponde a esta ficha", () => {
    const sospechosas = MIGRACIONES.filter((dir) =>
      /mi_wallet|mi-wallet|cierres_filtro|cierre_filtro|selector_cierre/i.test(dir),
    );
    expect(sospechosas, "la ficha 335 anadio una migracion").toEqual([]);
  });

  it("CONTRAPRUEBA: el filtro SI cazaria una migracion de esta ficha", () => {
    // Un `[]` producido por un regex roto pasaria el caso de arriba sin decir nada.
    const inventadas = [
      "20260831120000_mi_wallet_cierres",
      "20260831130000_wallet_tienda_cierres_filtro",
      "20260831140000_selector_cierre_indice",
    ];
    const cazadas = inventadas.filter((dir) =>
      /mi_wallet|mi-wallet|cierres_filtro|cierre_filtro|selector_cierre/i.test(dir),
    );
    expect(cazadas).toEqual(inventadas);
  });

  it("`db/schema.prisma` conserva EXACTAMENTE los objetos que la lectura nueva usa", () => {
    // «Sin migracion» solo es cierto si lo que la ficha consulta ya estaba. Si alguno de estos
    // desapareciera, la lectura del selector se quedaria sin plan y sin columnas.
    expect(SCHEMA).toContain('@@map("wallet_tienda_movimiento")');
    // `origen_id` sigue siendo NULLABLE, que es por lo que la consulta lleva `not: null`: si
    // dejara de serlo, ese predicado seria ruido y el comentario que lo explica, mentira.
    expect(SCHEMA).toMatch(/origenId\s+String\?\s+@map\("origen_id"\)/);
    // El indice cuya PRIMERA columna es el predicado de la consulta nueva. Por el existe este
    // `groupBy` y por eso la ficha no anade ninguno.
    expect(SCHEMA).toContain("@@index([tiendaId, fechaMovimiento])");
  });

  it("el esquema NO gana ningun objeto propio de esta ficha", () => {
    const minuscula = SCHEMA.toLowerCase();
    for (const concepto of [
      "cierretiendaopcion",
      "cierre_tienda_opcion",
      "wallet_tienda_cierre",
      "wallettiendacierre",
      // El indice que el design descarta a proposito (§1): mantenerlo costaria una escritura
      // mas en cada alimentacion del feed a cambio de nada medible.
      "@@index([tiendaid, origentipo, origenid])",
    ]) {
      expect(minuscula, `el esquema nombra ${concepto}`).not.toContain(concepto);
    }
  });
});

// ─────────────────── R17 · la pantalla no gana ningun control que escriba ───────────────────

/** Prefijos de LECTURA. Todo lo que `/mi-wallet` importe de `lib/actions/` tiene que empezar asi. */
const PREFIJOS_DE_LECTURA = /^(listar|ver|obtener|consultar|buscar)/;

/** Los simbolos que un archivo importa de `@/lib/actions/...`, ya sin comentarios. */
function actionsImportadas(rutaRelativa: string): string[] {
  const fuente = codigo(rutaRelativa);
  const simbolos: string[] = [];
  for (const m of fuente.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']@\/lib\/actions\/[^"']+["']/g)) {
    for (const bruto of m[1].split(",")) {
      const nombre = bruto.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
      if (nombre.length > 0) simbolos.push(nombre);
    }
  }
  return simbolos;
}

describe("335 / R17 — `/mi-wallet` es de SOLO LECTURA: ninguna action que escriba", () => {
  it("CONTROL DE NO-VACUIDAD: la carpeta existe y SI importa actions", () => {
    // Un detector que no encontrara ningun import pasaria el caso de abajo sin mirar nada.
    expect(ARCHIVOS_MI_WALLET.length).toBeGreaterThan(4);
    const todas = ARCHIVOS_MI_WALLET.flatMap(actionsImportadas);
    expect(todas.length).toBeGreaterThan(0);
    expect(todas).toContain("verMiSaldoAction");
  });

  it("ningun archivo de `app/(app)/mi-wallet/**` importa una action de mutacion", () => {
    const escritoras: string[] = [];
    for (const ruta of ARCHIVOS_MI_WALLET) {
      for (const simbolo of actionsImportadas(ruta)) {
        if (!PREFIJOS_DE_LECTURA.test(simbolo)) escritoras.push(`${ruta}: ${simbolo}`);
      }
    }
    // El rediseno de esta ficha NO puede ser la puerta por la que entre un boton que escriba:
    // `/wallet` tiene su barra de acciones, `/mi-wallet` no la tiene y no la gana.
    expect(escritoras, "action de mutacion en /mi-wallet").toEqual([]);
  });

  it("CONTRAPRUEBA: el criterio SI caza una action que escribe, y no caza las de lectura", () => {
    const escritoras = ["registrarPagoTiendaAction", "anularPagoAction", "crearAjusteAction"];
    const lectoras = ["listarMisCierresAction", "verMiSaldoAction", "obtenerSaldoAction"];
    expect(escritoras.filter((s) => !PREFIJOS_DE_LECTURA.test(s))).toEqual(escritoras);
    expect(lectoras.filter((s) => !PREFIJOS_DE_LECTURA.test(s))).toEqual([]);
  });
});

// ─────────────────── R16 · money-safe en lo que el censo de la 172 NO alcanza ───────────────

/**
 * Los archivos de `/mi-wallet` que `tests/unit/guards/liquidacion-money-safe.test.ts` NO censa.
 *
 * Aquel barre `MiWalletModule.tsx`, `SaldoTiendaCard.tsx`, `mi-wallet-labels.ts` y `page.tsx`.
 * Todo lo demas de esta carpeta —incluido lo que la ficha 335 vaya a crear— cae AQUI. La lista
 * se DERIVA del disco en vez de escribirse a mano: un archivo nuevo entra solo.
 */
const CENSADOS_POR_LA_172 = new Set([
  `${MI_WALLET}/_components/MiWalletModule.tsx`,
  `${MI_WALLET}/_components/SaldoTiendaCard.tsx`,
  `${MI_WALLET}/_components/mi-wallet-labels.ts`,
  `${MI_WALLET}/page.tsx`,
]);

const NO_CENSADOS = ARCHIVOS_MI_WALLET.filter((r) => !CENSADOS_POR_LA_172.has(r));

describe("335 / R16 — ningun archivo de `/mi-wallet` convierte un monto a numero", () => {
  it("CONTROL: los cuatro archivos que la 172 censa siguen existiendo, y quedan archivos fuera", () => {
    // Si la 172 dejara de censarlos —o si se renombraran— este barrido pasaria a ser el unico,
    // y hay que enterarse. Y si `NO_CENSADOS` quedara vacio, el barrido de abajo no miraria nada.
    for (const ruta of CENSADOS_POR_LA_172) {
      expect(ARCHIVOS_MI_WALLET, `${ruta} ya no esta en la carpeta`).toContain(ruta);
    }
    expect(NO_CENSADOS.length).toBeGreaterThan(0);
  });

  it("barrido `Number(`/`parseFloat(`/`parseInt(`/`.toFixed(` sobre los archivos que la 172 no alcanza", () => {
    const hallazgos: string[] = [];
    for (const ruta of NO_CENSADOS) {
      const fuente = codigo(ruta);
      for (const patron of LLAMADAS_PROHIBIDAS_EN_DINERO) {
        const encontrado = fuente.match(patron);
        if (encontrado) hallazgos.push(`${ruta}: ${encontrado[0]}`);
      }
    }
    // Son archivos de CLIENTE: pintan el STRING que baja del servidor, no calculan con el. Por
    // eso `.toFixed(` tambien esta prohibido aqui (a diferencia de `lib/**`, donde es la
    // serializacion exacta de un `Decimal`).
    expect(hallazgos, "conversion de dinero a numero en /mi-wallet").toEqual([]);
  });

  it("ningun archivo de `/mi-wallet` trae una biblioteca de decimales al navegador", () => {
    // La mitad que el barrido de llamadas no ve: sin `Number(` pero con `Prisma.Decimal` en el
    // cliente, se podria operar con montos igualmente.
    const conDecimales: string[] = [];
    for (const ruta of ARCHIVOS_MI_WALLET) {
      const fuente = codigo(ruta);
      if (/from\s+["'](@prisma\/client|decimal\.js[^"']*)["']/.test(fuente)) conDecimales.push(ruta);
      if (/\bnew\s+(Prisma\.)?Decimal\s*\(/.test(fuente)) conDecimales.push(`${ruta} (new Decimal)`);
    }
    expect(conDecimales, "aritmetica de montos en el navegador").toEqual([]);
  });

  it("CONTRAPRUEBA: el barrido caza un `Number(monto)` colado y NO caza su cita en un comentario", () => {
    const cazadas = (fuente: string) =>
      LLAMADAS_PROHIBIDAS_EN_DINERO.filter((p) => p.test(quitarComentarios(fuente))).length;

    const colado = "const total = Number(monto) + 1;\nconst otro = parseFloat(saldo);\n";
    const citado = "// money-safe: aqui no se usa Number( ni parseFloat(\nconst m = mov.monto;\n";
    expect(cazadas(colado)).toBe(2);
    expect(cazadas(citado)).toBe(0);

    // Y la misma contraprueba sobre un archivo REAL de la carpeta: se le inyecta la llamada en
    // memoria y el barrido la encuentra donde antes no habia nada.
    const real = codigo(NO_CENSADOS[0]);
    expect(cazadas(real), `${NO_CENSADOS[0]} ya trae una llamada prohibida`).toBe(0);
    expect(cazadas(`${real}\nconst x = Number(mov.monto);`)).toBe(1);
  });
});

// ───────────── El censo del arbol, para que esta guardia no envejezca en silencio ─────────────

describe("335 — el censo de `/mi-wallet` se lee del disco, no de una lista escrita a mano", () => {
  it("todo archivo censado existe y ninguno esta vacio", () => {
    // Una guardia que lee archivos vacios (o inexistentes) no falla: afirma de menos, en verde.
    expect(ARCHIVOS_MI_WALLET.length).toBeGreaterThan(0);
    for (const ruta of ARCHIVOS_MI_WALLET) {
      const completo = path.join(RAIZ, ruta);
      expect(statSync(completo).size, `${ruta} esta vacio`).toBeGreaterThan(0);
      expect(codigo(ruta).trim().length, `${ruta} no tiene codigo`).toBeGreaterThan(0);
    }
  });
});
