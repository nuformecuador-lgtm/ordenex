// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

// Feature 339 / T5.1 — PRUEBA DE HERENCIA: la capacidad va ligada al COMPONENTE, no a la
// vista (restriccion dura 1 de requirements.md).
//
// POR QUE ESTE ARCHIVO MONTA EL HOOK REAL Y NO UNA MAQUETA
// -------------------------------------------------------
// Su primera version fabricaba a mano el objeto `NovedadesFiltro` que la barra consume, con
// un filtro de zona cuyas `options` YA estaban presentes. Eso ejercita la cascara de
// presentacion y da un verde tranquilizador, pero se salta justo el tramo donde vivia el
// fallo B1 del revisor: en `/novedades` el catalogo NO esta al montar. `useNovedadesFiltro`
// pide el conjunto completo de forma PEREZOSA —desde los manejadores de la barra, nunca
// desde un efecto de montaje— y mientras tanto `construirFiltrosNovedades` declara los
// filtros `multi` con `options: []`. Entrando por `/novedades?zona=…`, el control se montaba
// sin catalogo, el valor de la URL se descartaba por R14 y al llegar el conjunto ya no se
// reintentaba: el enlace compartido no acotaba nada y el control decia «Zona: Todas».
//
// Asi que aqui se monta el hook REAL con el catalogo llegando DESPUES del montaje. El hook
// recibe `listarCompleto` COMO ARGUMENTO, asi que se le inyecta un doble cuya promesa
// resuelve cuando este test quiere: eso permite afirmar el ANTES (control montado, sin
// acotar) y el DESPUES (acotado por la zona que traia la URL) sin adivinar tiempos.
//
// Si este archivo pasa, lo hace porque el consumidor HEREDA la capacidad de los dos
// canonicos compartidos: el diff de la ficha no toca un solo archivo bajo `app/`.

const replaceMock = vi.fn();
const pushMock = vi.fn();

let parametros = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock, refresh: vi.fn() }),
  usePathname: () => "/novedades",
  useSearchParams: () => parametros,
}));

import { NovedadesFiltrosBarra } from "@/app/(app)/novedades/_components/NovedadesFiltrosBarra";
import { useNovedadesFiltro } from "@/app/(app)/novedades/_components/useNovedadesFiltro";
import { olvidarParamsBorrados } from "@/hooks/useFiltrosUrl";
import type { ListarNovedadesCompletoActionResult } from "@/lib/actions/novedades";
import type { NovedadDTO } from "@/lib/types/novedad";

/**
 * Una novedad completa. Copiada del molde que ya usa
 * `tests/components/NovedadesBuscador.test.tsx` para no reinventar el DTO: lo unico que
 * estos casos miran es `zonaNombre` y `destinatario`.
 */
const base: NovedadDTO = {
  id: "o1",
  numGuia: 1001,
  numRemision: "REM-2026-0001",
  estatusValue: "devuelta",
  intentosContacto: 0,
  mensajeroNombre: "Marta Mensajera",
  destinatario: "Ana Cliente",
  telefonoDest: "88887777",
  causa: "not_found",
  producto: "Zapatos deportivos",
  peso: 1.5,
  direccion: "Av. Central 120",
  montoCobrar: 24500,
  latitud: 9.9281,
  longitud: -84.0907,
  notas: null,
  tiendaNombre: "Tienda Demo",
  zonaNombre: "GAM Oeste",
  provinciaNombre: "San José",
  cantonNombre: "Escazú",
  distritoNombre: "San Rafael",
  secuenciaRuta: null,
};

const novedad = (over: Partial<NovedadDTO> = {}): NovedadDTO => ({ ...base, ...over });

/** El conjunto que devuelve el doble: dos zonas, para que el filtro tenga algo que descartar. */
const CONJUNTO: NovedadDTO[] = [
  novedad({ id: "o1", destinatario: "Ana Cliente", zonaNombre: "GAM Oeste" }),
  novedad({ id: "o2", destinatario: "Beto Cliente", zonaNombre: "GAM Este" }),
];

/**
 * Un `listarCompleto` cuya promesa resuelve cuando el test lo diga. Es la pieza que hace
 * observable el hueco: entre el montaje y `entregar()` el catalogo NO existe, que es
 * exactamente el estado en el que `/novedades` recibe al visitante de un enlace compartido.
 */
function listadoDiferido() {
  let resolver: ((res: ListarNovedadesCompletoActionResult) => void) | null = null;
  const promesa = new Promise<ListarNovedadesCompletoActionResult>((resolve) => {
    resolver = resolve;
  });
  const listarCompleto = vi.fn(() => promesa);
  return {
    listarCompleto,
    /** Entrega el catalogo completo. */
    entregar: () => {
      if (resolver === null) throw new Error("la promesa no llego a inicializarse");
      resolver({ status: "ok", items: CONJUNTO, total: CONJUNTO.length });
    },
  };
}

/**
 * La pantalla real reducida a lo que esta ficha promete: el hook REAL de `/novedades`
 * alimentando la barra REAL. No hay nada fabricado a mano en medio.
 */
function PantallaNovedades({
  listarCompleto,
}: {
  listarCompleto: () => Promise<ListarNovedadesCompletoActionResult>;
}) {
  const filtro = useNovedadesFiltro("devolucion", listarCompleto);
  return (
    <>
      <NovedadesFiltrosBarra
        filtro={filtro}
        label="Buscar novedades"
        regionLabel="Filtros de novedades"
      />
      {/* Lo que la barra esta acotando, para poder afirmar el EFECTO y no solo el control. */}
      <ul aria-label="Resultados">
        {filtro.resultados.map((n) => (
          <li key={n.id}>{n.destinatario}</li>
        ))}
      </ul>
    </>
  );
}

beforeEach(() => {
  replaceMock.mockClear();
  pushMock.mockClear();
  parametros = new URLSearchParams();
  olvidarParamsBorrados();
});

afterEach(() => {
  cleanup();
});

/** Los destinatarios que la lista acotada esta pintando ahora mismo. */
function acotados(): string[] {
  const lista = screen.queryByRole("list", { name: "Resultados" });
  if (lista === null) return [];
  return Array.from(lista.querySelectorAll("li")).map((li) => li.textContent ?? "");
}

describe("Herencia de la lectura de URL en el consumidor REAL de /novedades (R1, R2, R3, R5, R6)", () => {
  it("R2/R3/R5 — entrando por `?zona=…` el control queda con esa zona SELECCIONADA cuando llega el catalogo", async () => {
    parametros = new URLSearchParams("zona=GAM Oeste");
    const { listarCompleto, entregar } = listadoDiferido();

    render(<PantallaNovedades listarCompleto={listarCompleto} />);

    // ANTES — R2: la clave se activo desde la URL y el control esta montado sin que nadie lo
    // pidiera en el selector; el catalogo todavia no llego, asi que no puede acotar nada.
    const antes = await screen.findByRole("button", { name: /^Zona:/ });
    expect(antes).toHaveTextContent("Todas");
    expect(listarCompleto).toHaveBeenCalledTimes(1);

    // DESPUES — R3/R5: llega el catalogo y la clave PENDIENTE se termina de sembrar con lo
    // que traia la URL AL ENTRAR. Este es el assert que el revisor midio en rojo.
    entregar();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Zona:/ })).toHaveTextContent("GAM Oeste"),
    );
    await waitFor(() => expect(acotados()).toEqual(["Ana Cliente"]));
  });

  it("R1/R5 — entrando por `?q=…` el campo llega escrito y la lista llega acotada por el termino", async () => {
    parametros = new URLSearchParams("q=Beto");
    const { listarCompleto, entregar } = listadoDiferido();

    render(<PantallaNovedades listarCompleto={listarCompleto} />);

    expect(
      (screen.getByRole("searchbox", { name: "Buscar novedades" }) as HTMLInputElement).value,
    ).toBe("Beto");

    entregar();

    await waitFor(() => expect(acotados()).toEqual(["Beto Cliente"]));
  });

  it("R6 — sin params el consumidor se comporta como siempre: campo vacio, ningun control y ninguna lectura", () => {
    const { listarCompleto } = listadoDiferido();

    render(<PantallaNovedades listarCompleto={listarCompleto} />);

    expect(
      (screen.getByRole("searchbox", { name: "Buscar novedades" }) as HTMLInputElement).value,
    ).toBe("");
    expect(screen.queryByRole("button", { name: /^Zona:/ })).toBeNull();
    // La lectura completa es la cara de esta pantalla: sin params no se dispara.
    expect(listarCompleto).not.toHaveBeenCalled();
  });
});
