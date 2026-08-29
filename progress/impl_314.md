# Implementación — Feature 314 · elegir qué columnas salen en la descarga de órdenes

- **Rama:** `feat/314-columnas-descarga` · commits `9cf2e072` (spec) y `909d7679` (implementación)
- **Fecha:** 2026-08-28
- **Gate:** `./init.sh` **completo**, `INIT_EXIT=0`. 21.640 verdes / 26 skipped. Un archivo rojo, el
  del baseline (`superficie-de-uso` → `obtenerTarifa`, ficha 275). **Delta 0.**

## Las cuatro decisiones del humano

1. Los **siete encabezados** nuevos se aceptan tal cual.
2. Los dos importes salen como **texto**, igual que el resto de descargas de dinero: convertirlos
   reintroduciría en el navegador la aritmética que la 204 quitó, y ahí 14 de 66 órdenes medidas
   salían un céntimo desviadas del cierre.
3. **Una sola preferencia** para toda la pantalla de órdenes, no una por pestaña.
4. Las siete columnas nuevas van **intercaladas por afinidad**, no al final.

Consecuencia aceptada explícitamente: quien nunca abra el selector pasa de **15 a 22 columnas**.

## El nudo: el orden frente a una columna publicada después

**El orden guardado no sustituye al catálogo: lo enmienda.** `ordenEfectivo` recorre el catálogo e
inserta cada clave que no esté en el orden guardado **justo detrás de su predecesora de catálogo
presente**, buscando el ancla también entre lo ya intercalado en la misma pasada. Sin ancla, va al
principio.

Cuatro propiedades caen solas, y ninguna es una rama aparte del código:

- **orden vacío ⇒ catálogo íntegro.** R16 y R30 son el caso general con la lista vacía, no un `if`.
- **la visibilidad la decide SOLO la lista de ocultas**, así que una columna publicada mañana sale
  marcada y en su sitio, sin migrar nada. Es la propiedad de la feature 194 que había que no perder.
- dos columnas nuevas consecutivas conservan su orden relativo.
- el formato guardado **solo crece**: el orden se omite del JSON cuando está vacío, así que
  «Restablecer» vuelve a escribir literalmente la forma vieja y una preferencia nueva leída por
  código viejo sigue valiendo.

## Q5 y Q6, decididas por el implementador

- **Q5 — sí se toca la guardia del contrato del `DataTable`,** y queda **más fuerte, no más laxa**:
  además de censar los miembros, ahora afirma que el nuevo no lleva dominio. La alternativa no
  tocaba la guardia pero permitía declarar un ámbito en una tabla sin descarga, y eso no lo caza
  ningún test.
- **Q6 — los rótulos no nombran la pantalla** («Elegir columnas de la descarga», «Columnas del
  archivo»), de modo que encender la segunda tabla no obligará a renombrarlos. Los del manifiesto
  quedan intactos.

## El hallazgo que el diseño no había previsto

`ExportarVistaFinanciera` (feature 184) mantiene **a propósito una instancia estable** de su array de
columnas y **la reescribe en sitio** desde `obtenerFilas`, porque el juego de columnas depende de la
forma del importe y eso solo se sabe cuando llega el DTO.

Pasarle una copia derivada en un `useMemo` sobre la identidad del array **nunca se recalcula**, y
salía la columna «Neto» **vacía**. Lo cazó un test que ya existía —`AnaliticaFinancieraExport`—, en
rojo durante la implementación.

Arreglado siguiendo el design al pie de la letra: sin ámbito, el control entrega **la misma
instancia**, no una copia. Con un caso propio que lo fija.

⚠️ **Consecuencia declarada:** mutar en sitio el array de columnas es **incompatible** con declarar
un ámbito. Hoy ninguna tabla hace las dos cosas, pero quien quiera ámbito tendrá que dejar de mutar.

## Mutaciones — dos, ambas muertas

| Mutación | Rojos |
| --- | --- |
| el orden guardado es autoritativo y lo nuevo cae al final | **9**, todos en la suite del orden efectivo |
| el archivo emitido ignora el orden elegido | **2**, de extremo a extremo |

La segunda dio **1** en la primera medición: se añadió un caso de extremo a extremo antes de darla
por muerta, porque una sola aserción para una propiedad tan cargante era poco.

Restauración verificada por `diff` contra copias previas **y** por `grep` sobre los blobs ya
commiteados.

## Alcance, comprobado con el diff

Nada de `db/`, `lib/types/`, `lib/services/`, `lib/actions/`, `lib/repositories/`, ni de las otras 24
tablas del `DataTable`. Encender la segunda tabla cuesta **una línea**.

`COLUMNAS_DESCARGA_ORDENES` **no se movió ni se renombró**: hay una guardia que fija su ruta exacta
como canario.

En la lista de claves prohibidas del catálogo se retiran **solo** `telefonoDest`, `notas` y `peso`.
Los identificadores, `deletedAt`, `updatedAt` y `relaciones` **siguen prohibidos**, con el porqué
escrito encima.

## Deuda declarada

- **La regla 7 no se cumplió:** el implementador no usó el MCP del grafo —fue directo a los archivos
  que el spec nombraba con ruta y línea— y **lo declaró por su cuenta**. El resultado no dependía de
  ello, pero queda dicho.
- Dos casos añadidos sobre lo pedido, los dos con motivo: una clave repetida que ya no es subconjunto
  al respetar el orden recibido, y el foco al llegar al extremo, que el design exigía sin test
  asignado.
