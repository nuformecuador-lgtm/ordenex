import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { normalizarTerminoBusqueda } from "@/lib/utils/busqueda-orden";
import { sqlNormalizarTextoBusqueda } from "@/lib/utils/busqueda-texto-sql";
import { HAY_BASE_DE_DATOS, crearPrismaDeTest } from "./_postgres-real";

// Feature 321 / T2.4 — PARIDAD entre `sqlNormalizarTextoBusqueda` (Postgres) y
// `normalizarTerminoBusqueda` (Node), R36.
//
// POR QUE IMPORTA. El termino que teclea el usuario se normaliza en Node; el nombre del
// mensajero se normaliza EN LA CONSULTA con la expresion de este modulo. Si las dos
// normalizaciones divergen aunque sea en un caracter, la busqueda «no encuentra» un hilo que
// existe: sin error, sin log y sin forma de deducirlo leyendo codigo. Es el mismo riesgo nº 3
// que ya documenta `busqueda-orden.ts`.
//
// POR QUE CONTRA POSTGRES REAL Y NO CON UNA REGEX SOBRE EL SQL. Lo que puede fallar es la
// SEMANTICA del motor: `translate` con un mapa de 48 caracteres, el orden `translate`-antes-de-
// `lower` (que depende de la collation) y una clase de espacios que en Postgres NO es la misma
// que `\s` de JavaScript. Ninguna de las tres se demuestra comparando el SQL consigo mismo.
//
// TRAMPA QUE ESTE TEST EVITA A PROPOSITO (medida en este repo). Los tests de paridad de
// busqueda existentes siembran filas en `orden` y RETORNAN TEMPRANO cuando no hay ninguna: con
// la tabla vacia pasan en verde sin haber comparado nada. Aqui el corpus es LITERAL y viaja en
// un `VALUES`, asi que la expresion se evalua siempre; ademas se cuenta cuantos casos se
// compararon de verdad y se exige que sean TODOS (`CORPUS.length`), no «mas de cero por si
// acaso». Si la consulta no devolviera filas, o devolviera de menos, el test se pone rojo.

const describeSiHayBase = HAY_BASE_DE_DATOS ? describe : describe.skip;

/** Espacio duro U+00A0. Se construye por codigo: en el fuente seria invisible. */
const NBSP = String.fromCharCode(0x00a0);

interface CasoCorpus {
  nombre: string;
  texto: string;
}

/**
 * El corpus. Cada caso existe por una razon distinta; ninguno es relleno.
 *
 * El caso del NBSP es el mas contraintuitivo y por eso esta: `\s` de JavaScript SI lo considera
 * espacio y el de Postgres NO. Como los dos lados escriben la clase EXPLICITA
 * `[ \t\n\r\f\v]`, ninguno lo colapsa y la paridad se mantiene. Si alguien «simplificara»
 * cualquiera de los dos lados a `\s`, este caso lo caza.
 */
const CORPUS: CasoCorpus[] = [
  { nombre: "vacio", texto: "" },
  { nombre: "solo espacios", texto: "   " },
  { nombre: "minusculas sin acentos", texto: "juan perez" },
  { nombre: "mayusculas", texto: "MARIA GONZALEZ" },
  { nombre: "acentos en minuscula", texto: "maría gonzález" },
  { nombre: "acentos en MAYUSCULA", texto: "MARÍA GONZÁLEZ" },
  { nombre: "eñe en ambas cajas", texto: "IBÁÑEZ muñoz" },
  { nombre: "cedilla", texto: "Gonçalves ÇEDILLA" },
  { nombre: "vocales con dieresis y circunflejo", texto: "Jörg Ângela Raúl Über" },
  { nombre: "espacios multiples internos", texto: "juan     carlos    perez" },
  { nombre: "espacios en los extremos", texto: "   ana solis   " },
  { nombre: "tabulador y salto de linea", texto: "ana\tsolis\nmora" },
  { nombre: "retorno de carro y form feed", texto: "ana\r\nsolis\fmora" },
  { nombre: "tabulacion vertical", texto: "ana\vsolis" },
  { nombre: "NBSP: NO se colapsa en ninguno de los dos lados", texto: `ana${NBSP}${NBSP}solis` },
  { nombre: "numero de guia", texto: "1001" },
  { nombre: "remision con guion", texto: "REM-1001" },
  { nombre: "caracter fuera del mapa de plegado", texto: "Bjørn Håkon" },
  { nombre: "mezcla completa", texto: `  JOSÉ\t ANDRÉS   PEÑA${NBSP}ÑÚÑEZ  ` },
];

/**
 * Filas del `VALUES` del corpus: `($1::text, 1), ($2::text, 2), …`. El ordinal se escribe a
 * mano y no con `WITH ORDINALITY` porque eso ultimo solo admite funciones que devuelven
 * conjuntos, no un `VALUES` (Postgres responde `42601`). El ordinal es lo que permite casar
 * cada fila con su caso sin confiar en el orden de llegada.
 */
function filasDelCorpus(cantidad: number): string {
  return Array.from({ length: cantidad }, (_, i) => `($${i + 1}::text, ${i + 1})`).join(", ");
}

interface FilaNormalizada {
  posicion: number;
  normalizado: string;
}

describeSiHayBase("paridad SQL/Node de la normalizacion de texto de busqueda (Postgres real)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = crearPrismaDeTest();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  /**
   * Evalua la expresion sobre el corpus LITERAL. No lee ninguna tabla a proposito: el corpus
   * viaja como parametros, asi que el resultado no depende de que la base de desarrollo tenga
   * datos. `ordinality` conserva el orden de entrada para casar cada fila con su caso.
   */
  async function normalizarEnPostgres(textos: string[]): Promise<FilaNormalizada[]> {
    const consulta = `
      SELECT ord::int AS posicion,
             ${sqlNormalizarTextoBusqueda("t.texto")} AS normalizado
      FROM (VALUES ${filasDelCorpus(textos.length)}) AS t(texto, ord)
      ORDER BY ord`;
    return prisma.$queryRawUnsafe<FilaNormalizada[]>(consulta, ...textos);
  }

  it("produce EXACTAMENTE el mismo texto que `normalizarTerminoBusqueda` en cada caso del corpus", async () => {
    const filas = await normalizarEnPostgres(CORPUS.map((caso) => caso.texto));

    // La comprobacion que impide el falso verde: si la expresion no se evaluo, o el motor
    // devolvio de menos, aqui se ve. No es «> 0 por si acaso»: son TODOS los casos.
    expect(filas).toHaveLength(CORPUS.length);

    let comparados = 0;
    for (const [indice, caso] of CORPUS.entries()) {
      const fila = filas[indice];
      expect(fila, `falta la fila del caso «${caso.nombre}»`).toBeDefined();
      expect(fila.posicion).toBe(indice + 1);
      expect(fila.normalizado, `caso «${caso.nombre}»`).toBe(normalizarTerminoBusqueda(caso.texto));
      comparados += 1;
    }
    expect(comparados).toBe(CORPUS.length);
    expect(comparados).toBeGreaterThan(0);
  });

  // CONTRAPRUEBA. Sin esto, un `sqlNormalizarTextoBusqueda` que devolviera la expresion TAL
  // CUAL (sin normalizar nada) pasaria el test de arriba en todos los casos que ya vienen
  // normalizados. Aqui se exige que la expresion CAMBIE el texto donde tiene que cambiarlo.
  it("la expresion transforma de verdad: acentos, caja y espacios cambian respecto al original", async () => {
    const casosQueDebenCambiar = CORPUS.filter(
      (caso) => normalizarTerminoBusqueda(caso.texto) !== caso.texto,
    );
    expect(casosQueDebenCambiar.length).toBeGreaterThan(0);

    const filas = await normalizarEnPostgres(casosQueDebenCambiar.map((caso) => caso.texto));
    expect(filas).toHaveLength(casosQueDebenCambiar.length);

    for (const [indice, caso] of casosQueDebenCambiar.entries()) {
      expect(filas[indice].normalizado, `caso «${caso.nombre}»`).not.toBe(caso.texto);
    }
  });

  // El consumidor real (design §1.2, R36) no normaliza UNA columna sino la CONCATENACION de
  // las tres del nombre del mensajero. Que la expresion admita una expresion compuesta —y no
  // solo un identificador— es parte del contrato del helper.
  it("acepta una expresion compuesta (el nombre completo del mensajero) y no solo una columna", async () => {
    const consulta = `
      SELECT ${sqlNormalizarTextoBusqueda(
        "concat_ws(' ', t.nombre, t.primer_apellido, t.segundo_apellido)",
      )} AS normalizado
      FROM (VALUES ($1::text, $2::text, $3::text)) AS t(nombre, primer_apellido, segundo_apellido)`;
    const filas = await prisma.$queryRawUnsafe<{ normalizado: string }[]>(
      consulta,
      "  José ",
      "PEÑA",
      "Ñúñez",
    );

    expect(filas).toHaveLength(1);
    expect(filas[0].normalizado).toBe(normalizarTerminoBusqueda("  José  PEÑA Ñúñez"));
    expect(filas[0].normalizado).toBe("jose pena nunez");
  });
});
