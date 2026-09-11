# Feature 418 — tareas

Zona: **backend**. Complejidad: **baja**. Sin migración, sin UI, sin endpoint nuevo.
`[P]` = paralelizable con la tarea anterior (archivos distintos).

**Un commit por tarea lógica** (`docs/conventions.md`): `feat(418)` / `test(418)` / `docs(418)`.
**Marca la casilla al terminarla.** Una lista entera en blanco hace indistinguible «no hecha» de «no
anotada» — fue el único bloqueante de la 409.

---

## T0 — Pre-vuelo (10 min, sin escribir código) — bloquea todo lo demás

- [x] **T0.1** Releer en el **archivo real** (no en el grafo: devuelve símbolos ya borrados):
  `lib/services/VigenciaAvisoAgregadoService.ts`, `lib/notificaciones/catalogo-avisos.ts`,
  `lib/notificaciones/emitir.ts` (`emitirDevolucionesRepresadas` y `ROLES_ADMINISTRACION`),
  `lib/repositories/NotificacionRepository.ts` (`predicadoVisibilidad` y `columnasDestinatario`) y
  `lib/services/NotificacionService.ts` (`listar` y `cifrasVivas`).
  **Hecho cuando:** confirmas las anclas de `requirements.md` §Verificado y, si alguna se movió, lo
  anotas en `progress/impl_418.md` **antes** de tocar nada.
- [x] **T0.2** Confirmar la **lista blanca** en sus dos fuentes: `catalogo-avisos.ts:260`
  (`destinatarios: ["maestro", "admin", "adminSatelite"]`) y `emitir.ts:1121-1124` + `112-115`.
  **Hecho cuando:** las dos están citadas literales en la bitácora y **coinciden**. **Si no
  coincidieran, para y dilo**: la ficha cambia de forma, porque el spec se apoya en que coinciden.
- [x] **T0.3** Confirmar que `devoluciones_represadas` tiene **un solo productor**
  (`emitirDevolucionesRepresadas` invocado sólo en `notificadores.ts:392`; el resto, tests).
  **Hecho cuando:** verificado en el archivo real. **Si aparece un segundo productor o un
  destinatario de otro rol, para y dilo**: la lista blanca cambiaría.
- [x] **T0.4** Abrir **los cuerpos** de los casos vigentes de
  `tests/unit/services/vigencia-aviso-agregado.test.ts` que esta ficha toca de refilón (líneas 45-53,
  55-64, 66-73, 75-81, 180-190) y confirmar que **ninguno** usa un rol fuera de la lista blanca con
  `devoluciones_represadas`.
  **Hecho cuando:** está escrito en la bitácora. No leas los títulos: en la 417 había uno que
  prometía lo contrario de lo que afirmaba.

---

## T1 — La lista blanca en el seam (R3, R4, R5, R6) · depende de T0

- [x] **T1.1** En `VigenciaAvisoAgregadoService.cifra`, rama `devoluciones_represadas`: sustituir la
  decisión por **exclusión** (`rol !== "adminSatelite" ⇒ global`) por una decisión por **inclusión**:
  `maestro`/`admin` → ámbito global; `adminSatelite` → la guarda de zona de la 417 y su zona;
  **cualquier otro rol** → **no llamar al repositorio** y lanzar un error que nombre la causa e
  incluya el rol. Comentario al lado con **el porqué**, no con el qué.
  **Hecho cuando:** `pnpm run typecheck` y `pnpm run lint` pasan; las dos guardas de la 417 quedan
  **sin tocar**; la rama de `maestro`/`admin` sigue pidiendo `null`.
- [x] **T1.2** Comprobar que el mensaje nuevo **no coincide** con los otros dos fallos de ámbito del
  método (`/no tiene zona asignada/i`, `/no es una tienda/i`) y **no lleva `usuarioId`** (R6).
  **Hecho cuando:** los tres mensajes están pegados juntos en la bitácora y se ven distintos a
  simple vista.
- [x] **T1.3 `[P]`** Ampliar la documentación de `lib/interfaces/services/IVigenciaAvisoAgregado.ts`
  (líneas 26-36) con el **tercer** caso de lanzamiento, junto a los dos de la 417.
  **Hecho cuando:** el contrato no dice menos de lo que la implementación hace. **Sin cambio de
  firma.**

---

## T2 — Los tests del seam (R3, R4, R5, R6) · depende de T1

Todos en `tests/unit/services/vigencia-aviso-agregado.test.ts`, **sin editar ningún caso existente**.

- [x] **T2.1** Casos de R3: para un actor de rol `mensajero`, `adminTienda` y `apiKey` pidiendo
  `devoluciones_represadas`, **el repositorio no se llama** (`contarRepresadas` **ni**
  `contarNovedadesDeTienda`).
  **Hecho cuando:** pasan, y el caso está nombrado por lo que afirma («no se consulta ningún
  ámbito»), no por lo que promete.
- [x] **T2.2** Casos de R4, **separados de los de R3 a propósito** (igual que en la 417: así una
  mutación a `return 0` deja R3 verde y sólo enrojece R4, y el rojo dice **qué** se perdió): los
  mismos tres roles **lanzan** con el literal **escrito a mano**, nunca importado de producción.
  **Hecho cuando:** pasan y **ninguno afirma `0`** ni ningún número.
- [x] **T2.3** Caso de R4 «ni siquiera el número que el repositorio daría»: con el espía cargado
  (devuelve `7`), un rol fuera de la lista blanca **lanza** y `contarRepresadas` **no se llama**.
  **Hecho cuando:** pasa. Es el que retrata el defecto: ese `7` es el total del sistema.
- [x] **T2.4** Caso de R6: el error de R4 **no** casa con `/no tiene zona asignada/i` ni con
  `/no es una tienda/i`, y **no contiene** el `usuarioId` del actor.
  **Hecho cuando:** pasa. Sin esto, el aserto de T2.2 podría estar pasando por el error equivocado
  (lo demuestra **M5**).
- [x] **T2.5** Caso de R5, **exhaustivo sobre el enum**: iterar `Object.values(RolValue)` —importado
  como **valor** desde `@prisma/client`, patrón que ya usan `tests/unit/services/alcance-borrado-orden.test.ts:57`
  y `lib/auth/acceso-total.ts:5`— y afirmar que **todo** rol que no esté en la lista blanca escrita
  a mano en el test cae en R3+R4.
  **Hecho cuando:** pasa, la lista blanca del test está **escrita a mano** y el caso cubre los seis
  roles de hoy sin enumerarlos como excepciones sueltas.

---

## T3 — No regresión (R1, R2, R8) · depende de T1 · `[P]` con T4 y T5

- [x] **T3.1** Ejecutar **sin editarlos** los casos vigentes: «maestro y admin lo piden GLOBAL
  (`null`)» (R1, líneas 75-81), «`devoluciones_represadas` se pide con la ZONA del adminSatelite»
  (R2, 55-64), la mutación hermana de la 409 (66-73), «`novedades_sin_gestionar` se pide con el
  usuarioId de la tienda» (R8, 45-53), los de 417/R1-R4 (101-178), el umbral (180-190), el evento no
  agregado (192-202) y el default (204-213).
  **Hecho cuando:** todos pasan y **el diff de esos bloques está vacío**. Son el control positivo de
  la ficha: si la lista blanca dispara de más, se ponen rojos (**M3**, **M4**).
- [x] **T3.2** Comprobar por **diff**, no por palabra, que salen vacíos:
  `lib/repositories/NotificacionRepository.ts`, `lib/notificaciones/emitir.ts`,
  `lib/notificaciones/catalogo-avisos.ts` y `lib/services/AvisosDiariosService.ts` (R9).
  **Hecho cuando:** `git diff --stat dev...HEAD -- <esos cuatro>` sale **vacío**, pegado en la
  bitácora.

---

## T4 — Dónde aterriza el fallo (R10) · depende de T1

- [x] **T4.1** Caso nuevo en `tests/unit/services/notificacion-service.test.ts`, **con el molde del
  de la 417** (líneas 589-641, que usa el resolutor **real** + repositorio espía + logger espía):
  un actor de rol fuera de la lista blanca —p. ej. `{ rol: "mensajero" }`— y una fila de
  `devoluciones_represadas` visible para él.
  Debe afirmar **las dos mitades**: (a) el aviso **sale en el listado y sin número** —y
  **explícitamente NO** con `"7 órdenes esperan volver a su tienda"`, literal **escrito a mano**, que
  es el título que el total del sistema compondría (`catalogo-avisos.ts:289-293`)—, y (b) el
  **logger recibe el error** con la causa nombrada y **sin `usuarioId`**.
  **Hecho cuando:** pasa, **ningún caso existente del archivo cambia**, y lleva escrita la **nota de
  honestidad**: este caso construye a mano un estado que hoy el predicado de la 146 no deja llegar
  (defensa en profundidad, `design.md` §9.7).
  **Por qué hace falta otro, si la 417 dijo «basta uno»:** aquel argumento era que los dos fallos
  aterrizan en el mismo `catch`, y sigue siendo cierto. Éste se pide por otra razón: **es el único
  aserto que enseña el defecto en palabras** —bajo **M1** el `Received` es el número del total del
  sistema— y es la mitad de R10 que ningún test unitario del service cubre hoy para este rol.

---

## T5 — La lista blanca no puede divergir del catálogo (R7) · depende de T1 · `[P]` con T3 y T4

> **DECIDIDO el 2026-09-10: R7 ENTRA** (`requirements.md` §D1). Es lo que convierte la lista blanca
> de «escrita a mano» en «**derivada de una fuente**»: sin esto, el día que alguien añada un rol a
> `destinatarios` en el catálogo, la lista blanca se queda corta **y nada se pone rojo** — el mismo
> defecto que esta ficha existe para no repetir. No es opcional.

- [x] **T5.1** Caso nuevo en `tests/unit/services/vigencia-aviso-agregado.test.ts`: la lista blanca
  **escrita a mano** en el test coincide (como conjunto, sin depender del orden) con
  `CATALOGO_AVISOS.devoluciones_represadas.destinatarios`.
  **Hecho cuando:** pasa, y el test **importa el catálogo** pero **la lista blanca de producción NO
  lo importa** — si el service derivara su lista del catálogo, este aserto estaría siempre verde
  (`design.md` §7-B).

---

## T6 — Las mutaciones: el entregable de la ficha · depende de T2, T3, T4, T5

Árbol limpio **antes y después de cada una** (`git status --short`), y la salida **pegada** en
`progress/impl_418.md` con el conteo exacto de rojos **y el nombre de cada caso rojo**.

- [x] **T6.1 — M1 (la que da sentido a la ficha).** Volver a la lista negra:
  `if (actor.rol !== "adminSatelite") return this.repo.contarRepresadas(this.ancladaAntesDe(), null);`
  **Hecho cuando:** se ponen **rojos R3, R4, R5 y R10**, y lo hacen con
  `lib/repositories/NotificacionRepository.ts` **intacto** (`git diff --stat` de ese archivo, vacío,
  **en la misma corrida**) y **sin tocar las guardas de la 417**. Si sale verde, la ficha **no ha
  hecho nada** y hay que volver a T2.
- [x] **T6.2 — M1b, LA OTRA MITAD (la que midió el reviewer de la 417).** Restaurar los archivos al
  estado **anterior a esta ficha** (el `dev` de partida) y correr el mismo par de archivos de test.
  **Hecho cuando:** la suite sale **verde entera con el defecto delante**, y el número de casos
  verdes está pegado en la bitácora. Es lo que convierte «antes esto no lo veía nadie» en una
  **medida** y no en un argumento.
- [x] **T6.3 — M2.** Sustituir el lanzamiento nuevo por `return 0`.
  **Hecho cuando:** se pone **rojo R4** y **R3 queda VERDE** (el repositorio sigue sin llamarse).
  Demuestra que la ficha exige **ruido**, no silencio, y que los dos asertos están separados a
  propósito.
- [x] **T6.4 — M3 (control positivo).** Quitar `admin` de la lista blanca.
  **Hecho cuando:** se pone **rojo R1**, y por el caso de `admin`. Demuestra que los dos roles
  globales están cubiertos **uno a uno**.
- [x] **T6.5 — M4 (control positivo).** Quitar `adminSatelite` de la lista blanca.
  **Hecho cuando:** se pone **rojo R2** (y la mutación hermana de la 409, líneas 66-73). Demuestra
  que la protección nueva no cierra un ámbito legítimo.
- [x] **T6.6 — M5 (control contra el error equivocado).** Hacer que el error nuevo lleve el mensaje
  de otro de los dos fallos de ámbito del método.
  **Hecho cuando:** se ponen **rojos R4 y R6**. Si R4 sobrevive, su `rejects.toThrow` está casando
  con cualquier error y **no prueba nada**.
- [x] **T6.7 — M6.** Añadir `mensajero` a `destinatarios` de `devoluciones_represadas` en
  `catalogo-avisos.ts`.
  **Hecho cuando:** el caso de **R7 está entre los rojos, por nombre**. Pueden enrojecer también
  guardias ajenas (p. ej. la del atajo visible por rol): anótalo, no invalida la mutación.
- [x] **T6.8** Revertir **todas** y confirmar árbol limpio.
  **Hecho cuando:** `git status --short` y `git diff --numstat` salen vacíos respecto del estado
  previo a T6, y el par de archivos de test vuelve a pasar entero.

---

## T7 — Gate y cierre · depende de T6

- [x] **T7.1** `./init.sh --rapido`, con `INIT_EXIT=$?` escrito **dentro** del log y **sin canalizar
  por `tail`** (un `tail` en segundo plano trunca el fichero en origen y el rojo se queda sin
  nombre).
  **Hecho cuando:** el log dice `INIT_EXIT=0`, y los `skipped` se miran **uno a uno** (no sólo el
  exit code): sin `.env` en un worktree, la capa de datos se salta en silencio. Este diff **no** toca
  cimientos, así que el rápido **no debe negarse**; **si se niega, algo se tocó de más** — léelo
  antes de correr el completo.
- [x] **T7.2** Escribir `progress/impl_418.md` con: el mapa `R<n> → test`, la salida de **las siete**
  mutaciones (incluida M1b, la mitad verde), los diffs vacíos de T3.2 y las desviaciones.
  **Hecho cuando:** existe **y está commiteado** —tres veces en un día se quedó sin commitear en este
  repo— y el **blob commiteado** se ha verificado en la rama (el árbol no distingue «lo commiteé» de
  «alguien lo revirtió»).
- [x] **T7.3** Marcar en este archivo **todas** las casillas ejecutadas y dejar sin marcar las que no,
  **con el motivo en la propia línea**.
  **Hecho cuando:** no queda ninguna casilla ambigua.

---

## T8 — POST-DESPLIEGUE, no de esta ficha: medir el camino vigente en producción

> **NO ES PUERTA DE ESTA FICHA, y no por falta de acceso.** Medido por el orquestador el
> 2026-09-10: **el valor `devoluciones_represadas` no existe en el enum de producción** —la
> migración de la 409 está en `dev` sin desplegar—. No es que el caso no haya ocurrido: **el evento
> entero todavía no puede existir allí**. Eso sostiene «hoy no es alcanzable» por una vía más fuerte
> que la razonada, y a la vez **impide confirmarlo midiendo** hasta el despliegue.
>
> **El dato de hoy se reporta como lo que es —«el enum no tiene ese valor»— y NO como «salieron cero
> filas»**: son cosas distintas y la diferencia decide si estás midiendo algo o midiendo la nada.

- [ ] **T8.1** — **SIN MARCAR A PROPÓSITO, y el motivo: NO SE EJECUTA EN ESTA FICHA.** Es
  post-despliegue. El `SELECT` mide producción y allí el valor `devoluciones_represadas` **no existe
  en el enum** (la migración de la 409 está en `dev`, sin desplegar), así que hoy **no mediría cero:
  mediría la nada**. Queda anotada aquí para el día en que la 409 esté desplegada
  a producción. Correr entonces, en **solo lectura**:

  ```sql
  SELECT destinatario_rol, destinatario_usuario_id IS NOT NULL AS dirigida_a_usuario, count(*)
  FROM notificacion
  WHERE evento = 'devoluciones_represadas'
  GROUP BY 1, 2;
  ```

  **Cómo leer el resultado** (la tabla completa está en `design.md` §6):
  - **error «el valor no existe en el enum»** → es lo de hoy: no estás midiendo cero, estás midiendo
    **la nada**;
  - **cero filas** → «aún no ha pasado», **no** «está bien»: producción se vació a propósito el
    2026-08-25;
  - **sólo `maestro`, `admin` y `adminSatelite`**, con `dirigida_a_usuario = false` → lo esperado, y
    ahora **medido**;
  - **cualquier otro rol, o `dirigida_a_usuario = true`** → **PARA Y DILO**: el camino sí es
    alcanzable y la frase «nadie verá un cambio de comportamiento» deja de ser cierta (el diseño no
    cambia; la comunicación sí).

  **Hecho cuando:** el resultado y su lectura están pegados donde corresponda **el día del
  despliegue**. La corre el orquestador: la `DATABASE_URL` de producción es *sensitive* y el MCP de
  Supabase puede no estar en el conjunto de herramientas del implementer (pasó en la 417/T8.1).

---

## Trazabilidad `R<n> → test`

| R | Qué exige | Test concreto |
| --- | --- | --- |
| **R1** | `maestro`/`admin` → ámbito global (`null`) | `tests/unit/services/vigencia-aviso-agregado.test.ts` › caso vigente «maestro y admin lo piden GLOBAL», **sin editar** (T3.1). Control positivo de **M3** |
| **R2** | `adminSatelite` con zona → **esa** zona | mismo archivo › caso vigente «se pide con la ZONA del adminSatelite», **sin editar** (T3.1). Control positivo de **M4** |
| **R3** | rol fuera de la lista blanca → no se consulta ningún ámbito | mismo archivo › casos nuevos, `not.toHaveBeenCalled()` para los tres roles (T2.1) |
| **R4** | ese caso **falla nombrado**, y **no devuelve `0`** ni el total | mismo archivo › `rejects.toThrow(...)` con literal a mano ×3 (T2.2) + el caso del `7` del espía (T2.3) |
| **R5** | decisión **por inclusión**, exhaustiva sobre el enum de roles | mismo archivo › caso que itera `Object.values(RolValue)` (T2.5) |
| **R6** | el error es **distinguible** y **sin PII** | mismo archivo › caso que niega las dos regex hermanas y el `usuarioId` (T2.4). Lo valida **M5** |
| **R7** | la lista blanca no diverge del catálogo | mismo archivo › caso que compara contra `CATALOGO_AVISOS.devoluciones_represadas.destinatarios` (T5.1). Lo valida **M6** |
| **R8** | los demás caminos del resolutor, intactos | mismo archivo › los ocho bloques vigentes con **diff vacío** (T3.1) |
| **R9** | 146, emisor y catálogo no se tocan | `git diff --stat` **vacío** de los cuatro archivos de T3.2 |
| **R10** | el aviso se muestra **sin número** y el fallo se **registra** | `tests/unit/services/notificacion-service.test.ts` › caso nuevo con el resolutor real + logger espía (T4.1) |
| **R11** | volver a la exclusión pone algo en **rojo**, y antes salía verde | **M1** (T6.1) **y M1b** (T6.2), con `NotificacionRepository.ts` intacto medido en la misma corrida |

---

## Archivos que toca la implementación (esperado)

| Archivo | Qué |
| --- | --- |
| `lib/services/VigenciaAvisoAgregadoService.ts` | la lista blanca (**único archivo de producción con cambio de comportamiento**) |
| `lib/interfaces/services/IVigenciaAvisoAgregado.ts` | documentación del contrato: el tercer caso de lanzamiento. **Sin cambio de firma** |
| `tests/unit/services/vigencia-aviso-agregado.test.ts` | **sólo añade** casos (R3-R7). **No edita ni borra ninguno** |
| `tests/unit/services/notificacion-service.test.ts` | **añade** un caso (R10) |
| `progress/impl_418.md` | bitácora |
| `specs/418-alcance-represadas-lista-blanca/tasks.md` | casillas |

**Nada más.** Si el diff toca `db/`, `app/`, `components/`, el catálogo, el emisor o cualquier otro
servicio, **para**: eso ya no es esta ficha. (M6 **muta** el catálogo y lo **revierte**; eso no es un
cambio del diff.)

---

## Antes de empezar

**CERO preguntas abiertas.** Las dos del borrador se cerraron el 2026-09-10 y están firmadas en
`requirements.md` §Preguntas abiertas:

- **D1 — R7 entra** (T5 y M6 son obligatorias, no opcionales).
- **D2 — la medición contra producción no aplica todavía**: el evento **no existe en el enum de
  producción**, así que T8 es **post-despliegue** y **no se ejecuta en esta ficha**.

**Si al implementar apareciera un cuarto rol legítimo para este aviso, o una razón real por la que
`mensajero`/`adminTienda`/`apiKey` deban obtener el ámbito global, para y dilo** en vez de forzar la
lista blanca: sería un dato nuevo, y este spec se corrige, no se cumple a ciegas.
