# Feature 240 — Bitácora de implementación (FRONTEND)

> **Alcance: T5 (la pantalla) y T6 (la guardia anti-maqueta) de `tasks.md`, más la mutación T7.4.**
> El backend (T1-T4 + T7.1-T7.3) tiene su propia bitácora en `progress/impl_240.md` y **no se tocó**.
> T7.5 (guardias completas) y T7.6 se corrieron y están en §5; **T8 (ver la app) es del humano** y
> **T9 (cierre documental) del leader**.
>
> **Rama:** la que estaba puesta (`docs/240-246-247-specs`). **Ni un comando de git que mueva árbol,
> índice o rama.** **Sin commit.**
>
> **Fecha:** 2026-08-20.

---

## 0. La confirmación que se pidió explícitamente

**`tests/unit/guards/superficie-de-uso.guardia.test.ts` quedó VERDE POR CABLEADO, no por anotación.**

- **Antes** (medido al empezar, salida real):

  ```
   FAIL  … > ninguna Server Action de `lib/actions/**` es inalcanzable sin su anotación `@sin-superficie`
  AssertionError: … expected [ Array(1) ] to deeply equal []
  +   "lib/actions/resolver-novedad.ts:162 rechazarNovedad",
        Tests  1 failed | 17 passed (18)
  ```

- **Después:** `Tests 18 passed (18)`.

- **Qué la apagó:** `app/(app)/novedades/_components/RechazarNovedadModal.tsx:7`
  `import { rechazarNovedad } from "@/lib/actions/resolver-novedad";`, y ese modal lo monta
  `NovedadesModule`, que cuelga de `app/(app)/novedades/page.tsx`. Es una arista real desde una raíz
  de ruta de Next.

- **Comprobación de que NO se apagó anotando:**

  ```
  $ grep -n "sin-superficie" lib/actions/resolver-novedad.ts
  (ninguna anotacion: 0 coincidencias)
  ```

  **Cero `@sin-superficie` en todo el archivo del borde.** El backend se negó a ponerla con el
  argumento correcto —«eso sería la maqueta que la ficha viene a cerrar»— y esta tanda no lo
  deshizo.

---

## 1. Qué se montó, por tanda

### T5 — La pantalla

| Archivo | Qué |
| --- | --- |
| `app/(app)/novedades/_components/novedad-acciones-catalogo.ts` | **T5.1:** `ACCIONES_POR_GRUPO.devolucion` pierde `"habilitar"` (**el punto 12, cerrado**, R33). El comentario que declaraba la deuda **con dueño** se sustituye por lo que pasó, citando lo que decía. El JSDoc de `rechazar` deja de decir «MAQUETA hasta la ficha 240». **T6.1:** entran `ProductorAccion` y `PRODUCTOR_POR_ACCION`. |
| `app/(app)/novedades/_components/NovedadAcciones.tsx` | **T5.3/T5.4:** la prop `onDevolver` → **`onRechazar`**. El rótulo, el tooltip, el icono (`Undo2`) y el nombre accesible **no cambian**. Los dos comentarios que dejaron de ser ciertos —el JSDoc de la prop y la nota «el prop conserva su nombre porque nombra la transición que falta decidir»— reescritos contando qué decían. |
| `app/(app)/novedades/_components/NovedadesModule.tsx` | **T5.3:** `avisarNoDisponible` **desaparece**; entra `ordenARechazar` con montaje condicional y `key={orden.id}`, `resolverRechazo` y la tabla `MENSAJE_POR_FALLO_DEL_RECHAZO`. `handleReprogramada` → **`sacarDeLaLista`** (tiene dos llamadores desde hoy; el nombre viejo describía a uno solo). |
| `app/(app)/novedades/_components/RechazarNovedadModal.tsx` | **NUEVO (T5.3).** Molde: `ReprogramarNovedadModal` (la forma) + `GestionarDesdeAyudaModal` (el desenlace devuelto al padre). Aviso fijo arriba, motivo obligatorio, bloqueo con texto, **sin selector de fotos**. |
| `tests/unit/types/novedad-acciones-catalogo.test.ts` | `JUEGO_ESPERADO.devolucion` **actualizado a mano** (4 → 3) + dos casos: «Habilitar sale de la devolución y se queda sólo en la ayuda» (R33+R34) y **T5.2** «el botón «Notas» NO vuelve» (R36), los dos con su control positivo. |
| `tests/components/NovedadAcciones.test.tsx` | **T5.5:** el censo de la fila de devolución pasa de **cinco controles a cuatro**; el caso «y «Rechazar» … sigue siendo la maqueta de la 240» se reescribe contra `onRechazar`; caso nuevo que empareja la ausencia de «Habilitar» con su presencia en la ayuda. |
| `tests/components/NovedadesModule.test.tsx` | **T5.4/T5.5:** el fixture del canal `info` reescrito (se quedó **sin usuarios**), el censo de la card de devolución sin «Habilitar» + su ausencia afirmada dentro de la misma card, el bucle de «acciones de icono» de 3 verbos a 2, el caso del tooltip movido a «Reprogramar», y **el caso de la MAQUETA reescrito**: ahora afirma que se abre la ventana y que **nadie avisa por `info`**. |
| `tests/components/RechazarNovedad.test.tsx` | **NUEVO.** 18 casos, montando el **módulo entero** (no el modal suelto: así no queda verde si alguien desconecta el botón de la card). |

### T6 — La guardia contra la maqueta

| Archivo | Qué |
| --- | --- |
| `novedad-acciones-catalogo.ts` | `PRODUCTOR_POR_ACCION` con `satisfies Record<AccionNovedad, ProductorAccion>` (**R37**) y las ocho entradas. Siete citan Server Action + módulo; **una sola** (`contacto`) declara `sinOperacion` con su motivo escrito. |
| `tests/unit/guards/novedad-acciones-sin-maqueta.guardia.test.ts` | **NUEVO (T6.2).** Hermana de `novedad-acciones-una-tabla.guardia.test.ts`, misma forma. **15 casos**. |

**Los cuatro frentes de la guardia** (el cuarto no está en `design.md` §11.2 y se explica abajo):

1. **el productor EXISTE** — el módulo está en `lib/actions/**`, lleva `"use server"` y declara
   `export async function <accionServidor>` (R38);
2. **el productor está CABLEADO** — algún archivo de `app/(app)/novedades/` lo **importa como
   valor** de ese módulo, leyendo el fuente **sin comentarios** con `tests/fixtures/sin-comentarios`
   (R38). ⚠️ Un `import type` **no cuenta**, y esa distinción es load-bearing: el propio
   `RechazarNovedadModal` importa el **tipo** del resultado del **mismo módulo** del que importa la
   acción;
3. **la excusa es legible y caduca** — `sinOperacion` ausente, de relleno o de menos de 20
   caracteres → roja (R39);
4. **el censo INVERSO** — toda Server Action de fila que la pantalla dispare tiene que estar
   declarada en la tabla (R38).

> **Por qué se añadió el frente 4, que el spec no pedía.** Con sólo los frentes 1-3, la recaída se
> apaga con un gesto de tres segundos: bajar la celda a `rechazar: { sinOperacion: "…" }` con una
> excusa plausible de más de veinte caracteres y volver a poner el `toast.info`. Frentes 1 y 2 ya no
> tendrían nada que mirar y el 3 pasaría. **Medido: es exactamente la mutación M2b de §4, y con el
> frente 4 muere.** El frente lleva su lista `NO_SON_ACCIONES_DE_FILA` (los cuatro listados de las
> pestañas, el de la tercera, y `publicarNotaOrden`/`borrarNotaOrden`, que son operaciones **de
> dentro** de la ventana del hilo), con su motivo escrito y con un caso que **la poda**: un exento
> que ya nadie importa es rojo.

**Anti-vacuidad y autocomprobación (R40):** el censo afirma ≥ 8 archivos, ninguno vacío, y que
`Object.keys(PRODUCTOR_POR_ACCION)` es **exactamente** el conjunto de acciones de la tabla (por si
alguien silenciara el `satisfies` con un `as`); los detectores se ejercen contra fuente sintético en
las dos direcciones, **incluido el fuente literal de la maqueta**; y el frente 2 fija el **mapa
concreto** de qué archivo cablea cada operación hoy.

---

## 2. Las firmas que tocaban, una a una

- **D5 — motivo obligatorio, foto NO.** La ventana no monta ningún `input[type=file]` y el caso lo
  afirma **emparejado con la presencia del campo de motivo** (una ausencia sola pasa igual con la
  ventana vacía). El motivo se valida con `rechazarNovedadSchema.shape.motivo`, el **mismo** schema
  del borde: la ventana no tiene una regla propia que pueda divergir.
- **D4 — «Habilitar»: sólo se borra la celda.** `lib/types/novedad-habilitar.ts` y
  `HabilitarNovedadResult` **no se tocaron** (comprobado: no aparecen en la lista de archivos de
  §6). La coordinación firmada con la 236/237 queda cerrada por construcción.
- **D10 — el aviso nombra EL FLETE DE DEVOLUCIÓN.** Literal exacto de la tabla de D10, y **hay un
  caso que afirma las dos mitades**: que dice «flete de devolución» **y** que **no** dice «cobro por
  rechazo» (el ingreso de bodega). Es la confusión que obligó a corregir el design de la 237 el
  2026-08-20, y aquí tiene su test.
  ⚠️ **El importe NO se escribió en el aviso.** Ver §9: la razón es más fuerte que la que tenía yo
  al frenarme, y quedó escrita **junto a la constante**, no sólo aquí.
- **D3 — la guardia anti-maqueta.** Su diseño es del backend; **el verde es de esta tanda**, y se
  demuestra con mutación (§4, M2a y M2b), no se afirma.

---

## 3. Mapa `R<n> → test` — **cada archivo abierto y cada caso citado por su título**

> Sólo los R de T5 y T6. Los de T1-T4 están en `progress/impl_240.md`.
> **Ningún test citado aquí sin haberlo ejecutado**: los tres archivos de abajo se corrieron y sus
> conteos están en §5.

| Req | Archivo | Caso (título literal) |
| --- | --- | --- |
| R13 | `tests/components/RechazarNovedad.test.tsx` **(NUEVO)** | «no monta ningún selector de fotos, y sí el campo de motivo» |
| R27 | ídem | «al pulsar, la ventana se abre y nombra la orden de ESA fila» · «con la ventana cerrada NO está en el árbol» · `tests/components/NovedadAcciones.test.tsx` — «240/R27: «Rechazar» de la fila de DEVOLUCIÓN abre SU ventana, con la orden» · `tests/components/NovedadesModule.test.tsx` — «240/R27: 'Rechazar' abre la ventana en vez de avisar que no está disponible» |
| R28 | `RechazarNovedad.test.tsx` **(NUEVO)** | «el aviso está en el árbol nada más abrir, con su literal» · «y dice EL FLETE DE DEVOLUCIÓN, no el cobro de bodega por rechazo» · «el aviso NO desaparece al escribir el motivo: es fijo, no una advertencia de error» (**mutación M3**) |
| R29 | ídem | «con el campo vacío hay un TEXTO que explica el bloqueo» · «el texto del bloqueo DESAPARECE al escribir el motivo, y el botón se enciende» · «un motivo de sólo ESPACIOS no cuenta como motivo» (**mutación M4**) |
| R30 | ídem | «llama a la acción con `{ordenId, motivo}` y con NADA más» · «avisa a dónde va el paquete, la fila sale y el total baja» (**mutación M5**) · «la ventana se cierra tras confirmar (no invita a un segundo cobro)» |
| R31 | ídem | «dice qué ocurrió, no lo celebra, y RELEE la página» · «el texto es el de la PANTALLA, no la cadena técnica que devuelve el servicio» (**mutación M6**) |
| R32 | `tests/unit/guards/novedad-acciones-sin-maqueta.guardia.test.ts` **(NUEVO)** — los cuatro frentes · `RechazarNovedad.test.tsx` | «R32: y ya NO avisa que la acción no está disponible (la maqueta murió)» |
| R33 | `tests/unit/types/novedad-acciones-catalogo.test.ts` | «grupo devolucion: ni una acción de más ni una de menos, y en su orden» (literal a mano, 4 → 3) · «240/R33+R34: «Habilitar» sale de la devolución y se queda SÓLO en la ayuda» · `NovedadAcciones.test.tsx` — «240/R33: la fila de DEVOLUCIÓN ofrece exactamente cuatro controles, sin «Habilitar»» y «240/R33+R34: «Habilitar» NO está en la devolución, y SÍ en la ayuda» (**mutación M1 = T7.4**) |
| R34 | `novedad-acciones-catalogo.test.ts` — el control positivo del caso de arriba · `NovedadAcciones.test.tsx` — ídem · `tests/components/NovedadesModule.test.tsx` — «237: la orden en ayuda ofrece SUS dos desenlaces…» (afirma «Habilitar» presente en la pestaña de ayuda) | |
| R35 | **el typecheck** + `tests/unit/services/habilitar-novedad-service.test.ts` verde **sin tocarse**. `HabilitarNovedadResult` **no aparece en la lista de archivos tocados** (§6) | |
| R36 | `novedad-acciones-catalogo.test.ts` | «240/R36: el botón «Notas» NO vuelve a las cards de devolución», con su control positivo en la ayuda (**mutación M7**) |
| R37 | **el typecheck** (`satisfies Record<AccionNovedad, ProductorAccion>`), comprobado a mano en T6.1 (§4, nota) · `novedad-acciones-sin-maqueta.guardia.test.ts` — «el censo LEYÓ el árbol de verdad: hay archivos, con código, y las ocho entradas» (la mitad ejecutable: por si alguien silencia el `satisfies`) | |
| R38 | `novedad-acciones-sin-maqueta.guardia.test.ts` **(NUEVO)** | frente 1: «el módulo declarado existe, es de servidor y exporta ese símbolo» · frente 2: «cada productor tiene al menos un importador dentro de `app/(app)/novedades/`» + «y el importador es un archivo REAL, con la arista nombrada (anti-vacuidad)» (**mutación M2a**) · frente 4: «ninguna Server Action de fila se dispara sin estar declarada en la tabla» (**mutación M2b**) |
| R39 | ídem | «ningún `sinOperacion` está vacío, es de relleno ni es telegráfico» + «AUTOCOMPROBACIÓN: los motivos de relleno se denuncian, y el bueno no» |
| R40 | ídem | el bloque 0 entero: «AUTOCOMPROBACIÓN: un `import type` NO cuenta como cableado» (**mutación M8**), «AUTOCOMPROBACIÓN: el `type` EN LÍNEA… tampoco cablea» (**mutación M9**), «AUTOCOMPROBACIÓN: LA MAQUETA no pasa — no cita ninguna acción», «AUTOCOMPROBACIÓN: un productor INVENTADO no existe en el árbol» + **T6.3** (§4) |

**Verificación del mapa, hecha y no supuesta:** los tres archivos de test citados como existentes
antes de esta tanda (`novedad-acciones-catalogo.test.ts`, `NovedadAcciones.test.tsx`,
`NovedadesModule.test.tsx`) se abrieron y se editaron; los dos **(NUEVO)** se escribieron y se
corrieron. No se cita ni un caso que no haya salido en una corrida real.

### ⚠️ Lo que el backend avisó de T4.3: **confirmado, el spec cita mal**

`tasks.md` T4.3 manda añadir el caso del badge «La tienda» a
`tests/components/RepartoAyudaResueltaPorLaTienda.test.tsx`. **Ese archivo existe**, pero su
cabecera dice, literalmente, «FEATURE 237 (T7.5 — R40) — CUANDO LA TIENDA RESUELVE, LA ORDEN SALE
DEL PORTAL DEL MENSAJERO» y monta `RepartoModule` — **el portal del mensajero**, no el cierre. El
badge vive en `app/(app)/cierre-dia/_components/CierreDiaModule.tsx:973`
(`GESTION_TIENDA_BADGE_LABEL = "La tienda"`) y se pinta desde el **booleano** `desdeAyudaTienda`, no
desde la familia. **El argumento del backend se sostiene** y **no se tocó `CierreDiaModule.tsx`**:
está en la superficie de la 246, que sigue en vuelo.

---

## 4. Mutaciones — una a una, con vitest corrido y el rojo citado

> **Arnés:** `scratchpad/mutar.py`. Hace `sha256` **antes / mutado / después**, y **aborta** si el
> fragmento no aparece exactamente una vez o si el sha mutado es igual al de antes: sin mutación no
> hay veredicto. La salida de vitest se escribe a archivo y se lee de ahí. Es la precaución que este
> repo pagó caro —un arnés reportó 9/9 supervivientes **dos veces sin ejecutar un test**—.
> El árbol quedó restaurado tras cada una (`SHA DESPUES == SHA ANTES` en las nueve).

### M1 (= T7.4) — 💰 La celda borrada: reponer `"habilitar"` en `ACCIONES_POR_GRUPO.devolucion`

```
SHA ANTES:   fb2b6d6f6fc39cb2ef9d37874b0d5770620b70f14b192c4a099cde0d7b3fbb8a
SHA MUTADO:  f40dac81ee56ecbcc385863c852aac75f94a6566d6f8ed355f0a3d862ce08484
SHA DESPUES: fb2b6d6f6fc39cb2ef9d37874b0d5770620b70f14b192c4a099cde0d7b3fbb8a
```

**Muerta por 6 casos en 3 archivos** — `Tests 6 failed | 91 passed (97)`:

```
 FAIL  tests/components/NovedadAcciones.test.tsx > 240/R33: la fila de DEVOLUCIÓN ofrece exactamente cuatro controles, sin «Habilitar»
AssertionError: expected [ 'Llamar a Ana Cliente', …(4) ] to deeply equal [ 'Llamar a Ana Cliente', …(3) ]
 FAIL  tests/components/NovedadAcciones.test.tsx > 240/R33+R34: «Habilitar» NO está en la devolución, y SÍ en la ayuda
AssertionError: el paquete de una orden en la devolución anclada YA volvió a la bodega … expected <button …> to be null
 FAIL  tests/components/NovedadesModule.test.tsx > vista Mosaico: las acciones llegan por la prop `acciones` y se pintan DENTRO de la card
 FAIL  tests/components/NovedadesModule.test.tsx > vista Detalle: las acciones llegan por la prop `acciones` y se pintan DENTRO de la card
 FAIL  tests/unit/types/novedad-acciones-catalogo.test.ts > grupo devolucion: ni una acción de más ni una de menos, y en su orden
 FAIL  tests/unit/types/novedad-acciones-catalogo.test.ts > 240/R33+R34: «Habilitar» sale de la devolución y se queda SÓLO en la ayuda
AssertionError: si esto cae, alguien repuso la celda que la 240 vino a borrar … expected [ 'contacto', 'reprogramar', …(2) ] to not include 'habilitar'
```

### M2a (= T6.3, sabor 1) — **replantar la maqueta: el cable cortado**

La tabla sigue citando `rechazarNovedad`, pero el modal deja de importarla y devuelve un aviso de
«esta acción todavía no está disponible». Es, literalmente, el estado de los ocho días.

```
SHA ANTES:   389c5a1bc644aecbd953ae6799771c77db0f80f5bd6e54975f0ccc318ba97518
SHA MUTADO:  675c6927298b331a0efe5843f1ee47af847d7084c3a85c9ca909e4647c940833
SHA DESPUES: 389c5a1bc644aecbd953ae6799771c77db0f80f5bd6e54975f0ccc318ba97518
```

**Muerta por 4 casos, y por las DOS guardias** — `Tests 4 failed | 28 passed (32)`:

```
 FAIL  novedad-acciones-sin-maqueta.guardia.test.ts > cada productor tiene al menos un importador dentro de `app/(app)/novedades/`
AssertionError: un botón de `/novedades` declara una operación que NINGÚN archivo de la pantalla llama: es el cable cortado … 
+   "rechazar → `rechazarNovedad` (lib/actions/resolver-novedad): nadie la importa",
 FAIL  novedad-acciones-sin-maqueta.guardia.test.ts > y el importador es un archivo REAL, con la arista nombrada (anti-vacuidad)
-   "rechazarNovedad ← RechazarNovedadModal.tsx"
+   "rechazarNovedad ← "
 FAIL  novedad-acciones-sin-maqueta.guardia.test.ts > y el detector VE de verdad las acciones de la pantalla (anti-vacuidad)
 FAIL  superficie-de-uso.guardia.test.ts > ninguna Server Action de `lib/actions/**` es inalcanzable sin su anotación `@sin-superficie`
+   "lib/actions/resolver-novedad.ts:162 rechazarNovedad",
```

### M2b (= T6.3, sabor 2) — **replantar la maqueta: la excusa mentirosa**

`rechazar: { sinOperacion: "el rechazo manual todavia no esta decidido: por ahora solo avisa por
pantalla" }`. Motivo plausible, 78 caracteres: **pasa el frente 3 sin despeinarse**.

```
SHA ANTES:   fb2b6d6f6fc39cb2ef9d37874b0d5770620b70f14b192c4a099cde0d7b3fbb8a
SHA MUTADO:  4110127a946d73985864d8028fed97b7971ab54c5f00e9329ed57cb8e8686ef7
SHA DESPUES: fb2b6d6f6fc39cb2ef9d37874b0d5770620b70f14b192c4a099cde0d7b3fbb8a
```

**Muerta por 2 casos — y el que la caza es el frente 4** — `Tests 2 failed | 12 passed (14)`:

```
 FAIL  … > ninguna Server Action de fila se dispara sin estar declarada en la tabla
AssertionError: la pantalla de `/novedades` dispara una operación que `PRODUCTOR_POR_ACCION` no declara … así es
como una celda se degrada a `sinOperacion` con una excusa plausible mientras el botón vuelve a avisar
por toast, y nadie se entera.: expected [ Array(1) ] to deeply equal []
+   "rechazarNovedad (lo dispara app/(app)/novedades/_components/RechazarNovedadModal.tsx)",
 FAIL  … > y el importador es un archivo REAL, con la arista nombrada (anti-vacuidad)
-   "rechazarNovedad ← RechazarNovedadModal.tsx",
```

> **Con los tres frentes del spec y sin el cuarto, M2b habría SOBREVIVIDO.** Ése es el motivo por el
> que el frente 4 existe, y está medido, no supuesto.

### M3 — R28: el aviso pierde «y no se puede deshacer»

```
SHA ANTES:   389c5a1bc644aecbd953ae6799771c77db0f80f5bd6e54975f0ccc318ba97518
SHA MUTADO:  29191614dfe31e4c2ed2a4ad535d49644bb452cb204843e68149eb1266d56d23
SHA DESPUES: 389c5a1bc644aecbd953ae6799771c77db0f80f5bd6e54975f0ccc318ba97518
```

`Tests 3 failed | 15 passed (18)`:

```
 FAIL  RechazarNovedad.test.tsx > el aviso está en el árbol nada más abrir, con su literal
 FAIL  RechazarNovedad.test.tsx > y dice EL FLETE DE DEVOLUCIÓN, no el cobro de bodega por rechazo
 FAIL  RechazarNovedad.test.tsx > el aviso NO desaparece al escribir el motivo: es fijo, no una advertencia de error
```

### M4 — R29: el bloqueo se queda sin texto (sólo el `disabled`)

```
SHA ANTES:   389c5a1bc644aecbd953ae6799771c77db0f80f5bd6e54975f0ccc318ba97518
SHA MUTADO:  9fd83c19f28811b9ff59fbaa17aa2a4829a59118a34c992a8de728a8cea89818
SHA DESPUES: 389c5a1bc644aecbd953ae6799771c77db0f80f5bd6e54975f0ccc318ba97518
```

`Tests 2 failed | 16 passed (18)`:

```
 FAIL  RechazarNovedad.test.tsx > con el campo vacío hay un TEXTO que explica el bloqueo
 FAIL  RechazarNovedad.test.tsx > un motivo de sólo ESPACIOS no cuenta como motivo
```

### M5 — 💰 R30: el `ok` deja de sacar la fila de la lista

```
SHA ANTES:   4c02cdfae2ba73d2060173bbaab8604706d3a3527c86508a6170d1d974fb1a36
SHA MUTADO:  c806675f96384db833a3f330d2a6db0c67be56d11d124def3ad7a205d3930649
SHA DESPUES: 4c02cdfae2ba73d2060173bbaab8604706d3a3527c86508a6170d1d974fb1a36
```

`Tests 1 failed | 17 passed (18)`:

```
 FAIL  RechazarNovedad.test.tsx > avisa a dónde va el paquete, la fila sale y el total baja
```

### M6 — 💰 R31: la carrera perdida se celebra como un éxito

`toast.warning(RECHAZO_CONFLICTO)` → `toast.success(RECHAZO_EXITO)`. Es el defecto que 236/D8 midió
sobre esta misma card, con dinero detrás esta vez.

```
SHA ANTES:   4c02cdfae2ba73d2060173bbaab8604706d3a3527c86508a6170d1d974fb1a36
SHA MUTADO:  7bc675522f125809de9a5a854e8c9ebc53d8260bb3a9b4ee16bb8f54c01571ee
SHA DESPUES: 4c02cdfae2ba73d2060173bbaab8604706d3a3527c86508a6170d1d974fb1a36
```

`Tests 2 failed | 16 passed (18)`:

```
 FAIL  RechazarNovedad.test.tsx > dice qué ocurrió, no lo celebra, y RELEE la página
 FAIL  RechazarNovedad.test.tsx > el texto es el de la PANTALLA, no la cadena técnica que devuelve el servicio
```

### M7 — R36: reponer el botón «Notas» en la devolución

```
SHA ANTES:   fb2b6d6f6fc39cb2ef9d37874b0d5770620b70f14b192c4a099cde0d7b3fbb8a
SHA MUTADO:  efb116cbef86c2e00561a39312ead16a3a8cc8281da2f994dc61e515a1a30e77
SHA DESPUES: fb2b6d6f6fc39cb2ef9d37874b0d5770620b70f14b192c4a099cde0d7b3fbb8a
```

`Tests 5 failed | 23 passed (28)`, incluidos:

```
 FAIL  novedad-acciones-catalogo.test.ts > 240/R36: el botón «Notas» NO vuelve a las cards de devolución
 FAIL  novedad-acciones-catalogo.test.ts > R27: la conversación existe, y sólo en el grupo de ayuda
 FAIL  NovedadAcciones.test.tsx > 240/R33: la fila de DEVOLUCIÓN ofrece exactamente cuatro controles, sin «Habilitar»
```

### M8 — R40: el detector de la guardia deja de distinguir un `import type`

**⚠️ Esta mutación SOBREVIVIÓ la primera vez, y encontró un caso VACUO en mi propia guardia.** El
fuente sintético `SOLO_EL_TIPO` importaba `RechazarNovedadActionResult` y la aserción preguntaba por
`rechazarNovedad`: daba `false` **por el nombre**, no por el `import type`. Salida real de esa
corrida: `Tests 14 passed (14)` — verde con el detector roto.

Se corrigió el fuente sintético (ahora importa **el mismo símbolo** en sus dos formas de tipo) y se
añadió el caso del `type` en línea. Re-corrida:

```
SHA ANTES:   99554af9797ad834ef7f7a46980f8efddec07b6bf100a4713bc58a11f866b475
SHA MUTADO:  dec2ba14368781445818efaaee6848226d7d0e7446d3b52d2747686288dc79a3
SHA DESPUES: 99554af9797ad834ef7f7a46980f8efddec07b6bf100a4713bc58a11f866b475
      Tests  1 failed | 14 passed (15)
 FAIL  … > AUTOCOMPROBACIÓN: un `import type` NO cuenta como cableado
AssertionError: expected true to be false // Object.is equality
```

### M9 — R40: el filtro del `type` EN LÍNEA

**También sobrevivió la primera vez, y por una razón distinta: era un mutante EQUIVALENTE.** Con el
filtro fuera, el símbolo queda como `"type rechazarNovedad"`, que tampoco coincide con el nombre
desnudo en el `includes`, así que `importaElSimbolo` daba lo mismo. Salida real: `Tests 15 passed
(15)`.

Se hizo observable escribiendo **el contrato de `aristasDeImport`** (`simbolos` son los que viajan
como VALOR, ni uno más). Re-corrida:

```
SHA ANTES:   3a3784ac27c2403ab98c5f5589f179f226fdf58459cf8f955c7e9e9b0c261516
SHA MUTADO:  c8e5600bd9da05be200e5b776c527a3744d012158986a0fe973c6ad37c35f697
SHA DESPUES: 3a3784ac27c2403ab98c5f5589f179f226fdf58459cf8f955c7e9e9b0c261516
      Tests  1 failed | 14 passed (15)
 FAIL  … > AUTOCOMPROBACIÓN: el `type` EN LÍNEA, dentro de unas llaves mixtas, tampoco cablea
AssertionError: expected [ 'type rechazarNovedad', …(1) ] to deeply equal [ 'reprogramarNovedad' ]
```

> **Resumen honesto: 9 mutaciones, 9 muertas — pero DOS de ellas sólo tras arreglar el test que las
> dejaba pasar.** Si se hubieran dado por muertas sin correrlas, esta guardia habría nacido con dos
> aserciones que no medían nada, que es exactamente el fallo del que ella misma avisa en su cabecera.

**R37, comprobado a mano una vez** (no es mutación de archivo, es del typecheck): añadir un valor a
la unión `AccionNovedad` sin su entrada en `PRODUCTOR_POR_ACCION` rompe el `satisfies Record<…>`.
Es el mismo mecanismo, palabra por palabra, con el que la 236 hizo imposible añadir un grupo sin su
juego de botones (`ACCIONES_POR_GRUPO`), y su otra mitad —el conjunto de claves— está además
afirmada en ejecución por la anti-vacuidad de la guardia, por si alguien lo silenciara con un `as`.

---

## 5. Salidas reales

### `tsc --noEmit`

```
$ pnpm exec tsc --noEmit -p tsconfig.json
(sin salida — 0 errores)
```

### `eslint` sobre los 9 archivos tocados

```
$ pnpm exec eslint app/(app)/novedades/_components/{novedad-acciones-catalogo.ts,NovedadAcciones.tsx,NovedadesModule.tsx,RechazarNovedadModal.tsx} \
    tests/components/{RechazarNovedad,NovedadAcciones,NovedadesModule}.test.tsx \
    tests/unit/types/novedad-acciones-catalogo.test.ts \
    tests/unit/guards/novedad-acciones-sin-maqueta.guardia.test.ts
(sin salida — 0 errores, 0 warnings)
```

### Tests

```
$ pnpm exec vitest run tests/components
 Test Files  212 passed (212)
      Tests  2772 passed | 26 skipped (2798)

$ pnpm exec vitest run tests/unit
 Test Files  1 failed | 832 passed (833)
      Tests  1 failed | 11269 passed (11270)

$ pnpm run test:guardias                      # T7.5, primera corrida (12:27)
 Test Files  1 failed | 124 passed (125)
      Tests  1 failed | 1847 passed (1848)

$ pnpm run test:guardias                      # corrida final (12:41), con el rojo AJENO ya cerrado
 Test Files  125 passed (125)
      Tests  1850 passed (1850)
```

**Las guardias que el spec exige verdes (T7.5), comprobadas por nombre:** `superficie-de-uso` ✔ (18
tests, y ver §0) · `novedad-acciones-una-tabla` ✔ · **`novedad-acciones-sin-maqueta`** ✔ (15 tests,
la nueva) · `hilo-ventana-alcanzable` ✔ · `orden-nota-frontera` ✔ · `ordenes-columnas-money-safe` ✔ ·
`dinero-sin-centimos` ✔ · `anclaje-vs-intentos` ✔ · `deriva-primer-intento` ✔ ·
`aprobacion-escrituras-cubiertas` ✔ · las de transiciones exhaustivas ✔. **Todas dentro de la corrida
de arriba.**

---

## 6. Los rojos AJENOS que vi (ninguno se tocó)

> ⚠️ **El árbol se movió DEBAJO mientras trabajaba, y por eso esta sección lleva horas.** La 246
> está en vuelo en el mismo árbol; lo de abajo es lo que vi, con la hora, no un resumen.

| Rojo | ¿De quién? | Qué es | Estado al cerrar |
| --- | --- | --- | --- |
| `tests/unit/tablero-dia/asignado-at-solo-lectura.guardia.test.ts` → «la feature no añade ninguna migracion que toque la columna (R37/R59)» | **de la 246** | El censo esperaba 2 archivos y encontró 4: los dos de más son `20260820180000_orden_fecha_reparto/{migration,down}.sql`, que mencionan `asignado_at`. Esa carpeta **es de la 246** (`progress/impl_240.md` §0 lo dice: «la 246 ya había creado `db/migrations/20260820180000_orden_fecha_reparto/`») y está **sin trackear** en git. **No está en mi superficie y no la toqué.** | **Ya no está.** Apareció entre las **12:15** (125 guardias verdes) y las **12:24**, y a las **12:41** volvía a estar verde: su agente actualizó el censo del guardia. La migración **sigue** nombrando `asignado_at` (5 y 8 veces), así que lo que cambió fue el guardia, no la migración. |
| `tests/unit/guards/nota-privada-retirada.guardia.test.ts` | de la 246 (anunciado por el coordinador) | — | **No llegué a verlo rojo:** verde en todas mis corridas. |
| `tests/integration/repositories/deshacer-asignacion.trazabilidad-carga.test.ts` | de la 246 (anunciado por el coordinador) | — | **No lo ejercí:** `tests/integration` no entra en mi superficie y no se corrió aquí. |

**Corrida final, con el árbol como quedó:**

```
$ pnpm run test:guardias
 Test Files  125 passed (125)
      Tests  1850 passed (1850)
```

**Archivos que esta tanda tocó** (para que otra sesión lo compruebe de un vistazo):

```
app/(app)/novedades/_components/novedad-acciones-catalogo.ts
app/(app)/novedades/_components/NovedadAcciones.tsx
app/(app)/novedades/_components/NovedadesModule.tsx
app/(app)/novedades/_components/RechazarNovedadModal.tsx        (NUEVO)
tests/unit/types/novedad-acciones-catalogo.test.ts
tests/unit/guards/novedad-acciones-sin-maqueta.guardia.test.ts  (NUEVO)
tests/components/NovedadAcciones.test.tsx
tests/components/NovedadesModule.test.tsx
tests/components/RechazarNovedad.test.tsx                       (NUEVO)
```

**Cero archivos fuera de `app/(app)/novedades/` y de sus tests.** No se tocó `lib/`, ni `db/`, ni
`app/(app)/cierre-dia/`, ni nada de la superficie de la 246 (asignación, corte diario,
`MisAsignacionesService`, ranking, migraciones).

---

## 7. Lo que queda abierto — con su razón, no como olvido

1. **T8 (ver la app) sigue pendiente** y es del humano, que ya tiene el servidor de dev levantado en
   `localhost:3000` (no se levantó ni se mató desde aquí). El recorrido va a
   `progress/recorrido_240.md`. Lo que hay que mirar con los ojos y la suite no puede: que la card de
   «En devolución» **ya no tiene «Habilitar» ni «Conversación»**, que la pestaña «Ayuda solicitada»
   **sí sigue teniendo «Habilitar»**, y **los textos leídos tal cual**.
2. **T9 (cierre documental) es del leader**: `feature_list.json`, la auditoría y el design de la pila.
3. **T4.3 sigue sin hacer**, y el motivo está en §3: el archivo que el spec cita no cubre lo que el
   spec dice, y el archivo donde vive el badge está en la superficie de la 246.
4. **El importe del aviso queda CERRADO, no pendiente** (§9). Lo que sí queda abierto, y con dueño
   por decidir, es **traer el importe real por orden en `NovedadDTO`** desde la tarifa congelada:
   es otra ficha, con su firma. Mientras no exista, el aviso **no puede** llevar cifra.
5. **La migración de la 240 sigue sin aplicarse a ninguna base** (`progress/impl_240.md` §0). Nada de
   esta tanda cambia eso.

---

## 8. El importe del aviso: por qué NO lleva cifra (nota del coordinador, 2026-08-20)

Me frené porque **no podía verificar** el número en el árbol. El coordinador confirmó el aviso sin
cifra y añadió la razón de fondo, que es **más fuerte** y que ahora vive **junto a la constante**
(`RechazarNovedadModal.tsx`, JSDoc de `RECHAZO_AVISO`) y no sólo en esta bitácora — sin esa nota, el
próximo que la lea va a creer que falta y la va a «completar»:

- **₡2.600 y ₡2.200 son TOPES, no el precio.** Son el máximo de `valor_flete_devuelto` entre las
  tarifas activas y el máximo de su columna GAM, medidos el 2026-08-20 contra producción.
- **La tarifa varía por tienda**, así que cualquiera de los dos números sería **falso para casi
  todas**. Y en un aviso de dinero un número falso es peor que ninguno — que es, palabra por
  palabra, lo que D10 dice.
- **La que se cobra no es ni la vigente hoy**, sino la **congelada en `cierre_detail`** al aprobar el
  cierre que recoja la gestión. Un importe calculado en esta pantalla podría no ser el que se cobre.
- **Poner el importe real exigiría que `NovedadDTO` lo trajera por orden** desde esa tarifa
  congelada: **otro cambio, con su propia decisión**. No entra aquí de tapadillo.

**El texto del aviso NO cambió**, así que el literal escrito a mano en
`tests/components/RechazarNovedad.test.tsx` sigue siendo el mismo y **no se tocó ni una aserción**.
Lo único que entró es el comentario.

```
$ pnpm exec tsc --noEmit -p tsconfig.json
(sin salida — 0 errores)

$ pnpm exec eslint app/(app)/novedades/_components/RechazarNovedadModal.tsx
(sin salida — 0 errores, 0 warnings)

$ pnpm exec vitest run tests/components/RechazarNovedad.test.tsx     tests/unit/guards/novedad-acciones-una-tabla.guardia.test.ts     tests/unit/guards/novedad-acciones-sin-maqueta.guardia.test.ts     tests/unit/guards/superficie-de-uso.guardia.test.ts     tests/unit/guards/dinero-sin-centimos.guardia.test.ts
 Test Files  5 passed (5)
      Tests  78 passed (78)
```

> Se corrieron **las dos guardias que leen esta carpeta** y `dinero-sin-centimos` a propósito: la
> nota mete dos cifras en el fuente, y aunque van en un comentario —y las guardias de esta pantalla
> leen el código **sin comentarios**— eso hay que **comprobarlo**, no suponerlo.

---

## 9. Veredicto

**T5 y T6 completas y verdes**, con el punto 12 cerrado borrando una palabra, «Rechazar» cableado a
`rechazarNovedad` y **`superficie-de-uso` apagada por el cable y no por una anotación** (cero
`@sin-superficie` en el borde). La guardia anti-maqueta se puso **roja a mano en sus dos sabores** y
su detector se probó contra su propia mutación — dos de las nueve mutaciones sobrevivieron a la
primera y arreglarlas fue el trabajo, no la anécdota. **El árbol cierra con las 125 guardias verdes**
(1.850 tests), los 212 archivos de componentes verdes (2.772 tests) y el typecheck y el lint limpios.
El único rojo que vi en todo el rato fue de la **246**, en su migración, y su agente lo cerró.
