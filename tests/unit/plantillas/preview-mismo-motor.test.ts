// Feature 282 / R11 — LA VISTA PREVIA SALE DEL MOTOR DE PRODUCCION.
//
// Lo que se vigila aqui no es "que la preview pinte bonito" sino que sea, literalmente, el
// mismo par de llamadas que hace el envio real:
//   renderPlantilla(cuerpo, resolverValoresPlantilla(extraerVariables(cuerpo), datos))
// tal como lo escribe `EnviarPlantillaWhatsappButton` con los datos de la orden. Por eso hay
// DOS asertos y no uno: la igualdad con la expresion de referencia (comportamiento) y el
// espia sobre `resolverValoresPlantilla` (camino). Sin el espia, una preview que
// reimplementara la sustitucion por su cuenta pasaria el primero mientras diverge del envio.
import { beforeEach, describe, expect, it, vi } from "vitest";

// El espia tiene que estar en el MODULO, no en una variable local: `previewConEjemplos`
// resuelve su import de `resolverValoresPlantilla` contra este modulo, y un `vi.spyOn` sobre
// el namespace importado no alcanza ese binding en ESM. `importOriginal` conserva el resto
// del catalogo (el fixture, el indice por clave) intacto.
vi.mock("@/lib/types/plantilla-datos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/types/plantilla-datos")>();
  return { ...actual, resolverValoresPlantilla: vi.fn(actual.resolverValoresPlantilla) };
});

import {
  DATOS_PLANTILLA_EJEMPLO,
  resolverValoresPlantilla,
} from "@/lib/types/plantilla-datos";
import {
  extraerVariables,
  previewConEjemplos,
  renderPlantilla,
} from "@/lib/utils/plantilla-mensaje";
import { OrdenEnvioReader } from "@/lib/repositories/OrdenEnvioReader";
import { datosPlantillaDesdeAsignacion } from "@/lib/utils/whatsapp-envio-valores";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

const CUERPOS: Array<[string, string]> = [
  ["sin variables", "Tu pedido ya va en camino."],
  ["con una variable repetida", "{{cliente}}, tu pedido {{guia}} es tuyo, {{cliente}}."],
  ["con un alias del catalogo", "Guia {{num_guia}} para {{destinatario}}."],
  ["con una clave fuera del catalogo", "Recoge en {{sucursal}} antes de las 5."],
];

describe("R11: la preview es el mismo par de llamadas que el envio", () => {
  beforeEach(() => {
    vi.mocked(resolverValoresPlantilla).mockClear();
  });

  it.each(CUERPOS)("%s: identica a la expresion del envio", (_titulo, cuerpo) => {
    const referencia = renderPlantilla(
      cuerpo,
      resolverValoresPlantilla(extraerVariables(cuerpo), DATOS_PLANTILLA_EJEMPLO),
    );
    expect(previewConEjemplos(cuerpo)).toBe(referencia);
  });

  // EL CONTROL DEL ESPIA: si `previewConEjemplos` dejara de llamar a
  // `resolverValoresPlantilla`, este aserto cae aunque el texto siguiera coincidiendo.
  it("PASA por `resolverValoresPlantilla`, con las claves del cuerpo y el fixture", () => {
    const cuerpo = "Hola {{cliente}}, total {{monto}}";
    previewConEjemplos(cuerpo);
    expect(resolverValoresPlantilla).toHaveBeenCalledTimes(1);
    expect(resolverValoresPlantilla).toHaveBeenCalledWith(
      ["cliente", "monto"],
      DATOS_PLANTILLA_EJEMPLO,
    );
  });

  it("un cuerpo sin variables tambien pasa por el resolutor (con lista vacia)", () => {
    previewConEjemplos("Sin placeholders");
    expect(resolverValoresPlantilla).toHaveBeenCalledWith([], DATOS_PLANTILLA_EJEMPLO);
  });

  // El antiguo R25 de la feature 107 («clave desconocida -> marcador en MAYUSCULAS») queda
  // DEROGADO (design §4.3): al cliente le llega un hueco, y eso es lo que el panel «Asi lo
  // vera el cliente» tiene que ensenar. Quien avisa de la clave rota es R15, no un marcador
  // que el cliente nunca veria.
  it("una clave fuera del catalogo deja el hueco real, no el marcador en MAYUSCULAS", () => {
    expect(previewConEjemplos("Hola {{sucursal}}")).toBe("Hola ");
    expect(previewConEjemplos("Hola {{sucursal}}")).not.toContain("SUCURSAL");
  });

  it("los valores del catalogo se pintan ya formateados, como los veria el cliente", () => {
    expect(previewConEjemplos("Hola {{cliente}}, total {{monto}}")).toBe(
      "Hola María Rodríguez, total ₡12.500",
    );
    // Un alias resuelve igual que su base (R5): no es una clave invalida.
    expect(previewConEjemplos("{{num_guia}}")).toBe("10432");
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 429 / T15 (R16) — EL SERVIDOR Y EL DISPOSITIVO RINDEN EL MISMO TEXTO.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠️ Y LA SEGUNDA NO ES UNA VISTA PREVIA. En modo `wa.me` —`/novedades` y el panel del mensajero
// sin callback de chat— el texto que compone el NAVEGADOR **es el que recibe el cliente**: se abre
// `wa.me/...?text=<texto>` y la persona solo pulsa enviar. Un SINPE mal resuelto ahi llega al
// cliente exactamente igual que si lo mandara el servidor. Por eso los dos caminos se comparan
// CARACTER A CARACTER con el mismo fixture, y no «se revisa que los dos lean la misma columna».
//
// EL CUERPO es la frase REAL de `listo_para_entrega_mensajero`, la unica de las cuatro plantillas
// vivas que usa el campo. `{{mensajero}}` NO entra: ese si diverge entre los dos caminos por una
// razon vieja y declarada (el DTO del listado no lleva nada del mensajero) y esta ficha no lo toca.
//
// ⚠️ NINGUN SINPE DE AQUI ES REAL. El repositorio es publico.

const CUERPO_LISTO_PARA_ENTREGA =
  "Hola {{cliente}}, tu pedido {{guia}} ({{producto}}) sale hoy. Total a pagar: {{total}}. " +
  "En caso de que pague por SINPE será al número {{sinpe}} a nombre de {{sinpe_nombre}}.";

const SINPE_DE_LA_BODEGA = { numero: "80000000", nombre: "Titular de Prueba" };
const SINPE_DE_LA_ORDEN = { numero: "70000001", nombre: "Otro Titular de Prueba" };

/** La fila que `findParaEnvio` proyecta, con la bodega del mensajero distinta a la de la orden. */
const FILA_DE_LA_ORDEN = {
  id: "o-1",
  numGuia: 25381189,
  numRemision: "REM-0002",
  destinatario: "Ana Perez",
  telefonoDest: "50688880000",
  direccion: "Calle 1",
  producto: "Camiseta talla M",
  peso: null,
  notas: null,
  montoCobrar: 25900,
  cobraComision: null,
  prioridad: null,
  intentosContacto: 0,
  fechaReparto: null,
  asignadoAt: null,
  createdAt: null,
  latitud: null,
  longitud: null,
  downloadUrl: null,
  estatus: { value: "en_reparto" },
  tienda: { nombre: "Boutique Luna" },
  zona: {
    nombre: "Zona de la orden",
    sinpeNumero: SINPE_DE_LA_ORDEN.numero,
    sinpeNombre: SINPE_DE_LA_ORDEN.nombre,
  },
  provincia: { nombre: "San Jose" },
  canton: { nombre: "San Jose" },
  distrito: { nombre: "Carmen" },
  mensajeroAsignado: {
    id: "m-1",
    nombre: "Jose",
    primerApellido: "Castillo",
    segundoApellido: null,
    email: "jose@ejemplo.test",
    telefono: "80000001",
    cedula: "1-1234-5678",
    placa: "SJB-123",
    estado: "activo",
    vehiculo: { name: "Motocicleta" },
    zona: {
      nombre: "Zona del mensajero",
      sinpeNumero: SINPE_DE_LA_BODEGA.numero,
      sinpeNombre: SINPE_DE_LA_BODEGA.nombre,
    },
  },
};

/** EL MISMO pedido, tal como lo tiene en la mano la pantalla del mensajero. */
const DTO_DE_LA_MISMA_ORDEN: MiAsignacionDTO = {
  id: "o-1",
  numGuia: 25381189,
  numRemision: "REM-0002",
  estatusValue: "en_reparto",
  destinatario: "Ana Perez",
  telefonoDest: "50688880000",
  direccion: "Calle 1",
  producto: "Camiseta talla M",
  peso: null,
  montoCobrar: 25900,
  latitud: null,
  longitud: null,
  notas: null,
  tiendaNombre: "Boutique Luna",
  zonaNombre: "Zona de la orden",
  provinciaNombre: "San Jose",
  cantonNombre: "San Jose",
  distritoNombre: "Carmen",
  // El SERVIDOR ya resolvio el par con `resolverSinpeBodega`: es el de la bodega DEL MENSAJERO.
  sinpeNumero: SINPE_DE_LA_BODEGA.numero,
  sinpeNombre: SINPE_DE_LA_BODEGA.nombre,
  secuenciaRuta: 1,
};

function renderizar(datos: Parameters<typeof resolverValoresPlantilla>[1]): string {
  return renderPlantilla(
    CUERPO_LISTO_PARA_ENTREGA,
    resolverValoresPlantilla(extraerVariables(CUERPO_LISTO_PARA_ENTREGA), datos),
  );
}

describe("429/R16 — el mismo pedido, el mismo texto por los dos caminos", () => {
  it("⭑ el servidor y el dispositivo producen el MISMO texto, caracter a caracter", async () => {
    const reader = new OrdenEnvioReader({
      orden: { findFirst: vi.fn().mockResolvedValue(FILA_DE_LA_ORDEN) },
    } as unknown as ConstructorParameters<typeof OrdenEnvioReader>[0]);

    const delServidor = await reader.findParaEnvio("o-1", "m-1");
    expect(delServidor).not.toBeNull();
    if (delServidor === null) return;

    const delDispositivo = datosPlantillaDesdeAsignacion(DTO_DE_LA_MISMA_ORDEN);

    const textoServidor = renderizar(delServidor);
    const textoDispositivo = renderizar(delDispositivo);

    expect(textoDispositivo).toBe(textoServidor);
    // Anti-vacuidad: el texto dice algo, y dice el numero de la bodega del MENSAJERO.
    expect(textoServidor).toContain(SINPE_DE_LA_BODEGA.numero);
    expect(textoServidor).toContain(SINPE_DE_LA_BODEGA.nombre);
    // Y NO el de la bodega de la orden, que en este fixture es OTRO a proposito: con los dos
    // iguales, este caso pasaria aunque uno de los dos caminos resolviera por la zona equivocada.
    expect(textoServidor).not.toContain(SINPE_DE_LA_ORDEN.numero);
    expect(SINPE_DE_LA_BODEGA.numero).not.toBe(SINPE_DE_LA_ORDEN.numero);
  });

  it("⭑ ninguno de los dos caminos deja el hueco: `{{sinpe}}` nunca se pinta vacio", () => {
    // Es el fallo que esta ficha persigue, escrito como asercion: «…al número  a nombre de .»
    const texto = renderizar(datosPlantillaDesdeAsignacion(DTO_DE_LA_MISMA_ORDEN));
    expect(texto).not.toContain("al número  a nombre");
    expect(texto).not.toContain("{{sinpe}}");
  });
});
