# Feature 288 — Requisitos derogados por el paso a Sheet y la lista permanente

> Encargo humano posterior a la aprobacion del PR #518: mover el formulario de plantillas de
> `Modal` a `Sheet`, subir la vista previa por encima del selector y **dejar la lista de
> campos siempre visible**. Esa ultima decision toca requisitos ya aprobados. Aqui queda por
> escrito **que** se deroga, **por que**, y —lo importante— **que NO se deroga aunque lo
> parezca**. Para llevar al PR y a `tasks.md`.

## Resumen para el PR

| Requisito | Veredicto | Por que |
| --- | --- | --- |
| **R8** | **Derogado a medias** | Sobrevive «vaciar el filtro»; muere «cerrar la lista». |
| **R29** | **Vigente, con el «cerrar» reubicado** | Bajar/subir/confirmar siguen en el picker; cerrar pasa al Sheet. |
| **R30** | **Vigente y cumplido entero** | Nunca exigio `combobox`. Lo cumple un listbox persistente. |
| **R6** | **Vigente, intacto** | El aviso de «sin resultados» no depende de que la lista se abra. |
| `design.md` 5.1 (combobox) | **Derogado** | Es prescripcion de diseno, no requisito. |
| `design.md` 5.2 (panel debajo) | **Derogado** | El panel sube por encima del selector. |

## 1. R8 — derogado a medias, y solo la mitad que sobra

Texto vigente: «CUANDO el maestro selecciona una opcion, el sistema DEBE **vaciar el filtro**
y **cerrar la lista**, de modo que la siguiente busqueda parta de cero.»

- **Sobrevive**: vaciar el filtro y devolver la lista al catalogo completo. Esa es la
  *intencion declarada* del propio requisito —«que la siguiente busqueda parta de cero»— y se
  sigue cumpliendo al pie de la letra.
- **Se deroga**: «cerrar la lista». Con la lista permanente no hay nada que cerrar.

El test de R8 **se reescribio**, no se borro: ahora afirma que tras elegir el filtro queda
vacio y la lista vuelve a mostrar el catalogo entero. Se retiro el
`expect(aria-expanded).toBe("false")`, que a partir de ahora seria una afirmacion falsa.

## 2. R29 — vigente; el «cerrar» ya no lo sirve el picker

Texto: «...recorrer las opciones filtradas y seleccionar una usando solo el teclado (bajar,
subir, confirmar y **cerrar**), sin necesidad de puntero.»

Bajar, subir y confirmar siguen en el picker sin cambios. **Cerrar** pasa a significar cerrar
el **Sheet**, que es lo unico que queda por cerrar en pantalla — y sigue siendo alcanzable con
`Escape`, solo teclado, que es lo que el requisito protege.

Consecuencia de implementacion, deliberada: **el picker deja de capturar `Escape`** y ya no
llama a `preventDefault`, para que el evento burbujee hasta el Sheet. Si lo siguiera
capturando, el maestro quedaria atrapado: `Escape` no cerraria nada. El test de `Escape` cierra
la lista se sustituyo por uno que afirma que el picker **no** lo consume
(`defaultPrevented === false`).

## 3. R30 — NO se deroga: nunca pidio un combobox

Texto: «El campo de busqueda de variables DEBE tener un **nombre accesible estable** y la
**lista DEBE anunciarse como tal**, indicando **que opcion esta activa** en cada momento.»

Las tres exigencias se siguen cumpliendo, y enteras:
- nombre accesible estable: `<span>` visible «Campo a insertar» + `aria-labelledby` (sin
  `aria-label`: en este repo el texto visible gana);
- la lista se anuncia como lista: `role="listbox"` + `role="option"`;
- opcion activa indicada: `aria-activedescendant` + `aria-selected`.

Lo unico que cambia es el rol del input: de `role="combobox"` a textbox normal. **Eso lo pedia
`design.md` 5.1, no R30.**

CORRECCION (revision 2, menor m1): la primera version de esta seccion justificaba el cambio
diciendo que mantener `aria-expanded` seria «ARIA que miente». **No es exacto, y conviene no
dejarlo escrito asi.** Un combobox permanentemente desplegado declara `aria-expanded="true"`
de forma perfectamente VERAZ; el patron existe y es legitimo. La eleccion real era entre dos
opciones validas —listbox filtrable persistente contra combobox siempre expandido— y se
tomo la primera por ser la mas simple de las dos para una lista que nunca se colapsa.

La derogacion se sostiene igual, pero por la OTRA razon, que es la solida: `role="combobox"`
lo prescribia `design.md` 5.1, que es diseno, no un requisito. R30 nunca lo pidio.

El test pasa de `getByRole("combobox", { name: /campo/i })` a
`getByRole("textbox", { name: /campo/i })`.

## 4. R6 — intacto

«Sin resultados» no dependia de que la lista se abriera o cerrara: sigue mostrandose cuando el
filtro no deja opciones, y se sigue sin ofrecer insercion. Sin cambios.

## 5. Derogaciones de `design.md` (diseno, no requisitos)

- **5.1 — patron combobox a mano.** Derogado el rol y `aria-expanded` (ver punto 3). Sigue
  vigente todo lo demas: escrito a mano sin `cmdk`/`popover`, filtro por nombre+descripcion+
  clave sin acentos ni mayusculas, distintivo de `sensible`, alias fuera del selector.
- **5.1 — lista flotante.** El `<ul>` deja de ser `absolute` y pasa a ser un bloque en el flujo
  con **scroll propio** (`overflow-y-auto` + alto maximo), para que recorrer 39 campos no
  arrastre el scroll del Sheet entero.
- **5.2 — el panel iba DEBAJO del selector.** Ahora va **encima**. El croquis de 5.2 queda
  obsoleto en el orden, no en el contenido. **No cambia** como se calcula: sigue por
  `previewAction` con debounce de 300 ms y descarte de respuestas fuera de orden, y sigue
  siendo el mismo motor que el envio (R11 intacto).
- **5.2/5.6 — el panel era un `<pre>`.** Pasa a `<textarea readOnly>`. R18 sigue protegido: es
  de **solo lectura**, con `tabIndex={-1}` y `aria-readonly`, para que no haya dos sitios donde
  parezca que se escribe. La unica fuente de verdad sigue siendo el `<textarea>` del cuerpo.

## 6. Lo que NO cambia (para que el reviewer no lo busque)

R1–R5, R7, R9–R28 siguen exactamente igual. En particular:
- **R7** (insertar `{{clave}}` en el cursor y dejar el caret detras) intacto.
- **R11** (la preview sale del motor de produccion) intacto.
- **R18** (el cuerpo persistido es `{{clave}}`) intacto y **mejor protegido**: el segundo
  textarea es de solo lectura por construccion.
- **R15/R16** (avisos que avisan y no bloquean) intactos.

## 7. Nada de esto contradice el spec de forma irreconciliable

Se comprobo requisito por requisito antes de tocar codigo (regla 6 de CLAUDE.md): **ninguna
derogacion obliga a romper un requisito**, solo a cambiar el patron de UI con el que se
cumplia. El unico texto de requisito que queda parcialmente sin efecto es la clausula «y
cerrar la lista» de R8. Recomendacion para `tasks.md`/`requirements.md`: reescribir R8 como
«DEBE vaciar el filtro y devolver la lista al catalogo completo», y anotar en R29 que el
«cerrar» lo sirve el contenedor.

---

## 8. Anadido humano 2026-08-27: fuera el alert de «cuerpo a medias»

La rama `validation_error` de `previewAction` pintaba
«Corrige el cuerpo antes de ver la vista previa.» como `role="alert"`. **Se retira.**

Motivo: un cuerpo a medio escribir es el estado **normal** de alguien tecleando —el panel se
recalcula cada 300 ms mientras se escribe—, no un error que haya que reganarle. Con el alert,
teclear `Hola {{` hacia parpadear un mensaje rojo en cada pausa.

Conducta nueva:
- `validation_error` ⇒ el panel se queda **vacio**, con `placeholder="Hola..."`. Sin `alert`.
- El `<textarea>` de vista previa **se renderiza siempre**, tambien con `preview === null`.
  Antes estaba condicionado a `preview !== null`; ese condicional desaparece. Sigue siendo
  `readOnly` y conserva `data-testid="plantilla-preview"`.
- **Se conserva** la otra rama: «No se pudo generar la vista previa.» sigue siendo un `alert`.
  Ahi la accion revento de verdad y el maestro necesita enterarse; no es lo mismo que un
  cuerpo a medias.

Impacto en tests (reescritos, no borrados):
- El assert `queryByTestId("plantilla-preview")).toBeNull()` del test de «respuesta en vuelo»
  ya no puede ser cierto: el panel existe siempre. Pasa a afirmar que sigue **vacio**
  (`toHaveValue("")`) y que **no** muestra el texto de la respuesta descartada.
- `it("cuerpo a medias: sin alert, el panel queda vacio con su placeholder")` — nuevo: panel
  vacio, `placeholder="Hola..."` presente y **cero** `role="alert"`.
- `it("un fallo real de la accion SI avisa, y ese alert se conserva")` — nuevo: guarda la rama
  de error que NO se deroga, para que nadie la retire por simetria con la otra.

Ningun requisito del `requirements.md` cae por esto: el mensaje de validacion era una decision
de presentacion de `design.md 5.2`, no un requisito EARS. R24 (la unica puerta que rechaza es
`validarCuerpo`, en el guardado) sigue intacto: esto es la vista previa, no el guardado.

---

## 9. Anadido humano 2026-08-27 (b): 25 campos ocultos + 3 borrados

Dos operaciones DISTINTAS sobre el catalogo, deliberadamente asimetricas.

### 9.1 Ocultar 25 — eje nuevo `ocultoEnSelector`

Campo nuevo en `CampoPlantilla`, al estilo de `aliasDe`: **declarativo y descriptivo, no
decisorio**. La lista de las 25 claves vive en UN solo sitio,
`CLAVES_OCULTAS_EN_SELECTOR`, y `CAMPOS_PLANTILLA` la aplica al construirse.

Se anade tambien `CAMPOS_PLANTILLA_OFRECIDOS` (= sin alias y sin ocultos). El picker lo
**consume** en vez de reimplementar el predicado, para que UI y tests afirmen sobre la misma
lista.

Los 25 **siguen en el catalogo y siguen resolviendo**: misma `leer`/`transform`, misma vista
previa, y `clavesSinCampo` sigue sin marcarlos. Ningun requisito cae: R9 sigue vigente (ver
9.3), y ocultar es presentacion pura.

Guardia: `tests/unit/plantillas/campos-ocultos-siguen-resolviendo.test.ts` (78 asserts).
**Verificado de verdad**, no por lectura: borrando `provincia` del catalogo el archivo cae con
**6 fallos**. Ese es el punto del archivo — impedir que alguien «simplifique» esto borrando los
25 y rompa plantillas ya aprobadas por Meta.

### 9.2 Borrar 3 — `telefono`, `direccion`, `direccion_completa`

Fuera del catalogo, entradas enteras. Se pudo porque **ninguna de las 7 plantillas vivas las
usaba** (comprobado contra la base por el coordinador; las claves en uso son `cliente`, `guia`,
`mensajero`, `producto`, `sinpe`, `sinpe_nombre`, `total`). Esa garantia es la que los 25 no
tenian, y es toda la diferencia.

Consecuencia asumida y **bajo test**: `{{telefono}}` ahora resuelve VACIO y `clavesSinCampo` lo
denuncia como clave invalida. Correcto: ya no es un campo.

El mismo archivo de test contrasta los dos casos en un `it` unico
(`{{telefono}} frente a {{provincia}}: borrada avisa, oculta no`), que documenta la asimetria
mejor que cualquier comentario.

### 9.3 Efecto colateral real: R9 se queda sin ejemplar ofrecido

`notas` era el **unico** campo `sensible` que el selector ofrecia, y esta entre los 25 ocultos.
Hoy **ningun campo ofrecido es sensible**, asi que el distintivo no es alcanzable con el
catalogo por defecto.

R9 es condicional («DONDE una opcion este marcada como sensible...»), asi que no se incumple:
queda vacuo en la UI. El **camino de codigo sigue vivo** y sigue importando, asi que su test se
conserva **inyectando** las entradas reales (`notas` y `cliente`, que siguen en el catalogo) por
la prop `campos` del picker — en vez de borrar el test o fabricar un campo de mentira. Queda
comentado en el propio test.

### 9.4 Cuentas finales, medidas

| | Antes | Despues |
| --- | --- | --- |
| Entradas del catalogo | 45 | **42** (37 propias + 5 alias) |
| Ofrecidas en el selector | 15 | **12** |
| Ocultas (`ocultoEnSelector`) | 0 | **25** |
| Alias huerfanos | 0 | **0** (confirmado por assert) |

Las 12 ofrecidas: `guia`, `remision`, `url_guia`, `cliente`, `producto`, `peso`, `tienda`,
`monto`, `mensajero`, `mensajero_nombre`, `sinpe`, `sinpe_nombre`.

**Nota de conteo:** el spec de la 282 decia «44 entradas, 39 propias». Ya estaba anotado en
`tests/unit/types/plantilla-datos.test.ts` que era un error de conteo del spec (eran 45/40), y
lo he vuelto a medir. Por eso el selector quedo en 15 tras ocultar los 25 (40-25), no en 14; y
en **12** tras borrar los 3.
