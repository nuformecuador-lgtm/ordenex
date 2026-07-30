import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";
import { ESTADOS_CREACION } from "@/lib/types/order-status-transiciones";
import { ORDEN_HISTORIAL_ORIGEN_TIPO_SEED } from "@/lib/types/orden-historial";

// Feature 155 (T5.3/T5.4) — cobertura de la migracion
// `*_order_status_retiro_en_fulfillment`. Mismo patron que los tests de migracion de la 139 y
// la 154: lectura ESTATICA del SQL por regex mas una SIMULACION en memoria de su semantica.
// NO requiere Postgres real; el round-trip `deploy -> rollback -> deploy` contra una base
// queda como DEUDA DECLARADA en `progress/impl_155_backend.md` (no hay DB en este entorno).
//
// Cubre R34-R40:
//   R34  backfill de TODA orden en el estado retirado (incluidas las borradas logicamente),
//        sin tocar num_guia / mensajero / prioridad
//   R35  rastro del backfill: familia `ajuste_estado`, SIN actor, con motivo literal
//   R36  el historial PREEXISTENTE no se reescribe ni se borra
//   R37  el DELETE del catalogo es CONDICIONAL a que nadie lo referencie
//   R38  el DOWN revierte exactamente: repone, devuelve las marcadas y borra el rastro
//   R39  tras el UP, cero ordenes en el estado retirado
//   R40  el backfill no emite webhooks, notificaciones ni jobs
//
// El literal retirado se construye por concatenacion: ya no pertenece a `OrderStatusValue` y no
// debe quedar escrito en el arbol (censo de la 155). El SQL SI lo contiene, obviamente: es lo
// que la migracion viene a retirar, y por eso este archivo entra en la allowlist del guard.
const RETIRADO = ["en", "fulfillment"].join("_");
const DESTINO = "en_preparacion";
const MOTIVO = `migracion 155: retiro de ${RETIRADO}`;

const ROOT = path.join(__dirname, "..", "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");

function migrationDirFor(suffix: string): string {
  const dir = fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .find((name) => name.endsWith(suffix));
  if (!dir) throw new Error(`No se encontro la carpeta de migracion ${suffix}`);
  return path.join(MIGRATIONS_DIR, dir);
}

const migrationDir = migrationDirFor("_order_status_retiro_en_fulfillment");
const upSql = fs.readFileSync(path.join(migrationDir, "migration.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationDir, "down.sql"), "utf8");

/** SQL EJECUTABLE, sin las lineas de comentario `--`: las aserciones negativas van contra esto. */
function sinComentarios(sql: string): string {
  return sql
    .split(/\r?\n/)
    .filter((linea) => !/^\s*--/.test(linea))
    .join("\n");
}

const upEjecutable = sinComentarios(upSql);
const downEjecutable = sinComentarios(downSql);

// ---------------------------------------------------------------------------------------------
// SIMULACION en memoria de la semantica de los tres pasos. No reimplementa SQL: modela lo que
// las sentencias afirman hacer, para poder comprobar idempotencia, alcance del backfill y
// reversibilidad sin una base de datos.
// ---------------------------------------------------------------------------------------------
interface OrdenSim {
  id: string;
  estatus: string;
  numGuia: number | null;
  mensajeroAsignadoId: string | null;
  prioridad: boolean;
  borrada: boolean;
}
interface HistorialSim {
  ordenId: string;
  origen: string | null;
  destino: string;
  actor: string | null;
  origenTipo: string;
  motivo: string | null;
}
interface BaseSim {
  catalogo: string[];
  ordenes: OrdenSim[];
  historial: HistorialSim[];
}

function orden(id: string, estatus: string, extra: Partial<OrdenSim> = {}): OrdenSim {
  return {
    id,
    estatus,
    numGuia: 777,
    mensajeroAsignadoId: "msg-1",
    prioridad: true,
    borrada: false,
    ...extra,
  };
}

function clonar(base: BaseSim): BaseSim {
  return {
    catalogo: [...base.catalogo],
    ordenes: base.ordenes.map((o) => ({ ...o })),
    historial: base.historial.map((h) => ({ ...h })),
  };
}

/** UP: rastro -> backfill -> DELETE condicional. */
function aplicarUp(entrada: BaseSim): BaseSim {
  const base = clonar(entrada);
  // 1. Rastro, sobre las ordenes que TODAVIA estan en el estado retirado (incluidas borradas).
  for (const o of base.ordenes.filter((x) => x.estatus === RETIRADO)) {
    base.historial.push({
      ordenId: o.id,
      origen: RETIRADO,
      destino: DESTINO,
      actor: null,
      origenTipo: "ajuste_estado",
      motivo: MOTIVO,
    });
  }
  // 2. Backfill: SOLO el estado.
  for (const o of base.ordenes) {
    if (o.estatus === RETIRADO) o.estatus = DESTINO;
  }
  // 3. DELETE condicional del catalogo.
  const referenciado =
    base.ordenes.some((o) => o.estatus === RETIRADO) ||
    base.historial.some((h) => h.origen === RETIRADO || h.destino === RETIRADO);
  if (!referenciado) base.catalogo = base.catalogo.filter((v) => v !== RETIRADO);
  return base;
}

/** DOWN: repone -> devuelve las marcadas -> borra el rastro. */
function aplicarDown(entrada: BaseSim): BaseSim {
  const base = clonar(entrada);
  if (!base.catalogo.includes(RETIRADO)) base.catalogo.push(RETIRADO);
  const marcadas = new Set(base.historial.filter((h) => h.motivo === MOTIVO).map((h) => h.ordenId));
  for (const o of base.ordenes) {
    if (o.estatus === DESTINO && marcadas.has(o.id)) o.estatus = RETIRADO;
  }
  base.historial = base.historial.filter((h) => h.motivo !== MOTIVO);
  return base;
}

/** Base de partida: dos ordenes en el estado retirado (una borrada), una ya en destino, y un
 *  historial PREEXISTENTE que referencia el value por los dos lados. */
function basePartida(): BaseSim {
  return {
    catalogo: [...ORDER_STATUS_SEED, RETIRADO],
    ordenes: [
      orden("o-viva", RETIRADO),
      orden("o-borrada", RETIRADO, { borrada: true, numGuia: null, mensajeroAsignadoId: null }),
      orden("o-ya-en-destino", DESTINO, { numGuia: 42 }),
      orden("o-otra", "en_bodega_central"),
    ],
    historial: [
      // Historial PREEXISTENTE (R36): la creacion de `o-viva` en el value retirado y una
      // transicion vieja que salia de el. Ninguna lleva el motivo de la migracion.
      {
        ordenId: "o-viva",
        origen: null,
        destino: RETIRADO,
        actor: "u-tienda",
        origenTipo: "carga_masiva",
        motivo: null,
      },
      {
        ordenId: "o-legada",
        origen: RETIRADO,
        destino: "en_bodega_central",
        actor: "u-admin",
        origenTipo: "generacion_guia",
        motivo: null,
      },
    ],
  };
}

describe("155/R34 — el UP reasigna TODA orden del estado retirado, sin tocar nada mas", () => {
  it("mueve las ordenes vivas Y las borradas logicamente", () => {
    const despues = aplicarUp(basePartida());
    expect(despues.ordenes.find((o) => o.id === "o-viva")!.estatus).toBe(DESTINO);
    expect(despues.ordenes.find((o) => o.id === "o-borrada")!.estatus).toBe(DESTINO);
  });

  it("el UPDATE no filtra por deleted_at (la orden borrada tambien se migra)", () => {
    // Si el SQL filtrara por borrado, una orden restaurada despues quedaria en un estado que
    // ya no existe en el codigo: sin salidas legales y sin etiqueta.
    expect(upEjecutable).toMatch(/UPDATE "orden"/);
    expect(upEjecutable).not.toMatch(/deleted_at/);
  });

  it("no toca num_guia, mensajero ni prioridad de ninguna orden", () => {
    const antes = basePartida();
    const despues = aplicarUp(antes);
    for (const o of antes.ordenes) {
      const migrada = despues.ordenes.find((x) => x.id === o.id)!;
      expect(migrada.numGuia).toBe(o.numGuia);
      expect(migrada.mensajeroAsignadoId).toBe(o.mensajeroAsignadoId);
      expect(migrada.prioridad).toBe(o.prioridad);
      expect(migrada.borrada).toBe(o.borrada);
    }
    // Y el SQL solo asigna la columna de estado.
    const update = /UPDATE "orden"\s+SET ([^\n]*)\n/.exec(upEjecutable);
    expect(update).not.toBeNull();
    expect((update as RegExpExecArray)[1]).toContain('"estatus_id"');
    for (const columna of ["num_guia", "mensajero_asignado_id", "prioridad", "updated_at"]) {
      expect(upEjecutable).not.toMatch(new RegExp(`SET[^;]*${columna}`, "s"));
    }
  });

  it("no toca las ordenes que ya estaban en otro estado", () => {
    const despues = aplicarUp(basePartida());
    expect(despues.ordenes.find((o) => o.id === "o-ya-en-destino")!.estatus).toBe(DESTINO);
    expect(despues.ordenes.find((o) => o.id === "o-otra")!.estatus).toBe("en_bodega_central");
  });

  it("es IDEMPOTENTE: la segunda pasada no mueve nada ni añade rastro", () => {
    const unaVez = aplicarUp(basePartida());
    const dosVeces = aplicarUp(unaVez);
    expect(dosVeces).toEqual(unaVez);
  });
});

describe("155/R35 — el UP deja rastro en la linea de tiempo de cada orden afectada", () => {
  it("una fila por orden migrada, del estado retirado al destino", () => {
    const despues = aplicarUp(basePartida());
    const rastro = despues.historial.filter((h) => h.motivo === MOTIVO);
    expect(rastro.map((h) => h.ordenId).sort()).toEqual(["o-borrada", "o-viva"]);
    for (const fila of rastro) {
      expect(fila.origen).toBe(RETIRADO);
      expect(fila.destino).toBe(DESTINO);
    }
  });

  it("familia `ajuste_estado` y SIN actor (sistema)", () => {
    const despues = aplicarUp(basePartida());
    for (const fila of despues.historial.filter((h) => h.motivo === MOTIVO)) {
      expect(fila.origenTipo).toBe("ajuste_estado");
      expect(fila.actor).toBeNull();
    }
    // El SQL lo escribe asi: casteo explicito al enum y NULL en el actor.
    expect(upEjecutable).toMatch(/'ajuste_estado'::orden_historial_origen_tipo/);
    expect(upEjecutable).toMatch(/NULL,\s*\n\s*'ajuste_estado'/);
    // La familia usada YA existe en el enum: esta feature no añade values, asi que no obliga a
    // tocar ningun `down.sql` previo.
    expect([...ORDEN_HISTORIAL_ORIGEN_TIPO_SEED]).toContain("ajuste_estado");
    expect(upEjecutable).not.toMatch(/ALTER TYPE/i);
  });

  it("el motivo es un literal que identifica a ESTA migracion y es legible por el usuario", () => {
    expect(upSql).toContain(MOTIVO);
    // El mismo literal es la llave del DOWN: si divergieran, el rollback no encontraria nada.
    expect(downSql).toContain(MOTIVO);
  });

  it("el rastro va ANTES del backfill (si no, no encontraria ninguna orden que marcar)", () => {
    const posInsert = upEjecutable.indexOf('INSERT INTO "orden_historial_estado"');
    const posUpdate = upEjecutable.indexOf('UPDATE "orden"');
    expect(posInsert).toBeGreaterThanOrEqual(0);
    expect(posUpdate).toBeGreaterThan(posInsert);
  });
});

describe("155/R36 — el historial PREEXISTENTE es inmutable", () => {
  it("las filas previas que referencian el value retirado siguen intactas tras el UP", () => {
    const antes = basePartida();
    const previas = antes.historial.map((h) => ({ ...h }));
    const despues = aplicarUp(antes);
    const conservadas = despues.historial.filter((h) => h.motivo !== MOTIVO);
    expect(conservadas).toEqual(previas);
  });

  it("el UP no hace UPDATE ni DELETE sobre orden_historial_estado", () => {
    expect(upEjecutable).not.toMatch(/UPDATE "orden_historial_estado"/);
    expect(upEjecutable).not.toMatch(/DELETE FROM "orden_historial_estado"/);
  });
});

describe("155/R37 — el DELETE del catalogo esta GUARDADO por referencias", () => {
  it("con historial que lo referencia, la fila del catalogo SOBREVIVE (no-op)", () => {
    const despues = aplicarUp(basePartida());
    expect(despues.catalogo).toContain(RETIRADO);
  });

  it("sin ninguna referencia (base limpia), la fila SI se borra", () => {
    const limpia: BaseSim = {
      catalogo: [...ORDER_STATUS_SEED, RETIRADO],
      ordenes: [orden("o-otra", "en_bodega_central")],
      historial: [],
    };
    const despues = aplicarUp(limpia);
    expect(despues.catalogo).not.toContain(RETIRADO);
    expect([...despues.catalogo].sort()).toEqual([...ORDER_STATUS_SEED].sort());
  });

  // CONSECUENCIA REAL Y DELIBERADA, que conviene tener escrita en un test y no solo en un
  // comentario: el rastro del paso 1 referencia el value retirado en `estatus_origen_id`, asi
  // que EN CUANTO SE MIGRA UNA SOLA ORDEN el paso 3 se vuelve no-op y la fila del catalogo
  // sobrevive. El DELETE solo llega a borrar en una base donde no habia NADA que migrar ni
  // historial previo. Es lo correcto —el rastro es lo que hace reversible el DOWN— pero
  // significa que "el value desaparece de la tabla" NO es una promesa de esta migracion.
  it("si se migro aunque sea UNA orden, el propio rastro impide el borrado del catalogo", () => {
    const conUnaOrden: BaseSim = {
      catalogo: [...ORDER_STATUS_SEED, RETIRADO],
      ordenes: [orden("o-unica", RETIRADO)],
      historial: [], // sin historial previo: la unica referencia sera la que cree el UP
    };
    const despues = aplicarUp(conUnaOrden);
    expect(despues.ordenes[0].estatus).toBe(DESTINO); // la orden si se movio
    expect(despues.catalogo).toContain(RETIRADO); // ...y el value se queda, huerfano
  });

  it("el SQL guarda el DELETE contra `orden` y contra los DOS lados del historial", () => {
    expect(upEjecutable).toMatch(
      /NOT EXISTS \(SELECT 1 FROM "orden" o WHERE o\."estatus_id" = os\."id"\)/,
    );
    expect(upEjecutable).toMatch(/h\."estatus_destino_id" = os\."id" OR h\."estatus_origen_id" = os\."id"/);
    // Nunca un borrado en cascada ni un SET NULL: convertiria filas con origen legitimo en
    // filas con origen NULL, que es el marcador de "creacion".
    expect(upEjecutable).not.toMatch(/CASCADE/i);
    expect(upEjecutable).not.toMatch(/SET NULL/i);
  });

  it("el DELETE alcanza SOLO al value retirado (ningun otro del catalogo)", () => {
    const valuesBorrados = [...upEjecutable.matchAll(/os\."value" = '([^']+)'/g)].map((m) => m[1]);
    expect(valuesBorrados).toEqual([RETIRADO]);
    for (const vigente of ORDER_STATUS_SEED) expect(valuesBorrados).not.toContain(vigente);
  });
});

describe("155/R39 — censo de datos tras el UP", () => {
  it("cero ordenes en el estado retirado, con o sin borrado logico", () => {
    const despues = aplicarUp(basePartida());
    expect(despues.ordenes.filter((o) => o.estatus === RETIRADO)).toEqual([]);
  });

  it("y el value ya no es un estado alcanzable por el codigo", () => {
    expect(ORDER_STATUS_SEED as readonly string[]).not.toContain(RETIRADO);
    expect(ESTADOS_CREACION as readonly string[]).not.toContain(RETIRADO);
  });
});

describe("155/R40 — el backfill NO dispara efectos de negocio", () => {
  it("el UP es SQL puro: no toca la cola de jobs ni las notificaciones", () => {
    for (const tabla of ["job", "jobs", "notificacion", "webhook_suscripcion", "gestion_orden"]) {
      expect(upEjecutable).not.toMatch(new RegExp(`"${tabla}"`, "i"));
    }
  });

  it("solo escribe en las TRES tablas declaradas: orden, historial y catalogo", () => {
    const tablas = new Set(
      [...upEjecutable.matchAll(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+"([a-z_]+)"/g)].map(
        (m) => m[1],
      ),
    );
    expect([...tablas].sort()).toEqual(["orden", "orden_historial_estado", "order_status"]);
  });

  it("no crea triggers ni funciones que pudieran emitir algo", () => {
    expect(upEjecutable).not.toMatch(/CREATE TRIGGER/i);
    expect(upEjecutable).not.toMatch(/CREATE (OR REPLACE )?FUNCTION/i);
    expect(upEjecutable).not.toMatch(/NOTIFY/i);
  });
});

describe("155/R38 — el DOWN revierte EXACTAMENTE lo que hace el UP", () => {
  it("round-trip: UP + DOWN deja la base como estaba", () => {
    const antes = basePartida();
    const vuelta = aplicarDown(aplicarUp(antes));
    expect(vuelta).toEqual(antes);
  });

  it("round-trip en una base LIMPIA (donde el UP si borro el value del catalogo)", () => {
    const limpia: BaseSim = {
      catalogo: [...ORDER_STATUS_SEED, RETIRADO],
      ordenes: [orden("o-otra", "en_bodega_central")],
      historial: [],
    };
    const arriba = aplicarUp(limpia);
    expect(arriba.catalogo).not.toContain(RETIRADO); // el UP lo borro
    const vuelta = aplicarDown(arriba);
    expect([...vuelta.catalogo].sort()).toEqual([...limpia.catalogo].sort()); // el DOWN lo repuso
    expect(vuelta.ordenes).toEqual(limpia.ordenes);
    expect(vuelta.historial).toEqual([]);
  });

  it("NO retrocede una orden migrada que despues AVANZO de estado", () => {
    const arriba = aplicarUp(basePartida());
    // La operacion del negocio movio `o-viva` a la bodega central despues de la migracion.
    arriba.ordenes.find((o) => o.id === "o-viva")!.estatus = "en_bodega_central";
    const vuelta = aplicarDown(arriba);
    expect(vuelta.ordenes.find((o) => o.id === "o-viva")!.estatus).toBe("en_bodega_central");
    // La otra marcada, que sigue en el destino, si vuelve.
    expect(vuelta.ordenes.find((o) => o.id === "o-borrada")!.estatus).toBe(RETIRADO);
  });

  it("NO devuelve ordenes que ya estaban en el destino antes de la migracion", () => {
    const vuelta = aplicarDown(aplicarUp(basePartida()));
    expect(vuelta.ordenes.find((o) => o.id === "o-ya-en-destino")!.estatus).toBe(DESTINO);
  });

  it("borra el rastro y SOLO el rastro", () => {
    const antes = basePartida();
    const vuelta = aplicarDown(aplicarUp(antes));
    expect(vuelta.historial.filter((h) => h.motivo === MOTIVO)).toEqual([]);
    expect(vuelta.historial).toEqual(antes.historial);
  });

  it("el DOWN repone el value con INSERT ... WHERE NOT EXISTS (idempotente)", () => {
    expect(downEjecutable).toMatch(/INSERT INTO "order_status" \("id", "value"\)/);
    expect(downEjecutable).toMatch(
      new RegExp(`WHERE NOT EXISTS \\(SELECT 1 FROM "order_status" WHERE "value" = '${RETIRADO}'\\)`),
    );
  });

  it("el DOWN acota el UPDATE al rastro y al estado destino", () => {
    expect(downEjecutable).toMatch(/AND EXISTS \(SELECT 1 FROM "orden_historial_estado" h/);
    expect(downEjecutable).toMatch(new RegExp(`h\\."motivo" = '${MOTIVO}'`));
  });

  it("el DOWN no toca RLS, columnas ni ningun otro value", () => {
    expect(downEjecutable).not.toMatch(/DROP TABLE/i);
    expect(downEjecutable).not.toMatch(/ALTER TABLE/i);
    expect(downEjecutable).not.toMatch(/CREATE POLICY/i);
    expect(downEjecutable).not.toMatch(/ROW LEVEL SECURITY/i);
    expect(downEjecutable).not.toMatch(/ALTER TYPE/i);
  });
});

describe("155 — estructura de la carpeta de migracion", () => {
  it("contiene migration.sql y down.sql, con timestamp posterior al de la 154", () => {
    expect(fs.existsSync(path.join(migrationDir, "migration.sql"))).toBe(true);
    expect(fs.existsSync(path.join(migrationDir, "down.sql"))).toBe(true);
    const dirName = path.basename(migrationDir);
    const v2 = path.basename(migrationDirFor("_order_status_v2_por_recolectar_incidente"));
    // Debe correr DESPUES del alta de `por_recolectar_en_tienda`: el codigo nuevo crea ahi.
    expect(dirName > v2).toBe(true);
  });

  it("el UP no crea tablas, columnas ni politicas de RLS", () => {
    expect(upEjecutable).not.toMatch(/CREATE TABLE/i);
    expect(upEjecutable).not.toMatch(/ALTER TABLE/i);
    expect(upEjecutable).not.toMatch(/ALTER COLUMN/i);
    expect(upEjecutable).not.toMatch(/CREATE POLICY/i);
    expect(upEjecutable).not.toMatch(/ROW LEVEL SECURITY/i);
  });

  it("`zonas-migration.test.ts` excluye esta carpeta del invariante de orden", () => {
    const zonasTest = fs.readFileSync(
      path.join(ROOT, "tests", "integration", "db", "zonas-migration.test.ts"),
      "utf8",
    );
    expect(zonasTest).toMatch(/!d\.endsWith\("_order_status_retiro_en_fulfillment"\)/);
  });
});
