import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { z } from "zod";

import {
  previsualizarRepartoSchema,
  registrarRepartoMensajeroSchema,
} from "@/lib/types/liquidacion-reparto";
import { LIQUIDACION_MONTO_MAX, LIQUIDACION_REFERENCIA_MAX } from "@/lib/types/liquidacion";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";
import { LLAMADAS_PROHIBIDAS_EN_DINERO, quitarComentarios } from "../../fixtures/money-safe";

// Feature 205 / T4.1 — los dos schemas del BORDE y la forma de los DTO. Cubre R9 (la peticion no
// elige cierre), R46 (todo importe es texto de 2 decimales), R47 (clave desconocida fuera) y R48
// (el `cierreId` cruza; ningun identificador de PERSONA lo hace).
//
// La mitad estructural de este archivo lee `lib/types/liquidacion-reparto.ts` y afirma lo que un
// caso de ejecucion no puede: que las reglas del monto, de la referencia y de la fecha no se
// REESCRIBIERON aqui, sino que son literalmente las del pago de la 172. Dos copias de la misma
// regla es lo que hace que un dia una acepte lo que la otra rechaza.

const RAIZ = path.resolve(__dirname, "../../..");
const FUENTE = readFileSync(path.join(RAIZ, "lib/types/liquidacion-reparto.ts"), "utf8");

/**
 * El CODIGO, sin comentarios — y no es un detalle: la cabecera de ese modulo CITA a proposito lo
 * que no hace («cero `Number(`, cero `parseFloat`»), asi que un barrido sobre el texto crudo
 * fallaria por leer la cita como la llamada. Es la cicatriz que documenta `fixtures/money-safe`.
 * El corte por el marcador de seccion se hace sobre el texto BRUTO, que es donde vive el
 * marcador, y se limpia despues.
 */
const MARCADOR_SALIDA = "// ── DTOs de salida";
const CODIGO = quitarComentarios(FUENTE);
const CODIGO_ENTRADA = quitarComentarios(FUENTE.slice(0, FUENTE.indexOf(MARCADOR_SALIDA)));
const CODIGO_SALIDA = quitarComentarios(FUENTE.slice(FUENTE.indexOf(MARCADOR_SALIDA)));

const HOY_CR = fechaCalendarioCR(new Date());
const CLAVE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MENSAJERO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CIERRE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function registro(over: Record<string, unknown> = {}) {
  return {
    claveIdempotencia: CLAVE,
    mensajeroId: MENSAJERO,
    monto: "15000.00",
    metodo: "SINPE",
    referencia: "1234567",
    fechaPago: HOY_CR,
    ...over,
  };
}

/** Las claves que zod declara desconocidas, que es donde vive el nombre de la clave colada. */
function clavesDesconocidas(error: z.ZodError): string[] {
  return error.issues.flatMap((issue) =>
    issue.code === "unrecognized_keys" ? issue.keys : [],
  );
}

describe("R9 — la peticion NO puede elegir contra que cierre se imputa", () => {
  it("`cierreId` no existe en el schema del REGISTRO, y `.strict()` lo nombra al rechazarlo", () => {
    const r = registrarRepartoMensajeroSchema.safeParse(registro({ cierreId: CIERRE }));

    expect(r.success).toBe(false);
    if (r.success) return;
    // Aqui SI se puede nombrar la clave: `unrecognized_keys` la lleva. En el borde no llega
    // porque `flattenError().fieldErrors` solo trae los issues con `path`, y este no tiene.
    expect(clavesDesconocidas(r.error)).toContain("cierreId");
  });

  it("`cierreId` tampoco existe en el schema de la PREVISUALIZACION", () => {
    const r = previsualizarRepartoSchema.safeParse({ mensajeroId: MENSAJERO, cierreId: CIERRE });

    expect(r.success).toBe(false);
    if (r.success) return;
    expect(clavesDesconocidas(r.error)).toContain("cierreId");
  });

  it("ESTRUCTURAL: el modulo no declara `cierreId` en ningun schema de ENTRADA", () => {
    // El `cierreId` SI aparece en los DTO de salida (es el enlace al detalle, R44). Lo que no
    // puede es estar del lado de la entrada: se mide sobre el bloque de schemas, no sobre el
    // archivo entero, porque el archivo entero lo nombra a proposito.
    expect(CODIGO_ENTRADA.length).toBeGreaterThan(300);
    expect(CODIGO_ENTRADA).not.toMatch(/cierreId/);
  });
});

describe("R47 — `.strict()`: la forma se valida entera, no por lista de nombres", () => {
  it("cualquier clave desconocida cae, no solo `cierreId`", () => {
    for (const extra of ["tiendaId", "repartoId", "comprobante", "montoTotal", "tope"]) {
      const r = registrarRepartoMensajeroSchema.safeParse(registro({ [extra]: "x" }));
      expect(r.success, extra).toBe(false);
      if (r.success) continue;
      expect(clavesDesconocidas(r.error), extra).toContain(extra);
    }
  });

  it("una peticion valida SI pasa (si no, lo de arriba no diria nada)", () => {
    expect(registrarRepartoMensajeroSchema.safeParse(registro()).success).toBe(true);
    expect(previsualizarRepartoSchema.safeParse({ mensajeroId: MENSAJERO }).success).toBe(true);
    expect(
      previsualizarRepartoSchema.safeParse({ mensajeroId: MENSAJERO, monto: "1.00" }).success,
    ).toBe(true);
  });

  it("el mensajero es obligatorio y tiene que ser un uuid", () => {
    for (const mensajeroId of [undefined, "", "m1", 42]) {
      expect(registrarRepartoMensajeroSchema.safeParse(registro({ mensajeroId })).success).toBe(
        false,
      );
      expect(previsualizarRepartoSchema.safeParse({ mensajeroId }).success).toBe(false);
    }
  });
});

describe("R46 — el dinero entra como TEXTO, con las MISMAS reglas que el pago de la 172", () => {
  it("un `monto` numerico no se coerciona: se rechaza", () => {
    expect(registrarRepartoMensajeroSchema.safeParse(registro({ monto: 15000 })).success).toBe(
      false,
    );
    expect(
      previsualizarRepartoSchema.safeParse({ mensajeroId: MENSAJERO, monto: 15000 }).success,
    ).toBe(false);
  });

  it("cero, negativo, con tres decimales o no numerico: fuera", () => {
    for (const monto of ["0", "0.00", "-1.00", "1.005", "abc", "1e3", ""]) {
      expect(registrarRepartoMensajeroSchema.safeParse(registro({ monto })).success, monto).toBe(
        false,
      );
    }
  });

  it("el tope del monto es EL MISMO que el del pago, derivado de la columna", () => {
    // `LIQUIDACION_MONTO_MAX` sale de `DECIMAL(12,2)`. Que el reparto lo herede sin escribirlo es
    // lo que impide que un dia acepte un importe que la columna no puede guardar.
    expect(registrarRepartoMensajeroSchema.safeParse(registro({ monto: LIQUIDACION_MONTO_MAX })).success).toBe(
      true,
    );
    const unCentimoMas = "10000000000.00";
    expect(registrarRepartoMensajeroSchema.safeParse(registro({ monto: unCentimoMas })).success).toBe(
      false,
    );
  });

  it("la referencia hereda su tope y su `.trim()`", () => {
    const justo = "1".repeat(LIQUIDACION_REFERENCIA_MAX);
    expect(registrarRepartoMensajeroSchema.safeParse(registro({ referencia: justo })).success).toBe(
      true,
    );
    expect(
      registrarRepartoMensajeroSchema.safeParse(registro({ referencia: `${justo}1` })).success,
    ).toBe(false);
    const conEspacios = registrarRepartoMensajeroSchema.safeParse(
      registro({ referencia: "  1234567  " }),
    );
    expect(conEspacios.success).toBe(true);
    if (!conEspacios.success) return;
    expect(conEspacios.data.referencia).toBe("1234567");
  });

  it("R58: la referencia es obligatoria en pago electronico y opcional en efectivo", () => {
    for (const metodo of ["SINPE", "transferencia"]) {
      const r = registrarRepartoMensajeroSchema.safeParse(
        registro({ metodo, referencia: undefined }),
      );
      expect(r.success, metodo).toBe(false);
      if (r.success) continue;
      expect(r.error.issues.map((i) => i.path.join(".")), metodo).toContain("referencia");
    }
    expect(
      registrarRepartoMensajeroSchema.safeParse(registro({ metodo: "efectivo", referencia: undefined }))
        .success,
    ).toBe(true);
  });

  it("la fecha no puede ser futura, con la misma regla horaria de Costa Rica", () => {
    const manana = fechaCalendarioCR(new Date(Date.now() + 24 * 60 * 60 * 1000));
    expect(registrarRepartoMensajeroSchema.safeParse(registro({ fechaPago: manana })).success).toBe(
      false,
    );
    expect(registrarRepartoMensajeroSchema.safeParse(registro({ fechaPago: "2026-02-31" })).success).toBe(
      false,
    );
  });

  it("ESTRUCTURAL: las reglas se REUSAN, no se reescriben", () => {
    // Si alguien copiara aqui el regex del monto, la fecha o el tope, este caso lo dice: en este
    // modulo no hay ni un `regex`, ni un `.max(`, ni un numero de tope.
    expect(CODIGO).toContain("camposComunesDelPago");
    expect(CODIGO).toContain("exigirReferenciaEnPagoElectronico");
    expect(CODIGO).toContain("montoLiquidacionSchema");
    expect(CODIGO).not.toMatch(/\.regex\(/);
    expect(CODIGO).not.toMatch(/\.max\(\s*\d/);
    expect(CODIGO).not.toMatch(/LIQUIDACION_(MONTO|NOTA|REFERENCIA)_MAX/);
  });
});

describe("R48 — que identificadores cruzan la frontera, y cuales no", () => {
  it("los DTO de salida emiten `cierreId` y NINGUN identificador de persona", () => {
    // Se lee el bloque de DTO del modulo: los ids que se declaran son exactamente los del CIERRE.
    const identificadores = [...CODIGO_SALIDA.matchAll(/^\s{2}(\w*[Ii]d)\??:/gm)].map((m) => m[1]);
    expect([...new Set(identificadores)]).toEqual(["cierreId"]);

    // Y ni una palabra de los ids de personas o de actos internos.
    for (const prohibido of ["mensajeroId", "registradoPor", "usuarioId", "repartoId", "tiendaId"]) {
      expect(CODIGO_SALIDA, `el DTO emite ${prohibido}`).not.toMatch(
        new RegExp(`^\\s{2}${prohibido}\\??:`, "m"),
      );
    }
    // El mensajero cruza por su NOMBRE.
    expect(CODIGO_SALIDA).toMatch(/^\s{2}mensajeroNombre: string;/m);
  });

  it("todos los campos de dinero de los DTO son `string`; los cardinales del recorte son `number`", () => {
    const campos = [...CODIGO_SALIDA.matchAll(/^\s{2,4}(\w+)\??:\s*(string|number|boolean)/gm)].map(
      (m) => [m[1], m[2]] as const,
    );

    const dinero = [
      "imputable",
      "imputableTotal",
      "cuentaPorPagar",
      "montoFuera",
      "monto",
      "pendienteActual",
      "pendienteDespues",
      "sobrante",
      "totalImputado",
      "restanteImputable",
    ];
    for (const [nombre, tipo] of campos) {
      if (dinero.includes(nombre)) expect(tipo, `${nombre} no es string`).toBe("string");
    }
    // Los que SI son numeros cuentan CIERRES, no dinero. `cantidad` es el conteo por estado de
    // R36 (enmienda): un conteo no es un monto, y por eso es el unico numero que este modulo
    // gana sin romper la regla de que todo importe viaja como STRING.
    for (const cardinal of ["tope", "enVentana", "fuera", "cantidad"]) {
      expect(campos.find(([n]) => n === cardinal)?.[1], cardinal).toBe("number");
    }
  });

  it("R36 — ESTRUCTURAL: el aviso de excluidos es un CONTEO por estado, no una lista de cierres", () => {
    // La decision que este test congela: R36 informa de que hay dinero que no se paga aqui y de
    // por que, no inventaria los cierres (el inventario esta en `/cierres-admin`). Con una fila
    // por cierre la respuesta no tenia tope; contada por estado su tamaño depende del numero de
    // valores de `CierreEstado`. Devolver otra vez la lista —para «poder nombrar» un cierre en
    // el aviso, que es justo lo que se perdio a proposito— pone este test en rojo.
    const inicio = CODIGO_SALIDA.indexOf("export type ExcluidosPorEstadoDTO = {");
    expect(inicio, "no se encontro ExcluidosPorEstadoDTO").toBeGreaterThanOrEqual(0);
    const cuerpo = CODIGO_SALIDA.slice(inicio, CODIGO_SALIDA.indexOf("\n};", inicio));

    expect([...cuerpo.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1])).toEqual([
      "estado",
      "cantidad",
    ]);
    // Ni el id del cierre ni su fecha: con cualquiera de los dos, el aviso vuelve a ser una lista
    // encubierta y a crecer con el historial del mensajero.
    expect(cuerpo).not.toMatch(/cierreId/);
    expect(cuerpo).not.toMatch(/solicitadoAt/);

    // Y el campo de la previsualizacion apunta a ESTE tipo, no a uno por cierre.
    expect(CODIGO_SALIDA).toMatch(/^\s{2}excluidos: ExcluidosPorEstadoDTO\[\];/m);
  });

  it("R16: el modulo de contratos no convierte ningun monto a numero", () => {
    // La guardia transversal (`liquidacion-money-safe`) ya barre este archivo por auto-captura;
    // esto es la afirmacion local, para que se lea junto a los DTO que protege. Sobre el CODIGO,
    // no sobre el texto: la cabecera del modulo cita las tres llamadas para decir que no las usa.
    for (const prohibida of LLAMADAS_PROHIBIDAS_EN_DINERO) {
      if (prohibida.source.includes("toFixed")) continue; // en `lib/**` es la serializacion
      expect(CODIGO, prohibida.source).not.toMatch(prohibida);
    }

    // CONTRAPRUEBA: el barrido caza una llamada colada en este mismo archivo. Sin esto, el caso
    // de arriba podria estar pasando por no mirar nada.
    const colado = quitarComentarios(`${FUENTE}\nconst x = Number(dto.monto);`);
    expect(LLAMADAS_PROHIBIDAS_EN_DINERO.filter((p) => p.test(colado))).toHaveLength(1);
  });
});
