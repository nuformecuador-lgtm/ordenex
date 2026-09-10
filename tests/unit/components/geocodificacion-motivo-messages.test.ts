import { describe, it, expect } from "vitest";

import {
  esMotivoAutorizableSinUbicacion,
  geocodificacionMotivoMessage,
  LABEL_AUTORIZAR_SIN_UBICACION,
  mensajeAsignadasSinUbicacion,
  mensajeAsignadasSinUbicacionAutorizada,
  mensajeDireccionPorMotivo,
  MOTIVOS_BLOQUEANTES,
  MSG_CONSECUENCIA_AUTORIZAR_SIN_UBICACION,
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

// ─────────────────────────────────────────────────────────────────────────────────────────
// FICHA 407 (T7, R13/R15) — LOS DOS LITERALES DE LA AUTORIZACIÓN.
//
// Están APROBADOS POR EL HUMANO el 2026-09-10 y copiados carácter a carácter de design.md
// §5.1 y §5.2. Aquí van ESCRITOS A MANO, no comparados contra la constante que los produce:
// afirmar un texto contra su propia fuente está siempre verde y en este repo ya dejó pasar un
// defecto. Si alguien retoca el módulo, esta comparación se pone roja — que es el punto.
// ─────────────────────────────────────────────────────────────────────────────────────────

/** design.md §5.1, palabra por palabra. */
const LITERAL_CONSECUENCIA =
  "El mapa no reconoce esta dirección, así que la orden no tiene un punto en el mapa. Si autorizas, se podrá asignar a un mensajero: aparecerá al final de su lista de entregas y no se tendrá en cuenta al calcular el orden del recorrido. Autoriza solo si el mensajero puede llegar con las indicaciones de la dirección.";

/** design.md §5.2, palabra por palabra. */
const LITERAL_AUTORIZADA_UNA =
  "1 orden se asignó sin ubicación en el mapa porque se autorizó hacerlo. Aparecerá al final de la lista de entregas del mensajero.";
const LITERAL_AUTORIZADA_VARIAS = (n: number) =>
  `${n} órdenes se asignaron sin ubicación en el mapa porque se autorizó hacerlo. Aparecerán al final de la lista de entregas del mensajero.`;

describe("407/R13 · mensajeAsignadasSinUbicacionAutorizada — el aviso agregado de la autorización", () => {
  it.each([0, -1, -42])("con %i órdenes no hay aviso — cadena vacía", (n) => {
    expect(mensajeAsignadasSinUbicacionAutorizada(n)).toBe("");
  });

  it("con UNA orden, el literal exacto en singular", () => {
    expect(mensajeAsignadasSinUbicacionAutorizada(1)).toBe(LITERAL_AUTORIZADA_UNA);
  });

  it.each([2, 3, 42])(
    "con %i órdenes, el literal exacto en plural y con la cifra dentro",
    (n) => {
      const mensaje = mensajeAsignadasSinUbicacionAutorizada(n);
      expect(mensaje).toBe(LITERAL_AUTORIZADA_VARIAS(n));
      expect(mensaje).toContain(String(n));
    },
  );

  // R12 — LA RAZÓN DE SER DE ESTA FUNCIÓN. El aviso de la 400 dice «por un problema del
  // sistema, no de la dirección»; aquí la dirección SÍ es el problema, así que reutilizarlo
  // sería mentirle al operador que acaba de decidir asignar a sabiendas.
  it.each([1, 2, 42])(
    "R12: con %i, NO dice «no de la dirección» ni «problema del sistema»",
    (n) => {
      const mensaje = mensajeAsignadasSinUbicacionAutorizada(n);
      expect(mensaje).not.toMatch(/no de la dirección/i);
      expect(mensaje).not.toMatch(/problema del sistema/i);
      expect(mensaje).not.toMatch(/se ubicará más tarde/i);
      expect(mensaje).not.toMatch(/se ubicarán más tarde/i);
    },
  );

  it.each([1, 2, 42])(
    "R12: con %i, el aviso de la 407 y el de la 400 son textos DISTINTOS",
    (n) => {
      expect(mensajeAsignadasSinUbicacionAutorizada(n)).not.toBe(
        mensajeAsignadasSinUbicacion(n),
      );
    },
  );

  it("R13: dice POR QUÉ pasó (alguien lo autorizó) y QUÉ implica (va al final de la lista)", () => {
    const mensaje = mensajeAsignadasSinUbicacionAutorizada(2);
    expect(mensaje).toMatch(/porque se autorizó hacerlo/i);
    expect(mensaje).toMatch(/al final de la lista de entregas/i);
  });

  it.each([1, 2, 42])(
    "R13: con %i, sin siglas ni jerga interna («geocodificación», «gate», «API», «uuid»)",
    (n) => {
      const mensaje = mensajeAsignadasSinUbicacionAutorizada(n);
      expect(mensaje).not.toMatch(/geocodificaci/i);
      expect(mensaje).not.toMatch(/\bgate\b/i);
      expect(mensaje).not.toMatch(/api/i);
      expect(mensaje).not.toMatch(/uuid/i);
      expect(mensaje).not.toMatch(/zero_results/i);
    },
  );
});

// R15 — POR ESTE CANAL NO PUEDE VIAJAR PII, y no es una promesa: la función recibe un
// `number`, así que no hay ningún parámetro por el que pudiera entrar una dirección, una guía
// o un id. Las fixtures son las del caso medido en producción el 2026-09-10.
describe("407/R15 — ni el aviso ni la consecuencia arrastran datos de ninguna orden", () => {
  const DIRECCION_DEL_CASO =
    "DE LA CLINICA VETERINARIA MASCOTICAS, 75 METROS HACIA EL SUR SE ENCUENTRA LA ENTRADA PRINCIPAL DEL RESIDENCIAL VISTAS DEL SOL";
  const GUIA_DEL_CASO = "76068276";
  const DESTINATARIO_DEL_CASO = "ÓSCAR ELIZONDO SOLIS";
  const UUID_DE_PRUEBA = "9f0b0a3c-0000-4000-8000-000000000001";

  it("R15: el literal de consecuencia (§5.1) no lleva dirección, guía, destinatario ni id", () => {
    expect(MSG_CONSECUENCIA_AUTORIZAR_SIN_UBICACION).not.toContain(DIRECCION_DEL_CASO);
    expect(MSG_CONSECUENCIA_AUTORIZAR_SIN_UBICACION).not.toContain(GUIA_DEL_CASO);
    expect(MSG_CONSECUENCIA_AUTORIZAR_SIN_UBICACION).not.toContain(DESTINATARIO_DEL_CASO);
    expect(MSG_CONSECUENCIA_AUTORIZAR_SIN_UBICACION).not.toContain(UUID_DE_PRUEBA);
    // Es un literal fijo: ni un dígito, ni una arroba.
    expect(MSG_CONSECUENCIA_AUTORIZAR_SIN_UBICACION).not.toMatch(/\d/);
    expect(MSG_CONSECUENCIA_AUTORIZAR_SIN_UBICACION).not.toContain("@");
  });

  it.each([1, 3])(
    "R15: el aviso agregado con %i solo lleva la cifra — ni dirección, ni guía, ni id",
    (n) => {
      const mensaje = mensajeAsignadasSinUbicacionAutorizada(n);
      expect(mensaje).not.toContain(DIRECCION_DEL_CASO);
      expect(mensaje).not.toContain(GUIA_DEL_CASO);
      expect(mensaje).not.toContain(DESTINATARIO_DEL_CASO);
      expect(mensaje).not.toContain(UUID_DE_PRUEBA);
      expect(mensaje).not.toContain("@");
      // El ÚNICO dígito admisible es la propia cifra.
      expect(mensaje.replace(String(n), "")).not.toMatch(/\d/);
    },
  );

  it("R15: la firma solo admite un `number` — no hay hueco por donde meter una orden", () => {
    // Prueba de FORMA en runtime: con el mismo número, el texto es el mismo pase lo que pase.
    // El compilador cierra la otra mitad (`mensajeAsignadasSinUbicacionAutorizada("REM-1")` no
    // compila), y `pnpm run typecheck` es quien la ejecuta.
    expect(mensajeAsignadasSinUbicacionAutorizada(3)).toBe(
      mensajeAsignadasSinUbicacionAutorizada(3),
    );
    expect(mensajeAsignadasSinUbicacionAutorizada.length).toBe(1);
  });
});

// R14 — el texto que el operador tiene delante ANTES de decidir. No es decoración: es lo que
// convierte «pulsar un botón» en «autorizar a sabiendas».
describe("407/R14 — el literal de consecuencia dice las tres cosas que van a pasar", () => {
  it("es EXACTAMENTE el literal aprobado en design.md §5.1", () => {
    expect(MSG_CONSECUENCIA_AUTORIZAR_SIN_UBICACION).toBe(LITERAL_CONSECUENCIA);
  });

  it("dice que la orden no tiene punto en el mapa, que irá al final y que no entra en el recorrido", () => {
    expect(LITERAL_CONSECUENCIA).toMatch(/no tiene un punto en el mapa/i);
    expect(LITERAL_CONSECUENCIA).toMatch(/al final de su lista de entregas/i);
    expect(LITERAL_CONSECUENCIA).toMatch(
      /no se tendrá en cuenta al calcular el orden del recorrido/i,
    );
    // Y la condición bajo la que autorizar es correcto, que es lo que se le pide juzgar.
    expect(LITERAL_CONSECUENCIA).toMatch(
      /solo si el mensajero puede llegar con las indicaciones/i,
    );
  });

  it("R13: sin siglas ni jerga interna — no nombra la geocodificación ni el proveedor", () => {
    expect(LITERAL_CONSECUENCIA).not.toMatch(/geocodificaci/i);
    expect(LITERAL_CONSECUENCIA).not.toMatch(/google/i);
    expect(LITERAL_CONSECUENCIA).not.toMatch(/zero_results/i);
    expect(LITERAL_CONSECUENCIA).not.toMatch(/\bgate\b/i);
  });

  it("la etiqueta del control dice las DOS cosas que hace: autorizar y asignar", () => {
    expect(LABEL_AUTORIZAR_SIN_UBICACION).toBe("Autorizar y asignar sin ubicación");
  });
});

// R17 — el criterio de «qué se puede autorizar» viaja por el módulo compartido, no por una
// copia. Este archivo solo comprueba que el reexport ES el predicado del contrato del gate; que
// el predicado coincida con lo que el gate hace de verdad lo prueba
// `tests/unit/services/asignabilidad-coordenadas-autorizada.test.ts` (backend, T3).
describe("407/R17 — el módulo de vocabulario reexporta el predicado del gate", () => {
  it("solo el desenlace DETERMINISTA es autorizable", () => {
    expect(esMotivoAutorizableSinUbicacion("direccion_no_geocodificable")).toBe(true);
  });

  it.each([
    "geocodificacion_en_curso",
    "geocodificacion_encolada",
    "geocodificacion_no_encolable",
    "geocodificacion_agotada",
  ])("%s NO es autorizable: todavía puede resolverse solo, o lo cubre la 400", (motivo) => {
    expect(esMotivoAutorizableSinUbicacion(motivo)).toBe(false);
  });

  it("un motivo que no es del gate tampoco lo es", () => {
    expect(esMotivoAutorizableSinUbicacion("zona_ajena")).toBe(false);
    expect(esMotivoAutorizableSinUbicacion("")).toBe(false);
  });

  it("y todo lo autorizable es, además, un motivo BLOQUEANTE del gate (si no, no habría nada que autorizar)", () => {
    // No-vacuidad + coherencia: autorizar algo que no bloquea no significaría nada.
    const autorizables = MOTIVOS_BLOQUEANTES.filter((m) =>
      esMotivoAutorizableSinUbicacion(m),
    );
    expect(autorizables).toEqual(["direccion_no_geocodificable"]);
  });
});
