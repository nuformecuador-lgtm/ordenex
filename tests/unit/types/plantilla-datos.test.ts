// Catalogo de campos de las plantillas de WhatsApp (`lib/types/plantilla-datos.ts`).
//
// Lo que se vigila aqui no es "que cada campo devuelva su string" —eso seria copiar el
// catalogo en el test— sino las tres propiedades que lo hacen fiable: las claves son unicas y
// bien formadas, el formato de cada TIPO de dato es el del repo (dinero, fecha, booleano), y
// una clave desconocida no revienta un envio.
import { describe, expect, it } from "vitest";

import {
  CAMPOS_PLANTILLA,
  CAMPOS_PLANTILLA_POR_CLAVE,
  DATOS_PLANTILLA_EJEMPLO,
  resolverValoresPlantilla,
  valorDeCampo,
} from "@/lib/types/plantilla-datos";
import { datosPlantillaFixture } from "@/tests/fixtures/plantilla-datos";

const DATOS = datosPlantillaFixture();

describe("catalogo de campos", () => {
  it("las claves son unicas", () => {
    const claves = CAMPOS_PLANTILLA.map((c) => c.clave);
    expect(new Set(claves).size).toBe(claves.length);
  });

  // Una clave que no case con el placeholder de `plantilla-mensaje.ts` seria inservible: el
  // cuerpo que la usara se rechazaria como llave malformada al guardar la plantilla.
  it("las claves cumplen el formato del placeholder [a-z0-9_]+", () => {
    for (const campo of CAMPOS_PLANTILLA) {
      expect(campo.clave).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it("cada campo se describe entero (nombre, descripcion, ejemplo y origen)", () => {
    for (const campo of CAMPOS_PLANTILLA) {
      expect(campo.campo.trim()).not.toBe("");
      expect(campo.nombre.trim()).not.toBe("");
      expect(campo.descripcion.trim()).not.toBe("");
      expect(campo.ejemplo.trim()).not.toBe("");
    }
  });

  it("ningun campo revienta con la orden y el mensajero vacios", () => {
    const vacios = datosPlantillaFixture({
      orden: {
        numGuia: null,
        direccion: null,
        peso: null,
        notas: null,
        montoCobrar: null,
        cobraComision: null,
        prioridad: null,
        intentosContacto: null,
        estatusValue: null,
        distritoNombre: null,
        tiendaNombre: null,
        zonaNombre: null,
        provinciaNombre: null,
        cantonNombre: null,
      },
      mensajero: {
        id: null,
        nombre: null,
        primerApellido: null,
        segundoApellido: null,
        email: null,
        telefono: null,
        cedula: null,
        placa: null,
        vehiculoNombre: null,
        zonaNombre: null,
        estado: null,
      },
    });
    for (const campo of CAMPOS_PLANTILLA) {
      expect(typeof valorDeCampo(campo.clave, vacios)).toBe("string");
    }
  });
});

describe("formato de cada tipo de dato", () => {
  it("el dinero usa el formateador del repo: simbolo, miles y sin centimos", () => {
    expect(valorDeCampo("monto", DATOS)).toBe("₡25.900");
    expect(valorDeCampo("total", DATOS)).toBe("₡25.900");
    expect(valorDeCampo("monto_crudo", DATOS)).toBe("25900");
  });

  it("el estatus se traduce al vocabulario PUBLICO, nunca el value interno", () => {
    expect(valorDeCampo("estatus", DATOS)).toBe("En reparto");
    const interno = datosPlantillaFixture({ orden: { estatusValue: "sin_gestionar" } });
    expect(valorDeCampo("estatus", interno)).toBe("En reparto");
    expect(valorDeCampo("estatus", interno)).not.toContain("_");
  });

  // `fecha_reparto` es `@db.Date` y se guarda a MEDIANOCHE UTC de la fecha calendario de CR:
  // se leen las partes UTC tal cual. Restarle las seis horas devolveria el dia ANTERIOR.
  it("una fecha `@db.Date` no retrocede un dia al formatearse", () => {
    const d = datosPlantillaFixture({
      orden: { fechaReparto: new Date("2026-08-26T00:00:00.000Z") },
    });
    expect(valorDeCampo("fecha_reparto", d)).toBe("26/08/2026");
  });

  // Un `timestamp` SI es un instante: 02:30 UTC del 26 son las 20:30 del 25 en Costa Rica.
  it("un `timestamp` se pinta en hora de Costa Rica", () => {
    const d = datosPlantillaFixture({
      orden: { asignadoAt: new Date("2026-08-26T02:30:00.000Z") },
    });
    expect(valorDeCampo("fecha_asignacion", d)).toBe("25/08/2026 20:30");
  });

  it("los booleanos se leen, no se imprimen como true/false", () => {
    expect(valorDeCampo("prioridad", DATOS)).toBe("No");
    expect(valorDeCampo("cobra_comision", DATOS)).toBe("Sí");
  });

  // El enlace PRECARGA el primer campo del rastreo; el segundo factor lo sigue tecleando el
  // destinatario. El nombre del parametro sale de `PARAM_GUIA` (`app/_landing/guia-en-url.ts`),
  // que es quien lo LEE: si alli se renombra, este test cae y el enlace no se queda roto.
  it("`url_guia` arma el enlace de rastreo con la guia en el query param", () => {
    expect(valorDeCampo("url_guia", DATOS)).toBe("https://ordenex.co/?guia=25381189");
  });

  it("`url_guia` no emite barras dobles si la base ya trae barra final", () => {
    const d = datosPlantillaFixture({ negocio: { urlBase: "https://ordenex.co/" } });
    expect(valorDeCampo("url_guia", d)).toBe("https://ordenex.co/?guia=25381189");
  });

  it("`url_guia` es vacia sin guia y sin URL publica, nunca un enlace roto", () => {
    expect(valorDeCampo("url_guia", datosPlantillaFixture({ orden: { numGuia: null } }))).toBe("");
    expect(valorDeCampo("url_guia", datosPlantillaFixture({ negocio: { urlBase: "" } }))).toBe("");
  });

  it("el peso lleva la unidad pegada", () => {
    expect(valorDeCampo("peso", DATOS)).toBe("1.5 kg");
  });
});

describe("datos del mensajero", () => {
  it("`mensajero` compone el nombre completo saltandose los apellidos ausentes", () => {
    expect(valorDeCampo("mensajero", DATOS)).toBe("Jose Castillo");
    const conDos = datosPlantillaFixture({ mensajero: { segundoApellido: "Mora" } });
    expect(valorDeCampo("mensajero", conDos)).toBe("Jose Castillo Mora");
  });

  it("sin mensajero asignado todas sus claves salen vacias", () => {
    const sin = datosPlantillaFixture({
      mensajero: { nombre: null, primerApellido: null, telefono: null, placa: null },
    });
    expect(valorDeCampo("mensajero", sin)).toBe("");
    expect(valorDeCampo("mensajero_telefono", sin)).toBe("");
    expect(valorDeCampo("mensajero_placa", sin)).toBe("");
  });

  // La lista blanca ES la frontera de privacidad: si una columna no esta en el catalogo, no
  // hay `{{clave}}` que la saque de la base. `passwordHash` es el caso que no se negocia.
  it("no existe ninguna clave que exponga la credencial del mensajero", () => {
    const claves = CAMPOS_PLANTILLA.map((c) => c.clave).join(" ");
    expect(claves).not.toMatch(/password|hash|token/);
  });

  it("los datos personales e internos estan marcados como sensibles", () => {
    for (const clave of ["mensajero_cedula", "mensajero_email", "notas", "orden_id"]) {
      expect(CAMPOS_PLANTILLA_POR_CLAVE.get(clave)?.sensible).toBe(true);
    }
    expect(CAMPOS_PLANTILLA_POR_CLAVE.get("cliente")?.sensible).toBeUndefined();
  });
});

describe("resolverValoresPlantilla", () => {
  it("resuelve SOLO las variables que la plantilla declara", () => {
    const v = resolverValoresPlantilla(["cliente", "guia"], DATOS);
    expect(Object.keys(v)).toEqual(["cliente", "guia"]);
    expect(v).toEqual({ cliente: "Juan Perez", guia: "25381189" });
  });

  it("una clave fuera del catalogo cae a vacio, nunca rompe el envio", () => {
    expect(resolverValoresPlantilla(["sucursal"], DATOS)).toEqual({ sucursal: "" });
  });
});

/* -------------------------------------------------------------------------- */
/* Feature 282 — alias declarativos y coherencia fixture <-> catalogo          */
/* -------------------------------------------------------------------------- */

// Los alias se distinguian por una SUBCADENA de su etiqueta (« (alias de {{guia}})»), y colgar
// comportamiento de un texto de UI se rompe con una coma o una traduccion. Ahora lo declara
// `aliasDe` y el `nombre` queda limpio (design §5.5).
describe("alias del catalogo (R4/R5)", () => {
  const ESPERADOS: Array<[string, string]> = [
    ["num_guia", "guia"],
    ["nombre", "cliente"],
    ["destinatario", "cliente"],
    ["num_remision", "remision"],
    ["total", "monto"],
  ];

  it.each(ESPERADOS)("`%s` declara `aliasDe: \"%s\"`", (clave, base) => {
    expect(CAMPOS_PLANTILLA_POR_CLAVE.get(clave)?.aliasDe).toBe(base);
  });

  it("ningun nombre del catalogo arrastra la subcadena «alias de»", () => {
    for (const campo of CAMPOS_PLANTILLA) {
      expect(campo.nombre).not.toContain("alias de");
    }
  });

  it("cada alias comparte `campo` y `ejemplo` con su base y resuelve al mismo valor", () => {
    for (const [clave, baseClave] of ESPERADOS) {
      const aliasCampo = CAMPOS_PLANTILLA_POR_CLAVE.get(clave);
      const base = CAMPOS_PLANTILLA_POR_CLAVE.get(baseClave);
      expect(aliasCampo).toBeDefined();
      expect(base).toBeDefined();
      expect(aliasCampo?.campo).toBe(base?.campo);
      expect(aliasCampo?.ejemplo).toBe(base?.ejemplo);
      expect(valorDeCampo(clave, DATOS)).toBe(valorDeCampo(baseClave, DATOS));
    }
  });

  // Lo que consume el selector (R4). Si el catalogo crece, este numero se actualiza a
  // conciencia: es la superficie que se le ofrece al maestro.
  //
  // OJO: el spec de la feature 282 dice «44 entradas, 39 propias». Era un error de conteo del
  // spec: medido aqui, eran 45 (40 propias + 5 alias). Manda la cuenta real.
  //
  // 2026-08-27 (feature 288, pedido humano): se BORRAN `telefono`, `direccion` y
  // `direccion_completa` —ninguna de las 7 plantillas vivas las usaba—, asi que quedan 42
  // (37 propias + 5 alias). Los otros 25 campos retirados NO se descuentan aqui: siguen en el
  // catalogo con `ocultoEnSelector`, que es justo la diferencia entre ocultar y borrar.
  it("el catalogo tiene 42 entradas, 37 propias y 5 alias", () => {
    expect(CAMPOS_PLANTILLA).toHaveLength(42);
    expect(CAMPOS_PLANTILLA.filter((c) => c.aliasDe === undefined)).toHaveLength(37);
    expect(CAMPOS_PLANTILLA.filter((c) => c.aliasDe !== undefined)).toHaveLength(5);
  });
});

// R12 — EL PEGAMENTO. El campo `ejemplo` es documentacion y el fixture es comportamiento; sin
// este test divergen en silencio y la vista previa miente. Igualdad ESTRICTA para TODAS las
// entradas: prohibido `toContain`, prohibido saltar claves con una lista de excepciones. Si
// nace rojo se ALINEA el fixture o el `ejemplo` (design §4.1).
describe("R12: los datos de ejemplo producen exactamente el `ejemplo` de cada entrada", () => {
  it.each(CAMPOS_PLANTILLA)("$clave resuelve exactamente a su `ejemplo`", (campo) => {
    expect(valorDeCampo(campo.clave, DATOS_PLANTILLA_EJEMPLO)).toBe(campo.ejemplo);
  });

  // El fixture es CRUDO: entra por `leer()` y sale por `transform()`, el mismo par que el
  // envio real. Si viniera ya formateado, la preview no ejercitaria el formateador.
  it("el fixture guarda valores crudos, no cadenas ya formateadas", () => {
    expect(DATOS_PLANTILLA_EJEMPLO.orden.montoCobrar).toBe(12500);
    expect(DATOS_PLANTILLA_EJEMPLO.orden.peso).toBe(1.5);
    expect(DATOS_PLANTILLA_EJEMPLO.orden.numGuia).toBe(10432);
    expect(DATOS_PLANTILLA_EJEMPLO.orden.fechaReparto).toBeInstanceOf(Date);
  });
});
