import { describe, it, expect } from "vitest";

import {
  geocodificacionMotivoMessage,
  mensajeAsignadasSinUbicacion,
  mensajeDireccionPorMotivo,
  MOTIVOS_BLOQUEANTES,
  MSG_DIRECCION_NO_ENCONTRADA,
  MSG_DIRECCION_EN_VALIDACION,
  MSG_UBICACION_NO_VERIFICADA,
} from "@/app/(app)/_components/geocodificacion-motivo-messages";

// Feature 368 (T2, R11) — `mensajeDireccionPorMotivo` traduce UN motivo del gate de
// asignabilidad por coordenadas (feature 92) a su mensaje, sin agregar: es el mensaje
// POR ORDEN que necesita el éxito parcial, a diferencia de `geocodificacionMotivoMessage`
// (que agrega TODOS los motivos de un lote en un único mensaje "ganador").
//
// Feature 400 (T15) — los mensajes pasan de DOS a TRES: `geocodificacion_agotada` deja de
// compartir «Dirección no encontrada» con `direccion_no_geocodificable` (R19). Todos los
// literales de este archivo están ESCRITOS A MANO: comparar un texto contra la constante
// que lo genera deja el test verde para siempre.

/** Los tres literales, tal cual los ve el operador. Copiados a mano de design.md §6.2. */
const LITERAL_NO_ENCONTRADA = "Dirección no encontrada";
const LITERAL_UBICACION_NO_VERIFICADA =
  "No se pudo verificar la ubicación por un fallo del servicio de mapas. La dirección no es el problema; vuelve a intentarlo más tarde.";
const LITERAL_EN_VALIDACION =
  "La dirección aún se está validando. Vuelve a intentarlo en unos minutos.";

function conflict(...motivos: string[]) {
  return {
    status: "conflict",
    detalle: motivos.map((motivo, i) => ({ ordenId: `o${i + 1}`, motivo })),
  };
}

describe("mensajeDireccionPorMotivo (368/R11) — mensaje de UN motivo, sin agregar", () => {
  it("400/R20: `direccion_no_geocodificable` sigue siendo EXACTAMENTE «Dirección no encontrada»", () => {
    expect(mensajeDireccionPorMotivo("direccion_no_geocodificable")).toBe(
      LITERAL_NO_ENCONTRADA,
    );
    // Y la constante exportada es ese mismo literal: es el contrato de la 93, no un polizón.
    expect(MSG_DIRECCION_NO_ENCONTRADA).toBe(LITERAL_NO_ENCONTRADA);
  });

  it("400/R19: `geocodificacion_agotada` YA NO dice «Dirección no encontrada» — el mensaje que mintió el 2026-09-08", () => {
    const mensaje = mensajeDireccionPorMotivo("geocodificacion_agotada");

    // La mitad negativa es el requisito literal de R19: el operador NO debe salir de aquí
    // creyendo que la dirección está mal (se pasó una mañana corrigiendo 42 que estaban bien).
    expect(mensaje).not.toBe(LITERAL_NO_ENCONTRADA);
    expect(mensaje).toBe(LITERAL_UBICACION_NO_VERIFICADA);
    expect(MSG_UBICACION_NO_VERIFICADA).toBe(LITERAL_UBICACION_NO_VERIFICADA);
  });

  it("400/R19: el mensaje nuevo NO pide corregir la dirección — dice que el problema es del servicio", () => {
    const mensaje = mensajeDireccionPorMotivo("geocodificacion_agotada")!;
    expect(mensaje).toMatch(/servicio de mapas/i);
    expect(mensaje).toMatch(/la dirección no es el problema/i);
    // Ni «corrige», ni «revisa la dirección», ni «no encontrada».
    expect(mensaje).not.toMatch(/corrig/i);
    expect(mensaje).not.toMatch(/no encontrada/i);
  });

  it.each([
    ["geocodificacion_en_curso", LITERAL_EN_VALIDACION],
    ["geocodificacion_encolada", LITERAL_EN_VALIDACION],
    ["geocodificacion_no_encolable", LITERAL_EN_VALIDACION],
  ])("400/R21: el motivo transitorio %s conserva su mensaje vigente, sin cambios", (motivo, esperado) => {
    expect(mensajeDireccionPorMotivo(motivo)).toBe(esperado);
    expect(MSG_DIRECCION_EN_VALIDACION).toBe(LITERAL_EN_VALIDACION);
  });

  it.each(["zona_ajena", "estado_invalido: en_reparto", "motivo_que_nadie_mapea"])(
    "motivo NO reconocido del gate (%s) -> null",
    (motivo) => {
      expect(mensajeDireccionPorMotivo(motivo)).toBeNull();
    },
  );

  it("400/R10: `asignable_sin_ubicacion` no tiene mensaje: no es un motivo de bloqueo", () => {
    // No entra en el mapa POR CONSTRUCCIÓN del tipo (`Record<EstadoBloqueante, string>`),
    // pero se afirma también en runtime: si algún día alguien le diera texto, el estado
    // habría dejado de dejar pasar la asignación y esta ficha estaría deshecha.
    expect(mensajeDireccionPorMotivo("asignable_sin_ubicacion")).toBeNull();
    expect(MOTIVOS_BLOQUEANTES).not.toContain("asignable_sin_ubicacion");
    expect(MOTIVOS_BLOQUEANTES).not.toContain("asignable");
  });
});

// Feature 400 (T15, R25) — la lista de estados BLOQUEANTES vive en un sitio y el mapa la
// cubre exactamente. La lista de abajo está escrita a mano: si el mapa gana o pierde una
// clave, esta comparación se pone roja en vez de seguirle la corriente.
describe("400/R25 — las claves del mapa son EXACTAMENTE los estados bloqueantes", () => {
  it("las cinco claves, escritas a mano y en su orden de declaración", () => {
    expect([...MOTIVOS_BLOQUEANTES]).toEqual([
      "direccion_no_geocodificable",
      "geocodificacion_agotada",
      "geocodificacion_en_curso",
      "geocodificacion_encolada",
      "geocodificacion_no_encolable",
    ]);
  });

  it("cada motivo bloqueante tiene mensaje, y ninguno cae al `null` defensivo", () => {
    for (const motivo of MOTIVOS_BLOQUEANTES) {
      expect(mensajeDireccionPorMotivo(motivo), motivo).not.toBeNull();
    }
  });

  it("los cinco motivos se reparten en exactamente TRES mensajes (eran dos antes de la 400)", () => {
    const mensajes = new Set(
      MOTIVOS_BLOQUEANTES.map((m) => mensajeDireccionPorMotivo(m)),
    );
    expect(mensajes.size).toBe(3);
  });
});

// Feature 400 (T15, R24) — ningún mensaje del mapa lleva datos: son literales fijos.
describe("400/R24 — los mensajes del mapa no arrastran PII", () => {
  const DIRECCION_DE_PRUEBA = "Av. Central 123, San José";
  const ID_DE_PRUEBA = "9f0b0a3c-0000-4000-8000-000000000001";

  it.each([
    "direccion_no_geocodificable",
    "geocodificacion_agotada",
    "geocodificacion_en_curso",
    "geocodificacion_encolada",
    "geocodificacion_no_encolable",
  ])("el mensaje de %s no tiene dígitos, ni `@`, ni la dirección o el id de prueba", (motivo) => {
    const mensaje = mensajeDireccionPorMotivo(motivo)!;
    expect(mensaje).not.toMatch(/\d/);
    expect(mensaje).not.toContain("@");
    expect(mensaje).not.toContain(DIRECCION_DE_PRUEBA);
    expect(mensaje).not.toContain(ID_DE_PRUEBA);
  });
});

// Feature 400 (T14, R22) — el mensaje AGREGADO de un lote con motivos de varias clases.
// Precedencia: irresoluble > fallo del servicio de mapas > en validación. Gana el que
// exige una acción del operador sobre el dato.
describe("400/R22 — precedencia de las TRES clases en el mensaje agregado", () => {
  it.each([
    ["direccion_no_geocodificable", LITERAL_NO_ENCONTRADA],
    ["geocodificacion_agotada", LITERAL_UBICACION_NO_VERIFICADA],
    ["geocodificacion_en_curso", LITERAL_EN_VALIDACION],
    ["geocodificacion_encolada", LITERAL_EN_VALIDACION],
    ["geocodificacion_no_encolable", LITERAL_EN_VALIDACION],
  ])("un solo motivo (%s) devuelve su propio mensaje", (motivo, esperado) => {
    expect(geocodificacionMotivoMessage(conflict(motivo))).toBe(esperado);
  });

  it("irresoluble + fallo del servicio -> gana IRRESOLUBLE (hay una dirección que arreglar)", () => {
    expect(
      geocodificacionMotivoMessage(
        conflict("geocodificacion_agotada", "direccion_no_geocodificable"),
      ),
    ).toBe(LITERAL_NO_ENCONTRADA);
    // Y con el orden de llegada invertido, el mismo veredicto: la precedencia es por clase,
    // no por quién apareció primero en el `detalle`.
    expect(
      geocodificacionMotivoMessage(
        conflict("direccion_no_geocodificable", "geocodificacion_agotada"),
      ),
    ).toBe(LITERAL_NO_ENCONTRADA);
  });

  it("irresoluble + en validación -> gana IRRESOLUBLE (comportamiento vigente desde la 93)", () => {
    expect(
      geocodificacionMotivoMessage(
        conflict("geocodificacion_encolada", "direccion_no_geocodificable"),
      ),
    ).toBe(LITERAL_NO_ENCONTRADA);
  });

  it("fallo del servicio + en validación -> gana el FALLO DEL SERVICIO, no «Dirección no encontrada»", () => {
    const mensaje = geocodificacionMotivoMessage(
      conflict("geocodificacion_en_curso", "geocodificacion_agotada"),
    );
    expect(mensaje).toBe(LITERAL_UBICACION_NO_VERIFICADA);
    // Antes de la 400 este lote decía «Dirección no encontrada» sin que ninguna dirección
    // estuviera mal: es exactamente el caso del incidente del 2026-09-08.
    expect(mensaje).not.toBe(LITERAL_NO_ENCONTRADA);
  });

  it("las TRES clases juntas -> gana IRRESOLUBLE", () => {
    expect(
      geocodificacionMotivoMessage(
        conflict(
          "geocodificacion_no_encolable",
          "geocodificacion_agotada",
          "direccion_no_geocodificable",
        ),
      ),
    ).toBe(LITERAL_NO_ENCONTRADA);
  });

  it("sin ningún motivo del gate sigue devolviendo null", () => {
    expect(geocodificacionMotivoMessage(conflict("zona_ajena"))).toBeNull();
  });

  it("entradas defensivas (null, sin detalle, detalle no-array) devuelven null", () => {
    expect(geocodificacionMotivoMessage(null)).toBeNull();
    expect(geocodificacionMotivoMessage({ status: "conflict" })).toBeNull();
    expect(
      geocodificacionMotivoMessage({ status: "conflict", detalle: "nope" }),
    ).toBeNull();
  });
});

// Feature 400 (T13b, R31-R33/R36) — el aviso de «cuántas se asignaron sin ubicación».
// Es lo que el humano pidió en la puerta de aprobación del 2026-09-09: una CIFRA, no una
// lista. Los dos literales van escritos a mano, copiados de design.md §6.5-b.
describe("400/R31 · mensajeAsignadasSinUbicacion — la cifra agregada del aviso", () => {
  const LITERAL_UNA =
    "1 orden se asignó sin ubicación en el mapa por un problema del sistema, no de la dirección. Se ubicará más tarde.";
  const LITERAL_VARIAS = (n: number) =>
    `${n} órdenes se asignaron sin ubicación en el mapa por un problema del sistema, no de la dirección. Se ubicarán más tarde.`;

  it.each([0, -1, -42])("R33: con %i órdenes no hay aviso — cadena vacía", (n) => {
    expect(mensajeAsignadasSinUbicacion(n)).toBe("");
  });

  it("R31: con UNA orden, el literal exacto en singular", () => {
    expect(mensajeAsignadasSinUbicacion(1)).toBe(LITERAL_UNA);
  });

  it.each([2, 6, 42])("R31: con %i órdenes, el literal exacto en plural y con la cifra dentro", (n) => {
    const mensaje = mensajeAsignadasSinUbicacion(n);
    expect(mensaje).toBe(LITERAL_VARIAS(n));
    expect(mensaje).toContain(String(n));
  });

  it("R32: el aviso es una CIFRA — con el mismo número, el texto es el mismo dato tenga la orden que tenga", () => {
    // La función solo recibe un `number`: no hay ningún parámetro por el que pudiera entrar
    // una guía, un id o una dirección. Esta es la prueba en runtime de esa forma.
    expect(mensajeAsignadasSinUbicacion(3)).toBe(mensajeAsignadasSinUbicacion(3));
    expect(mensajeAsignadasSinUbicacion(3)).not.toContain("NA-");
    expect(mensajeAsignadasSinUbicacion(3)).not.toContain("REM-");
  });

  it.each([1, 2, 42])(
    "R36: con %i, el texto no usa jerga interna («geocodificación», «config_invalida», «API»)",
    (n) => {
      const mensaje = mensajeAsignadasSinUbicacion(n);
      expect(mensaje).not.toMatch(/geocodificaci/i);
      expect(mensaje).not.toMatch(/config_invalida/i);
      expect(mensaje).not.toMatch(/api/i);
      expect(mensaje).not.toMatch(/request_denied/i);
    },
  );

  it("R36: y dice que la causa es del SISTEMA, no de la dirección", () => {
    const mensaje = mensajeAsignadasSinUbicacion(2);
    expect(mensaje).toMatch(/problema del sistema/i);
    expect(mensaje).toMatch(/no de la dirección/i);
  });

  it("R36: el mensaje de `geocodificacion_agotada` tampoco usa jerga interna", () => {
    const mensaje = mensajeDireccionPorMotivo("geocodificacion_agotada")!;
    expect(mensaje).not.toMatch(/geocodificaci/i);
    expect(mensaje).not.toMatch(/config_invalida/i);
    expect(mensaje).not.toMatch(/api/i);
    expect(mensaje).not.toMatch(/request_denied/i);
  });
});
