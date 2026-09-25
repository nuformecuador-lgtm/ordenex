import { describe, it, expect } from "vitest";

import { codigoSinComentarios, quitarComentarios } from "../../fixtures/sin-comentarios";

// GUARDIA DEL ARNES — FICHA 462 (T1.6, R8/R20) — EL CONTEO ES DE SOLO LECTURA, Y NADIE MAS EMITE.
//
// Dos modos de fallo MUDOS que ningun test de comportamiento ve:
//
//   1. Que el conteo ESCRIBA. El repositorio y el servicio de las reprogramadas retenidas leen
//      ordenes, gestiones, cierres y dinero de terceros; si alguien les añadiera un `update` «para
//      apagar la marca» o un `create` «para dejar rastro», la suite seguiria verde y el conteo
//      dejaria de ser lo que R8 promete: una lectura sin efectos. Se mide el ARCHIVO ENTERO —no un
//      metodo— a proposito (memoria «la guardia mide por metodo, no por escritura»): aqui lo que se
//      quiere es que no exista NINGUNA escritura, y eso se afirma sobre todo el fuente.
//   2. Que el aviso salga desde un cuarto sitio. R20 dice que NI el reloj de medianoche, NI el
//      timbre de la aprobacion (315), NI la correccion de fecha (371) emiten este aviso: sale UNA
//      vez al dia, a las 07:00 CR, desde `avisos-diarios`. Un `notificarReprogramadasEsperanCierre`
//      colado en cualquiera de los tres reproduciria el push a medianoche que el design descarto.
//
// La lectura es ESTATICA, sobre el fuente SIN COMENTARIOS (los comentarios de este repo nombran a
// proposito lo que el codigo tiene prohibido). La selecciona `pnpm exec vitest run guard`.

const SOLO_LECTURA = [
  "lib/repositories/ReprogramadaRetenidaRepository.ts",
  "lib/services/ReprogramadasRetenidasService.ts",
  "lib/interfaces/repositories/IReprogramadaRetenidaRepository.ts",
  "lib/interfaces/services/IReprogramadasRetenidasService.ts",
] as const;

const NO_EMITEN = [
  "lib/services/LiberacionReprogramadaService.ts",
  "lib/services/liberacion-al-aprobar-cierre.ts",
  "lib/services/liberacion-tras-corregir-fecha.ts",
  "lib/repositories/LiberacionReprogramadaRepository.ts",
] as const;

/** Los verbos de escritura: los de la API de Prisma y los de SQL crudo. */
const VERBOS_DE_ESCRITURA = [
  ".update(",
  ".updateMany(",
  ".create(",
  ".createMany(",
  ".delete(",
  ".deleteMany(",
  ".upsert(",
  "$executeRaw",
  "$transaction(",
  "INSERT ",
  "UPDATE ",
  "DELETE ",
  "TRUNCATE",
] as const;

/** Las dos formas de nombrar el aviso: el evento del catalogo y el notificador. */
const NOMBRES_DEL_AVISO = ["reprogramadas_esperan_cierre", "ReprogramadasEsperanCierre"] as const;

function escriturasEn(codigo: string): string[] {
  return VERBOS_DE_ESCRITURA.filter((verbo) => codigo.includes(verbo));
}

describe("462 · autocomprobacion del detector", () => {
  it("una cadena con `.update(` o un `UPDATE ` crudo se DETECTA (si no, lo de abajo seria verde por vacio)", () => {
    expect(escriturasEn(`await this.prisma.orden.update({ where: { id } })`)).toEqual([".update("]);
    expect(escriturasEn(`Prisma.sql\`UPDATE "orden" SET x = 1\``)).toEqual(["UPDATE "]);
    expect(escriturasEn(`tx.$executeRaw\`...\``)).toEqual(["$executeRaw"]);
    expect(escriturasEn(`const x = await this.prisma.$queryRaw\`SELECT 1\``)).toEqual([]);
  });

  it("los comentarios NO cuentan: el detector lee el codigo sin ellos", () => {
    const fuente = ["// ni un `.update(` aqui", "const a = 1; /* UPDATE nada */"].join("\n");
    expect(escriturasEn(quitarComentarios(fuente))).toEqual([]);
  });

  it("los archivos vigilados existen y no se leen vacios", () => {
    for (const rel of [...SOLO_LECTURA, ...NO_EMITEN]) {
      expect(codigoSinComentarios(rel).trim().length, `${rel} se leyo vacio`).toBeGreaterThan(100);
    }
  });
});

describe("462/R8 — el repositorio y el servicio de las retenidas NO ESCRIBEN NADA", () => {
  it.each(SOLO_LECTURA)("%s no contiene ningun verbo de escritura (mutacion 11: un `update` => ROJO)", (rel) => {
    const codigo = codigoSinComentarios(rel);
    expect(
      escriturasEn(codigo),
      `${rel} escribe: el conteo de retenidas es de SOLO LECTURA (R8). Ni estado, ni mensajero, ` +
        "ni fecha, ni cierre, ni historial, ni dinero, ni jobs.",
    ).toEqual([]);
  });

  it("y el repositorio solo pide de Prisma lo que se puede LEER", () => {
    // La forma de acotar el cliente: un `Pick` que no incluye `$executeRaw` ni `$transaction`. Si
    // alguien lo ampliara, la escritura pasaria a ser POSIBLE aunque hoy no ocurra.
    const codigo = codigoSinComentarios("lib/repositories/ReprogramadaRetenidaRepository.ts");
    expect(codigo).toMatch(/Pick<PrismaClient,\s*"\$queryRaw"\s*\|\s*"cierreDia"\s*\|\s*"usuario">/);
  });
});

describe("462/R20 — el aviso NO sale del reloj, ni del timbre 315, ni de la correccion 371", () => {
  it.each(NO_EMITEN)("%s no nombra el evento ni el notificador", (rel) => {
    const codigo = codigoSinComentarios(rel);
    for (const nombre of NOMBRES_DEL_AVISO) {
      expect(
        codigo,
        `${rel} nombra «${nombre}»: el aviso se emite SOLO desde el cron avisos-diarios a las 07:00 CR (R20/R24)`,
      ).not.toContain(nombre);
    }
  });

  it("control positivo: el emisor SI lo nombra (el barrido de arriba distingue)", () => {
    expect(codigoSinComentarios("lib/notificaciones/emitir.ts")).toContain("reprogramadas_esperan_cierre");
    expect(codigoSinComentarios("lib/services/AvisosDiariosService.ts")).toContain(
      "reprogramadas_esperan_cierre",
    );
  });
});
