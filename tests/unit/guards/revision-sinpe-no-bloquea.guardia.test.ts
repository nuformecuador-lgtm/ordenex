import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { RAIZ_DEL_REPO, archivosDeCodigoCensados } from "../../fixtures/raices-de-codigo";
import { codigoSinComentarios } from "../../fixtures/sin-comentarios";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 429 / T16-G3 (R28) — LA REVISION PENDIENTE NO BLOQUEA NADA. NUNCA.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// POR QUE ESTA GUARDIA EXISTE, Y POR QUE SE ESCRIBE ANTES QUE LA PANTALLA. Un bloqueo duro
// garantiza la revision y garantiza TAMBIEN que un fallo de esa pantalla deja a una bodega entera
// sin poder trabajar. La condicion D8 —«no dañar lo que ya funciona»— manda: la insistencia se paga
// con volver a preguntar en el siguiente inicio de sesion, no con cerrar la puerta.
//
// LA FORMA DE QUE ESO SE ROMPA no es un fallo ruidoso: es que alguien, con toda la buena intencion,
// escriba `if (revision) redirect("/mi-bodega")` en el layout el dia que vea que nadie confirma. Por
// eso la propiedad se vigila aqui y no se deja escrita en un comentario.
//
// LAS DOS COSAS QUE EXIGE:
//   1. NADIE decide un `redirect`, un `notFound` ni un 403 a partir de la revision pendiente;
//   2. cuando el aviso se monte (T22, tras la puerta de `/design`), tendra que ser HERMANO del
//      contenido, nunca envolviendolo. Un componente que envuelve `{children}` puede dejar de
//      pintarlos con un `return null`; uno hermano no tiene donde hacerlo.
//
// ⚠️ EL CASO 2 ES CONDICIONAL HOY Y NO ES UN AGUJERO: el montaje pertenece a T19/T22, que van en la
// pasada de pantallas. Se escribe ahora, con el backend, para que llegue ANTES que el componente —
// una guardia escrita despues del codigo que vigila llega tarde por definicion.

const LAYOUT = "app/(app)/layout.tsx";
const COMPONENTE = "RevisionSinpeBodega";

/** Las señales de «esto corta el paso», tal cual se escriben en este repo. */
const BLOQUEOS = [
  /\bredirect\s*\(/,
  /\bnotFound\s*\(/,
  /status:\s*403/,
  /\bforbidden\b/i,
  /\bunauthorized\b/i,
];

/** Lo que nombra la revision pendiente. */
const REVISION = /revisionSinpe|resolverRevisionSinpePendiente|RevisionSinpePendiente/;

function leer(rel: string): string {
  return codigoSinComentarios(rel);
}

/** Archivos censados que nombran la revision pendiente. Hoy: el resolvedor y (luego) el layout. */
function archivosQueLaNombran(): string[] {
  return archivosDeCodigoCensados().filter((rel) => REVISION.test(leer(rel)));
}

describe("429/R28 — ninguna ruta corta el paso por tener la revision pendiente", () => {
  it("el censo encuentra el resolvedor (anti-vacuidad: si no, no vigila nada)", () => {
    const archivos = archivosQueLaNombran();
    expect(archivos).toContain("lib/auth/revision-sinpe-pendiente.ts");
  });

  it("⭑ el propio resolvedor NO redirige, NO devuelve 403 y NO lanza", () => {
    // Es una LECTURA que devuelve un dato para pintar. Si decidiera acceso, R28 dejaria de ser
    // estructural: bastaria con que alguien reusara su salida como guarda.
    const fuente = leer("lib/auth/revision-sinpe-pendiente.ts");
    for (const patron of BLOQUEOS) {
      expect(patron.test(fuente), `${patron}`).toBe(false);
    }
    expect(fuente).not.toMatch(/\bthrow\b/);
  });

  it("⭑ NINGUN archivo que nombre la revision decide un `redirect`/`notFound`/403 con ella", () => {
    // El barrido es por ARCHIVO y no por linea a proposito: un archivo que a la vez lee la revision
    // y redirige es ya un sitio donde revisar la decision a mano, aunque las dos cosas no esten en
    // la misma expresion.
    const infractores = archivosQueLaNombran().filter((rel) => {
      const fuente = leer(rel);
      return BLOQUEOS.some((patron) => patron.test(fuente));
    });
    expect(infractores).toEqual([]);
  });

  it("⭑ CONTRAPRUEBA — un `redirect` inyectado en el resolvedor pone la guardia roja", () => {
    // Sin esto, el caso de arriba podria estar verde porque el detector no detecta.
    const archivo = path.join(RAIZ_DEL_REPO, "lib", "auth", "revision-sinpe-pendiente.ts");
    const original = fs.readFileSync(archivo, "utf8");
    try {
      fs.writeFileSync(
        archivo,
        `${original}\nexport function intruso() {\n  redirect("/mi-bodega");\n}\n`,
        "utf8",
      );
      const infractores = archivosQueLaNombran().filter((rel) =>
        BLOQUEOS.some((patron) => patron.test(leer(rel))),
      );
      expect(infractores).toContain("lib/auth/revision-sinpe-pendiente.ts");
    } finally {
      fs.writeFileSync(archivo, original, "utf8");
    }
    // Y el arbol queda como estaba.
    expect(archivosQueLaNombran().filter((rel) => BLOQUEOS.some((p) => p.test(leer(rel))))).toEqual(
      [],
    );
  });
});

describe("429/R28 — el aviso se monta como HERMANO del contenido, jamas envolviendolo", () => {
  it("el layout del portal sigue existiendo donde esta guardia lo busca", () => {
    // Si alguien mueve el layout, esta guardia dejaria de mirar nada sin decirlo.
    expect(fs.existsSync(path.join(RAIZ_DEL_REPO, LAYOUT))).toBe(true);
  });

  it("⭑ el layout NO envuelve `{children}` con el aviso (y hoy todavia no lo monta)", () => {
    // ⚠️ CONDICIONAL A PROPOSITO. El montaje llega en T19/T22, despues de la puerta de `/design`.
    // Mientras no exista, esto afirma que no existe; en cuanto exista, afirma que es HERMANO.
    const fuente = leer(LAYOUT);
    if (!fuente.includes(COMPONENTE)) {
      expect(fuente).not.toContain(COMPONENTE);
      return;
    }
    // La forma prohibida: `<RevisionSinpeBodega …> … {children} … </RevisionSinpeBodega>`. Un
    // envoltorio PUEDE dejar de pintar el contenido con un `return null`; un hermano no tiene donde.
    const envuelve = new RegExp(`<${COMPONENTE}[^/>]*>[\\s\\S]*\\{children\\}`);
    expect(envuelve.test(fuente), "el aviso envuelve {children}: R28 deja de ser estructural").toBe(
      false,
    );
    // Y se monta al lado de `PushReactivacion`, que es el precedente literal de un hermano que no
    // pinta nada y no estorba a nadie.
    expect(fuente).toContain("PushReactivacion");
  });

  it("⭑ el layout no redirige por la revision", () => {
    const fuente = leer(LAYOUT);
    if (!REVISION.test(fuente)) return; // todavia no la lee: nada que comprobar
    for (const patron of BLOQUEOS) {
      expect(patron.test(fuente), `${patron}`).toBe(false);
    }
  });
});
