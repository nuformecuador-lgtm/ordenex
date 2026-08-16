# Feature 229 — Rastreo público del envío · tasks.md

> Checklist de pasos discretos y verificables. `[P]` = paralelizable con las tareas de su mismo
> bloque. Cada task lleva su criterio de «hecho».
>
> **✅ SPEC CERRADO — PUERTA HUMANA PASADA (2026-08-15).** El humano firmó «todo por defecto»: las
> catorce decisiones (G1–G14) están registradas en `requirements.md` §Decisiones del gate. **No
> quedan preguntas abiertas y todas las tareas pueden ejecutarse.** Los valores concretos (4 dígitos
> del segundo factor, 8 intentos / 10 min por IP, mapeo de los 20 estatus, DTO de 4 campos) ya no se
> deciden: **se copian de la tabla firmada.** Ninguno se re-abre en implementación.
>
> **Antes de escribir código, leer `design.md` §5.bis y §5.ter: dos riesgos ACEPTADOS a conciencia**
> (el limitador en memoria no frena a un atacante distribuido; `sin_gestionar` se muestra como «En
> reparto» y oculta al cliente un fallo operativo). No son bugs ni hallazgos: no se «arreglan».
>
> Gate de verificación: `./init.sh --rapido` al cerrar cada tanda; **`./init.sh` completo antes del
> PR, sin excepción** (`docs/verification.md`).

---

## Bloque 0 — PUERTA **PASADA** (2026-08-15) · el resto de bloques está DESBLOQUEADO

- [x] **T0.1 — Firmas del gate humano** (D1, D2, D3). **PASADA el 2026-08-15**: respuesta literal
  «todo por defecto» = se aceptan las catorce propuestas del spec sin excepción.
  **Hecho:** `requirements.md` §Decisiones del gate registra G1–G14 con su fecha y su porqué; las
  alternativas descartadas quedan reducidas a una línea para que nadie las re-abra. *Ya no bloquea
  nada.*
- [x] **T0.2 [P] — Corregir la ficha `feature_list.json` (id 229).** Su `description` dice
  «`ORDER_STATUS_SEED` son 19 estados internos»; son **20** (`lib/types/order-status.ts:54-79`,
  `tests/unit/types/order-status.test.ts:78` afirma `toHaveLength(20)`). La ficha es anterior a
  `recolectando` (feature 157).
  **Hecho:** la ficha dice 20. *Lo hace el leader.* No bloquea, pero se hace antes de T2.2 para que
  el mapeo no nazca corto. *(Verificado el 2026-08-15: la ficha ya decía 20 —el leader la corrigió al
  renumerar 223→229—, así que no hizo falta editarla.)*
- [x] **T0.3 [P] — Registrar las consecuencias y riesgos aceptados** en `progress/impl_229.md`: F2,
  F3, F4, F6 (design §0) **más los dos riesgos firmados**, §5.bis (limitador en memoria: acota al
  torpe, no al decidido) y §5.ter (`sin_gestionar` se ve como «En reparto»).
  **Hecho:** los seis están escritos como decisiones, no como pendientes. Cubre la parte documental
  de **R5** y **R35**.
- [x] **T0.4 — Medir cuántas órdenes tienen `telefono_dest` con menos de 4 dígitos** (G1/G2):
  `SELECT count(*) FROM orden WHERE length(regexp_replace(telefono_dest,'\D','','g')) < 4;`
  **Hecho:** la salida está en `progress/impl_229.md` con fecha y entorno. *Es informativa: NO
  reabre G2, cuantifica cuántos destinatarios quedan sin rastreo (design §8.3).*

---

## Bloque 1 — Tipos, configuración y mapeo (DESBLOQUEADO: T0.1 pasada)

- [x] **T1.1 — `lib/types/rastreo-publico.ts`**: `HitoPublico`, `HitoPublicoEntrada`,
  `RastreoPublicoDTO`, `ResultadoRastreoPublico` y `consultaRastreoSchema` (design §3.1/§3.2).
  **Hecho:** typecheck verde; ningún `any`; el módulo NO importa `repositories/`, `services/`,
  `@/lib/db` ni `next/headers` (debe ser usable desde el Client Component).
- [x] **T1.2 — `HITO_POR_ESTATUS` como `Record<OrderStatusValue, HitoPublico>` TOTAL** + `HITO_POR_DEFECTO`
  + `hitoDeEstatus(value: string)` (design §3.3), transcribiendo **literalmente** la tabla firmada de
  `requirements.md` §D2 (incluidos `recolectando → registrado`, `incidente → no_entregado` y
  `sin_gestionar → en_reparto`).
  **Hecho:** los 20 values del seed tienen hito y coinciden uno a uno con la tabla firmada; typecheck
  verde; `hitoDeEstatus` acepta `string`.
- [x] **T1.3 — Guardia de exhaustividad del mapeo**
  `tests/unit/guards/rastreo-hitos-exhaustivo.guardia.test.ts`.
  **Hecho:** recorre `ORDER_STATUS_SEED` y falla si falta un value; comprueba que un value huérfano
  (fuera del seed) cae en `HITO_POR_DEFECTO`; y verifica que ningún texto público del vocabulario
  coincide con un `order_status.value`. Cubre **R16, R17**.
- [x] **T1.4 [P] — `lib/config/rastreo-publico.ts`**: máximo de intentos (**defecto 8**), ventana
  (**defecto 10 min**) y dígitos del segundo factor (**defecto 4**), por variable de entorno con
  defecto en código (patrón `lib/config/auth.ts:37-51`).
  **Hecho:** con la variable puesta, el valor efectivo cambia; sin ella, el defecto. Cubre **R10**.

Dependencias: T1.2 ← T1.1; T1.3 ← T1.2.

---

## Bloque 2 — Backend (depende del Bloque 1)

- [x] **T2.1 [P] — Interfaces** `lib/interfaces/services/IRastreoPublicoService.ts` y
  `lib/interfaces/repositories/IRastreoPublicoRepository.ts`.
  **Hecho:** typecheck verde; un archivo por interfaz, sin implementación dentro.
- [x] **T2.2 — `lib/repositories/RastreoPublicoRepository.ts`**: `buscarPorGuia(numGuia)` (select
  explícito: `id`, `numGuia`, `telefonoDest`, `deletedAt`) y `listarTransiciones(ordenId)` (select
  explícito: `createdAt` + `estatusDestino.value`), design §1.
  **Hecho:** solo Prisma, sin lógica de negocio; ningún `select` menciona `actorUsuarioId`,
  `origenTipo`, `motivo`, `gestionOrdenId`, `direccion`, `montoCobrar`, `producto`, `notas`,
  `destinatario` ni `mensajeroAsignadoId`.
- [x] **T2.3 — `lib/services/RastreoPublicoService.ts`**: identificación, comparación de los **4
  últimos dígitos** normalizados **sin corte temprano** (design §2.3, paso 5), orden con teléfono
  de menos de 4 dígitos tratada como **no consultable** (G2), mapeo de hitos, colapso de rachas
  (G9) y construcción del DTO de 4 campos.
  **Hecho:** construible con dobles; sin import de Prisma ni `next/headers`; el DTO se construye
  campo a campo, nunca por *spread* de una fila.
- [x] **T2.4 — Tests unitarios del service** `tests/unit/services/rastreo-publico-service.test.ts`.
  **Hecho:** cubre **R6, R7, R8, R11, R14, R18, R20, R21, R33**.
- [x] **T2.5 — `lib/actions/rastreo-publico.ts`** (`'use server'`): zod, IP de `x-forwarded-for`
  (patrón `postulacion-mensajero.ts:38-45`), `ResetRateLimiter` a nivel de módulo con clave
  `rastreo:<ip>` — **solo la IP, la guía NO entra en la clave** (G4) —, resultado discriminado.
  **Hecho:** no importa `resolveActorFromSession`; sin `catch` vacíos; el limitador y sus umbrales
  vienen de T1.4; una guardia comprueba que la clave no incorpora el `numGuia`.
- [x] **T2.6 — Tests de la action** `tests/unit/actions/rastreo-publico-action.test.ts`.
  **Hecho:** cubre **R2, R9, R10, R32**; superado el límite, el doble del service **no** recibe
  llamadas.
- [x] **T2.7 — Test de integración del repositorio**
  `tests/integration/repositories/rastreo-publico.int.test.ts`.
  **Hecho:** con datos reales, la línea de tiempo sale ordenada asc y una sola consulta; la orden con
  `deleted_at` no se encuentra. Cubre **R21** (parte de datos) y **R7** (caso c).

Dependencias: T2.2 ← T2.1; T2.3 ← T2.2/T1.2; T2.5 ← T2.3/T1.4.

---

## Bloque 3 — UI (depende del Bloque 2)

- [x] **T3.1 — `app/_landing/RastreoDialog.tsx`** (`"use client"`): `Dialog` + formulario +
  resultado en el mismo diálogo, estado de carga, mensaje único de rechazo, limpieza al cerrar
  (design §4.2).
  **Hecho:** solo primitivas de `components/ui/dialog.tsx`; `DialogContent` lleva `tema-claro`
  explícito (se portalea fuera del subárbol claro de la landing); `pnpm run lint` verde.
- [x] **T3.2 — Tests del diálogo** `tests/components/RastreoDialog.test.tsx`.
  **Hecho:** cubre **R26, R27, R28, R30, R31**; incluye el caso «con `.dark` en `<html>`, el
  diálogo conserva la paleta clara».
- [x] **T3.3 — Activar el disparador en `app/_landing/LandingNav.tsx`**: quitar `disabled`,
  envolver en `DialogTrigger`, **y corregir el comentario de las líneas 17-19** (ya no es cierto que
  «el seguimiento real vive en `/paquete/[numGuia]`»).
  **Hecho:** el botón abre el diálogo; el comentario describe lo que hay; la nav sigue siendo Server
  Component (solo el diálogo es isla cliente). Cubre **R1**.
- [x] **T3.4 — Guardia de estilo** `tests/unit/guards/rastreo-modal-tema.guardia.test.ts`: los
  archivos de UI de la feature no contienen literales hexadecimales, `rgb(`, clases `dark:`,
  `localStorage`, `sessionStorage`, `useSearchParams` ni `router.push`.
  **Hecho:** la guardia pasa y falla si se introduce cualquiera de esos. Cubre **R29, R30**.

Dependencias: T3.3 ← T3.1.

---

## Bloque 4 — Guardias de frontera (paralelo al Bloque 3, depende del Bloque 2)

- [x] **T4.1 — Guardia de no-fuga de PII**
  `tests/unit/guards/rastreo-dto-lista-blanca.guardia.test.ts`: con una orden poblada con
  dirección, monto, producto, notas, teléfono, mensajero y un historial con actor/motivo/origen,
  compara el **conjunto exacto de claves** del DTO (y de cada entrada de la línea) contra la lista
  blanca, y busca los **valores** sensibles en el resultado serializado.
  **Hecho:** falla si aparece una clave de más o cualquiera de esos valores. Cubre **R22, R23**.
- [x] **T4.2 [P] — Guardia de aislamiento del borde**
  `tests/unit/guards/rastreo-frontera.guardia.test.ts`: ningún módulo de la feature importa
  `OrdenHistorialService`, `IOrdenHistorialService`, `OrdenHistorialEntradaDTO`,
  `resolveActorFromSession`, `obtenerEtiquetaPorGuia` ni `paquete-url`; el schema zod tiene
  exactamente dos claves; el `select` del repositorio no nombra campos prohibidos; sin `console.*`
  de la entrada y sin `catch {}`.
  **Hecho:** la guardia pasa. Cubre **R4 (parte), R12, R13, R24, R25**.
- [x] **T4.3 [P] — Guardia de no-fuga de estatus internos**
  `tests/unit/guards/rastreo-sin-estatus-crudo.guardia.test.ts`: proyecta un historial que atraviesa
  los 20 values del seed y falla si alguno aparece en el resultado.
  **Hecho:** la guardia pasa. Cubre **R15**.
- [x] **T4.4 [P] — Guardia de invariantes de ruta**
  `tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts`: `PUBLIC_ROUTES`, `SELF_AUTH_ROUTES` y
  `REDIRECT_TO_ROOT` conservan su contenido; no hay `page.tsx` nuevo; `db/migrations/` no gana
  carpeta y `db/schema.prisma` no cambia.
  **Hecho:** la guardia pasa. Cubre **R3, R34**.
- [x] **T4.5 — Verificar que la feature 79 sigue intacta.**
  **Hecho:** `tests/unit/auth/middleware.test.ts` (líneas 116-131 incluidas) pasa **sin
  modificarlo**; los tests de `paquete-url` pasan sin modificarlos. Cubre **R4, R35**.

---

## Bloque 5 — Cierre

- [x] **T5.1 — Test E2E (Playwright) del flujo sin sesión.**
  **Hecho:** con contexto limpio (sin cookie), abrir `/`, pulsar «Rastrear envío», consultar una guía
  sembrada con su segundo factor, y ver la línea de tiempo **dentro del modal**, sin navegar. Segundo
  caso: guía inexistente y factor errado producen el **mismo** texto. Cubre **R2, R7, R26** de punta
  a punta. *Es flujo con superficie pública sin auth → `CHECKPOINTS.md` pide E2E.*
- [x] **T5.2 — Mapa `R<n> → test` en `progress/impl_229.md`** con la salida real de los tests.
  **Hecho:** los 35 requisitos tienen test nombrado y salida pegada (`docs/verification.md`).
- [x] **T5.3 — `./init.sh` COMPLETO antes del PR.**
  **Hecho:** verde, comparando el total de archivos de la suite contra el baseline (una corrida
  degradada reporta de menos).

---

## Trazabilidad `R<n> → test`

Conjunto final: **R1–R35 = 35 requisitos.**

| R | Qué verifica | Test |
| --- | --- | --- |
| R1 | el disparador de la landing abre el modal | `tests/components/RastreoDialog.test.tsx` — «el botón Rastrear envío ya no está deshabilitado y abre el diálogo» |
| R2 | funciona sin sesión | `tests/unit/actions/rastreo-publico-action.test.ts` — «devuelve resultado sin cookie de sesión y sin resolver actor» + E2E `e2e/rastreo-publico.spec.ts` — «un visitante sin sesión consulta su envío desde la landing» |
| R3 | ni ruta nueva ni cambios de middleware | `tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts` — «las tres listas del middleware conservan su contenido y no hay página nueva» |
| R4 | `/paquete` sigue privado | `tests/unit/auth/middleware.test.ts` (existente, sin modificar) — «redirige a / cuando no hay sesion activa» + `tests/unit/guards/rastreo-frontera.guardia.test.ts` — «ningún módulo de la feature importa la etiqueta del paquete» |
| R5 | con sesión, `/` sigue yendo a `/dashboard` | `tests/unit/auth/middleware.test.ts` (existente, sin modificar) — «con cookie redirige a /dashboard» |
| R6 | hacen falta dos datos (guía + 4 dígitos del teléfono) | `tests/unit/services/rastreo-publico-service.test.ts` — «sin los cuatro dígitos del teléfono no consulta datos y rechaza» |
| R7 | respuesta idéntica en los cuatro casos | `tests/unit/services/rastreo-publico-service.test.ts` — «guía inexistente, factor errado, orden borrada y teléfono de menos de 4 dígitos devuelven un resultado estructuralmente idéntico» + E2E — «los dos casos malos muestran el mismo texto» |
| R8 | mismo trabajo observable en los cuatro casos | `tests/unit/services/rastreo-publico-service.test.ts` — «no corta antes cuando la guía no existe: el número de llamadas a datos es el mismo en los cuatro casos» |
| R9 | 8/10 min por IP, clave sin la guía, sin revelar existencia | `tests/unit/actions/rastreo-publico-action.test.ts` — «al noveno intento en diez minutos responde demasiados_intentos sin llamar al servicio, con guías existentes e inexistentes por igual, y la clave del limitador no incorpora la guía» |
| R10 | umbrales por variable de entorno (defectos 8 / 10 min / 4 dígitos) | `tests/unit/actions/rastreo-publico-action.test.ts` — «el límite efectivo cambia con la variable de entorno y cae a 8 en 10 minutos sin ella» |
| R11 | normalización a dígitos de ambos lados | `tests/unit/services/rastreo-publico-service.test.ts` — «acepta el segundo factor con y sin separadores y normaliza también el teléfono almacenado» |
| R12 | sin logs de la entrada ni catch vacíos | `tests/unit/guards/rastreo-frontera.guardia.test.ts` — «los módulos de la feature no registran la guía ni el segundo factor y no tragan errores» |
| R13 | sin actor y sin parámetros de filtrado | `tests/unit/guards/rastreo-frontera.guardia.test.ts` — «el schema de la acción pública tiene exactamente dos campos y no resuelve actor» |
| R14 | hito vigente + línea de hitos ocurridos, sin futuros | `tests/unit/services/rastreo-publico-service.test.ts` — «devuelve la secuencia de hitos ocurridos con sus fechas y no añade ninguna entrada posterior a la última transición» |
| R15 | ningún estatus interno cruza | `tests/unit/guards/rastreo-sin-estatus-crudo.guardia.test.ts` — «un historial que atraviesa los 20 estatus no publica ningún value interno» |
| R16 | mapeo total: un estatus nuevo rompe el build | `tests/unit/guards/rastreo-hitos-exhaustivo.guardia.test.ts` — «los 20 values del catálogo tienen hito público asignado y coinciden con la tabla firmada (incluidos recolectando→registrado, incidente→no_entregado y sin_gestionar→en_reparto)» |
| R17 | value huérfano → hito neutral | `tests/unit/guards/rastreo-hitos-exhaustivo.guardia.test.ts` — «un estatus fuera del catálogo cae en el hito por defecto y no se publica crudo» |
| R18 | colapso de rachas de hito repetido (G9) | `tests/unit/services/rastreo-publico-service.test.ts` — «colapsa transiciones consecutivas del mismo hito conservando la fecha de la primera» |
| R19 | día **y hora** en la zona del negocio, sin hardcode | `tests/unit/services/rastreo-publico-service.test.ts` — «formatea día y hora en el calendario del negocio para un instante UTC conocido» |
| R20 | hito vigente = último de la línea | `tests/unit/services/rastreo-publico-service.test.ts` — «el hito vigente coincide siempre con el último de la línea de tiempo» |
| R21 | una sola consulta de historial | `tests/unit/services/rastreo-publico-service.test.ts` — «lee el historial con una sola llamada al repositorio» + `tests/integration/repositories/rastreo-publico.int.test.ts` — «resuelve la línea de tiempo en una consulta ordenada asc» |
| R22 | lista blanca cerrada de 4 campos | `tests/unit/guards/rastreo-dto-lista-blanca.guardia.test.ts` — «el DTO público tiene exactamente numGuia, hitoVigente, actualizadoEn y linea, y cada entrada solo hito y fecha» |
| R23 | ningún dato sensible en la salida | `tests/unit/guards/rastreo-dto-lista-blanca.guardia.test.ts` — «con una orden poblada, el resultado no contiene dirección, monto, mensajero, actor, motivo, intentos ni ids internos» |
| R24 | no reutiliza el service interno de historial | `tests/unit/guards/rastreo-frontera.guardia.test.ts` — «ningún módulo de la feature importa OrdenHistorialService ni su DTO» |
| R25 | select explícito en el repositorio | `tests/unit/guards/rastreo-frontera.guardia.test.ts` — «el select del repositorio público no nombra ningún campo prohibido» |
| R26 | modal con formulario y resultado dentro | `tests/components/RastreoDialog.test.tsx` — «pinta el resultado en el mismo diálogo sin navegar» + E2E |
| R27 | estado de carga y sin reenvío duplicado | `tests/components/RastreoDialog.test.tsx` — «durante la consulta inhabilita el envío e invoca la acción una sola vez» |
| R28 | mensaje único no discriminante | `tests/components/RastreoDialog.test.tsx` — «los tres casos de rechazo muestran el mismo texto y ninguna línea de tiempo» |
| R29 | no gira con el tema, sin hex ad-hoc | `tests/unit/guards/rastreo-modal-tema.guardia.test.ts` — «los archivos de UI no usan hex, rgb ni variantes dark» + `tests/components/RastreoDialog.test.tsx` — «con .dark en html el diálogo conserva la paleta clara» |
| R30 | el resultado no persiste | `tests/components/RastreoDialog.test.tsx` — «al cerrar y reabrir, el formulario vuelve vacío» + `tests/unit/guards/rastreo-modal-tema.guardia.test.ts` — «no usa storage, searchParams ni router» |
| R31 | accesibilidad del diálogo | `tests/components/RastreoDialog.test.tsx` — «tiene nombre accesible, se cierra con Esc y sus campos se localizan por etiqueta» |
| R32 | zod en el borde y resultado tipado | `tests/unit/actions/rastreo-publico-action.test.ts` — «devuelve validation_error ante guía no numérica, negativa o campos vacíos, sin lanzar» |
| R33 | service testeable sin DB ni HTTP | `tests/unit/services/rastreo-publico-service.test.ts` — «se construye con dobles y resuelve sin Prisma ni next/headers» |
| R34 | sin migración ni cambio de esquema | `tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts` — «la feature no añade migraciones ni modifica el esquema» |
| R35 | el QR de la etiqueta queda intacto | tests existentes de `lib/utils/paquete-url` (sin modificar) + `tests/unit/guards/rastreo-frontera.guardia.test.ts` — «ningún módulo de la feature importa paquete-url» |

**Regla del reviewer:** un `R<n>` sin test, o un test que no verifica el requisito que dice cubrir,
es hallazgo bloqueante (`docs/verification.md`).
