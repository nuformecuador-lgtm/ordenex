import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  ESTADOS_FILTRO_CIERRES,
  filtrosCierresSchema,
  MAX_IDS_POR_FILTRO,
  sinFiltros,
} from "@/lib/types/filtros-cierres";
import { CIERRE_ESTADO_SEED } from "@/lib/types/cierre";
import {
  listarHistoricoCierresAdminSchema,
  listarPendientesCierresAdminSchema,
  listarHistoricoCierresAdminCompletoSchema,
  listarPendientesCierresAdminCompletoSchema,
} from "@/lib/types/cierres-admin";

const RAIZ = process.cwd();

/**
 * GUARDIA DEL PEDIDO HUMANO DEL 2026-08-16 — «filtros por fechas, bodegas, mensajeros» en los
 * listados de cierres.
 *
 * LO QUE VIGILA, en una frase: **un filtro puede quitar filas, nunca añadirlas.** El alcance —qué
 * cierres puede ver este actor— lo resuelve el servicio desde la sesión; estas claves (cuatro
 * desde el 2026-08-16, CINCO desde la ficha 386) solo recortan dentro de lo que el alcance ya dejó
 * pasar.
 *
 * POR QUÉ EXISTE, y por qué es una guardia y no un test de servicio: hasta esta feature el schema
 * de estos listados era `paginaInputSchema(...)` a secas, y su `.strict()` llevaba escrito un
 * comentario que nombraba a `destinoZonaId` como LA clave peligrosa — «el alcance de esta pantalla
 * es rol + zona DESTINO, así que una clave de alcance que el servicio llegara a leer algún día
 * abriría el dinero de la bodega vecina». Esta feature abre esa puerta A PROPÓSITO, pero solo
 * hasta cierto punto: entra `destinoZonaIds` (plural, recorte) y NO entra `destinoZonaId`
 * (singular, alcance). La diferencia son cuatro letras, se pierde en un `git blame` y no la caza
 * ningún typecheck. La caza esto.
 *
 * Las cuatro afirmaciones son independientes y ninguna sobra:
 *  (a) la lista blanca del bloque de filtros es EXACTAMENTE la que se decidió;
 *  (b) las claves de ALCANCE en singular siguen muriendo en el borde;
 *  (c) los dos listados y sus dos archivos aceptan el bloque, y aceptan el MISMO;
 *  (d) el repositorio compone los filtros con `AND` y no como claves hermanas del alcance —que
 *      es la única forma de que las dos condiciones se exijan a la vez—.
 */
describe("guardia: un filtro de cierres recorta dentro del alcance, nunca lo reabre", () => {
  const UUID = "11111111-1111-4111-8111-111111111111";
  const OTRO_UUID = "22222222-2222-4222-8222-222222222222";

  it("(a) la lista blanca del bloque de filtros es exactamente esta, y ninguna clave más", () => {
    // El objeto vacío es válido: sin filtros, el listado es el de antes de esta feature.
    expect(filtrosCierresSchema.safeParse({}).success).toBe(true);
    expect(sinFiltros(filtrosCierresSchema.parse({}))).toBe(true);

    const completo = {
      desde: "2026-08-01",
      hasta: "2026-08-16",
      destinoZonaIds: [UUID],
      mensajeroIds: [UUID, OTRO_UUID],
      // FICHA 386 (2026-09-07): la quinta clave. Está en ESTE literal a propósito — es el
      // contrato de la lista blanca, no una copia de la fuente: si alguien quitara `estados` del
      // schema, este `toEqual` se pondría rojo por la clave que sobra en el esperado.
      estados: ["solicitado", "aprobado"],
    };
    expect(filtrosCierresSchema.parse(completo)).toEqual(completo);
    expect(sinFiltros(filtrosCierresSchema.parse(completo))).toBe(false);

    // …y con SOLO el estado puesto tampoco es «sin filtros»: si `sinFiltros` no lo mirara, la
    // pantalla escondería el «limpiar» de un recorte que sí está aplicado.
    expect(sinFiltros(filtrosCierresSchema.parse({ estados: ["vencido"] }))).toBe(false);

    // `.strict()`: cualquier clave que no esté en la lista muere aquí.
    expect(filtrosCierresSchema.safeParse({ ...completo, loQueSea: 1 }).success).toBe(false);
  });

  it("(a2) FICHA 386 — el filtro de estado acepta los CUATRO estados del cierre y nada más", () => {
    // `ESTADOS_FILTRO_CIERRES` se escribe en `lib/types/filtros-cierres.ts` en vez de importar
    // `CIERRE_ESTADO_SEED` como valor: ese módulo es del BORDE y lo carga un componente
    // `"use client"`, y el seed arrastra `cierreConfig` (lee `process.env` con clave dinámica) al
    // bundle del navegador. El precio de esa decisión es que hay DOS listas, y esta afirmación es
    // lo que impide que se separen: como CONJUNTO son la misma, así que un estado nuevo en el
    // enum pone esto rojo y alguien decide si el filtro debe ofrecerlo.
    expect([...ESTADOS_FILTRO_CIERRES].sort()).toEqual([...CIERRE_ESTADO_SEED].sort());

    // Cada uno de los cuatro entra por separado — incluido `vencido`, que es el que da sentido a
    // la ficha (separa «espera aprobación» de «lo creó el corte nocturno y hay que reenviarlo»).
    for (const estado of CIERRE_ESTADO_SEED) {
      const r = filtrosCierresSchema.safeParse({ estados: [estado] });
      expect(r.success, `el estado \`${estado}\` no entró en el filtro`).toBe(true);
    }
    // Los cuatro a la vez también: es «todos», escrito explícito.
    expect(filtrosCierresSchema.safeParse({ estados: [...CIERRE_ESTADO_SEED] }).success).toBe(true);

    // Un valor que no es un estado muere en el BORDE, no en la consulta: sin este `z.enum`
    // viajaría a Postgres y reventaría el enum nativo con un 500 en vez de un `validation_error`.
    expect(filtrosCierresSchema.safeParse({ estados: ["consolidado"] }).success).toBe(false);
    expect(filtrosCierresSchema.safeParse({ estados: [""] }).success).toBe(false);

    // `[]` no es «sin filtro»: sería «los cierres de cero estados», que es siempre nada. La
    // pantalla emite `undefined` para decir «todos», y el borde lo exige por si algún día no lo
    // hace. Misma regla que las listas de ids.
    expect(filtrosCierresSchema.safeParse({ estados: [] }).success).toBe(false);

    // Y el SINGULAR no existe: `estado` no es una clave de este bloque.
    expect(filtrosCierresSchema.safeParse({ estado: "aprobado" }).success).toBe(false);
  });

  it("(b) las claves de ALCANCE en singular no entran, ni en el bloque ni en el listado", () => {
    // ESTA es la afirmación que da nombre al archivo. `destinoZonaIds` (plural) es un recorte y
    // se acepta; `destinoZonaId` (singular) es la clave con la que un cliente pediría el alcance
    // de otra bodega, y muere en el borde con `validation_error`.
    for (const clave of ["destinoZonaId", "mensajeroId", "alcance", "actorId", "rol"]) {
      expect(
        filtrosCierresSchema.safeParse({ [clave]: UUID }).success,
        `la clave de alcance \`${clave}\` entró en el bloque de filtros`,
      ).toBe(false);
      expect(
        listarHistoricoCierresAdminSchema.safeParse({ [clave]: UUID }).success,
        `la clave de alcance \`${clave}\` entró en el listado`,
      ).toBe(false);
      expect(
        listarHistoricoCierresAdminSchema.safeParse({ filtros: { [clave]: UUID } }).success,
        `la clave de alcance \`${clave}\` entró anidada en \`filtros\``,
      ).toBe(false);
    }
  });

  it("(c) los dos listados y sus dos archivos aceptan el MISMO bloque de filtros", () => {
    // Que el archivo acepte los mismos filtros que la página es lo que hace que «descargar»
    // signifique «esto que estoy viendo, entero». Si divergieran, el usuario con un filtro
    // puesto se llevaría un archivo que no reconoce, y nada fallaría.
    // FICHA 386: `estados` viaja en el MISMO bloque, así que los cuatro puntos de entrada lo
    // aceptan por construcción. Si alguien lo declarara suelto en el schema de una página, el
    // archivo de esa lista dejaría de poder reproducirla y nada fallaría.
    const filtros = { desde: "2026-08-01", mensajeroIds: [UUID], estados: ["vencido"] };
    for (const [nombre, schema] of [
      ["histórico (página)", listarHistoricoCierresAdminSchema],
      ["cola (página)", listarPendientesCierresAdminSchema],
      ["histórico (archivo)", listarHistoricoCierresAdminCompletoSchema],
      ["cola (archivo)", listarPendientesCierresAdminCompletoSchema],
    ] as const) {
      const r = schema.safeParse({ filtros });
      expect(r.success, `${nombre} rechazó el bloque de filtros`).toBe(true);
      if (r.success) expect(r.data.filtros, nombre).toEqual(filtros);
    }

    // Y los archivos siguen sin aceptar paginación: un conjunto no tiene página.
    expect(
      listarHistoricoCierresAdminCompletoSchema.safeParse({ page: 2 }).success,
      "el archivo aceptó una página",
    ).toBe(false);
  });

  it("(d) el repositorio compone los filtros con AND, no como claves hermanas del alcance", () => {
    // Por qué se mira el TEXTO y no el resultado de una consulta: lo que hace segura la
    // composición es que el filtro de zona vaya dentro de un `AND` junto al `alcanceWhere`. Si
    // alguien lo reescribiera como clave hermana —`destinoZonaId: { in: [...] }` al lado del
    // `destinoZonaId` escalar del alcance—, la segunda ganaría y el recorte pasaría a ser una
    // SUSTITUCIÓN del alcance. Eso no lo caza el typecheck (las dos formas compilan) y en un
    // test de integración solo se vería con un `adminSatelite` pidiendo la zona del vecino, que
    // es justo el caso que nadie escribe por costumbre.
    const fuente = readFileSync(
      path.join(RAIZ, "lib", "repositories", "CierresAdminRepository.ts"),
      "utf8",
    );

    // El bloque existe y sale de UNA declaración compartida por los cuatro caminos.
    expect(fuente).toMatch(/function filtrosWhere\(/);
    for (const criterio of ["historicoWhere", "colaWhere"]) {
      // Hasta el cierre de la FUNCIÓN (una `}` a principio de línea), no hasta la primera `}`
      // que aparezca: dentro del cuerpo hay objetos literales y el corte caería en el primero.
      const inicio = fuente.indexOf(`function ${criterio}(`);
      const cuerpo = fuente.slice(inicio, fuente.indexOf("\n}", inicio));
      expect(cuerpo, `\`${criterio}\` dejó de leer \`filtrosWhere\``).toContain("filtrosWhere");
      expect(cuerpo, `\`${criterio}\` dejó de componer los filtros con AND`).toContain("AND:");
      expect(cuerpo, `\`${criterio}\` dejó de aplicar el alcance`).toContain("alcanceWhere");

      // FICHA 386 — el mismo argumento, con la clave que MÁS duele. Estos dos criterios ya
      // escriben `estado` como clave hermana: es el corte que decide en qué lista cae cada
      // cierre. El recorte por estado del filtro NO puede escribirse aquí al lado —la última
      // clave `estado` del objeto gana, y el recorte pasaría a SUSTITUIR al corte: pedir
      // `aprobado` en pendientes devolvería aprobados—. Así que aquí debe haber EXACTAMENTE UNA
      // mención de `estado:`, la de la lista; la del filtro vive dentro de `filtrosWhere`.
      const menciones = cuerpo.match(/\bestado:/g) ?? [];
      expect(
        menciones.length,
        `\`${criterio}\` escribe ${menciones.length} claves \`estado\`: el recorte por estado ` +
          "se coló como clave hermana y sustituye al corte cola/histórico en vez de sumarse",
      ).toBe(1);
    }

    // Y el filtro de zona se escribe DENTRO del `AND` (en `filtrosWhere`), nunca fuera.
    const bloque = fuente.slice(
      fuente.indexOf("function filtrosWhere("),
      fuente.indexOf("const ORDEN_CIERRES_ADMIN"),
    );
    expect(bloque).toMatch(/destinoZonaId:\s*\{\s*in:/);
    expect(bloque).toMatch(/mensajeroId:\s*\{\s*in:/);
    // FICHA 386: el recorte por estado, en ese mismo bloque y por el mismo motivo.
    expect(bloque).toMatch(/estado:\s*\{\s*in:/);
  });

  it("un rango de fechas invertido se rechaza en el borde, no devuelve cero filas en silencio", () => {
    // «No hay cierres» y «pediste del 30 al 1» se leen igual en una lista vacía. El `refine`
    // los separa antes de que la consulta salga.
    const r = filtrosCierresSchema.safeParse({ desde: "2026-08-16", hasta: "2026-08-01" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.includes("hasta"))).toBe(true);
    }
    // El rango de un solo día (desde === hasta) SÍ es válido: es «los cierres de ese día».
    expect(
      filtrosCierresSchema.safeParse({ desde: "2026-08-16", hasta: "2026-08-16" }).success,
    ).toBe(true);
  });

  it("una lista de ids ni viene vacía ni es un canal para mandar un dataset", () => {
    // `[]` no es «sin filtro»: sería «los cierres de cero mensajeros», que es siempre nada. La
    // pantalla emite `undefined` en ese caso, y el borde lo exige por si algún día no lo hace.
    expect(filtrosCierresSchema.safeParse({ mensajeroIds: [] }).success).toBe(false);
    // Y hay tope: un filtro recorta, no transporta.
    const demasiados = Array.from({ length: MAX_IDS_POR_FILTRO + 1 }, () => UUID);
    expect(filtrosCierresSchema.safeParse({ mensajeroIds: demasiados }).success).toBe(false);
    // Ids que no son uuid tampoco entran (no llegarían a casar nada, pero viajarían a la base).
    expect(filtrosCierresSchema.safeParse({ mensajeroIds: ["../../etc"] }).success).toBe(false);
  });
});
