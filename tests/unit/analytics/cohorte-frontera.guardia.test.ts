import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import { quitarComentarios } from "../../fixtures/sin-comentarios";

// Ficha 411 / T7.4 — GUARDIA de R35: LA TABLA DE COHORTES SOLO TIENE UNA PUERTA A LOS DATOS.
//
// POR QUE ESTE CENSO. La regla «ni servicio, ni repositorio, ni Prisma, ni una ruta bajo
// `app/api/`» no la sostiene ningun tipo: un componente de cliente que importara
// `CohorteCargaService` compilaria, pintaria la misma tabla en el navegador y arrastraria el
// cliente de Prisma al bundle. Y lo peor: **se saltaria el borde**, que es donde viven el recorte
// multi-tenant, la denegacion y la invitacion `sin_rango`. La tabla saldria igual de plausible.
//
// Las cuatro mitades de la afirmacion, y hacen falta las cuatro:
//   (a) no importa ninguna capa de datos (servicios, repositorios, puertos, Prisma, el cliente);
//   (b) no llama a `fetch` ni nombra una ruta bajo `app/api/` — las mutaciones y lecturas locales
//       de este repo van por Server Action, no por route handler;
//   (c) SI importa `consultarCohorteCarga`, que es la puerta que debe usar (sin esto, (a) y (b)
//       estarian verdes con un componente que no leyera datos en absoluto);
//   (d) esa es la UNICA accion que importa: otra puerta a `lib/actions/` seria una segunda
//       lectura de la misma seccion con otro alcance, que es como se cuela un dato de mas.
//
// El censo mira SOLO EL CODIGO (se quitan los comentarios antes de buscar): la cabecera del
// componente esta obligada a explicar que NO importa Prisma ni un repositorio, y censar el texto
// crudo convertiria esa explicacion en una violacion.

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const COMPONENTE = "app/(app)/analitica/_components/entregas/CohorteCargaTabla.tsx";
const ACCION = "@/lib/actions/cohorte-carga";

function leer(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, ...rel.split("/")), "utf8");
}

/** Todo lo que el archivo importa, por su especificador. */
export function especificadoresImportados(fuente: string): string[] {
  const codigo = quitarComentarios(fuente);
  return [...codigo.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1] ?? "");
}

/**
 * Las capas de datos que un componente de pantalla no puede tocar.
 *
 * ⚠ EL NOMBRE DE ESTA CONSTANTE NO ES LIBRE. `modulo-puro.guardia.test.ts` afirma que en este
 * directorio hay UN solo guardia de pureza, y lo detecta buscando en el TEXTO CRUDO de los demas
 * archivos los tres identificadores que le sirven de huella (los de su lista de capas vedadas,
 * sus modulos de peticion y su allowlist de aristas). Este censo es otra cosa —la puerta de datos
 * de UN componente, no la clausura de imports de `lib/analytics`— pero el detector no puede
 * saberlo, y relajarlo para acomodar a este archivo seria el peor de los dos arreglos. Por eso
 * aqui no se escribe ninguno de esos tres nombres, ni siquiera en prosa: el censo lee el archivo
 * entero, comentarios incluidos.
 */
const PUERTAS_VEDADAS: readonly { readonly nombre: string; readonly patron: RegExp }[] = [
  { nombre: "servicios", patron: /^@\/lib\/services\// },
  { nombre: "repositorios", patron: /^@\/lib\/repositories\// },
  { nombre: "puertos de repositorio", patron: /^@\/lib\/interfaces\/repositories\// },
  { nombre: "acceso a la base", patron: /^@\/lib\/db\// },
  { nombre: "cliente de Prisma", patron: /^@prisma\/client$/ },
  // La forma relativa de las mismas capas: el alias no es la unica manera de llegar.
  { nombre: "capa de datos por ruta relativa", patron: /(^|\/)\.\.\/.*(services|repositories)\// },
];

/** Las capas de datos que el archivo importa. Vacio = ninguna. */
export function capasDeDatosImportadas(fuente: string): string[] {
  const especificadores = especificadoresImportados(fuente);
  return PUERTAS_VEDADAS.filter(({ patron }) =>
    especificadores.some((e) => patron.test(e)),
  ).map(({ nombre }) => nombre);
}

/** Las Server Actions que el archivo importa, por su modulo. */
export function accionesImportadas(fuente: string): string[] {
  return especificadoresImportados(fuente).filter((e) => e.startsWith("@/lib/actions/"));
}

/** `true` si el archivo importa NOMINALMENTE la accion de esta lectura. */
export function importaLaAccion(fuente: string): boolean {
  const codigo = quitarComentarios(fuente);
  return new RegExp(
    `import\\s+\\{[^}]*\\bconsultarCohorteCarga\\b[^}]*\\}\\s+from\\s+["']${ACCION.replace(
      /[/]/g,
      "\\/",
    )}["']`,
  ).test(codigo);
}

/** Las puertas HTTP que el archivo abre por su cuenta. Vacio = ninguna. */
export function puertasHttp(fuente: string): string[] {
  const codigo = quitarComentarios(fuente);
  const hallazgos: string[] = [];
  if (/(^|[^.\w])fetch\s*\(/.test(codigo)) hallazgos.push("fetch(");
  if (/["'`]\/api\//.test(codigo)) hallazgos.push("ruta /api/");
  if (/\baxios\b/.test(codigo)) hallazgos.push("axios");
  return hallazgos;
}

describe("R35 · la tabla de cohortes pide sus datos por la Server Action y por ninguna otra puerta", () => {
  it("el archivo censado existe y no esta vacio (si no, el guardia estaria verde por vacio)", () => {
    const completo = path.join(REPO_ROOT, ...COMPONENTE.split("/"));
    expect(fs.existsSync(completo), `${COMPONENTE} no existe: el censo no miraria nada`).toBe(
      true,
    );
    expect(fs.statSync(completo).size).toBeGreaterThan(500);
  });

  it("el detector VE los imports de este archivo (no esta leyendo un fuente vacio)", () => {
    // Sin esto, un `quitarComentarios` roto o una ruta mal escrita dejaria todas las listas de
    // abajo en `[]` y el censo pasaria sin haber buscado nada.
    const especificadores = especificadoresImportados(leer(COMPONENTE));
    expect(especificadores.length).toBeGreaterThan(5);
    expect(especificadores).toContain("swr");
  });

  it("no importa ninguna capa de datos", () => {
    const capas = capasDeDatosImportadas(leer(COMPONENTE));
    expect(
      capas,
      "la tabla de cohortes importa " +
        capas.join(", ") +
        ": esas capas viven detras del borde, que es donde se aplican el recorte por rol, la " +
        "denegacion y el estado `sin_rango`. Pidelo por `consultarCohorteCarga`.",
    ).toEqual([]);
  });

  it("no abre ninguna puerta HTTP propia", () => {
    const puertas = puertasHttp(leer(COMPONENTE));
    expect(
      puertas,
      "la tabla de cohortes abre " +
        puertas.join(", ") +
        ": las lecturas locales de este repo van por Server Action, no por `app/api/`.",
    ).toEqual([]);
  });

  it("SI importa `consultarCohorteCarga`", () => {
    // La otra mitad: sin ella los dos casos de arriba pasarian con un componente que no leyera
    // datos en absoluto.
    expect(importaLaAccion(leer(COMPONENTE))).toBe(true);
  });

  it("`@/lib/actions/cohorte-carga` es la UNICA accion que importa", () => {
    // LITERAL escrito a mano: es el contrato. Una segunda accion aqui seria una segunda lectura
    // de la misma seccion, con su propio alcance y su propia clave de cache.
    expect(accionesImportadas(leer(COMPONENTE))).toEqual([ACCION]);
  });
});

describe("R35 · autocomprobacion: el detector muerde", () => {
  // Sin estos, el censo estaria verde por construccion y nadie sabria si funciona.
  const LEGITIMO = `
"use client";
import useSWR from "swr";
import { consultarCohorteCarga } from "@/lib/actions/cohorte-carga";
export function T() { return useSWR("k", () => consultarCohorteCarga({})); }
`;

  const CON_SERVICIO = `
"use client";
import useSWR from "swr";
import { CohorteCargaService } from "@/lib/services/CohorteCargaService";
export function T() { return useSWR("k", () => new CohorteCargaService().consultar({})); }
`;

  const CON_PRISMA = `
"use client";
import { PrismaClient } from "@prisma/client";
export function T() { return new PrismaClient(); }
`;

  const CON_FETCH = `
"use client";
export async function T() { return fetch("/api/analitica/cohorte"); }
`;

  const CON_OTRA_ACCION = `
"use client";
import { consultarCohorteCarga } from "@/lib/actions/cohorte-carga";
import { consultarConteoEntregas } from "@/lib/actions/conteo-entregas";
export const T = [consultarCohorteCarga, consultarConteoEntregas];
`;

  it("pasa el que usa la Server Action y nada mas", () => {
    expect(capasDeDatosImportadas(LEGITIMO)).toEqual([]);
    expect(puertasHttp(LEGITIMO)).toEqual([]);
    expect(importaLaAccion(LEGITIMO)).toBe(true);
    expect(accionesImportadas(LEGITIMO)).toEqual([ACCION]);
  });

  it("cae el que importa el servicio", () => {
    expect(capasDeDatosImportadas(CON_SERVICIO)).toEqual(["servicios"]);
  });

  it("cae el que importa el cliente de Prisma", () => {
    expect(capasDeDatosImportadas(CON_PRISMA)).toEqual(["cliente de Prisma"]);
  });

  it("cae el que se abre su propia ruta bajo `app/api/`", () => {
    expect(puertasHttp(CON_FETCH)).toEqual(["fetch(", "ruta /api/"]);
  });

  it("cae el que anade una SEGUNDA accion", () => {
    expect(accionesImportadas(CON_OTRA_ACCION)).toEqual([
      ACCION,
      "@/lib/actions/conteo-entregas",
    ]);
  });

  it("un comentario que NOMBRA la capa prohibida no es una violacion", () => {
    // La cabecera del componente dice, con todas las letras, que no importa Prisma ni un
    // repositorio. Censar el texto crudo obligaria a borrar esa explicacion para pasar.
    const SOLO_PROSA = `
// Este componente no importa "@/lib/services/CohorteCargaService" ni "@prisma/client".
/* Tampoco hace fetch("/api/lo-que-sea"). */
import { consultarCohorteCarga } from "@/lib/actions/cohorte-carga";
export const T = consultarCohorteCarga;
`;
    expect(capasDeDatosImportadas(SOLO_PROSA)).toEqual([]);
    expect(puertasHttp(SOLO_PROSA)).toEqual([]);
    expect(importaLaAccion(SOLO_PROSA)).toBe(true);
  });
});
