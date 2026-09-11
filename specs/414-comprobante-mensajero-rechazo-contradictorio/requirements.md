# 414 — El comprobante del mensajero deja de atribuirle gestiones que no hizo

## Contexto (medido en el código, 2026-09-10)

En el comprobante detallado de un cierre pasado del mensajero (`/cierre-dia` → «Ver» → modal), la
fila desplegada de un rechazo del cron de plazos vencidos muestra HOY las dos cosas a la vez:

```
Motivo: Dirección errada · lo rechazó el sistema al vencerse el plazo de la devolución
Ingreso de bodega por rechazos: 1.500
[Manual]   title/aria-label: «Rechazo registrado manualmente por el mensajero.»
```

Lo mismo lo midió con una sonda el reviewer de la 408 (`progress/review_408.md`, hallazgo M2). Yo lo
confirmé archivo por archivo, sin fiarme del grafo:

| Pieza | Archivo y línea | Qué hay |
| --- | --- | --- |
| El distintivo de origen | `app/(app)/cierres-admin/_components/cierre-factura.tsx:1548-1566` | dentro de `FilaGestion`, en el fragmento `g.resultado === "rechazada"`. Pinta badge **siempre**: `Automático` si `g.esRechazoSla`, **`Manual` en la rama `else`** |
| El texto del motivo | mismo archivo, `:1534-1537` | `motivoGestionLegible(g.motivo, g.esRechazoSla)` (ficha 408) |
| Rótulos y notas del origen | `cierre-labels.ts:117-118`, `cierre-detalle-shared.tsx:327-330` | `"Automático"` / `"Manual"` y sus dos notas |
| La raíz | `lib/repositories/CierreDiaRepository.ts:295` | `esRechazoSla: false` **literal**, por decisión expresa de la 102/R11. Es su única aparición en todo `lib/` |
| La marca «La tienda» | `CierreDiaModule.tsx:1079-1107` | `"La tienda"` + su nota, pintada desde `g.desdeAyudaTienda` en la columna `numGuia`, **común a todas las secciones** |
| Quién monta la vista | `CierreDiaModule.tsx:957-979` | `<CierreFacturaDetalle audiencia="mensajero" …>`, el MISMO componente del admin |

**El distintivo miente por DOS caminos, no uno.** Para la audiencia `mensajero` el servidor no puede
producir `esRechazoSla: true`, así que el badge cae **siempre** en la rama «Manual»:

1. sobre un rechazo del **cron**, al que rotula «lo registró el mensajero»;
2. sobre un rechazo de la **tienda** (237/240), al que rotula lo mismo — porque `desdeAyudaTienda`
   **no se pinta en `cierre-factura.tsx`** (grep sin un solo resultado en ese archivo).

Los dos se arreglan con el mismo criterio, y son las dos mitades de esta ficha: **fuera lo que no
puede afirmar nada cierto, dentro lo que sí.**

**Que la marca «La tienda» falte ahí no es un olvido simétrico al otro**: `desdeAyudaTienda` se
deriva **a propósito** para la vista del mensajero —al contrario que `esRechazoSla`— y la 237 dejó
escrito el porqué en el propio repositorio (`CierreDiaRepository.ts:296-300`): *es SU cierre el que
tiene que decir que la gestión la hizo la tienda*. El sistema ya decidió que el mensajero debe poder
distinguirlo; el comprobante es la única superficie suya que se lo esconde.

**El criterio que ordena las dos mitades, y sale de la medida:** en el comprobante, **cada audiencia
ve lo mismo que ya ve en su propia tabla**.

| Marca | Tabla del admin | Tabla del mensajero | Comprobante hoy | Comprobante tras esta ficha |
| --- | --- | --- | --- | --- |
| Origen (`Automático`/`Manual`) | **sí** (`COLUMNA_RECHAZO_ORIGEN`) | no (declinada, `CierreDiaModule.tsx:1064-1071`) | en las dos audiencias | admin **sí**, mensajero **no** |
| «La tienda» (`desdeAyudaTienda`) | no (no se pinta en ninguna superficie de admin) | **sí** (`:1097-1105`) | en ninguna | mensajero **sí**, admin **no** |

**Lo que NO se toca:** el texto del motivo. Lo fijó la 408 con el vocabulario aprobado en la 73, se
sostiene solo sin depender de ningún tooltip, y no se reabre.

---

## Requisitos

### R1 — En el comprobante del mensajero no se muestra el distintivo de origen
MIENTRAS el comprobante detallado de un cierre se muestre a la audiencia **mensajero**, el sistema NO
DEBE mostrar en ninguna fila el distintivo de origen del rechazo —ni el rótulo `Manual` ni el rótulo
`Automático`— ni su nota accesible.

**Test:** `tests/components/ComprobanteMensajeroOrigenRechazo.test.tsx` (nuevo). Render de
`CierreFacturaDetalle` con `audiencia="mensajero"` y una gestión `rechazada` con
`motivo: "escalado SLA wrong_address"`; se **despliega la fila** y se afirma que no hay ningún
elemento con el texto `"Manual"` ni `"Automático"`, ni con el nombre accesible
`"Rechazo registrado manualmente por el mensajero."` — los cuatro literales tecleados a mano.
**Control de no-vacuidad obligatorio en el mismo caso:** antes de afirmar la ausencia, el test exige
que la fila esté abierta comprobando que se lee el texto largo del motivo (que sólo existe con
`open === true`, `cierre-factura.tsx:1474`). Sin ese control el caso pasaría en verde con la fila
plegada y sin el arreglo.

### R2 — En el comprobante del admin el distintivo sigue exactamente igual
MIENTRAS el mismo comprobante se muestre a la audiencia **admin**, el sistema DEBE seguir mostrando el
distintivo de origen con sus dos rótulos y sus dos notas accesibles actuales, sin cambiar ni un
carácter.

**Test:** mismo archivo, dos casos emparejados con los de R1 (`audiencia` por defecto): una gestión
con `esRechazoSla: true` muestra `"Automático"` con la nota
`"Rechazo automático por vencerse el plazo de la devolución (no lo hizo el mensajero)."`, y otra con
`esRechazoSla: false` muestra `"Manual"` con `"Rechazo registrado manualmente por el mensajero."`.
Literales a mano. Es la pareja que impide «arreglarlo» borrando el distintivo para todos.

### R3 — Ocultar el distintivo no se lleva por delante a su vecino
SI la fila de una gestión `rechazada` del comprobante del mensajero está desplegada, ENTONCES el
sistema DEBE seguir mostrando el renglón «Ingreso de bodega por rechazos» con su monto y el texto
autosuficiente del motivo, exactamente como hoy.

**Test:** mismo archivo. En el render de R1 se afirma que se lee el rótulo
`"Ingreso de bodega por rechazos"` con su monto, y el motivo completo
`"Dirección errada · lo rechazó el sistema al vencerse el plazo de la devolución"`, tecleado entero.
(Ese renglón es deuda heredada de la 408, **fuera de alcance por decisión del humano**; este requisito
existe para que el arreglo no la resuelva por accidente ni la empeore.)

### R4 — El texto autosuficiente aparece exactamente donde no hay distintivo
El sistema DEBE mostrar, en una fila cuyo motivo sea la plantilla del cron, el texto autosuficiente
del motivo **si y sólo si** esa fila no muestra el distintivo de origen.

**Test:** mismo archivo, tres casos sobre la MISMA gestión `motivo: "escalado SLA wrong_address"`:
1. `audiencia="mensajero"`, `esRechazoSla: false` → texto largo **y** sin distintivo;
2. `audiencia` admin, `esRechazoSla: true` → celda con el literal exacto `"Dirección errada"` **y**
   distintivo `"Automático"`;
3. `audiencia="mensajero"`, `esRechazoSla: true` → texto largo **y** sin distintivo.

⚠️ El caso 3 es un estado que **el servidor no produce hoy** (`CierreDiaRepository.ts:295`), y se
declara como tal en el test: no afirma nada sobre datos de producción, afirma el **contrato del
componente**. Es el único aserto que distingue `!esMensajero && g.esRechazoSla` de `g.esRechazoSla` en
esa línea, y por eso existe (ver `design.md` §5).

### R5 — El mensajero, en su pantalla, ya no lee la contradicción
CUANDO el mensajero abra desde `/cierre-dia` el comprobante de un cierre pasado y despliegue la fila
de un rechazo del cron, el sistema NO DEBE mostrar el distintivo de origen ni la frase que le atribuye
el rechazo.

**Test:** `tests/components/CierreDiaComprobanteMarcasDeOrigen.test.tsx` (nuevo). Monta
`CierreDiaModule` —no el componente suelto—, mockeando `@/lib/actions/cierre-dia` con un
`verCierrePasado` que devuelve la gestión del cron (misma receta de mocks que
`tests/components/CierreDiaMotivoRechazoAutomatico.test.tsx:27-53`), abre el cierre pasado, despliega
la fila y repite las aserciones de R1. Cubre el hueco que R1 no puede cubrir: que la pantalla real
**pase** `audiencia="mensajero"` (lección «el composition root que no inyecta»).

### R6 — Las superficies de administración no cambian
El sistema DEBE conservar sin cambios el distintivo de origen en la columna «Origen» del detalle por
secciones del admin y en la celda «Origen» de sus dos descargas.

**Test:** los que ya existen y deben seguir verdes **sin editarlos**:
`tests/components/CierreMotivoRechazoAutomatico.test.tsx:183-191` («un rechazo del mensajero sigue
marcado «Manual»»), `tests/components/CierresAdminModule.test.tsx:921-977` y
`tests/unit/descarga/cierre-gestiones-descarga-columnas.test.ts`. Criterio de «hecho» complementario:
`git diff` no cambia ni una línea de `renderRechazoOrigen`, `COLUMNA_RECHAZO_ORIGEN` ni de las celdas
`origenRechazo` de las descargas (lo único que este arreglo añade a `cierre-detalle-shared.tsx` son
**dos nombres en el bloque de re-exportación**, ver `design.md` §4).

### R7 — El comprobante del mensajero dice cuándo la gestión la registró la tienda
MIENTRAS el comprobante se muestre a la audiencia **mensajero**, SI una gestión la registró la tienda,
ENTONCES el sistema DEBE mostrar la marca `La tienda` con su nota accesible, **sea cual sea el
resultado** de la gestión.

**Test:** `tests/components/ComprobanteMensajeroOrigenRechazo.test.tsx`. **Dos resultados distintos en
el mismo caso** —una `entregada` y una `rechazada`, ambas con `desdeAyudaTienda: true`— porque la
trampa concreta de este requisito es anidar la marca dentro del fragmento `g.resultado === "rechazada"`
donde vivía el distintivo que se retira: así, una entrega registrada por la tienda se quedaría muda y
nadie lo notaría. Se afirman a mano el rótulo `"La tienda"` y la nota completa
`"Esta gestión la registró la tienda desde «Ayuda solicitada», no vos: el motivo y la foto son suyos. Cuenta en tu cierre igual."`.

### R8 — La ausencia de esa marca también es una afirmación
SI la gestión NO la registró la tienda, ENTONCES el sistema NO DEBE mostrar la marca `La tienda`; y
MIENTRAS el comprobante se muestre a la audiencia **admin**, el sistema NO DEBE mostrarla en ninguna
fila.

**Test:** mismo archivo, emparejado con R7 (mismo criterio que `CierreDiaModule.tsx:1073-1076`: «la
ausencia es una afirmación, y por eso su test va emparejado con el de la presencia»). Un caso con
`desdeAyudaTienda: false` en audiencia mensajero y un caso con `desdeAyudaTienda: true` en audiencia
admin; en los dos, ni el rótulo ni la nota. Los dos con el mismo control de no-vacuidad de R1.

### R9 — La tabla en vivo y el comprobante dicen esa marca con las mismas palabras
El sistema DEBE usar un solo texto para la marca `La tienda`: el rótulo y la nota que muestra el
comprobante DEBEN ser idénticos a los que muestra la tabla en vivo del mensajero.

**Test:** `tests/components/CierreDiaComprobanteMarcasDeOrigen.test.tsx`. En el MISMO montaje de
`CierreDiaModule`: una gestión pendiente con `desdeAyudaTienda: true` en la tabla en vivo y otra en el
comprobante del cierre pasado; el rótulo y la nota, **tecleados a mano una sola vez en el test**, se
afirman en las dos. Es un test de comportamiento: si alguien duplica el literal con una coma de menos,
una de las dos aserciones cae. No vale un `grep` del código fuente ni importar la constante.

---

## Fuera de alcance (declarado, con su motivo)

- **El texto del motivo.** Es correcto y lo fija la 408. No se reabre.
- **Derivar el origen para la vista del mensajero** (`CierreDiaRepository.ts:295`). Es backend, reabre
  la 102/R11 y, además, **rompería la 408**: ver `design.md` §6, alternativa B, con el número medido.
- **El renglón «Ingreso de bodega por rechazos» en el comprobante del mensajero.** Deuda heredada de
  la 408, **fuera por decisión del humano el 2026-09-10**, y no a ciegas: ese ingreso es de la bodega,
  no del mensajero, pero **no está medido si afecta a su liquidación**, y mover una línea de dinero en
  un comprobante sin ese dato es justo lo que aquí no se hace. Queda anotado en `design.md` §8 con la
  pregunta que hay que medir **primero**: *¿ese importe entra en lo que se le paga al mensajero, sí o
  no?* R3 lo protege tal cual está.
- **Rediseñar el distintivo del admin** (rótulos, notas, o el `title` invisible en táctil). Límite ya
  declarado en la 408 §7.
- **Estrenar la marca «La tienda» en las superficies del admin.** Hoy no la tiene en ninguna, y darle
  una marca nueva a otra audiencia es otra decisión, con otra justificación. R8 lo fija.

---

## Preguntas abiertas

**Ninguna.** Las tres que abrió el borrador las cerró el humano el 2026-09-10:

1. **¿El comprobante debe llevar la marca «La tienda»?** → **Sí**, y por eso existen R7, R8 y R9. Es
   la otra mitad del mismo defecto: el distintivo miente por dos caminos y el segundo se arregla
   pintando lo que sí es cierto.
2. **¿Y el renglón del ingreso de bodega?** → **Se queda como está, fuera de esta ficha**, con su
   pregunta concreta anotada para quien la retome (arriba, y `design.md` §8).
3. **El día que se derive el origen para el mensajero, ¿debe verlo?** → **No se decide hoy.** Es una
   regla para un mundo que no existe. Queda anotada en `design.md` §8 como lo que es: una pregunta que
   **hereda quien reabra la 102**, no una pregunta abierta de esta ficha.
