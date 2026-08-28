import { describe, expect, it, vi } from "vitest";

import {
  MSG_TOPE_INTENTOS_ASIGNACION,
  MSG_TOPE_INTENTOS_GESTION,
} from "@/lib/services/mensajes-bloqueo";
import { MOTIVO_RECHAZO_TOPE_INTENTOS } from "@/lib/repositories/CierresAdminRepository";
import { LiberacionReprogramadaService } from "@/lib/services/LiberacionReprogramadaService";
import { reintentosConfig } from "@/lib/config/reintentos";
import type { ILiberacionReprogramadaRepository } from "@/lib/interfaces/repositories/ILiberacionReprogramadaRepository";
import type { IOrdenRepository } from "@/lib/interfaces/repositories/IOrdenRepository";
import type { IZonaRepository } from "@/lib/interfaces/repositories/IZonaRepository";

/**
 * GUARDIA DE LA FEATURE 276 (T15, R38) — NADA DE LO QUE ESTA FICHA PRODUCE LLEVA PII.
 *
 * Los CUATRO textos nuevos, uno por uno:
 *   1. el motivo del rechazo de una gestion en el tope (las dos superficies que crean gestion);
 *   2. el motivo del rechazo de la salida a reparto (las dos bodegas + la tienda de la Q2);
 *   3. el `motivo` de la gestion SINTETICA del rechazo por no gestion (que sostiene un COBRO);
 *   4. el aviso agregado del cron de liberacion sobre la poblacion congelada.
 *
 * POR QUE IMPORTA MAS DE LO QUE PARECE: los tres primeros los lee una PERSONA en pantalla, y el
 * tercero acompana a un `cobroRechazado` (56) que alguien va a auditar. El cuarto va a un log
 * que se archiva. Un numero de guia o un nombre de destinatario metido en cualquiera de ellos se
 * queda ahi para siempre.
 *
 * MOLDE: los asertos de PII de `devolucion-sla-service.test.ts` y de
 * `ConfirmacionFisicaNoAplicableError`.
 *
 * La selecciona `pnpm exec vitest run guard` por el nombre del archivo.
 */

/** Fragmentos que NINGUN texto de esta ficha puede contener. */
const PROHIBIDO: { que: string; re: RegExp }[] = [
  // Cualquier secuencia larga de digitos: un numero de guia (8-9 cifras) o un telefono.
  { que: "un numero de guia o un telefono", re: /\d{5,}/ },
  // Un UUID: id de orden, de usuario, de cierre o de gestion.
  { que: "un identificador (uuid)", re: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i },
  // Nombres de columna de la base, que no son vocabulario de persona.
  { que: "un nombre de columna", re: /\b(orden_id|num_guia|mensajero_id|cierre_id|estatus_id|gestion_orden)\b/ },
  // Siglas y jerga interna.
  { que: "una sigla interna", re: /\bSLA\b/ },
];

/**
 * El VALOR del umbral tampoco viaja en ningun texto (R10): la decision cruza como booleano, no
 * como numero. Se comprueba contra el umbral REAL, no contra un `3` escrito aqui.
 */
const UMBRAL = String(reintentosConfig.MIN_INTENTOS_ENTREGA);

const TEXTOS_FIJOS: { nombre: string; texto: string }[] = [
  { nombre: "MSG_TOPE_INTENTOS_GESTION", texto: MSG_TOPE_INTENTOS_GESTION },
  { nombre: "MSG_TOPE_INTENTOS_ASIGNACION", texto: MSG_TOPE_INTENTOS_ASIGNACION },
  { nombre: "MOTIVO_RECHAZO_TOPE_INTENTOS", texto: MOTIVO_RECHAZO_TOPE_INTENTOS },
];

describe("276/R38 — los textos fijos de la ficha no llevan PII", () => {
  for (const { nombre, texto } of TEXTOS_FIJOS) {
    it(`${nombre} no contiene datos personales, ids ni nombres de columna`, () => {
      // Contrapunto: el texto EXISTE y dice algo. Un `""` pasaria todos los asertos de abajo.
      expect(texto.length).toBeGreaterThan(20);
      for (const { que, re } of PROHIBIDO) {
        expect(re.test(texto), `${nombre} contiene ${que}: «${texto}»`).toBe(false);
      }
      // R10: ni el valor del umbral.
      expect(texto).not.toContain(UMBRAL);
      // Y habla en palabras de persona, no de esquema.
      expect(texto).toMatch(/intentos de entrega/);
    });
  }

  it("los DOS motivos son textos DISTINTOS: dicen cosas distintas a personas distintas", () => {
    // No es cosmetico: al mensajero hay que decirle QUE SI puede registrar; a quien asigna, que
    // esa orden ya no sale a reparto. Un solo texto para las dos cosas obligaria a mentir en una.
    expect(MSG_TOPE_INTENTOS_GESTION).not.toBe(MSG_TOPE_INTENTOS_ASIGNACION);
    // El de gestion es accionable: enumera los desenlaces que quedan (R6).
    expect(MSG_TOPE_INTENTOS_GESTION).toMatch(/entregada/);
    expect(MSG_TOPE_INTENTOS_GESTION).toMatch(/rechazada/);
    expect(MSG_TOPE_INTENTOS_GESTION).toMatch(/incidente/);
  });
});

describe("276/R38 — el aviso agregado del cron de liberacion no lleva PII", () => {
  it("cuenta ordenes y no nombra ninguna", async () => {
    const avisos: string[] = [];
    const repo: ILiberacionReprogramadaRepository = {
      findOrdenesLiberables: vi.fn(async () => [
        {
          id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
          zonaId: "z-1",
          fechaReprogramacion: new Date("2026-07-14T00:00:00.000Z"),
          gestionCierreId: "9c858901-8a57-4791-81fe-4c455b099bc9",
          gestionCierreEstado: "solicitado",
          gestionEsVisitaReal: true,
        },
        {
          id: "7d444840-9dc0-11d1-b245-5ffdce74fad2",
          zonaId: "z-1",
          fechaReprogramacion: new Date("2026-07-14T00:00:00.000Z"),
          gestionCierreId: null,
          gestionCierreEstado: null,
          gestionEsVisitaReal: true,
        },
      ]),
      findOrdenesLiberablesDeCierre: vi.fn(async () => []), // ficha 315: sin uso en este caso
      liberarOrden: vi.fn(async () => true),
      findLiberadasHoy: vi.fn(async () => []),
    };
    const service = new LiberacionReprogramadaService(
      repo,
      { findCentralZonaId: vi.fn(async () => "z-1") } as unknown as IZonaRepository,
      {
        findEstatusIdByValue: vi.fn(async (v: string) => `os-${v}`),
      } as unknown as IOrdenRepository,
      { warn: (m) => avisos.push(m) },
    );

    const r = await service.ejecutarLiberacion(new Date("2026-07-15T00:00:00.000Z"));

    // Contrapunto: la corrida SI congelo dos ordenes, asi que el aviso existe y dice algo.
    expect(r.esperandoCierre).toBe(2);
    const aviso = avisos.find((a) => a.includes("esperan"));
    expect(aviso, "el cron no emitio el aviso de la poblacion congelada").toBeDefined();
    expect(aviso).toContain("2");

    for (const { que, re } of PROHIBIDO) {
      // El aviso SI lleva un numero: el CONTEO. Por eso el patron de digitos largos es el que
      // discrimina —un conteo son una o dos cifras; una guia son ocho o nueve—.
      expect(re.test(aviso as string), `el aviso contiene ${que}: «${aviso}»`).toBe(false);
    }
    // Y ningun id de los sembrados.
    expect(aviso).not.toContain("3f2504e0");
    expect(aviso).not.toContain("9c858901");
    expect(aviso).not.toContain("z-1");
  });
});
