import { describe, it, expect } from "vitest";
import {
  clavesSinCampo,
  etiquetaDeVariable,
  extraerVariables,
  nombresDeVariables,
  previewConEjemplos,
  renderPlantilla,
  validarCuerpo,
} from "@/lib/utils/plantilla-mensaje";
import { construirComponentsTemplate } from "@/lib/utils/whatsapp-template";

// Feature 107 — T2 (R14, R15, R16, R19) + feature 282 — T10 (R19, R20, R21, R5, R15/R16).
//
// QUE DESAPARECIO DE ESTE ARCHIVO Y POR QUE. Hasta la feature 282 aqui vivian tres tests que
// afirmaban el catalogo VIEJO (`lib/types/plantilla-variables.ts`, un array VACIO) y su
// consecuencia: «la preview de una clave definida por el usuario cae al marcador en
// MAYUSCULAS». Ese modulo se BORRA (design §4.4) y ese comportamiento queda DEROGADO
// explicitamente (design §4.3, «Contradiccion resuelta»): la preview es «Asi lo vera el
// cliente», y lo que al cliente le llega es un HUECO, no la palabra `SUCURSAL`. Quien avisa
// de la clave rota es `clavesSinCampo` (R15/R16), no un marcador que el cliente nunca veria.
// No se borro cobertura: el modelo ABIERTO —cualquier clave bien formada se acepta— sigue
// fijado abajo, y el marcador de `renderPlantilla` sigue probado como red de seguridad para
// llamadores que no resuelvan todas las claves.

describe("modelo ABIERTO: cualquier clave bien formada se acepta (Decision humana 4, f107)", () => {
  it("acepta y extrae CUALQUIER clave bien formada definida por el usuario", () => {
    const r = validarCuerpo("Hola {{usuario}}, tu orden {{cod}}");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.variables).toEqual(["usuario", "cod"]);
  });

  it("un cuerpo con CERO variables es valido (variables = [])", () => {
    const r = validarCuerpo("Mensaje sin variables");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.variables).toEqual([]);
  });

  // El sucesor del test derogado: una clave que el catalogo no conoce se pinta como el hueco
  // que le llegaria al cliente.
  it("una clave fuera del catalogo se pinta como el hueco real en la preview", () => {
    expect(previewConEjemplos("Hola {{usuario}}")).toBe("Hola ");
  });
});

describe("R14: reconoce {{ clave }} con espacios internos", () => {
  it("normaliza espacios y mayusculas a la clave lowercase", () => {
    expect(extraerVariables("Hola {{ usuario }}")).toEqual(["usuario"]);
    expect(extraerVariables("{{USUARIO}}")).toEqual(["usuario"]);
    expect(extraerVariables("{{cod}} y {{ cod }}")).toEqual(["cod"]);
  });
});

describe("R15: acepta cualquier clave bien formada y devuelve el array deduplicado", () => {
  it("extrae en orden de aparicion, sin duplicados", () => {
    const cuerpo = "Hola {{usuario}}, tu orden {{cod}} y otra vez {{usuario}}";
    expect(extraerVariables(cuerpo)).toEqual(["usuario", "cod"]);
  });

  it("acepta claves fuera del catalogo (sin lista blanca)", () => {
    const r = validarCuerpo("{{telefono}} y {{tienda_x}}");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.variables).toEqual(["telefono", "tienda_x"]);
  });

  it("cuerpo sin variables -> array vacio", () => {
    expect(extraerVariables("Sin placeholders")).toEqual([]);
  });
});

describe("R16: rechaza {{}} y claves con caracteres invalidos", () => {
  it("{{}} y {{ }} son malformados", () => {
    const a = validarCuerpo("Hola {{}}");
    expect(a.ok).toBe(false);
    const b = validarCuerpo("Hola {{ }}");
    expect(b.ok).toBe(false);
  });

  it("claves con espacios internos o caracteres fuera de [a-z0-9_] son malformadas", () => {
    expect(validarCuerpo("{{a b}}").ok).toBe(false);
    expect(validarCuerpo("{{á}}").ok).toBe(false);
    expect(validarCuerpo("{{cod-1}}").ok).toBe(false);
  });

  it("reporta el fragmento malformado", () => {
    const r = validarCuerpo("ok {{a-b}} fin");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.malformadas).toContain("{{a-b}}");
  });
});

describe("R18/R19: render sustituye todas las ocurrencias sin tocar el resto", () => {
  it("sustituye por el valor cuando la clave esta en el mapa de valores", () => {
    const out = renderPlantilla("Hola {{usuario}}, orden {{cod}}", {
      usuario: "Juan",
      cod: "ABC123",
    });
    expect(out).toBe("Hola Juan, orden ABC123");
  });

  // El marcador en MAYUSCULAS NO desaparece de `renderPlantilla`: sigue siendo la red de
  // seguridad para un llamador que no resuelva todas las claves. Lo que dejo de ser alcanzable
  // es el camino de la PREVIEW, que ahora resuelve una entrada por cada clave extraida.
  it("una clave AUSENTE del mapa de valores cae al marcador, sin romper la salida", () => {
    expect(renderPlantilla("Hola {{usuario}}, orden {{cod}}", { usuario: "Juan" })).toBe(
      "Hola Juan, orden COD",
    );
  });

  it("reemplaza TODAS las ocurrencias y NO altera el texto no-placeholder", () => {
    const out = renderPlantilla("{{x}} - {{x}} - literal {{ }} no", { x: "V" });
    expect(out).toBe("V - V - literal {{ }} no");
  });
});

/* -------------------------------------------------------------------------- */
/* Feature 282 — helpers de nombres y de claves sin campo                      */
/* -------------------------------------------------------------------------- */

describe("R17/R20: `nombresDeVariables` sella el snapshot `clave -> nombre`", () => {
  it("toma el nombre vigente del catalogo para cada clave conocida", () => {
    expect(nombresDeVariables(["monto", "cliente"])).toEqual({
      monto: "Monto a cobrar",
      cliente: "Cliente",
    });
  });

  // R20: una clave fuera del catalogo se persiste igual en `variables`, pero NO se le inventa
  // un nombre. Esa ausencia es lo que hace decidible la distincion de R16.
  it("una clave fuera del catalogo no entra en el mapa: no se le inventa nombre", () => {
    expect(nombresDeVariables(["sucursal"])).toEqual({});
    expect(nombresDeVariables(["cliente", "sucursal"])).toEqual({ cliente: "Cliente" });
  });

  // R19: `variables` es el array cuya POSICION es el numero de parametro de Meta. El snapshot
  // no puede tocarlo ni de lado.
  it("no muta el array de entrada ni altera su orden ni su contenido", () => {
    const variables = ["monto", "cliente", "sucursal"];
    const copia = [...variables];
    nombresDeVariables(variables);
    expect(variables).toEqual(copia);
  });

  it("R19: `extraerVariables` conserva su contrato — orden de aparicion y dedup", () => {
    const cuerpo = "{{monto}} y {{cliente}} y {{monto}}";
    expect(extraerVariables(cuerpo)).toEqual(["monto", "cliente"]);
    expect(Object.keys(nombresDeVariables(extraerVariables(cuerpo)))).toEqual([
      "monto",
      "cliente",
    ]);
  });

  it("un alias es una clave del catalogo como cualquier otra (R5)", () => {
    expect(nombresDeVariables(["num_guia"])).toEqual({ num_guia: "Número de guía" });
  });
});

describe("R13/R21: `etiquetaDeVariable` y sus tres caidas", () => {
  // El snapshot gana al catalogo: es lo que la plantilla decia cuando se guardo, y una
  // plantilla aprobada por Meta sobrevive a varias versiones del catalogo.
  it("el nombre persistido gana al del catalogo", () => {
    expect(etiquetaDeVariable("monto", { monto: "Etiqueta vieja" })).toEqual({
      texto: "Etiqueta vieja",
      enCatalogo: true,
    });
  });

  // R21: filas anteriores a la feature 282 no tienen snapshot y caen al catalogo.
  it("sin snapshot cae al catalogo vigente", () => {
    expect(etiquetaDeVariable("monto", {})).toEqual({
      texto: "Monto a cobrar",
      enCatalogo: true,
    });
  });

  it("sin snapshot y sin catalogo cae a la propia clave", () => {
    expect(etiquetaDeVariable("sucursal", {})).toEqual({
      texto: "sucursal",
      enCatalogo: false,
    });
  });

  // `enCatalogo` responde a otra pregunta —si la clave se RESUELVE hoy— y por eso no mira el
  // snapshot: una clave retirada trae etiqueta legible y sigue sin resolverse.
  it("`enCatalogo` es falso aunque haya nombre persistido, si la clave ya no esta", () => {
    expect(etiquetaDeVariable("sucursal", { sucursal: "Sucursal" })).toEqual({
      texto: "Sucursal",
      enCatalogo: false,
    });
  });
});

describe("R15/R16: `clavesSinCampo` nombra lo que llegaria vacio al cliente", () => {
  it("senala solo la clave que no esta en el catalogo, sin nombre persistido", () => {
    expect(clavesSinCampo("Hola {{cliente}} de {{sucursal}}", {})).toEqual([
      { clave: "sucursal", etiqueta: "sucursal", retirada: false },
    ]);
  });

  // R16: con nombre persistido, la clave ESTUVO en el catalogo y alguien la retiro. Son dos
  // avisos distintos porque piden acciones distintas del maestro.
  it("con nombre persistido la marca como RETIRADA y la identifica por ese nombre", () => {
    expect(clavesSinCampo("Hola {{cliente}} de {{sucursal}}", { sucursal: "Sucursal" })).toEqual([
      { clave: "sucursal", etiqueta: "Sucursal", retirada: true },
    ]);
  });

  // R5: un alias es una clave plenamente valida. Marcarlo como invalido seria el bug que
  // `aliasDe` existe para evitar.
  it("un alias NO es una clave invalida", () => {
    expect(clavesSinCampo("{{num_guia}}", {})).toEqual([]);
    expect(clavesSinCampo("{{total}} {{nombre}} {{destinatario}} {{num_remision}}", {})).toEqual(
      [],
    );
  });

  it("un cuerpo entero del catalogo no produce ningun aviso", () => {
    expect(clavesSinCampo("Hola {{cliente}}, total {{monto}}", {})).toEqual([]);
  });

  it("conserva el orden de aparicion y no repite una clave usada dos veces", () => {
    expect(clavesSinCampo("{{sucursal}} {{caja}} {{sucursal}}", {}).map((c) => c.clave)).toEqual([
      "sucursal",
      "caja",
    ]);
  });
});

// Feature 282 / design §4.4 — el catalogo VIEJO (`plantilla-variables.ts`, vacio) mandaba a
// Meta el marcador `MONTO` como valor de ejemplo del parametro. Ahora manda el mismo valor que
// el maestro ve en la vista previa. Solo cambia `example.body_text` de los create/update
// futuros: ni el `text` aprobado ni el orden de los parametros.
describe("el ejemplo que viaja a Meta sale del catalogo de campos", () => {
  it("`{{monto}}` viaja con su ejemplo formateado, no con el marcador en MAYUSCULAS", () => {
    const [body] = construirComponentsTemplate("Total {{monto}}", ["monto"]) as Array<{
      example: { body_text: string[][] };
    }>;
    expect(body.example.body_text[0][0]).toBe("₡12.500");
  });

  // El fallback NO se retira: Meta rechaza ejemplos vacios, asi que una clave fuera del
  // catalogo tiene que viajar con algo.
  it("una clave fuera del catalogo conserva el marcador derivado (Meta rechaza vacios)", () => {
    const [body] = construirComponentsTemplate("En {{sucursal}}", ["sucursal"]) as Array<{
      example: { body_text: string[][] };
    }>;
    expect(body.example.body_text[0][0]).toBe("SUCURSAL");
  });
});
