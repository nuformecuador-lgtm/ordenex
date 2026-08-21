# impl 237 — FRONTEND (T7): la pantalla con la que la tienda resuelve desde la ayuda

Rama `feature/237-gestion-tienda-ayuda`. **Sin commit.** Encima del backend ya presente en el árbol
(su bitácora: `progress/impl_237.md`, que **no se tocó**).

Spec: `specs/237-gestion-tienda-ayuda/{requirements,design,tasks}.md` — tanda **T7**.

---

## ✅ LO PRIMERO: LA ANOTACIÓN `@sin-superficie` SE RETIRÓ

**`lib/actions/gestion-desde-ayuda.ts` ya NO lleva la anotación.** Comprobado por conteo sobre el
archivo, no de memoria:

```
$ grep -c "@sin-superficie" lib/actions/gestion-desde-ayuda.ts
0
```

En su lugar queda escrito **qué la sustituyó y por qué existió**, que es la regla del repo para un
comentario que deja de ser cierto (no se borra, se cuenta):

> `SUPERFICIE (T7, 2026-08-20): la dispara GestionarDesdeAyudaModal, que monta NovedadesModule desde`
> `la pestaña «Ayuda solicitada» de /novedades. Aqui vivio la anotacion de excepcion de superficie`
> `mientras el backend aterrizaba un commit antes que su pantalla […]`

⚠️ **El texto del comentario NO escribe el token literal** (dice «la anotacion de excepcion de
superficie»). Es deliberado: el detector de la guardia es una expresión regular
(`/@sin-superficie[ \t]+(\S[^\n]*)/`) y un token dentro de una narración histórica es exactamente el
tipo de cosa que la haría leer una excepción que ya no existe.

**Y la retirada está respaldada por una arista de import real, no por buena voluntad.** Se comprobó
con una mutación (M1b, abajo): quitando el `import { gestionarDesdeAyuda }` del modal, la guardia se
pone **roja** nombrando la acción. Con el cableado puesto está **verde**.

---

## Lo que se montó, por task

### T7.1 · Dos celdas en `ACCIONES_POR_GRUPO`, con claves propias

`app/(app)/novedades/_components/novedad-acciones-catalogo.ts`

- La unión `AccionNovedad` gana `reprogramarDesdeAyuda` y `rechazarDesdeAyuda`. **Claves propias, no
  las de `devolucion`** (design §12.1, alternativa E descartada): reutilizar `reprogramar`/`rechazar`
  obligaría a `NovedadAcciones` a ramificar **por grupo** para elegir servicio, que es la decisión
  fuera de la tabla que R18/R19 de la 236 prohíben y que su guardia caza.
- El grupo `ayuda` pasa de 4 a **6** acciones, en el orden del spec:
  `contacto · reprogramarDesdeAyuda · rechazarDesdeAyuda · habilitar · conversacion · intentoContacto`.
- **El comentario «`reprogramar` y `rechazar` NO están en `ayuda`… Gestionar DESDE ayuda es la ficha
  237» se REESCRIBIÓ, no se borró** (T10.3, tercer punto — el que el backend dejó pendiente): queda
  qué decía, qué cambió y por qué su motivo **sigue siendo cierto de las acciones de la devolución**.

### T7.2 · La ventana `GestionarDesdeAyudaModal`

`app/(app)/novedades/_components/GestionarDesdeAyudaModal.tsx` (NUEVO)

- **Un componente con `modo: "reprogramar" | "rechazar"`**, no dos: la única diferencia es el campo
  de fecha y los rótulos; dos archivos serían dos copias del bloque de evidencias.
- **El aviso fijo de D7 arriba y siempre visible** (`role="note"`, nunca un tooltip): dice las tres
  consecuencias —el cierre del mensajero, el intento y el dinero— y por qué se piden foto y motivo.
- **D2: la foto es obligatoria en LOS DOS desenlaces.** Una sola condición, sin excepción por modo.
- Fecha sólo al reprogramar, con `min = mañana en el calendario de Costa Rica`
  (`mananaCalendarioCR`, el mismo helper del panel del mensajero, con su off-by-one ya resuelto).
- `confirmDisabled` **y el motivo del bloqueo con palabras** («Falta completar: …»).
- `closeOnConfirm={false}`: un `validation_error` del servidor se pinta por campo **sin perder lo
  capturado** (las fotos costaría volver a elegirlas una a una).
- Valida en cliente con **el mismo `gestionarDesdeAyudaSchema`** que el borde revalida, y envía
  `FormData` con **N valores de la clave `evidencia`** (`append`, no `set`).

### T7.3 · Cableado en `NovedadesModule`

- Estado **único** `ordenAGestionarDesdeAyuda: { orden, modo } | null` (no dos estados: las dos
  acciones abren la misma ventana y no pueden estar abiertas a la vez).
- Montaje condicional con `key={orden.id}`, mismo patrón que los tres modales que ya vivían ahí.
- `NovedadAcciones` gana **un** handler `onGestionarDesdeAyuda(novedad, modo)`, no dos props.

### T7.4 · La carrera, dicha en pantalla (R25)

- `ok` → `toast.success` con el texto de D7 («La orden quedó reprogramada/rechazada.») **y relectura
  de la página por Server Action**: la fila sale y el total baja **por el dato**.
- `conflict` → `toast.warning` **con el texto que redacta el SERVIDOR** (no se reescribe aquí:
  `MENSAJES_GESTION_DESDE_AYUDA.fueraDeAyuda`) **y también se recarga**.
- `forbidden` / `unauthenticated` → `toast.error` opaco, **sin recargar** (no se movió nada).

---

## ⚠️ LO QUE NO PUDE CERRAR, Y POR QUÉ — R41 (D6)

**R41 no está implementado, y no es un olvido: no cabe en la capa de presentación.**

D6 pide que la fila del detalle del «Cierre del día» del mensajero **diga que la gestionó la
tienda**. Ese dato **no llega a la pantalla**, y se comprobó capa por capa en el árbol:

| Capa | Archivo | ¿Trae el origen de la gestión? |
| --- | --- | --- |
| Proyección Prisma | `lib/repositories/CierreDiaRepository.ts:124` (`WITH_DETALLE`) | **No.** No selecciona `historialEstados` |
| Fila de dominio | `lib/interfaces/repositories/ICierreDiaRepository.ts:20` (`CierreGestionPendienteRow`) | **No** |
| DTO del servicio | `lib/interfaces/services/ICierreDiaService.ts` (`CierreDetalleGestion`) | **No** |
| Pantalla | `app/(app)/cierre-dia/_components/CierreDiaModule.tsx` | no puede pintar lo que no recibe |

El backend **sí** añadió `desdeAyudaTienda`, pero **sólo** en `findGestionParaDeshacer`
(`CierreDiaRepository.ts:768`), que es el camino de **D3/R38** (impedir el deshacer). Ese campo no
alcanza la lista del cierre del día.

**Lo que hace falta y es de backend:** `WITH_DETALLE` + `toPendienteRow` + `CierreGestionPendienteRow`
+ `CierreDetalleGestion`, con el mismo `some` sobre el historial repitiendo el `ordenId` que ya usa
`findGestionParaDeshacer` (design §2.3). **En cuanto el DTO traiga la bandera, la mitad de pantalla
son diez líneas y su test.** No lo hice porque mi alcance es la capa de presentación y tocar la
cadena del DTO del cierre es backend: **paro y lo reporto**, como se me pidió.

R40 **sí** está cubierto (ver abajo): sale gratis del servidor.

---

## Mapa `R<n>` → test

> Todos los archivos citados se comprobaron con `test -f`, uno a uno. Ninguna cita a ciegas.

| Req | Dónde se prueba |
| --- | --- |
| **R1** (mitad de pantalla) | `tests/unit/types/novedad-acciones-catalogo.test.ts` («237/R1: la ayuda ofrece SUS dos desenlaces, y con claves propias» · «y NINGÚN desenlace más nace de la ayuda», censo por sufijo) · `tests/components/NovedadAcciones.test.tsx` (censo cerrado de siete controles de la fila de ayuda) |
| **R12** (superficie) | `tests/components/GestionarDesdeAyudaModal.test.tsx` («con el formulario vacío el confirmar está bloqueado y enumera lo que falta» · «con foto pero sin motivo sigue bloqueado» · «un motivo de sólo espacios NO cuenta») |
| **R12 / D2** | ídem («al REPROGRAMAR, con fecha y motivo pero SIN foto, sigue bloqueado» + su par positivo «y con la foto se desbloquea») |
| **R13** (superficie) | ídem («pinta el error del campo y CONSERVA motivo y fotos») + el envío con `getAll("evidencia")` de 3 fotos |
| **R14** (superficie) | ídem («existe al reprogramar, arranca en MAÑANA y no admite nada anterior» · «la fecha de HOY no pasa la validación de cliente y NO llega a la Server Action» · y la ausencia del campo al rechazar) |
| **R25** 💰 | `tests/components/NovedadesModule.test.tsx` («R25: con `conflict` NO afirma que resolvió, dice el texto del servidor y RECARGA») + `tests/components/GestionarDesdeAyudaModal.test.tsx` («el motivo del servidor viaja intacto») |
| **R27** | `tests/components/NovedadesModule.test.tsx` («R27: tras el éxito lo dice, RELEE la pestaña y la fila sale de la lista» · «y al reprogramar el aviso nombra ESE desenlace, no el otro») |
| **R40** | `tests/components/RepartoAyudaResueltaPorLaTienda.test.tsx` (los tres casos: está / ya no está / ya no es parada del mapa). ⚠️ **La sustancia vive en el servidor** y ya estaba probada sin tocarse: `tests/unit/services/mis-asignaciones-service.test.ts` («R34: pide EXACTAMENTE `["por_recoger","en_reparto","ayuda_tienda"]`, ni un estado más») |
| **R41** | ⛔ **NO CUBIERTO.** Ver el apartado de arriba: falta el campo en el DTO del cierre del día (backend) |
| **D7** (los textos) | `tests/components/GestionarDesdeAyudaModal.test.tsx`, bloque «el aviso del precio»: cuatro casos —el literal completo al rechazar, el mismo al reprogramar, las tres consecuencias por separado y «siempre visible»— más el bloque de rótulos («Reprogramar» / «Rechazar», y que NO son «Reprogramar entrega» / «Rechazar entrega») |

**Los literales visibles están escritos A MANO en los tests, nunca contra la constante importada.**
Del modal sólo se importan los **tipos**; ni una aserción compara un texto con su propia fuente.

---

## Mutaciones — salida REAL, leída y citada

Método: copia de respaldo del archivo (nunca `git checkout`), un script que **falla ruidosamente si
el ancla no existe o es ambigua** —para que una mutación no aplicada no pueda reportarse como
superviviente—, `vitest run` de las suites relacionadas, y restauración verificada por sha256.

**sha256 ANTES de mutar:**

```
1760b2ce1788b59070bdd52b97729550453066c6892367e06c44bdc0432bbf39  app/(app)/novedades/_components/GestionarDesdeAyudaModal.tsx
2952fead5f39c8d18a14505867aa9fafa0d79bc5964df3377a078846e744b7e0  app/(app)/novedades/_components/NovedadesModule.tsx
2dd739b2c3598cae186a911b1ce8d203c2fa976c03b70a2e811b5cedd10daf48  app/(app)/novedades/_components/novedad-acciones-catalogo.ts
```

**sha256 DESPUÉS de restaurar: IDÉNTICOS** (`diff` de los dos ficheros de sumas, vacío):

```
$ diff /tmp/mut/antes.sha256 /tmp/mut/despues.sha256 && echo "SHA256 IDENTICOS"
SHA256 IDENTICOS: el arbol quedo byte a byte como antes de mutar
```

Y **no quedó ni un `.bak`** en el árbol (`git status --short | grep .bak` → vacío).

### M1a — la ventana deja de montarse (`false && ordenAGestionarDesdeAyuda`)

sha del archivo mutado: `9bd69648617a74cfd0743bffbb3ed3f17416d22f244e86aab31c52bc504bdff5`

```
     × 237: el «Reprogramar» de cada fila abre la ventana de SU grupo, no la del vecino 1156ms
     × 237: la orden en ayuda ofrece SUS dos desenlaces, que no son los de la devolución 1160ms
     × T7.3: «Rechazar» de la card abre la ventana, con su aviso del precio 1066ms
     × T7.3: «Reprogramar» de la card abre la MISMA ventana, con el campo de fecha 1073ms
     × R27: tras el éxito lo dice, RELEE la pestaña y la fila sale de la lista 1082ms
     × R27: y al reprogramar el aviso nombra ESE desenlace, no el otro 1093ms
     × R25: con `conflict` NO afirma que resolvió, dice el texto del servidor y RECARGA 1078ms
     × R22: un `forbidden` avisa con un texto opaco y NO recarga (no se movió nada) 1081ms
     × la ventana se cierra tras el desenlace, sea cual sea 1099ms
      Tests  9 failed | 67 passed (76)
```

> ⚠️ **Y hay que decir lo que esta mutación NO mató:** `tests/unit/guards/superficie-de-uso.guardia.test.ts`
> **siguió verde** (18/18). Es correcto y conviene entenderlo: esa guardia razona sobre el **grafo de
> imports**, no sobre lo que se renderiza, y el `import` del modal seguía en su sitio. Por eso hizo
> falta M1b: si me hubiera quedado en M1a, habría reportado la trampa como cerrada sin haberla
> ejercido.

### M1b — 🔑 quitar el `import { gestionarDesdeAyuda }` del modal (LA TRAMPA)

sha del archivo mutado: `1d9a19d1100a11028dc32071f483d534aec801d9be6844401891dd86d92b3a8c`

```
 FAIL  tests/unit/guards/superficie-de-uso.guardia.test.ts > R-A — toda Server Action tiene
 superficie, o dice por escrito por qué no > ninguna Server Action de `lib/actions/**` es
 inalcanzable sin su anotación `@sin-superficie`
AssertionError: estas Server Actions no las importa NINGÚN módulo alcanzable desde una raíz de ruta:
no hay forma de que un usuario las dispare. […]: expected [ Array(1) ] to deeply equal []

- []
+ [
+   "lib/actions/gestion-desde-ayuda.ts:95 gestionarDesdeAyuda",
+ ]

      Tests  1 failed | 17 passed (18)
```

**Ésta es la prueba de que la anotación se retiró con razón**: sin el cableado, la guardia nombra la
acción; con él, verde.

### M2 — vaciar el aviso del precio (D7)

sha del archivo mutado: `a1e3d5ee8fdce0d2486ffeefb05c5a7a47d65ae4a78da27f69df074e09ddfd8c`

```
     × se lee TAL CUAL, palabra por palabra, al RECHAZAR 165ms
     × y también al REPROGRAMAR: no es un aviso del rechazo, es de las dos 28ms
     × nombra las TRES consecuencias, no una fórmula vaga 29ms
     × está SIEMPRE visible, no escondido tras un tooltip ni tras un despliegue 23ms
     × 237: la orden en ayuda ofrece SUS dos desenlaces, que no son los de la devolución 182ms
     × T7.3: «Rechazar» de la card abre la ventana, con su aviso del precio 102ms
      Tests  6 failed | 89 passed (95)
```

El texto mutado (`"Confirmá la acción."`) es plausible y **no dice el precio**: es exactamente la
degradación contra la que existe el requisito. Cae en las dos suites, incluida la que lo lee desde la
card real.

### M3 — 💰 invertir `RESULTADO_POR_MODO` (rechazar ↔ reprogramar)

sha del archivo mutado: `8a41a0c969cdb695c7bcb56baacab11436388e0a618fa418bc906678c792603f`

```
     × la fecha de HOY no pasa la validación de cliente y NO llega a la Server Action 102ms
     × 💰 el modo RECHAZAR envía `resultado = rechazada` 1113ms
     × 💰 el modo REPROGRAMAR envía `resultado = reprogramada` y su fecha 1131ms
     × N fotos viajan como N valores de la MISMA clave `evidencia` 1097ms
     × el motivo viaja RECORTADO, sin los espacios de los bordes 1086ms
     × mientras el envío está en vuelo el botón se bloquea: no hay segunda gestión 92ms
     × pinta el error del campo y CONSERVA motivo y fotos 1119ms
     × el ESPEJO: un `ok` sí llega al padre, con su resultado 1098ms
     × el motivo del servidor viaja intacto 1101ms
      Tests  9 failed | 17 passed (26)
```

Es **la mutación de dinero de esta tanda**: con el mapa invertido, pulsar «Reprogramar» cobraría un
rechazo (hasta ₡1.000, medido) en el cierre de otra persona. Cae ancha porque el schema deja de
casar (una rama con fecha se envía como la que no la lleva), que es la señal correcta.

### M4 — relajar D2: la foto deja de exigirse al reprogramar

sha del archivo mutado: `6f265b873b48ab477e126bcd9bfdf95f1ebe2622159ab35dc9c890a032fc8031`

```
     × al reprogramar la lista incluye la fecha si se borra el valor por defecto 30ms
     × al REPROGRAMAR, con fecha y motivo pero SIN foto, sigue bloqueado 20ms
      Tests  2 failed | 24 passed (26)
```

### M5 — contar la carrera perdida como éxito (el defecto de 236/D8, otra vez)

sha del archivo mutado: `80abd4fcb4e112a6e51317e776be550dc5bf1425850ffa804f71f13cf05ec0b7`

```
 FAIL  tests/components/NovedadesModule.test.tsx > NovedadesModule — 237: resolver desde la pestaña
 de ayuda > R25: con `conflict` NO afirma que resolvió, dice el texto del servidor y RECARGA
AssertionError: expected "vi.fn()" to be called with arguments: [ Array(1) ]
Number of calls: 0
      Tests  1 failed | 68 passed (69)
```

### M6 — borrar la celda `rechazarDesdeAyuda` de la tabla

sha del archivo mutado: `8215c3c2e12c7feb4507570eb1007763ae85a9cbad9e2d4e5ba3e839175642b4`

```
     × grupo ayuda: ni una acción de más ni una de menos, y en su orden 10ms
     × 237/R1: la ayuda ofrece SUS dos desenlaces, y con claves propias 1ms
     × 237/R1: y NINGÚN desenlace más nace de la ayuda 1ms
     × toda acción de la unión aparece en al menos un grupo 1ms
     × ninguna acción de RESOLUCIÓN sobrevive ahí 1ms
     × R22/237: la fila de AYUDA ofrece exactamente siete controles, y son los suyos 134ms
     × «Rechazar» de la fila de AYUDA abre la ventana en modo rechazar 24ms
     × y los dos modos son DISTINTOS entre sí (anti-vacuidad del literal) 83ms
      Tests  8 failed | 25 passed (33)
```

---

## Rojos POR DISEÑO que se actualizaron a mano

El diseño §14 censó **dos** archivos de pantalla. El árbol dio **tres**. El tercero hay que decirlo
porque quien revise el diff lo va a ver y no está en el spec:

| Archivo | Qué se puso rojo | Por qué es del diseño y no una regresión |
| --- | --- | --- |
| `tests/unit/types/novedad-acciones-catalogo.test.ts` | el juego exacto del grupo `ayuda` (4 → 6) y el censo de acciones declaradas | Es el producto de la ficha. El caso «R23: el grupo de ayuda NO ofrece nada que presuponga una devolución» **se conservó**, acotado a las acciones de la devolución, y se le sumó su par positivo |
| `tests/components/NovedadAcciones.test.tsx` | el censo de nombres accesibles de la fila de ayuda (5 → 7) y el caso «sobre una orden en ayuda no se ofrecen Reprogramar ni Rechazar» | **Cambia de sentido a propósito** (design §14 lo preveía). Se reescribió nombrando las claves nuevas, no se borró |
| ⚠️ `tests/components/NovedadesTabs.test.tsx` | el **control negativo** de «el panel pinta lo que recibe»: era «la de ayuda NO gana Reprogramar por estar al lado de una devolución» | **NO estaba en el censo del spec.** El nombre accesible de los dos «Reprogramar» es el mismo, así que ese discriminador dejó de existir |

**Lo del tercero, contado entero porque es una decisión y no un ajuste.** El nombre accesible de la
acción nueva es «Reprogramar la orden de \<X\>», idéntico al de la devolución. Se podría haber
retorcido («Reprogramar desde la ayuda la orden de…») para que el test viejo siguiera valiendo, y
**no se hizo**: para quien mira, en la pestaña de ayuda, la palabra es «Reprogramar» y la orden es la
de la fila — D7 fija ese rótulo y `NovedadAcciones` ya explica que el nombre accesible es la misma
palabra más la orden concreta. Retorcer el nombre para el lector de pantalla en un caso que el
servidor **nunca produce** (una fila `devuelta` dentro de la pestaña de ayuda) sería empeorar la
accesibilidad real para salvar un test. Lo que se hizo:

1. el control negativo se cambió por los **dos discriminadores que siguen siendo exclusivos** de la
   ayuda —la conversación y el contador de intentos de contacto—, en las dos direcciones;
2. y se añadió el caso **más fuerte** que el viejo sólo aproximaba: **«el «Reprogramar» de cada fila
   abre la ventana de SU grupo, no la del vecino»**, que distingue las dos por el aviso del precio.

---

## Lo que se REUTILIZÓ, y lo que NO

**Reutilizado (nada de esto se reescribió):**

- **La tabla de acciones** `ACCIONES_POR_GRUPO` (236): las dos acciones son **celdas**, no
  condiciones sueltas. La guardia `novedad-acciones-una-tabla` sigue verde.
- **`GestionarOrdenPanel` (119) y `ReportarIncidenteModal` (158)** como molde del selector de fotos:
  compresión en el navegador, concatenar y recortar al tope, quitar por foto, previsualización con
  object URL y su revocación. **No se escribió un selector de imágenes nuevo.**
- **`gestionarDesdeAyudaSchema`** del borde (con `evidenciasSchema`, `motivoSchema` y
  `fechaFuturaSchema` dentro): la ventana **no tiene reglas propias** que puedan divergir.
- **`mananaCalendarioCR`** (`lib/utils/fecha-cr`), el mismo del panel del mensajero.
- **`GESTION_ALLOWED_MIME` / `gestionConfig.MAX_EVIDENCIAS_POR_GESTION`**: mismos límites que las
  otras dos vías.
- **El `Modal` compartido** con su fase pendiente (anti doble envío) y `closeOnConfirm={false}`.
- **El texto de la carrera lo redacta el servidor** (`MENSAJES_GESTION_DESDE_AYUDA.fueraDeAyuda`) y
  la pantalla lo muestra tal cual.
- **El patrón de montaje condicional con `key={orden.id}`** de los tres modales que ya vivían en
  `NovedadesModule`.

**NO reutilizado, con su motivo:**

- **`ReprogramarNovedadModal` (feature 100)** — misma palabra, otro servicio y otro estado de origen:
  no pide evidencia, no dice el precio y llama a `ReprogramacionTiendaService`.
- **Las claves `reprogramar` / `rechazar`** de la tabla — alternativa E descartada en el diseño.
- **`EvidenciasField` de `GestionarOrdenPanel`** — no está exportado y vive dentro de un archivo de
  1.400 líneas del portal del mensajero. Se siguió el precedente **explícito** de la 158, que hizo lo
  mismo (`EvidenciasIncidente`, privado de su archivo, «un solo consumidor no se promueve»,
  `docs/architecture.md`). Extraerlo a `components/shared/` tocaría el camino money-critical del
  mensajero dentro de la ficha más delicada en dinero de la pila, que es la clase de radio de
  explosión que D5 acaba de rechazar para la subida de evidencias.

**Un detalle de implementación que hay que mirar en revisión:** los dos valores de `resultado`
(`reprogramada` / `rechazada`) **no se escriben a mano** en la pantalla, se destructuran de
`RESULTADOS_DESDE_AYUDA`. Dos motivos: es la declaración única del borde, y la guardia
`novedad-acciones-una-tabla` denuncia **cualquier literal del catálogo de estatus** escrito en
`app/(app)/novedades/**` (y `reprogramada`/`rechazada` **son** estatus). El riesgo de esa
destructuración —que alguien reordene la lista y se inviertan— lo mata **M3**, cuyo test escribe los
dos literales a mano.

---

## Salidas reales

### `npx tsc --noEmit`

```
TSC EXIT=0
```
(sin una sola línea de salida)

### `npx eslint .`

```
ESLINT EXIT=0
✖ 97 problems (0 errors, 97 warnings)
```
Los 97 son **preexistentes** (`_input`, `_err`, `_opciones`… en suites ajenas) — el mismo número que
midió el backend. **Ninguno cae en un archivo de esta tanda:** filtrar la salida por
`novedades/_components`, `gestion-desde-ayuda` y `RepartoAyudaResuelta` devuelve vacío.

### Guardias completas (`vitest run guard`)

```
 Test Files  123 passed (123)
      Tests  1813 passed (1813)
```

Las dos que esta tanda podía romper, corridas además aparte y verdes:
`tests/unit/guards/novedad-acciones-una-tabla.guardia.test.ts` y
`tests/unit/guards/superficie-de-uso.guardia.test.ts` (**26 tests, 0 fallos**).

### Suite completa, con el árbol quieto

```
 Test Files  1229 passed (1229)
      Tests  16026 passed | 26 skipped (16052)
   Duration  326.59s
```

Contra la foto del backend (1227 archivos / 15.981 tests): **+2 archivos** (el test del modal y el
del portal del mensajero) y **+45 tests**.

---

## Lo que queda ABIERTO

1. ⛔ **R41 (D6)** — la fila del cierre del día del mensajero **no dice** que la gestionó la tienda.
   Falta la cadena del DTO (backend). Detalle arriba, con las cuatro capas y el archivo de cada una.
2. **T9.1 — el recorrido en el navegador** no lo hice: el servidor de dev de `localhost:3000` es del
   humano y no se toca. Los tres muros conocidos siguen escritos en `tasks.md` T9.1.
3. **T0.1** — re-medir la población en ayuda **antes de desplegar** (heredado del backend).

## Veredicto

T7 completa salvo **R41**, que no cabe en presentación y queda reportado con su causa exacta; la
anotación `@sin-superficie` **retirada y demostrada** con la mutación que la pone roja; seis
mutaciones con sus rojos citados y el árbol restaurado byte a byte; suite entera verde.

---

# ADENDA — R41 cerrado (2026-08-20, segunda tanda de frontend)

> El backend cerró su mitad después del informe de arriba: `desdeAyudaTienda` ya cruza
> `CierreGestionPendienteRow` → `toDetalleDTO` → `CierreDetalleGestion`, **obligatorio**, y su
> semántica está escrita en `lib/utils/gestion-tienda-ayuda-flag.ts` (`false` significa «no la
> registró la tienda», no «no lo sé», porque la fila de historial nace en la **misma transacción**
> que la gestión). Esta sección cierra la mitad de pantalla. **Lo de arriba no se reescribió.**

## Qué se montó

**Un archivo:** `app/(app)/cierre-dia/_components/CierreDiaModule.tsx` — la tabla del «Cierre del
día» **del mensajero**, que es la superficie que R41 nombra («el detalle de su cierre del día»).

La marca es un **`Badge` en línea, colgado del número de guía**, que aparece **sólo** cuando
`desdeAyudaTienda`:

- **rótulo visible: «La tienda»** — dice **quién**, no sólo que la fila es distinta, y cabe en una
  celda apretada;
- **nota accesible en `title` y `aria-label`** (las dos, porque `title` sólo existe para el puntero
  y en un móvil no hay hover):
  **«Esta gestión la registró la tienda desde «Ayuda solicitada», no vos: el motivo y la foto son
  suyos. Cuenta en tu cierre igual.»**

### Contra qué se contrastó la forma — no se inventó un tratamiento

Esta misma fila (`CierreDetalleGestion`) ya tiene **dos** tratamientos para marcar por registro, y se
eligió entre ellos en vez de traer uno nuevo:

| Precedente | Forma | Cuándo pinta |
| --- | --- | --- |
| `renderPagoMensajero` (56/R23) | `Badge` **en línea**, colgado del valor, con la nota en `title`/`aria-label` | **sólo la excepción** (`tarifaFaltante`) |
| `renderRechazoOrigen` (102/R9) | **columna propia** con badge en **todas** las filas («Automático» / «Manual») | siempre |

Se copió **el primero**, y por tres razones concretas:

1. **La fila está apretada.** La tabla ya lleva ~10 columnas y vive dentro de un `overflow-x-auto`;
   una columna propia cobra ancho **en cada registro** para marcar los pocos que lo necesitan.
2. **Rotular «Vos» veinte veces para marcar una** es ruido, no información: esta pantalla es del
   mensajero y el valor por defecto de toda fila ya es «mía».
3. **La ausencia aquí sí es una afirmación**, que es lo que hace legítimo marcar sólo la excepción:
   el campo es obligatorio en el DTO y se deriva del historial. Sin esa garantía del backend, un
   hueco significaría «no lo sé» y habría hecho falta la columna con sus dos valores.

Variante `secondary`, la misma con la que `renderRechazoOrigen` marca **la procedencia excepcional**
(la que no produjo el actor que uno asumiría). El badge **no sustituye la guía**: cuelga de ella,
porque el número es con lo que el mensajero busca el paquete.

### Lo que NO se tocó, y por qué

- **El comprobante del cierre pasado** (`cierre-factura.tsx`) y **el detalle del admin**
  (`cierre-detalle-shared.tsx`). R41 pide **el detalle de su cierre del día**, que es la vista en
  vivo —la que mira antes de pulsar «Solicitar cierre»—, y esos dos archivos los comparten tres
  pantallas (mensajero, admin y bodega) dentro de la ficha más delicada en dinero de la pila. **El
  DTO ya lleva la bandera en los tres productores**, así que si se quiere ahí es aditivo y de una
  ficha propia. Se dice para que la ausencia sea decisión y no descuido.
- **Las columnas de descarga** (`cierre-dia-descarga-columnas.ts`). El backend sólo actualizó los
  *fixtures* de sus tests, no añadió columna. R41 habla de la pantalla; ampliar el archivo es la
  regla de 236/D3 («el archivo publica lo que la pantalla enseña») y **cabe**, pero no está pedido.

## Mapa `R<n>` → test (actualiza la fila de R41 del informe de arriba)

| Req | Dónde se prueba |
| --- | --- |
| **R41** ✅ | `tests/components/CierreDiaModule.test.tsx`, bloque «237/R41: la gestión que registró la tienda va marcada» — cinco casos: el **par presencia/ausencia en la MISMA tabla**, la nota accesible con su literal completo, las tres cosas que la nota no puede perder, que el badge **no se come la guía**, y que vale para **los dos** desenlaces con una `entregada` de contraste |

Los textos van **escritos a mano** en el test: no se importan `GESTION_TIENDA_BADGE_LABEL` ni
`GESTION_TIENDA_BADGE_NOTA`.

## Mutación — salida REAL, leída y citada

**sha256 antes:** `1e374bc34dc76205168be0ecd046297bf8b368cc9b2a1c33ad33bfe3bcd19a0e`
(`app/(app)/cierre-dia/_components/CierreDiaModule.tsx`)

Se hicieron **las dos direcciones**, que es la única forma de demostrar que el par mide algo: una
marca que siempre aparece y una que nunca aparece son dos fallos distintos y ninguno de los dos puede
pasar en verde.

### M7 — la marca en TODAS las filas (`g.desdeAyudaTienda ?` → `true ?`)

sha del archivo mutado: `85ddb93248a1a49ec9299c351d819ffc0a13eeed781b16c91967e29d570f6875`

```
     × la fila de la TIENDA lleva la marca y la del MENSAJERO no (el par, en la misma tabla) 22ms
     × vale para los DOS desenlaces que la tienda puede registrar, no sólo para el rechazo 21ms
      Tests  2 failed | 53 passed (55)
```

Con su mensaje real, que enseña el badge apareciendo donde no debe:

```
AssertionError: expected <span data-slot="badge" …(4)></span> to be null
- Expected:  null
+ Received:
<span
  aria-label="Esta gestión la registró la tienda desde «Ayuda solicitada», no vos: el motivo y la
              foto son suyos. Cuenta en tu cierre igual."
  data-slot="badge"
  data-variant="secondary"
  title="Esta gestión la registró la tienda desde «Ayuda solicitada», no vos: …"
>
  La tienda
</span>
 ❯ tests/components/CierreDiaModule.test.tsx:1200:65
```

### M8 — la marca en NINGUNA fila (`g.desdeAyudaTienda ?` → `false ?`)

sha del archivo mutado: `94d317082821f062fa618489597264a49bc27dfd23116687b2560dbfb12c545f`

```
     × la fila de la TIENDA lleva la marca y la del MENSAJERO no (el par, en la misma tabla) 20ms
     × la marca trae su nota accesible, que es lo que le deja explicarla si le preguntan 15ms
     × la nota nombra las tres cosas: quién, con qué evidencia y que cuenta igual 15ms
     × vale para los DOS desenlaces que la tienda puede registrar, no sólo para el rechazo 24ms
      Tests  4 failed | 51 passed (55)
```

```
TestingLibraryElementError: Unable to find an element with the text: La tienda.
```

**sha256 después de restaurar:** `1e374bc34dc76205168be0ecd046297bf8b368cc9b2a1c33ad33bfe3bcd19a0e`
— idéntico al de antes (`diff` de los dos ficheros de sumas, vacío). Sin `.bak` en el árbol.

## Salidas reales de esta adenda

### `npx tsc --noEmit`

```
TSC EXIT=0
```

### `npx eslint` sobre lo tocado

```
ESLINT EXIT=0
```
(`app/(app)/cierre-dia/_components/CierreDiaModule.tsx` y `tests/components/CierreDiaModule.test.tsx`,
sin una línea de salida)

### Tests relacionados

```
$ npx vitest run tests/components tests/unit/descarga
 Test Files  247 passed (247)
      Tests  2981 passed | 26 skipped (3007)
```

```
$ npx vitest run guard
 Test Files  123 passed (123)
      Tests  1813 passed (1813)
```

⚠️ **Esto NO es el gate.** El árbol lo estamos compartiendo con el backend, así que estos verdes son
de las dos mitades juntas y no dicen nada de mi diff aislado. **La suite completa sobre el árbol
quieto la corre el leader.**

## Lo que queda ABIERTO tras esta adenda

1. **T9.1 — el recorrido en el navegador.** Sigue sin hacerse: el servidor de dev es del humano.
   El paso 5 del recorrido de `tasks.md` es exactamente lo que esta adenda hace visible («la orden
   ya no está en su apartado de ayuda, **está** en su cierre del día **rotulada como hecha por la
   tienda**»).
2. **T0.1** — re-medir la población en ayuda antes de desplegar (heredado del backend).
3. **Aditivo y no pedido:** la marca en el comprobante del cierre pasado y en el detalle del admin,
   y la columna en las descargas del cierre del día. El DTO ya lo permite.

---

# ADENDA 2 — el botón que siempre fallaba (D3/R38 en pantalla), 2026-08-20

> Lo encontró **el recorrido con la app**, no la suite: en la fila de una gestión de la tienda,
> «Devolver a gestión» salía **habilitado**, abría su modal —que promete «la orden volverá a tu lista
> para gestionar»— y el servidor lo rechazaba, correctamente, por la guardia 3-bis de
> `CierreDiaService.deshacerGestion`. **Un botón que siempre falla detrás de un modal que miente.**
> Lo de arriba no se reescribió.

## Primero: la pregunta del recorrido — ¿el mensajero se enteraba?

**Sí, salía mensaje. NO fallaba en silencio.** Verificado leyendo el camino y **afirmado con un
test**, no de memoria:

- `confirmarDeshacer` (`CierreDiaModule.tsx`) resuelve el `conflict` con
  `toast.error(mensajeError(result, DESHACER_ERROR))`, y `mensajeError` devuelve **el `motivo` del
  servidor tal cual** — la regla de 67/R38: «el `motivo` del `conflict` YA viene accionable del
  server (no se reescribe acá)».
- El motivo que manda D3 es `MSG_GESTION_DE_LA_TIENDA` (`lib/services/CierreDiaService.ts`):
  **«Esta orden la resolvió la tienda desde su pantalla de ayuda; solo ella puede corregirlo.
  Escribile por el chat de la orden.»** Accionable y con tildes.
- El modal se cerraba (`setDeshacerFila(null)`) y ni la tabla ni los totales se tocaban.

Así que el defecto era **peor de lo que parecía y mejor de lo que se temía a la vez**: el usuario sí
recibía una explicación correcta, pero sólo **después** de leer un modal que le había prometido lo
contrario y de confirmar una acción que nunca podía funcionar. Lo que sobraba era el camino, no el
aviso.

Queda **afirmado con un caso ejecutable** («RED DE SEGURIDAD: si se llegara a enviar, el motivo del
servidor se muestra tal cual»), montado sobre una fila normal con la respuesta de D3 forzada: hoy ese
camino ya no es alcanzable desde la pantalla, y el caso existe para que siga siendo cierto si alguien
lo alcanza por otra vía.

## La forma elegida: **deshabilitado con su motivo**, no oculto

`app/(app)/cierre-dia/_components/CierreDiaModule.tsx` — el botón de la columna «Acciones» va
`disabled` cuando `desdeAyudaTienda`, con el motivo en `title` **y** sumado al nombre accesible.

**Por qué ésa y no ocultarlo**, con los tres argumentos que la sostienen:

1. **La fila ya empezó a explicarse sola.** La marca «La tienda» dice **quién** la registró; decir
   aquí **por qué no podés tocarla** cierra el razonamiento en el mismo sitio. Ocultar el botón
   dejaría la mitad del razonamiento: el mensajero vería que esa fila es distinta y que además le
   falta un control, sin que nada una las dos cosas.
2. **Es el tratamiento que ESTA MISMA PANTALLA ya usa** para «no podés, y éste es el motivo»:
   «Solicitar cierre» va `disabled` con `motivoBloqueo` en su `title` y su nota. No se inventa nada.
3. **La columna «Acciones» queda mejor, no peor** —que era la duda—: todas las filas conservan su
   control en el mismo sitio y una está apagada. La alternativa dentro de una columna de botones es
   una celda vacía o un «—» suelto, que se lee como una tabla rota, no como una regla.

**Y una decisión de accesibilidad que no es cosmética:** un botón `disabled` **sale del orden de
tabulación**, así que su `title` es inalcanzable con el teclado. Por eso el motivo va **también en el
nombre accesible** (`aria-label`), sumado y no sustituyendo al nombre de la acción:

> `Devolver a gestión la orden REM-TIENDA · Ana Pérez — no disponible: Esta orden la resolvió la
> tienda desde su pantalla de ayuda; solo ella puede corregirlo. Escribile por el chat de la orden.`

Es la misma técnica del badge de la adenda anterior: el rótulo dice **qué es**, el atributo dice
**por qué**.

**Duplicación declarada:** el texto es **el mismo** que devuelve el servidor. `MSG_GESTION_DE_LA_TIENDA`
**no está exportado** y traerlo al cliente arrastraría Prisma al navegador, así que la pantalla tiene
su constante. Está dicho en el comentario del código: son las dos mitades de la misma regla —dicha
antes y dicha después— y si alguien cambia una tiene que cambiar la otra. El riesgo es bajo porque,
con el botón apagado, el mensaje del servidor ya casi no es alcanzable desde aquí.

## Mapa `R<n>` → test (amplía R38 en pantalla)

| Req | Dónde se prueba |
| --- | --- |
| **R38** (superficie) | `tests/components/CierreDiaModule.test.tsx`, bloque «237/D3: la gestión de la tienda no se puede devolver a gestión» — cinco casos: el **par bloqueado/habilitado en la MISMA tabla**, el motivo en `title` y en el nombre accesible, que el motivo es **accionable** (dice a quién acudir), que **pulsarlo no abre el modal** que promete devolver la orden ni llama al servidor —con su par: sobre la fila del mensajero **sí** lo abre— y la **red de seguridad** del `conflict` |

El literal del motivo va **escrito a mano** en el test; no se importa `DESHACER_BLOQUEO_TIENDA`.

## Mutación — salida REAL, leída y citada

**sha256 antes:** `407367e9a42d76727c0b84bda44e3e938a9d5250ab18cd967b2c9403dbdcce9d`
(`app/(app)/cierre-dia/_components/CierreDiaModule.tsx`)

### M9 — la condición ignora la bandera (`g.desdeAyudaTienda` → `false`)

Es exactamente el estado en que el recorrido encontró la pantalla.

sha del archivo mutado: `962d6d792ecc32d4aca4a98ef916b9eca32edfe4399336dde848c641d7fe17e4`

```
     × la fila de la TIENDA lo tiene bloqueado y la del MENSAJERO no (el par, misma tabla) 27ms
     × y dice POR QUÉ: el motivo va en el `title` y también en el nombre accesible 24ms
     × el motivo es ACCIONABLE: dice a quién acudir, no un «no se puede» a secas 24ms
     × pulsarlo NO abre el modal que promete devolver la orden, ni llama al servidor 73ms
      Tests  4 failed | 56 passed (60)
```

Con sus mensajes reales — el primero enseña el botón **vivo** justo donde el recorrido lo encontró:

```
Error: expect(element).toBeDisabled()
Received element is not disabled:
  <button
    aria-label="Devolver a gestión la orden REM-TIENDA · Ana Pérez"
    data-slot="button"
    tabindex="0"
    type="button"
  />
 ❯ tests/components/CierreDiaModule.test.tsx:1325:35
```

```
Error: expect(element).toHaveAttribute("title", "Esta orden la resolvió la tienda desde su pantalla
de ayuda; solo ella puede corregirlo. Escribile por el chat de la orden.")
Expected the element to have attribute:
  title="Esta orden la resolvió la tienda desde su pantalla de ayuda; solo ella puede corregirlo. …"
Received:
  null
 ❯ tests/components/CierreDiaModule.test.tsx:1335:19
```

**sha256 después de restaurar:** `407367e9a42d76727c0b84bda44e3e938a9d5250ab18cd967b2c9403dbdcce9d`
— idéntico (`diff` de los dos ficheros de sumas, vacío). Sin `.bak` en el árbol.

## Salidas reales de esta adenda

```
$ npx tsc --noEmit
TSC EXIT=0
```

```
$ npx eslint app/(app)/cierre-dia/_components/CierreDiaModule.tsx tests/components/CierreDiaModule.test.tsx
ESLINT EXIT=0
```

```
$ npx vitest run tests/components tests/unit/descarga
 Test Files  247 passed (247)
      Tests  2986 passed | 26 skipped (3012)
```

```
$ npx vitest run guard tests/unit/services/cierre-dia-service.test.ts tests/integration/actions/cierre-dia-action.test.ts
 Test Files  125 passed (125)
      Tests  1941 passed (1941)
```

⚠️ **Sigue sin ser el gate:** el árbol está compartido con el backend. La suite completa sobre el
árbol quieto la corre el leader.

## Lo que esta adenda deja ABIERTO

1. **Repetir el paso 6 del recorrido** (`tasks.md` T9.1: «intentar deshacerla y comprobar lo que D3
   diga, leyendo el mensaje»). Ahora lo que hay que leer es el **tooltip del botón apagado**, no un
   toast tras confirmar. No lo puedo hacer yo: el servidor de dev es del humano.
2. **La misma regla en el comprobante del cierre pasado y en el detalle del admin** sigue sin
   pintarse — pero ahí **no hay botón de deshacer**, así que no hay superficie sin permiso: es sólo
   la marca «La tienda», ya declarada como aditivo en la adenda anterior.
