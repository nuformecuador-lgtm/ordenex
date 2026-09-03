import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { codigoSinComentarios } from "@/tests/fixtures/sin-comentarios";

/**
 * FICHA 362 / T7.5 (R21) — GUARDIA: la pantalla del registro es SOLO LECTURA.
 *
 * Precedente: 321/R24, que lo afirmó por ARIA (con el hilo cargado no hay campo de redacción,
 * ni botón de enviar). Aquí se afirma por IMPORTS, y la diferencia no es de gusto: aquella
 * pantalla tenía UN camino de escritura conocido (las cuatro acciones del chat) y se podía
 * espiar; esta tiene ~30 módulos de acciones en `lib/actions/**` y cualquiera de ellos
 * serviría. Espiarlos uno a uno sería una lista fija que envejece; barrer los imports del
 * directorio no envejece.
 *
 * ## Qué es exactamente lo que se prohíbe
 *
 * Ningún módulo de `app/(app)/historico/acciones/**` importa una Server Action que no sea una
 * de las TRES LECTURAS del propio registro. Ni una que escriba en otra tabla, ni una que
 * revalide caché, ni un `redirect` que mueva al usuario a un flujo de escritura.
 *
 * ## Por qué importa aquí más que en otra pantalla
 *
 * Un registro de auditoría que ofrece un botón deja de ser un registro. R2 hace la fila
 * inmutable en la base, así que el riesgo no es que se altere el pasado; el riesgo es que
 * esta pantalla se convierta en la consola de administración de otra cosa, y que las acciones
 * que se lancen desde aquí se registren a su vez, con el maestro de actor, mezclando el acto
 * de auditar con los actos auditados.
 *
 * ## Anti-vacuidad y contrapruebas
 *
 * Una guardia que barre archivos pasa VERDE si no encuentra ninguno. El primer caso afirma
 * que el directorio EXISTE y tiene los módulos que dice tener; las contrapruebas aplican la
 * mutación en memoria y exigen que la aserción la cace.
 */

const RAIZ = path.resolve(__dirname, "../../..");
const DIRECTORIO = "app/(app)/historico/acciones";

/** Las TRES lecturas del contrato. Ninguna otra acción puede entrar en esta pantalla. */
const LECTURAS_PERMITIDAS = [
  "listarHistorialAccionesPaginado",
  "listarHistorialAccionesCompleto",
  "obtenerCatalogoActoresHistorial",
] as const;

const MODULO_DE_LECTURAS = "@/lib/actions/historial-acciones";

/** Llamadas que sólo tienen sentido en un camino de escritura. */
const RASTROS_DE_ESCRITURA = /\b(revalidatePath|revalidateTag|revalidate|useFormState|useActionState)\b/;

function listarArchivos(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) listarArchivos(completo, acc);
    else if (/\.tsx?$/.test(entrada.name)) acc.push(completo);
  }
  return acc;
}

/** Rutas relativas a la raíz, con `/`, de los módulos de la pantalla. */
const ARCHIVOS = listarArchivos(path.join(RAIZ, DIRECTORIO))
  .map((a) => path.relative(RAIZ, a).split(path.sep).join("/"))
  .sort();

/** Los `from "…"` de un fuente, sin comentarios (un import comentado no importa nada). */
function especificadores(fuente: string): string[] {
  return [...fuente.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1] as string);
}

/** Los nombres importados de un módulo concreto. */
function nombresImportadosDe(fuente: string, modulo: string): string[] {
  const re = new RegExp(`import\\s*(?:type\\s*)?\\{([^}]*)\\}\\s*from\\s*"${modulo}"`, "g");
  return [...fuente.matchAll(re)]
    .flatMap((m) => (m[1] as string).split(","))
    .map((n) => n.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0] as string)
    .filter((n) => n !== "");
}

/**
 * Las DOS mitades de R21, en una función, para que las contrapruebas ejerciten exactamente
 * las mismas aserciones que el caso real.
 */
function afirmarSoloLectura(fuente: string, donde: string): void {
  for (const spec of especificadores(fuente)) {
    if (!spec.startsWith("@/lib/actions/")) continue;
    expect(spec, `${donde} importa acciones de otro módulo`).toBe(MODULO_DE_LECTURAS);
  }
  for (const nombre of nombresImportadosDe(fuente, MODULO_DE_LECTURAS)) {
    // Los TIPOS del contrato entran (`ListarHistorialAccionesResult` y compañía viven en
    // `lib/types`, pero el borde reexporta su `HistorialAccionesActionDeps`): lo que se
    // vigila son los VALORES con forma de acción, o sea los que empiezan por un verbo.
    if (!/^(listar|obtener|crear|actualizar|eliminar|registrar|aprobar|rechazar|anular|generar|rotar|activar|desactivar|marcar|enviar|guardar|corregir|asignar|recuperar|borrar)/.test(nombre)) {
      continue;
    }
    expect(
      LECTURAS_PERMITIDAS as readonly string[],
      `${donde} importa la acción ${nombre}`,
    ).toContain(nombre);
  }
  expect(fuente, `${donde} tiene rastros de un camino de escritura`).not.toMatch(
    RASTROS_DE_ESCRITURA,
  );
  expect(fuente, `${donde} declara 'use server'`).not.toContain("use server");
}

describe("R21 — la pantalla del registro no importa ni una acción que escriba", () => {
  it("anti-vacuidad: el directorio existe y tiene los módulos que la ficha declara", () => {
    // Sin esto, borrar la pantalla dejaría esta guardia informando «verde» sobre cero
    // archivos, que es decir exactamente nada.
    expect(ARCHIVOS.length).toBeGreaterThanOrEqual(7);
    expect(ARCHIVOS).toContain(`${DIRECTORIO}/page.tsx`);
    expect(ARCHIVOS).toContain(
      `${DIRECTORIO}/_components/HistorialAccionesModule.tsx`,
    );
  });

  for (const archivo of ARCHIVOS) {
    it(`${archivo} sólo conoce lecturas`, () => {
      afirmarSoloLectura(codigoSinComentarios(archivo), archivo);
    });
  }

  it("y ALGUIEN importa de verdad las tres lecturas: la pantalla no está desconectada", () => {
    // La otra mitad de la anti-vacuidad. Una pantalla que no importa NINGUNA acción pasaría
    // el barrido de arriba con las manos en los bolsillos — y además dejaría fosilizado el
    // `@sin-superficie` que esta tanda vino a retirar.
    const todo = ARCHIVOS.map((a) => codigoSinComentarios(a)).join("\n");
    for (const lectura of LECTURAS_PERMITIDAS) {
      expect(todo, `nadie importa ${lectura}`).toContain(lectura);
    }
  });
});

describe("las contrapruebas: la guardia CAZA lo que dice cazar", () => {
  it("(a) importar una acción de OTRO módulo la pone roja", () => {
    const mutado = 'import { eliminarOrdenPantalla } from "@/lib/actions/ordenes";';
    expect(() => afirmarSoloLectura(mutado, "sintético")).toThrow();
  });

  it("(b) importar una acción de ESCRITURA del propio módulo la pone roja", () => {
    // El caso sutil: el módulo del historial es de lecturas hoy, pero nada impide que mañana
    // gane un export. La guardia mira el NOMBRE, no sólo el módulo.
    const mutado = `import { borrarHistorialAccion } from "${MODULO_DE_LECTURAS}";`;
    expect(() => afirmarSoloLectura(mutado, "sintético")).toThrow();
  });

  it("(c) revalidar caché la pone roja", () => {
    const mutado = 'import { revalidatePath } from "next/cache";\nrevalidatePath("/x");';
    expect(() => afirmarSoloLectura(mutado, "sintético")).toThrow();
  });

  it("(d) declarar 'use server' en la pantalla la pone roja", () => {
    expect(() => afirmarSoloLectura('"use server";', "sintético")).toThrow();
  });

  it("(e) y el fuente REAL de la pantalla pasa: la guardia no está rota", () => {
    // Sin este caso, las contrapruebas de arriba podrían estar pasando porque la función
    // lanza SIEMPRE.
    for (const archivo of ARCHIVOS) {
      expect(() =>
        afirmarSoloLectura(codigoSinComentarios(archivo), archivo),
      ).not.toThrow();
    }
  });

  it("el detector de imports no está roto: ve los que hay en el módulo real", () => {
    const fuente = codigoSinComentarios(
      `${DIRECTORIO}/_components/HistorialAccionesModule.tsx`,
    );
    expect(especificadores(fuente)).toContain(MODULO_DE_LECTURAS);
    expect(nombresImportadosDe(fuente, MODULO_DE_LECTURAS).sort()).toEqual(
      ["listarHistorialAccionesCompleto", "listarHistorialAccionesPaginado"].sort(),
    );
  });
});

/** El fuente crudo, para lo que sí tiene sentido mirar sin quitar comentarios. */
function crudo(archivo: string): string {
  return readFileSync(path.join(RAIZ, archivo), "utf8");
}

describe("ningún control de la pantalla puede producir una escritura", () => {
  it("no hay `<form`, ni `action=`, ni `onSubmit` en todo el directorio", () => {
    for (const archivo of ARCHIVOS) {
      const fuente = codigoSinComentarios(archivo);
      expect(fuente, `${archivo} monta un formulario`).not.toMatch(/<form[\s>]/);
      expect(fuente, `${archivo} declara un onSubmit`).not.toContain("onSubmit");
    }
  });

  it("y el directorio no esconde una ruta de API propia", () => {
    // `route.ts` dentro de una pantalla es la puerta trasera clásica: no lo caza el barrido
    // de imports porque no importa nada, lo EXPONE.
    expect(ARCHIVOS.filter((a) => /\/route\.tsx?$/.test(a))).toEqual([]);
    expect(crudo(`${DIRECTORIO}/page.tsx`)).toContain("notFound");
  });
});
