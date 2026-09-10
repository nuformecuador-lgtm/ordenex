import { describe, it, expect } from "vitest";
import { codigoSinComentarios } from "@/tests/fixtures/sin-comentarios";

import {
  mensajeAsignadasSinUbicacion,
  mensajeAsignadasSinUbicacionAutorizada,
} from "@/app/(app)/_components/geocodificacion-motivo-messages";

/**
 * FICHA 407 (T9, R12) — GUARDIA: EL AVISO DE LA AUTORIZACIÓN NO PUEDE DECIR LO QUE DICE EL DE
 * LA FEATURE 400.
 *
 * ## Qué vigila, y por qué no basta un test de comportamiento
 *
 * La 400 abrió un aviso para las órdenes que se asignan sin ubicación por un fallo NUESTRO:
 * «…por un problema del sistema, **no de la dirección**. Se ubicará más tarde.» Ese texto es
 * correcto allí y es FALSO aquí: en esta ficha la dirección **sí** es el problema —el mapa no
 * la reconoce— y una persona decidió asignar igual, a sabiendas.
 *
 * Reutilizar aquel literal, o aliasar una función con la otra, no rompería ningún test de
 * comportamiento: los dos mensajes son cadenas válidas, los dos salen por el mismo hueco del
 * bloque de confirmación y la suite seguiría verde. Lo único que cambiaría es que el operador
 * leería que su dirección está bien cuando no lo está, y saldría a corregir lo que no toca —que
 * es literalmente lo que pasó el 2026-09-08 con 42 direcciones perfectamente correctas.
 *
 * Por eso esto se vigila **leyendo el árbol real** además de la salida: lo que se protege es que
 * un texto retirado **no vuelva**, y una ausencia no se observa ejecutando nada. Con el spec
 * adelgazado (sin tabla, sin rastro, sin actor) este guardia es lo único que queda cuidando la
 * honestidad del aviso.
 *
 * ## Las dos mitades
 *
 * 1. **Sobre el árbol** (`codigoSinComentarios`, el quitador único del repo): el cuerpo de
 *    `mensajeAsignadasSinUbicacionAutorizada` no contiene las frases de la 400. Se lee sin
 *    comentarios a propósito: la cabecera de esa función NOMBRA la frase prohibida para explicar
 *    por qué lo está, y un barrido sobre el texto crudo denunciaría la explicación y obligaría a
 *    borrarla.
 * 2. **Sobre la salida**: para el mismo `n`, los dos avisos son distintos. Es la mitad que caza
 *    el alias (`export const mensajeAsignadasSinUbicacionAutorizada = mensajeAsignadasSinUbicacion`),
 *    que el barrido de texto no vería porque ahí no hay ningún literal que denunciar.
 */

const RUTA_MENSAJES = "app/(app)/_components/geocodificacion-motivo-messages.ts";

/** Las frases de la 400 que aquí serían falsas. Escritas a mano, copiadas del módulo vigente. */
const FRASES_DE_LA_400 = [
  "por un problema del sistema, no de la dirección",
  "problema del sistema",
  "no de la dirección",
  "Se ubicará más tarde",
  "Se ubicarán más tarde",
] as const;

/**
 * El cuerpo de una función `export function <nombre>(…) { … }` del fuente ya sin comentarios,
 * desde la firma hasta la primera `}` a comienzo de línea. Es un recorte deliberadamente tonto:
 * el archivo declara sus funciones al margen izquierdo, así que no hace falta un parser, y una
 * heurística que fallara devolvería `null` en vez de un recorte silenciosamente corto.
 */
function cuerpoDeFuncion(codigo: string, nombre: string): string | null {
  const inicio = codigo.indexOf(`export function ${nombre}(`);
  if (inicio === -1) return null;
  const fin = codigo.indexOf("\n}", inicio);
  if (fin === -1) return null;
  return codigo.slice(inicio, fin + 2);
}

describe("407/T9 — el aviso de la autorización no reutiliza el texto de la feature 400", () => {
  it("no-vacuidad: el guardia encuentra las DOS funciones en el árbol real", () => {
    // Sin esto, cualquier renombrado dejaría los recortes en `null` y todas las aserciones de
    // abajo pasarían por vacío — el modo de fallo que un guardia jamás puede tener.
    const codigo = codigoSinComentarios(RUTA_MENSAJES);
    expect(cuerpoDeFuncion(codigo, "mensajeAsignadasSinUbicacion")).not.toBeNull();
    expect(cuerpoDeFuncion(codigo, "mensajeAsignadasSinUbicacionAutorizada")).not.toBeNull();
  });

  it("no-vacuidad: y el recorte de la 400 SÍ contiene la frase prohibida (el detector ve algo)", () => {
    // Si el recorte estuviera vacío o midiera otra cosa, esta aserción se caería. Es la prueba
    // de que la de más abajo —la negativa— no pasa por comparar contra la nada.
    const cuerpo400 = cuerpoDeFuncion(
      codigoSinComentarios(RUTA_MENSAJES),
      "mensajeAsignadasSinUbicacion",
    )!;
    expect(cuerpo400).toContain("por un problema del sistema, no de la dirección");
    expect(cuerpo400).toContain("Se ubicará más tarde");
  });

  it.each(FRASES_DE_LA_400)(
    "R12: el cuerpo del aviso de la 407 NO contiene «%s»",
    (frase) => {
      const cuerpo407 = cuerpoDeFuncion(
        codigoSinComentarios(RUTA_MENSAJES),
        "mensajeAsignadasSinUbicacionAutorizada",
      )!;
      expect(cuerpo407).not.toContain(frase);
    },
  );

  it("R12: el recorte de la 407 no se solapa con el de la 400 (no es el mismo trozo leído dos veces)", () => {
    const codigo = codigoSinComentarios(RUTA_MENSAJES);
    const cuerpo400 = cuerpoDeFuncion(codigo, "mensajeAsignadasSinUbicacion")!;
    const cuerpo407 = cuerpoDeFuncion(codigo, "mensajeAsignadasSinUbicacionAutorizada")!;
    expect(cuerpo407).not.toBe(cuerpo400);
    expect(cuerpo400).not.toContain("porque se autorizó hacerlo");
    expect(cuerpo407).toContain("porque se autorizó hacerlo");
  });

  it.each([1, 2, 7, 42])(
    "R12: con n=%i los dos avisos agregados son DISTINTOS — esto es lo que caza el alias",
    (n) => {
      const deLa400 = mensajeAsignadasSinUbicacion(n);
      const deLa407 = mensajeAsignadasSinUbicacionAutorizada(n);
      // No-vacuidad: dos cadenas vacías también serían «distintas de nada».
      expect(deLa400).not.toBe("");
      expect(deLa407).not.toBe("");
      expect(deLa407).not.toBe(deLa400);
    },
  );

  it("R12: y el de la 407 no contiene ninguna de las frases de la 400 tampoco en su SALIDA", () => {
    for (const n of [1, 2, 42]) {
      const mensaje = mensajeAsignadasSinUbicacionAutorizada(n);
      for (const frase of FRASES_DE_LA_400) {
        expect(mensaje, `n=${n}, frase=${frase}`).not.toContain(frase);
      }
    }
  });

  it("CONTRAPRUEBA: el detector caza un alias — la función que devuelve lo mismo que la de la 400", () => {
    // La mutación concreta que T9 nombra:
    //   export const mensajeAsignadasSinUbicacionAutorizada = mensajeAsignadasSinUbicacion;
    // El barrido de texto no la vería (no hay literal que denunciar); la comparación de salidas,
    // sí. Aquí se simula el alias y se comprueba que la regla lo declara rojo.
    const alias = mensajeAsignadasSinUbicacion;
    const distintos = [1, 2, 42].every(
      (n) => alias(n) !== mensajeAsignadasSinUbicacion(n),
    );
    expect(distintos).toBe(false);

    // Y la regla vigente, con la función real, sí los declara distintos.
    expect(
      [1, 2, 42].every(
        (n) =>
          mensajeAsignadasSinUbicacionAutorizada(n) !== mensajeAsignadasSinUbicacion(n),
      ),
    ).toBe(true);
  });

  it("CONTRAPRUEBA: el barrido de texto caza una copia del literal de la 400 dentro del cuerpo de la 407", () => {
    const cuerpoCopiado = [
      "export function mensajeAsignadasSinUbicacionAutorizada(n: number): string {",
      '  return "1 orden se asignó sin ubicación en el mapa por un problema del sistema, no de la dirección. Se ubicará más tarde.";',
      "}",
    ].join("\n");

    const cazadas = FRASES_DE_LA_400.filter((frase) =>
      cuerpoDeFuncion(cuerpoCopiado, "mensajeAsignadasSinUbicacionAutorizada")!.includes(
        frase,
      ),
    );
    expect(cazadas).toEqual([
      "por un problema del sistema, no de la dirección",
      "problema del sistema",
      "no de la dirección",
      "Se ubicará más tarde",
    ]);
  });

  it("CONTRAPRUEBA: `cuerpoDeFuncion` devuelve null si la función no está, en vez de un recorte vacío", () => {
    expect(cuerpoDeFuncion("const x = 1;\n", "mensajeAsignadasSinUbicacionAutorizada")).toBeNull();
  });
});

/**
 * FICHA 407 (T9, R13/R15) — el literal de la consecuencia, leído del ÁRBOL.
 *
 * El test de comportamiento (`geocodificacion-motivo-messages.test.ts`) ya compara la constante
 * contra el literal escrito a mano. Esto cierra la otra mitad: que el módulo no gane una segunda
 * copia del texto por la que pudiera divergir, y que el literal aprobado esté en el árbol tal
 * cual — sin interpolaciones que le metan datos de una orden (R15).
 */
describe("407/T9 — el literal de consecuencia está en el árbol, una sola vez y sin interpolar nada", () => {
  const LITERAL_CONSECUENCIA =
    "El mapa no reconoce esta dirección, así que la orden no tiene un punto en el mapa. Si autorizas, se podrá asignar a un mensajero: aparecerá al final de su lista de entregas y no se tendrá en cuenta al calcular el orden del recorrido. Autoriza solo si el mensajero puede llegar con las indicaciones de la dirección.";

  it("aparece EXACTAMENTE una vez en el código del módulo", () => {
    const codigo = codigoSinComentarios(RUTA_MENSAJES);
    const veces = codigo.split(LITERAL_CONSECUENCIA).length - 1;
    expect(veces).toBe(1);
  });

  it("R15: es una constante de cadena, no una plantilla con `${…}` que pudiera meter datos", () => {
    const codigo = codigoSinComentarios(RUTA_MENSAJES);
    const declaracion = codigo.match(
      /export const MSG_CONSECUENCIA_AUTORIZAR_SIN_UBICACION\s*=\s*([\s\S]*?);/,
    );
    // No-vacuidad: sin la declaración, las dos aserciones de abajo pasarían por vacío.
    expect(declaracion).not.toBeNull();
    expect(declaracion![1]).not.toContain("${");
    expect(declaracion![1]).not.toContain("`");
  });
});
