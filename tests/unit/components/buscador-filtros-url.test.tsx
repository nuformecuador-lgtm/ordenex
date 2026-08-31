// @vitest-environment jsdom
import { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// Feature 339 / T3.1-T3.3, T5.2 — `BuscadorFiltros` leyendo su estado inicial de la URL.
//
// El mock de `next/navigation` copia el patron ya escrito del repo
// (`tests/components/CierresAdminDeepLink.test.tsx:64-75`): un `let` reasignable con la
// query de cada caso, mas un espia sobre `replace`.

const replaceMock = vi.fn();
const pushMock = vi.fn();

/** La URL de la prueba. `let` porque cada caso entra por una direccion distinta. */
let parametros = new URLSearchParams();
let ruta = "/ordenes";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock, refresh: vi.fn() }),
  usePathname: () => ruta,
  useSearchParams: () => parametros,
}));

import { olvidarParamsBorrados } from "@/hooks/useFiltrosUrl";
import {
  BuscadorFiltros,
  type BuscadorFiltrosProps,
  type FiltroDisponible,
} from "@/components/shared/BuscadorFiltros";

const FILTROS: FiltroDisponible[] = [
  { key: "mensajero_id", label: "Mensajero" },
  { key: "zona_id", label: "Zona" },
];

beforeEach(() => {
  replaceMock.mockClear();
  pushMock.mockClear();
  parametros = new URLSearchParams();
  ruta = "/ordenes";
  // El hook recuerda a nivel de MODULO lo que «Limpiar todo» acaba de borrar (ruta +
  // nombre + valor) para que un remonte no lo resucite. Esa memoria sobrevive de un caso
  // al siguiente dentro del archivo; en el navegador cada carga estrena modulo.
  olvidarParamsBorrados();
});

afterEach(() => {
  cleanup();
});

type PropsBarra = Omit<BuscadorFiltrosProps, "activos">;

/**
 * La barra con su consumidor minimo: las claves activas las POSEE el consumidor, asi que
 * sin alguien que las guarde no se puede comprobar ni que se monten al entrar ni que
 * marcar una opcion del selector no escriba la URL.
 */
function BarraConConsumidor(props: PropsBarra) {
  const [activos, setActivos] = useState<string[]>([]);
  return (
    <BuscadorFiltros
      {...props}
      activos={activos}
      onActivosChange={(claves) => {
        setActivos(claves);
        props.onActivosChange?.(claves);
      }}
      hayFiltrosAplicados={activos.length > 0}
    />
  );
}

function campo(): HTMLInputElement {
  return screen.getByRole("searchbox", { name: "Buscar" }) as HTMLInputElement;
}

describe("BuscadorFiltros — el termino libre se precarga de la URL (R1, R6, R7, R23)", () => {
  it("R1 — con `?q=guia123` el campo aparece ya escrito", () => {
    parametros = new URLSearchParams("q=guia123");
    render(<BarraConConsumidor onChange={vi.fn()} filtros={FILTROS} />);

    expect(campo().value).toBe("guia123");
  });

  it("R1/R6 — sin params el campo aparece vacio", () => {
    render(<BarraConConsumidor onChange={vi.fn()} filtros={FILTROS} />);

    expect(campo().value).toBe("");
  });

  it("R23 — con `leerDeUrl={false}` el `?q=` se ignora y «Limpiar todo» no toca la URL", () => {
    parametros = new URLSearchParams("q=ignorado");
    render(
      <BarraConConsumidor
        onChange={vi.fn()}
        filtros={FILTROS}
        leerDeUrl={false}
        onLimpiarTodo={vi.fn()}
      />,
    );

    expect(campo().value).toBe("");
    // Hace falta algo escrito para que «Limpiar todo» se ofrezca; el punto del caso es
    // que, aun pulsandolo, la URL no se toca.
    fireEvent.change(campo(), { target: { value: "algo" } });
    fireEvent.click(screen.getByRole("button", { name: "Limpiar todo" }));
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("R1 — `terminoKey` renombra el param del termino", () => {
    parametros = new URLSearchParams("busqueda=por-otra-clave");
    render(
      <BarraConConsumidor onChange={vi.fn()} filtros={FILTROS} terminoKey="busqueda" />,
    );

    expect(campo().value).toBe("por-otra-clave");
  });

  it("R7 — cambiar los params DESPUES del montaje no cambia el campo", () => {
    parametros = new URLSearchParams("q=original");
    const { rerender } = render(
      <BarraConConsumidor onChange={vi.fn()} filtros={FILTROS} />,
    );
    expect(campo().value).toBe("original");

    parametros = new URLSearchParams("q=llegado-despues");
    rerender(<BarraConConsumidor onChange={vi.fn()} filtros={FILTROS} />);

    expect(campo().value).toBe("original");
  });
});

describe("BuscadorFiltros — emision inicial de lo precargado (R2, R5, R6)", () => {
  it("R2 — con `?mensajero_id=A` ofrecido, `onActivosChange` recibe [\"mensajero_id\"] exactamente una vez", () => {
    parametros = new URLSearchParams("mensajero_id=A");
    const onActivosChange = vi.fn();
    const { rerender } = render(
      <BarraConConsumidor
        onChange={vi.fn()}
        filtros={FILTROS}
        onActivosChange={onActivosChange}
      />,
    );

    expect(onActivosChange).toHaveBeenCalledTimes(1);
    expect(onActivosChange).toHaveBeenCalledWith(["mensajero_id"]);

    // Y nunca mas, pase lo que pase con los params o con la lista ofrecida (R7).
    parametros = new URLSearchParams("zona_id=Z");
    rerender(
      <BarraConConsumidor
        onChange={vi.fn()}
        filtros={[...FILTROS, { key: "tienda", label: "Tienda" }]}
        onActivosChange={onActivosChange}
      />,
    );
    expect(onActivosChange).toHaveBeenCalledTimes(1);
  });

  it("R2 — el orden de las claves activadas es el de la lista OFRECIDA, no el de la URL", () => {
    // La URL las trae al reves que el catalogo: si alguien usara el orden de la URL,
    // este caso caeria.
    parametros = new URLSearchParams("zona_id=Z&mensajero_id=A");
    const onActivosChange = vi.fn();
    render(
      <BarraConConsumidor
        onChange={vi.fn()}
        filtros={FILTROS}
        onActivosChange={onActivosChange}
      />,
    );

    expect(onActivosChange).toHaveBeenCalledWith(["mensajero_id", "zona_id"]);
  });

  it("R2 — una clave que la URL trae pero el selector NO ofrece no activa nada", () => {
    parametros = new URLSearchParams("desconocido=X");
    const onActivosChange = vi.fn();
    render(
      <BarraConConsumidor
        onChange={vi.fn()}
        filtros={FILTROS}
        onActivosChange={onActivosChange}
      />,
    );

    expect(onActivosChange).not.toHaveBeenCalled();
  });

  it("R5 — con `?q=abc` el consumidor recibe `abc` por `onChange` exactamente una vez", () => {
    parametros = new URLSearchParams("q=abc");
    const onChange = vi.fn();
    const { rerender } = render(
      <BarraConConsumidor onChange={onChange} filtros={FILTROS} />,
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("abc");

    rerender(<BarraConConsumidor onChange={onChange} filtros={FILTROS} />);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("R6 — sin params NO se llama ni a `onChange` ni a `onActivosChange` al montar", () => {
    const onChange = vi.fn();
    const onActivosChange = vi.fn();
    render(
      <BarraConConsumidor
        onChange={onChange}
        filtros={FILTROS}
        onActivosChange={onActivosChange}
      />,
    );

    expect(onChange).not.toHaveBeenCalled();
    expect(onActivosChange).not.toHaveBeenCalled();
  });
});

describe("BuscadorFiltros — la URL solo se toca en «Limpiar todo» (R18-R22)", () => {
  it("R18 — teclear, abrir el selector, marcar dos filtros y retirar uno: CERO escrituras de URL", () => {
    render(
      <BarraConConsumidor
        onChange={vi.fn()}
        filtros={FILTROS}
        onLimpiarTodo={vi.fn()}
      />,
    );

    fireEvent.change(campo(), { target: { value: "guia" } });

    fireEvent.click(screen.getByRole("button", { name: /filtros/i }));
    const opcion = (nombre: string) =>
      within(screen.getByRole("listbox")).getByRole("option", { name: nombre });
    fireEvent.click(opcion("Mensajero"));
    fireEvent.click(opcion("Zona"));
    // Retirar uno: se vuelve a pulsar la opcion ya marcada.
    fireEvent.click(opcion("Zona"));

    expect(replaceMock).toHaveBeenCalledTimes(0);
    expect(pushMock).toHaveBeenCalledTimes(0);
  });

  it("R19/R20/R22 — «Limpiar todo» borra `q` y las claves ofrecidas, conserva `cierre` y va con { scroll: false }", () => {
    ruta = "/cierres-admin";
    parametros = new URLSearchParams("cierre=abc&q=x&mensajero_id=A");
    render(
      <BarraConConsumidor
        onChange={vi.fn()}
        filtros={FILTROS}
        onLimpiarTodo={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Limpiar todo" }));

    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).toHaveBeenCalledWith("/cierres-admin?cierre=abc", {
      scroll: false,
    });
  });

  it("R21 — cuando no queda ningun param, la ruta va sin `?`", () => {
    parametros = new URLSearchParams("q=solo-esto");
    render(
      <BarraConConsumidor
        onChange={vi.fn()}
        filtros={FILTROS}
        onLimpiarTodo={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Limpiar todo" }));

    expect(replaceMock).toHaveBeenCalledWith("/ordenes", { scroll: false });
  });

  it("R19 — «Limpiar todo» sigue vaciando el campo y avisando al consumidor", () => {
    parametros = new URLSearchParams("q=vaciame");
    const onChange = vi.fn();
    const onLimpiarTodo = vi.fn();
    render(
      <BarraConConsumidor
        onChange={onChange}
        filtros={FILTROS}
        debounceMs={0}
        onLimpiarTodo={onLimpiarTodo}
      />,
    );
    expect(onChange).toHaveBeenCalledWith("vaciame");

    fireEvent.click(screen.getByRole("button", { name: "Limpiar todo" }));

    expect(campo().value).toBe("");
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(onLimpiarTodo).toHaveBeenCalledTimes(1);
  });
});

describe("BuscadorFiltros — «Limpiar todo» sobre una barra que su consumidor REMONTA", () => {
  it("R19 — tras limpiar, la barra remontada con los params viejos NO resucita el termino ni el filtro", () => {
    // Reproduce `NovedadesFiltrosBarra` (`key={filtro.reset}`) + `useNovedadesFiltro.limpiar()`:
    // el consumidor remonta la barra en el MISMO manejador, antes de que el `replace` haya
    // actualizado `useSearchParams`.
    ruta = "/novedades";
    parametros = new URLSearchParams("q=guia-remonte&zona_id=Z9");
    const onActivosChange = vi.fn();

    const { rerender } = render(
      <BarraConConsumidor
        key="antes"
        onChange={vi.fn()}
        filtros={FILTROS}
        onActivosChange={onActivosChange}
        onLimpiarTodo={vi.fn()}
      />,
    );
    expect(campo().value).toBe("guia-remonte");
    expect(onActivosChange).toHaveBeenCalledWith(["zona_id"]);
    onActivosChange.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Limpiar todo" }));

    // El remonte llega con los params TODAVIA viejos.
    rerender(
      <BarraConConsumidor
        key="despues"
        onChange={vi.fn()}
        filtros={FILTROS}
        onActivosChange={onActivosChange}
        onLimpiarTodo={vi.fn()}
      />,
    );

    expect(campo().value).toBe("");
    expect(onActivosChange).not.toHaveBeenCalled();
  });
});

describe("BuscadorFiltros — vaciar el campo retira `q` de la URL (R26)", () => {
  /**
   * El gesto es SIEMPRE el mismo desde el punto de vista del contrato: el termino EMITIDO
   * pasa a `""`. Da igual si se llega por la X del campo, borrando a mano o seleccionando
   * todo y suprimiendo —los tres desembocan en el mismo `change` del input—, por eso los
   * casos usan indistintamente uno u otro.
   *
   * `debounceMs={0}` donde interesa mirar la navegacion en el acto; el caso de la rafaga
   * usa el debounce REAL, que es justo lo que se quiere probar ahi.
   */
  function pulsarX() {
    fireEvent.click(screen.getByRole("button", { name: "Limpiar Buscar" }));
  }

  it("R26 — entrando con `?q=algo`, vaciar el campo con la X deja la URL SIN `q`", () => {
    parametros = new URLSearchParams("q=algo");
    render(
      <BarraConConsumidor onChange={vi.fn()} filtros={FILTROS} debounceMs={0} />,
    );
    expect(campo().value).toBe("algo");

    pulsarX();

    expect(campo().value).toBe("");
    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).toHaveBeenCalledWith("/ordenes", { scroll: false });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("R26 — se va SOLO `q`: los params de los filtros y los AJENOS siguen ahi", () => {
    ruta = "/cierres-admin";
    // `cierre` es ajeno a la barra; `mensajero_id` es de un filtro OFRECIDO, y aun asi no
    // se toca: vaciar el buscador no es «Limpiar todo».
    parametros = new URLSearchParams("cierre=abc&q=x&mensajero_id=A");
    render(
      <BarraConConsumidor onChange={vi.fn()} filtros={FILTROS} debounceMs={0} />,
    );

    fireEvent.change(campo(), { target: { value: "" } });

    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).toHaveBeenCalledWith("/cierres-admin?cierre=abc&mensajero_id=A", {
      scroll: false,
    });
  });

  it("R26 — vaciar el campo cuando la URL NO trae `q` no navega en absoluto", () => {
    // Entra sin params —el caso normal en las ocho pantallas que montan la barra—, teclea
    // y borra. La query resultante seria identica a la actual, asi que un `replace` aqui
    // seria un refetch RSC donde antes no habia navegacion.
    render(
      <BarraConConsumidor onChange={vi.fn()} filtros={FILTROS} debounceMs={0} />,
    );

    fireEvent.change(campo(), { target: { value: "hola" } });
    fireEvent.change(campo(), { target: { value: "" } });

    expect(replaceMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("R26 — vaciar cuando el termino emitido YA era `\"\"` no emite ni navega", () => {
    // Con `minChars`, teclear por debajo del minimo deja el termino emitido en `""` aunque
    // el campo tenga texto. Borrarlo despues NO es un cambio del termino, y esa es la unica
    // forma real de llegar aqui: un `change` de `""` a `""` React ni lo entrega.
    parametros = new URLSearchParams("zona_id=Z");
    const onChange = vi.fn();
    render(
      <BarraConConsumidor
        onChange={onChange}
        filtros={FILTROS}
        minChars={3}
        debounceMs={0}
      />,
    );

    fireEvent.change(campo(), { target: { value: "ab" } });
    fireEvent.change(campo(), { target: { value: "" } });

    // Las dos afirmaciones miden guardas DISTINTAS y por eso van juntas: `onChange` mide la
    // de "sin cambio" de la barra (el termino emitido no se ha movido de `""`) y
    // `replaceMock` la del hook (la query resultante seria identica). Si un dia se quita
    // cualquiera de las dos, la otra sigue tapando el sintoma, asi que hay que exigir ambas.
    expect(onChange).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("R26 — teclear y borrar rapido produce UNA navegacion, no una rafaga", () => {
    vi.useFakeTimers();
    try {
      parametros = new URLSearchParams("q=abc");
      render(<BarraConConsumidor onChange={vi.fn()} filtros={FILTROS} />);

      // Cuatro cambios dentro de la misma ventana de debounce, dos de ellos a vacio.
      fireEvent.change(campo(), { target: { value: "abcd" } });
      fireEvent.change(campo(), { target: { value: "" } });
      fireEvent.change(campo(), { target: { value: "z" } });
      fireEvent.change(campo(), { target: { value: "" } });

      // Antes de que venza el debounce no se ha tocado nada: la escritura cuelga de la
      // EMISION, no del `onChange` crudo del input.
      expect(replaceMock).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);

      expect(replaceMock).toHaveBeenCalledTimes(1);
      expect(replaceMock).toHaveBeenCalledWith("/ordenes", { scroll: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("R18/R26 — escribir un termino NUEVO despues de vaciar no vuelve a poblar la URL", () => {
    // Asimetria deliberada y documentada en el componente: la barra RESTA de la query,
    // nunca la escribe. Si algun dia se decide lo contrario, este caso cae y obliga a
    // revisar el contrato en vez de dejarlo pasar como un cambio menor.
    parametros = new URLSearchParams("q=algo");
    render(
      <BarraConConsumidor onChange={vi.fn()} filtros={FILTROS} debounceMs={0} />,
    );

    fireEvent.change(campo(), { target: { value: "" } });
    expect(replaceMock).toHaveBeenCalledTimes(1);

    fireEvent.change(campo(), { target: { value: "termino-nuevo" } });

    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("R19/R26 — «Limpiar todo» con el campo lleno sigue siendo UNA sola navegacion", () => {
    // Los dos caminos de escritura se cruzan aqui: `limpiarTodo` borra sus params y
    // ademas vacia el campo, lo que dispara el borrado de R26. Sin el orden y la guarda
    // correctos, esto navegaria dos veces (una sin `q`, otra sin los filtros).
    parametros = new URLSearchParams("cierre=abc&q=x&mensajero_id=A");
    render(
      <BarraConConsumidor
        onChange={vi.fn()}
        filtros={FILTROS}
        debounceMs={0}
        onLimpiarTodo={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Limpiar todo" }));

    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(replaceMock).toHaveBeenCalledWith("/ordenes?cierre=abc", { scroll: false });
  });
});
