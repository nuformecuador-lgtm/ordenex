# 412 — Al mensajero le avisan cuando le rechazan un cierre

> Requisitos en EARS. Sin detalle de implementación (eso vive en `design.md`).
> **26 requisitos** (R1–R26). El mapa `R<n> → test` está en §9; las decisiones del humano, en §10.
> **Preguntas abiertas: ninguna** (§11) — las tres las cerró el humano el 2026-09-11.
> Ficha `backend`, `sdd: true`, complejidad **baja**. **Preventiva:** hoy en producción hay **0**
> cierres rechazados (§0.1), así que nadie verá un cambio al desplegar.

---

## §0 — Qué se midió antes de escribir esto (2026-09-10, en el árbol real)

El lienzo aprobado por el humano (`design-notificaciones/Push.dc.html`, `PorRol.dc.html`) promete al
mensajero el aviso **«tu cierre fue rechazado»**. Se buscó en el código y **no existe**. Lo que sí
existe, medido archivo por archivo:

| Qué | Dónde | Qué dice de verdad |
| --- | --- | --- |
| El enum `NotificacionEvento` tiene **13** valores y ninguno es un rechazo de cierre | `db/schema.prisma:2636-2669` | el más cercano es `mensajero_bloqueado_por_cierres` |
| El **único** punto donde se rechaza un cierre del día | `CierresAdminService.rechazarCierre` (`lib/services/CierresAdminService.ts:1400`) | rama `updated` → `avisarBloqueoPorRechazo` |
| Ese aviso **se salta entero** si el mensajero no queda bloqueado | `CierresAdminService.ts:307` — `if (!bloqueo.bloqueado) return;` | un rechazo que no bloquea **no emite nada** |
| Lo que el mensajero lee cuando SÍ bloquea | `avisoBloqueo` (`lib/constants/bloqueo-mensajero.ts:89`) | «Tienes un cierre sin enviar a aprobación…» — **la palabra «rechazado» no aparece en ningún aviso del sistema** |

**Y hay tres agujeros, no uno.** Al medir la regla de bloqueo se descubrió que el enunciado de la
ficha se queda corto, así que queda escrito tal como está en el código y no como se supuso:

1. **El aviso que sale nunca dice que hubo un rechazo.** `estaBloqueadoPorCierres({n,v}) = n>=2 || v>=1`
   (`lib/utils/bloqueo-cierre.ts:73`) y un cierre `rechazado` suma a `V`
   (`CIERRE_ESTADOS_RESOLICITABLES`), así que **un rechazo casi siempre bloquea** y el aviso de
   bloqueo casi siempre sale. Pero su texto es **el mismo** que recibe quien dejó vencer su cierre:
   «Tienes un cierre sin enviar a aprobación». El mensajero **no puede distinguir «venció» de «me lo
   rechazaron»**, y sólo el segundo exige **corregir algo** antes de reenviar.
2. **El SEGUNDO rechazo del mismo cierre no avisa NUNCA, en silencio.** La entidad del aviso de
   bloqueo es el cierre (`entidadTipo: "cierre_dia"`, `entidadId: cierreId`,
   `lib/notificaciones/emitir.ts:646`) y `notificacion_dedupe_key` es UNIQUE sobre
   `(evento, entidad_id, destinatario_rol, destinatario_usuario_id)`; `NotificacionRepository.crear`
   absorbe el `P2002` devolviendo `false` (`:119`). Y el ciclo **rechazo → re-solicitud → rechazo**
   es el ciclo normal de esta pantalla: `rechazado` es re-solicitable y
   `transicionarASolicitado` **reutiliza la misma fila de `cierre_dia`**
   (`CierreDiaRepository.ts:616`). Es el fallo que documentaron la 262 y la 403, vivo.
3. **El caso literal del título de la ficha existe y es mudo:** si el mensajero re-solicita el cierre
   entre la escritura del rechazo y la lectura de `findBloqueoDetalle` —la carrera que el propio
   comentario de `CierresAdminService.ts:304` reconoce—, `bloqueado` es `false` y **no sale nada**.

**Por qué importa:** el cierre es **el dinero del mensajero**. Mientras esté rechazado no se liquida
y él no puede entregar, cobrar ni recibir trabajo nuevo. Está medido que **8 de 18 mensajeros no han
abierto nunca una notificación** (409, §contexto), así que el aviso que no sale hoy tampoco lo
sustituye «entrar a mirar».

### §0.1 — En producción no ha pasado NUNCA (medido por el humano el 2026-09-11)

**Cero cierres rechazados en toda la historia.** Desde el arranque comercial del 2026-08-27:
**78 `aprobado`, 5 `solicitado`, 0 `rechazado`.** Luego tampoco ha habido ningún segundo rechazo.

Ese número tira en **dos direcciones opuestas, y las dos cuentan**:

1. **Esta ficha es PREVENTIVA**, como la 417 y la 418. **Nadie verá un cambio al desplegar**, y eso
   no es un defecto de la ficha: es la medida de su riesgo. Un cero aquí significa «aún no ha
   pasado», no «está roto» ni «no puede pasar» — producción se vació el 2026-08-25 y el negocio
   arrancó el 27.
2. **Y aun así el agujero 2 de arriba es un fallo REAL y VIVO en el código de hoy.** La entidad del
   aviso de bloqueo es `cierreId` y la re-solicitud reutiliza la misma fila: el segundo rechazo
   **no avisaría nunca, en silencio**. Es el fallo de las fichas 262 y 403 **esperando al primer
   caso**. Que no haya ocurrido no lo hace menos cierto: **lo hace más barato de arreglar ahora**,
   porque no hay ninguna fila previa que migrar ni ningún aviso vivo que respetar.

---

## §1 — El aviso que falta

- **R1** — CUANDO un rechazo de un cierre del día **confirme su escritura** (la transición de estado
  se aplicó), el sistema DEBE emitir un aviso dirigido **al mensajero dueño de ese cierre** que diga
  que su cierre fue rechazado, **con independencia de si ese rechazo lo deja bloqueado o no**.
- **R2** — El aviso de R1 DEBE dirigirse **exclusivamente** a ese mensajero; el sistema NO DEBE crear
  ninguna fila de este aviso dirigida a un rol.
- **R3** — SI el rechazo **no** confirma su escritura —motivo vacío, conflicto de estado, cierre
  fuera del alcance del actor o inexistente—, ENTONCES el sistema NO DEBE emitir ningún aviso.
- **R4** — La emisión del aviso NO DEBE ejecutarse dentro de la transacción del rechazo, NO DEBE
  alterar lo que la operación devuelve —tampoco cuando la emisión falle—, y su fallo DEBE quedar
  **registrado con su operación y su causa**, nunca absorbido en silencio.
- **R5** — SI la emisión del aviso al mensajero falla, ENTONCES el aviso que este mismo rechazo
  dirige a la administración (§4) DEBE emitirse igualmente, y al revés.
- **R6** — El emisor **real** de este aviso DEBE estar **pasado como argumento** en el punto de
  composición del rechazo; el valor por defecto del servicio DEBE seguir siendo el emisor nulo.

## §2 — Dos rechazos son dos avisos (la entidad)

- **R7** — CUANDO el **mismo cierre** se rechace por segunda vez —después de que el mensajero lo
  haya vuelto a enviar a aprobación—, el sistema DEBE emitir un **segundo** aviso, **aunque el
  primero siga sin leerse**.
- **R8** — CUANDO la emisión del aviso de **un mismo rechazo** se repita, el sistema NO DEBE crear
  una segunda fila para ese rechazo.
- **R9** — La exclusión de R8 DEBE ser **estructural** —la restricción de unicidad de la tabla de
  notificaciones—, no una comprobación previa que una carrera pueda burlar.
- **R10** — SI dos mensajeros distintos reciben un rechazo el mismo día, ENTONCES **cada uno** DEBE
  recibir su propio aviso.

## §3 — Qué dice el aviso

- **R11** — El texto DEBE nombrar la **jornada** que ese cierre cierra, derivada con el **mismo y
  único derivador** que usan la pantalla del mensajero y los avisos vigentes de cierre.
- **R12** — SI no hay jornada fiable para ese cierre, ENTONCES el texto DEBE **omitir la fecha** y NO
  DEBE inventar ninguna.
- **R13** — El texto DEBE decir la acción que le toca al mensajero —revisarlo, corregirlo y volver a
  enviarlo a aprobación—, y el aviso DEBE llevar a la pantalla donde la ejecuta.
- **R14** — SI el rechazo deja al mensajero **bloqueado**, ENTONCES el texto DEBE decir qué no puede
  hacer mientras tanto, **con la misma frase única** con la que el servidor y la pantalla ya lo
  dicen; el sistema NO DEBE introducir una redacción propia de esa consecuencia.
- **R15** — SI el rechazo **no** deja al mensajero bloqueado, ENTONCES el texto NO DEBE afirmar
  ninguna consecuencia de bloqueo.
- **R16** — El texto NO DEBE contener el motivo que escribió quien rechazó, ni número de guía, ni
  remisión, ni dirección, ni teléfono, ni nombre de persona, ni monto; y el aviso NO DEBE llevar
  anexo.

## §4 — Convivencia con el aviso de bloqueo (anti-ruido)

- **R17** — CUANDO un rechazo confirme, el mensajero DEBE recibir por ese hecho **exactamente un**
  aviso, y ese aviso DEBE ser el de R1.
- **R18** — CUANDO un rechazo confirme y deje bloqueado al mensajero, el sistema DEBE seguir
  emitiendo a la administración —maestro, admin y la bodega satélite de la zona destino— el aviso de
  bloqueo vigente, **sin cambiarle el texto, la entidad ni su deduplicación**.
- **R19** — El sistema NO DEBE alterar el comportamiento del aviso de bloqueo en sus **otros**
  productores (la solicitud de cierre y el corte diario): ni a quién llega, ni qué dice, ni cuándo.

> ⚠️ **R17 cambia un comportamiento de la 271, y el riesgo es CERO MEDIDO.** Quien lea esto dentro
> de seis meses va a preguntarse cómo se coló un cambio en un aviso vivo: no se coló, y **ese
> comportamiento nunca se ha ejercido**. Producción, 2026-09-11: **0 cierres `rechazado` en toda la
> historia** (§0.1), así que la fila de `mensajero_bloqueado_por_cierres` que el rechazo dirige al
> mensajero **no se ha emitido jamás**. Lo que sí está vivo es el texto que la sustituye: hoy el
> mensajero leería «Tienes un cierre sin enviar a aprobación», **idéntico a lo que leería por un
> `vencido`**, y sólo el rechazo exige **corregir algo** antes de reenviar. Dos avisos para un
> trabajo es ruido; **un aviso que no distingue dos situaciones que piden acciones distintas es peor
> que ruido**. Decisión del humano del 2026-09-11 (§10, D1).

## §5 — El panel de notificaciones (lo que la 409 ya decide)

- **R20** — El evento nuevo DEBE tener entrada **explícita** en el catálogo de avisos; un valor del
  enum sin declarar DEBE impedir la compilación.
- **R21** — El aviso DEBE declararse **accionable** para el rol `mensajero`, con **atajo** a la
  pantalla donde corrige su cierre; ese destino DEBE ser una ruta que **existe** y que ese rol **ve**.
- **R22** — MIENTRAS el aviso esté vigente para su destinatario, DEBE contar en el distintivo de
  «por hacer» y pintarse en el bloque «Requieren tu acción» con su botón de atajo.

## §6 — Push (lo que la 410 exige decidir)

- **R23** — DONDE exista el catálogo de elegibilidad de push, el evento nuevo DEBE estar declarado
  **elegible** para el destinatario **usuario** (el mensajero) y **no elegible** para cualquier otro
  perfil; el catálogo NO DEBE compilar con este evento sin decidir.

## §7 — Datos y seguridad

- **R24** — La migración que amplía los enums DEBE ser reversible, su reversión NO DEBE eliminar
  valores añadidos por otras fichas, y DEBE reconstruir **todas** las columnas que usen el tipo
  recreado.
- **R25** — SI al revertir quedan filas que usan los valores nuevos, ENTONCES la reversión DEBE
  fallar de forma ruidosa; el sistema NO DEBE borrar ni reescribir filas para «hacer sitio».
- **R26** — El sistema NO DEBE modificar el predicado de visibilidad de notificaciones ni la
  autorización de ninguna de sus operaciones, ni la autorización del rechazo de cierres.

---

## §8 — Fuera de alcance (declarado, no olvidado)

- **El rechazo de un cierre de BODEGA** (`CierresBodegaAdminService.rechazarCierreBodega`): es otro
  cierre, de otro dueño (la bodega satélite) y otro dinero. Hoy **no emite nada**, y eso es simétrico
  a este agujero. **Queda como ficha POSIBLE, no como deuda de ésta** (decisión del humano del
  2026-09-11, D2). No se toca aquí.
- **Traducir el motivo del rechazo** en el detalle del cierre: es la ficha 408, y la contradicción
  del comprobante es la 414.
- **El canal de push** (permiso, suscripción, service worker, cupo diario): es la 410. Esta ficha
  sólo aporta **una línea de catálogo** (R23).
- **Cambiar la regla de bloqueo** (`estaBloqueadoPorCierres`): no se toca ni un carácter. Que un
  rechazo casi siempre bloquee es una decisión de la 271 que sigue vigente.
- **Retirar el aviso de bloqueo a la administración**: sigue igual (R18).

---

## §9 — Mapa `R<n> → test`

> Ruta y nombre **propuestos**; el implementer los confirma en `progress/impl_412.md`.
> **Los literales de texto se afirman a mano**, nunca comparándolos contra la función que los
> compone (lección «aserción contra su propia fuente»).
> Los tests de `tests/integration/db/**` **sólo corren con `DATABASE_URL` resoluble**: si el gate los
> reporta `skipped`, esta ficha **no está verificada**.

| R | Test | Aserto que se pone ROJO si el código está mal |
| --- | --- | --- |
| R1 | `tests/unit/services/cierres-admin-aviso-rechazo.test.ts` | rechazo que **confirma** con un mensajero NO bloqueado (doble de `findBloqueoDetalle` con `bloqueado: false`) → el notificador de rechazo se llama **1 vez** con el `mensajeroUsuarioId` del cierre. **Mutación:** meter la emisión dentro del `if (bloqueo.bloqueado)` ⇒ rojo |
| R2 | `tests/unit/notificaciones/cierre-rechazado-aviso.test.ts` | el emisor produce **una sola** fila y su destinatario es `{tipo:"usuario"}`; `queryAll` de filas con `tipo:"rol"` es vacío. **Mutación:** añadir `maestro` ⇒ rojo |
| R3 | `tests/unit/services/cierres-admin-aviso-rechazo.test.ts` | tres casos: `conflict`, `no_encontrada` y motivo vacío → el notificador **no** se llama (ninguno de los dos) |
| R4 | `tests/unit/services/cierres-admin-aviso-rechazo.test.ts` | (a) el notificador **lanza** → `rechazarCierre` sigue devolviendo `{status:"ok"}` y el logger recibe un error que nombra la operación; (b) al emisor **no** se le pasa ningún cliente transaccional |
| R5 | `tests/unit/services/cierres-admin-aviso-rechazo.test.ts` | el notificador de rechazo lanza → el de bloqueo **sí** se llama; y al revés. **Mutación:** envolver los dos en un solo `emitirBestEffort` ⇒ rojo |
| R6 | `tests/unit/services/notificacion-notificadores-reales.test.ts` (ampliar) | sobre el fuente **sin imports ni comentarios** de `lib/actions/cierres-admin.ts`: `new CierresAdminService(…)` **PASA** `notificarCierreDiaRechazadoReal`. **Mutación obligatoria:** borrar el argumento dejando el import ⇒ rojo |
| R7 | `tests/integration/db/cierre-rechazado-aviso-dedupe.test.ts` | Postgres real: siembra cierre → rechaza → re-solicita → rechaza → **2 filas** de `cierre_dia_rechazado` para ese mensajero, **sin marcar ninguna como leída**. **Mutación obligatoria:** entidad = `cierreId` ⇒ **1 fila** ⇒ rojo. Autocomprobación: con 0 filas sembradas el test debe FALLAR, no pasar por vacío |
| R8 | `tests/integration/db/cierre-rechazado-aviso-dedupe.test.ts` | dos emisiones del **mismo** rechazo (mismo `resuelto_at`) → **1 fila** |
| R9 | `tests/integration/db/cierre-rechazado-aviso-dedupe.test.ts` | las dos emisiones de R8 se lanzan con `Promise.all` sobre conexiones distintas → **1 fila** y ningún error propagado (lo decide el índice único, no un `if`) |
| R10 | `tests/integration/db/cierre-rechazado-aviso-dedupe.test.ts` | dos mensajeros, un rechazo cada uno el mismo día → **2 filas**, una por destinatario |
| R11 | `tests/integration/db/cierre-rechazado-jornada-sql-real.test.ts` | la jornada del cierre rechazado sale de las **gestiones vinculadas y no anuladas**, no de `created_at`: cierre creado el día D con gestiones del día D−1 → el texto dice D−1. **Mutación:** anclar en `created_at` ⇒ rojo |
| R12 | `tests/unit/notificaciones/cierre-rechazado-aviso.test.ts` | literal a mano: con jornada `null` el texto es `"Tu cierre del día fue rechazado. Revísalo, corrígelo y vuelve a enviarlo a aprobación."` y **no contiene ninguna cifra de fecha** |
| R13 | `tests/unit/notificaciones/cierre-rechazado-aviso.test.ts` + `tests/unit/guards/atajo-aviso-ruta-visible.guardia.test.ts` | literal a mano de la frase de acción; y el destino declarado del evento es `/cierre-dia` |
| R14 | `tests/unit/notificaciones/cierre-rechazado-aviso.test.ts` + `tests/unit/constants/bloqueo-textos.test.ts` (ampliar) | con `bloqueado: true` el texto **termina** con la frase `"Mientras tanto no puedes entregar, cobrar ni recibir trabajo nuevo."` escrita a mano; y una guardia de árbol afirma que esa frase **existe una sola vez** en el repo y que el emisor la **importa** en vez de reescribirla. **Mutación:** copiar la frase a `emitir.ts` ⇒ rojo |
| R15 | `tests/unit/notificaciones/cierre-rechazado-aviso.test.ts` | con `bloqueado: false` el texto **no contiene** «Mientras tanto» ni «no puedes». **Mutación:** poner la frase siempre ⇒ rojo |
| R16 | `tests/unit/notificaciones/cierre-rechazado-aviso.test.ts` | el texto no contiene el motivo pasado en el contexto (se pasa un motivo-cebo con un teléfono dentro), ni `₡`, ni dígitos de guía; y `anexo === null` |
| R17 | `tests/unit/services/cierres-admin-aviso-rechazo.test.ts` | rechazo que bloquea → el notificador de bloqueo se invoca con alcance **`solo_bodega`** y el de rechazo una vez ⇒ **una sola fila para el mensajero** en total. **Mutación obligatoria:** pasar `mensajero_y_bodega` ⇒ rojo |
| R18 | `tests/unit/notificaciones/mensajero-bloqueado-aviso.test.ts` (ampliar) | con alcance `solo_bodega` salen las filas de `maestro`, `admin` y `adminSatelite` de la zona, con el **mismo texto y la misma entidad** de hoy, y **ninguna** de usuario |
| R19 | `tests/unit/services/cierre-dia-service.test.ts` (vigente) + suites de la 271 | siguen verdes **sin editarlas** salvo el argumento nuevo obligatorio; el productor de la solicitud emite con alcance `mensajero_y_bodega` |
| R20 | `tests/unit/notificaciones/catalogo-avisos.test.ts` (vigente) + `pnpm run typecheck` | el catálogo cubre **todos** los valores del enum del cliente Prisma, ahora 14; borrar la entrada nueva no compila |
| R21 | `tests/unit/guards/atajo-aviso-ruta-visible.guardia.test.ts` (vigente) | recorre los destinos y afirma contra `SIDEBAR_ITEMS` que `/cierre-dia` existe y es visible para `mensajero`. **Mutación:** declarar `/cierres-admin` como destino del mensajero ⇒ rojo |
| R22 | `tests/unit/services/notificacion-service.test.ts` (ampliar) | una fila de este evento para un actor `mensajero` → `accionable: true`, entra en `porHacer` y su `atajo.etiqueta` es la declarada |
| R23 | `tests/unit/notificaciones/push-elegibles.test.ts` (de la 410) + `pnpm run typecheck` | el par (evento, `usuario`) es elegible y (evento, cualquier rol) no lo es. **Si el archivo aún no existe en `dev`**, este requisito se cierra en la 410 —que está **en revisión** el 2026-09-11 y muy probablemente entre antes— y la tarea T6.1 (rama B) lo deja anotado |
| R24 | `tests/integration/db/notificacion-evento-cierre-rechazado-migration.test.ts` | aplica y revierte contra Postgres real; tras el `down` quedan **exactamente** los valores previos leídos de `origin/dev` (hoy 13 eventos y 11 entidades) y el índice `notificacion_dedupe_key` conserva su `NULLS NOT DISTINCT` y su `WHERE entidad_id IS NOT NULL`. **Mutación:** quitar una columna del `ALTER COLUMN` del down ⇒ el `DROP TYPE` falla ⇒ rojo |
| R25 | `tests/integration/db/notificacion-evento-cierre-rechazado-migration.test.ts` | con una fila de `notificacion` usando el valor nuevo, el `down` **aborta** y la fila **sigue ahí** |
| R26 | `tests/unit/repositories/notificacion-visibilidad.test.ts` y las suites de autorización de `cierres-admin` (vigentes) | siguen verdes **sin editarlas** |

---

## §10 — Decisiones del humano incorporadas (2026-09-11)

Las tres preguntas que abrió el borrador las **cerró el humano** el 2026-09-11. Se dejan escritas
porque cada una fija un límite, y un límite que no está escrito se lee como un olvido.

| # | Decisión | Dónde vive en este spec |
| --- | --- | --- |
| **D1** | **SÍ: el mensajero recibe UN aviso, el que dice la verdad.** La fila de `mensajero_bloqueado_por_cierres` dirigida a él deja de emitirse en la rama del rechazo; la de la bodega sigue igual. **El riesgo es cero medido:** ese comportamiento **nunca se ha ejercido** (0 cierres `rechazado` en toda la historia, §0.1). Lo que sustituye sí está vivo: hoy leería el **mismo texto que por un `vencido`**, y sólo el rechazo exige corregir algo | R17, R18, R19 y su nota · `design.md §6` |
| **D2** | **El rechazo de un cierre de BODEGA queda FUERA**, y se anota como **ficha posible**, no como deuda de ésta | §8 |
| **D3** | **Medido: 0 cierres rechazados en producción** (78 `aprobado`, 5 `solicitado`) desde el arranque comercial del 2026-08-27. La ficha es **preventiva** —como la 417 y la 418— y **el agujero 2 de §0 sigue siendo un fallo real del código**, esperando al primer caso | §0.1 · `tasks.md` T0.1 |

## §11 — Preguntas abiertas

**Ninguna.** Las tres quedaron cerradas el 2026-09-11 (§10).
