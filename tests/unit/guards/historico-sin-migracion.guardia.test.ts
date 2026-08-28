import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// Feature 321 — GUARDIA: SIN MIGRACION NI CAMBIO DE ESQUEMA (T7.2, cubre R27 y el limite R45).
//
// El histórico de conversaciones resuelve la agrupacion por `(orden, mensajero)` y el orden del
// listado EN LA CONSULTA, no en el esquema: la puerta humana descarto materializar
// `ultima_actividad_at` (P2/A6, «sin agregar nada en la db»). Esta guardia fija esa decision.
//
// ⛔ LO QUE ESTA GUARDIA NO HACE, Y ES DELIBERADO: no mira `git diff` contra `origin/dev`. Una
// guardia que mide el diff de una rama CADUCA en cuanto la rama se mergea —a partir de ahi juzga
// el trabajo de cualquier rama posterior y se convierte en un rojo ajeno que nadie sabe de quien
// es—. Es una leccion ya pagada en este repo. Lo que se mide aqui es la PROPIEDAD del esquema:
// que los objetos que la feature USA siguen ahi (si no estuvieran, «sin migracion» seria mentira)
// y que NO ha aparecido ninguno nuevo con su nombre. Ninguna asercion depende de la rama en la
// que se ejecute.

const RAIZ = path.resolve(__dirname, "../../..");

const MIGRACIONES = readdirSync(path.join(RAIZ, "db", "migrations"), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

const SCHEMA = readFileSync(path.join(RAIZ, "db", "schema.prisma"), "utf8");

/**
 * El cuerpo del modelo `ChatMensaje`, aislado del resto del esquema.
 *
 * Se recorta a proposito: `mensajeroId` aparece —y debe seguir apareciendo— en
 * `ChatConversacion`, que es la fila que SI atribuye el hilo a un mensajero. La afirmacion de
 * R45 es sobre el MENSAJE, y buscar en el esquema entero la daria por buena siempre.
 */
function modeloDelEsquema(nombre: string): string {
  const inicio = SCHEMA.indexOf(`model ${nombre} {`);
  if (inicio === -1) {
    throw new Error(
      `El modelo \`${nombre}\` no esta en db/schema.prisma. Si se renombro, esta guardia hay ` +
        "que reescribirla, no borrarla: sin ella el limite de R45 deja de estar vigilado.",
    );
  }
  const fin = SCHEMA.indexOf("\n}", inicio);
  return SCHEMA.slice(inicio, fin === -1 ? undefined : fin + 2);
}

const SCHEMA_MODELO_CHAT_MENSAJE = modeloDelEsquema("ChatMensaje");

describe("321 / R27 — la feature no añade ninguna migracion", () => {
  it("CONTROL DE NO-VACUIDAD: el censo de migraciones no esta vacio", () => {
    // Sin esto, un `readdirSync` que devolviera [] por una ruta mal resuelta dejaria la guardia
    // verde en falso: el filtro de abajo tambien daria [].
    expect(MIGRACIONES.length).toBeGreaterThan(100);
  });

  it("ninguna carpeta de `db/migrations/` corresponde al histórico de conversaciones", () => {
    const sospechosas = MIGRACIONES.filter((dir) => /historic|conversacion_histor/i.test(dir));
    expect(sospechosas, "la feature 321 añadio una migracion").toEqual([]);
  });

  it("CONTRAPRUEBA: el filtro SI cazaria una migracion de esta feature", () => {
    // El criterio se mide sobre nombres inventados para que no sea un filtro que nunca casa
    // con nada (un `[]` vacio por un regex roto pasaria el caso de arriba sin decir nada).
    const inventadas = [
      "20260828120000_historico_conversaciones",
      "20260828130000_chat_conversacion_historico_ultima_actividad",
      "20260828140000_conversacion_historial",
    ];
    const cazadas = inventadas.filter((dir) => /historic|conversacion_histor/i.test(dir));
    expect(cazadas).toEqual(inventadas);
  });
});

describe("321 / R27 — el esquema conserva exactamente los objetos que la feature usa", () => {
  it("el indice `[conversacionId, ocurridoAt]` sigue existiendo: es EL indice del hilo", () => {
    // La paginacion por cursor `(ocurrido_at, id)` del hilo (R19/R42) se apoya en el. Si
    // desapareciera, «sin migracion» seguiria siendo cierto pero la feature quedaria sin plan.
    expect(SCHEMA).toContain("@@index([conversacionId, ocurridoAt])");
  });

  it("`chat_conversacion` sigue keyeada por (orden, telefono): por eso hay que FUSIONAR", () => {
    // Es la premisa de R42: la fila se keyea por TELEFONO, no por mensajero, asi que un cambio
    // de numero deja dos filas del mismo hilo y el listado las agrupa en la consulta.
    expect(SCHEMA).toMatch(/@@unique\(\[ordenId, telefonoE164\]\)/);
  });

  it("el indice de reacciones sigue ahi: R28 con hilo paginado se apoya en el", () => {
    expect(SCHEMA).toContain('map: "chat_mensaje_reaccion_idx"');
  });

  it("el esquema NO gana ningun modelo ni columna propios del histórico", () => {
    const minuscula = SCHEMA.toLowerCase();
    for (const concepto of [
      "historicoconversacion",
      "historico_conversacion",
      "ultima_actividad_at",
      "ultimaactividadat",
    ]) {
      expect(minuscula, `el esquema nombra ${concepto}`).not.toContain(concepto);
    }
  });
});

describe("321 / R45 — el limite conocido de la atribucion sigue siendo real", () => {
  it("CONTROL: el recorte del modelo no esta vacio ni trae el esquema entero", () => {
    expect(SCHEMA_MODELO_CHAT_MENSAJE).toContain("@@map(\"chat_mensaje\")");
    expect(SCHEMA_MODELO_CHAT_MENSAJE).not.toContain("model ChatConversacion");
    expect(SCHEMA_MODELO_CHAT_MENSAJE.length).toBeLessThan(SCHEMA.length);
  });

  it("`chat_mensaje` NO tiene columna de mensajero", () => {
    // R45 declara un limite MEDIDO: como `upsertParaOrden` reescribe `chat_conversacion
    // .mensajero_id` al reasignar y el MENSAJE no guarda quien era su mensajero, un hilo
    // reasignado con el mismo numero se atribuye entero al mensajero actual. Partirlo de
    // verdad exigiria esta columna — es decir, una migracion, prohibida aqui (R27/A10).
    //
    // Si alguien la añadiera, esta guardia se pone ROJA. Eso es lo que se quiere: obliga a
    // reabrir R45 con el humano en vez de colar la migracion de refilon y dejar el requisito
    // describiendo un mundo que ya no existe.
    expect(SCHEMA_MODELO_CHAT_MENSAJE).not.toMatch(/mensajeroId/);
  });

  it("CONTRAPRUEBA: `chat_conversacion` SI la tiene, y por eso el recorte importa", () => {
    // El mismo assert sobre el esquema entero seria verde-en-falso al reves: `mensajeroId`
    // existe y debe existir en la conversacion. La afirmacion de R45 es sobre el MENSAJE.
    expect(modeloDelEsquema("ChatConversacion")).toMatch(/mensajeroId/);
  });
});
