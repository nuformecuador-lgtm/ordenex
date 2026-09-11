# Feature 418 — el aviso de represadas decide su ámbito por lista blanca, no por lista negra

Requisitos en notación EARS. Cada `R<n>` termina mapeado a un test concreto en la tabla de
trazabilidad de `tasks.md` (`docs/specs.md` §Trazabilidad). Sin detalles de implementación: el CÓMO
vive en `design.md`.

**Preguntas abiertas: NINGUNA.** Las dos del borrador se cerraron el 2026-09-10 y viven como
decisiones firmadas al final: **R7 entra**, y **la medición contra producción no aplica todavía**
—el valor `devoluciones_represadas` **no existe en el enum de producción**—, así que pasa de puerta
de la ficha a comprobación **post-despliegue**. Ningún hueco se ha rellenado con supuestos.

---

## De dónde sale esta ficha

La destapó el **reviewer de la 417** el 2026-09-10 (`progress/review_417.md` §Hallazgos, «menor 3»)
y la declaró **fuera del alcance de aquella ficha a propósito**: la 417 solo exigía (su R6) que
`maestro`/`admin` conservaran el ámbito global, y cerrar la forma de la condición habría sido
alcance de más sobre una ficha declarada mínima.

Ésta es su **continuación directa**: mismo archivo, mismo método, misma regla —*si el ámbito del
actor no existe, se falla; no se inventa uno*— y **el mismo entregable: el rojo**.

**No es un agujero de seguridad, y escribirlo así sería mentir.** Es una **protección frágil**:

1. **Hoy no es alcanzable.** Ningún actor de rol `mensajero`, `adminTienda` o `apiKey` puede ver una
   fila de ese aviso, así que el resolutor no se llama para ellos (verificado abajo, §Verificado).
   **Y en producción, todavía menos: el evento entero no existe allí.** El valor
   `devoluciones_represadas` **no está en el enum de producción** —la migración de la 409 vive en
   `dev`, sin desplegar—, medido por el orquestador el 2026-09-10. Eso **no es un conteo de cero**,
   y la diferencia importa: no es que el caso no haya ocurrido, es que **el aviso todavía no puede
   existir**.
2. **El peor caso sería un conteo fuera de ámbito, no una fuga de datos.** El texto del aviso ya va
   **sin guía, sin remisión, sin dirección, sin teléfono, sin destinatario, sin tienda y sin zona**
   (409/R54, `emitir.ts:1076-1077`). Lo que se vería de más es **un número**.

**Y aun así merece ficha, y éste es el punto entero:** una **lista negra da por bueno todo lo que no
enumera**. La rama decide `rol !== "adminSatelite" ⇒ ámbito global`, así que **cualquier rol que no
enumere cae en el total del sistema** — los tres de hoy y el séptimo que se añada mañana al enum, sin
que nada se ponga rojo. Es exactamente la herencia que la 417 existe para dejar de confiar, sólo que
aquí la herencia no está en otro archivo: está en **la forma de la condición**.

> **El entregable de esta ficha no es el arreglo: es el rojo.** Volver a la lista negra tiene que
> poner algo en rojo **por sí mismo**, sin depender del predicado de visibilidad de la 146 ni de
> ninguna guarda de la 417.

---

## Verificado contra el código el 2026-09-10 (leído en el archivo real, no en el grafo)

- **El seam es `lib/services/VigenciaAvisoAgregadoService.ts`**, método `cifra`, rama
  `devoluciones_represadas` (**líneas 68-89**). La decisión está en las **líneas 72-74**:
  `if (actor.rol !== "adminSatelite") { return this.repo.contarRepresadas(this.ancladaAntesDe(), null); }`
- **`null` significa «todo el sistema»**, confirmado en la implementación:
  `AvisoAgregadoRepository.contarRepresadas` (**líneas 167-171**):
  `return zonaId === null ? filas.length : filas.filter((f) => f.zonaId === zonaId).length;`
- **La asimetría con la rama hermana es literal y está a diez líneas.** `novedades_sin_gestionar`
  (**líneas 61-65**) ya decide por **inclusión**: `if (actor.rol !== "adminTienda") throw ...` —una
  lista blanca de un solo miembro—, mientras que la de represadas decide por **exclusión**.
- **El enum tiene SEIS roles** (`db/schema.prisma:35-44`): `maestro`, `admin`, `mensajero`,
  `adminTienda`, `adminSatelite`, `apiKey`. Los tres que hoy caen en el ámbito global sin estar
  enumerados son `mensajero`, `adminTienda` y `apiKey`.
- **La lista blanca correcta está escrita en el catálogo, no la invento yo:**
  `lib/notificaciones/catalogo-avisos.ts:260` — `destinatarios: ["maestro", "admin", "adminSatelite"]`
  para `devoluciones_represadas`. Y el emisor dice lo mismo con otras palabras
  (`lib/notificaciones/emitir.ts:1121-1124`): ámbito **global** → `ROLES_ADMINISTRACION`
  (`emitir.ts:112-115`: `maestro` y `admin`); ámbito **zona** → `{ tipo: "rol", rol: "adminSatelite",
  zonaId }`. **Dos fuentes independientes que coinciden.**
- **Un solo productor de ese aviso**, verificado por búsqueda en todo el árbol `.ts`:
  `emitirDevolucionesRepresadas` sólo se llama en `lib/notificaciones/notificadores.ts:392`
  (`notificarDevolucionesRepresadasCon`); el resto de apariciones son tests.
- **Hoy es inalcanzable, y lo impiden dos capas ajenas a este seam:**
  - `lib/notificaciones/emitir.ts:1121-1124` — las filas se escriben siempre con
    `destinatario.tipo === "rol"` y rol ∈ {`maestro`, `admin`, `adminSatelite`};
  - `lib/repositories/NotificacionRepository.ts:39-50` (predicado de la 146) — el segundo término
    cuelga de `destinatarioRol: actor.rol`, y el primero (`destinatarioUsuarioId = actor.usuarioId`)
    no puede casar porque `columnasDestinatario` (**líneas 72-78**) escribe
    `destinatarioUsuarioId: null` para todo destinatario de tipo rol.
  Y `NotificacionService.listar` (**líneas 93-102**) alimenta `cifrasVivas` con
  `filas.map((f) => f.evento)`, o sea **sólo con los eventos de las filas que el actor ya puede
  ver**. Un `mensajero` no ve la fila ⇒ no llega a `cifra`.
- **El fallo, si `cifra` lanza, ya tiene aterrizaje y no hay que inventar nada:**
  `NotificacionService.cifrasVivas` (**líneas 153-174**) lo captura, lo registra con su `cause` y
  guarda `null` → la 409/R58 muestra el aviso **sin número**. **Lanzar aquí no rompe ninguna
  pantalla.** Es el mismo aterrizaje que ya usan las dos guardas de la 417.
- **Ningún caso vigente afirma el comportamiento que esta ficha cambia — comprobado abriendo los
  cuerpos, no los títulos** (`tests/unit/services/vigencia-aviso-agregado.test.ts`): los únicos
  actores que se usan con `devoluciones_represadas` son `SATELITE` (líneas 55-73), `MAESTRO`
  (líneas 75-81 y 184) y `ADMIN` (línea 78) — **los tres están en la lista blanca**. `TIENDA` sólo
  aparece con `novedades_sin_gestionar` (línea 48) y con el default (línea 209). O sea: **hoy nada
  se pone rojo si alguien mete a los otros tres roles en el ámbito global, porque nada lo afirma.**
- **`RolValue` es importable como VALOR**, no sólo como tipo: `lib/auth/acceso-total.ts:1,5` lo usa
  en producción (`RolValue.maestro`) y `tests/unit/services/alcance-borrado-orden.test.ts:57` hace
  `Object.values(RolValue)`. Un test exhaustivo sobre el enum **es posible** (R5).
- **No hay guardia que prohíba una lista de roles escrita a mano en este archivo.** La única que
  existe (`tests/unit/guards/tablero-financiero.guardia.test.ts:331-342`, `listasDeRolesAMano`)
  censa **sólo** la región financiera de analítica (`CENSADOS`, líneas 117-126). `lib/services/` no
  entra.
- **En producción, el evento aún no existe.** Medido por el orquestador el 2026-09-10: el valor
  `devoluciones_represadas` **no está en el enum de producción**, porque la migración de la 409 está
  en `dev` sin desplegar. Por eso la comprobación contra producción **no es puerta de esta ficha**
  sino una comprobación **post-despliegue** (`design.md` §6, `tasks.md` T8), y por eso el dato de hoy
  hay que decirlo como es: **«el enum no tiene ese valor», no «salieron cero filas»**.

---

## Alcance

**Dentro:** la resolución del **ámbito** de la cifra viva en `VigenciaAvisoAgregadoService.cifra`,
**rama `devoluciones_represadas` y sólo ella**, y las pruebas que la afirman en este seam.

**Fuera, declarado:**

- La rama `novedades_sin_gestionar`: **ya decide por inclusión** desde la 417 (líneas 61-65). No se
  toca ni una línea.
- El predicado de visibilidad de la 146 (`NotificacionRepository.ts`), el emisor
  (`lib/notificaciones/emitir.ts`), el cron (`AvisosDiariosService.ts`), el repositorio de avisos,
  el panel y la campana.
- **Quién recibe** cada aviso: el catálogo se **lee** (R7) y **no se modifica**.
- Cualquier cambio de datos: **no hay migración, ni tabla, ni columna, ni enum, ni RLS nueva**.
- Rediseñar el sistema de alcances del repo (un tipo `Ámbito` discriminado transversal sobre
  `Actor`): descartado en `design.md` §7-E, igual que en la 417.

---

## Requisitos

### §1 — La lista blanca, y qué ámbito le toca a cada miembro

- **R1** — MIENTRAS el actor sea de rol `maestro` o de rol `admin`, el sistema **DEBE** seguir
  pidiendo la cifra de devoluciones represadas con **ámbito global** (409/R49; 417/R6 conservado).
- **R2** — MIENTRAS el actor sea de rol `adminSatelite` **con zona asignada**, el sistema **DEBE**
  seguir pidiendo la cifra acotada a **esa** zona (409/R57; 417/R5 conservado).
- **R3** — SI el resolutor de la cifra viva de devoluciones represadas recibe un actor cuyo rol **no
  está en la lista blanca de ese aviso** (`maestro`, `admin`, `adminSatelite`), ENTONCES el sistema
  **NO DEBE** consultar ninguna cifra: ni la global, ni la de ninguna zona.
- **R4** — SI el resolutor recibe, para ese aviso, un actor cuyo rol **no está en la lista blanca**,
  ENTONCES el sistema **DEBE fallar con un error que nombre la causa e incluya el rol**, y **NO DEBE
  devolver una cifra** —en particular, **NO DEBE devolver `0`** (apagaría el aviso en silencio,
  409/R55) **ni el total del sistema**.
- **R5** — El sistema **DEBE** decidir ese ámbito **por inclusión**: para **cada** valor del catálogo
  de roles del dominio que **no** esté enumerado con un ámbito propio, el comportamiento **DEBE** ser
  el de R3 y R4. Un valor de rol **nuevo** en el enum **NO DEBE** obtener ámbito global.

### §2 — El error, para que su test no pueda pasar por accidente

- **R6** — El error de R4 **NO DEBE** coincidir con los mensajes de los otros dos fallos de ámbito
  del mismo método (el del `adminSatelite` sin zona y el del rol que no es tienda), y **NO DEBE**
  contener el identificador del usuario ni ningún otro dato personal.

### §3 — La lista blanca no puede divergir de quién recibe el aviso

- **R7** — El conjunto de roles con ámbito propio para devoluciones represadas **DEBE** coincidir con
  los **destinatarios declarados para ese aviso en el catálogo de avisos**; SI dejan de coincidir,
  ENTONCES la verificación **DEBE** fallar.

### §4 — Lo que no puede cambiar (no regresión)

- **R8** — El sistema **DEBE** conservar sin cambios los demás caminos del resolutor: el conteo por
  tienda de `novedades_sin_gestionar` para un `adminTienda`, su fallo para quien no lo es, el fallo
  del `adminSatelite` sin zona, el fallo para un evento que no es agregado, y el umbral de días
  inyectado.
- **R9** — El sistema **NO DEBE** modificar el predicado de visibilidad de notificaciones de la
  feature 146, ni la emisión del aviso, ni el catálogo de avisos.

### §5 — Dónde aterriza el fallo

- **R10** — CUANDO la resolución de la cifra viva falle porque el rol del actor no tiene ámbito para
  ese aviso, el sistema **DEBE** seguir mostrando ese aviso **sin número** en el listado —nunca con
  el total del sistema— y **DEBE registrar el fallo con su causa** (409/R58 afirmado de extremo a
  extremo, no heredado de palabra).

### §6 — El entregable: el rojo, y sus dos mitades

- **R11** — El sistema **DEBE** decidir el ámbito de esta cifra de forma que **volver a la decisión
  por exclusión ponga en rojo al menos un test**, sin modificar el predicado de visibilidad de la
  146 ni ningún otro archivo de producción; y **DEBE demostrarse la otra mitad**: que con el código
  anterior a esta ficha la misma suite **salía verde con el defecto delante**.

---

## Las mutaciones obligatorias (el entregable de la ficha)

Un requisito sin un rojo que lo respalde no está cumplido. Estas seis se ejecutan **y su salida se
pega en `progress/impl_418.md`** con el conteo exacto de rojos y el nombre de cada caso.

| # | Mutación | Qué tiene que ponerse ROJO |
| --- | --- | --- |
| **M1** | Volver a la lista negra: `if (actor.rol !== "adminSatelite") return contarRepresadas(cota, null)` (el código de hoy) | **R3, R4, R5 y R10**, con `NotificacionRepository.ts` **intacto** y sin tocar las guardas de la 417. Es la mutación que da sentido a la ficha, y media de R11 |
| **M2** | Sustituir ese fallo por `return 0` | **R4** (y R10: el aviso **desaparecería** en vez de mostrarse sin número). **R3 debe quedar VERDE**: es lo que demuestra que los dos asertos están separados a propósito y que la ficha exige **ruido**, no silencio |
| **M3** | Quitar `admin` de la lista blanca (dejar sólo `maestro` con ámbito global) | **R1**, y **sólo** por el caso de `admin`. Control positivo: demuestra que los dos roles globales están cubiertos **uno a uno**, no por un caso que sólo prueba `maestro` |
| **M4** | Quitar `adminSatelite` de la lista blanca | **R2**. Control positivo: la protección nueva no puede cerrar el ámbito legítimo del satélite |
| **M5** | Hacer que el error nuevo lleve el mensaje de otro de los dos fallos de ámbito ya existentes | **R4 y R6**. Control contra el «verde por el error equivocado»: un `rejects.toThrow` que casara con cualquier error pasaría esta mutación |
| **M6** | Añadir `mensajero` a `destinatarios` de `devoluciones_represadas` en el catálogo | **R7**. Demuestra que la comprobación de divergencia **no es vacua**. Puede enrojecer también guardias ajenas (p. ej. la del atajo visible por rol): eso no invalida la mutación, pero el caso de R7 **tiene que estar entre los rojos, por nombre** |

---

## Preguntas abiertas

**NINGUNA.** Las dos del borrador se cerraron el 2026-09-10 y quedan aquí como decisiones firmadas,
con su porqué, para que nadie las reabra por costumbre.

**D1 — R7 ENTRA (la comprobación contra el catálogo).**
Era lo único del spec que va más allá del arreglo literal evidenciado, y se acepta **precisamente
por eso**: convierte la lista blanca de «escrita a mano» en «**derivada de una fuente**». Con la
lista blanca sola, un rol nuevo del enum **falla cerrado** (bien), pero queda vivo el modo de fallo
inverso: si alguien añade un rol a `destinatarios` en el catálogo, la lista blanca se queda corta
**y nada se pone rojo** — que es literalmente el defecto que esta ficha existe para no repetir. R7
convierte ese día en **un test rojo en el mismo commit** en vez de en un ruido que alguien descubre
en el log semanas después. Es **test-only** y cuesta un aserto y una mutación (**M6**).

**D2 — La medición contra producción NO APLICA todavía, y no por falta de acceso.**
La corrió el orquestador el 2026-09-10 y el resultado es más fuerte que un cero: **el valor
`devoluciones_represadas` no existe en el enum de producción**, porque la migración de la 409 está
en `dev` sin desplegar. O sea: **no es que el caso no haya ocurrido — es que el evento entero
todavía no puede existir allí.** La frase «hoy no es alcanzable» se sostiene por una razón más
fuerte que la razonada en §Verificado, pero **no se puede confirmar midiendo** hasta que esto se
despliegue.

Consecuencia para el spec: la consulta pasa de **puerta de la ficha** a **comprobación
post-despliegue**, con su `SELECT` ya escrito (`design.md` §6, `tasks.md` T8) y con su condición de
lectura dicha por adelantado — producción se vació a propósito el 2026-08-25, así que **un cero
significa «aún no ha pasado», no «está bien»**. Y el dato de hoy hay que reportarlo como lo que es:
**«el enum no tiene ese valor»**, que no es lo mismo que **«salieron cero filas»**; quien ejecute la
comprobación necesita esa diferencia para saber si está midiendo algo o midiendo la nada.
