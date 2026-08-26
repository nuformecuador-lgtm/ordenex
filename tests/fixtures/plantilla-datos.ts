// Fixture compartido de `DatosPlantilla` (lib/types/plantilla-datos.ts): la orden y el
// mensajero completos que alimentan las variables de una plantilla de WhatsApp.
//
// Vive aqui y no dentro de cada suite porque el tipo tiene 25 + 11 campos: repetirlo a mano
// convierte cualquier campo nuevo del catalogo en N ediciones de tests. Los `overrides` son
// POR BLOQUE (orden / mensajero / negocio) para poder cambiar un solo dato sin reescribir el
// resto.
import type { DatosPlantilla } from "@/lib/types/plantilla-datos";

export function datosPlantillaFixture(overrides?: {
  orden?: Partial<DatosPlantilla["orden"]>;
  mensajero?: Partial<DatosPlantilla["mensajero"]>;
  negocio?: Partial<DatosPlantilla["negocio"]>;
}): DatosPlantilla {
  return {
    orden: {
      id: "orden-1",
      numGuia: 25381189,
      numRemision: "REM-0002",
      estatusValue: "en_reparto",
      destinatario: "Juan Perez",
      telefonoDest: "573112195060",
      direccion: "Calle 1",
      producto: "Camiseta talla M",
      peso: 1.5,
      notas: null,
      montoCobrar: 25900,
      cobraComision: true,
      prioridad: false,
      intentosContacto: 0,
      fechaReparto: null,
      asignadoAt: null,
      createdAt: null,
      latitud: null,
      longitud: null,
      downloadUrl: null,
      tiendaNombre: "Boutique Luna",
      zonaNombre: "GAM Norte",
      provinciaNombre: "San Jose",
      cantonNombre: "San Jose",
      distritoNombre: "Carmen",
      ...overrides?.orden,
    },
    mensajero: {
      id: "men-1",
      nombre: "Jose",
      primerApellido: "Castillo",
      segundoApellido: null,
      email: "jose@ejemplo.com",
      telefono: "87776655",
      cedula: "1-1234-5678",
      placa: "SJB-123",
      vehiculoNombre: "Motocicleta",
      zonaNombre: "GAM Norte",
      estado: "activo",
      ...overrides?.mensajero,
    },
    negocio: {
      sinpeNumero: "",
      sinpeNombre: "",
      urlBase: "https://ordenex.co",
      ...overrides?.negocio,
    },
  };
}
