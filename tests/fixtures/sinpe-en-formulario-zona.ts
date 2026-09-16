import { screen } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";

/**
 * ⭑ FICHA 429 (R11) — TECLEAR EL SINPE EN EL FORMULARIO DE CREAR UNA ZONA.
 *
 * POR QUE EXISTE ESTE AYUDANTE Y NO UN VALOR POR DEFECTO EN EL FORMULARIO. `crearZonaSchema`
 * exige `sinpeNumero` y `sinpeNombre` desde T11, y el formulario los pide SIN precargarlos: un
 * campo de cobro que ya viene relleno se acepta sin leerlo. La consecuencia es que los fixtures
 * que crean una zona tienen que aportar el dato, que es exactamente lo que la ficha quiere —
 * aflojar el esquema para que los tests sigan pasando devolveria el hueco entero.
 *
 * ⚠️ NINGUN VALOR DE AQUI ES UN SINPE REAL. El repositorio es PUBLICO y `80000000` es el mismo
 * numero ficticio que usan las suites de la ficha (`tests/fixtures/sinpe-casos.ts`).
 *
 * Se busca por ROL y nombre accesible, no por `getByLabelText`: asi la busqueda pasa por el
 * calculo real del nombre accesible —que ignora el asterisco `aria-hidden` de `FormField`— y el
 * ayudante se rompe si algun dia el campo deja de estar etiquetado.
 */
export const SINPE_DE_PRUEBA = {
  numero: "80000000",
  nombre: "Titular de Prueba",
} as const;

export async function tecleaSinpeDeLaZona(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.type(
    screen.getByRole("textbox", { name: "Número SINPE" }),
    SINPE_DE_PRUEBA.numero,
  );
  await user.type(
    screen.getByRole("textbox", { name: "A nombre de" }),
    SINPE_DE_PRUEBA.nombre,
  );
}
