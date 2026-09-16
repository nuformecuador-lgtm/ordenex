import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { RAIZ_DEL_REPO, archivosDeCodigoCensados } from "../../fixtures/raices-de-codigo";
import { codigoSinComentarios } from "../../fixtures/sin-comentarios";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 429 / T16-G2 (R14) — UNA SUPERFICIE QUE PINTA PLANTILLAS SIN SINPE NO PUEDE EXISTIR.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠️ LA DEFENSA PRINCIPAL DE R14 NO ES ESTA GUARDIA: ES EL COMPILADOR. `MiAsignacionDTO` declara
// `sinpeNumero`/`sinpeNombre` REQUERIDOS, y `negocioConSinpe` recibe el par por PARAMETRO
// OBLIGATORIO Y SIN DEFAULT. Un productor que se los olvide no compila, y eso no depende de que
// nadie se acuerde de nada. La contraprueba de esa mitad se corre con `pnpm run typecheck` sobre un
// arbol mutado (volver `sinpeNumero` opcional) y su salida roja va pegada en `progress/impl_429.md`.
//
// LO QUE ESTA GUARDIA AÑADE es lo que el compilador NO puede ver:
//   1. que `negocioDesdeEnv()` —la funcion que devolvia `""` cuando faltaba la configuracion— NO
//      HA VUELTO. Podria volver perfectamente tipada, y volveria a producir mensajes mudos;
//   2. que NADIE construye el bloque `negocio` a mano con un objeto literal. Un
//      `negocio: { sinpeNumero: "", sinpeNombre: "", urlBase: "" }` COMPILA —los tres campos son
//      `string`— y produce exactamente el mensaje sin numero que esta ficha existe para evitar. El
//      unico sitio que puede armar ese objeto es `negocioConSinpe`;
//   3. que los dos campos del DTO siguen SIN `?`. Volverlos opcionales es un caracter, apaga el
//      compilador entero y no rompe ningun test — el arreglo de un fixture roto que parece inocuo.

const DTO_ASIGNACION = "lib/interfaces/services/IMisAsignacionesService.ts";
const ADAPTADORES = "lib/utils/whatsapp-envio-valores.ts";

/**
 * Los sitios que PUEDEN nombrar el bloque `negocio` en un objeto literal, con su motivo.
 * ⚠️ Por ruta completa, no por `basename`.
 */
const PUEDEN_ARMAR_NEGOCIO = new Map<string, string>([
  [
    ADAPTADORES,
    "Aqui vive `negocioConSinpe`, que es EL constructor del bloque. Recibe el par por parametro " +
      "obligatorio y sin default, asi que no puede producir un bloque vacio.",
  ],
  [
    "lib/types/plantilla-datos.ts",
    "Declara el TIPO `DatosPlantilla` y el fixture `DATOS_PLANTILLA_EJEMPLO` de la vista previa " +
      "del editor de plantillas, que pinta valores de muestra y no sale por WhatsApp.",
  ],
]);

/** `codigoSinComentarios` recibe la RUTA RELATIVA, no el contenido: lee el archivo por su cuenta. */
function leerSinComentarios(rel: string): string {
  return codigoSinComentarios(rel);
}

describe("429/R14 — `negocioDesdeEnv` no vuelve", () => {
  it("⭑ la cadena `negocioDesdeEnv` no aparece en ningun archivo censado", () => {
    // Devolvia `""` cuando faltaba la configuracion. Un llamador nuevo que se olvidara obtenia un
    // mensaje mudo y nadie se enteraba: un SINPE ausente no produce ningun error.
    // ⚠️ SIN COMENTARIOS. El comentario de `whatsapp-envio-valores.ts` NOMBRA a proposito la
    // funcion retirada para explicar por que desaparecio; un barrido sobre el texto crudo
    // denunciaria esa EXPLICACION y obligaria a borrarla para pasar la guardia. Es la leccion
    // escrita en `tests/fixtures/sin-comentarios.ts`.
    const infractores = archivosDeCodigoCensados().filter((rel) =>
      leerSinComentarios(rel).includes("negocioDesdeEnv"),
    );
    expect(infractores).toEqual([]);
  });

  it("⭑ CONTRAPRUEBA — el mismo detector encuentra `negocioConSinpe`, que SI existe", () => {
    // Sin esto, el caso de arriba podria estar verde porque el censo no lee nada.
    const conLaQueExiste = archivosDeCodigoCensados().filter((rel) =>
      leerSinComentarios(rel).includes("negocioConSinpe"),
    );
    expect(conLaQueExiste.length).toBeGreaterThan(1);
    expect(conLaQueExiste).toContain(ADAPTADORES);
  });
});

describe("429/R14 — el bloque `negocio` solo lo arma `negocioConSinpe`", () => {
  it("⭑ nadie fuera de los sitios declarados escribe `sinpeNumero:` en un objeto literal", () => {
    // ⚠️ ESTE ES EL AGUJERO QUE EL COMPILADOR NO TAPA. `negocio: { sinpeNumero: "", … }` compila
    // perfectamente y produce el mensaje sin numero.
    const infractores = archivosDeCodigoCensados().filter((rel) => {
      if (PUEDEN_ARMAR_NEGOCIO.has(rel)) return false;
      return /sinpeNumero\s*:\s*["'`]/.test(leerSinComentarios(rel));
    });
    expect(infractores).toEqual([]);
  });

  it("⭑ `negocioConSinpe` NO tiene default ni valor de respaldo para el par", () => {
    // Un `sinpe = { numero: "", nombre: "" }` en la firma devolveria el agujero entero, y con un
    // tipo perfectamente valido.
    const fuente = leerSinComentarios(ADAPTADORES);
    expect(fuente).toMatch(/export function negocioConSinpe\(sinpe: SinpeBodega\)/);
    // Ni un `||`/`??` sobre los dos campos: la «red de seguridad» que el design descarto por
    // escrito, porque con las columnas NOT NULL no puede dispararse nunca y solo sirve para tapar
    // un fallo distinto con un numero plausible.
    expect(fuente).not.toMatch(/sinpe\.numero\s*(\?\?|\|\|)/);
    expect(fuente).not.toMatch(/sinpe\.nombre\s*(\?\?|\|\|)/);
  });

  it("⭑ el adaptador del dispositivo lee el par DEL DTO, no del entorno (R18)", () => {
    // En modo `wa.me` el texto que compone el navegador ES el que recibe el cliente. El valor tiene
    // que venir resuelto por el servidor, igual que en el envio real.
    const fuente = leerSinComentarios(ADAPTADORES);
    expect(fuente).toMatch(/negocioConSinpe\(\{\s*numero:\s*orden\.sinpeNumero/);
    expect(fuente).not.toMatch(/process\.env\.[A-Z_]*SINPE/);
  });
});

describe("429/R14 — los campos del DTO siguen siendo REQUERIDOS", () => {
  it("⭑ `MiAsignacionDTO` declara `sinpeNumero: string` y `sinpeNombre: string`, sin `?`", () => {
    // Volverlos opcionales es UN CARACTER, apaga el compilador —que es la defensa principal— y no
    // rompe ningun test. Por eso esta escrito aqui.
    const fuente = leerSinComentarios(DTO_ASIGNACION);
    expect(fuente).toMatch(/\n\s*sinpeNumero: string;/);
    expect(fuente).toMatch(/\n\s*sinpeNombre: string;/);
    expect(fuente).not.toMatch(/sinpeNumero\?/);
    expect(fuente).not.toMatch(/sinpeNombre\?/);
  });

  it("⭑ y sus dos herederos NO los vuelven opcionales al redeclararlos", () => {
    // `NovedadDTO` y `RecoleccionOrdenDTO` extienden `MiAsignacionDTO`. Redeclarar un campo
    // heredado como opcional no compila, pero SI compila declararlo en el ROW que los alimenta.
    for (const rel of ["lib/types/novedad.ts", "lib/types/recoleccion-tienda.ts"]) {
      const fuente = leerSinComentarios(rel);
      expect(fuente, rel).not.toMatch(/sinpeNumero\?/);
      expect(fuente, rel).not.toMatch(/sinpeNombre\?/);
    }
  });

  it("⭑ las dos FILAS que alimentan esos DTO tampoco los declaran opcionales", () => {
    // `MiAsignacionRow` y `NovedadOrdenRow`. Un `?` aqui haria que un doble de test que se los
    // olvide emitiera `undefined` en silencio, y el DTO acabaria con el campo en `undefined`
    // atravesando un `string`.
    for (const rel of [
      "lib/interfaces/repositories/IGestionOrdenRepository.ts",
      "lib/interfaces/repositories/IOrdenRepository.ts",
    ]) {
      const fuente = leerSinComentarios(rel);
      expect(fuente, rel).toMatch(/\n\s*sinpeNumero: string;/);
      expect(fuente, rel).not.toMatch(/sinpeNumero\?/);
      expect(fuente, rel).not.toMatch(/sinpeNombre\?/);
    }
  });

  it("cada excepcion declarada EXISTE y trae su motivo escrito", () => {
    for (const [rel, motivo] of PUEDEN_ARMAR_NEGOCIO) {
      expect(fs.existsSync(path.join(RAIZ_DEL_REPO, rel)), rel).toBe(true);
      expect(motivo.trim().length, rel).toBeGreaterThan(80);
    }
  });
});
