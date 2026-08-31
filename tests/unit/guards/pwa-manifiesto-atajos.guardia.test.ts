import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SIDEBAR_ITEMS, type MenuItem } from "@/lib/auth/menu-visibility";

// Feature 284 — GUARDIA DEL MANIFIESTO, DE LOS ATAJOS Y DE LOS ICONOS.
//
// Nada de lo que vigila este archivo rompe ruidosamente: un manifiesto con un `id` distinto
// deja DOS Ordenex instaladas en el mismo telefono, un atajo a una ruta por rol lleva a un
// `notFound()` desde el menu del icono, y un icono `maskable` con las esquinas ya redondeadas
// se ve con doble redondeo. Todo eso compila, despliega y no pone rojo nada.
//
// Vive en `tests/unit/guards/` porque un cambio en `public/**` no lo selecciona ningun grafo
// de imports (R24).

const RAIZ = path.resolve(__dirname, "..", "..", "..");
const MANIFIESTO = JSON.parse(
  fs.readFileSync(path.join(RAIZ, "public/manifest.json"), "utf8"),
) as Manifiesto;
const LAYOUT = fs.readFileSync(path.join(RAIZ, "app/layout.tsx"), "utf8");

interface Recurso {
  src: string;
  sizes: string;
  type?: string;
  purpose?: string;
}

interface Atajo {
  name?: string;
  url?: string;
}

interface Manifiesto {
  id?: string;
  name: string;
  short_name?: string;
  description?: string;
  start_url: string;
  scope?: string;
  display: string;
  orientation?: string;
  theme_color?: string;
  background_color?: string;
  categories?: string[];
  icons: Recurso[];
  screenshots?: Recurso[];
  shortcuts?: Atajo[];
}

/** Dimensiones reales del PNG, leidas de su cabecera IHDR (bytes 16-24). */
function dimensionesPng(rutaPublica: string): { ancho: number; alto: number } {
  const buffer = fs.readFileSync(path.join(RAIZ, "public", rutaPublica));
  expect(buffer.subarray(1, 4).toString()).toBe("PNG");
  return { ancho: buffer.readUInt32BE(16), alto: buffer.readUInt32BE(20) };
}

/* -------------------------------------------------------------------------- */
/* 1 · La identidad y las claves del manifiesto (R14, R15)                     */
/* -------------------------------------------------------------------------- */

describe("pwa · el manifiesto", () => {
  it("el id preserva la identidad instalada", () => {
    // Exactamente "/" y no otra cosa: el `id` por defecto de una app instalada es su
    // `start_url`, asi que "/" preserva la identidad de quien YA la tenga instalada.
    // Cualquier otro valor ("ordenex", "/?source=pwa") la CAMBIA, y el telefono acaba con dos
    // Ordenex en el lanzador: la vieja, huerfana, y la nueva.
    expect(MANIFIESTO.id).toBe("/");
    expect(MANIFIESTO.id).toBe(MANIFIESTO.start_url);
  });

  it("conserva sus diez claves con su valor", () => {
    // R15 es un requisito de NO REGRESION: `orientation` y `categories` ya estaban (la ficha
    // decia que faltaban y era falso), y lo unico que habia que hacer con ellas era no
    // perderlas al añadir el `id`.
    expect(MANIFIESTO.name).toBe("Ordenex");
    expect(MANIFIESTO.short_name).toBe("Ordenex");
    expect(MANIFIESTO.description).toBe("Plataforma de logística y entregas Ordenex");
    expect(MANIFIESTO.start_url).toBe("/");
    expect(MANIFIESTO.scope).toBe("/");
    expect(MANIFIESTO.display).toBe("standalone");
    expect(MANIFIESTO.orientation).toBe("portrait-primary");
    expect(MANIFIESTO.theme_color).toBe("#0d2444");
    expect(MANIFIESTO.background_color).toBe("#f7f8fc");
    expect(MANIFIESTO.categories).toEqual(["business", "productivity"]);
    expect(MANIFIESTO.screenshots?.length).toBe(3);
  });
});

/* -------------------------------------------------------------------------- */
/* 2 · Los atajos (R16, R17) — y por que hay CERO                              */
/* -------------------------------------------------------------------------- */

/**
 * Rutas que resuelven el destino POR ROL en vez de negarlo. Hoy solo `/dashboard`: despacha
 * segun el rol del actor (`app/(app)/dashboard/page.tsx`) en lugar de devolver `notFound()`.
 * Es la unica excepcion legitima a la regla de abajo, y por eso va escrita con su motivo.
 */
const DESPACHADORAS = ["/dashboard"];

/** Destinos NAVEGABLES de un item: sus subitems si los tiene, si no su propio href. */
function destinosDe(item: MenuItem): string[] {
  return item.children ? item.children.map((c) => c.href) : [item.href];
}

/** Union de todos los roles que aparecen en algun item del menu. Nada de listas copiadas. */
const rolesConMenu = new Set<string>(SIDEBAR_ITEMS.flatMap((item) => [...item.roles]));

/** Roles que LLEGAN a una url, derivado de `SIDEBAR_ITEMS` (el subitem hereda del padre). */
function rolesQueLlegan(url: string): Set<string> {
  const roles = new Set<string>();
  for (const item of SIDEBAR_ITEMS) {
    if (destinosDe(item).includes(url) || item.href === url) {
      for (const rol of item.roles) roles.add(rol);
    }
  }
  return roles;
}

/**
 * La regla, expresada una sola vez y usada tanto sobre el manifiesto real como sobre uno de
 * mentira: un atajo vale si TODOS los roles con menu llegan a su destino, o si el destino
 * despacha por rol. Devuelve los motivos de rechazo (vacio = pasa).
 */
function motivosDeRechazo(atajos: Atajo[]): string[] {
  const motivos: string[] = [];
  for (const atajo of atajos) {
    if (!atajo.name || !atajo.url) {
      motivos.push(`un atajo sin name o sin url: ${JSON.stringify(atajo)}`);
      continue;
    }
    if (DESPACHADORAS.includes(atajo.url)) continue;
    const llegan = rolesQueLlegan(atajo.url);
    const fuera = [...rolesConMenu].filter((rol) => !llegan.has(rol));
    if (fuera.length > 0) {
      motivos.push(`${atajo.url} es inalcanzable para: ${fuera.sort().join(", ")}`);
    }
  }
  return motivos;
}

describe("pwa · los atajos del manifiesto", () => {
  it("ningun atajo deja fuera a un rol con menu", () => {
    expect(motivosDeRechazo(MANIFIESTO.shortcuts ?? [])).toEqual([]);
  });

  it("un atajo a una ruta por rol se rechaza", () => {
    // ANTI-VACUIDAD. Sin este caso la regla estaria verde por no haber atajos, no por
    // funcionar. Se le da un manifiesto DE MENTIRA y se exige que lo rechace.
    const motivos = motivosDeRechazo([{ name: "Órdenes", url: "/ordenes" }]);
    expect(motivos.length).toBe(1);
    expect(motivos[0]).toContain("/ordenes");
    expect(motivos[0]).toContain("mensajero");

    // Y lo contrario: la excepcion declarada SI pasa, y un atajo a medias tambien se rechaza.
    expect(motivosDeRechazo([{ name: "Inicio", url: "/dashboard" }])).toEqual([]);
    expect(motivosDeRechazo([{ url: "/dashboard" }]).length).toBe(1);
  });

  it("hoy no hay ni un destino que vean todos los roles: por eso son cero atajos", () => {
    // LA MEDICION QUE SOSTIENE LA DECISION (humano, 2026-08-25), re-derivada aqui en vez de
    // copiada: si mañana entra una ruta universal, estos numeros cambian y la ficha del atajo
    // se puede abrir con datos. Si alguien mete un atajo antes, el caso de arriba lo caza.
    const porRol = new Map<string, Set<string>>();
    for (const rol of rolesConMenu) {
      const destinos = SIDEBAR_ITEMS.filter((i) => i.roles.includes(rol as never)).flatMap(
        destinosDe,
      );
      porRol.set(rol, new Set(destinos));
    }

    // Feature 321 — `maestro` 16 -> 17 y `admin` 11 -> 12, por UN destino nuevo y solo uno:
    // el subitem «Conversaciones» (`/historico/conversaciones`) del item «Histórico», visible
    // exclusivamente para esos dos roles (`ROLES_HISTORICO_CONVERSACIONES`, decision humana del
    // 2026-08-28). Por eso `adminSatelite`, `mensajero` y `adminTienda` NO se mueven — y que
    // sigan clavados es parte de lo que se afirma aqui. El item padre no suma: tiene `children`,
    // asi que `destinosDe` devuelve los subitems y no su `href`, que no navega.
    // La CONCLUSION no cambia: el destino nuevo lo ven dos roles de cinco, la interseccion
    // sigue vacia y por tanto siguen siendo CERO atajos.
    // Ficha 335 — `adminTienda` 3 -> 4, por UN destino nuevo y solo uno: el ítem «Mi wallet»
    // (`/mi-wallet`), visible exclusivamente para ese rol (`ROLES_MI_WALLET`). Los otros cuatro
    // roles NO se mueven, y que sigan clavados es parte de lo que se afirma aquí: si el ítem se
    // hubiera abierto de más, este mismo `toEqual` lo diría.
    // La CONCLUSIÓN no cambia: el destino nuevo lo ve UN rol de cinco, así que la intersección
    // sigue vacía y por tanto siguen siendo CERO atajos. Un atajo del manifiesto es global a la
    // app —lo ve quien instale la PWA, sea cual sea su rol—, y por eso solo puede salir de la
    // intersección.
    expect(Object.fromEntries([...porRol].map(([rol, d]) => [rol, d.size]))).toEqual({
      maestro: 17,
      admin: 12,
      adminSatelite: 6,
      mensajero: 6,
      adminTienda: 4,
    });

    const interseccion = [...porRol.values()].reduce((acc, destinos) =>
      new Set([...acc].filter((url) => destinos.has(url))),
    );
    expect([...interseccion]).toEqual([]);
    expect(MANIFIESTO.shortcuts).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* 3 · Los iconos y el `<head>` (R18, R19, R20)                                */
/* -------------------------------------------------------------------------- */

const APPLE_TOUCH_ICON = /rel="apple-touch-icon"[^>]*href="([^"]+)"/.exec(LAYOUT)?.[1];

describe("pwa · los iconos y las metas de iOS", () => {
  it("el head declara las dos metas de capacidad", () => {
    // La moderna Y la de Apple: `apple-mobile-web-app-capable` esta deprecada pero la siguen
    // leyendo iPhones vivos, asi que se conserva; sin la moderna, el navegador avisa.
    expect(LAYOUT).toContain('<meta name="mobile-web-app-capable" content="yes" />');
    expect(LAYOUT).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
  });

  it("el apple-touch-icon mide 180", () => {
    expect(APPLE_TOUCH_ICON).toBe("/icons/icon-180.png");
    const { ancho, alto } = dimensionesPng(APPLE_TOUCH_ICON!);
    expect(`${ancho}x${alto}`).toBe("180x180");
  });

  it("cada png referenciado existe y mide lo declarado", () => {
    for (const recurso of [...MANIFIESTO.icons, ...(MANIFIESTO.screenshots ?? [])]) {
      expect(
        fs.existsSync(path.join(RAIZ, "public", recurso.src)),
        `falta ${recurso.src}`,
      ).toBe(true);
      const { ancho, alto } = dimensionesPng(recurso.src);
      expect(`${ancho}x${alto}`, `${recurso.src} no mide lo que declara`).toBe(recurso.sizes);
    }
  });

  it("hay dos variantes del icono y ninguna hace de las dos", () => {
    // `purpose: "any maskable"` -es lo que habia- significa "usame para las dos cosas", y con
    // UN solo archivo eso es imposible: el que se ve bien suelto (esquinas redondeadas) da
    // doble redondeo dentro de la mascara del lanzador, y el que sirve para la mascara (a
    // sangre) se ve cuadrado cuando nadie lo enmascara.
    const any = MANIFIESTO.icons.filter((i) => i.purpose === "any");
    const maskable = MANIFIESTO.icons.filter((i) => i.purpose === "maskable");
    expect(any.map((i) => i.sizes).sort()).toEqual(["192x192", "512x512"]);
    expect(maskable.map((i) => i.sizes).sort()).toEqual(["192x192", "512x512"]);
    for (const icono of MANIFIESTO.icons) {
      expect(icono.purpose, `${icono.src} declara dos propositos a la vez`).not.toContain(" ");
    }
  });

  it("y la diferencia se ve en el pixel de la esquina, no solo en el texto del purpose", async () => {
    // La comprobacion que de verdad distingue las dos variantes: el `any` tiene la esquina
    // TRANSPARENTE (esta redondeado) y el `maskable` la tiene OPACA (va a sangre). Declarar
    // `purpose: "maskable"` sobre un PNG con las esquinas recortadas seria mentir en el
    // manifiesto sin que nada se pusiera rojo.
    const sharp = (await import("sharp")).default;

    async function esquina(src: string) {
      const { data, info } = await sharp(path.join(RAIZ, "public", src))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return { alfa: data[3], canales: info.channels };
    }

    for (const icono of MANIFIESTO.icons) {
      const { alfa } = await esquina(icono.src);
      if (icono.purpose === "maskable") {
        expect(alfa, `${icono.src} es maskable y su esquina no es opaca`).toBe(255);
      } else {
        expect(alfa, `${icono.src} es "any" y su esquina no es transparente`).toBe(0);
      }
    }

    // El de iOS va a sangre por el mismo motivo: iOS redondea el solo.
    expect((await esquina(APPLE_TOUCH_ICON!)).alfa).toBe(255);
  });
});
