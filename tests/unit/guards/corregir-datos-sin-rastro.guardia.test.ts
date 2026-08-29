import { describe, it, expect } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { codigoSinComentarios, quitarComentarios } from "../../fixtures/sin-comentarios";

// GUARDIA DE LA FICHA 312 — LA AUSENCIA DE RASTRO SE MIDE, NO SE SUPONE.
//
// **Que decision protege.** El 2026-08-28 el humano cerro D4: corregir un dato del cliente NO deja
// rastro. Ni nota en el hilo, ni fila de historial, ni tabla de auditoria, ni un `console.log` con
// el telefono. El unico rastro es el `updated_at` de la fila. La alternativa —la nota automatica—
// esta EVALUADA Y DESCARTADA en `design.md` §8/B, con lo que costaba y lo que daba.
//
// **Por que hace falta una guardia y no basta el codigo.** Un requisito NEGATIVO sin test es
// indistinguible de un olvido: nadie puede mirar un archivo y demostrar que algo NO ocurre en
// ningun sitio. Y la tentacion de «dejar solo un logcito» aparece justo cuando alguien depura un
// caso raro en produccion — sin ruido, sin romper nada y sin que ningun test rojo lo cace. Esta
// guardia es el ruido.
//
// **Las tres ausencias que vigila**, y cada una tiene su motivo:
//  - RASTRO PERSISTIDO (R14, C3): ningun modulo de la ficha importa el hilo de notas ni escribe en
//    `orden_historial_estado`. La otra mitad de R14 —contar filas contra Postgres— vive en
//    `tests/integration/db/corregir-datos-cliente.repo.test.ts`; esta es la mitad estructural.
//  - RASTRO EN LOGS (R16, D3): ni un `console.` en los modulos de la ficha. El destinatario, el
//    telefono, el producto y las notas son datos de una persona; un `console.error("fallo", input)`
//    los vuelca enteros al log de la plataforma, donde los lee quien nunca tuvo permiso, y no
//    rompe nada. La prohibicion es de `console` A SECAS —tecnica tomada de
//    `orden-nota-frontera.guardia`, que se cita solo como precedente del MECANISMO: esta ficha no
//    toca el hilo de notas—.
//  - ESCRITURAS DE CHAT (R19, G2, D5): la ficha no llama a `migrarTelefono` ni a ninguna otra
//    escritura del modulo de chat. El hilo viejo se queda EXACTAMENTE donde esta (design §5.3).
//
// **El detector se auto-prueba** (bloque 0). Una guardia estatica rota no falla: calla. Si el
// escaner no encontrara nada, todos los `toEqual([])` de abajo pasarian para siempre.
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo.

const RAIZ = path.resolve(__dirname, "../../..");

/**
 * Los modulos que ESTA ficha crea o amplia. Censo DECLARADO —los archivos no entran solos— y con
 * control de no-vacuidad (bloque 1).
 *
 * ⚠️ **LA PANTALLA ENTRA EN EL CENSO, Y ESO ES LA MITAD DE R16.** Hasta el 2026-08-28 esta lista
 * eran los cuatro modulos del backend, y con razon: la ficha entro en dos tandas y la primera no
 * tenia pantalla. Pero un censo que se queda en el backend deja fuera justo donde los datos del
 * cliente se TECLEAN y se PINTAN — un `console.log(orden.telefonoDest)` puesto para depurar la
 * ventana los vuelca enteros al log del navegador y de la plataforma, no rompe ningun test y nadie
 * se entera. La guardia seguiria verde vigilando codigo que ya no es donde esta el riesgo, que es
 * la peor forma de fallar.
 *
 * Los dos ultimos son archivos COMPARTIDOS con otras fichas (`/novedades` los tenia desde la 236 y
 * la 240): entran porque esta ficha les anade su celda y su ventana, y porque pintan el
 * destinatario y el telefono de cada fila. Estaban limpios de `console` el dia que entraron.
 */
const MODULOS_DE_LA_FICHA = [
  "lib/types/correccion-datos-cliente.ts",
  "lib/interfaces/services/ICorregirDatosClienteService.ts",
  "lib/services/CorregirDatosClienteService.ts",
  "lib/actions/corregir-datos-cliente.ts",
  // Bloque E — la superficie del modulo de ordenes (`maestro`/`admin`).
  "app/(app)/ordenes/_components/CorregirDatosClienteModal.tsx",
  "app/(app)/ordenes/_components/CorregirDatosClienteAccion.tsx",
  "app/(app)/ordenes/_components/corregir-datos-cliente-error-messages.ts",
  // Bloque F — la superficie de `/novedades` (`adminTienda`, en los DOS grupos).
  "app/(app)/novedades/_components/NovedadAcciones.tsx",
  "app/(app)/novedades/_components/NovedadesModule.tsx",
  // ⚠️ FICHA 327 / E1 — EL PANEL DEL AVISO DEL IMPORTE. La tanda de backend dejo aqui escrita la
  // entrada que faltaba, DENTRO del array y no en una nota lejana, porque `existsSync` de abajo
  // habria puesto la guardia roja por un archivo que aun no se habia escrito — y una guardia roja
  // «por lo normal» es una guardia que se acaba ignorando. El archivo ya existe (2026-08-29) y la
  // entrada entra donde tenia que entrar.
  //
  // Es el componente que recibe la UBICACION y los IMPORTES de una orden real, asi que es
  // exactamente donde un `console.log(aviso)` puesto para depurar el panel volcaria la zona, el
  // distrito y el flete al log del navegador sin romper nada.
  "app/(app)/ordenes/_components/CorregirUbicacionAviso.tsx",
] as const;

/** El repositorio NO entra entero (tiene medio centenar de escrituras legitimas): entra el CUERPO
 *  del metodo que esta ficha añade, extraido del archivo real. */
const REPOSITORIO = "lib/repositories/OrdenRepository.ts";

// ---------------------------------------------------------------------------
// El detector
// ---------------------------------------------------------------------------

/** `console.<lo que sea>(`. La prohibicion es de `console` a secas: ver la cabecera. */
const CONSOLA = /\bconsole\s*\.\s*\w+\s*\(/;

/** El hilo de notas de la orden, por cualquiera de sus puertas. */
const HILO_DE_NOTAS =
  /\b(OrdenNotaRepository|OrdenNotaService|IOrdenNotaRepository|IOrdenNotaService|ordenNota|orden_nota|orden-nota|orden-notas)\b/;

/** El historial de estados, por cualquiera de las suyas. */
const HISTORIAL_DE_ESTADO =
  /\b(appendCambioEstado|ordenHistorialEstado|orden_historial_estado|OrdenHistorialRepository|OrdenHistorialService|registrar-cambio-estado)\b/;

/** Escrituras del modulo de chat. La LECTURA no esta prohibida; escribir el hilo, si (D5). */
const ESCRITURA_DE_CHAT =
  /\b(migrarTelefono|upsertParaOrden|marcarUltimoEntrante|ChatConversacionRepository|ChatMensajeRepository|ChatWhatsappService|chatConversacion|chat_conversacion)\b/;

/** El vocabulario que NO puede acabar interpolado en un texto que se le enseña a alguien. */
const PII = /\b(destinatario|telefono|telefonoDest|producto|notas|direccion)\b/i;

/** Las claves cuyo valor es un texto de rechazo, y los `throw new Error(...)`. */
const CLAVE_DE_RECHAZO = /^(rechazo|fallo|error|aviso|mensaje|motivo|sesion|message)/i;

/**
 * El cuerpo del metodo `corregirDatosCliente` de `OrdenRepository`, recortado del archivo REAL por
 * llaves balanceadas. Si el metodo se renombra o desaparece, esto lanza en vez de medir vacio.
 */
function cuerpoDeCorregirEnRepositorio(): string {
  const codigo = codigoSinComentarios(REPOSITORIO);
  const inicio = codigo.indexOf("async corregirDatosCliente(");
  if (inicio === -1) {
    throw new Error(
      `no se encontro \`async corregirDatosCliente(\` en ${REPOSITORIO}: o se renombro o se ` +
        "borro, y esta guardia estaria midiendo la nada",
    );
  }
  const desdeLlave = codigo.indexOf("{", codigo.indexOf(")", inicio));
  let profundidad = 0;
  for (let i = desdeLlave; i < codigo.length; i++) {
    if (codigo[i] === "{") profundidad++;
    else if (codigo[i] === "}") {
      profundidad--;
      if (profundidad === 0) return codigo.slice(desdeLlave, i + 1);
    }
  }
  throw new Error("el cuerpo de `corregirDatosCliente` no cierra: el recortador esta roto");
}

/** Textos de rechazo de un modulo: valores de claves de rechazo + argumentos de `throw new Error`. */
function textosDeRechazo(codigo: string): string[] {
  const salida: string[] = [];
  for (const m of codigo.matchAll(/(\w+)\s*:\s*(`[^`]*`|"[^"]*"|'[^']*')/g)) {
    if (CLAVE_DE_RECHAZO.test(m[1])) salida.push(m[2]);
  }
  for (const m of codigo.matchAll(/throw\s+new\s+\w*Error\s*\(([^;]*?)\)\s*;/g)) {
    salida.push(m[1]);
  }
  return salida;
}

const CODIGO: { ruta: string; codigo: string }[] = [
  ...MODULOS_DE_LA_FICHA.map((ruta) => ({ ruta, codigo: codigoSinComentarios(ruta) })),
  { ruta: `${REPOSITORIO}#corregirDatosCliente`, codigo: cuerpoDeCorregirEnRepositorio() },
];

// ---------------------------------------------------------------------------
// 0 — El detector, probado contra respuestas conocidas (en las DOS direcciones)
// ---------------------------------------------------------------------------

describe("312 — el detector de rastro se prueba a si mismo", () => {
  it("CONTRAPRUEBA: cada patron ENCUENTRA lo que persigue", () => {
    expect(CONSOLA.test('console.log(orden.telefonoDest)')).toBe(true);
    expect(CONSOLA.test('console  .  error("x")')).toBe(true);
    expect(HILO_DE_NOTAS.test('import { OrdenNotaRepository } from "@/lib/repositories/OrdenNotaRepository";')).toBe(true);
    expect(HILO_DE_NOTAS.test("await tx.ordenNota.create({ data })")).toBe(true);
    expect(HISTORIAL_DE_ESTADO.test("await appendCambioEstado(tx, [entrada]);")).toBe(true);
    expect(HISTORIAL_DE_ESTADO.test("tx.ordenHistorialEstado.create({})")).toBe(true);
    expect(ESCRITURA_DE_CHAT.test("await chatRepo.migrarTelefono(viejo, nuevo);")).toBe(true);
    expect(PII.test("`no se pudo guardar el telefono ${x}`")).toBe(true);
  });

  it("CONTRAPRUEBA: los patrones NO se disparan con codigo inocente", () => {
    expect(CONSOLA.test("const consolelike = 1;")).toBe(false);
    expect(HILO_DE_NOTAS.test("data.notas = null;")).toBe(false); // `notas` de la ORDEN no es el hilo
    expect(HISTORIAL_DE_ESTADO.test("const estatusValue = orden.estatusValue;")).toBe(false);
    expect(ESCRITURA_DE_CHAT.test("normalizarTelefonoWa(telefono)")).toBe(false);
  });

  it("CONTRAPRUEBA: un `console.log` inyectado en un modulo de la ficha se detecta", () => {
    // La contraprueba que pide D3, hecha sobre el TEXTO REAL del modulo: se le pega la linea
    // prohibida y el mismo barrido que abajo da verde tiene que dar rojo aqui.
    const real = codigoSinComentarios("lib/services/CorregirDatosClienteService.ts");
    expect(CONSOLA.test(real)).toBe(false);
    expect(CONSOLA.test(`${real}\nconsole.log(orden.telefonoDest);`)).toBe(true);
  });

  it("CONTRAPRUEBA: un import del hilo de notas inyectado se detecta", () => {
    const real = codigoSinComentarios("lib/services/CorregirDatosClienteService.ts");
    expect(HILO_DE_NOTAS.test(real)).toBe(false);
    const conImport = quitarComentarios(
      `import { OrdenNotaRepository } from "@/lib/repositories/OrdenNotaRepository";\n${real}`,
    );
    expect(HILO_DE_NOTAS.test(conImport)).toBe(true);
  });

  it("CONTRAPRUEBA: el recortador del repositorio recorta el metodo, no el archivo entero", () => {
    const cuerpo = cuerpoDeCorregirEnRepositorio();
    const archivo = codigoSinComentarios(REPOSITORIO);
    expect(cuerpo.length).toBeGreaterThan(120);
    expect(cuerpo.length).toBeLessThan(archivo.length / 10);
    expect(cuerpo).toContain("updateMany");
    expect(cuerpo).toContain("estadosBloqueados");
    // Y es el metodo de ESTA ficha, no el de al lado: `update` si escribe historial.
    expect(archivo).toContain("appendCambioEstado");
  });
});

// ---------------------------------------------------------------------------
// 1 — Anti-vacuidad: el censo existe y se leyo de verdad
// ---------------------------------------------------------------------------

describe("312 — anti-vacuidad del censo", () => {
  it("todos los fragmentos vigilados existen y ninguno esta vacio", () => {
    for (const ruta of MODULOS_DE_LA_FICHA) {
      expect(existsSync(path.join(RAIZ, ruta)), `falta ${ruta}`).toBe(true);
    }
    expect(CODIGO).toHaveLength(MODULOS_DE_LA_FICHA.length + 1);
    for (const { ruta, codigo } of CODIGO) {
      expect(codigo.trim().length, `${ruta} se leyo vacio`).toBeGreaterThan(80);
    }
  });

  it("los modulos son los de la ficha y no otros: se reconocen por su contenido", () => {
    const porRuta = new Map(CODIGO.map((c) => [c.ruta, c.codigo]));
    expect(porRuta.get("lib/types/correccion-datos-cliente.ts")).toContain("CAMPOS_CORREGIBLES");
    expect(porRuta.get("lib/services/CorregirDatosClienteService.ts")).toContain(
      "class CorregirDatosClienteService",
    );
    expect(porRuta.get("lib/actions/corregir-datos-cliente.ts")).toContain('"use server"');
    // Y los de la PANTALLA, por su contenido y no por su nombre de archivo: si alguien renombrara
    // el componente y dejara la ruta, este censo estaria midiendo otra cosa.
    expect(porRuta.get("app/(app)/ordenes/_components/CorregirDatosClienteModal.tsx")).toContain(
      "export function CorregirDatosClienteModal",
    );
    expect(porRuta.get("app/(app)/ordenes/_components/CorregirDatosClienteAccion.tsx")).toContain(
      "export function CorregirDatosClienteAccion",
    );
    expect(
      porRuta.get("app/(app)/ordenes/_components/corregir-datos-cliente-error-messages.ts"),
    ).toContain("corregirDatosClienteErrorMessage");
    // FICHA 327 — el panel del aviso, por su export y no por su nombre de archivo.
    expect(porRuta.get("app/(app)/ordenes/_components/CorregirUbicacionAviso.tsx")).toContain(
      "export function CorregirUbicacionAviso",
    );
    // Los dos compartidos: se reconocen por la celda y la ventana que ESTA ficha les anadio.
    expect(porRuta.get("app/(app)/novedades/_components/NovedadAcciones.tsx")).toContain(
      "corregirDatos",
    );
    expect(porRuta.get("app/(app)/novedades/_components/NovedadesModule.tsx")).toContain(
      "CorregirDatosClienteModal",
    );
  });
});

// ---------------------------------------------------------------------------
// C3 / R14 — ningun rastro PERSISTIDO
// ---------------------------------------------------------------------------

describe("312 / R14 — la correccion no escribe en ninguna otra tabla", () => {
  it("ningun modulo de la ficha toca el HILO DE NOTAS de la orden", () => {
    // D4: no hay nota automatica. Y de paso desaparece la incoherencia que el diseño habia
    // detectado (`maestro` escribiendo un rastro que el mismo no puede leer, design §8/B punto 4).
    const hallazgos = CODIGO.filter(({ codigo }) => HILO_DE_NOTAS.test(codigo)).map((c) => c.ruta);
    expect(hallazgos, "un modulo de la ficha 312 toca el hilo de notas: eso ES la nota automatica que D4 retiro").toEqual([]);
  });

  it("ningun modulo de la ficha escribe en el HISTORIAL DE ESTADO", () => {
    // No es solo disciplina: `CorregirDatosClienteData` no puede expresar `estatusId`, asi que el
    // camino es estructuralmente incapaz de disparar el `appendCambioEstado` de `update`. Esto lo
    // confirma por el otro lado, sobre el texto.
    const hallazgos = CODIGO.filter(({ codigo }) => HISTORIAL_DE_ESTADO.test(codigo)).map(
      (c) => c.ruta,
    );
    expect(hallazgos).toEqual([]);
  });

  it("el tipo de escritura del repositorio NO admite ninguno de los SIETE prohibidos", () => {
    // La defensa estructural de 312/R5-R14 y 327/R24, leida del archivo que la declara. Si alguien
    // añade uno de estos campos, la garantia pasa de «no representable» a «que nadie se olvide»,
    // que es exactamente el estado que las dos fichas vinieron a evitar.
    //
    // ⚠️ ACTUALIZADO POR LA FICHA 327, Y LA EXCLUSION QUEDA MAS ESTRECHA, NO MAS FLOJA. Se retira
    // UNA sola clausula —`direccion`, que es el alcance que la 327 abre a proposito (su D1)— y se
    // AÑADEN CUATRO: `cobraComision`, `numGuia`, `numRemision` y `mensajeroAsignado`. Este archivo
    // pasa de documentar una exclusion vaga a documentar una lista enumerada, y sigue poniendose
    // rojo si alguien mete `estatusId`.
    const interfaz = codigoSinComentarios("lib/interfaces/repositories/IOrdenRepository.ts");
    const inicio = interfaz.indexOf("interface CorregirDatosClienteData");
    expect(inicio, "desaparecio `CorregirDatosClienteData`").toBeGreaterThan(-1);
    const bloque = interfaz.slice(inicio, interfaz.indexOf("}", inicio));
    // Los DIEZ que si estan (312 + 327/D1, mas la zona que DERIVA el servidor).
    expect(bloque).toContain("destinatario");
    expect(bloque).toContain("telefonoDest");
    expect(bloque).toContain("producto");
    expect(bloque).toContain("notas");
    expect(bloque).toContain("direccion");
    expect(bloque).toContain("provinciaId");
    expect(bloque).toContain("cantonId");
    expect(bloque).toContain("distritoId");
    expect(bloque).toContain("zonaId");
    expect(bloque).toContain("peso");
    // Y LOS SIETE QUE NO, uno por uno.
    expect(bloque).not.toContain("estatusId");
    expect(bloque).not.toContain("tiendaId");
    expect(bloque).not.toContain("montoCobrar");
    expect(bloque).not.toContain("cobraComision");
    expect(bloque).not.toContain("numGuia");
    expect(bloque).not.toContain("numRemision");
    expect(bloque).not.toContain("mensajeroAsignado");
  });

  it("327/R5 — `zonaId` esta en el tipo del repositorio pero NO en el schema del borde", () => {
    // La distincion entera de R5, medida en los DOS archivos a la vez. El tipo la admite porque el
    // SERVIDOR la escribe; el borde no, porque el CLIENTE no puede mandarla. Si algun dia el
    // `.pick()` la incluyera, la correccion pasaria a mover el flete facturado sin derivar nada del
    // distrito — y el test de arriba, que solo mira el tipo, seguiria verde.
    const tipos = codigoSinComentarios("lib/types/correccion-datos-cliente.ts");
    const inicio = tipos.indexOf("corregirDatosClienteSchema = actualizarOrdenSchema");
    expect(inicio, "desaparecio `corregirDatosClienteSchema`").toBeGreaterThan(-1);
    const pick = tipos.slice(inicio, tipos.indexOf(".strict()", inicio));
    // Anti-vacuidad: el recorte ES el `.pick(...)` y trae lo que tiene que traer.
    expect(pick).toContain("distritoId");
    expect(pick).toContain("direccion");
    expect(pick).not.toContain("zonaId");
    expect(pick).not.toContain("estatusId");
  });

  it("no hay migracion de esta ficha: no hay rastro que persistir", () => {
    // design §2.1, elevado a invariante por D4. Si aparece una tabla `orden_correccion_dato` o
    // similar, alguien se salio del alcance.
    const migraciones = path.join(RAIZ, "db/migrations");
    expect(existsSync(migraciones), "no existe `db/migrations`: este barrido mediria la nada").toBe(
      true,
    );
    const todas = readdirSync(migraciones);
    expect(todas.length, "el directorio de migraciones se leyo vacio").toBeGreaterThan(10);
    const sospechosas = todas.filter((d) =>
      /correccion_dato|corregir_dato|correccion_cliente|datos_cliente|auditoria/i.test(d),
    );
    expect(sospechosas).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// D3 / R16 — ningun rastro EN LOGS
// ---------------------------------------------------------------------------

describe("312 / R16 — ni un dato del cliente en los registros", () => {
  it("ningun modulo de la ficha usa `console`", () => {
    const hallazgos = CODIGO.filter(({ codigo }) => CONSOLA.test(codigo)).map((c) => c.ruta);
    expect(
      hallazgos,
      "un `console` en estos modulos vuelca el destinatario o el telefono al log de la plataforma, " +
        "donde lo lee quien nunca tuvo permiso, y no rompe nada",
    ).toEqual([]);
  });

  it("ningun texto de rechazo interpola los datos del cliente", () => {
    const hallazgos: string[] = [];
    for (const { ruta, codigo } of CODIGO) {
      for (const texto of textosDeRechazo(codigo)) {
        if (PII.test(texto)) hallazgos.push(`${ruta}: ${texto}`);
      }
    }
    expect(hallazgos).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// G2 / R19 — el modulo de chat no se toca
// ---------------------------------------------------------------------------

describe("312 / R19 — la ficha no escribe nada en el modulo de chat", () => {
  it("ningun modulo de la ficha llama a `migrarTelefono` ni a ninguna otra escritura del hilo", () => {
    // design §5.3 y D5. `migrarTelefono` EXISTE (feature 311) y daria continuidad al hilo viejo.
    // Se descarta porque aqui el numero estaba MAL ESCRITO: ese hilo es una conversacion con OTRA
    // persona, y coserlo al historial del cliente correcto no es continuidad, es contaminacion de
    // evidencia.
    const hallazgos = CODIGO.filter(({ codigo }) => ESCRITURA_DE_CHAT.test(codigo)).map(
      (c) => c.ruta,
    );
    expect(hallazgos).toEqual([]);
  });

  it("lo unico que la ficha usa del vocabulario de WhatsApp es la NORMALIZACION, y solo para validar", () => {
    // Control positivo: si el barrido de arriba estuviera midiendo la nada, esto lo delataria.
    // `normalizarTelefonoWa` SI se usa (R18), y no escribe nada: es una funcion pura.
    const servicio = codigoSinComentarios("lib/services/CorregirDatosClienteService.ts");
    expect(servicio).toContain("normalizarTelefonoWa");
    expect(servicio).toContain("@/lib/utils/whatsapp-telefono");
  });
});
