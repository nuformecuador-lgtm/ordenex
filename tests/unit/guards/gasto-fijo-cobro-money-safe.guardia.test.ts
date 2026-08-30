import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { quitarComentarios } from "../../fixtures/sin-comentarios";

/**
 * FICHA 333 (F4, R43) — GUARDIA MONEY-SAFE del cobro de gasto fijo.
 *
 * ## Que se prohibe, y por que el barrido general no basta
 *
 * El monto de un cobro es STRING de punta a punta: `Decimal(12,2)` en la base, `toFixed(2)` del
 * propio `Prisma.Decimal` en el mapper, STRING en el DTO, STRING al pintar. **En ningun punto del
 * camino se convierte a `number`** (R43): un `number` intermedio es una perdida de precision
 * silenciosa sobre dinero que nadie vuelve a mirar, y la feature 204 ya midio en este repo lo que
 * cuesta —14 de 66 ordenes con un centimo de desviacion, sin un solo error—.
 *
 * El barrido general (`LLAMADAS_PROHIBIDAS_EN_DINERO`) persigue cuatro llamadas: `Number(`,
 * `parseFloat(`, `parseInt(` y `.toFixed(`. **La cuarta no vale tal cual aqui**, y decirlo importa:
 * `Decimal.toFixed(2)` es el metodo del PROPIO `Decimal` y es EXACTAMENTE la conversion correcta —
 * no pasa por `number`—. Prohibirlo obligaria a inventar otra forma de serializar, peor. Lo que se
 * prohibe es `toFixed` sobre algo que ya sea `number`, y eso se distingue por el receptor.
 *
 * Por eso esta guardia hace TRES cosas y no una:
 *   1. barrido de conversiones (`Number(`, `parseFloat(`, `parseInt(`, `+monto`, `-monto`…);
 *   2. `toFixed` SOLO admitido sobre un `Decimal` —el mapper del repositorio—, y prohibido en los
 *      archivos que ni siquiera tocan `Prisma.Decimal`;
 *   3. ninguna ARITMETICA sobre montos fuera de `Prisma.Decimal`, que es la que la 204 midio que
 *      el barrido de conversiones NO ve (`a * b` no lleva `Number(`).
 *
 * ## Como afirma
 *
 * Sobre el fuente **sin comentarios**: los docstrings de este arbol nombran a proposito lo que
 * esta prohibido («money-safe: sin `parseFloat`/`Number`»), asi que un barrido sobre el texto
 * crudo denunciaria la EXPLICACION y obligaria a borrarla para pasar.
 *
 * La lectura es ESTATICA. La selecciona `pnpm exec vitest run guard` por el nombre del archivo.
 */

const RAIZ = path.resolve(__dirname, "../../..");

/**
 * Los archivos que la ficha 333 crea o modifica y por los que pasa un monto. Censo EXPLICITO: si
 * uno se mueve o se renombra, el primer bloque cae en vez de salirse del alcance en silencio.
 *
 * La pantalla (`CobrosGastoFijoPendientesPanel.tsx`) NO esta: nace en la tanda G y su barrido
 * viaja con ella. Añadirla aqui ahora dejaria la guardia roja o —peor— la obligaria a tolerar la
 * ausencia, que es como una lista deja de comprobar nada.
 *
 * `lib/interfaces/services/IGastoFijoCobroService.ts` TAMPOCO esta, y no es un olvido: por ese
 * contrato no pasa ningun monto —sus metodos mueven ids, actores, relojes y tipos de resultado, y
 * el dinero vive dentro del DTO, que si esta censado—. Lo delato la autocomprobacion de abajo
 * («todos hablan de dinero»), que existe exactamente para que el censo no se llene de archivos
 * que no cubren nada.
 */
const MANIPULAN_EL_MONTO: readonly string[] = [
  "lib/types/gasto-fijo-cobro.ts",
  "lib/interfaces/repositories/IGastoFijoCobroRepository.ts",
  "lib/repositories/GastoFijoCobroRepository.ts",
  "lib/services/GastoFijoCobroService.ts",
  "lib/services/GeneracionGastosFijosService.ts",
];

/**
 * El que SOLO TRANSPORTA: la Server Action no nombra ni una vez el monto —resuelve sesion, parsea
 * y devuelve lo que el servicio le da— y ahi esta justamente el punto. Sigue en el barrido porque
 * ES un punto del camino (R43): el dia que alguien «formatee el importe antes de devolverlo», es
 * aqui donde lo escribiria.
 */
const SOLO_TRANSPORTAN: readonly string[] = ["lib/actions/gasto-fijo-cobro.ts"];

const ARCHIVOS_CON_DINERO: readonly string[] = [...MANIPULAN_EL_MONTO, ...SOLO_TRANSPORTAN];

/**
 * El UNICO archivo de la lista donde `toFixed` es legitimo: el mapper del repositorio, que lo
 * llama sobre un `Prisma.Decimal` para serializar a STRING escala 2.
 */
const MAPPER_CON_DECIMAL = "lib/repositories/GastoFijoCobroRepository.ts";

/** Las formas de perder un centimo convirtiendo. `.toFixed(` va aparte (ver el docstring). */
const CONVERSIONES_PROHIBIDAS: readonly { readonly nombre: string; readonly patron: RegExp }[] = [
  { nombre: "Number(", patron: /\bNumber\s*\(/ },
  { nombre: "parseFloat(", patron: /\bparseFloat\s*\(/ },
  { nombre: "parseInt(", patron: /\bparseInt\s*\(/ },
  { nombre: "+monto (unario)", patron: /[^\w)\]]\+\s*(?:\w+\.)?monto\b/ },
  { nombre: "Number.parseFloat/parseInt", patron: /\bNumber\.parse(?:Float|Int)\s*\(/ },
];

/**
 * Aritmetica sobre un monto FUERA de `Prisma.Decimal`. Es la regla que la 204 demostro que el
 * barrido de conversiones no ve: `comision * (1 + iva/100)` no lleva ni un `Number(`.
 *
 * Se persigue el IDENTIFICADOR `monto` (o `.monto`) inmediatamente a un lado de un operador
 * aritmetico. `+` esta incluido a proposito aunque tambien concatene: sumar dos montos como texto
 * es igual de erroneo que sumarlos como `number`.
 */
const ARITMETICA_SOBRE_MONTO: readonly RegExp[] = [
  /(?:\w+\.)?monto\s*[-*/%]\s*[\w("'`]/,
  /[\w)"'`]\s*[-*/%]\s*(?:\w+\.)?monto\b/,
  /(?:\w+\.)?monto\s*\+\s*[\w("'`]/,
];

function reventar(que: string): never {
  throw new Error(
    `guardia gasto-fijo-cobro-money-safe: ${que}. La guardia NO pudo leer lo que vigila; se ` +
      `detiene en ROJO en vez de dar por buena una lectura vacia.`,
  );
}

function codigo(rel: string): string {
  const ruta = path.join(RAIZ, rel);
  if (!existsSync(ruta)) reventar(`falta el archivo censado \`${rel}\``);
  const fuente = readFileSync(ruta, "utf8");
  if (fuente.trim().length === 0) reventar(`\`${rel}\` se leyo en blanco`);
  return quitarComentarios(fuente);
}

describe("(0) autocomprobacion — el censo existe y el barrido no mide el vacio", () => {
  it("los seis archivos censados existen y ninguno se leyo en blanco", () => {
    for (const rel of ARCHIVOS_CON_DINERO) {
      expect(codigo(rel).length, `${rel} vacio`).toBeGreaterThan(200);
    }
  });

  it("los que MANIPULAN el monto lo nombran: si uno dejara de hacerlo, sobra del censo", () => {
    // Sin esto, el censo podria llenarse de archivos irrelevantes y el barrido seguiria verde
    // sin cubrir nada. Es la comprobacion que convierte «estan barridos» en una afirmacion.
    for (const rel of MANIPULAN_EL_MONTO) {
      expect(codigo(rel), `${rel} ya no menciona un monto`).toMatch(/\bmonto\b/i);
    }
  });

  it("y el que solo TRANSPORTA sigue sin nombrarlo: la accion no formatea importes", () => {
    // La otra mitad de la particion, y no es simetria: que la Server Action no nombre el monto ES
    // el estado correcto. Si algun dia lo nombrara, este caso lo pone encima de la mesa antes de
    // que alguien lo convierta.
    for (const rel of SOLO_TRANSPORTAN) {
      expect(codigo(rel), `${rel} empezo a manipular el monto`).not.toMatch(/\bmonto\b/i);
    }
  });

  it("los detectores marcan lo que dicen marcar", () => {
    expect(CONVERSIONES_PROHIBIDAS.some((p) => p.patron.test("const n = Number(c.monto);"))).toBe(
      true,
    );
    expect(
      CONVERSIONES_PROHIBIDAS.some((p) => p.patron.test("const n = parseFloat(c.monto);")),
    ).toBe(true);
    expect(CONVERSIONES_PROHIBIDAS.some((p) => p.patron.test("const n = +cobro.monto;"))).toBe(
      true,
    );
    // Y NO marcan lo correcto: un STRING que solo se transporta.
    expect(CONVERSIONES_PROHIBIDAS.some((p) => p.patron.test("monto: cobro.monto,"))).toBe(false);
  });

  it("el detector de ARITMETICA caza lo que el de conversiones no ve (leccion de la 204)", () => {
    const sinConversion = "const total = cobro.monto * 1.13;";
    expect(CONVERSIONES_PROHIBIDAS.some((p) => p.patron.test(sinConversion))).toBe(false);
    expect(ARITMETICA_SOBRE_MONTO.some((p) => p.test(sinConversion))).toBe(true);

    expect(ARITMETICA_SOBRE_MONTO.some((p) => p.test("const x = a.monto + b.monto;"))).toBe(true);
    // Y no es un «todo vale»: transportar, comparar por igualdad o serializar no es operar.
    expect(ARITMETICA_SOBRE_MONTO.some((p) => p.test("monto: cobro.monto,"))).toBe(false);
    expect(ARITMETICA_SOBRE_MONTO.some((p) => p.test("if (a.monto === b.monto) return;"))).toBe(
      false,
    );
    expect(ARITMETICA_SOBRE_MONTO.some((p) => p.test("monto: r.monto.toFixed(2),"))).toBe(false);
  });
});

describe("333/R43 — ningun archivo de la ficha convierte un monto a numero", () => {
  it("⭑ ni `Number(`, ni `parseFloat(`, ni `parseInt(`, ni un `+` unario sobre el monto", () => {
    const hallazgos: string[] = [];
    for (const rel of ARCHIVOS_CON_DINERO) {
      const fuente = codigo(rel);
      for (const { nombre, patron } of CONVERSIONES_PROHIBIDAS) {
        if (patron.test(fuente)) hallazgos.push(`${rel}: ${nombre}`);
      }
    }
    expect(hallazgos, "conversion de dinero a numero en el camino del cobro").toEqual([]);
  });

  it("⭑ ninguna ARITMETICA sobre un monto fuera de `Prisma.Decimal`", () => {
    const hallazgos: string[] = [];
    for (const rel of ARCHIVOS_CON_DINERO) {
      const fuente = codigo(rel);
      for (const patron of ARITMETICA_SOBRE_MONTO) {
        const m = patron.exec(fuente);
        if (m !== null) hallazgos.push(`${rel}: ${m[0].trim()}`);
      }
    }
    expect(hallazgos, "se opero con un monto fuera de Prisma.Decimal").toEqual([]);
  });

  it("⭑ `toFixed` solo aparece donde hay un `Prisma.Decimal` que lo justifique", () => {
    // La distincion que el barrido general no puede hacer: `Decimal.toFixed(2)` es la conversion
    // CORRECTA; `number.toFixed(2)` es la que redondea mal y pierde el centimo. El receptor lo
    // decide, y aqui se aproxima por «este archivo trabaja con Decimal».
    for (const rel of ARCHIVOS_CON_DINERO) {
      const fuente = codigo(rel);
      if (!/\.toFixed\s*\(/.test(fuente)) continue;
      expect(rel, `\`${rel}\` llama a toFixed sin ser el mapper del repositorio`).toBe(
        MAPPER_CON_DECIMAL,
      );
      expect(fuente, "toFixed sin un Prisma.Decimal detras").toMatch(/Prisma\.Decimal/);
    }
  });

  it("⭑ CONTROL POSITIVO: el mapper SI convierte, y lo hace con `Decimal.toFixed(2)`", () => {
    // Sin este control, el caso anterior pasaria igual si el mapper hubiera dejado de serializar
    // —y entonces un `Decimal` cruzaria al cliente, que es el otro modo de fallo—.
    const fuente = codigo(MAPPER_CON_DECIMAL);
    expect(fuente).toMatch(/monto:\s*r\.monto\.toFixed\(2\)/);
    // Y en la escritura, el STRING vuelve a `Decimal` sin pasar por `number`.
    expect(fuente).toMatch(/new Prisma\.Decimal\(c\.monto\)/);
  });
});

describe("333/R43 — el monto cruza la frontera como CADENA, y el tipo lo dice", () => {
  it("⭑ el DTO declara `monto: string` y no expone la clave de idempotencia", () => {
    const fuente = codigo("lib/types/gasto-fijo-cobro.ts");
    expect(fuente).toMatch(/GastoFijoCobroDTO\s*=\s*\{[\s\S]*?monto:\s*string;[\s\S]*?\}/);
    // R43 en su forma negativa: si alguien cambiara el tipo a `number`, esto cae.
    expect(fuente).not.toMatch(/GastoFijoCobroDTO\s*=\s*\{[\s\S]*?monto:\s*number/);
    // Y design §6.1: ni `origenId`, ni `plantillaId`, ni `movimientoId` cruzan al cliente.
    const dto = /export type GastoFijoCobroDTO = \{([\s\S]*?)\n\};/.exec(fuente);
    expect(dto, "no se pudo recortar el DTO").not.toBeNull();
    for (const prohibido of ["origenId", "plantillaId", "movimientoId"]) {
      expect(dto![1], `el DTO expone \`${prohibido}\``).not.toContain(prohibido);
    }
  });

  it("⭑ ninguna de las cuatro Server Actions acepta un monto del cliente (R16 en el borde)", () => {
    const schemas = codigo("lib/types/gasto-fijo-cobro.ts");
    // Los tres schemas de entrada son `.strict()` y ninguno declara `monto`.
    for (const nombre of [
      "listarCobrosPendientesSchema",
      "decidirCobroGastoFijoSchema",
      "contarCobrosPendientesDePlantillaSchema",
    ]) {
      const bloque = new RegExp(`${nombre}[\\s\\S]{0,220}?\\.strict\\(\\)`).exec(schemas);
      expect(bloque, `\`${nombre}\` dejo de ser \`.strict()\``).not.toBeNull();
      expect(bloque![0], `\`${nombre}\` acepta un monto del cliente`).not.toMatch(/\bmonto\b/);
    }
  });

  it("⭑ el servicio escribe el monto que LEE del cobro, sin tocarlo", () => {
    const fuente = codigo("lib/services/GastoFijoCobroService.ts");
    // El literal que importa: el monto de la fila del libro es `cobro.monto` y nada mas.
    expect(fuente).toMatch(/monto:\s*cobro\.monto\s*,/);
    // Y el servicio NO conoce la plantilla: no tiene por donde leer el monto vigente (R16/A8).
    expect(fuente).not.toMatch(/plantillaRepo|IGastoFijoPlantillaRepository/);
  });
});
