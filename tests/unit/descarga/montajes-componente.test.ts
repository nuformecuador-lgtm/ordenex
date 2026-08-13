// Feature 207 — el test PROPIO del detector de montajes del censo de tablas. No existía.
//
// El detector decide qué pantallas MONTAN una tabla que vive en `components/`, y el censo
// obliga a declararlas una por una. Escaneaba el fuente CRUDO: exigir import Y JSX a la vez
// mitigaba la prosa —hacen falta las dos cosas en el mismo archivo— pero no la cerraba. En el
// árbol de hoy ya hay un caso que cae por ese hueco: aplicando esta misma lógica a
// `components/ui/input.tsx`, `RankingHistoricoModule.tsx` aparece como consumidor porque
// importa `@/components/ui/input` y cita `<input type="date">` en dos comentarios.
//
// Este archivo fija LAS DOS CARAS, porque arreglar solo una cambia un falso positivo por un
// falso negativo:
//   - una mención entre ángulos en un comentario (de línea, de bloque o de JSX) NO es montar;
//   - un montaje real SÍ cuenta, y sigue exigiendo import Y JSX.
//
// Los fixtures son sintéticos a propósito: un test que leyera el árbol se pondría verde o rojo
// según lo que escriba mañana otra feature, y lo que hay que fijar es el detector.
import { describe, it, expect } from "vitest";

import { montaComponente } from "./montajes-componente";

/** La tabla compartida de la liquidación: una de las dos que el censo consulta de verdad. */
const TABLA = "components/shared/liquidacion/PagosRegistradosTabla.tsx";

const IMPORT_REAL = `import { PagosRegistradosTabla } from "@/components/shared/liquidacion/PagosRegistradosTabla";`;

describe("montaComponente — montar no es nombrar", () => {
  describe("una mención en comentario NO es un montaje", () => {
    it("comentario de línea, con el import de verdad puesto", () => {
      // El caso peligroso: el archivo SÍ importa (así que la exigencia de import no salva
      // nada) y solo nombra la etiqueta en prosa.
      const fuente = `
        ${IMPORT_REAL}
        export function Seccion() {
          // La lista de comprobantes se pinta más abajo, no aquí: <PagosRegistradosTabla />
          // se monta desde el diálogo de detalle.
          return <section />;
        }
      `;
      expect(montaComponente(fuente, TABLA)).toBe(false);
    });

    it("comentario de bloque (y su forma de docstring)", () => {
      const fuente = `
        ${IMPORT_REAL}
        /**
         * Ojo: esta pantalla NO monta <PagosRegistradosTabla data={pagos} />; la monta el
         * contenedor de arriba y aquí solo se re-exporta.
         */
        export { PagosRegistradosTabla };
      `;
      expect(montaComponente(fuente, TABLA)).toBe(false);
    });

    it("comentario de JSX", () => {
      const fuente = `
        ${IMPORT_REAL}
        export function Seccion() {
          return (
            <section>
              {/* pendiente T4: aquí va <PagosRegistradosTabla pagos={pagos} /> */}
            </section>
          );
        }
      `;
      expect(montaComponente(fuente, TABLA)).toBe(false);
    });

    it("el caso REAL del árbol: `components/ui/input.tsx` y RankingHistoricoModule", () => {
      // Reconstruido de `app/(app)/ranking/historico/_components/RankingHistoricoModule.tsx`
      // (líneas 34, 53 y 124): importa el `Input` con mayúscula del mismo módulo y cita el
      // `<input type="date">` de HTML en dos comentarios. Con el detector viejo, esa pantalla
      // era «consumidora» de `components/ui/input.tsx` sin montar un solo `<input>`.
      const fuente = `
        import { Input } from "@/components/ui/input";

        /** \`id\` del <input type="date">, compartido con su <Label htmlFor>. */
        const ID_DESDE = "ranking-desde";

        export function RankingHistoricoModule() {
          if (!valor) return; // el <input type="date"> emite "" al vaciarse
          return <Input id={ID_DESDE} type="date" />;
        }
      `;
      expect(montaComponente(fuente, "components/ui/input.tsx")).toBe(false);
    });

    it("y su contracara: el mismo archivo montando un `<input>` de verdad SÍ cuenta", () => {
      // Sin esto, el caso de arriba lo pasaría también un detector que devolviera siempre
      // `false`, que es la otra forma de no vigilar nada.
      const fuente = `
        import { Input } from "@/components/ui/input";
        export function Filtro() {
          return <input type="date" id="desde" />;
        }
      `;
      expect(montaComponente(fuente, "components/ui/input.tsx")).toBe(true);
    });

    it("un import COMENTADO no es un import, aunque el JSX sea real", () => {
      const fuente = `
        // ${IMPORT_REAL}
        import { PagosRegistradosTabla } from "./local";
        export const Seccion = () => <PagosRegistradosTabla pagos={pagos} />;
      `;
      expect(montaComponente(fuente, TABLA)).toBe(false);
    });
  });

  describe("un montaje real SÍ cuenta", () => {
    it("la forma corriente", () => {
      const fuente = `
        ${IMPORT_REAL}
        export function PagoMensajeroSeccion() {
          return <PagosRegistradosTabla pagos={pagos} onAnular={anular} />;
        }
      `;
      expect(montaComponente(fuente, TABLA)).toBe(true);
    });

    it("con prosa que lo cita antes y después", () => {
      // La forma real va EN MEDIO de dos comentarios de bloque a propósito: un quitador ávido
      // (bloque no perezoso) se comería el montaje junto con la prosa y este test lo vería.
      const fuente = `
        /* Histórico: antes esto era <PagosRegistradosTabla legacy /> del módulo viejo. */
        ${IMPORT_REAL}
        export function Seccion() {
          return <PagosRegistradosTabla pagos={pagos} />;
        }
        /* TODO: unificar con <PagosRegistradosTabla /> de tiendas. */
      `;
      expect(montaComponente(fuente, TABLA)).toBe(true);
    });

    it("hacen falta las DOS cosas: JSX real sin import no es un montaje", () => {
      // Es lo que impide que un componente homónimo definido en el propio archivo, o
      // importado de otra ruta, cuente como montaje de la tabla compartida.
      const fuente = `
        import { PagosRegistradosTabla } from "./legacy/PagosRegistradosTabla";
        export const Seccion = () => <PagosRegistradosTabla pagos={pagos} />;
      `;
      expect(montaComponente(fuente, TABLA)).toBe(false);
    });

    it("un componente que EMPIEZA igual no cuenta", () => {
      // `<PagosRegistradosTablaLegacy />` no es `<PagosRegistradosTabla />`. Sin la clase
      // `[\\s/>]` del final, el primero taparía al segundo para siempre.
      const fuente = `
        ${IMPORT_REAL}
        export const Seccion = () => <PagosRegistradosTablaLegacy pagos={pagos} />;
      `;
      expect(montaComponente(fuente, TABLA)).toBe(false);
    });
  });
});
