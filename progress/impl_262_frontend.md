# Bitácora — feature 262 · BLOQUE FRONTEND (la PANTALLA de la corrección)

> Rama `feature/262-dia-reparto-frontend`, desde `origin/dev` en `c9e0e056` (que **ya tiene el
> backend de esta ficha mergeado**). Worktree aislado, `node_modules` por junction desde el repo
> principal, `prisma generate` antes de cada corrida que importa.
>
> **Alcance de esta tanda:** **F1, F2, F3, F4, F5** + la retirada del `@sin-superficie` de la Server
> Action + **B14** (el cierre del riesgo de la 261, en sus tres soportes).
>
> ⛔ **NO ENTRA EL BLOQUE HISTORIAL (`B24`-`B29` y `F7`/`F8`)**: va en otra tanda, con otro agente,
> porque necesita backend y UI a la vez (`B24` rompe el build a propósito y sólo `F7` lo repara).
> **No se tocó ni un archivo suyo.** R37-R45 siguen sin un solo test.

---

## 1 · Archivos

### Creados

| Archivo | Qué es |
| --- | --- |
| `app/(app)/ordenes/_components/CambiarDiaRepartoModal.tsx` | El modal por lote (**F1**) |
| `app/(app)/ordenes/_components/corregir-dia-reparto-error-messages.ts` | Cotas del motivo + traducción del rechazo POR ORDEN (**F1**, R19/R21) |
| `app/(app)/recepcion-satelite/_components/CambiarDiaRepartoSateliteModal.tsx` | Envoltorio delgado para la bodega satélite (**F2**) |
| `tests/components/CambiarDiaRepartoModal.test.tsx` | 27 tests del modal (**F5**) |
| `tests/components/CambiarDiaRepartoListados.test.tsx` | 12 tests de las DOS superficies (**F5** sobre F3/F4) |

### Modificados

| Archivo | Qué cambió |
| --- | --- |
| `components/shared/SelectorDiaReparto.tsx` | `valor` admite `DIA_REPARTO_SIN_ELEGIR` (`""`); `titulo`/`ayuda` opcionales. **Los defectos no cambian**: la asignación se comporta igual |
| `app/(app)/ordenes/_components/OrdenesListado.tsx` | La acción de lote en `por_recoger`, `en_reparto` y `ayuda_tienda`; el modal montado (**F3**) |
| `app/(app)/recepcion-satelite/_components/SateliteOrdenesListado.tsx` | Botón junto a «Deshacer asignación», `disabled` con estado mixto (**F4**) |
| `app/(app)/recepcion-satelite/_components/RecepcionSateliteModule.tsx` | Estado del modal + cableado + `fechasDiaReparto` (**F4**) |
| `lib/actions/corregir-dia-reparto.ts` | **`@sin-superficie` RETIRADA** y sustituida por la nota de qué la monta |
| `lib/interfaces/services/IMisAsignacionesService.ts` | La nota del riesgo aceptado pasa a ser la de su **cierre** (**B14**, soporte 1) |
| `tests/unit/guards/d5-revertida.guardia.test.ts` | Mitad (e): `PIEZAS_DEL_AGUJERO` → `PIEZAS_DEL_CIERRE` (**B14**, soporte 2) |
| `specs/261-dia-reparto-protege/requirements.md` · `design.md` | Apéndice fechado, **sólo adiciones** (**B14**, soporte 3) |
| `tests/components/SelectorDiaReparto.test.tsx` | 4 casos nuevos del modo corrección; **ninguna aserción vieja cambia** |
| `tests/unit/utils/dia-reparto-textos.test.ts` | Sección (4): los textos que la 262 añadió y que **no tenían ni una aserción** |

---

## 2 · Mapa `R<n> → test`

Sólo las R que esta tanda defiende. Las de backend están en `progress/impl_262_backend.md`.

| R | Test que lo defiende |
| --- | --- |
| **R10** | `CambiarDiaRepartoModal.test` · «la frase va en palabras, con la fecha, sin siglas y sin `YYYY-MM-DD`» + «la frase habla del día ELEGIDO». Las **dos** afirman el literal **escrito a mano** — comparar contra `confirmacionDiaReparto(...)` sería comparar el texto con la función que lo genera |
| **R13** | `CambiarDiaRepartoListados.test` · los tres estados de `/ordenes` + los cuatro casos de la satélite. Ninguna de las dos **puertas de página** se toca: el diff no incluye `app/(app)/ordenes/page.tsx` ni `app/(app)/recepcion-satelite/page.tsx` |
| **R16** | `CambiarDiaRepartoModal.test` · «cada orden se lee con su nº de remisión y su día EN PALABRAS» (dos órdenes con días **distintos**) + la que no tiene día · `dia-reparto-textos.test` §(4) |
| **R17** | `CambiarDiaRepartoModal.test` · censo del fuente de los DOS modales (`new Date(`, `Date.now(`, `toLocale*`, `Intl.DateTimeFormat`) + «los días que muestra son los que RECIBE» con una fecha de 2027 · `dia-reparto-textos.test` §(2), que ya vigilaba el módulo entero |
| **R18** | `CambiarDiaRepartoModal.test` · «saca el texto de la fuente única y no lo copia», con **anti-vacuidad** (los cuatro trozos existen verbatim en el módulo) y autocomprobación. **Es lo único que mata M-x en su forma fuerte** — ver §4 |
| **R19** | `CambiarDiaRepartoModal.test` · seis casos: motivo real por orden, sin invitar a reintentar donde no sirve, **con su contraprueba** (la carrera SÍ invita), todo-o-nada dicho, el modal no se cierra, y ningún UUID a la vista |
| **R21** | `CambiarDiaRepartoModal.test` · sin motivo no se envía; 9 caracteres no, 10 sí; sólo espacios no |
| **R2/R3** | `CambiarDiaRepartoModal.test` · el token VIAJA, cambia con la elección, y lo enviado **no contiene ningún `YYYY-MM-DD`** |
| **R34** | `d5-revertida.guardia` mitad (e), ahora con las **ocho** piezas del cierre |
| **R35** | La mitad (e) **sigue viva**: ni borrada ni relajada a `toBe(true)`. Su autocomprobación tiene un caso nuevo —«el detector NO se conforma con la nota VIEJA»— que es la prueba de que se **actualizó** y no se quedó mirando al vacío |
| **R36** | `git diff origin/dev...HEAD -- specs/261-dia-reparto-protege` = **sólo adiciones, cero borrados** (verificado, §5) |

⏳ **R37-R45** (bloque historial) y **F6** («ver la app») siguen sin cubrir. Ver §6.

---

## 3 · Decisiones tomadas al implementar

1. **`SelectorDiaReparto` gana «sin elegir» en vez de nacer un componente nuevo.** `design.md` §7.2
   dice «el mismo componente `SelectorDiaReparto`», y su `valor` era `DiaReparto` a secas. Se
   ensancha a `DiaReparto | ""` —el mismo convenio que la primitiva `RadioGroup` ya usa para «sin
   selección»— y se le dan `titulo`/`ayuda` opcionales. **Los defectos no cambian**: sin esas props
   se lee exactamente como al asignar, y hay un test que lo afirma. Un componente hermano habría
   duplicado el `radiogroup`, su accesibilidad y su censo de reloj.

2. **⚠️ `/ordenes` OFRECE la corrección con selección mixta, y el spec dice lo contrario. Se
   desvía a propósito y se dice aquí.** `design.md` §4.2 escribe: «si lo seleccionado no es todo
   del mismo estado no se ofrece ninguna acción». Eso **ya no describe a `/ordenes`**: su
   `accionesPara` dejó de ser la INTERSECCIÓN y pasó a la UNIÓN con conteo, con su motivo escrito
   en el código («marcar "seleccionar todo" sobre una página con estados mezclados no ofrecía
   NADA»). Tres razones para seguir el patrón real del listado y no la prosa del spec:
   - Los tres estados elegibles **son compatibles entre sí**: `por_recoger` + `en_reparto` es el
     caso operativo normal (un mensajero con parte del lote ya recogido), y esconder la acción ahí
     obligaría a corregir en dos pasadas.
   - Un estado NO elegible casi nunca se puede mezclar: su casilla está **bloqueada** por no tener
     acciones de lote. Cuando sí se puede (`en_bodega_central`), la unión acota la acción al
     subconjunto y **el botón lo dice**: «Cambiar día de reparto (1)».
   - Hay test de las dos caras: el botón lleva el conteo y **lo que llega al modal es sólo la
     elegible** (se afirma dentro del `role="dialog"`, no en toda la pantalla).

   En la **satélite sí** se aplica el `disabled` por estado mixto, porque ése es el patrón de esa
   barra y **F4 lo pide literalmente**. O sea: cada superficie sigue el suyo.

3. **El rechazo se pinta DENTRO del modal, no en un toast.** R19 exige el motivo **por orden**, y
   un toast sólo cabe uno. Se aprovecha el canal del `Modal` (`throw` en `onConfirm` ⇒ no cierra y
   llama a `onError`), y `onError` decide: `conflict` con detalle ⇒ lista `role="alert"` orden a
   orden; cualquier otra cosa ⇒ toast. `deshacer-asignacion-error-messages` traduce sólo el
   **primero**; aquí no, y por eso el mapper es propio y no una reutilización de aquél.

4. **Las cotas del motivo se declaran, no se importan del módulo de «deshacer».** Son dos bordes
   distintos (`lib/actions/corregir-dia-reparto.ts` vs `lib/actions/deshacer-asignacion.ts`) y
   atarlos haría que relajar uno relajara la pantalla del otro sin que nadie lo viera. Que hoy
   coincidan es una decisión de `design.md` §7.2, no una dependencia. El test afirma la cota con el
   **literal 10**, que es lo que el zod dice.

5. **El `@sin-superficie` se retiró y el episodio se dejó escrito.** No se borró a secas: en su
   lugar queda qué monta la acción y por qué son **dos** superficies. Se comprobó **con la guardia
   en la mano** que la anotación ya no cabía (mutación §4). Ojo al detalle que casi muerde: la
   nota nueva **menciona** `` `@sin-superficie` `` entre backticks, y el detector exige
   `@sin-superficie[ \t]+`, así que un backtick pegado NO cuenta como anotación. Verificado con la
   guardia verde y, del otro lado, con la mutación en rojo.

6. **`fechasDiaReparto` no se pide de nuevo a nadie.** Las dos páginas ya las bajan desde la 246 y
   los dos contenedores ya las transportaban hasta su modal de asignar; ahora las reparten también
   al de corregir. Ni una fecha nueva, ni un `new Date()` en cliente.

---

## 4 · Mutaciones — cada una corrida, con su salida real

Todas contra el árbol **con una corrida limpia en verde justo antes**. La salida pegada es el
nombre real del test que se puso rojo.

| # | Mutación | Resultado |
| --- | --- | --- |
| **M-u** | Preseleccionar «Hoy» en el modal (`useState(DIA_REPARTO_SIN_ELEGIR)` → `useState("hoy")`) | **MUERE (2 rojos)**: «ninguna de las dos opciones está marcada al abrir» y «con motivo válido pero SIN día elegido, el confirmar sigue deshabilitado» |
| **M-v** | Pintar el error genérico en vez del detalle por orden (`detalleDeConflicto(error)` → `null`) | **MUERE (5 rojos)**: los cinco casos del bloque R19, incluidos «SÍ invita a reintentar en el ÚNICO caso en que sirve» y «el rechazo dice que NO se cambió NINGUNA» |
| **M-x** (forma burda) | Devolver el literal al componente (`` `hoy está para el ${fechaRepartoISO}` ``) | **MUERE (4 rojos)**: los tres de R16/R17 **y** el censo de R18 |
| **M-x** (forma FUERTE) | Copiar la función entera dentro del componente, de modo que **pinte exactamente lo mismo** | **MUERE (1 rojo), y sólo el censo de R18**: «saca el texto de la fuente única y no lo copia». ⭑ Es la corrida que importa: demuestra que las aserciones de texto renderizado **no** matan M-x, y que el censo del fuente es lo único que lo hace |
| **(extra)** | Quitar `en_reparto` / `ayuda_tienda` de `accionesDe` (`return [accionCambiarDia]` → `return []`) | **MUERE (3 rojos)**: los dos estados nuevos y «la corrección viaja con el lote» |
| **(extra)** | Quitar el `disabled` por estado mixto del botón satélite | **MUERE (1 rojo)**: «con estado MIXTO el botón se pinta DESHABILITADO» |
| **M-r** (a) | Cambiar «YA EXISTE UNA SUPERFICIE» por «ya se puede corregir» | **MUERE**: `d5-revertida (e)` reporta `+ "la frase que dice que la superficie YA EXISTE"` |
| **M-r** (b) | Borrar el pasado: «la unica salida FUE un `UPDATE` a mano» → «no hizo falta tocar produccion» | **MUERE**: reporta `+ "que la unica salida FUE, EN PASADO, un UPDATE a mano (el hecho no se borra)"`. ⭑ Es la pieza que un «ya que estamos» borraría sin pensarlo |
| **M-r** (c) | Nombrar **una sola** superficie en la nota (quitar `/recepcion-satelite`) | **MUERE**: reporta `+ "DONDE esta la correccion: las DOS superficies, no una"` |
| **(extra)** | Volver a poner `@sin-superficie` sobre la acción ya montada | **MUERE**: `superficie-de-uso.guardia` → «ninguna anotación `@sin-superficie` de acción sobrevive a su motivo», con `lib/actions/corregir-dia-reparto.ts:114 corregirDiaReparto -> app/(app)/ordenes/_components/CambiarDiaRepartoModal.tsx` |

⚠️ **Un tropiezo que conviene saber:** restaurar una mutación con `git checkout -- <archivo>` sobre
un archivo **modificado y no commiteado** lo devuelve a HEAD y **se lleva por delante el trabajo**.
Pasó con `IMisAsignacionesService.ts` (la nota de B14 se perdió y hubo que reescribirla). Para los
archivos **nuevos** ni siquiera hace nada, que es el otro lado del mismo filo. Se pasó a copias de
respaldo antes de mutar.

---

## 5 · Verificaciones puntuales

**R36 — el spec de la 261, sólo adiciones:**

```
$ git diff origin/dev...HEAD --numstat -- specs/261-dia-reparto-protege
19      0       specs/261-dia-reparto-protege/design.md
20      0       specs/261-dia-reparto-protege/requirements.md
```

Cero líneas borradas en los dos archivos. El texto original del *límite declarado 2* y de §7.2
sigue entero: el apéndice se **añade** debajo.

**R13 — las puertas de página no se tocan:** ni `app/(app)/ordenes/page.tsx` ni
`app/(app)/recepcion-satelite/page.tsx` aparecen en el diff.

**C6 (R56) — el vocabulario del día NO cambia:** `lib/types/dia-reparto.ts` y
`lib/utils/dia-reparto.ts` **no aparecen** en el diff de esta rama. El enum sigue teniendo dos
valores y la corrección manda un token, no una fecha. Es lo que hace que mover al pasado sea
**inexpresable** en vez de estar prohibido por un `if` que alguien pueda relajar.

---

## 6 · Lo que queda a deber, dicho y no disimulado

1. **BLOQUE HISTORIAL (P1: `B24`-`B29`, `F7`, `F8`) — NO HECHO, y a propósito.** No es de esta
   tanda: `B24` convierte `OrdenHistorialEntradaDTO` en unión discriminada y **rompe el build** en
   `HistorialOrdenTimeline.tsx`; hacerlo sin `F7` deja el typecheck rojo, y hacer `F7` sin `B24` no
   compila tampoco. Va junto, con backend y UI a la vez. **R37-R45 siguen sin un solo test.**
2. **`F6` («ver la app») — NO HECHA.** Es frontend y **no es opcional**. Necesita preview
   desplegado y cuentas de maestro/admin, `adminSatelite` y mensajero. En este repo mirar la app
   encontró **siete textos rotos** que doce mil tests daban por buenos, así que esto no se da por
   cubierto con la suite. Además, media `F6` (el drawer de historial y los dos avisos de la
   campana) depende del bloque historial, que no está.
3. **`B0.2`** (re-medir M1 antes de desplegar) y **`C7`** (P4 y P5 a la puerta humana) son del
   leader: necesitan el MCP de producción y una decisión de producto.
4. **La desviación de `design.md` §4.2** sobre la selección mixta en `/ordenes` (§3.2 de arriba)
   **no está corregida en el spec**: se deja dicha aquí para que la decida quien corresponda. Si
   se quisiera el comportamiento literal del spec, el cambio es una guarda en `accionesPara` y un
   test más; **no** se hizo por su cuenta porque contradiría el patrón documentado del listado.
5. **El modal no tiene fase de «resultado»** como `AsignarBodegaModal` (que ofrece el manifiesto
   antes de cerrar). Aquí la confirmación va por toast y el modal cierra: no hay nada que
   descargar, y `design.md` §7.2 pide una frase, no una pantalla. Se dice porque **son dos modales
   hermanos con dos comportamientos de cierre distintos**, y eso se nota al leerlos seguidos.
