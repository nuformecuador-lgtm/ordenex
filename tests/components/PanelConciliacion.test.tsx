// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

import { PanelConciliacion } from "@/app/(app)/analitica/_components/financiero/PanelConciliacion";
import { formatearValor } from "@/components/private/analytics/formato";
import { getMetrica } from "@/lib/analytics/metrics";
import type { ResultadoFinancieroConciliacion } from "@/lib/types/analitica-financiera";

// Feature 132 (T4.3) — R19.
//
// El panel de conciliacion es el unico que puede descubrir que el dinero
// declarado en los cierres no coincide con el libro. Las dos pruebas de abajo
// cubren los dos unicos desenlaces que importan: cuando cuadra no hay alarma que
// distraiga, y cuando NO cuadra la alarma es visible, dice CUANTOS cierres estan
// descuadrados y —esto es lo que se rompe con mas facilidad— el resto del panel
// se sigue viendo. Un panel que se apagara al detectar el descuadre escondera
// justo la tabla con la que se investiga.
//
// Se afirma sobre texto y nombres accesibles, nunca sobre nodos pintados.
//
// ---------------------------------------------------------------------------
// EL DOBLE DE ESTE ARCHIVO DECLARABA UNA UNIDAD QUE EL SERVICIO NO PRODUCE.
//
// Hasta el 2026-08-07 la cabecera del DTO falso decia `unidad: "moneda"`. El
// servicio publica `unidad: consulta.metrica.unidad` DEL CATALOGO
// (`AnaliticaFinancieraService.cabecera`), y para `conciliacion_cierres` esa unidad
// es `"conteo"`: la metrica cuenta cierres. Con la unidad inventada, los siete casos
// pasaban en verde mientras produccion pintaba el cuadre redondeado y sin moneda
// (₡1 560,50 -> «1 561»; un descuadre de ₡60,50 -> «61»). Misma familia de fallo que
// el tablero roto del 2026-08-06: el doble fija una premisa falsa y la suite entera
// pasa por encima.
//
// Hoy la unidad del doble sale del CATALOGO, no de una constante escrita aqui, y hay
// un caso que lo ata. Si alguien vuelve a inventarla, se pone rojo.
// ---------------------------------------------------------------------------

const ETIQUETA = "Conciliación de cierres";

/**
 * La unidad que el servicio publica en la cabecera de esta metrica.
 *
 * Se LEE del catalogo en vez de escribirla: es la misma fuente que usa el servicio
 * (`cabecera()` copia `consulta.metrica.unidad`), asi que el doble no puede volver a
 * declarar una unidad que el productor no produce.
 */
const METRICA_CONCILIACION = getMetrica("conciliacion_cierres");
if (METRICA_CONCILIACION === undefined) {
  throw new Error("catalogo sin `conciliacion_cierres`: el doble no puede copiar su unidad");
}
const UNIDAD_DEL_DTO = METRICA_CONCILIACION.unidad;

/**
 * El importe formateado, con los espacios normalizados como los normaliza
 * testing-library.
 *
 * `Intl` separa los miles con un espacio DURO (U+00A0) y el matcher de
 * testing-library colapsa ese espacio a uno normal antes de comparar: sin esta
 * normalizacion el esperado y el DOM difieren en un byte invisible.
 */
function cifra(valor: number, unidad: "moneda" | "conteo"): string {
  return formatearValor(valor, unidad).replace(/\s+/g, " ");
}

function datosDe(cuadra: boolean, cierresDescuadrados: readonly string[]): ResultadoFinancieroConciliacion {
  return {
    tipo: "conciliacion",
    metricaId: "conciliacion_cierres",
    etiqueta: ETIQUETA,
    // NO se escribe "moneda" ni "conteo": se copia lo que publica el productor.
    unidad: UNIDAD_DEL_DTO,
    rango: { desdeFecha: "2026-07-05", hastaFecha: "2026-08-03" },
    esAcumulado: false,
    conciliacion: {
      porEstado: [
        {
          nivel: "cierre_dia",
          estado: "aprobado",
          cantidad: 7,
          totales: {
            efectivo: "1000.00",
            simpe: "250.50",
            transferencia: "0.00",
            general: "1250.50",
          },
          fechadoPor: "resuelto_at",
        },
        {
          nivel: "cierre_bodega",
          estado: "solicitado",
          cantidad: 2,
          totales: {
            efectivo: "300.00",
            simpe: "0.00",
            transferencia: "10.00",
            general: "310.00",
          },
          fechadoPor: "solicitado_at",
        },
      ],
      cuadre: {
        cuadra,
        totalSnapshot: "1560.50",
        totalLedger: "1500.00",
        diferencia: "60.50",
        cierresDescuadrados,
      },
    },
  };
}

afterEach(cleanup);

describe("Feature 132 (R19) — cuadre correcto: conteos y cuadre, sin alarma", () => {
  it("muestra los conteos por nivel y estado POR SEPARADO y las tres cifras del cuadre", () => {
    render(<PanelConciliacion datos={datosDe(true, [])} />);

    const seccion = screen.getByRole("region", { name: ETIQUETA });

    // Los dos niveles viven en filas distintas: fundirlos contaria el mismo
    // dinero dos veces.
    expect(within(seccion).getByText(/cierre_dia · aprobado/)).toBeInTheDocument();
    expect(within(seccion).getByText(/cierre_bodega · solicitado/)).toBeInTheDocument();

    // El conteo se formatea como CONTEO, no como importe.
    expect(within(seccion).getByText(cifra(7, "conteo"))).toBeInTheDocument();

    // Las tres del cuadre, como DINERO. Estas tres lineas pasaban antes por el motivo
    // equivocado —el doble declaraba `unidad: "moneda"`— y siguen escritas igual porque
    // lo que afirman es lo correcto: con la unidad real del DTO se ponen rojas si el
    // panel vuelve a formatear el cuadre con `datos.unidad`.
    expect(within(seccion).getByText(cifra(1560.5, "moneda"))).toBeInTheDocument();
    expect(within(seccion).getByText(cifra(1500, "moneda"))).toBeInTheDocument();
    expect(within(seccion).getAllByText(cifra(60.5, "moneda")).length).toBeGreaterThan(0);
  });

  it("muestra los importes por metodo de CADA fila, no solo sus conteos", () => {
    // R19 pide los conteos por (nivel, estado) CON SUS TOTALES. Sin esto, un panel
    // que perdiera los cuatro importes de cada fila —y dejara solo la cantidad—
    // seguiria en verde: el cuadre de abajo sale de otra parte del DTO.
    render(<PanelConciliacion datos={datosDe(true, [])} />);

    const seccion = screen.getByRole("region", { name: ETIQUETA });

    // Fila `cierre_dia · aprobado`: efectivo 1000,00 · SINPE 250,50 · general 1250,50.
    expect(within(seccion).getByText(cifra(1000, "moneda"))).toBeInTheDocument();
    expect(within(seccion).getByText(cifra(250.5, "moneda"))).toBeInTheDocument();
    expect(within(seccion).getByText(cifra(1250.5, "moneda"))).toBeInTheDocument();

    // Fila `cierre_bodega · solicitado`: efectivo 300,00 · transferencia 10,00 ·
    // general 310,00. Las DOS filas quedan cubiertas: perder los importes de una
    // sola tambien tiene que poner esto rojo.
    expect(within(seccion).getByText(cifra(300, "moneda"))).toBeInTheDocument();
    expect(within(seccion).getByText(cifra(10, "moneda"))).toBeInTheDocument();
    expect(within(seccion).getByText(cifra(310, "moneda"))).toBeInTheDocument();
  });

  it("no emite ninguna alerta cuando el cuadre es correcto", () => {
    render(<PanelConciliacion datos={datosDe(true, [])} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("pinta el rango tal cual lo devuelve el DTO (R22)", () => {
    render(<PanelConciliacion datos={datosDe(true, [])} />);
    const seccion = screen.getByRole("region", { name: ETIQUETA });
    expect(within(seccion).getByText(/2026-07-05/)).toBeInTheDocument();
    expect(within(seccion).getByText(/2026-08-03/)).toBeInTheDocument();
  });
});

describe("Feature 132 (R19) — cuadre roto: alerta visible con la cantidad, y el panel sigue en pie", () => {
  const DESCUADRADOS = ["cierre-a", "cierre-b", "cierre-c"];

  it("muestra un aviso con role=alert que incluye CUANTOS cierres estan descuadrados", () => {
    render(<PanelConciliacion datos={datosDe(false, DESCUADRADOS)} />);

    const aviso = screen.getByRole("alert");
    expect(aviso).toBeInTheDocument();
    // La cantidad, no la lista de ids: con la cantidad se prioriza; sin ella el
    // aviso solo dice "algo pasa".
    expect(aviso.textContent ?? "").toContain(String(DESCUADRADOS.length));
  });

  it("el resto de la tabla y el cuadre se renderizan IGUALMENTE (el panel nunca se apaga)", () => {
    render(<PanelConciliacion datos={datosDe(false, DESCUADRADOS)} />);

    const seccion = screen.getByRole("region", { name: ETIQUETA });
    expect(within(seccion).getByText(/cierre_dia · aprobado/)).toBeInTheDocument();
    expect(within(seccion).getByText(/cierre_bodega · solicitado/)).toBeInTheDocument();
    // Y el cuadre sigue siendo DINERO tambien con la alarma puesta: es justo la
    // pantalla en la que alguien va a leer la cifra para ir a buscarla al libro.
    expect(within(seccion).getByText(cifra(1560.5, "moneda"))).toBeInTheDocument();
    expect(within(seccion).getByText(cifra(1500, "moneda"))).toBeInTheDocument();
    expect(within(seccion).getByText(cifra(60.5, "moneda"))).toBeInTheDocument();
  });

  it("no lanza con la lista de descuadrados vacia pero `cuadra` en falso", () => {
    // Caso incomodo y real: el servicio puede declarar que no cuadra sin poder
    // señalar cierres concretos. El panel tiene que decirlo, no reventar.
    expect(() => render(<PanelConciliacion datos={datosDe(false, [])} />)).not.toThrow();
    expect(screen.getByRole("alert").textContent ?? "").toContain(
      cifra(0, "conteo"),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Regresion 2026-08-07 — el cuadre es DINERO, aunque la metrica sea un conteo  */
/* -------------------------------------------------------------------------- */

describe("Regresión: las tres cifras del cuadre no se formatean con la unidad de la cabecera", () => {
  /**
   * Lo que se LEE en pantalla para el cuadre del doble, escrito a mano.
   *
   * Con la configuracion por defecto del repo (`lib/config/moneda.ts`: es-CR / CRC).
   * Si alguien cambia esa configuracion, este caso se pone rojo y hace bien: es la
   * unica afirmacion del archivo sobre el texto exacto que ve un humano.
   */
  const MONEDA = {
    snapshot: "₡1.560,50",
    ledger: "₡1.500,00",
    diferencia: "₡60,50",
  } as const;

  it("la cabecera del DTO real declara `conteo`: la unidad de la métrica NO sirve para el cuadre", () => {
    // La premisa medida del arreglo, escrita como caso para que no vuelva a darse por
    // supuesta: `conciliacion_cierres` CUENTA cierres y su `unidad` lo dice. El panel
    // no puede usar esa unidad para pintar importes, y este archivo tampoco puede
    // fingir otra.
    expect(UNIDAD_DEL_DTO).toBe("conteo");
    expect(datosDe(true, []).unidad).toBe(UNIDAD_DEL_DTO);
  });

  it("pinta el descuadre con sus decimales y su símbolo (₡60,50), NO redondeado a «61»", () => {
    // El defecto que llego a produccion: `formatearValor(importe, datos.unidad)` con
    // `unidad = "conteo"` redondea a entero y quita la moneda. Un descuadre de ₡60,50
    // se anunciaba como «61» en la pantalla de conciliar dinero, y ₡1 560,50 como
    // «1 561».
    //
    // Se afirma el TEXTO que se lee en pantalla —importe con decimales y simbolo— y,
    // ademas, que la forma redondeada NO esta: sin la segunda mitad, un panel que
    // pintara las dos cosas seguiria en verde.
    render(<PanelConciliacion datos={datosDe(false, ["cierre-a"])} />);

    const seccion = screen.getByRole("region", { name: ETIQUETA });

    // Presentes: las tres cifras del cuadre como dinero. Escritas a mano y no derivadas
    // de `formatearValor`, para que el esperado no salga de la misma funcion que se
    // esta comprobando. Desde la feature 201 el separador de miles es un PUNTO: antes
    // `Intl` agrupaba con espacio duro (U+00A0) y los importes largos se leian mal.
    expect(within(seccion).getByText(MONEDA.snapshot)).toBeInTheDocument();
    expect(within(seccion).getByText(MONEDA.ledger)).toBeInTheDocument();
    expect(within(seccion).getByText(MONEDA.diferencia)).toBeInTheDocument();

    // Ausentes: las mismas cifras redondeadas y sin moneda. Ninguna de las tres es un
    // valor de la tabla, asi que si aparecen es porque salieron del cuadre.
    expect(within(seccion).queryAllByText(cifra(1560.5, "conteo"))).toHaveLength(0);
    expect(within(seccion).queryAllByText(cifra(1500, "conteo"))).toHaveLength(0);
    expect(within(seccion).queryAllByText(cifra(60.5, "conteo"))).toHaveLength(0);
  });
});
