# Feature 236 — bitácora de implementación (FRONTEND: T4, T5, T6)

> Rama `feature/236-ayuda-tienda-novedades`. **Sin commit.**
> Alcance: **T4 (la pestaña y sus textos)**, **T5 (la card y el punto único de los botones)** y
> **T6 (el hilo del lado tienda)**. La bitácora del backend (T1-T3) es `progress/impl_236.md` y
> **no se tocó**.
>
> Se construyó **encima** del árbol que dejó el backend, sin volver a abrir nada suyo: `GrupoNovedad`
> / `GRUPOS_NOVEDAD` / `grupoDeEstatus`, las cuatro Server Actions y `COLUMNAS_DESCARGA_AYUDA` se
> consumieron **tal cual**.

---

## 0 · LO PRIMERO: las tres anotaciones `@sin-superficie` SE RETIRARON

`progress/impl_236.md` §8 dejó tres anotaciones transitorias con dueño —esta tanda—. **Las tres
están fuera**, y cada una se retiró **en el commit conceptual en que se cableó su consumidor**, no
antes ni después:

| Anotación | Dónde estaba | Quién la consume ahora | Estado |
| --- | --- | --- | --- |
| `listarAyudaTiendaAction` | `lib/actions/novedades.ts:157` | `app/(app)/novedades/page.tsx` (pre-fetch pág. 1) **y** `NovedadesModule` › `RECURSOS_POR_GRUPO.ayuda.listarPagina` (re-fetch) | **RETIRADA** |
| `listarAyudaTiendaCompletoAction` | `lib/actions/novedades.ts:182` | `NovedadesModule` › `RECURSOS_POR_GRUPO.ayuda.listarCompleto`, desde el `DescargarDatasetButton` de la pestaña | **RETIRADA** |
| `COLUMNAS_DESCARGA_AYUDA` | `app/(app)/novedades/_components/ayuda-descarga-columnas.ts:52` | el mismo `DescargarDatasetButton`, vía `RECURSOS_POR_GRUPO.ayuda.columnasDescarga` | **RETIRADA** |

En los tres sitios **no se borró el rastro**: donde estaba la anotación queda una línea que dice
**cuál es ahora su superficie** y que ahí vivió una anotación transitoria. (El token
`@sin-superficie` aparece en esa prosa seguido de un backtick, nunca de un espacio, así que la
guardia —cuyo patrón es `@sin-superficie[ \t]+`— no lo lee como anotación. Es la misma convención que
ya usan `lib/actions/ciclo-vida.ts` y `lib/actions/conteo-devoluciones.ts`.)

**Comprobado en las dos direcciones, no supuesto:**

- **hoy:** `pnpm run test:guardias` → 123 archivos / 1809 tests **verdes**, `superficie-de-uso`
  incluida. Si las tres anotaciones hubieran sido retiradas **sin** cablear, esa guardia estaría roja
  por «inalcanzable sin anotación».
- **mutación M12** (abajo): al **reponer** una de las tres sobre el export ya alcanzable,
  `superficie-de-uso` se pone **roja** — *«estos componentes llevan `@sin-superficie` pero SÍ los
  monta alguien: la excepción caducó»*. Es la prueba ejecutable de que retirarlas era obligatorio y
  no cosmético.

**Esto es lo único que se tocó de `lib/`**, salvo D8 (§4), que el encargo asignó explícitamente a
esta tanda.

---

## 1 · Archivos creados

| Archivo | Qué es |
| --- | --- |
| `app/(app)/novedades/_components/novedad-grupo-textos.ts` | **T4.2** — `TEXTOS_POR_GRUPO` (rótulo de pestaña, `aria-label` de lista y paginación, título y detalle del estado vacío, chip fijo) con `satisfies Record<GrupoNovedad, …>`, y `SUBTITULO_NOVEDADES`. Módulo puro. |
| `app/(app)/novedades/_components/novedad-acciones-catalogo.ts` | **T5.1** — `AccionNovedad`, `ACCIONES_POR_GRUPO` con `satisfies Record<GrupoNovedad, readonly AccionNovedad[]>` y `ACCIONES_SIN_GRUPO` (R21). Módulo puro. |
| `tests/components/NovedadesTabs.test.tsx` | T4.1/T4.2/T4.3/T4.5 |
| `tests/components/NovedadAcciones.test.tsx` | T5.2 (censo cerrado de nombres accesibles por grupo) |
| `tests/components/NovedadesHilo.test.tsx` | T6.1-T6.5 |
| `tests/unit/types/novedad-acciones-catalogo.test.ts` | T5.1 |
| `tests/unit/guards/novedad-acciones-una-tabla.guardia.test.ts` | **T5.3** (R19) **+ el censo de R2/R8** (T4.5), con autocomprobación |

## 2 · Archivos modificados

| Archivo | Qué cambió |
| --- | --- |
| `app/(app)/novedades/page.tsx` | **T4.1/T4.4** — tercera lectura en el `Promise.all` (`listarAyudaTiendaAction`), **fallback a vacío** si no responde `ok` (la principal sigue haciendo `notFound`), y el subtítulo pasa a `SUBTITULO_NOVEDADES`. |
| `app/(app)/novedades/_components/NovedadesTabs.tsx` | **T4.1** — de dos pestañas a tres. Las dos de novedad salen de `GRUPOS_NOVEDAD` (ayuda primero, D6); la de rechazos se añade a mano porque **no es un grupo de novedad**. `keepMounted` intacto. Sus props pasan a `Record<GrupoNovedad, …>`. |
| `app/(app)/novedades/_components/NovedadesModule.tsx` | **T4.2/T5.4/T5.5/T6.1** — `grupo` obligatorio; `TEXTOS_POR_GRUPO` + `RECURSOS_POR_GRUPO` (acciones y descarga por grupo); `badgeNovedad` derivado del grupo de la FILA; estado `ordenConHilo` y montaje condicional de `HiloNotasNovedadModal`; «Habilitar» distingue los dos desenlaces de D8. |
| `app/(app)/novedades/_components/NovedadAcciones.tsx` | **T5.2/T6.7** — reescrito contra la tabla. Mueren `esDevuelta`, `esAyuda`, `puedeHabilitar` y los tres `...(cond ? [x] : [])`. Gana `onConversacion`. Cabecera reescrita (la nota «la tienda YA NO LEE NI RESPONDE el hilo» dejó de ser cierta). |
| `app/(app)/novedades/_components/HiloNotasNovedadModal.tsx` | **T6.7** — se retira `@sin-superficie`; se reescribe «esta pantalla lista exactamente las órdenes `devuelta`»; el mensaje de `forbidden` deja de decir «puede que ya no esté en devolución» (falso sobre una orden en ayuda). |
| `app/(app)/novedades/_components/ayuda-descarga-columnas.ts` | Se retira `@sin-superficie` (§0). **Nada más**: ni una columna, ni el título. |
| `lib/actions/novedades.ts` | Se retiran las **dos** `@sin-superficie` (§0). **Ninguna firma, ningún schema, ningún grupo**. |
| `lib/types/novedad-habilitar.ts` · `lib/services/HabilitarNovedadService.ts` · `lib/interfaces/services/IHabilitarNovedadService.ts` | **T5.5 — D8** (§4). |
| `tests/components/NovedadesModule.test.tsx` | `grupo` en los 49 montajes; los casos del grupo de ayuda se **reubican al grupo correcto** (no se borran); dos casos del badge cambian de aserción con nota fechada; «Habilitar» pasa de dos desenlaces a tres. |
| `tests/components/NovedadesPage.test.tsx` | Tercer pre-fetch, subtítulo (R14) y fallback a vacío. El mock de `NovedadesTabs` pasa a **capturar props** para poder afirmar a qué pestaña baja cada lectura. |
| `tests/components/descarga/NovedadesDescarga.test.tsx` | Cuatro dobles (uno por lectura) y un `describe` nuevo para la descarga de ayuda (R37/R38/R39). |
| `tests/unit/guards/hilo-ventana-alcanzable.guardia.test.ts` | **T6.6** — el cruce ventana ↔ **superficie montada**. (Es el mismo archivo que T2.7; se escribió **después**, nunca en paralelo.) |
| `tests/unit/services/habilitar-novedad-service.test.ts` | D8: los dos `toEqual` literales se **actualizan** (son el contrato) + un caso nuevo que pone los dos desenlaces uno al lado del otro. |

---

## 3 · Qué se reutilizó y qué no

**Se reutilizó, sin reescribir una línea:**

- **`HiloNotasNovedadModal.tsx`** — estaba entero en disco y sin montar. Reponerlo fue **una línea en
  el módulo** más la acción que lo abre, tal como decía su propia anotación. No se escribió ningún
  hilo nuevo: monta `components/shared/HiloNotasOrden`, que ya trae el estado vacío (R33) y el aviso
  de solo lectura (R34), y sus tres mensajes de fallo (R35) ya estaban en su `TEXTOS`.
- **El montaje del lado mensajero como molde**: `RepartoModule` monta `HiloNotasAyudaModal` con
  `key={orden.id}` desde un botón «Conversación». Se copió el **gesto**, no el código (R36).
- `HiloNotasOrden`, `HabilitarNovedadModal`, `ReprogramarNovedadModal`, `IntentoContactoAccion`,
  `ContactoButtons`, `DescargarDatasetButton`, `filasDesdeResultado`, `Pagination`, `TabsGroup`, las
  cards POS y su adaptador, y el punto único de rescate de la 235.
- **`NovedadesModule` no se duplicó**: se parametrizó. Lo que sabe hacer es idéntico para los dos
  grupos; lo único que cambia son dos tablas indexadas por `GrupoNovedad`.

**Lo que NO se hizo, a propósito:**

- **No se arregló el punto 12** («Habilitar» en las cards que vienen de un cierre). Se **trasladó**
  a una celda de `ACCIONES_POR_GRUPO`, con su comentario y su dueño (ficha 240). Para la 240, ahora
  es borrar una palabra.
- **No se tocó `VENTANA_ESCRITURA`** (R45). D4 no concede nada: repone la superficie de un permiso
  que la 235 ya había abierto.
- **No se re-derivó `puedeEscribir`** en la UI (R30). El modal no menciona el estatus; hay un censo
  del fuente que lo afirma.
- **No se reordenó nada en el cliente**: la pestaña de ayuda llega ya ascendente por fecha de
  solicitud desde el servicio (D7/R17).
- **No se creó ningún componente** que shadcn/ui ya tuviera, ni se tocó `lib/` fuera de §0 y §4.

---

## 4 · D8, implementada tal como el spec la describe

**Estaba firmada y sin implementar.** El encargo la asignó a esta tanda **precisamente porque toca un
tipo que la 240 también va a tocar** — si las dos fichas escriben sin acordarlo, una sobrescribe a la
otra en silencio.

**Qué cambia, en tres líneas de código y su porqué:**

- `HabilitarNovedadServiceResult` → el `ok` gana **`rescatada: boolean`**, obligatorio y sin default
  (un olvido de propagación rompe el typecheck, no deja a la pantalla afirmando el caso feliz por
  omisión).
- `HabilitarNovedadService.habilitar` → el resultado del punto único de rescate **deja de
  descartarse**: `return { ...publicada, rescatada: rescate.status === "ok" }`. No se traduce su
  `forbidden` opaco a un motivo, y **no** se convierte en un fallo: la nota se publicó de verdad.
- `NovedadesModule.habilitar` → dos desenlaces distintos:
  - `rescatada: true` → «La orden volvió a la ruta.», la fila sale y el total baja (R24);
  - `rescatada: false` → aviso **de aviso, no de éxito** («Tu nota se publicó, pero la orden no
    volvió a la ruta…») y **la fila SE QUEDA**.

**Por qué la fila se queda**, y no es una decisión suelta: el propio D8 nombra el defecto con esas
palabras — *«la tienda publica su nota, **la fila desaparece de la pantalla** y el aviso dice “Orden
habilitada”… Al recargar, vuelve»*. Quitar la fila mientras se dice que no se movió sería sustituir
una mentira por otra.

**Efecto colateral conocido y dicho aquí:** sobre una **devolución anclada** el rescate es un no-op,
así que desde la pestaña de devoluciones «Habilitar» ya **no** quita la fila. Es más veraz que lo de
ayer (la orden sigue `devuelta` y sigue listada), y es transitorio: la 240 retira ese botón de esas
cards.

---

## 5 · Decisiones firmadas: cómo aterrizó cada una

| Decisión | Cómo se implementó |
| --- | --- |
| **D6 — textos** | «Ayuda solicitada» (pestaña, **primera**), «Esperando tu respuesta» (chip), subtítulo con las tres superficies, estado vacío firmado. **NO se «corrigió» a «Ayuda a gestionar»**: el porqué está escrito en `novedad-grupo-textos.ts` y hay un caso que afirma que ese rótulo **no** existe. |
| **D5 — el hilo desde una acción de la card** | `ordenConHilo` + montaje condicional con `key`, gemelo del lado mensajero. La pieza se **montó**, no se reescribió. |
| **D4 — la tienda escribe sin rescatar** | La UI **no** re-deriva nada: `puedeEscribir` llega del servidor. Censo del fuente en `NovedadesHilo.test.tsx`. |
| **D8** | §4. |
| **D1/D3/D7** | Consumidas del backend sin reabrirlas: una descarga por pestaña, sin columna de causa, y sin reordenar en cliente. |

---

## 6 · Mapa `R<n> → test` (los R de T4-T6)

| Req | Test que lo cubre |
| --- | --- |
| **R1** | `NovedadesTabs.test.tsx` › «R1/R13: hay TRES pestañas, con sus rótulos en español y sin jerga» |
| **R2** | `NovedadesTabs.test.tsx` › «el panel pinta LO QUE RECIBE: no filtra una orden de otro grupo» · `novedad-acciones-una-tabla.guardia.test.ts` › «ningún recorrido de `items` mira el estatus ni el grupo» |
| **R6** (mitad) | `novedad-acciones-catalogo.test.ts` › «cubre TODOS los grupos declarados, ni uno más ni uno menos» (+ el `satisfies`, que es la mitad de typecheck) |
| **R8** | ídem R2: el censo del árbol + el caso de la fila intrusa que **no** se filtra |
| **R12** | `NovedadesTabs.test.tsx` › «cambiar de pestaña y volver NO reinicia la página de la otra» (con el re-fetch contado: **una** sola vez) |
| **R13** | `NovedadesTabs.test.tsx` › los tres rótulos, **como literal** |
| **R14** | `NovedadesPage.test.tsx` › «el subtítulo nombra LAS TRES superficies y ya no dice el de ayer» (afirma el nuevo **y** la ausencia del viejo) |
| **R15** | `NovedadesPage.test.tsx` › «pre-fetch de la página 1 … y baja a SU pestaña» (el total viaja) · `NovedadesTabs.test.tsx` › la `Pagination` de cada grupo con **su** nombre accesible |
| **R16** | `NovedadesTabs.test.tsx` › «la pestaña de ayuda vacía HABLA», leyendo **el texto** + «no se renderiza una lista vacía» + **su control positivo** (con órdenes, la lista aparece y el texto se va) · `NovedadesPage.test.tsx` › «si la lectura de ayuda falla, la página NO se cae» |
| **R18** | `novedad-acciones-catalogo.test.ts` › «grupo %s: ni una acción de más ni una de menos, y en su orden» |
| **R19** | `novedad-acciones-una-tabla.guardia.test.ts` › «toda lectura de `estatusValue` pasa por `grupoDeEstatus`» + «ningún archivo escribe un literal de estatus», **con autocomprobación en el propio archivo** |
| **R20** | typecheck (los dos `satisfies`) + `novedad-acciones-catalogo.test.ts` › «toda acción de la unión aparece en al menos un grupo» y «ninguna acción de la tabla está fuera de la unión» |
| **R21** | `NovedadAcciones.test.tsx` › «un estatus que no es de ningún grupo se queda SÓLO con el contacto» · `NovedadesModule.test.tsx` › «R21: … sólo quedan los de contacto» (con su control positivo) · `novedad-acciones-catalogo.test.ts` › `ACCIONES_SIN_GRUPO` |
| **R22** | `NovedadAcciones.test.tsx` › «la fila de AYUDA ofrece exactamente cinco controles, y son los suyos» (censo **cerrado** de nombres accesibles) |
| **R23** | ídem, y `novedad-acciones-catalogo.test.ts` › «el grupo de ayuda NO ofrece nada que presuponga una devolución» (con control positivo en el otro grupo) |
| **R24** | `NovedadesModule.test.tsx` › «R24: rescatada → avisa que volvió a la ruta, la fila sale y el total baja» |
| **R25** | `NovedadesModule.test.tsx` › «R25: si el rescate NO se aplicó, la pantalla no afirma que la devolvió y la fila se queda» · `habilitar-novedad-service.test.ts` › los dos desenlaces + «`rescatada` … no es una constante» |
| **R26** | `NovedadesModule.test.tsx` › «R26: con una causa ARRASTRADA, sobre una orden en ayuda no aparece ninguna causa» (ni la etiqueta, ni «Ayuda · …», ni «Sin causa registrada»; **con control positivo** en el grupo de devolución) |
| **R27** | `NovedadesHilo.test.tsx` › «con el modal CERRADO, el hilo no está en el árbol» + «al pulsarla se abre el modal del hilo de ESA orden» |
| **R28** | `NovedadesHilo.test.tsx` › «la nota del mensajero se lee entera, con su autor y su hora» |
| **R29** | `NovedadesHilo.test.tsx` › «con tres órdenes en pantalla, `listarNotasOrden` no se llama ni una vez» (**con control positivo**: las tres puertas están) + «`NovedadDTO` no gana ninguna clave de notas» |
| **R30** | `NovedadesHilo.test.tsx` › «el modal NO re-deriva el permiso del estatus» (censo del fuente, con contraprueba de que el censo lee algo) |
| **R31** | `NovedadesHilo.test.tsx` › «con `puedeEscribir: true` la tienda publica SIN habilitar nada antes» |
| **R32** | ídem: la fila sigue, la pestaña no se vacía y `habilitarNovedad` no se llamó |
| **R33** | `NovedadesHilo.test.tsx` › «estado vacío CON TEXTO y compositor disponible» |
| **R34** | `NovedadesHilo.test.tsx` › «con `puedeEscribir: false` se lee el aviso … y NO hay campo» (la ausencia emparejada con la presencia del texto y del hilo) |
| **R35** | `NovedadesHilo.test.tsx` › un caso por desenlace + «los tres mensajes son DISTINTOS entre sí» |
| **R36** | `hilo-ventana-alcanzable.guardia.test.ts` › «los DOS roles con ventana sobre `ayuda_tienda` tienen su hilo MONTADO» + «cada montaje se abre desde una ACCIÓN» + contraprueba del detector |
| **R37/R38/R39** (mitad de pantalla) | `NovedadesDescarga.test.tsx` › «el archivo se llama como su pestaña y NO tiene columna de causa» + «cada pestaña llama a la lectura de SU grupo, y a la del otro ni una vez» (**par en las dos direcciones**) + el tope |
| **R47** | Censo manual: **cero** `console.*` en `app/(app)/novedades/` y en los cuatro archivos de `lib/` tocados (salida en §8) |

**Sobre las ausencias.** Cada afirmación de que algo **no** está va emparejada con su presencia en el
caso contrario: R26 (causa ausente en ayuda ↔ presente en devolución), R21 (sin acciones de
resolución ↔ el contacto sí), R16 (sin lista ↔ con órdenes la lista aparece), R22/R23 (censo de ayuda
↔ censo de devolución, y un caso que afirma que **los tres censos son distintos entre sí**), R29 (sin
lectura del hilo ↔ las tres puertas montadas), R38 (cada descarga llama a la suya y no a la otra, en
las dos direcciones), R30 (dos ausencias ↔ una presencia que prueba que el censo lee el archivo).

**Sobre los textos.** Todos los visibles se afirman **como literal**, nunca contra la constante que
los genera: comparar un texto con su propia fuente está siempre verde. Está dicho en la cabecera de
`NovedadesTabs.test.tsx`.

---


### R41-R46 — los requisitos de NO REGRESIÓN

Añadidos el 2026-08-19 **tras la revisión**: faltaban en el mapa de las dos bitácoras, y
`CHECKPOINTS.md` exige que cada `R<n>` tenga el suyo. Se cumplen por **dos mitades**, y las dos se
midieron.

| Req | Qué prohíbe | Cómo se comprueba |
| --- | --- | --- |
| **R41** | tocar montos o movimientos de dinero | `dinero-sin-centimos` · `ordenes-columnas-money-safe`, **verdes sin modificarse**; y el diff no toca ninguna ruta de dinero |
| **R42** | añadir/retirar estados o transiciones | el diff **no toca** el catálogo de estados ni ninguna migración: esta ficha **no persiste nada** |
| **R43** | cambiar cuándo una orden entra o sale del estatus de ayuda | `RepartoAyuda` verde sin tocar; esa transición vive en la 235 y su fuente no está en el diff |
| **R44** | cambiar lo que el mensajero ve o puede hacer | `RepartoAyuda` verde sin tocar; el diff **no toca** el portal del mensajero |
| **R45** | cambiar la ventana de escritura del hilo | `tests/unit/services/orden-nota-service.test.ts:380` — `toEqual` **literal** sobre las dos listas de `VENTANA_ESCRITURA`, **intacto y verde** · `orden-nota-frontera` |
| **R46** | cambiar el conteo de intentos | `anclaje-vs-intentos` · `deriva-primer-intento`, verdes sin modificarse; el diff no toca los contadores |

**La mitad sustantiva es el diff:** `git diff --name-only` contra la base no incluye catálogo de
estados, migraciones, portal del mensajero, `DevolucionSlaService`, `lib/types/ventana-hilo-notas.ts`
ni los contadores de intentos. **Ninguna.** La otra mitad son las **siete suites** que vigilan esas
rutas, verdes y **sin modificarse**: `dinero-sin-centimos`, `ordenes-columnas-money-safe`,
`orden-nota-frontera`, `superficie-de-uso`, `anclaje-vs-intentos`, `deriva-primer-intento` y
`RepartoAyuda` — **110 tests**.

⚠️ Un rojo en cualquiera de esas siete **es regresión, no una aserción que haya que cambiar**.

## 7 · Mutaciones — una a una, vitest corrido, salida real leída y citada

**Método.** Script `mutar.py` (escrito a archivo, **nunca `node -e`**) que **aborta si el texto a
sustituir no está presente o no es único** —nunca deja creer que mutó algo— y reporta `sha256[:16]`
antes y después. Todas revertidas: el sha final de los nueve archivos de producción coincide con el
previo (§8).

| # | Mutación | Archivo | `sha256[:16]` antes → mutado → después | Qué cayó (salida REAL) |
| --- | --- | --- | --- | --- |
| **M1** (T7.4) | Añadir `reprogramar` al grupo `ayuda` | `novedad-acciones-catalogo.ts` | `5435e134…` → `6209bf95…` → `5435e134…` | **4 failed / 75 passed**. `R22: la fila de AYUDA ofrece exactamente cinco controles: expected [ 'Llamar a Ana Cliente', …(5) ] to deeply equal [ …(4) ]` · `grupo ayuda: ni una acción de más ni una de menos: expected [ 'contacto', 'reprogramar', …(3) ] to deeply equal [ 'contacto', 'habilitar', …(2) ]` · `R23: … expected [ … ] to not include 'reprogramar'` · `sobre una orden que NO está devuelta …: expected <button …> to be null` |
| **M2a** (T7.5) | Quitar `conversacion` del grupo `ayuda` | `novedad-acciones-catalogo.ts` | `5435e134…` → `dff6cd3e…` → `5435e134…` | **15 failed / 15 passed**. `Unable to find an accessible element with the role "button" and name "Abrir la conversación de la orden de Ana Cliente"` (×11, todo `NovedadesHilo`) · `una acción declarada y sin grupo …: expected [ 'conversacion' ] to deeply equal []` · `R27: la conversación existe … to include 'conversacion'` |
| **M2b** | **Desactivar** el montaje (`false && ordenConHilo`) | `NovedadesModule.tsx` | `69ad36db…` → `53882490…` → `69ad36db…` | **8 failed / 41 passed**: `Unable to find role="dialog"` (×7). ⚠️ **T6.6 NO cayó** — ver la nota de abajo. |
| **M2c** | **Borrar** el montaje entero (lo que hizo `55723c83`) | `NovedadesModule.tsx` | `69ad36db…` → `67a21a0c…` → `69ad36db…` | **2 failed / 44 passed** en las tres guardias. `236/R36 … adminTienda: su ventana incluye 'ayuda_tienda' pero …/NovedadesModule.tsx ya no monta <HiloNotasNovedadModal>. Tiene el permiso y NINGÚN sitio donde ejercerlo` · `expected '"use client"…' to match /ordenConHilo\s*\?/` |
| **M3** | `chipFijo` del grupo de ayuda a `null` | `novedad-grupo-textos.ts` | `db08194f…` → `6cac6485…` → `db08194f…` | **2 failed / 59 passed**. `Unable to find an element with the text: Esperando tu respuesta` (×2: el caso del chip y el de R26) |
| **M4** | El subtítulo vuelve al de ayer | `novedad-grupo-textos.ts` | `6cac6485…` → `44eec190…` → `6cac6485…` | **1 failed / 7 passed**. `R14: el subtítulo nombra LAS TRES superficies y ya no dice el de ayer — Unable to find an element with the text: Las órdenes en las que tus mensajeros piden ayuda, …` |
| **M5** | El vacío de ayuda hereda el de devolución | `novedad-grupo-textos.ts` | `db08194f…` → `cc7a06cc…` → `db08194f…` | **2 failed / 65 passed**. `R16: la pestaña de ayuda vacía HABLA — Unable to find an element with the text: Ningún mensajero te pidió ayuda` (y el mismo texto en el caso de R24, que lo usa como prueba de que la fila salió) |
| **M6** (D8, servidor) | El servicio afirma **siempre** `rescatada: true` | `HabilitarNovedadService.ts` | `280044dc…` → `010e0129…` → `280044dc…` | **2 failed / 6 passed**. `sobre una devolucion ANCLADA … expected { … } to deeply equal { … }` con `- "rescatada": false / + "rescatada": true` · `236/D8: rescatada distingue los dos desenlaces, y no es una constante` |
| **M7** (D8, pantalla) | La UI **ignora** `rescatada` (`if (true)`) | `NovedadesModule.tsx` | `69ad36db…` → `446ed3b5…` → `69ad36db…` | **1 failed / 60 passed**. `R25: si el rescate NO se aplicó, la pantalla no afirma que la devolvió … expected "vi.fn()" to be called 1 times, but got 0 times` (el toast de aviso no llegó a emitirse) |
| **M8** | La pantalla vuelve a **partir `items` en el cliente** | `NovedadesModule.tsx` | `69ad36db…` → `fb184500…` → `69ad36db…` | **3 failed / 11 passed**. `ningún recorrido de items mira el estatus ni el grupo … + ".filter((n) => grupoDeEstatus(n.estatusValue) === grupo).map(…"` · `el panel pinta LO QUE RECIBE: expected [ <li>…(1)</li> ] to have a length of 2 but got 1` · `el censo LEYÓ el árbol …: expected 3 to be 2` |
| **M9** (R19) | Plantar `estatusValue === "ayuda_tienda"` **en el árbol real** | `NovedadAcciones.tsx` | `60f6eeb3…` → `bf44616c…` → `60f6eeb3…` | **2 failed / 6 passed**. `toda lectura de estatusValue pasa por grupoDeEstatus … + "…/NovedadAcciones.tsx (1 lectura/s crudas)"` · `y ningún archivo de la pantalla escribe un literal de estatus` |
| **M10** (D6) | Invertir el orden de las pestañas | `NovedadesTabs.tsx` | `d2d8b63a…` → `ee9c3a8d…` → `d2d8b63a…` | **5 failed / 1 passed**. `R1/R13: hay TRES pestañas … expected [ 'En devolución', …(2) ] to deeply equal [ 'Ayuda solicitada', …(2) ]` (+ los cuatro que dependen de cuál es el panel de entrada) |
| **M11** (D3/R39) | La descarga de ayuda usa las columnas de devoluciones | `NovedadesModule.tsx` | `69ad36db…` → `8df53818…` → `69ad36db…` | **1 failed / 6 passed**. `R39/R26: el archivo se llama como su pestaña y NO tiene columna de causa: expected [ 'Nº Guía', 'Nº Remisión', …(8) ] to deeply equal [ … ]` |
| **M12** (§0) | **Reponer** una anotación `@sin-superficie` ya caducada | `ayuda-descarga-columnas.ts` | `ac39c261…` → `6cab7fa0…` → `ac39c261…` | **1 failed / 17 passed**. `ninguna anotación @sin-superficie de componente sobrevive a su motivo — estos componentes llevan @sin-superficie pero SÍ los monta alguien: la excepción caducó` |

### Dos cosas que las mutaciones enseñaron y que NO se tapan

1. **M2b: la guardia de T6.6 no ve un cable desactivado.** Al envolver el montaje en `false && …` el
   texto `<HiloNotasNovedadModal` sigue en el archivo, así que el censo estático sigue verde — y
   `superficie-de-uso` también, porque el `import` sigue ahí. Lo que sí cae son los **ocho casos de
   componente** de `NovedadesHilo.test.tsx`. Queda dicho aquí: la guardia cubre el fallo **histórico**
   (borrar el montaje, M2c → roja) y los tests de componente cubren el cable suelto. **Ninguna de las
   dos sobra.**
2. **El `\b` que llegó como backspace, cazado en la primera corrida.** El censo de T6.6 se escribió
   con `` new RegExp(`<${modal}\b`) `` y denunció **los dos** montajes, incluido el del mensajero, que
   lleva un día montado. En un template literal `\b` es el carácter BACKSPACE. Arreglado con `\\b`,
   **extraído a la función `montaEl`** y con la contraprueba ejerciendo **esa misma función** (antes
   usaba un regex literal escrito aparte, que estaba bien y por eso no cazó nada). Es exactamente la
   trampa que `specs/238/tasks.md` T1.2 advierte para `node -e`, y aparece igual dentro de un archivo
   de test.

> **Nota de honestidad sobre M4.** Su revert previo (M3) **abortó** porque, con `chipFijo: null` en
> los dos grupos, el texto a sustituir dejó de ser único — el script se negó a mutar a ciegas, que es
> lo que tiene que hacer. Así que **M4 se corrió con M3 todavía aplicada**. El caso que cayó es el del
> subtítulo, que M3 no toca, así que la lectura vale; el sha de partida que figura en la tabla es el
> real (`6cac6485…`, el de M3), no el limpio. Los dos se revirtieron después a mano y el archivo
> volvió a `db08194f…`.

---

## 8 · Verificación — salida real

```
$ pnpm exec tsc --noEmit
TSC OK (sin salida = cero errores)
```

```
$ pnpm exec eslint <los 22 archivos tocados>
✖ 1 problem (0 errors, 1 warning)
  tests/unit/services/habilitar-novedad-service.test.ts
    61:37  warning  '_input' is defined but never used  @typescript-eslint/no-unused-vars
```
*(La única advertencia es **preexistente** y está en una línea que esta tanda no tocó: el doble de
`transicionarAyuda` del archivo original. Cero errores.)*

```
$ pnpm run test:guardias
 Test Files  123 passed (123)
      Tests  1809 passed (1809)
   Duration  13.15s
```

```
$ pnpm exec vitest run tests/components tests/unit/types tests/unit/actions \
      tests/unit/services tests/unit/descarga
 Test Files  517 passed (517)
      Tests  7237 passed | 26 skipped (7263)
   Duration  217.64s
```

```
$ pnpm exec vitest related --run <los 11 archivos de produccion tocados>
 Test Files  12 passed (12)
      Tests  165 passed (165)
```

**Lo que esta ficha NO toca, verde sin modificarse (T7.1, la parte que alcanza a esta tanda):**

```
$ pnpm exec vitest run tests/components/RepartoAyuda.test.tsx \
    tests/unit/services/rescate-ayuda-service.test.ts
 Test Files  2 passed (2)
      Tests  33 passed (33)
```

> ⚠️ **CORREGIDO el 2026-08-19 tras la revisión, y hay que decir qué pasó.** Este bloque publicaba
> `3 passed (3) / 54 tests` sobre un comando que incluía `tests/unit/types/ventana-hilo-notas.test.ts`
> — un archivo que **nunca ha existido en ninguna rama**. `vitest` **no falla** con un filtro que no
> casa nada: lo ignora en silencio. Así que **esos números no salieron de ese comando**, y
> re-ejecutarlo hoy da `2 passed (2) / 33 tests`, que es lo que ahora queda escrito.
>
> No cambia ninguna conclusión —las dos suites que sí existen están verdes y son las que sostienen
> la afirmación— pero **una salida publicada tiene que reproducirse**. Una que no lo hace es
> indistinguible de una inventada, y este repo ya pagó un arnés de mutaciones que reportaba
> resultados sin haber ejecutado nada. La cobertura real de R45 vive en
> `tests/unit/services/orden-nota-service.test.ts:380`.

**R47 — censo de PII en registros:** `grep -rn "console\."` sobre `app/(app)/novedades/` y sobre los
cuatro archivos de `lib/` tocados → **ninguna ocurrencia**. Esta tanda no añade ni un registro de
diagnóstico.

**El gate (`./init.sh` / `./init.sh --rapido`) NO se corrió aquí, a propósito:** no se corre en
paralelo con un subagente que muta el árbol, y esta bitácora se cierra con mutaciones recién
revertidas. Lo corre el leader, con el árbol quieto.

`sha256[:16]` de los archivos de **producción** tocados, al cerrar (idénticos a los de antes de la
primera mutación):

```
app/(app)/novedades/page.tsx                                    b83de7357d1c28d1
app/(app)/novedades/_components/NovedadesTabs.tsx               d2d8b63a0a90afb8
app/(app)/novedades/_components/NovedadesModule.tsx             69ad36db9e2fa081
app/(app)/novedades/_components/NovedadAcciones.tsx             60f6eeb397849211
app/(app)/novedades/_components/novedad-grupo-textos.ts         db08194f9425f998
app/(app)/novedades/_components/novedad-acciones-catalogo.ts    5435e1347584c7ad
app/(app)/novedades/_components/ayuda-descarga-columnas.ts      ac39c26137979906
lib/actions/novedades.ts                                        a0b167ecb3f42da7
lib/services/HabilitarNovedadService.ts                         280044dcf1783012
```

---

## 9 · Lo que queda abierto

1. **T7.7 — VER LA APP.** No se hizo: el encargo reserva el recorrido para el humano y prohíbe tocar
   el servidor de dev vivo. Va a `progress/recorrido_236.md`, con los dos muros ya medidos (el OTP se
   lee del log **sólo si la salida va a un archivo**; un 404 en ruta existente suele ser un cliente
   Prisma rancio en el proceso vivo).
2. **T7.3 y T7.6** — la mutación del corte del servidor y las guardias completas son del backend/leader;
   `test:guardias` quedó verde aquí (§8).
3. **T8.1/T8.2/T8.3** — cierre documental y `feature_list.json`: del leader.
4. **T0.1** — re-medir contra producción **antes de desplegar**. Sigue abierta y bloquea el
   despliegue, no el merge.
5. **Coordinación con la 240**, dicha aquí para que no se descubra en un conflicto: comparte
   `ACCIONES_POR_GRUPO` (una celda), `NovedadesModule` y ahora también `HabilitarNovedadResult`
   (§4). **No se trabajan en paralelo.** La 237 comparte la misma tabla y la misma card.

---

## 10 · Veredicto

**T4, T5 y T6 entregados y verdes.** La pestaña de ayuda existe, va primera y su estado vacío habla;
el juego de botones sale de una sola tabla indexada por el mismo `GrupoNovedad` que usa el servidor,
con una guardia que impide que vuelva a decidirse en otro sitio; la tienda **vuelve a leer y a
contestar el hilo**, que es el requisito por el que existe la ficha; «Habilitar» deja de afirmar que
habilitó cuando no movió nada; y **las tres anotaciones `@sin-superficie` están retiradas**, con la
mutación que lo prueba en las dos direcciones.
