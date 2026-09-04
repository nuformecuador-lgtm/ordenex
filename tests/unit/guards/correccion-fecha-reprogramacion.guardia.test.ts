import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { codigoSinComentarios } from "../../fixtures/sin-comentarios";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 371 — LAS CUATRO COSAS QUE, SI SE ROMPEN, NO ROMPEN NINGUN TEST DE COMPORTAMIENTO.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Los cuatro modos de fallo que esta guardia cierra son MUDOS: el codigo compila, la suite queda
// verde y la aplicacion hace algo distinto de lo que dice.
//
//   1. DOS CORRELACIONES DE LA GESTION VIGENTE. Si la correccion elige la gestion con su propia
//      expresion en vez de con la compartida, el dia que una orden tenga dos gestiones
//      `reprogramada` vivas se corregira una fecha que el cron no mira. Nada se pone rojo: las dos
//      consultas devuelven filas plausibles.
//   2. UN SEGUNDO PUNTO DE ESCRITURA del rastro. La tabla es append-only y su unico sentido es que
//      TODA correccion pase por el mismo sitio; un `create` suelto en otro repositorio deja
//      correcciones sin rastro.
//   3. EL COMPOSITION ROOT QUE NO INYECTA. El liberador tiene default NO-OP a proposito; si la
//      Server Action deja de PASARLO, corregir a hoy vuelve a dejar la orden esperando al cron
//      —en produccion, con toda la suite en verde—. Es el fallo que la 271 y la 315 ya se comieron
//      en este mismo punto, y por eso aqui se exige que ALGUIEN LO PASE, no que se importe.
//   4. LA FOTO DESPUES DE ESCRIBIR. Si el `SELECT … FOR UPDATE` que fotografia la fecha anterior
//      cae DESPUES del `UPDATE`, el rastro dira que se corrigio de X a X. El comportamiento
//      observable de la correccion no cambia: solo miente el rastro.
//
// La lectura es ESTATICA. La selecciona `pnpm exec vitest run guard` por el nombre del archivo.

const RAIZ = path.resolve(__dirname, "../../..");

const MODULO_CORRELACION = "lib/repositories/gestion-reprogramada-vigente.ts";
const CHOKE_POINT = "lib/repositories/registrar-cambio-fecha-reprogramacion.ts";
const REPO_CORRECCION = "lib/repositories/CorreccionFechaReprogramacionRepository.ts";
const REPO_LIBERACION = "lib/repositories/LiberacionReprogramadaRepository.ts";
const ACCION = "lib/actions/corregir-fecha-reprogramacion.ts";

/** Los dos consumidores de la correlacion. Si aparece un tercero, se añade AQUI y se razona. */
const CONSUMIDORES_DE_LA_CORRELACION = [REPO_LIBERACION, REPO_CORRECCION] as const;

/**
 * La correlacion escrita EN LINEA: un `orderBy` por `createdAt` descendente. Es la forma que
 * tendria cualquier copia, y la que este archivo prohibe fuera del modulo compartido.
 */
const CORRELACION_EN_LINEA = /orderBy:\s*\{\s*createdAt:\s*"desc"\s*\}/;

function fuente(rel: string): string {
  return codigoSinComentarios(rel);
}

/** Todos los `.ts`/`.tsx` de un arbol de produccion. */
function archivosDe(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(path.join(RAIZ, dir))) {
    const rel = `${dir}/${entrada}`;
    if (statSync(path.join(RAIZ, rel)).isDirectory()) archivosDe(rel, acc);
    else if (/\.tsx?$/.test(rel)) acc.push(rel);
  }
  return acc;
}

// ---------------------------------------------------------------------------------------------
// 0 — El detector, probado contra respuestas conocidas
// ---------------------------------------------------------------------------------------------

describe("371/T-G0 — el detector se prueba a si mismo", () => {
  it("CONTRAPRUEBA: reconoce una correlacion escrita en linea", () => {
    expect(
      CORRELACION_EN_LINEA.test(
        `gestiones: { where: { resultado: "reprogramada" }, orderBy: { createdAt: "desc" }, take: 1 }`,
      ),
    ).toBe(true);
  });

  it("CONTRAPRUEBA: NO se dispara con otro `orderBy` cualquiera", () => {
    expect(CORRELACION_EN_LINEA.test(`orderBy: { liberadaReprogramadaAt: "desc" }`)).toBe(false);
  });

  it("los cinco archivos de la ficha existen y no se leen vacios", () => {
    for (const rel of [MODULO_CORRELACION, CHOKE_POINT, REPO_CORRECCION, REPO_LIBERACION, ACCION]) {
      expect(fuente(rel).trim().length, `${rel} se leyo vacio`).toBeGreaterThan(200);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 1 — UNA sola correlacion de «la gestion reprogramada vigente»
// ---------------------------------------------------------------------------------------------

describe("371 — la gestion vigente se elige en UN solo sitio", () => {
  it("el modulo compartido declara la correlacion COMPLETA", () => {
    const codigo = fuente(MODULO_CORRELACION);
    // Los tres argumentos que la definen. Si alguno se cayera, los dos caminos empezarian a
    // elegir por criterios distintos sin que nadie lo escribiera.
    expect(codigo).toMatch(/resultado:\s*RESULTADO_REPROGRAMADA/);
    expect(codigo).toMatch(/anuladaAt:\s*null/);
    expect(codigo).toMatch(CORRELACION_EN_LINEA);
    expect(codigo).toMatch(/take:\s*1/);
  });

  it.each(CONSUMIDORES_DE_LA_CORRELACION)("%s la IMPORTA y no la reescribe", (rel) => {
    const codigo = fuente(rel);
    expect(codigo, `${rel} ya no importa la correlacion compartida`).toContain(
      "gestion-reprogramada-vigente",
    );
    expect(
      CORRELACION_EN_LINEA.test(codigo),
      `${rel} volvio a escribir la correlacion en linea: el dia que una orden tenga dos ` +
        "gestiones reprogramada vivas, el cron y la correccion apuntaran a filas distintas",
    ).toBe(false);
  });

  it("⭑ NADIE MAS en `lib/**` correlaciona gestiones `reprogramada` por su cuenta", () => {
    const infractores = archivosDe("lib")
      .filter((rel) => rel !== MODULO_CORRELACION)
      .filter((rel) => {
        const codigo = fuente(rel);
        // Solo interesa la coincidencia de las DOS cosas: elegir la mas reciente Y filtrar por
        // `resultado: "reprogramada"`. Un `orderBy` por `createdAt` sobre otra tabla no es esto.
        return (
          CORRELACION_EN_LINEA.test(codigo) && /resultado:\s*"?reprogramada"?/.test(codigo)
        );
      });
    expect(
      infractores,
      "una segunda correlacion de la gestion vigente es el defecto mudo de esta ficha",
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 2 — UN solo punto de escritura del rastro
// ---------------------------------------------------------------------------------------------

describe("371 — `gestion_fecha_reprogramacion_cambio` se escribe por un solo sitio", () => {
  it("el choke point la inserta, y SOLO inserta", () => {
    const codigo = fuente(CHOKE_POINT);
    expect(codigo).toContain("gestionFechaReprogramacionCambio.createMany");
    for (const prohibido of ["update(", "updateMany(", "delete(", "deleteMany(", "upsert("]) {
      expect(codigo, `el choke point ganó un \`${prohibido}\`: la tabla es append-only`).not.toContain(
        `gestionFechaReprogramacionCambio.${prohibido}`,
      );
    }
  });

  it("⭑ ningun otro archivo de `lib/**` nombra la tabla para escribir", () => {
    const infractores = archivosDe("lib")
      .filter((rel) => rel !== CHOKE_POINT)
      .filter((rel) => /\.gestionFechaReprogramacionCambio\s*\./.test(fuente(rel)));
    expect(
      infractores,
      "un segundo punto de escritura deja el rastro sin un sitio por el que pasar",
    ).toEqual([]);
  });

  it("el repositorio de la correccion escribe el rastro POR el choke point", () => {
    const codigo = fuente(REPO_CORRECCION);
    expect(codigo).toContain("registrarCambioFechaReprogramacion(tx,");
  });
});

// ---------------------------------------------------------------------------------------------
// 3 — El composition root PASA el liberador real (no basta con importarlo)
// ---------------------------------------------------------------------------------------------

describe("371 — corregir a hoy libera de verdad: alguien PASA el liberador real", () => {
  it("⭑ la Server Action lo construye y lo pasa como argumento del servicio", () => {
    const codigo = fuente(ACCION);
    // El default del service es el NO-OP: sin esta linea, corregir a hoy deja la orden esperando
    // al cron de medianoche y ningun test de comportamiento se entera.
    expect(codigo).toMatch(
      /new CorreccionFechaReprogramacionService\([\s\S]*liberarTrasCorregirFechaCon\(/,
    );
    // Y con el MISMO ensamblaje que el cron y la aprobacion de cierre: tres cableados distintos
    // del mismo servicio serian tres comportamientos que pueden divergir.
    expect(codigo).toContain("buildLiberarReprogramadasService()");
  });

  it("el liberador entra por `LiberacionReprogramadaService`, no por una liberacion paralela", () => {
    const adaptador = fuente("lib/services/liberacion-tras-corregir-fecha.ts");
    expect(adaptador).toContain("liberarOrdenCorregida");
    // La puerta de la 276 NO se toca desde aqui: el adaptador no puede decidir liberar.
    expect(adaptador).not.toContain("puedeLiberarse");
    expect(adaptador).not.toContain("liberarOrden(");
  });

  it("⭑ `puedeLiberarse` sigue gobernando el tercer disparador, como los otros dos", () => {
    const servicio = fuente("lib/services/LiberacionReprogramadaService.ts");
    // El tercer alcance entra por el MISMO bucle (`liberarCandidatas`), que es donde vive la
    // puerta. Si alguien le diera un bucle propio, esta linea se cae.
    expect(servicio).toMatch(
      /liberarOrdenCorregida[\s\S]{0,600}?this\.liberarCandidatas\(ordenes, ctx, ETIQUETA_CORRECCION\)/,
    );
    expect(servicio).toContain("if (!puedeLiberarse(orden))");
  });
});

// ---------------------------------------------------------------------------------------------
// 4 — La foto de la fecha anterior va ANTES del UPDATE
// ---------------------------------------------------------------------------------------------

describe("371 — el `FOR UPDATE` fotografia la fecha ANTES de pisarla", () => {
  const codigo = () => fuente(REPO_CORRECCION);

  it("⭑ el `SELECT … FOR UPDATE` aparece ANTES del `UPDATE \"gestion_orden\"`", () => {
    const texto = codigo();
    const iSelect = texto.indexOf("FOR UPDATE");
    const iUpdate = texto.indexOf('UPDATE "gestion_orden"');
    expect(iSelect, "no queda ningun `FOR UPDATE` en el repositorio").toBeGreaterThan(-1);
    expect(iUpdate, "no queda ninguna escritura de la fecha").toBeGreaterThan(-1);
    expect(
      iSelect,
      "la foto de la fecha anterior quedo DESPUES de la escritura: el rastro diria que se " +
        "corrigio de X a X y nadie se enteraria",
    ).toBeLessThan(iUpdate);
  });

  it("la escritura toca EXACTAMENTE una columna: `fecha_reprogramacion`", () => {
    const texto = codigo();
    // La huella del `SET` es lo que hace verificable que corregir una fecha no toca el resultado,
    // ni el cierre, ni la anulacion, ni el mensajero de la gestion.
    const set = /SET "fecha_reprogramacion" = \$\{input\.fecha\}::date\s*\n?\s*WHERE/;
    expect(set.test(texto), "el `SET` de la correccion cambio de forma").toBe(true);
  });

  it("el `UPDATE` va GUARDADO por el estado de la orden y por la vigencia de la gestion", () => {
    const texto = codigo();
    for (const guarda of [
      '"resultado" = \'reprogramada\'',
      '"anulada_at" IS NULL',
      '"fecha_reprogramacion" IS NOT NULL',
      'o."estatus_id" = ${input.estatusReprogramadaId}',
      'o."deleted_at" IS NULL',
    ]) {
      expect(texto, `desaparecio la guarda \`${guarda}\` del WHERE`).toContain(guarda);
    }
  });
});
