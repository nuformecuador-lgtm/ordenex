# Feature 281 — El panel maestro pinta una tarjeta de vacío de más

Requisitos en notación EARS. Cada `R<n>` es verificable. Feature `frontend`,
complejidad **baja**, `depends_on: null`. Rama `feature/281-maestro-tarjeta-vacio-de-mas`.

> **El pedido humano (2026-08-25), con captura de producción:** «Cuando no hay
> postulaciones, en el inicio del maestro aparecen **tres cards** de que no hay; allí
> está **sobrando una**, debemos eliminarla.» La sobrante es **la de arriba, la que NO
> lleva título de sección**.

---

## ⚠️ Lo primero: el diagnóstico de la ficha estaba incompleto, y ya cambió

La ficha `feature_list.json:281` dice que «leyendo el código salen DOS paneles, de ahí
no salen tres». **Eso es falso hoy en el árbol de trabajo de esta rama**, y este spec
lo corrige con el ancla:

`app/(app)/_components/AdminMaestroDashboard.tsx:36` monta un
**`<PostulacionesPendientesPanel />` suelto**, fuera de todo `ContenedorSeccion`, justo
**encima** de los dos bloques titulados:

```
:36   <PostulacionesPendientesPanel />                        ← SUELTO, sin título
:37   <ContenedorSeccion titulo="Postulaciones de mensajeros">
:38     <PostulacionesPendientesPanel />
:41   <ContenedorSeccion titulo="Vehículos y bodegas ofrecidos">
:42     <PostulacionRecursoPanel />
```

De ahí salen **tres** tarjetas de «no hay», y la de arriba es la que no tiene título:
coincide con la captura, con la posición y con el texto repetido que el humano vio.

**Lo que esto NO cierra, y por eso R1-R3 existen:** este hallazgo se hizo **leyendo el
árbol de trabajo**, no la app ni el blob commiteado. En este repo ya pasó que otra
sesión mutara o reseteara un árbol sin aviso, y una imposibilidad razonada leyendo
código quedó desmentida al medirla. Aquí hay además una señal contradictoria concreta,
sin resolver: `tests/components/AdminMaestroDashboard.test.tsx:120` afirma
`expect(listarMensajerosMock).toHaveBeenCalledTimes(1)` — con **dos** montajes del mismo
panel esa aserción debería ser sospechosa, y sin embargo nadie ha reportado esa suite
en rojo. O SWR deduplica por clave y la aserción es insensible al doble montaje (otro
fallo mudo), o la suite está roja y no se ha mirado, o la línea :36 no está en el blob
commiteado. **Las tres hipótesis se distinguen midiendo, no razonando.**

### Hechos VERIFICADOS contra el árbol de trabajo (2026-08-25)

Cada anclaje se comprobó abriendo el archivo.

| Hecho | Ancla |
| --- | --- |
| La pantalla es `/dashboard` y la sirve `AdminMaestroDashboard` para los roles `maestro` **y** `admin` | `app/(app)/dashboard/page.tsx:34-36` |
| El dashboard monta **tres** hijos: un panel suelto y dos `ContenedorSeccion` | `AdminMaestroDashboard.tsx:36-43` |
| `PostulacionesPendientesPanel` pinta **un solo** `EmptyState` con título «No hay postulaciones pendientes» cuando `items.length === 0` | `PostulacionesPendientesPanel.tsx:149-155` |
| Ese panel se envuelve en `<section aria-label="Postulaciones pendientes">` | `PostulacionesPendientesPanel.tsx:140` |
| `PostulacionRecursoPanel` pinta «No hay vehículos ni bodegas por revisar» y se envuelve en `<section aria-label="Vehículos y bodegas ofrecidos">` | `PostulacionRecursoPanel.tsx:150-159`, `:187-189` |
| `ContenedorSeccion` pinta **una** `Card` (`data-slot="card"`), **siempre** con `CardTitle` | `components/shared/ContenedorSeccion.tsx:76-89`, `components/ui/card.tsx:12` |
| `AppPage` sólo pinta `PageHeader` + `Container` con los hijos: no añade tarjetas | `components/shared/AppPage.tsx:34-39` |
| `EmptyState` es un `div` con `rounded-xl border border-dashed` cuando el consumidor le pasa esa clase — visualmente una tarjeta, pero **no** una `Card` | `components/shared/EmptyState.tsx:49-55`; clase en `PostulacionesPendientesPanel.tsx:154` |
| **Descartado (confirmado):** el panel de vehículos **no** es el duplicado; su texto es distinto | `PostulacionRecursoPanel.tsx:155` |

### Un dato lateral que orienta, pero que NO es medición

Las **16** copias del repo bajo `.claude/worktrees/*/app/(app)/_components/AdminMaestroDashboard.tsx`
tienen **una sola** aparición de `<PostulacionesPendientesPanel />`; el árbol principal
tiene **dos**. Ninguna de esas 16 copias contiene el párrafo del docblock fechado
«2026-08-20» que sí está en el árbol principal (`:14-15`, sobre la retirada del
encabezado «Entregas»). Eso **sugiere** que la línea suelta entró con ese cambio del
2026-08-20 y que las copias son anteriores. **Sugiere, no prueba**: los worktrees son
fotos de commits desconocidos y no se ha leído el historial. Lo prueba R2.

---

## Grupo A — El diagnóstico se mide antes de arreglar nada

**R1 — Nada se toca antes de contar las tarjetas en la app.** El sistema NO DEBE
modificar `AdminMaestroDashboard`, sus paneles ni ningún componente de esa pantalla
antes de que exista evidencia registrada, obtenida **ejecutando la aplicación**, de:
(a) **cuántas** tarjetas de «no hay» muestra `/dashboard` con las dos listas vacías,
(b) **qué texto** lleva cada una, (c) **cuál lleva título de sección y cuál no**, y
(d) **de qué componente sale cada una**. La evidencia DEBE ser texto citable —el
`innerText` de los elementos—, no una descripción de lo que se cree que pasa.

**R2 — La causa se confirma en el blob commiteado, no en el árbol de trabajo.** El
sistema NO DEBE sostener el arreglo sobre el contenido del directorio de trabajo. DEBE
quedar registrado que la línea sobrante existe en el **blob commiteado** de la rama base
(`git show <base>:<archivo>`), y DEBE quedar nombrado el commit que la introdujo. SI la
línea sólo existe sin commitear, ENTONCES no hay regresión que arreglar en la rama y el
hallazgo es una mutación local: se detiene y se vuelve a la puerta humana.

**R3 — Si la medida contradice al articulado, manda la medida.** SI la cuenta de R1
resulta distinta de tres tarjetas, o el origen de alguna difiere de lo anclado arriba,
ENTONCES el sistema NO DEBE «ajustar el código hasta que cuadre»: DEBE registrarse la
cuenta real, revisarse el Grupo B a la luz de ella y volverse a la puerta humana antes
de implementar. El requisito que manda es el **efecto observable** del Grupo B, no la
causa que la captura sugiere.

---

## Grupo B — El estado correcto de la pantalla vacía, dicho como número

**R4 — Exactamente un estado de vacío por sección real.** MIENTRAS no haya
postulaciones de mensajeros pendientes **ni** postulaciones de vehículo o bodega por
revisar, la pantalla `/dashboard` del maestro DEBE mostrar **exactamente DOS** estados
de vacío y no más: **exactamente uno** con el texto «No hay postulaciones pendientes» y
**exactamente uno** con el texto «No hay vehículos ni bodegas por revisar».

> Este es **el** requisito que hay que poder poner rojo. Hoy, en el árbol medido, el
> primer conteo vale **2** y debe valer **1**.

**R5 — Ninguna tarjeta huérfana: todo bloque cuelga de una sección con título.** El
sistema NO DEBE pintar en esa pantalla ningún panel de postulaciones fuera de un
contenedor de sección con título. CADA uno de los dos paneles DEBE tener como ancestro
una tarjeta que contenga su rótulo de sección —«Postulaciones de mensajeros» y
«Vehículos y bodegas ofrecidos», respectivamente—. Un panel cuyo ancestro de tarjeta no
exista, o exista sin título, es un incumplimiento.

**R6 — Cada panel se monta exactamente UNA vez, haya o no datos.** El sistema DEBE
montar `PostulacionesPendientesPanel` exactamente una vez y `PostulacionRecursoPanel`
exactamente una vez en esa pantalla. Verificable por el nombre accesible de sus
regiones: **exactamente una** región llamada «Postulaciones pendientes» y **exactamente
una** llamada «Vehículos y bodegas ofrecidos». Este requisito NO depende del estado de
las listas: vale con la pantalla vacía y con la pantalla llena.

> R6 es más fuerte que R4 a propósito. R4 mide el síntoma que el humano vio; R6 mide la
> causa estructural, que también daña el caso con datos (R8).

---

## Grupo C — Con datos, nada de esto se rompe

**R7 — Con postulaciones, el estado de vacío desaparece y la sección permanece.**
CUANDO la lista de postulaciones de mensajeros pendientes traiga al menos un elemento,
el sistema NO DEBE mostrar **ningún** estado de vacío de mensajeros —conteo **0** del
texto «No hay postulaciones pendientes»— y DEBE seguir mostrando el rótulo
«Postulaciones de mensajeros». Lo mismo, con sus textos, para el panel de vehículos y
bodegas.

**R8 — Con postulaciones, cada fila aparece una sola vez.** CUANDO la lista traiga
elementos, CADA postulación DEBE aparecer **exactamente una vez** en la pantalla. Una
fila repetida es el mismo defecto que R4 visto con datos, y es el motivo por el que
esta ficha no se cierra sólo con el caso vacío.

---

## Grupo D — Cómo se prueba (y cómo NO)

**R9 — El conteo DEBE ser exacto y bilateral, con control positivo visto en rojo.** La
verificación de R4, R6, R7 y R8 DEBE fallar **en los dos sentidos**: SI el elemento
contado aparece **de menos** (cero) o **de más** (dos o más), ENTONCES la verificación
DEBE ponerse roja. NO DEBE admitirse una aserción que pase con un conteo distinto del
esperado —`queryAllByText(...)` sin comparar longitud, `expect(...).toBeTruthy()`,
`length >= 1` o similares—. Y ninguna de estas verificaciones DEBE darse por buena sin
haberla visto **en rojo** ante una mutación concreta y anotada; la mutación obligatoria
es **restaurar el montaje sobrante** y comprobar que el conteo de R4 y el de R6 se
ponen rojos.

> Es la lección propia del repo: una aserción que compara contra su propia fuente, o que
> no comprueba la cardinalidad, está siempre verde. Un test que no se vio morder no es
> evidencia.

**R10 — El número de llamadas a la Server Action NO es la prueba principal.** El
sistema NO DEBE sostener R6 sobre `expect(listarPostulacionesPendientes).toHaveBeenCalledTimes(1)`
(`tests/components/AdminMaestroDashboard.test.tsx:120`). Esa aserción atraviesa la caché
y la deduplicación de SWR, que no están bajo control de esta feature. DEBE **medirse y
escribirse** si hoy, con el montaje duplicado presente, esa aserción está verde o roja;
SI está verde con dos montajes, ENTONCES eso DEBE quedar declarado como límite conocido
de esa aserción, y la prueba de R6 DEBE apoyarse en el conteo de regiones del DOM.

---

## Grupo E — Frontera de la feature

**R11 — Sin backend, sin datos, sin contratos.** El sistema NO DEBE cambiar esquema,
migraciones, RLS, consultas, servicios, repositorios, Server Actions, rutas ni contratos
de entrada/salida. SI al reproducir se descubre que el arreglo exige tocar el backend,
ENTONCES la implementación se detiene y vuelve a la puerta humana (ver «Preguntas
abiertas»).

**R12 — Se arregla lo evidenciado; no se rediseña el panel.** El sistema NO DEBE
cambiar los textos visibles, los títulos de sección, el orden de las secciones, los
iconos, ni la jerarquía visual de la pantalla. SI el arreglo obligara a mover o
reescribir alguno de ellos, ENTONCES DEBE decirse explícitamente en `design.md` con su
motivo, antes de hacerlo.

**R13 — El resto de la pantalla queda intacto y sus tests siguen verdes sin tocarlos.**
El sistema DEBE conservar el título «Panel maestro», la descripción vigente
(«Postulaciones pendientes: mensajeros, y vehículos o bodegas ofrecidos desde la web»)
y los dos rótulos de sección. Los casos existentes de
`tests/components/AdminMaestroDashboard.test.tsx` DEBEN quedar verdes **sin que se
relajen ni se borren sus aserciones**; se permite **añadir** casos y —sólo si R10 lo
obliga— **reexpresar** la aserción de `toHaveBeenCalledTimes` documentando por qué,
nunca debilitarla en silencio.

---

## Trazabilidad R → test

El mapa propuesto está en `tasks.md § Mapa R → verificación`. Se cierra con rutas y
nombres reales en `progress/impl_281.md`. Ningún requisito puede quedar sin dueño.

---

## Preguntas abiertas

**Q1 — ¿La línea sobrante está commiteada en `dev` y en `prod`?** No se ha leído el
historial (este autor no dispone de ejecución de comandos). La captura del humano es de
**producción**, lo que apunta a que sí; pero eso hay que confirmarlo con
`git show` / `git log -L` y no suponerlo. **La resuelve R2 dentro de T1**, no bloquea la
aprobación del spec. SI resultara que la línea no está commiteada, esta ficha cambia de
naturaleza (sería una mutación local ajena) y hay que volver a la puerta.

**Q2 — ¿La suite de `AdminMaestroDashboard` está verde hoy?** Sin ejecución no se puede
afirmar. Es el segundo hallazgo posible de esta ficha: si `toHaveBeenCalledTimes(1)`
pasa con dos montajes, hay una aserción insensible —un fallo mudo más de la familia que
ya tiene cinco fichas en este repo—. **Se mide en T2** y su resultado decide si R10
obliga a reexpresar esa línea. **No inventar el resultado.**

**Q3 — ¿La cuenta correcta es DOS tarjetas, o el humano quiere otra cosa?** El
articulado fija **dos** (una por sección real), que es lo que se deduce de «sobra una»
sobre tres. Queda por confirmar en la puerta humana que la solución querida es
**eliminar** la tarjeta suelta y no **darle un título** convirtiéndola en una tercera
sección: el humano dijo «debemos eliminarla», así que el spec asume eliminar, pero la
alternativa está descartada por escrito en `design.md §5.A` para que se pueda revertir
la decisión con una frase.

**Q4 — Reproducción: ¿contra qué base y con qué cuenta?** El spec propone base **local**
y la cuenta `admin.qa@ordenex.test` (login por email+contraseña, sin OTP; `/dashboard`
sirve igual a `maestro` y a `admin`, `ROLES_ACCESO_TOTAL` en `lib/auth/acceso-total.ts:5`).
**No está verificado** que la base local tenga hoy cero postulaciones pendientes de
ambos tipos; si tuviera, hay que dejarla en cero para reproducir el caso vacío, y **cómo
dejarla en cero no está decidido**. Hace falta el visto bueno del humano sobre: (a) usar
`admin` en lugar de `maestro` para la reproducción, y (b) si se autoriza rotar la
contraseña QA local con `scripts/seed-usuarios-qa.ts` —que **rota las cuatro cuentas QA
a la vez** y puede tumbar el login de otro agente en paralelo—.

**Q5 — ¿Se pide comprobación en producción después de desplegar?** Esta ficha no propone
tocar producción ni leerla. Si el humano quiere la confirmación post-despliegue —volver
a `/dashboard` en prod y contar dos tarjetas—, es una tarea del cierre, no del
desarrollo, y hay que decirlo.
