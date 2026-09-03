import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { quitarComentarios } from "../../fixtures/sin-comentarios";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 362 / T7.4 (R5) — NI UN DATO DE CLIENTE, NI UN TEXTO LIBRE, EN LA FILA DEL REGISTRO.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// QUE PROTEGE. `historial_accion` se consulta desde una pantalla, se DESCARGA a un archivo y no
// tiene purga (R39): lo que entre ahi se queda para siempre y sale de la casa en un `.xlsx`. Por
// eso la fila no puede llevar el nombre, el telefono, la direccion ni el correo del destinatario
// de una orden, NI NINGUN TEXTO LIBRE escrito por una persona —el `motivo` de un rechazo es el
// vector canonico: «rechazado porque el cliente Juan Perez no estaba»—.
//
// Y TAMPOCO SECRETOS: ni `passwordHash`, ni `keyHash`, ni el prefijo de una API key.
//
// DONDE SE BARRE, y por que ahi:
//   - `etiquetaDeEntidad` (`lib/types/historial-accion-etiquetas.ts`): es la FUENTE UNICA de la
//     columna `entidad_etiqueta`. Si el vocabulario prohibido no aparece aqui, no puede llegar a
//     la columna por la via normal;
//   - los BLOQUES `appendAccion(...)` de los 43 puntos de escritura: es la via anormal — pasar la
//     etiqueta a mano, o meter la direccion en `valorNuevo`. Se recorta el bloque de la llamada,
//     no el metodo entero: el `data` del `UPDATE` de `corregirDatosCliente` SI escribe la
//     direccion, y eso es su trabajo.
//
// EL DETECTOR SE AUTO-PRUEBA (bloque 0), porque una guardia estatica rota no falla: CALLA.
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo.

const RAIZ = path.resolve(__dirname, "../../..");

/**
 * ⚠️ EL VOCABULARIO PROHIBIDO. Cada nombre es una columna real de este esquema que contiene un
 * dato de una persona, un texto libre o un secreto.
 *
 * `concepto` NO esta, y es la unica excepcion, declarada y razonada: la etiqueta de un
 * `gasto_fijo_cobro` lo usa, y es una etiqueta de CATALOGO copiada de la plantilla de un gasto
 * recurrente de la casa —del mismo genero que el nombre de una zona—, no un texto por
 * transaccion. Su justificacion vive junto a su entrada del mapa de etiquetas.
 */
const PROHIBIDO = [
  "destinatario",
  "telefonoDest",
  "telefono_dest",
  "direccion",
  "email",
  "cedula",
  "notas",
  "motivoRechazo",
  "motivo_rechazo",
  "passwordHash",
  "password_hash",
  "keyHash",
  "key_hash",
  "keyPrefix",
  "key_prefix",
  "secret",
  "descripcion",
] as const;

/** `motivo` a secas, sin pegarse a `motivoRechazo` (que ya esta arriba). */
const MOTIVO_SUELTO = /\bmotivo\b/;

/** Los archivos con al menos un `appendAccion`, que son los 43 puntos de escritura. */
const PUNTOS_DE_ESCRITURA = [
  "lib/repositories/OrdenRepository.ts",
  "lib/repositories/UserRepository.ts",
  "lib/repositories/TarifaRepository.ts",
  "lib/repositories/ZonaRepository.ts",
  "lib/repositories/VehiculoRepository.ts",
  "lib/repositories/PlantillaMensajeRepository.ts",
  "lib/repositories/ApiKeyRepository.ts",
  "lib/repositories/AprobacionPostulacionRepository.ts",
  "lib/repositories/CierresAdminRepository.ts",
  "lib/repositories/CierresBodegaAdminRepository.ts",
  "lib/repositories/LiquidacionPagoRepository.ts",
  "lib/repositories/LiquidacionRepartoRepository.ts",
  "lib/repositories/WalletMovimientoRepository.ts",
  "lib/repositories/IncidenteAdminRepository.ts",
  "lib/repositories/GastoFijoCobroRepository.ts",
  "lib/repositories/RechazoTiendaCobroRepository.ts",
  "lib/repositories/RankingSnapshotRepository.ts",
] as const;

const FUENTE_ETIQUETAS = "lib/types/historial-accion-etiquetas.ts";

function fuente(rel: string): string {
  return quitarComentarios(readFileSync(path.join(RAIZ, rel), "utf8"));
}

/**
 * Los bloques `appendAccion(...)` de un archivo, recortados desde la llamada hasta el cierre de
 * su array de entradas. Uno por llamada.
 */
export function bloquesDeAppend(codigo: string): string[] {
  const salida: string[] = [];
  let desde = 0;
  for (;;) {
    const i = codigo.indexOf("appendAccion(", desde);
    if (i === -1) break;
    // El cierre es el `]);` o el `),` de la forma con `map(...)`: se toma el primero que aparezca
    // despues, y si no hay ninguno, un tope de caracteres para no arrastrar el archivo entero.
    const finArray = codigo.indexOf("]);", i);
    const finMap = codigo.indexOf("})),", i);
    const candidatos = [finArray, finMap].filter((n) => n !== -1);
    const fin = candidatos.length > 0 ? Math.min(...candidatos) + 3 : Math.min(i + 1200, codigo.length);
    salida.push(codigo.slice(i, fin));
    desde = fin;
  }
  return salida;
}

/** Los nombres prohibidos que aparecen en un texto. */
export function prohibidosEn(texto: string): string[] {
  const hallazgos = PROHIBIDO.filter((nombre) =>
    new RegExp(`\\b${nombre}\\b`).test(texto),
  ) as string[];
  if (MOTIVO_SUELTO.test(texto)) hallazgos.push("motivo");
  return hallazgos.sort();
}

// ---------------------------------------------------------------------------------------------
// 0 — El detector, probado contra respuestas conocidas
// ---------------------------------------------------------------------------------------------

describe("362/T7.4 — el detector se prueba a si mismo", () => {
  it("CONTRAPRUEBA: reconoce el vocabulario prohibido", () => {
    expect(prohibidosEn("entidadEtiqueta: orden.destinatario,")).toContain("destinatario");
    expect(prohibidosEn("valorNuevo: data.direccion,")).toContain("direccion");
    expect(prohibidosEn("valorAnterior: cierre.motivoRechazo,")).toContain("motivoRechazo");
    expect(prohibidosEn("entidadEtiqueta: input.motivo,")).toContain("motivo");
    expect(prohibidosEn("entidadEtiqueta: key.keyPrefix,")).toContain("keyPrefix");
    expect(prohibidosEn("entidadEtiqueta: mov.descripcion,")).toContain("descripcion");
  });

  it("CONTRAPRUEBA: NO se dispara con vocabulario inocente", () => {
    expect(prohibidosEn('entidadEtiqueta: etiquetaDeEntidad("orden", fila),')).toEqual([]);
    expect(prohibidosEn("monto: fila.totalGeneral,")).toEqual([]);
    // `motivacion` NO es `motivo`: el `\b` lo separa.
    expect(prohibidosEn("const motivacion = 1;")).toEqual([]);
  });

  it("CONTRAPRUEBA: el recortador encuentra los bloques y no el archivo entero", () => {
    const codigo = fuente("lib/repositories/VehiculoRepository.ts");
    const bloques = bloquesDeAppend(codigo);
    expect(bloques).toHaveLength(1);
    expect(bloques[0]).toContain("vehiculo_borrado");
    expect(bloques[0].length).toBeLessThan(codigo.length / 2);
  });

  it("anti-vacuidad: el censo de puntos de escritura no esta vacio y todos tienen `appendAccion`", () => {
    expect(PUNTOS_DE_ESCRITURA.length).toBeGreaterThan(15);
    for (const rel of PUNTOS_DE_ESCRITURA) {
      const bloques = bloquesDeAppend(fuente(rel));
      expect(bloques.length, `${rel} no llama a \`appendAccion\``).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// R5 — la fuente de la etiqueta
// ---------------------------------------------------------------------------------------------

describe("362/R5 — `etiquetaDeEntidad` no lee ni un dato de cliente", () => {
  it("la fuente unica de la etiqueta esta limpia de vocabulario prohibido", () => {
    const hallazgos = prohibidosEn(fuente(FUENTE_ETIQUETAS));
    expect(
      hallazgos,
      "la etiqueta CONGELADA se descarga a un archivo y no se purga nunca: lo que entre ahi sale " +
        "de la casa",
    ).toEqual([]);
  });

  it("CONTRAPRUEBA: inyectar `destinatario` en la fuente de la etiqueta se detecta", () => {
    const real = fuente(FUENTE_ETIQUETAS);
    expect(prohibidosEn(real)).toEqual([]);
    expect(prohibidosEn(`${real}\n  orden: (f) => f.destinatario,`)).toContain("destinatario");
  });

  it("control positivo: la etiqueta SI usa las fuentes admitidas", () => {
    // Si el barrido de arriba estuviera midiendo un archivo vacio, esto lo delataria.
    const real = fuente(FUENTE_ETIQUETAS);
    for (const admitido of ["numGuia", "numRemision", "mensajeroNombre", "identificador"]) {
      expect(real, `la etiqueta ya no usa \`${admitido}\``).toContain(admitido);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// R5 — las 43 llamadas al punto unico
// ---------------------------------------------------------------------------------------------

describe("362/R5 — ninguna llamada a `appendAccion` mete un dato de cliente en la fila", () => {
  it.each(PUNTOS_DE_ESCRITURA)("%s", (rel) => {
    const bloques = bloquesDeAppend(fuente(rel));
    const hallazgos = bloques.flatMap((bloque, i) =>
      prohibidosEn(bloque).map((nombre) => `${rel} (llamada ${i + 1}): ${nombre}`),
    );
    expect(
      hallazgos,
      "una columna del cliente en la fila del registro reabre D4 de la 312 de verdad, y esta vez " +
        "en una tabla que se descarga y no se purga",
    ).toEqual([]);
  });

  it("CONTRAPRUEBA: inyectar `entidadEtiqueta: orden.destinatario` en un bloque real se detecta", () => {
    const bloque = bloquesDeAppend(fuente("lib/repositories/OrdenRepository.ts"))[0];
    expect(prohibidosEn(bloque)).toEqual([]);
    const mutado = bloque.replace("entidadEtiqueta:", "entidadEtiqueta: orden.destinatario, //");
    expect(prohibidosEn(mutado)).toContain("destinatario");
  });

  it("CONTRAPRUEBA: inyectar `valorNuevo: cierre.motivoRechazo` en un bloque real se detecta", () => {
    const bloque = bloquesDeAppend(fuente("lib/repositories/CierresAdminRepository.ts"))[0];
    expect(prohibidosEn(bloque)).toEqual([]);
    const mutado = bloque.replace("monto:", "valorNuevo: cierre?.motivoRechazo, monto:");
    expect(prohibidosEn(mutado)).toContain("motivoRechazo");
  });
});
