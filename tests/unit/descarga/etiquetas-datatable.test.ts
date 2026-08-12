// Feature 207 — el test PROPIO del lector de `<DataTable>` del censo. No existía.
//
// Que no existiera es justo lo que dejó pasar el defecto: `etiquetasDataTable` escaneaba el
// fuente CRUDO, así que una mención de la etiqueta en prosa contaba como una tabla del
// archivo, y nada chillaba porque nadie miraba a la función — solo al censo, que solo se
// mueve cuando el árbol cambia. Mordió dos veces (features 200 y 205) y la segunda estuvo a
// punto de meter en el registro una tabla que no existe.
//
// Este archivo fija LAS DOS CARAS, porque arreglar solo una es cambiar de falso positivo a
// falso negativo:
//   - una mención en comentario (de línea, de bloque o de JSX) NO cuenta;
//   - un `<DataTable` real SÍ cuenta, con genéricos y con `descarga` incluidos.
//
// Los fixtures son fuentes SINTÉTICOS a propósito: un test que leyera archivos del árbol se
// pondría verde o rojo según lo que otra feature escriba mañana, y lo que hay que fijar es
// el comportamiento del parser, no el censo de hoy (de eso ya se ocupa
// `cobertura-tablas.guardia.test.ts`).
import { describe, it, expect } from "vitest";

import { etiquetasDataTable } from "./etiquetas-datatable";

/** Una tabla real, con la forma que tienen las del árbol. */
const TABLA_REAL = `
      <DataTable
        columns={columnas}
        data={filas}
        rowKey="id"
        emptyMessage="No hay órdenes."
      />
`;

describe("etiquetasDataTable — se escanea el código, no la prosa", () => {
  describe("una mención en comentario NO es una tabla", () => {
    it("comentario de línea", () => {
      const fuente = `
        // Esta pantalla no monta <DataTable columns={x} data={y} />: pinta una lista de li.
        export function Previsualizacion() {
          return <ul>{filas.map((f) => <li key={f.id}>{f.nombre}</li>)}</ul>;
        }
      `;
      expect(etiquetasDataTable(fuente)).toEqual([]);
    });

    it("comentario de bloque (y su forma de docstring)", () => {
      const fuente = `
        /* Antes esto era <DataTable columns={x} />, ahora es una lista. */
        /**
         * Ojo: no confundir con <DataTable descarga={{ titulo: "X" }} /> del módulo de al lado.
         */
        export const Previsualizacion = () => <ul />;
      `;
      expect(etiquetasDataTable(fuente)).toEqual([]);
    });

    it("comentario de JSX", () => {
      const fuente = `
        export function Vista() {
          return (
            <section>
              {/* pendiente: cambiar esta lista por <DataTable columns={cols} data={rows} /> */}
              <ul />
            </section>
          );
        }
      `;
      expect(etiquetasDataTable(fuente)).toEqual([]);
    });

    it("el caso REAL de la feature 205, con los ángulos que el archivo hoy se ahorra", () => {
      // `RepartoPrevisualizacion.tsx` no importa el componente ni monta ninguna tabla —pinta
      // `li`— y la guardia lo denunció igual por su cabecera. Hoy ese archivo nombra las
      // etiquetas SIN los ángulos, con una nota que lo explica; esa mitigación se deja donde
      // está y aquí se reconstruye la frase original, que es la que tiene que dar cero.
      const fuente = `
        // **No es una tabla, y no por gusto** (design §8): esto no ordena, no pagina y no se
        // descarga; además <DataTable> y la <table> cruda de HTML están censados por
        // \`cobertura-tablas.guardia\`, así que meter una tabla de tres filas dentro de un
        // modal movería ese censo por nada.
        export function RepartoPrevisualizacion() {
          return <ul>{lineas.map((l) => <li key={l.id}>{l.texto}</li>)}</ul>;
        }
      `;
      expect(etiquetasDataTable(fuente)).toEqual([]);
    });
  });

  describe("un `<DataTable` real SÍ es una tabla", () => {
    it("la forma corriente", () => {
      const etiquetas = etiquetasDataTable(TABLA_REAL);
      expect(etiquetas).toHaveLength(1);
      expect(etiquetas[0]).toContain("columns={columnas}");
      expect(etiquetas[0]).toContain('rowKey="id"');
    });

    it("con parámetro genérico — `<DataTable<OrdenConError>`", () => {
      // El docstring dice que los maneja; sin esta comprobación, quitarle el salto de
      // ángulos deja el contador en 1 pero devuelve `<OrdenConError` como etiqueta, y con
      // ella se pierde el `descarga=` que el censo lee para decidir el estado de la tabla.
      const fuente = `
        <DataTable<OrdenConError>
          columns={columnasError}
          data={erroneas}
          descarga={{ titulo: "Órdenes con error", columnas: COLS, obtenerFilas: filas }}
        />
      `;
      const etiquetas = etiquetasDataTable(fuente);
      expect(etiquetas).toHaveLength(1);
      expect(etiquetas[0]).toContain("columns={columnasError}");
      expect(etiquetas[0], "el genérico se salta, no se devuelve como etiqueta").toMatch(
        /\bdescarga=/,
      );
    });

    it("dos tablas en un mismo archivo siguen siendo dos", () => {
      // El caso `CierresAdminModule`: dos tablas y solo una declara descarga. Se comprueba
      // también el estado que el censo lee de cada una, porque contarlas bien y leerles mal
      // el `descarga=` da exactamente el mismo total.
      const fuente = `
        <DataTable columns={a} data={x} descarga={{ titulo: "Con archivo" }} />
        <DataTable columns={b} data={y} />
      `;
      const etiquetas = etiquetasDataTable(fuente);
      expect(etiquetas).toHaveLength(2);
      expect(etiquetas.map((e) => /\bdescarga=/.test(e))).toEqual([true, false]);
    });

    it("un `>` dentro de las llaves de un atributo no cierra la etiqueta", () => {
      const fuente = `
        <DataTable
          columns={cols}
          rowClassName={(fila) => (fila.pendientes > 0 ? "urgente" : "")}
          descarga={{ titulo: "T", obtenerFilas: () => filas }}
        />
      `;
      const etiquetas = etiquetasDataTable(fuente);
      expect(etiquetas).toHaveLength(1);
      expect(etiquetas[0]).toMatch(/\bdescarga=/);
    });
  });

  describe("archivo MIXTO: cuenta la real y solo la real", () => {
    it("prosa antes y después de una tabla de verdad", () => {
      // La real va EN MEDIO de los dos comentarios a propósito: así, un quitador de
      // comentarios ávido (bloque no perezoso) se comería la tabla junto con la prosa y este
      // test lo vería.
      const fuente = `
        /* Histórico: esta vista nació como <DataTable columns={viejas} />. */
        export function Modulo() {
          return (
            <section>
              ${TABLA_REAL}
              {/* la segunda <DataTable /> se añade en la tanda 3 */}
            </section>
          );
        }
        // TODO(207): unificar con <DataTable descarga={{}} /> del módulo hermano.
      `;
      const etiquetas = etiquetasDataTable(fuente);
      expect(etiquetas, "la prosa suma tablas fantasma").toHaveLength(1);
      expect(etiquetas[0]).toContain("columns={columnas}");
      expect(etiquetas[0], "ninguna de las menciones en prosa declara descarga").not.toMatch(
        /\bdescarga=/,
      );
    });

    it("un comentario DENTRO de una etiqueta real: la etiqueta cuenta, el comentario no", () => {
      // El mismo defecto por el otro lado, y éste es un falso NEGATIVO: leyendo el fuente
      // crudo, un `descarga=` comentado entre los atributos hacía pasar la tabla por
      // «con_descarga» sin que el usuario pudiera descargar nada.
      const fuente = `
        <DataTable
          columns={cols}
          /* pendiente T5.2: descarga={{ titulo: "Ranking" }} */
          data={filas} // el módulo ya trae la página entera
        />
      `;
      const etiquetas = etiquetasDataTable(fuente);
      expect(etiquetas).toHaveLength(1);
      expect(etiquetas[0]).toContain("columns={cols}");
      expect(etiquetas[0], "un `descarga=` comentado no es una descarga").not.toMatch(
        /\bdescarga=/,
      );
    });

    it("una frase en español entre los atributos no descarrila el parser", () => {
      // Un apóstrofo abría una cadena y un `>` cerraba la etiqueta antes de tiempo: el
      // parser seguía leyendo hasta vaya a saber dónde y podía tragarse la tabla siguiente.
      const fuente = `
        <DataTable
          columns={cols}
          // la bodega d'origen manda: si pendientes > 0 la fila va en rojo
          data={filas}
        />
        <DataTable columns={otras} data={mas} />
      `;
      expect(etiquetasDataTable(fuente)).toHaveLength(2);
    });
  });
});
