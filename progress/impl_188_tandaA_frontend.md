# 184 — La parte FRONTEND de la Tanda A (bodega satélite)

> Rama: `feature/184-deuda-170-listados` · Fecha: 2026-08-04 · Rol: FRONTEND_DEV
>
> Alcance entregado: **A.4, A.5 y A.6**. Punto de partida: `progress/impl_184_tandaA_backend.md`
> (las dos Server Actions ya estaban, verdes y con 17 mutaciones). `lib/**`, `db/**` y los tests
> de backend **no se tocan**.
>
> **Veredicto en una línea: el listado 10 ya no relee el listado compuesto ni filtra en el
> navegador, y la selección se poda contra el conjunto del servidor — 14 mutaciones ejecutadas,
> 13 rojas y la 14ª verde a propósito, que es lo que hizo que una línea de defensa inalcanzable
> se retirara en vez de quedarse de adorno.**

---

## 1. Qué se hizo

### A.4 — la descarga sale de su lectura dedicada

`app/(app)/recepcion-satelite/_components/RecepcionSateliteModule.tsx`:

| Antes (T K.3) | Ahora (T A.4) |
| --- | --- |
| `filasDelConjuntoCompleto(conjuntoFiltrado(filtro), …)` | `filasDesdeResultado(listarOrdenesBodegaCompleto({ ...filtro }), …)` |
| `conjuntoFiltrado` releía `listarRecepcionSatelite()` —los cinco grupos de la zona ENTERA, más «Por recibir», `zonaNombre` y `sinZona`— | una lectura dedicada a ESTE listado, que devuelve sólo sus filas |
| y volvía a filtrarlas en el navegador con `filtrarOrdenesSatelite` | el filtro lo aplica la base; la pantalla no toca el resultado |
| tope de 5000 evaluado en el cliente | tope evaluado en el servidor (R6): por encima no viaja ni una fila |

Se borran `conjuntoFiltrado` (`:113-124` del árbol de partida) y el import de
`filtrarOrdenesSatelite`, **y la propia función**: era la segunda declaración del criterio de
filtrado —una en SQL, otra en el navegador, y con dos formas de comparar (igualdad exacta contra
normalizada)—, que es justo lo que R16 prohíbe. Dejarla exportada y sin consumidores habría sido
dejar la duplicación viva esperando a que alguien la reusara. `satelite-ordenes-filtros.ts` se
queda con lo que es de presentación: declarar los filtros, traducir la selección y serializarla.

`listarRecepcionSatelite()` pierde con esto su **segundo** consumidor de producción: queda sólo
`app/(app)/recepcion-satelite/page.tsx:30`. Es lo que desbloquea **Q1 (Q-K6, rama B)**, que sigue
fuera de esta feature.

### A.5 — la poda de la selección

`SateliteOrdenesListado.tsx` recibe un callback nuevo, `comprobarVigencia(ids)`, que el módulo
construye **en el render** cerrando sobre el filtro vigente (mismo patrón que
`obtenerFilasDescarga`) sobre `listarIdsVigentesBodega({ ...filtro, ids })`.

El listado lo invoca en un efecto cuya dependencia es la **identidad de la página recibida** —que
cambia una vez por lectura del servidor: navegar, `mutate()` tras una acción, revalidar— y hace
`seleccionados ∩ (idsPágina ∪ vigentes)`.

Las cinco reglas, y dónde vive cada una:

| Regla | Cómo | Requisito |
| --- | --- | --- |
| con la carga en vuelo no se comprueba nada | `if (cargando) return` | R28 |
| sin marcas FUERA de la página, cero consultas | `if (fuera.length === 0) return` | R23 |
| la selección se lee de una **ref**, no de las deps | `podaRef` | R24 |
| si no retira nada, NO se reemplaza el `Set` | `podado.size === prev.size ? prev : podado` | R24 |
| `null` (no se pudo comprobar) ⇒ no se poda | `if (!vigente \|\| vigentes === null) return` | R22 |

Más la limpieza del efecto (`vigente = false`), que descarta la respuesta de una página que ya no
está a la vista: aplicarla intersecaría contra un `enPagina` viejo.

**Q3, decisión CERRADA del humano: al podar NO se avisa.** No se añadió ningún mensaje: el
contador de «marcadas en otras páginas» simplemente pasa a ser correcto.

### A.6 — el censo, en el MISMO commit que la pantalla

`tests/components/paginacion/paginacion-transversal.test.tsx`: «Órdenes de la bodega satélite»
pasa a `adaptador: "completo"` y sale de `PENDIENTES_184`. **Quedan once.**

---

## 2. Archivos

**Producción (3)**

- `app/(app)/recepcion-satelite/_components/RecepcionSateliteModule.tsx` — la descarga por su
  acción dedicada, el callback `comprobarVigencia`, fuera `conjuntoFiltrado`.
- `app/(app)/recepcion-satelite/_components/SateliteOrdenesListado.tsx` — la prop nueva y el
  efecto de la poda.
- `app/(app)/recepcion-satelite/_components/satelite-ordenes-filtros.ts` — retirada de
  `filtrarOrdenesSatelite` (y del import de `normalizeName`, que sólo ella usaba).

**Tests (7)**

- `tests/components/descarga/SateliteDescarga.test.tsx` — +3 casos (4 → 7) y los tres dobles del
  dominio, incluido el del listado compuesto, que existe para poder afirmar que **ya no se llama**.
- `tests/components/paginacion/SateliteSeleccionOtrasPaginas.test.tsx` — +6 casos (3 → 9); el
  doble del servidor pasa a tener estado mutable (`vivas`) y el de la vigencia responde **contra
  ese mismo conjunto**.
- `tests/components/paginacion/SatelitePaginacion.test.tsx` — +3 casos (8 → 11) y el conjunto de
  la descarga pasa a la acción nueva.
- `tests/components/paginacion/paginacion-transversal.test.tsx` — A.6 (dos líneas).
- `RecepcionSateliteModule.test.tsx`, `RecepcionSateliteIncidente.test.tsx`,
  `ManifiestoFlujos.test.tsx`, `deshacer-asignacion.ui.test.tsx` — declaran las dos acciones
  nuevas en su doble. **Obligado**: el módulo las importa y sin el export el archivo revienta al
  cargarlo. Ninguno de los cuatro las invoca (su listado cabe en una página y no descargan).

**Cero** cambios en `lib/**`, `db/**`, `feature_list.json` ni en la configuración de `useSWR` de
ninguna pantalla (**R33**: el objeto de opciones de `useSWR` del módulo está intacto en el diff).

---

## 3. Las 14 mutaciones, con su salida

Cada una: se rompe el código de verdad, se corre, se restaura con `git checkout -- .` y se
comprueba `git status` limpio (el guion lo imprime al final de cada una; salió vacío las 14
veces).

### Lote A.4 — la descarga (4)

```
=== M1 (A.4/R3) la descarga pide el conjunto SIN los filtros vigentes
     × respeta los filtros de estado, cantón y distrito aplicados 395ms
     × descargar con filtros aplicados pide el conjunto con ESOS filtros (R3) 592ms
     × la descarga sigue entregando el dataset completo con los filtros vigentes (R52) 983ms
      Tests  3 failed | 15 passed (18)
AssertionError: expected {} to deeply equal { …(2) }
AssertionError: expected [ { numGuia: 1001, …(12) }, …(59) ] to have a length of 30 but got 60

=== M2 (A.4/R2) la pantalla vuelve a filtrar en el navegador lo que devolvio el servidor
     × la pantalla NO vuelve a filtrar ni a ordenar lo que devolvió el servidor (R2) 287ms
      Tests  1 failed | 6 passed (7)
AssertionError: expected [ 'REM-003' ] to deeply equal [ 'REM-003', 'REM-001' ]

=== M3 (A.4/R1) el archivo vuelve a salir del listado COMPUESTO (el estado previo a la tanda A)
     × ninguno de los TRECE proyecta el array de la página: el archivo va al servidor 9ms
     × el archivo sale de la lectura DEDICADA al listado, no del listado compuesto ni de otra página (R1) 209ms
     × descargar con filtros aplicados pide el conjunto con ESOS filtros (R3) 556ms
     × la pantalla NO vuelve a filtrar ni a ordenar lo que devolvió el servidor (R2) 297ms
     × un fallo de la lectura no produce archivo y el mensaje no lleva datos personales (R7) 1110ms
      Tests  5 failed | 11 passed (16)
AssertionError: Órdenes de la bodega satélite: su descarga no va al servidor por el conjunto (R52):
              expected '"use client";…' to match /filasDesdeResultado\(/

=== M4 (A.6/R30) el censo declara el listado 10 como pendiente aunque su pantalla ya migro
     × ninguno de los TRECE proyecta el array de la página: el archivo va al servidor 12ms
      Tests  1 failed | 8 passed (9)
AssertionError: expected [ …(11) ] to deeply equal [ …(12) ]
```

**M3 es la mutación que mide la tanda entera**: revierte la pantalla al estado del 2026-08-03 y
pone rojos a la vez el caso de conducta (la descarga vuelve al listado compuesto) y el **censo**
(la pantalla declara `completo` pero llama al otro adaptador). Es exactamente el par que T0.2
añadió para que una pantalla migrada a medias no pudiera pasar verde.

**M4 es su espejo**: mover la lista del censo sin mover la pantalla también es rojo. Las dos
mitades están medidas, así que el censo no puede quedar mintiendo en ningún sentido.

### Lote A.5 — la poda (9 rojas)

```
=== M5 (A.5/R18) la poda no retira nada: se comprueba la vigencia y se ignora la respuesta
     × una orden marcada que SALE del listado deja de estar marcada tras la relectura (R18/R25) 1518ms
     × el aviso desaparece cuando ya no queda ninguna marcada fuera (R25) 1495ms
     × podar no cambia la página visible, ni los filtros, ni los contadores (R26) 2164ms
      Tests  3 failed | 17 passed (20)
AssertionError: expected 'Tienes 2 orden(es) marcadas en otras …' to be 'Tienes 1 orden(es) marcadas en otras …'

=== M6 (A.5/R20) la poda interseca solo con la pagina visible: desmarca todo lo de otras paginas
     × avisa al cambiar de página, con el número de las que quedan fuera 506ms
     × cuenta las de FUERA de la página visible, no el total marcado 500ms
     × una orden marcada que SALE del listado deja de estar marcada tras la relectura (R18/R25) 386ms
     × el aviso desaparece cuando ya no queda ninguna marcada fuera (R25) 419ms
     × cambiar de página no desmarca nada, y cuesta exactamente UNA comprobación (R20/R24) 415ms
     × si la comprobación falla, la selección queda INTACTA (R22) 1541ms
     × cambiar los filtros sigue limpiando la selección ENTERA (R27) 347ms
     × podar no cambia la página visible, ni los filtros, ni los contadores (R26) 2155ms
      Tests  8 failed | 12 passed (20)

=== M7 (A.5/R22) un fallo de la comprobacion se lee como «ninguna sigue vigente»
     × si la comprobación falla, la selección queda INTACTA (R22) 467ms
      Tests  1 failed | 8 passed (9)
AssertionError: expected null to be 'Tienes 2 orden(es) marcadas en otras …'

=== M8 (A.5/R23) se comprueba la vigencia aunque no haya marcas fuera de la pagina
     × cambiar de página no desmarca nada, y cuesta exactamente UNA comprobación (R20/R24) 543ms
      Tests  1 failed | 19 passed (20)
AssertionError: expected "vi.fn()" to be called 1 times, but got 2 times

=== M9 (A.5/R24) el efecto observa la seleccion ademas de la pagina: podar encadena otra comprobacion
     × una orden marcada que SALE del listado deja de estar marcada tras la relectura (R18/R25) 560ms
      Tests  1 failed | 19 passed (20)
AssertionError: expected 3 to be 2

=== M10 (A.5/R19) la vigencia se pregunta SIN los filtros vigentes
     × la comprobación de vigencia viaja con los filtros vigentes (R19) 1002ms
      Tests  1 failed | 19 passed (20)
AssertionError: expected { ids: [ 'o-1' ] } to deeply equal { …(2) }

=== M11 (A.5/R26) tras podar, el listado avisa al modulo del filtro y este vuelve a la pagina 1
     × [los 8 casos de la selección] + × podar no cambia la página visible… (R26)
     × la comprobación de vigencia viaja con los filtros vigentes (R19)
     × ni la carga inicial ni la descarga consultan la vigencia (R28)
      Tests  10 failed | 10 passed (20)
AssertionError: expected 'REM-01' to be 'REM-26'

=== M12 (A.5/R28) el guard de carga desaparece: cada navegacion cuesta DOS comprobaciones
     × cambiar de página no desmarca nada, y cuesta exactamente UNA comprobación (R20/R24) 1379ms
     × la comprobación de vigencia viaja con los filtros vigentes (R19) 1880ms
     × ni la carga inicial ni la descarga consultan la vigencia (R28) 1953ms
      Tests  3 failed | 17 passed (20)
AssertionError: expected "vi.fn()" to be called 1 times, but got 2 times

=== M13 (A.5/R27) cambiar los filtros deja de limpiar la seleccion
     × cambiar los filtros sigue limpiando la selección ENTERA (R27) 516ms
      Tests  1 failed | 8 passed (9)
Error: expect(element).not.toBeChecked()
```

**M6 es la que separa esta feature de «desmarcar lo que no se ve»**, que es la implementación
equivocada más plausible y la que R20 existe para impedir: pone rojos ocho casos, incluidos los
tres del aviso que ya existían antes de esta tanda.

**M9 mide la regla que no se ve**: un efecto que además observe la selección funciona —poda
igual— pero cada poda encadena otra comprobación. El único caso que lo caza es el que cuenta las
llamadas (`3` en vez de `2`), y por eso ese `expect` está ahí y no es decorado.

### M14 — la que NO mató a nadie, y qué se hizo con ella

```
=== M14 (A.5) la pagina «vacia» vuelve a ser un literal: identidad nueva en cada render
      Test Files  2 passed (2)
           Tests  20 passed (20)
=== exit: 0
```

Se había introducido `const SIN_FILAS: RecepcionSateliteDTO[] = []` para que `ordenes={… ?? []}`
no produjera una identidad nueva en cada render y disparara comprobaciones que nadie pidió.
**Medido: no protege de nada.** La rama del `??` sólo se toma cuando `data` es `undefined`, que
es *exactamente* cuando `cargando` es `true`, y con la carga en vuelo el efecto sale por el
primer `return`. Era una defensa inalcanzable, con un comentario que afirmaba algo falso.

Se **retiró** (commit propio) en vez de dejarla como adorno. El guard que de verdad sostiene
R24/R28 es el de `cargando`, y ése sí está medido: **M12** lo quita y pone rojos tres casos.

---

## 4. Cómo se midió la poda, y por qué el doble no es una lista escrita a mano

El caso que mide la feature **no** es «marco y cambio de página» —eso ya funcionaba antes de la
tanda A—: es **«marco, la orden deja de estar en el listado, y el contador ya no la cuenta»**.

Para poder montarlo, el doble del servidor en `SateliteSeleccionOtrasPaginas.test.tsx` tiene
**estado**: `vivas` es el conjunto que el servidor tiene *ahora mismo*, `saleDelListado("o-1")`
es lo que le pasa a una orden a la que le reportan un incidente, y **el doble de la vigencia
responde contra ese mismo conjunto** —igual que el servidor, que reusa el `WHERE` del listado más
un `IN` de ids—. Si la respuesta se escribiera a mano, el test estaría midiendo el guion y no la
poda.

La relectura del caso R18 **no es una navegación**: se dispara con «Aceptar todas» de la sección
«Por recibir», una acción de OTRA sección que termina —como todas las de esta pantalla— releyendo
del servidor. Así la página, los filtros y la selección no se tocan, y lo único que cambia es que
el servidor ya no tiene la orden. Y la señal que discrimina «se retiró de la selección» de «sigue
marcada pero no se cuenta» es volver a la página 1: sin poda el aviso allí diría 1; con poda no
hay aviso.

### El flake de jsdom (los tres mecanismos)

- **Anclas positivas, siempre.** Las esperas de la poda son a que el aviso **diga el número
  nuevo** (`waitFor(() => expect(avisoTexto()).toBe(aviso(1)))`), nunca a que el viejo desaparezca:
  «no hay aviso» se cumple también *antes* de que la relectura empiece.
- **Nada anclado a trabajo pesado real.** Los archivos de descarga siguen aislando `exceljs`
  (`buildXlsxRows`) y `descargarBlob`, y anclan a la entrega del blob
  (`waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1))`). El caso del fallo (R7),
  que por definición no produce archivo, ancla al **toast** —una presencia, no una ausencia—, y
  por eso el doble de `useToast` pasó a ser inspeccionable.
- **Ancla que el estado transitorio no cumple.** Donde se cuenta filas se exige además que no
  quede carga en vuelo (`queryByRole("status")`), que es la lección del mecanismo (3): con el
  `DataTable` cargando, `getAllByRole("row")` puede dar el mismo número que ya asentado.
- **Verificado bajo carga**, no en aislado: ver §5.

---

## 5. Puertas (medición real)

```
$ pnpm run typecheck
> tsc --noEmit
=== exit: 0

$ pnpm exec eslint "app/(app)/recepcion-satelite" tests/components/paginacion tests/components/descarga
(sin salida: 0 errores, 0 warnings en lo tocado)

$ pnpm exec vitest run tests/components/descarga/SateliteDescarga.test.tsx
 Test Files  1 passed (1) · Tests  7 passed (7)

$ pnpm exec vitest run tests/components/paginacion/SateliteSeleccionOtrasPaginas.test.tsx
 Test Files  1 passed (1) · Tests  9 passed (9)

$ pnpm exec vitest run tests/components/paginacion/SatelitePaginacion.test.tsx
 Test Files  1 passed (1) · Tests  11 passed (11)

$ pnpm exec vitest related --run <los tres .tsx de producción tocados>
 Test Files  9 passed (9) · Tests  149 passed (149)

$ pnpm exec vitest run tests/components/paginacion tests/components/descarga \
    tests/components/RecepcionSatelite{Module,Incidente}.test.tsx tests/components/ManifiestoFlujos.test.tsx \
    tests/unit/components/deshacer-asignacion.ui.test.tsx tests/unit/descarga \
    tests/unit/config/paginacion-dominios.test.ts tests/unit/actions/satelite-catalogos.test.ts
 Test Files  35 passed (35) · Tests  332 passed (332)

$ pnpm exec vitest run guard
 Test Files  61 passed (61) · Tests  830 passed (830)

$ pnpm exec vitest run tests/components          # BAJO CARGA, no en aislado
 (ver §5.1)
```

**Rojos propios: cero.** La suite completa NO se corre aquí: el gate (`./init.sh`) lo corre el
LEADER.

### 5.1 Bajo carga

Los casos nuevos dependen del reloj de `waitFor` (**1.000 ms**, que es el que vence en esta
familia de fallos — no el `testTimeout` de 20 s), así que medirlos en aislado no prueba nada. Y
una pasada verde tampoco cierra un flake (`chore_flake_jsdom.md §10`), así que van **dos**:

```
$ pnpm exec vitest run tests/components        # pasada 1
 Test Files  158 passed (158)
      Tests  1902 passed (1902)
   Duration  244.36s

$ pnpm exec vitest run tests/components        # pasada 2
 Test Files  158 passed (158)
      Tests  1902 passed (1902)
   Duration  274.71s
```

**2/2 en verde, 1902 tests cada una**, con los tres archivos nuevos compitiendo con los otros 155
por los mismos workers. No hubo ningún rojo intermitente que reejecutar en aislado.

---

## 6. Mapa `R<n>` → archivo + nombre del caso

Construido **leyendo el caso**, no contando `R\d+` en títulos. Sólo se listan los requisitos que
esta entrega toca; los del servidor están en `progress/impl_184_tandaA_backend.md §5`.

| R | Archivo | Caso | Estado |
| --- | --- | --- | --- |
| R1 | `tests/components/descarga/SateliteDescarga.test.tsx` + `paginacion-transversal.test.tsx` | «el archivo sale de la lectura DEDICADA al listado, no del listado compuesto ni de otra página (R1)» (afirma `completoMock` 1 llamada y `compuestoMock` **ninguna**) + «ninguno de los TRECE proyecta el array de la página: el archivo va al servidor» (estático: el módulo declara `completo` y **debe** contener `filasDesdeResultado(`) | ✔ **cierra aquí** |
| R2 | `SateliteDescarga.test.tsx` + el censo | «la pantalla NO vuelve a filtrar ni a ordenar lo que devolvió el servidor (R2)» — el doble devuelve a propósito una fila que el filtro vigente excluye y en un orden que un orden de cliente cambiaría; el archivo trae las dos, en ESE orden. La mitad estática es la negativa de T0.2: el módulo **no puede** contener `filasDelConjuntoCompleto(` | ✔ |
| R3 | `SateliteDescarga.test.tsx` | «descargar con filtros aplicados pide el conjunto con ESOS filtros (R3)» — `toEqual` exacto sobre el argumento, más `not.toHaveProperty("page"/"pageSize")` | ✔ |
| R4 | `SateliteDescarga.test.tsx` | el mismo `toEqual` exacto: la entrada lleva SOLO los tres filtros, ninguna clave de alcance. El guard de rol y la zona son del servicio (backend §5) | ✔ cliente |
| R6 | — | el tope lo evalúa el servidor y lo redacta `filasDesdeResultado`; sus casos viven en `recepcion-satelite-completo.test.ts` y `ControlDescargaTransversal.test.tsx`, verdes sin tocar | ✔ sin cambios |
| R7 | `SateliteDescarga.test.tsx` | «un fallo de la lectura no produce archivo y el mensaje no lleva datos personales (R7)» — el mensaje es accionable y no contiene destinatario, teléfono, remisión ni dirección; no hay blob ni xlsx | ✔ |
| R8 | `SateliteDescarga.test.tsx` + `SatelitePaginacion.test.tsx` | «el archivo sale de la lectura DEDICADA…» afirma `completoMock` **sin llamar** hasta que se pulsa; «ni la carga inicial ni la descarga consultan la vigencia (R28)» cubre la otra lectura nueva | ✔ |
| R11 | `SateliteDescarga.test.tsx` | «descargar con filtros aplicados pide el conjunto con ESOS filtros (R3)» + «la pantalla NO vuelve a filtrar…»: el conjunto llega ya filtrado, así que no viaja al navegador ninguna fila que los filtros excluyan (el caso de base es `recepcion-satelite-completo.test.ts`, R11) | ✔ cliente |
| R12 | `SateliteDescarga.test.tsx` | «ofrece la descarga de las órdenes de la bodega» y «respeta los filtros de estado, cantón y distrito aplicados», **sin cambios**: mismas columnas, mismo orden y mismos valores crudos | ✔ sin cambios |
| R13 | `paginacion-transversal.test.tsx` | el mismo caso del censo: los ONCE que siguen declarados `conjunto` **deben** contener `filasDelConjuntoCompleto(` | ✔ |
| R18 | `SateliteSeleccionOtrasPaginas.test.tsx` | «una orden marcada que SALE del listado deja de estar marcada tras la relectura (R18/R25)» | ✔ **cierra aquí** |
| R19 | `SatelitePaginacion.test.tsx` | «la comprobación de vigencia viaja con los filtros vigentes (R19)» — `toEqual({ estados: […], ids: […] })`. La decisión sobre el conjunto (y no sobre la página) es del servicio (backend §5) | ✔ cliente |
| R20 | `SateliteSeleccionOtrasPaginas.test.tsx` | «cambiar de página no desmarca nada, y cuesta exactamente UNA comprobación (R20/R24)» | ✔ |
| R21 | `SateliteSeleccionOtrasPaginas.test.tsx` | el mismo caso: `toEqual({ ids: [...] })` — la entrada NO lleva zona ni ninguna clave de alcance. El acotamiento real es del `WHERE` (backend §5) | ✔ cliente |
| R22 | `SateliteSeleccionOtrasPaginas.test.tsx` | «si la comprobación falla, la selección queda INTACTA (R22)» — mismo guion que la poda cambiando UNA cosa, y con señal positiva: en la página 1 el aviso sigue contando la orden que ya no existe | ✔ **cierra aquí** |
| R23 | `SateliteSeleccionOtrasPaginas.test.tsx` | «sin marcas fuera de la página visible no se consulta la vigencia (R23/R28)» — cero llamadas al montar, al marcar/desmarcar, al navegar sin selección y tras una relectura | ✔ |
| R24 | `SateliteSeleccionOtrasPaginas.test.tsx` | «cambiar de página no desmarca nada, y cuesta exactamente UNA comprobación (R20/R24)» + el `expect(vigenciaMock.mock.calls.length).toBe(llamadasAntes + 1)` **dentro** del caso R18, que es el que caza el encadenamiento tras una poda que sí retira | ✔ |
| R25 | `SateliteSeleccionOtrasPaginas.test.tsx` | «una orden marcada que SALE del listado…» (el número baja 2 → 1) y «el aviso desaparece cuando ya no queda ninguna marcada fuera (R25)» | ✔ |
| R26 | `SatelitePaginacion.test.tsx` | «podar no cambia la página visible, ni los filtros, ni los contadores (R26)» — página 2 intacta, filtro vigente en la barra y en la última lectura, contadores del servidor (`30 de 60`) y ni una consulta de página más | ✔ |
| R27 | `SateliteSeleccionOtrasPaginas.test.tsx` | «cambiar los filtros sigue limpiando la selección ENTERA (R27)» — y sin consultar la vigencia: la limpieza no depende de que el servidor conteste | ✔ |
| R28 | `SatelitePaginacion.test.tsx` + `SateliteSeleccionOtrasPaginas.test.tsx` | «ni la carga inicial ni la descarga consultan la vigencia (R28)» + «sin marcas fuera… (R23/R28)» | ✔ |
| R29/R30 | `paginacion-transversal.test.tsx` | los dos sentidos del censo, ya existentes, + `PENDIENTES_184` con **once** nombres | ✔ |
| R31/R32 | — | la guardia nueva es **tanda H**, y sólo puede correr cuando A–G estén dentro | fuera de tanda |
| R33 | — | el objeto de opciones de `useSWR` del módulo no se toca: el diff de `RecepcionSateliteModule.tsx` no roza las líneas del `fallbackData` ni añade ninguna opción. Su caso vive en `paginacion-transversal.test.tsx` y sigue verde | ✔ |
| R34 | este archivo | el mapa de arriba | ✔ |

**Lo que NO se puede cubrir aquí, con su motivo:** R5, R9, R10, R14, R15, R16 y R17 son de
repositorio, servicio o borde (`lib/**`, fuera del alcance de FRONTEND_DEV) y ya están cerrados en
la bitácora del backend. R31 y R32 son de la **tanda H**. Y **R6** se apoya en el tope del
servidor y en `ControlDescargaTransversal.test.tsx`, que esta tanda deja intactos a propósito
(R12).

---

## 7. Decisiones y notas para quien siga

- **Un commit por tanda lógica, no uno por tarea.** `tasks.md > Notas de ejecución` pide la
  pantalla y su línea del censo en el MISMO commit; A.4, A.5 y A.6 tocan **la misma pantalla**, y
  partirlos habría dejado un commit intermedio que no compila (el módulo pasando una prop que el
  listado todavía no declara). Van juntos, más un segundo commit para la retirada de `SIN_FILAS`
  (§3, M14) y este archivo.
- **`filtrarOrdenesSatelite` se borra, no se deja muerta.** `tasks.md` sólo pedía quitar el
  import; dejar la función habría dejado la duplicación de criterio (R16) esperando a que alguien
  la reusara. Se verificó que no tenía ningún otro consumidor —ni de producción ni de tests— antes
  de retirarla.
- **La cota de identificadores (Q2, 500) NO se replica en el cliente.** El callback devuelve
  `null` ante cualquier respuesta que no sea `ok`, y `validation_error` por pasarse del tope es una
  de ellas: la selección no se toca (R22). Replicar el número aquí habría creado un segundo tope
  que se desincroniza en cuanto alguien fije `RECEPCION_SATELITE_MAX_IDS_VIGENCIA` por entorno.
- **Q-K6 (Q1, rama B) queda desbloqueada.** Tras A.4, `listarRecepcionSatelite()` tiene **un solo**
  consumidor de producción: `app/(app)/recepcion-satelite/page.tsx:30`. Sigue fuera de esta
  feature.
- **Para las tandas B–G**, el molde de pantalla es ahora éste, y lo que ahorra tiempo es lo de los
  dobles: cada tanda tiene que enumerar los archivos que renderizan su pantalla y **añadir la
  acción nueva al `vi.mock`** antes de tocar nada; sin el export declarado, el archivo revienta al
  importar el módulo y ese rojo es propio.
