import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CLAVE_ROL,
  PLACEHOLDER_BUSQUEDA,
  construirFiltrosUsuarios,
} from "@/app/(app)/configuracion/_components/usuarios-filtros-def";
import {
  hayFiltroUsuarios,
  seleccionAFiltroUsuarios,
  serializarFiltroUsuarios,
} from "@/app/(app)/configuracion/_components/seleccion-a-filtro-usuarios";
import { ROL_LABELS } from "@/lib/auth/rol-label";
import {
  USUARIO_BUSQUEDA_MAX_CHARS,
  USUARIO_BUSQUEDA_MIN_CHARS,
} from "@/lib/types/usuario";

// Feature 285 / T4.1 + T4.2 (design §9.4) — la SUPERFICIE PURA: la declaracion de la
// barra y la traduccion seleccion -> entrada del borde. Sin React y sin fetch: lo que se
// mide aqui son las dos reglas que, si se rompen, dejan el listado devolviendo de mas o
// respondiendo `validation_error` por algo que el usuario esta escribiendo.

function filtroRol() {
  const def = construirFiltrosUsuarios().find((f) => f.key === CLAVE_ROL);
  if (!def) throw new Error("no se declaro el filtro de rol");
  return def;
}

describe("construirFiltrosUsuarios — declaracion de la barra (T-P1, R12)", () => {
  it("T-P1/R12: declara el rol como UNICO filtro, y en seleccion MULTIPLE", () => {
    const declarados = construirFiltrosUsuarios();

    // El buscador NO se declara aqui: lo posee `BuscadorFiltros`, que es la barra
    // permanente. Un `FilterDef` de texto ademas del campo daria DOS buscadores.
    expect(declarados.map((f) => f.key)).toEqual([CLAVE_ROL]);
    // `multi`, no `single`: la pregunta habitual es "quien NO es tienda", y con un
    // desplegable de valor unico eso no se puede preguntar.
    expect(filtroRol().kind).toBe("multi");
    expect(filtroRol().label).toBe("Rol");
  });

  it("T-P1/R12: ofrece TODOS los roles que el sistema reconoce, ni uno menos", () => {
    const valores = (filtroRol().options ?? []).map((o) => o.value);

    // Exhaustividad contra `ROL_LABELS`, que es `Record<RolValue,string>` sobre el enum
    // de Postgres: si manana el enum gana un valor, el compilador exige su etiqueta y la
    // opcion sale sola. Un `.filter(...)` que dejara alguno fuera cae aqui.
    expect([...valores].sort()).toEqual(Object.keys(ROL_LABELS).sort());
    // Sin duplicados: dos opciones con el mismo valor marcarian dos veces lo mismo.
    expect(new Set(valores).size).toBe(valores.length);
  });

  it("T-P1/R12: cada opcion se ofrece con su etiqueta LEGIBLE en español, no con el valor del enum", () => {
    const porValor = new Map(
      (filtroRol().options ?? []).map((o) => [o.value, o.label]),
    );

    // Literales A PROPOSITO, y no `ROL_LABELS[v]`: comparar la etiqueta contra la misma
    // fuente que la genera es una asercion que siempre esta verde y no distingue
    // "Admin de tienda" de "adminTienda". Estos cuatro son los que se leen distinto del
    // valor del enum, que es justo lo que R12 exige.
    expect(porValor.get("adminTienda")).toBe("Admin de tienda");
    expect(porValor.get("adminSatelite")).toBe("Admin satélite");
    expect(porValor.get("apiKey")).toBe("API key");
    expect(porValor.get("admin")).toBe("Administrador");
    // P2 del spec: `apiKey` NO es una persona, pero SI aparece como fila del listado, y
    // un filtro que oculta lo que la tabla muestra es un filtro que miente.
    expect(porValor.has("apiKey")).toBe(true);
  });

  it("T-P4/R11: el texto de ayuda del campo declara que busca por nombre O correo", () => {
    expect(PLACEHOLDER_BUSQUEDA).toMatch(/nombre/i);
    expect(PLACEHOLDER_BUSQUEDA).toMatch(/correo/i);
    // Y no es un "Buscar…" generico: sin decir su alcance, el campo se usa mal o no se usa.
    expect(PLACEHOLDER_BUSQUEDA).not.toBe("Buscar…");
  });

  it("no importa NADA del modulo de ordenes: reusar es consumir lo compartido", () => {
    const raiz = resolve(__dirname, "../../..");
    for (const archivo of [
      "app/(app)/configuracion/_components/usuarios-filtros-def.ts",
      "app/(app)/configuracion/_components/seleccion-a-filtro-usuarios.ts",
    ]) {
      const fuente = readFileSync(resolve(raiz, archivo), "utf8");
      const imports = [...fuente.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
      expect(imports.filter((m) => m.includes("ordenes"))).toEqual([]);
    }
  });
});

describe("seleccionAFiltroUsuarios — roles (T-P2, R14/R15)", () => {
  it("T-P2/R15: seleccion VACIA -> la clave `rol` se OMITE, jamas viaja `[]`", () => {
    // El schema declara `rol` con `.nonempty()`: `[]` es `validation_error`, NUNCA "sin
    // filtro". Se comprueba la AUSENCIA de la clave, no que valga `[]` o `undefined`:
    // `{ rol: undefined }` viajaria igual en un JSON y `toEqual` no lo distinguiria.
    const sinNada = seleccionAFiltroUsuarios({}, "");
    expect(Object.keys(sinNada)).not.toContain("rol");
    expect(sinNada).toEqual({});

    const conListaVacia = seleccionAFiltroUsuarios({ [CLAVE_ROL]: [] }, "");
    expect(Object.keys(conListaVacia)).not.toContain("rol");
    expect(conListaVacia).toEqual({});
  });

  it("T-P2/R13: con roles marcados viaja la lista, tal cual y por VALOR del enum", () => {
    const out = seleccionAFiltroUsuarios(
      { [CLAVE_ROL]: ["mensajero", "admin"] },
      "",
    );
    expect(out).toEqual({ rol: ["mensajero", "admin"] });
  });

  it("una clave AJENA en la seleccion no se cuela en la entrada del borde", () => {
    // El schema del modo completo es `.strict()`: una clave desconocida seria
    // `validation_error` y la descarga no devolveria ni una fila.
    const out = seleccionAFiltroUsuarios(
      { [CLAVE_ROL]: ["admin"], zona_id: ["z1"] },
      "ana",
    );
    expect(Object.keys(out).sort()).toEqual(["q", "rol"]);
  });
});

describe("seleccionAFiltroUsuarios — termino (T-P3, R6/R7/R9)", () => {
  it("T-P3/R7: por debajo del minimo la clave `q` se OMITE (no es un error, es 'aun no')", () => {
    const corto = "x".repeat(USUARIO_BUSQUEDA_MIN_CHARS - 1);
    const out = seleccionAFiltroUsuarios({}, corto);
    expect(Object.keys(out)).not.toContain("q");

    // Y justo EN el minimo si viaja: el limite es inclusivo, igual que en el schema.
    const justo = "x".repeat(USUARIO_BUSQUEDA_MIN_CHARS);
    expect(seleccionAFiltroUsuarios({}, justo)).toEqual({ q: justo });
  });

  it("T-P3/R6: el termino se RECORTA antes de medirlo contra el minimo", () => {
    // El borde hace `.trim()` ANTES del `.min()`, asi que "  a  " es 1 caracter, no 5.
    expect(Object.keys(seleccionAFiltroUsuarios({}, "  a  "))).not.toContain("q");
    expect(seleccionAFiltroUsuarios({}, "  ab  ")).toEqual({ q: "ab" });
    // Solo espacios equivale a "sin busqueda".
    expect(seleccionAFiltroUsuarios({}, "     ")).toEqual({});
  });

  it("T-P3/R9: por encima del maximo se TRUNCA, para que un pegado largo no deje el listado en error", () => {
    const largo = "a".repeat(USUARIO_BUSQUEDA_MAX_CHARS + 50);
    const out = seleccionAFiltroUsuarios({}, largo);

    expect(out.q).toHaveLength(USUARIO_BUSQUEDA_MAX_CHARS);
    expect(out.q).toBe("a".repeat(USUARIO_BUSQUEDA_MAX_CHARS));
    // Lo que importa de R9 no es la longitud: es que lo truncado SIGUE siendo entrada
    // valida para el borde. Si el `max` del schema se cruzara, esto seria un listado en
    // estado de error en vez de un listado filtrado.
    expect(out.q!.length).toBeLessThanOrEqual(USUARIO_BUSQUEDA_MAX_CHARS);
    expect(out.q!.length).toBeGreaterThanOrEqual(USUARIO_BUSQUEDA_MIN_CHARS);
  });

  it("R9: si el corte del maximo cae dentro de una tira de espacios, lo truncado NO se manda por debajo del minimo", () => {
    // Caso real de un pegado: una letra, doscientos espacios y otra letra. Recortado
    // mide 202, asi que se trunca a 120 — y esos 120 son "a" + 119 espacios, que el
    // `.trim()` del BORDE deja en 1 caracter: `validation_error` por un texto que el
    // usuario solo pego. Truncar sin volver a recortar es exactamente ese agujero.
    const pegado = `a${" ".repeat(200)}b`;
    const out = seleccionAFiltroUsuarios({}, pegado);
    expect(Object.keys(out)).not.toContain("q");
  });

  it("R16: termino y roles viajan JUNTOS, no se anulan entre si", () => {
    expect(
      seleccionAFiltroUsuarios({ [CLAVE_ROL]: ["mensajero"] }, "  ana  "),
    ).toEqual({ rol: ["mensajero"], q: "ana" });
  });
});

describe("hayFiltroUsuarios / serializarFiltroUsuarios", () => {
  it("hayFiltro es FALSO con la barra abierta pero sin nada aplicado", () => {
    // Es la pregunta de la que dependen el `fallbackData`, el estado vacio y la entrada
    // de la descarga: un control montado sin marcar, o un caracter suelto, siguen
    // pintando el listado COMPLETO, asi que no cuentan como filtro.
    expect(hayFiltroUsuarios(seleccionAFiltroUsuarios({}, ""))).toBe(false);
    expect(hayFiltroUsuarios(seleccionAFiltroUsuarios({ [CLAVE_ROL]: [] }, "x"))).toBe(
      false,
    );
    expect(hayFiltroUsuarios(seleccionAFiltroUsuarios({}, "ana"))).toBe(true);
    expect(
      hayFiltroUsuarios(seleccionAFiltroUsuarios({ [CLAVE_ROL]: ["admin"] }, "")),
    ).toBe(true);
  });

  it("la key de SWR es la MISMA para dos selecciones equivalentes en distinto orden", () => {
    // Sin el `sort()`, marcar admin+mensajero y mensajero+admin serian dos entradas de
    // cache distintas y cada render dispararia una consulta nueva.
    const a = serializarFiltroUsuarios({ rol: ["mensajero", "admin"], q: "ana" });
    const b = serializarFiltroUsuarios({ rol: ["admin", "mensajero"], q: "ana" });
    expect(a).toBe(b);
    // ...y dos filtros DISTINTOS no comparten key (si no, la pantalla pintaria el
    // resultado del filtro anterior).
    expect(serializarFiltroUsuarios({ rol: ["admin"] })).not.toBe(
      serializarFiltroUsuarios({ rol: ["mensajero"] }),
    );
    expect(serializarFiltroUsuarios({ q: "ana" })).not.toBe(
      serializarFiltroUsuarios({}),
    );
  });
});
