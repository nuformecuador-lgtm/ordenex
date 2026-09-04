import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  CATEGORIAS_FK_USUARIO,
  CLASIFICACION_FK_USUARIO,
  type CategoriaFkUsuario,
} from "../../fixtures/api-key-dependencias-usuario";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FICHA 373 / F1 (R17) — LA GUARDIA QUE IMPIDE QUE EL CENSO DE FKs SE QUEDE VIEJO EN SILENCIO.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// QUE PROTEGE. Eliminar una API key borra tambien la fila de `usuario` de su cuenta dedicada. Toda
// relacion del esquema que apunte a `usuario` es una posible sorpresa:
//   · si su FK es `Restrict`/`NoAction`, el `DELETE` revienta y el maestro ve «bloqueada» sin
//     entender por que;
//   · si es `Cascade` o `SetNull`, NO revienta: algo desaparece o se desconecta EN SILENCIO, y ahi
//     el guard por datos es la unica defensa que queda.
//
// Ninguna de las dos cosas rompe un test que no exista. Una relacion NUEVA hacia `Usuario` —de
// cualquier ficha futura, escrita por cualquiera— entra en el esquema sin que nadie se acuerde de
// esta ficha. Esta guardia es lo que convierte «acordarse» en «no compila en verde».
//
// LO QUE EXIGE, por cada relacion hacia `Usuario` con `fields:` + `references: [id]`:
//   1. que figure en el censo (`tests/fixtures/api-key-dependencias-usuario.ts`);
//   2. con una de las TRES categorias de R17;
//   3. y con un MOTIVO escrito, no vacio.
// Y en la direccion contraria: que el censo no nombre relaciones que el esquema ya no tiene.
//
// CON CONTRAPRUEBA: el mismo detector, aplicado a un esquema MUTADO EN MEMORIA, tiene que fallar.
// Sin ella, un extractor roto que devolviera cero relaciones dejaria esta guardia verde para
// siempre.
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo.

const RAIZ = path.resolve(__dirname, "../../..");
const RUTA_ESQUEMA = path.join(RAIZ, "db", "schema.prisma");

interface RelacionHaciaUsuario {
  /** `Modelo.campo`, la clave del censo. */
  clave: string;
  modelo: string;
  campo: string;
  /** La columna que sostiene la FK (`fields: [...]`). */
  columna: string;
  /** `onDelete` declarado, o `(default)` si Prisma lo resuelve por la opcionalidad. */
  onDelete: string;
}

/**
 * Extrae TODA relacion cuyo TIPO es `Usuario`/`Usuario?` y que DECLARA la FK (`fields:` +
 * `references:`). Se quedan fuera, a proposito, los lados INVERSOS (`apiKey ApiKey? @relation(...)`
 * dentro de `Usuario`, `mensajerosGestionando Usuario[]`): no tienen columna ni `onDelete`, asi que
 * no pueden bloquear ni borrar nada. Y tambien las relaciones que SALEN de `Usuario` hacia otra
 * tabla (`ordenEnGestion Orden?`), que apuntan al reves.
 */
function relacionesHaciaUsuario(esquema: string): RelacionHaciaUsuario[] {
  const salida: RelacionHaciaUsuario[] = [];
  let modelo: string | null = null;

  for (const linea of esquema.split("\n")) {
    const abre = /^model\s+(\w+)\s*\{/.exec(linea);
    if (abre) {
      modelo = abre[1];
      continue;
    }
    if (/^\}/.test(linea)) {
      modelo = null;
      continue;
    }
    if (modelo === null) continue;

    const rel = /^\s*(\w+)\s+Usuario\??\s+@relation\((.*)$/.exec(linea);
    if (rel === null) continue;
    const [, campo, resto] = rel;
    if (!resto.includes("fields:") || !resto.includes("references:")) continue;

    const columna = /fields:\s*\[([^\]]*)\]/.exec(resto);
    const onDelete = /onDelete:\s*(\w+)/.exec(resto);
    salida.push({
      clave: `${modelo}.${campo}`,
      modelo,
      campo,
      columna: columna ? columna[1].trim() : "?",
      onDelete: onDelete ? onDelete[1] : "(default)",
    });
  }
  return salida;
}

/** Los fallos del censo frente a un esquema dado. Lista vacia = todo clasificado. */
function fallosDelCenso(
  esquema: string,
  censo: Record<string, { categoria: CategoriaFkUsuario; motivo: string }>,
): string[] {
  const relaciones = relacionesHaciaUsuario(esquema);
  const fallos: string[] = [];

  for (const rel of relaciones) {
    const entrada = censo[rel.clave];
    if (entrada === undefined) {
      fallos.push(
        `\`${rel.clave}\` (columna \`${rel.columna}\`, onDelete ${rel.onDelete}) apunta a ` +
          "`usuario` y NO esta clasificada: si es Restrict, el borrado de una API key fallara sin " +
          "explicacion; si es Cascade o SetNull, borrara o desconectara en silencio.",
      );
      continue;
    }
    if (!CATEGORIAS_FK_USUARIO.includes(entrada.categoria)) {
      fallos.push(`\`${rel.clave}\` tiene una categoria que no es de R17: ${entrada.categoria}`);
    }
    if (entrada.motivo.trim().length < 20) {
      fallos.push(`\`${rel.clave}\` esta clasificada sin motivo escrito`);
    }
  }

  const enElEsquema = new Set(relaciones.map((r) => r.clave));
  for (const clave of Object.keys(censo)) {
    if (!enElEsquema.has(clave)) {
      fallos.push(`el censo nombra \`${clave}\`, que el esquema ya no declara`);
    }
  }
  return fallos;
}

const ESQUEMA = readFileSync(RUTA_ESQUEMA, "utf8");

describe("373/R17 — el extractor lee el esquema REAL (anti-vacuidad)", () => {
  it("encuentra un numero de relaciones creible, no cero", () => {
    // Si el extractor se rompiera —un cambio de formato de Prisma, un `prettier` distinto— y
    // devolviera [], TODAS las aserciones de abajo pasarian sin comprobar nada.
    const relaciones = relacionesHaciaUsuario(ESQUEMA);
    expect(relaciones.length).toBeGreaterThan(40);
  });

  it("encuentra las relaciones que la ficha nombra una a una", () => {
    const claves = relacionesHaciaUsuario(ESQUEMA).map((r) => r.clave);
    // Las cuatro del guard, las dos que se borran con la cuenta y la de la red de FK que prueba
    // el test de integracion.
    for (const esperada of [
      "Orden.tienda",
      "Tarifa.tienda",
      "WalletTiendaMovimiento.tienda",
      "LiquidacionPago.tienda",
      "ApiKey.usuario",
      "WebhookSuscripcion.owner",
      "OrdenHabilitacionApi.actor",
    ]) {
      expect(claves, `falta ${esperada}`).toContain(esperada);
    }
  });

  it("NO cuenta los lados inversos ni las relaciones que salen de `Usuario`", () => {
    const claves = relacionesHaciaUsuario(ESQUEMA).map((r) => r.clave);
    // `Usuario.apiKey` y `Usuario.cargasRealizadas` son lados inversos: sin columna y sin onDelete.
    expect(claves).not.toContain("Usuario.apiKey");
    expect(claves).not.toContain("Usuario.cargasRealizadas");
    // `Usuario.ordenEnGestion` apunta a `Orden`, no a `Usuario`.
    expect(claves).not.toContain("Usuario.ordenEnGestion");
  });

  it("cada relacion trae su columna y su `onDelete`", () => {
    const orden = relacionesHaciaUsuario(ESQUEMA).find((r) => r.clave === "Orden.tienda");
    expect(orden?.columna).toBe("tiendaId");
    const tarifa = relacionesHaciaUsuario(ESQUEMA).find((r) => r.clave === "Tarifa.tienda");
    expect(tarifa?.onDelete).toBe("Cascade"); // ⚠️ la que NO bloquea sola
  });
});

describe("373/R17 — TODA relacion hacia `usuario` esta clasificada, con motivo", () => {
  it("⭑ el esquema real no tiene ni una relacion sin clasificar", () => {
    expect(fallosDelCenso(ESQUEMA, CLASIFICACION_FK_USUARIO)).toEqual([]);
  });

  it("el censo tiene exactamente las relaciones del esquema, ni una de mas", () => {
    const claves = relacionesHaciaUsuario(ESQUEMA).map((r) => r.clave).sort();
    expect(Object.keys(CLASIFICACION_FK_USUARIO).sort()).toEqual(claves);
  });

  it("las tres categorias estan POBLADAS: ninguna quedo sin un solo caso", () => {
    // Una categoria vacia seria la senal de que alguien la vacio para hacer callar la guardia.
    const porCategoria = new Map<string, number>();
    for (const { categoria } of Object.values(CLASIFICACION_FK_USUARIO)) {
      porCategoria.set(categoria, (porCategoria.get(categoria) ?? 0) + 1);
    }
    for (const categoria of CATEGORIAS_FK_USUARIO) {
      expect(porCategoria.get(categoria) ?? 0, `categoria \`${categoria}\` vacia`).toBeGreaterThan(0);
    }
  });

  it("las dos que se borran CON la cuenta son exactamente las de R2, y ni una mas", () => {
    // Que esta lista crezca sin ficha nueva significaria que el borrado se llevo algo que nadie
    // pidio. `LoginAttempt.usuario` esta ahi por su VINCULO (SET NULL), y se declara aparte.
    const seBorran = Object.entries(CLASIFICACION_FK_USUARIO)
      .filter(([, v]) => v.categoria === "se_borra_con_ella")
      .map(([k]) => k)
      .sort();
    expect(seBorran).toEqual(["ApiKey.usuario", "LoginAttempt.usuario", "WebhookSuscripcion.owner"]);
  });
});

describe("373/R17 — CONTRAPRUEBA: la guardia detecta el hueco de verdad", () => {
  it("⭑ una relacion NUEVA hacia `Usuario` en un esquema mutado pone la guardia roja", () => {
    // La mutacion es literal: una ficha futura anade una tabla con FK a `usuario` y no pasa por
    // aqui. Si esta contraprueba no fallara, la guardia de arriba no probaria nada.
    const mutado =
      ESQUEMA +
      "\n\nmodel TablaInventadaPorLaContraprueba {\n" +
      "  id        String  @id @default(uuid())\n" +
      "  usuarioId String  @map(\"usuario_id\")\n" +
      "  usuario   Usuario @relation(\"Inventada\", fields: [usuarioId], references: [id], onDelete: Restrict)\n" +
      "}\n";

    const fallos = fallosDelCenso(mutado, CLASIFICACION_FK_USUARIO);
    expect(fallos).toHaveLength(1);
    expect(fallos[0]).toContain("TablaInventadaPorLaContraprueba.usuario");
    expect(fallos[0]).toContain("NO esta clasificada");
  });

  it("CONTRAPRUEBA: quitar una entrada del censo tambien pone la guardia roja", () => {
    const censoMutilado = { ...CLASIFICACION_FK_USUARIO };
    delete censoMutilado["Tarifa.tienda"];

    const fallos = fallosDelCenso(ESQUEMA, censoMutilado);
    expect(fallos).toHaveLength(1);
    expect(fallos[0]).toContain("Tarifa.tienda");
  });

  it("CONTRAPRUEBA: una clasificacion SIN motivo escrito se detecta", () => {
    const censoMudo = {
      ...CLASIFICACION_FK_USUARIO,
      "Orden.tienda": { categoria: "bloquea" as CategoriaFkUsuario, motivo: "  " },
    };
    expect(fallosDelCenso(ESQUEMA, censoMudo)).toEqual([
      "`Orden.tienda` esta clasificada sin motivo escrito",
    ]);
  });

  it("CONTRAPRUEBA: una entrada que el esquema ya no declara se detecta", () => {
    const censoRancio = {
      ...CLASIFICACION_FK_USUARIO,
      "TablaBorradaHaceMeses.usuario": {
        categoria: "no_alcanzable" as CategoriaFkUsuario,
        motivo: "un motivo suficientemente largo para pasar el umbral del detector",
      },
    };
    const fallos = fallosDelCenso(ESQUEMA, censoRancio);
    expect(fallos).toHaveLength(1);
    expect(fallos[0]).toContain("que el esquema ya no declara");
  });
});
