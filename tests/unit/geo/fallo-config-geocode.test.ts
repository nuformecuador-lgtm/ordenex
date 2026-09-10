import { describe, it, expect } from "vitest";
import {
  MARCADOR_FALLO_CONFIG_GEOCODE,
  marcarFalloConfigGeocode,
  esFalloConfigGeocode,
} from "@/lib/geo/fallo-config-geocode";

// Feature 400 (T2, R11/R12/R13/R14) — el marcador que distingue «fallo de configuracion
// NUESTRA» de «la direccion no existe» al otro lado de la cola.
//
// Las cuatro propiedades que este archivo protege, y por que cada una:
//   - marcar y detectar son inversos (R11): sin esto, el marcador seria decorativo;
//   - SOBREVIVE al recorte a 500 caracteres que aplica `JobQueueService.mensajeError`
//     (R12) — es la razon de que sea un PREFIJO y no un sufijo;
//   - una MENCION del marcador en medio del texto NO cuenta (es `startsWith`, no
//     `includes`): un error de red que citara el marcador no debe abrir la asignacion;
//   - el literal no lleva PII (R14), afirmado A MANO y no derivado de la constante.

/** El mismo recorte que hace la cola antes de persistir en `jobs.last_error`. */
const MAX_ERROR_LEN = 500;
function comoLaCola(mensaje: string): string {
  return mensaje.slice(0, MAX_ERROR_LEN);
}

describe("400/R11 — marcar y detectar son inversos", () => {
  it("un detalle marcado se detecta; el mismo detalle sin marcar, no", () => {
    const detalle = "geocodificar direccion: el proveedor rechazo la peticion (REQUEST_DENIED)";

    expect(esFalloConfigGeocode(marcarFalloConfigGeocode(detalle))).toBe(true);
    // La mitad negativa: si `esFalloConfigGeocode` devolviera `true` para cualquier cosa,
    // el gate dejaria pasar TODAS las ordenes sin coordenadas.
    expect(esFalloConfigGeocode(detalle)).toBe(false);
  });

  it("el detalle original sigue legible detras del marcador (no se pierde el diagnostico)", () => {
    const marcado = marcarFalloConfigGeocode("REQUEST_DENIED");
    expect(marcado).toContain("REQUEST_DENIED");
  });

  it("marcar es IDEMPOTENTE: dos pasadas no duplican el prefijo", () => {
    // Lo necesita el backfill de R17, que debe poder correrse dos veces.
    const unaVez = marcarFalloConfigGeocode("REQUEST_DENIED");
    const dosVeces = marcarFalloConfigGeocode(unaVez);

    expect(dosVeces).toBe(unaVez);
    const ocurrencias = dosVeces.split(MARCADOR_FALLO_CONFIG_GEOCODE).length - 1;
    expect(ocurrencias).toBe(1);
  });
});

describe("400/R12 — el marcador sobrevive al recorte de 500 caracteres de la cola", () => {
  it("con un detalle de 2000 caracteres, el mensaje recortado SIGUE detectandose", () => {
    const detalleLargo = "x".repeat(2000);
    const mensaje = marcarFalloConfigGeocode(detalleLargo);

    expect(mensaje.length).toBeGreaterThan(MAX_ERROR_LEN);
    const persistido = comoLaCola(mensaje);
    expect(persistido).toHaveLength(MAX_ERROR_LEN);

    // Esta es LA asercion de R12: lo que llega a `jobs.last_error` conserva el marcador.
    expect(esFalloConfigGeocode(persistido)).toBe(true);
  });

  it("CONTRAPRUEBA: un marcador al FINAL no habria sobrevivido al mismo recorte", () => {
    // Justifica la decision de diseno (§2.2) en vez de dejarla como una afirmacion en un
    // comentario: con sufijo, el recorte se lo lleva y el gate no veria nada.
    const conSufijo = `${"x".repeat(2000)} ${MARCADOR_FALLO_CONFIG_GEOCODE}`;
    expect(comoLaCola(conSufijo)).not.toContain(MARCADOR_FALLO_CONFIG_GEOCODE);
  });
});

describe("400/R11 — ausencia de error y menciones que NO son el marcador", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["cadena vacia", ""],
  ])("%s -> false", (_nombre, valor) => {
    expect(esFalloConfigGeocode(valor as string | null | undefined)).toBe(false);
  });

  it("un error AJENO que MENCIONA el marcador en medio del texto -> false (es prefijo, no substring)", () => {
    const ajeno = `fallo de red al reintentar un job previo que decia ${MARCADOR_FALLO_CONFIG_GEOCODE} hace una hora`;

    expect(ajeno).toContain(MARCADOR_FALLO_CONFIG_GEOCODE); // la mencion existe...
    expect(esFalloConfigGeocode(ajeno)).toBe(false); // ...y aun asi NO cuenta
  });

  it("un error con el marcador precedido de un espacio tampoco cuenta", () => {
    expect(esFalloConfigGeocode(` ${MARCADOR_FALLO_CONFIG_GEOCODE} REQUEST_DENIED`)).toBe(false);
  });
});

describe("400/R14 — el marcador no lleva ningun dato personal", () => {
  it("es EXACTAMENTE este literal, escrito a mano", () => {
    // Afirmado a mano y no derivado de la constante: comparar la constante consigo misma
    // estaria verde para siempre (memoria «asercion contra su propia fuente»).
    expect(MARCADOR_FALLO_CONFIG_GEOCODE).toBe("[geocode:config]");
  });

  it("no contiene digitos, ni arroba, ni nada que pueda venir de una direccion o de un id", () => {
    expect(MARCADOR_FALLO_CONFIG_GEOCODE).not.toMatch(/\d/);
    expect(MARCADOR_FALLO_CONFIG_GEOCODE).not.toContain("@");
    for (const prohibido of ["http", "key", "AIza", "Av.", "San Jos"]) {
      expect(MARCADOR_FALLO_CONFIG_GEOCODE.toLowerCase()).not.toContain(
        prohibido.toLowerCase(),
      );
    }
  });

  it("marcar NO inyecta nada propio: el resultado es el prefijo mas EL detalle recibido", () => {
    const detalle = "el proveedor rechazo la peticion";
    expect(marcarFalloConfigGeocode(detalle)).toBe(
      `${MARCADOR_FALLO_CONFIG_GEOCODE} ${detalle}`,
    );
  });
});
