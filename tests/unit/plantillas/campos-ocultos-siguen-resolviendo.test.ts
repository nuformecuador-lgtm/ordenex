// Feature 288 — pedido humano 2026-08-27: 27 campos dejan de OFRECERSE en el selector.
//
// ESTE ARCHIVO EXISTE PARA IMPEDIR UNA "SIMPLIFICACION" CONCRETA: que alguien lea
// «retiramos 27 campos» y los borre de `CAMPOS_PLANTILLA`. Si eso pasa:
//   - `CAMPOS_PLANTILLA_POR_CLAVE` los pierde y `valorDeCampo` devuelve "",
//   - toda plantilla YA APROBADA POR META que use `{{provincia}}` llega VACIA al cliente,
//   - y `clavesSinCampo` empieza a acusarlas de «retiradas del catalogo» (R16), que es
//     justo la etiqueta reservada para el caso contrario.
//
// Ocultar es una decision de UI. Resolver es una promesa hacia mensajes ya enviados. No son
// lo mismo y este test es la linea que las separa: cada `it` de aqui cae si un campo oculto
// desaparece del catalogo.
import { describe, it, expect } from "vitest";

import {
  CAMPOS_PLANTILLA,
  CAMPOS_PLANTILLA_POR_CLAVE,
  CAMPOS_PLANTILLA_OFRECIDOS,
  CLAVES_OCULTAS_EN_SELECTOR,
  DATOS_PLANTILLA_EJEMPLO,
  valorDeCampo,
} from "@/lib/types/plantilla-datos";
import { clavesSinCampo, previewConEjemplos } from "@/lib/utils/plantilla-mensaje";

/** Borradas del catalogo el 2026-08-27 (ninguna plantilla viva las usaba). */
const BORRADAS = ["telefono", "direccion", "direccion_completa"] as const;

const OCULTAS = [...CLAVES_OCULTAS_EN_SELECTOR];

describe("los campos ocultos del selector SIGUEN siendo campos de pleno derecho", () => {
  it("las 27 claves ocultas siguen existiendo en CAMPOS_PLANTILLA_POR_CLAVE", () => {
    expect(OCULTAS).toHaveLength(27);
    const ausentes = OCULTAS.filter((clave) => !CAMPOS_PLANTILLA_POR_CLAVE.has(clave));
    expect(ausentes).toEqual([]);
  });

  it.each(OCULTAS)("%s: resuelve a su valor de ejemplo, no a vacío", (clave) => {
    const campo = CAMPOS_PLANTILLA_POR_CLAVE.get(clave);
    expect(campo).toBeDefined();
    // Mismo contrato que el resto del catálogo (R12): el valor resuelto ES su `ejemplo`.
    expect(valorDeCampo(clave, DATOS_PLANTILLA_EJEMPLO)).toBe(campo?.ejemplo);
  });

  it.each(OCULTAS)("%s: la vista previa la sustituye de verdad", (clave) => {
    const campo = CAMPOS_PLANTILLA_POR_CLAVE.get(clave);
    const texto = previewConEjemplos(`Valor: {{${clave}}}`);
    expect(texto).toBe(`Valor: ${campo?.ejemplo}`);
    // Y desde luego no deja el placeholder crudo ni el marcador en MAYÚSCULAS.
    expect(texto).not.toContain("{{");
    expect(texto).not.toContain(clave.toUpperCase());
  });

  it.each(OCULTAS)("%s: clavesSinCampo NO la marca como inválida ni retirada", (clave) => {
    expect(clavesSinCampo(`Hola {{${clave}}}`, {})).toEqual([]);
    // Ni siquiera con un nombre persistido, que es lo que dispara el «ya no existe» de R16.
    expect(clavesSinCampo(`Hola {{${clave}}}`, { [clave]: "Etiqueta vieja" })).toEqual([]);
  });

  it("caso testigo con {{provincia}}: resuelve, no avisa y sigue en el catálogo", () => {
    const provincia = CAMPOS_PLANTILLA_POR_CLAVE.get("provincia");
    expect(provincia).toBeDefined();
    expect(previewConEjemplos("Envío a {{provincia}}")).toBe(
      `Envío a ${provincia?.ejemplo}`,
    );
    expect(clavesSinCampo("Envío a {{provincia}}", {})).toEqual([]);
  });

  it("ocultar es SOLO un eje de presentación: no saca a nadie del catálogo", () => {
    // El catálogo sigue conteniendo ofrecidos + ocultos + alias, sin pérdidas.
    for (const clave of OCULTAS) {
      const campo = CAMPOS_PLANTILLA.find((c) => c.clave === clave);
      expect(campo?.ocultoEnSelector).toBe(true);
      expect(typeof campo?.leer).toBe("function");
      expect(typeof campo?.transform).toBe("function");
    }
    // Y ningún campo ofrecido está marcado como oculto (el filtro no se contradice).
    for (const campo of CAMPOS_PLANTILLA_OFRECIDOS) {
      expect(campo.ocultoEnSelector).not.toBe(true);
      expect(CLAVES_OCULTAS_EN_SELECTOR.has(campo.clave)).toBe(false);
    }
  });
});


// ---------------------------------------------------------------------------------------
// El CONTRASTE. Estos tres SI se borraron del catalogo, y por eso se comportan al reves que
// los 27 de arriba. Los dos bloques juntos son la documentacion ejecutable de la diferencia
// entre OCULTAR (sigue resolviendo) y BORRAR (deja de existir), que es la decision de fondo
// de esta feature.
// ---------------------------------------------------------------------------------------
describe("los campos BORRADOS del catálogo dejan de existir, y se nota", () => {
  it.each(BORRADAS)("%s: ya no está en el catálogo", (clave) => {
    expect(CAMPOS_PLANTILLA_POR_CLAVE.get(clave)).toBeUndefined();
    expect(CAMPOS_PLANTILLA.some((c) => c.clave === clave)).toBe(false);
  });

  it.each(BORRADAS)("%s: NO está entre las ocultas (se borró, no se ocultó)", (clave) => {
    expect(CLAVES_OCULTAS_EN_SELECTOR.has(clave)).toBe(false);
  });

  it.each(BORRADAS)("%s: ahora resuelve VACÍO en la vista previa", (clave) => {
    expect(previewConEjemplos(`Valor: {{${clave}}}`)).toBe("Valor: ");
  });

  it.each(BORRADAS)("%s: ahora clavesSinCampo SÍ la denuncia como inválida", (clave) => {
    expect(clavesSinCampo(`Hola {{${clave}}}`, {})).toEqual([
      { clave, etiqueta: clave, retirada: false },
    ]);
  });

  it("{{telefono}} frente a {{provincia}}: borrada avisa, oculta no", () => {
    // Borrada: hueco vacío y aviso.
    expect(previewConEjemplos("Tel {{telefono}}")).toBe("Tel ");
    expect(clavesSinCampo("Tel {{telefono}}", {})).toHaveLength(1);

    // Oculta: resuelve y calla. Misma UI, comportamientos deliberadamente opuestos.
    const provincia = CAMPOS_PLANTILLA_POR_CLAVE.get("provincia");
    expect(previewConEjemplos("Prov {{provincia}}")).toBe(`Prov ${provincia?.ejemplo}`);
    expect(clavesSinCampo("Prov {{provincia}}", {})).toEqual([]);
  });

  it("ningún alias quedó apuntando a un campo inexistente", () => {
    const huerfanos = CAMPOS_PLANTILLA.filter(
      (c) => c.aliasDe !== undefined && !CAMPOS_PLANTILLA_POR_CLAVE.has(c.aliasDe),
    ).map((c) => `${c.clave} -> ${c.aliasDe}`);
    expect(huerfanos).toEqual([]);
  });
});
