import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";

import {
  ENV_NOMBRE,
  ENV_NUMERO,
  leerSemilla,
  sembrarSinpeInicial,
} from "@/scripts/seed-sinpe-inicial";
import { SINPE_INVALIDOS, SINPE_VALIDOS } from "@/tests/fixtures/sinpe-casos";
import { SINPE_NOMBRE_MAX_CHARS } from "@/lib/utils/sinpe-cr";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 429 / T4 (R7, R8, R9, R10) — EL TRASVASE, QUE HASTA HOY NO IMPORTABA NINGUN TEST.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// POR QUE EXISTE ESTE ARCHIVO, Y ESTA MEDIDO. `scripts/seed-sinpe-inicial.ts` es el UNICO archivo
// que decide el numero que ocho bodegas le van a enseñar a cada cliente en produccion, y sus dos
// exports no los importaba nadie. La revision (`progress/review_429.md`, bloqueante 1) lo probo
// mutandolo: quitar el `WHERE "sinpe_numero" IS NULL OR "sinpe_nombre" IS NULL` **y** hacer que
// `leerSemilla` invente un valor en vez de fallar dejaba **19.902 tests en verde**.
//
// La causa no estaba en el codigo, sino en la TRAZABILIDAD. R10 colgaba de un caso de integracion
// que REESCRIBIA a mano el `UPDATE` del seed contra un esquema clon —«aqui se reproduce esa
// sentencia», decia su propio comentario—, o sea que afirmaba el resultado de un SQL que el mismo
// escribia. Es la familia «probar el `WHERE` donde vive». Aquel caso ya llama a
// `sembrarSinpeInicial` de verdad; este archivo cubre la mitad que no necesita Postgres.
//
// ⚠️ REPARTO DE TRABAJO CON LA INTEGRACION, PARA QUE NADIE LO CONFUNDA:
//   · AQUI — `leerSemilla` entera (es una funcion PURA: recibe el entorno, no lo lee) y la FORMA
//     de la unica escritura de `sembrarSinpeInicial`, con un doble que apunta el SQL emitido.
//   · `tests/integration/db/zona-sinpe-migration.test.ts` — el COMPORTAMIENTO de esa escritura
//     contra Postgres real: ocho bodegas sembradas, y una segunda corrida que no pisa nada.
//   El doble de aqui NO sustituye a aquello: un doble acepta cualquier SQL que se le de. Lo que
//   este archivo compra es que la maquina SIN base —donde `describe.skipIf` salta la integracion
//   entera— siga viendo roja la mutacion del `WHERE`.
//
// ⚠️ NINGUN VALOR DE AQUI ES REAL. El repositorio es PUBLICO: numeros ficticios de la tabla
// compartida y «Titular de Prueba» como titular.

/** Valores FICTICIOS, los mismos que usa el resto de la suite de esta ficha. */
const NUMERO_OK = "80000000";
const NOMBRE_OK = "Titular de Prueba";

/**
 * Un entorno de mentira con solo lo que cada caso necesita.
 *
 * `NODE_ENV` va porque `NodeJS.ProcessEnv` lo declara OBLIGATORIO en este proyecto; no lo lee
 * nadie aqui. Lo demas se omite a proposito: `leerSemilla` recibe el entorno en vez de leer
 * `process.env`, y esa es la razon de que se pueda probar un «falta la variable» sin ensuciar el
 * proceso del runner.
 */
function entorno(numero?: string, nombre?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  if (numero !== undefined) env[ENV_NUMERO] = numero;
  if (nombre !== undefined) env[ENV_NOMBRE] = nombre;
  return env;
}

/** El motivo del rechazo. Si la semilla se acepto, el caso cae aqui y no mas abajo. */
function motivoDe(env: NodeJS.ProcessEnv): string {
  const semilla = leerSemilla(env);
  expect(semilla.ok, "se esperaba un rechazo y la semilla se acepto").toBe(false);
  return semilla.ok ? "" : semilla.motivo;
}

describe("429/R10 — `leerSemilla`: falta una variable, y lo dice POR SU NOMBRE", () => {
  it("⭑ sin `NEXT_PUBLIC_SINPE_NUMERO` no se siembra, y el motivo nombra esa variable", () => {
    // ⚠️ ES LA MITAD «invento un valor» DE LA MUTACION DEL REVISOR. Un seed de dinero que se salta
    // en silencio lo que no entiende siembra un numero plausible y equivocado en ocho bodegas.
    const motivo = motivoDe(entorno(undefined, NOMBRE_OK));
    expect(motivo).toContain("NEXT_PUBLIC_SINPE_NUMERO");
  });

  it("⭑ sin `NEXT_PUBLIC_SINPE_NOMBRE` tampoco, y el motivo nombra ESA otra", () => {
    const motivo = motivoDe(entorno(NUMERO_OK, undefined));
    expect(motivo).toContain("NEXT_PUBLIC_SINPE_NOMBRE");
    // Y no culpa a la que si estaba: un motivo que senala la variable equivocada manda a arreglar
    // el panel de Vercel donde no hay nada que arreglar.
    expect(motivo).not.toContain("NEXT_PUBLIC_SINPE_NUMERO");
  });

  it("una variable PRESENTE pero vacia (o solo espacios) es lo mismo que ausente", () => {
    // El caso real del panel de Vercel: la variable existe con el valor borrado.
    expect(motivoDe(entorno("", NOMBRE_OK))).toContain("NEXT_PUBLIC_SINPE_NUMERO");
    expect(motivoDe(entorno("   ", NOMBRE_OK))).toContain("NEXT_PUBLIC_SINPE_NUMERO");
    expect(motivoDe(entorno(NUMERO_OK, ""))).toContain("NEXT_PUBLIC_SINPE_NOMBRE");
    expect(motivoDe(entorno(NUMERO_OK, " \t "))).toContain("NEXT_PUBLIC_SINPE_NOMBRE");
  });

  it("con las dos puestas y bien, la semilla sale entera", () => {
    // El caso feliz, que es el que corre en el despliegue.
    expect(leerSemilla(entorno(NUMERO_OK, NOMBRE_OK))).toEqual({
      ok: true,
      numero: NUMERO_OK,
      nombre: NOMBRE_OK,
    });
  });
});

describe("429/R7 — `leerSemilla`: el formato del numero se juzga ANTES de tocar la base", () => {
  it.each([
    ["12345678", "ocho digitos pero empieza por 1: no es una serie movil"],
    ["50612345", "ocho digitos que empiezan por 506: se rechaza por el primer digito"],
    ["6123456", "siete digitos: falta uno"],
    ["612345678", "nueve digitos: sobra uno"],
  ])("⭑ `%s` se rechaza (%s)", (numero) => {
    const motivo = motivoDe(entorno(numero, NOMBRE_OK));
    // Dice QUE variable arreglar y QUE se espera, no solo «esta mal».
    expect(motivo).toContain("NEXT_PUBLIC_SINPE_NUMERO");
    expect(motivo).toContain("8 dígitos");
  });

  it("⭑ el `506` de ocho digitos NO se convierte en `12345` por el camino", () => {
    // Si la normalizacion le quitara el prefijo, el motivo del rechazo seria la longitud y el dato
    // original habria desaparecido en silencio. Es justo la correccion amable que termina mandando
    // el dinero a otra cuenta.
    expect(leerSemilla(entorno("50612345", NOMBRE_OK)).ok).toBe(false);
    expect(leerSemilla(entorno("12345", NOMBRE_OK)).ok).toBe(false);
  });

  it("⭑ el MISMO veredicto que la tabla compartida, caso a caso", () => {
    // La tabla que se corre contra el validador de la aplicacion y contra el `CHECK` de Postgres.
    // Si el seed aflojara su validacion por su cuenta, este caso lo dice.
    for (const invalido of SINPE_INVALIDOS) {
      expect(
        leerSemilla(entorno(invalido, NOMBRE_OK)).ok,
        `invalido: ${JSON.stringify(invalido)}`,
      ).toBe(false);
    }
    for (const valido of SINPE_VALIDOS) {
      expect(leerSemilla(entorno(valido, NOMBRE_OK)).ok, `valido: ${valido}`).toBe(true);
    }
    // Anti-vacuidad: si la tabla llegara vacia, los dos bucles de arriba pasarian sin mirar nada.
    expect(SINPE_INVALIDOS.length).toBeGreaterThan(5);
    expect(SINPE_VALIDOS.length).toBeGreaterThan(2);
  });
});

describe("429/R9 — `leerSemilla`: normaliza a los ocho digitos, y guarda lo que valido", () => {
  it('⭑ "+506 8888 1111" entra con prefijo y separadores y sale como `88881111`', () => {
    expect(leerSemilla(entorno("+506 8888 1111", NOMBRE_OK))).toEqual({
      ok: true,
      numero: "88881111",
      nombre: NOMBRE_OK,
    });
  });

  it("las otras formas del prefijo y de los separadores, tambien", () => {
    for (const entrada of ["8888-1111", "8888 1111", "+50688881111", "50688881111"]) {
      const semilla = leerSemilla(entorno(entrada, NOMBRE_OK));
      expect(semilla.ok, entrada).toBe(true);
      expect(semilla.ok ? semilla.numero : null, entrada).toBe("88881111");
    }
  });

  it("el titular se recorta por fuera, y no se toca por dentro", () => {
    expect(leerSemilla(entorno(NUMERO_OK, `  ${NOMBRE_OK}  `))).toEqual({
      ok: true,
      numero: NUMERO_OK,
      nombre: NOMBRE_OK,
    });
  });
});

describe("429/R8 — `leerSemilla`: el titular no puede pasar del ancho de la columna", () => {
  it("⭑ un titular de mas de 60 caracteres se rechaza AQUI, no lo trunca Postgres", () => {
    // `zona.sinpe_nombre` es `VARCHAR(60)`: sin este corte, la escritura muere con un error del
    // motor que no dice que variable hay que arreglar.
    const largo = "T".repeat(SINPE_NOMBRE_MAX_CHARS + 1);
    const motivo = motivoDe(entorno(NUMERO_OK, largo));
    expect(motivo).toContain("NEXT_PUBLIC_SINPE_NOMBRE");
    expect(motivo).toContain(String(SINPE_NOMBRE_MAX_CHARS));
  });

  it("uno de exactamente 60 SI se acepta: el limite es inclusivo", () => {
    // El caso de al lado del borde. Sin el, cambiar el `>` por un `>=` pasaria inadvertido.
    const justo = "T".repeat(SINPE_NOMBRE_MAX_CHARS);
    expect(leerSemilla(entorno(NUMERO_OK, justo)).ok).toBe(true);
  });
});

describe("429 — el motivo del rechazo NUNCA lleva el valor dentro", () => {
  it("⭑ ni el numero ni el titular aparecen en el mensaje: el log de un build se conserva", () => {
    // ⚠️ ES UNA PROPIEDAD DE SEGURIDAD, no un detalle de estilo. `main()` imprime este `motivo` por
    // `console.error` y el log de un build de Vercel queda guardado. El script imprime CONTEOS y
    // NOMBRES DE VARIABLE, nunca el valor — ni siquiera al fallar, que es cuando mas tienta.
    const numeroDelicado = "90000000"; // invalido (serie 9) y reconocible
    const titularDelicado = `Titular Reconocible ${"Z".repeat(SINPE_NOMBRE_MAX_CHARS)}`;

    expect(motivoDe(entorno(numeroDelicado, NOMBRE_OK))).not.toContain(numeroDelicado);
    expect(motivoDe(entorno(NUMERO_OK, titularDelicado))).not.toContain("Titular Reconocible");

    // Y tampoco se cuela troceado: ni un fragmento largo del valor.
    expect(motivoDe(entorno(numeroDelicado, NOMBRE_OK))).not.toContain("9000");
  });
});

// ---------------------------------------------------------------------------------------------
// `sembrarSinpeInicial`: la FORMA de la unica escritura. El comportamiento, en integracion.
// ---------------------------------------------------------------------------------------------

interface EscrituraApuntada {
  sql: string;
  valores: unknown[];
}

/**
 * Un doble que APUNTA el SQL que el script emite, rearmandolo igual que lo arma Prisma: los
 * valores del `$executeRaw` etiquetado salen del texto y entran como `$1`, `$2`.
 */
function prismaQueApunta(
  total: number,
  filasAfectadas: number,
): { cliente: Pick<PrismaClient, "zona" | "$executeRaw">; escrituras: EscrituraApuntada[] } {
  const escrituras: EscrituraApuntada[] = [];
  const cliente = {
    zona: { count: async () => total },
    $executeRaw: async (trozos: TemplateStringsArray, ...valores: unknown[]) => {
      let sql = trozos[0] ?? "";
      for (let i = 0; i < valores.length; i += 1) sql += `$${i + 1}${trozos[i + 1] ?? ""}`;
      escrituras.push({ sql, valores });
      return filasAfectadas;
    },
  };
  return {
    cliente: cliente as unknown as Pick<PrismaClient, "zona" | "$executeRaw">,
    escrituras,
  };
}

describe("429/R10 — `sembrarSinpeInicial`: una sola escritura, y acotada a los NULL", () => {
  it("⭑ el `UPDATE` va RESTRINGIDO a las filas sin valor: la idempotencia es del `WHERE`", async () => {
    // ⚠️ SIN ESE `WHERE`, la segunda corrida PISA la correccion que una bodega ya hizo a mano. Es
    // la mutacion que sobrevivio a la suite entera. Aqui se mide la FORMA; que Postgres se comporte
    // asi se mide en `tests/integration/db/zona-sinpe-migration.test.ts`.
    const { cliente, escrituras } = prismaQueApunta(8, 8);
    await sembrarSinpeInicial(cliente, { numero: NUMERO_OK, nombre: NOMBRE_OK });

    expect(escrituras).toHaveLength(1);
    expect(escrituras[0].sql).toMatch(/UPDATE\s+"zona"\s+SET/i);
    expect(escrituras[0].sql).toMatch(
      /WHERE\s+"sinpe_numero"\s+IS\s+NULL\s+OR\s+"sinpe_nombre"\s+IS\s+NULL/i,
    );
  });

  it("⭑ los dos valores viajan PARAMETRIZADOS: no entran en el texto del SQL", async () => {
    // Si se interpolaran, el numero apareceria en cualquier log de consultas de Postgres.
    const { cliente, escrituras } = prismaQueApunta(8, 8);
    await sembrarSinpeInicial(cliente, { numero: NUMERO_OK, nombre: NOMBRE_OK });

    expect(escrituras[0].valores).toEqual([NUMERO_OK, NOMBRE_OK]);
    expect(escrituras[0].sql).not.toContain(NUMERO_OK);
    expect(escrituras[0].sql).not.toContain(NOMBRE_OK);
  });

  it("el conteo devuelto reparte entre rellenadas e intactas", async () => {
    const { cliente } = prismaQueApunta(8, 3);
    expect(await sembrarSinpeInicial(cliente, { numero: NUMERO_OK, nombre: NOMBRE_OK })).toEqual({
      rellenadas: 3,
      intactas: 5,
    });
  });

  it("⭑ NO toca `sinpe_revisado_at`: la semilla nace SIN revisar (R5/R10)", async () => {
    // Marcarla aqui convertiria en un adorno la revision obligatoria del primer inicio de sesion.
    const { cliente, escrituras } = prismaQueApunta(8, 8);
    await sembrarSinpeInicial(cliente, { numero: NUMERO_OK, nombre: NOMBRE_OK });
    expect(escrituras[0].sql).not.toContain("sinpe_revisado_at");
  });
});
