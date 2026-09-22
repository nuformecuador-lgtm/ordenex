import { describe, it, expect } from "vitest";
import type { FilterDef } from "@/components/shared/FilterComponent";
import {
  catalogoCargado,
  catalogoNoDisponible,
  evaluarVista,
  type Aplicabilidad,
} from "@/lib/utils/vista-filtro-aplicabilidad";
import { VISTA_FILTRO_VERSION, type VistaFiltroPayload } from "@/lib/types/vista-filtro";

// FICHA 453 (T4.1) — R8, R24, R25, R29 y R30 sobre el modulo puro de aplicabilidad.
//
// ⚠️ EL CASO QUE ESTE ARCHIVO EXISTE PARA SOSTENER es el ultimo bloque: «catalogo caido» NO es
// «valor desaparecido». Si alguien colapsa los dos casos —clasificando con las opciones a medio
// llegar— TODAS las vistas de todo el mundo saldrian incompletas a la vez, y al recargar volverian
// a estar bien. Esos casos tienen que ponerse rojos.

const ZONA: FilterDef = {
  key: "zona",
  label: "Zona",
  kind: "multi",
  options: [
    { value: "z-1", label: "San Jose" },
    { value: "z-2", label: "Cartago" },
  ],
};

const TIENDA: FilterDef = {
  key: "tienda",
  label: "Tienda",
  kind: "single",
  options: [{ value: "t-1", label: "Nuform" }],
};

const CREADO: FilterDef = {
  key: "created",
  label: "Fecha de creacion",
  kind: "dateRange",
  options: [
    { value: "30d", label: "Ultimos 30 dias", defaultRange: { desde: "2026-08-22", hasta: "2026-09-21" } },
  ],
};

const REASIGNABLES: FilterDef = { key: "reasignables", label: "Reasignables", kind: "boolean" };
const BUSQUEDA: FilterDef = { key: "q", label: "Buscar", kind: "text" };

const TODOS = [ZONA, TIENDA, CREADO, REASIGNABLES, BUSQUEDA];

function payload(over: Partial<VistaFiltroPayload> = {}): VistaFiltroPayload {
  return {
    v: VISTA_FILTRO_VERSION,
    termino: "",
    activos: [],
    seleccion: {},
    ...over,
  };
}

/** Las partes perdidas, en un formato comodo de afirmar. */
function perdidasDe(r: Aplicabilidad): { clave: string; motivo: string; cuantos: number }[] {
  return r.estado === "incompleta"
    ? r.perdidas.map((p) => ({ clave: p.clave, motivo: p.motivo, cuantos: p.valoresPerdidos }))
    : [];
}

describe("453/R24 · una vista aplicable entera se aplica sin preguntar", () => {
  it("⭑ todos los filtros declarados y todos los valores vivos", () => {
    const vista = payload({
      termino: "san jose",
      activos: ["zona", "created"],
      seleccion: { zona: ["z-1", "z-2"], created: ["30d", "", ""] },
    });
    const r = evaluarVista(catalogoCargado(TODOS), vista);

    expect(r.estado).toBe("aplicable_entera");
    if (r.estado !== "aplicable_entera") return;
    // R18: las tres piezas se reponen tal cual.
    expect(r.aplicable).toEqual(vista);
  });

  it("⭑ un control MONTADO y vacio sigue siendo aplicable (no aporta valores, pero se repone)", () => {
    const vista = payload({ activos: ["tienda"] });
    const r = evaluarVista(catalogoCargado(TODOS), vista);
    expect(r.estado).toBe("aplicable_entera");
    if (r.estado !== "aplicable_entera") return;
    expect(r.aplicable.activos).toEqual(["tienda"]);
  });
});

describe("453/R24 · las cinco filas de la tabla de tipos (design §8.1)", () => {
  it("⭑ `multi`: se pierde lo que ya no existe y se conserva lo vivo", () => {
    const vista = payload({
      activos: ["zona"],
      seleccion: { zona: ["z-1", "z-9", "z-2"] },
    });
    const r = evaluarVista(catalogoCargado(TODOS), vista);

    expect(r.estado).toBe("incompleta");
    expect(perdidasDe(r)).toEqual([{ clave: "zona", motivo: "valores_desaparecidos", cuantos: 1 }]);
    if (r.estado !== "incompleta") return;
    // «Una vista con un mensajero de baja y cinco distritos vivos sigue valiendo para los cinco»:
    // lo que sobrevive se conserva, y lo perdido se NOMBRA igual.
    expect(r.aplicable.seleccion.zona).toEqual(["z-1", "z-2"]);
  });

  it("⭑ `single`: si el valor no esta, el filtro entero se cae", () => {
    const vista = payload({ activos: ["tienda"], seleccion: { tienda: ["t-borrada"] } });
    const r = evaluarVista(catalogoCargado(TODOS), vista);

    expect(perdidasDe(r)).toEqual([{ clave: "tienda", motivo: "valores_desaparecidos", cuantos: 1 }]);
    if (r.estado !== "incompleta") return;
    expect(r.aplicable.seleccion.tienda).toBeUndefined();
    // Y el control sigue montado: la pantalla lo declara, solo que vacio.
    expect(r.aplicable.activos).toEqual(["tienda"]);
  });

  it("⭑ `single`: con el valor vivo, aplicable entera (control positivo)", () => {
    const r = evaluarVista(
      catalogoCargado(TODOS),
      payload({ activos: ["tienda"], seleccion: { tienda: ["t-1"] } }),
    );
    expect(r.estado).toBe("aplicable_entera");
  });

  it("⭑ `dateRange`: el atajo que ya no se ofrece se pierde; las fechas sueltas nunca", () => {
    const conAtajoMuerto = evaluarVista(
      catalogoCargado(TODOS),
      payload({ activos: ["created"], seleccion: { created: ["90d", "", ""] } }),
    );
    expect(perdidasDe(conAtajoMuerto)).toEqual([
      { clave: "created", motivo: "valores_desaparecidos", cuantos: 1 },
    ]);

    // Sin atajo, la terna son dos fechas: no dependen de ningun catalogo.
    const conFechas = evaluarVista(
      catalogoCargado(TODOS),
      payload({ activos: ["created"], seleccion: { created: ["", "2026-01-01", "2026-01-31"] } }),
    );
    expect(conFechas.estado).toBe("aplicable_entera");
  });

  it("⭑ `boolean` y `text` NO se pierden nunca: no dependen de ningun catalogo", () => {
    const vista = payload({
      termino: "guia 123",
      activos: ["reasignables", "q"],
      seleccion: { reasignables: ["true"], q: ["cualquier cosa, con coma y = igual"] },
    });
    const r = evaluarVista(catalogoCargado(TODOS), vista);

    expect(r.estado).toBe("aplicable_entera");
    if (r.estado !== "aplicable_entera") return;
    expect(r.aplicable.seleccion.reasignables).toEqual(["true"]);
    expect(r.aplicable.seleccion.q).toEqual(["cualquier cosa, con coma y = igual"]);
  });

  it("⭑ una clave que la pantalla YA NO DECLARA es una parte perdida", () => {
    const vista = payload({
      activos: ["zona", "mensajero"],
      seleccion: { zona: ["z-1"], mensajero: ["m-1"] },
    });
    const r = evaluarVista(catalogoCargado(TODOS), vista);

    expect(perdidasDe(r)).toEqual([{ clave: "mensajero", motivo: "filtro_retirado", cuantos: 1 }]);
    if (r.estado !== "incompleta") return;
    // El control retirado no se puede montar: sale de los activos y de la seleccion.
    expect(r.aplicable.activos).toEqual(["zona"]);
    expect(r.aplicable.seleccion.mensajero).toBeUndefined();
    expect(r.aplicable.seleccion.zona).toEqual(["z-1"]);
  });

  it("⭑ un tipo que este modulo no sabe comprobar NO se da por bueno: se nombra", () => {
    const raro = { key: "raro", label: "Control nuevo", kind: "arbol" } as unknown as FilterDef;
    const r = evaluarVista(
      catalogoCargado([...TODOS, raro]),
      payload({ activos: ["raro"], seleccion: { raro: ["x"] } }),
    );
    expect(perdidasDe(r)).toEqual([{ clave: "raro", motivo: "tipo_desconocido", cuantos: 1 }]);
  });
});

describe("453/R25 · lo perdido se nombra con su etiqueta visible, NUNCA con un id crudo", () => {
  it("⭑ ni la etiqueta ni el detalle llevan el identificador del valor perdido", () => {
    const vista = payload({
      activos: ["zona", "tienda"],
      seleccion: { zona: ["z-1", "z-desaparecida"], tienda: ["t-de-la-que-nadie-se-acuerda"] },
    });
    const r = evaluarVista(catalogoCargado(TODOS), vista);
    expect(r.estado).toBe("incompleta");
    if (r.estado !== "incompleta") return;

    // AUTOCOMPROBACION: hay dos partes perdidas, o el barrido de abajo seria verde por vacio.
    expect(r.perdidas).toHaveLength(2);
    const textoVisible = r.perdidas.map((p) => `${p.etiqueta} ${p.detalle}`).join(" | ");
    for (const idCrudo of ["z-desaparecida", "t-de-la-que-nadie-se-acuerda", "z-1"]) {
      expect(textoVisible, `se colo el id ${idCrudo}`).not.toContain(idCrudo);
    }
    // Y si lleva lo que la persona SI reconoce: el nombre del filtro y cuantas opciones faltan.
    expect(textoVisible).toContain("Zona");
    expect(textoVisible).toContain("Tienda");
    for (const p of r.perdidas) expect(p.valoresPerdidos).toBeGreaterThan(0);
  });
});

describe("453/R8 · un documento ilegible no se aplica ni entero ni en parte", () => {
  it("⭑ `filtro: null` da `ilegible`, y da igual el estado del catalogo", () => {
    expect(evaluarVista(catalogoCargado(TODOS), null)).toEqual({ estado: "ilegible" });
    // Que un documento se pueda leer no depende de que las opciones hayan cargado, asi que el
    // veredicto es el mismo con el catalogo caido: ilegible, no «no comprobable».
    expect(evaluarVista(catalogoNoDisponible("lo que sea"), null)).toEqual({ estado: "ilegible" });
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// EL BLOQUE QUE IMPORTA: «EL CATALOGO NO ESTA» NO ES «EL VALOR DESAPARECIO» (R29)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("453/R29 · con el catalogo sin resolver no se clasifica, no se aplica, y se dice", () => {
  const VISTA_NORMAL = payload({
    termino: "san jose",
    activos: ["zona", "tienda"],
    seleccion: { zona: ["z-1"], tienda: ["t-1"] },
  });

  it("⭑ el catalogo declarado NO DISPONIBLE no marca nada incompleto", () => {
    const r = evaluarVista(catalogoNoDisponible(), VISTA_NORMAL);

    expect(r.estado).toBe("no_comprobable");
    // ⚠️ LA MUTACION QUE ESTE CASO MATA: tratar «no disponible» como una lista de filtros vacia.
    // Con eso, esta MISMA vista —que esta perfecta— saldria «incompleta» con dos partes perdidas,
    // y lo mismo TODAS las demas, a la vez, por una lectura que fallo medio segundo antes.
    expect(r.estado).not.toBe("incompleta");
    expect(perdidasDe(r)).toEqual([]);
    if (r.estado !== "no_comprobable") return;
    expect(r.motivo.length).toBeGreaterThan(0);
  });

  it("⭑ y no devuelve NADA aplicable: no hay filtro que poner", () => {
    const r = evaluarVista(catalogoNoDisponible(), VISTA_NORMAL);
    // R29/R30: no se aplica ninguna. Si el veredicto trajera un `aplicable`, alguien lo aplicaria.
    expect("aplicable" in r).toBe(false);
  });

  it("⭑ aunque quien llama diga «cargado», un filtro DESHABILITADO frena la clasificacion", () => {
    // Es el estado real de `/ordenes` cuando el catalogo geografico no cargo: la pagina devuelve
    // `null` y los filtros se montan deshabilitados y sin opciones.
    const apagados = TODOS.map((f) =>
      f.key === "zona" || f.key === "tienda" ? { ...f, disabled: true, options: [] } : f,
    );
    const r = evaluarVista(catalogoCargado(apagados), VISTA_NORMAL);

    expect(r.estado).toBe("no_comprobable");
    expect(perdidasDe(r)).toEqual([]);
  });

  it("⭑ un filtro de catalogo SIN NINGUNA OPCION tampoco se puede comprobar", () => {
    // El catalogo de estados devuelve `[]` cuando su lectura falla. Con 22 filas en produccion, una
    // lista vacia solo puede ser un fallo de lectura: tratarla como «no cargado» es la direccion
    // conservadora — la contraria marcaria incompletas vistas que estan bien.
    const sinOpciones = TODOS.map((f) => (f.key === "zona" ? { ...f, options: [] } : f));
    const r = evaluarVista(catalogoCargado(sinOpciones), VISTA_NORMAL);

    expect(r.estado).toBe("no_comprobable");
  });

  it("⭑ CONTRASTE: con el catalogo cargado, el MISMO valor ausente SI es una parte perdida", () => {
    // Este es el par que demuestra que los dos casos estan separados. Misma vista, mismo valor que
    // no aparece entre las opciones; lo que cambia es si el catalogo se resolvio.
    const vista = payload({ activos: ["zona"], seleccion: { zona: ["z-9"] } });

    const conCatalogo = evaluarVista(catalogoCargado(TODOS), vista);
    const sinCatalogo = evaluarVista(
      catalogoCargado(TODOS.map((f) => (f.key === "zona" ? { ...f, disabled: true } : f))),
      vista,
    );

    expect(conCatalogo.estado).toBe("incompleta");
    expect(sinCatalogo.estado).toBe("no_comprobable");
    // ⚠️ Si alguien colapsa los dos casos, uno de estos dos se pone rojo SIEMPRE: son el mismo
    // dato con dos respuestas distintas, y esa diferencia es el requisito.
    expect(conCatalogo.estado).not.toBe(sinCatalogo.estado);
  });

  it("⭑ un filtro deshabilitado que la vista NO usa no bloquea nada", () => {
    // El freno es proporcionado: solo aplica a los filtros que la vista realmente necesita. Si no,
    // un filtro apagado en un rincon de la pantalla dejaria toda la funcion inservible.
    const apagados = TODOS.map((f) => (f.key === "tienda" ? { ...f, disabled: true, options: [] } : f));
    const r = evaluarVista(
      catalogoCargado(apagados),
      payload({ activos: ["zona"], seleccion: { zona: ["z-1"] } }),
    );
    expect(r.estado).toBe("aplicable_entera");
  });
});

describe("453/R27 · lo aplicable sale recortado, y la vista guardada no se toca", () => {
  it("⭑ `aplicable` trae SOLO lo que se puede reponer, y el original queda intacto", () => {
    const vista = payload({
      termino: "san jose",
      activos: ["zona", "mensajero"],
      seleccion: { zona: ["z-1", "z-9"], mensajero: ["m-1"] },
    });
    const copia = structuredClone(vista);
    const r = evaluarVista(catalogoCargado(TODOS), vista);

    expect(r.estado).toBe("incompleta");
    if (r.estado !== "incompleta") return;
    expect(r.aplicable).toEqual({
      v: VISTA_FILTRO_VERSION,
      termino: "san jose",
      activos: ["zona"],
      seleccion: { zona: ["z-1"] },
    });
    // R16 — evaluar no escribe NADA, ni siquiera en memoria sobre lo que le pasaron.
    expect(vista).toEqual(copia);
  });
});
