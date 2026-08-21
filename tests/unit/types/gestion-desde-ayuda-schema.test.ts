import { describe, expect, it } from "vitest";

import { gestionConfig } from "@/lib/config/gestion";
import {
  gestionarDesdeAyudaSchema,
  RESULTADOS_DESDE_AYUDA,
} from "@/lib/types/gestion-desde-ayuda";
import { fechaCalendarioCR, mananaCalendarioCR } from "@/lib/utils/fecha-cr";

/** Un dia calendario de Costa Rica, desplazado `n` dias respecto de hoy. */
const UN_DIA_MS = 24 * 60 * 60 * 1000;
function diaCR(offset: number): string {
  return fechaCalendarioCR(new Date(Date.now() + offset * UN_DIA_MS));
}

// Feature 237 (T5.2, R1/R12/R13/R14, D2/D8) — EL BORDE de la gestion que la tienda registra desde
// la pestaña de ayuda.
//
// Es la barrera que no depende de la interfaz (R13): la ventana valida con este MISMO schema, pero
// un cliente que se la salte llega aqui igual. Lo que se prueba:
//   - solo existen DOS desenlaces, y los otros tres NO son valores posibles (R1);
//   - motivo y foto son obligatorios en LAS DOS ramas, tambien al reprogramar (R12, D2);
//   - MIME, tamaño y tope de lista se revalidan (R13);
//   - hoy y ayer no parsean; mañana si (R14).

const FOTO = { type: "image/jpeg", size: 1024 };

function rechazo(over: Record<string, unknown> = {}) {
  return {
    ordenId: "11111111-1111-4111-8111-111111111111",
    resultado: "rechazada",
    motivo: "el cliente no la quiere",
    evidencias: [FOTO],
    ...over,
  };
}

function reprogramacion(over: Record<string, unknown> = {}) {
  return {
    ordenId: "11111111-1111-4111-8111-111111111111",
    resultado: "reprogramada",
    fechaReprogramacion: diaCR(2), // pasado mañana: futuro sin depender del borde del dia
    motivo: "el cliente pidio otro dia",
    evidencias: [FOTO],
    ...over,
  };
}

/** Los campos con error, para poder afirmar QUE campo se queja (la ventana los pinta por campo). */
function camposConError(input: unknown): string[] {
  const r = gestionarDesdeAyudaSchema.safeParse(input);
  if (r.success) return [];
  return [...new Set(r.error.issues.map((i) => i.path.join(".")))].sort();
}

/* -------------------------------------------------------------------------- */
/* R1 — DOS desenlaces, y ni uno mas                                            */
/* -------------------------------------------------------------------------- */

describe("R1 — la tienda tiene EXACTAMENTE dos desenlaces desde ayuda", () => {
  it("la lista es `reprogramada` y `rechazada`, en ese orden y sin nada mas", () => {
    // Censo cerrado. Un tercer literal aqui abriria una arista que el grafo no declara y el choke
    // point del historial rechazaria en runtime (guardia de fallo cerrado, 140).
    expect([...RESULTADOS_DESDE_AYUDA]).toEqual(["reprogramada", "rechazada"]);
  });

  it("los DOS parsean con sus campos completos", () => {
    expect(gestionarDesdeAyudaSchema.safeParse(rechazo()).success).toBe(true);
    expect(gestionarDesdeAyudaSchema.safeParse(reprogramacion()).success).toBe(true);
  });

  it.each(["entregada", "devuelta", "incidente"])(
    "`%s` NO es un valor posible: la tienda no puede registrarlo desde ayuda",
    (resultado) => {
      // Y no hace falta un `if` que lo compruebe: al ser una `discriminatedUnion` sobre dos
      // literales, el resultado ajeno no tiene ninguna rama que lo acepte. Es el mecanismo del
      // limite, no una comprobacion aparte que alguien pueda olvidar.
      //
      // Las tres estan fuera por una razon operativa, no por prudencia: la tienda no puede
      // declarar entregado un paquete que no vio, ni devolver por su cuenta lo que sigue en la
      // moto del mensajero, ni reportar un incidente que no presencio.
      const r = gestionarDesdeAyudaSchema.safeParse(rechazo({ resultado }));
      expect(r.success).toBe(false);
    },
  );

  it("un `resultado` ausente o vacio tampoco parsea", () => {
    expect(gestionarDesdeAyudaSchema.safeParse(rechazo({ resultado: undefined })).success).toBe(
      false,
    );
    expect(gestionarDesdeAyudaSchema.safeParse(rechazo({ resultado: "" })).success).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* R12 + D2 — motivo Y foto, en LAS DOS ramas                                   */
/* -------------------------------------------------------------------------- */

describe("R12/D2 — motivo y evidencia son obligatorios en LOS DOS desenlaces", () => {
  it("rechazar sin motivo no parsea, y el error va en `motivo`", () => {
    expect(camposConError(rechazo({ motivo: undefined }))).toContain("motivo");
    expect(camposConError(rechazo({ motivo: "   " }))).toContain("motivo"); // solo espacios: `.trim()`
  });

  it("rechazar sin foto no parsea, y el error va en `evidencias`", () => {
    expect(camposConError(rechazo({ evidencias: undefined }))).toContain("evidencias");
    expect(camposConError(rechazo({ evidencias: [] }))).toContain("evidencias");
  });

  it("💰 D2: REPROGRAMAR TAMPOCO parsea sin foto — la unica asimetria con el mensajero", () => {
    // El mensajero SI reprograma sin foto. Aqui no, y es una firma humana del 2026-08-20: su
    // reprogramacion ya trae una PRUEBA DE PRESENCIA que la tienda no puede tener (la ubicacion es
    // obligatoria en sus cinco ramas desde la 193, y denegar el permiso le bloquea el envio). La
    // tienda gestiona desde un escritorio: la imagen es su sustituto de esa prueba. Y reprogramar
    // desde ayuda SUMA UN INTENTO y mueve el reloj del SLA.
    expect(camposConError(reprogramacion({ evidencias: undefined }))).toContain("evidencias");
    expect(camposConError(reprogramacion({ evidencias: [] }))).toContain("evidencias");
  });

  it("reprogramar sin motivo tampoco parsea", () => {
    expect(camposConError(reprogramacion({ motivo: undefined }))).toContain("motivo");
  });

  it("D8: el motivo NO tiene tope de longitud — deuda heredada COMPARTIDA, declarada", () => {
    // Se reutiliza `motivoSchema` tal cual (D8, firmada): un tope solo en esta via seria una
    // divergencia entre dos caminos que la ficha promete identicos, y dejaria sin tope justo el que
    // mas se usa. Este caso AFIRMA el agujero para que sea decision y no olvido: el dia que se
    // cierre, se cierra en `gestion-orden.ts` y este caso se pone rojo a proposito.
    const largo = "x".repeat(50_000);
    expect(gestionarDesdeAyudaSchema.safeParse(rechazo({ motivo: largo })).success).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* R13 — MIME, tamaño y tope de lista, revalidados AQUI                         */
/* -------------------------------------------------------------------------- */

describe("R13 — el borde revalida las fotos aunque la interfaz no lo haga", () => {
  it.each([
    ["application/pdf", "un PDF no es una imagen"],
    ["image/gif", "un GIF no esta en la lista permitida"],
    ["text/plain", "texto plano"],
  ])("MIME `%s` no parsea (%s)", (type) => {
    expect(camposConError(rechazo({ evidencias: [{ type, size: 1024 }] }))).toContain(
      "evidencias.0",
    );
  });

  it("una foto de 0 bytes no parsea", () => {
    expect(camposConError(rechazo({ evidencias: [{ type: "image/jpeg", size: 0 }] }))).toContain(
      "evidencias.0",
    );
  });

  it("una foto por encima del tope de tamaño no parsea", () => {
    const gorda = { type: "image/jpeg", size: gestionConfig.MAX_FILE_BYTES + 1 };
    expect(camposConError(rechazo({ evidencias: [gorda] }))).toContain("evidencias.0");
    // Y justo en el tope si pasa: el limite es `>`, no `>=`.
    const justa = { type: "image/jpeg", size: gestionConfig.MAX_FILE_BYTES };
    expect(gestionarDesdeAyudaSchema.safeParse(rechazo({ evidencias: [justa] })).success).toBe(
      true,
    );
  });

  it("una foto invalida invalida el envio ENTERO, aunque las otras esten bien", () => {
    const mezcla = [FOTO, { type: "application/pdf", size: 10 }, FOTO];
    expect(gestionarDesdeAyudaSchema.safeParse(rechazo({ evidencias: mezcla })).success).toBe(
      false,
    );
  });

  it("por encima del tope de la LISTA no parsea, y en el tope si", () => {
    const tope = gestionConfig.MAX_EVIDENCIAS_POR_GESTION;
    const enElTope = Array.from({ length: tope }, () => FOTO);
    const unaMas = Array.from({ length: tope + 1 }, () => FOTO);
    expect(gestionarDesdeAyudaSchema.safeParse(rechazo({ evidencias: enElTope })).success).toBe(
      true,
    );
    expect(camposConError(rechazo({ evidencias: unaMas }))).toContain("evidencias");
  });
});

/* -------------------------------------------------------------------------- */
/* R14 — la fecha, revalidada en el calendario de Costa Rica                    */
/* -------------------------------------------------------------------------- */

describe("R14 — la fecha de reprogramacion es mañana o posterior, en el calendario de CR", () => {
  it("mañana SI parsea", () => {
    expect(
      gestionarDesdeAyudaSchema.safeParse(
        reprogramacion({ fechaReprogramacion: mananaCalendarioCR() }),
      ).success,
    ).toBe(true);
  });

  it("HOY no parsea", () => {
    // El dia de CR, no el UTC: entre las 18:00 y la medianoche de CR el dia UTC ya es el siguiente,
    // y comparar contra el rechazaba mañana como si fuera hoy. El off-by-one esta resuelto UNA vez,
    // en `esFechaFutura`, y aqui se REUTILIZA — no se copia.
    const hoy = diaCR(0);
    expect(camposConError(reprogramacion({ fechaReprogramacion: hoy }))).toContain(
      "fechaReprogramacion",
    );
  });

  it("AYER tampoco", () => {
    const ayer = diaCR(-1);
    expect(camposConError(reprogramacion({ fechaReprogramacion: ayer }))).toContain(
      "fechaReprogramacion",
    );
  });

  it("un dia INEXISTENTE (`2027-02-31`) no parsea aunque suene a futuro", () => {
    // En V8 solo el MES fuera de rango invalida; el DIA desbordado RUEDA en silencio
    // (`2027-02-31` es el 3 de marzo) y la comparacion lexicografica lo daba por futuro. Se
    // reprogramaba para un dia que nadie pidio.
    expect(camposConError(reprogramacion({ fechaReprogramacion: "2027-02-31" }))).toContain(
      "fechaReprogramacion",
    );
  });

  it("un formato que no sea `YYYY-MM-DD` no parsea", () => {
    expect(camposConError(reprogramacion({ fechaReprogramacion: "05/01/2027" }))).toContain(
      "fechaReprogramacion",
    );
  });

  it("RECHAZAR no admite fecha: el campo no existe en esa rama", () => {
    // Al ser una `discriminatedUnion`, un cliente que la envie no la consigue persistir — no
    // aparece en el tipo parseado de la rama. Mismo blindaje que la causa de la 73.
    const r = gestionarDesdeAyudaSchema.safeParse(
      rechazo({ fechaReprogramacion: "2027-01-05" }),
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).not.toHaveProperty("fechaReprogramacion");
  });

  it("REPROGRAMAR sin fecha no parsea", () => {
    expect(camposConError(reprogramacion({ fechaReprogramacion: undefined }))).toContain(
      "fechaReprogramacion",
    );
  });
});
