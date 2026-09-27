import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";
import type { RolValue } from "@prisma/client";

import { leerCatalogoAyuda } from "@/lib/ayuda/catalogo";
import { ROLES_AYUDA, documentosQuePuedeLeer, puedeLeerDocumento } from "@/lib/ayuda/documento";
import { contextoPara } from "@/lib/asistente/contexto";
import { AsistenteService } from "@/lib/services/AsistenteService";
import type { IAsistenteUsoRepository } from "@/lib/interfaces/repositories/IAsistenteUsoRepository";
import { DobleProveedor } from "./_doble-proveedor";

/**
 * ⭑ FICHA 436 · R9, R10, R11 — EL CORAZÓN DE LA FICHA: EL CONTEXTO SE ACOTA POR ROL.
 *
 * ⚠️ QUÉ PASA SI ESTO NO ESTÁ, dicho con nombre y apellido: un mensajero le pregunta al asistente
 * «¿cómo funciona la caja?» y el asistente se lo explica, porque tiene delante
 * `oficina/wallet-caja.md`. Y entonces el acotamiento de la 433 —que se tomó el trabajo de poner un
 * `notFound()` en el servidor— queda decorativo: puerta cerrada en `/ayuda`, ventana abierta en el
 * chat. No es una optimización de coste; es la misma regla de acceso en la segunda puerta.
 *
 * ⚠️ CÓMO SE MIDE, Y POR QUÉ ASÍ. No se comprueba `contextoPara` a solas: se corre **el servicio
 * real** contra un doble del proveedor y se mira **el texto que de verdad se habría enviado**. Un
 * test sobre la función pura seguiría verde si alguien construyera el contexto bien y luego mandara
 * otra cosa.
 */

const docs = await leerCatalogoAyuda();

const DIR_OFICINA = path.resolve(__dirname, "../../../docs/ayuda/oficina");

/** Un repositorio de uso que no toca nada: aquí no se mide el tope. */
const usoRepoMudo: IAsistenteUsoRepository = {
  consumirUnaConsulta: async () => 1,
  contarNoLoSe: async () => undefined,
};

/** Corre el servicio REAL con un doble del proveedor y devuelve lo que se habría enviado. */
async function loQueSeEnvia(rol: RolValue) {
  const proveedor = new DobleProveedor();
  const servicio = new AsistenteService({
    proveedor,
    usoRepo: usoRepoMudo,
    leerCatalogo: leerCatalogoAyuda,
    maxConsultasDia: 30,
  });
  const resultado = await servicio.responder({
    actor: { usuarioId: "u-1", rol },
    mensajes: [{ autor: "usuario", texto: "¿cómo funciona la caja?" }],
  });
  // El stream hay que consumirlo: si no, el generador queda a medias.
  if (resultado.status === "ok") for await (const _ of resultado.trozos) void _;
  return { proveedor, resultado };
}

describe("R9 — el conjunto sale del catálogo y del predicado IMPORTADO, nunca de una lista a mano", () => {
  it("⭑ para los cinco roles, el contexto es exactamente lo que ese rol PUEDE LEER en /ayuda", async () => {
    // Éste es el ancla estructural: si mañana la 435 —o quien sea— mueve el predicado debajo, el
    // asistente se mueve con él. La reimplementación es el error que la revisión de la 433 ya
    // cazó una vez, y aquí sería peor: el módulo de ayuda cerraría la puerta y el asistente la
    // dejaría abierta.
    for (const rol of ROLES_AYUDA) {
      const { proveedor } = await loQueSeEnvia(rol);
      const enviados = proveedor.llamadas[0].documentos.map((d) => d.slug).sort();
      const puedeLeer = documentosQuePuedeLeer(docs, rol)
        .map((d) => d.slug)
        .sort();
      expect(enviados, rol).toEqual(puedeLeer);
    }
  });

  it("⭑ y es el predicado de LECTURA, el mismo que decide si /ayuda/<slug> se abre o da 404", async () => {
    // Documento a documento y rol a rol: no hay ni uno que entre en el contexto y no se pueda
    // abrir, ni uno que se pueda abrir y se quede fuera. Si alguien cambiara `contextoPara` al
    // predicado ESTRICTO, maestro y admin perderían diez documentos y esto lo diría por su slug.
    const discrepancias: string[] = [];
    for (const rol of ROLES_AYUDA) {
      const { proveedor } = await loQueSeEnvia(rol);
      const enviados = new Set(proveedor.llamadas[0].documentos.map((d) => d.slug));
      for (const doc of docs) {
        const abre = puedeLeerDocumento(doc, rol);
        if (abre !== enviados.has(doc.slug)) {
          discrepancias.push(`${rol} · ${doc.slug}: /ayuda=${abre} asistente=${enviados.has(doc.slug)}`);
        }
      }
    }
    expect(discrepancias).toEqual([]);
  });

  it("sin sesión y con `apiKey` el contexto es VACÍO (lista blanca, no lista negra)", () => {
    // `contextoPara` es puro y se puede preguntar directamente por los dos casos que el servicio
    // ni siquiera deja llegar hasta aquí (R13).
    expect(contextoPara(docs, null)).toEqual([]);
    expect(contextoPara(docs, "apiKey")).toEqual([]);
  });

  it("el orden es estable por slug (de eso depende que la caché del prefijo acierte)", () => {
    const slugs = contextoPara(docs, "maestro").map((d) => d.slug);
    expect(slugs).toEqual([...slugs].sort((a, b) => a.localeCompare(b, "es")));
  });
});

describe("R10 — los cinco roles, con los conteos que mide el módulo de ayuda", () => {
  it("⭑ 33 / 33 / 10 / 8 / 7, los mismos números que afirma AyudaLayout", async () => {
    // ⚠️ LITERALES A MANO, medidos sobre el `roles:` de los 33 archivos, igual que
    // `tests/components/AyudaLayout.test.tsx`. Derivarlos del catálogo los dejaría verdes pase lo
    // que pase — incluido el caso que de verdad importa: un acotamiento apagado que mande 33 a
    // todo el mundo.
    const esperado: Record<string, number> = {
      maestro: 33,
      admin: 33,
      adminSatelite: 10,
      mensajero: 8,
      adminTienda: 7,
    };
    for (const rol of ROLES_AYUDA) {
      const { proveedor } = await loQueSeEnvia(rol);
      expect(proveedor.llamadas[0].documentos.length, rol).toBe(esperado[rol]);
    }
  });

  it("⭑ y el mensajero recibe exactamente SUS ocho, por su nombre", async () => {
    const { proveedor } = await loQueSeEnvia("mensajero");
    expect(proveedor.llamadas[0].documentos.map((d) => d.slug)).toEqual([
      "mensajero/cierre-del-dia",
      "mensajero/por-recoger",
      "mensajero/ranking",
      "mensajero/recoleccion",
      "mensajero/reparto",
      "publico/entrar-y-recuperar-contrasena",
      "publico/postulacion",
      "publico/rastreo-de-paquete",
    ]);
  });

  it("la tienda recibe los suyos y ninguno de la oficina", async () => {
    const { proveedor } = await loQueSeEnvia("adminTienda");
    expect(proveedor.llamadas[0].documentos.map((d) => d.slug)).toEqual([
      "compartido/analitica",
      "publico/entrar-y-recuperar-contrasena",
      "publico/postulacion",
      "publico/rastreo-de-paquete",
      "tienda/mi-wallet",
      "tienda/novedades",
      "tienda/ordenes",
    ]);
  });

  it("el satélite recibe sus diez, que incluyen tres de oficina y NO el histórico", async () => {
    const { proveedor } = await loQueSeEnvia("adminSatelite");
    expect(proveedor.llamadas[0].documentos.map((d) => d.slug)).toEqual([
      "compartido/analitica",
      "oficina/cierres",
      "oficina/incidentes",
      "oficina/monitoreo",
      "publico/entrar-y-recuperar-contrasena",
      "publico/postulacion",
      "publico/rastreo-de-paquete",
      "satelite/en-bodega",
      "satelite/mi-bodega",
      "satelite/por-recibir",
    ]);
  });
});

describe("R11 — un mensajero no recibe NI UNA LÍNEA de la ayuda de la oficina", () => {
  /** Los 18 `.md` de `docs/ayuda/oficina/`, leídos de la carpeta y no de una lista escrita aquí. */
  const archivosOficina = readdirSync(DIR_OFICINA).filter((f) => f.endsWith(".md"));

  it("CONTROL DE NO-VACUIDAD: la carpeta de oficina tiene los 18 documentos medidos", () => {
    // Sin esto, borrar la carpeta dejaría todo lo de abajo verde por vacío.
    expect(archivosOficina.length).toBe(18);
  });

  it("⭑ el texto que se le manda a un mensajero no contiene ningún slug de oficina", async () => {
    const { proveedor } = await loQueSeEnvia("mensajero");
    const texto = proveedor.textoEnviado;
    const colados = archivosOficina
      .map((f) => `oficina/${f.replace(/\.md$/, "")}`)
      .filter((slug) => texto.includes(slug));
    expect(colados).toEqual([]);
  });

  it("⭑⭑ NI UNA LÍNEA: ninguna frase de ninguno de los 18 aparece en lo que se envía", async () => {
    // Medir por TÍTULOS no vale y está medido: los títulos de oficina son «Cierres», «Inicio»,
    // «Órdenes», «Incidentes»… palabras corrientes que aparecen legítimamente en la ayuda del
    // mensajero. Lo que R11 dice de verdad es «ni una línea», así que se mide con las líneas: se
    // toman las de cada documento de oficina que sean lo bastante largas como para ser suyas
    // (≥ 40 caracteres) y se exige que ninguna esté en el texto enviado.
    const { proveedor } = await loQueSeEnvia("mensajero");
    const texto = proveedor.textoEnviado;

    const filtradas: string[] = [];
    let lineasComparadas = 0;
    for (const archivo of archivosOficina) {
      const crudo = readFileSync(path.join(DIR_OFICINA, archivo), "utf8");
      for (const linea of crudo.split(/\r?\n/)) {
        const limpia = linea.trim();
        if (limpia.length < 40) continue;
        lineasComparadas += 1;
        if (texto.includes(limpia)) filtradas.push(`${archivo}: ${limpia.slice(0, 70)}…`);
      }
    }

    // La no-vacuidad de ESTE caso: si el filtro dejara cero líneas, el `toEqual([])` de abajo
    // pasaría sin haber comparado nada.
    expect(lineasComparadas).toBeGreaterThan(200);
    expect(filtradas).toEqual([]);
  });

  it("⭑⭑⭑ y en particular la CAJA: ni el título ni una sola línea de wallet-caja.md", async () => {
    // El caso concreto que da nombre al riesgo. Se escribe aparte de los 18 para que el rojo diga
    // «la caja» y no «un documento de oficina».
    const { proveedor } = await loQueSeEnvia("mensajero");
    const texto = proveedor.textoEnviado;
    const caja = readFileSync(path.join(DIR_OFICINA, "wallet-caja.md"), "utf8");

    expect(texto).not.toContain("oficina/wallet-caja");
    expect(texto).not.toContain("Wallet · Caja");
    const suyas = caja
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length >= 40);
    expect(suyas.length).toBeGreaterThan(20);
    expect(suyas.filter((l) => texto.includes(l))).toEqual([]);
  });

  it("CONTROL: a un MAESTRO sí le llega la caja (si no, lo de arriba pasaría con el asistente roto)", async () => {
    // El otro extremo, y es imprescindible: sin él, un `contextoPara` que devolviera SIEMPRE vacío
    // pasaría los cuatro casos anteriores en verde.
    const { proveedor } = await loQueSeEnvia("maestro");
    expect(proveedor.textoEnviado).toContain("oficina/wallet-caja");
    expect(proveedor.textoEnviado).toContain("Wallet · Caja");
  });
});
