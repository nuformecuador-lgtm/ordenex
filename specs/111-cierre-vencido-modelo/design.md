# Feature 111 — Cierre `vencido`: bloqueo total y resolución por el mensajero · design.md

> El CÓMO técnico sobre las decisiones recomendadas de `requirements.md`. Sin migración
> esperada (justificada abajo). Money-critical: el snapshot del cierre es inmutable; esta
> feature solo cambia LÓGICA/transiciones/UI. Capas: Controller (Server Action) → Service →
> Repository, como en las features 37/38/41.

---

## 1. Resumen de la decisión

Tres cambios acoplados sobre el modelo del `vencido` (feature 41):

1. **Bloqueo total del mensajero.** Hoy el bloqueo derivado (`solicitado`/`vencido`) solo
   frena la ASIGNACIÓN (recibir). Se extiende a las acciones operativas del propio mensajero:
   `gestionar` (obligatorio) y —recomendado, prov. Q3— `recoger`/`escoger`. Se REUSA el
   predicado único `OrdenRepository.findMensajerosBloqueados` (nada de flag ni derivación
   duplicada).
2. **Resolución por el mensajero.** `CierreDiaService.solicitarCierre` gana una rama: si el
   mensajero tiene un `vencido`, lo transiciona `vencido → solicitado` (escritura guardada por
   estado), SIN crear un cierre nuevo ni tocar el snapshot, y SIN aplicar la precondición de
   "sin pendientes" (evita deadlock).
3. **Invariante.** Nunca coexisten `vencido` y `solicitado` del mismo mensajero: el corte ya no
   crea `vencido` si hay `solicitado` (41 R10); esta feature no crea `solicitado` si hay
   `vencido` (lo transiciona).

---

## 2. Modelo de datos — SIN migración (justificación, R19)

- **Enum:** `enum CierreEstado { solicitado aprobado rechazado vencido }` ya existe
  (migración `20260712150000_cierre_estado_vencido`). No se agregan valores.
- **Índice de la ruta caliente:** `@@index([mensajeroId, estado])` en `CierreDia` ya existe
  (misma migración). Cubre: (a) el predicado de bloqueo `findMensajerosBloqueados`, (b) el
  `existeCierreVencido` nuevo, (c) la transición guardada `WHERE mensajero_id=X AND
  estado='vencido'`.
- **Sin columnas nuevas:** la transición `vencido → solicitado` reescribe SOLO `estado`. No es
  una resolución: `resuelto_por`/`resuelto_at` (que ya existen para la 38) quedan `null`. El
  snapshot (`total_*`, `total_pago_mensajero`, `total_ingreso_bodega_rechazos`) y los
  `gestion_orden.cierre_id` no se tocan.
- **RLS:** `cierre_dia` conserva su RLS (service-role only). No cambia.

> Conclusión: **no se crea `db/migrations/*`.** Si en implementación apareciera una necesidad
> (no prevista), se justifica y se aporta `down.sql` reversible (R19).

---

## 3. Backend — cambios por capa

### 3.1 Bloqueo de `gestionar` (R1/R2/R3) — `MisAsignacionesService`

- **Inyección:** ampliar el `Pick` del repo de orden del service de
  `Pick<IOrdenRepository, "findEstatusIdByValue">` a incluir `"findMensajerosBloqueados"`;
  cablearlo en `buildService()` de `lib/actions/mis-asignaciones.ts` (el mismo
  `OrdenRepository(prisma)` ya se pasa, solo se amplía el tipo consumido).
- **Guarda:** al inicio de `gestionar(input, actor)` (tras el check de rol y ANTES de
  `cargarOrdenGestionable` / subida de evidencia):
  ```
  const bloqueados = await this.ordenRepo.findMensajerosBloqueados([actor.usuarioId]);
  if (bloqueados.has(actor.usuarioId)) return { status: "conflict", motivo: MSG_BLOQUEADO };
  ```
  `MSG_BLOQUEADO` = texto fijo i18n-ready (p. ej. *"Tenés un cierre pendiente sin resolver;
  resolvelo antes de gestionar."*). Colocarla arriba garantiza R3 (sin efectos parciales:
  la evidencia se sube más abajo).
- **Contrato:** `GestionarServiceResult` ya tiene `{ status: "conflict"; motivo: string }`; se
  reutiliza (no hay tipo nuevo). El borde (`lib/actions/mis-asignaciones.ts`) devuelve el
  `conflict` como resultado de dominio; el toast del cliente ya muestra `result.motivo`.
- **Recoger/escoger (R4, Q3 aprobada):** misma guarda al inicio de `recogerAsignaciones` y
  `escogerParaGestion`, con su propio motivo. `recoger` devuelve `conflict` con `detalle`
  (patrón existente) o un `forbidden`/`conflict` acorde a su result type; `escoger` devuelve
  `conflict` con `motivo`.
- **Deshacer (R5, Q2 aprobada — guarda EXPLÍCITA):** misma guarda al inicio de
  `CierreDiaService.deshacerGestion` (tras el check de rol, ANTES de `findGestionParaDeshacer` y
  de cualquier escritura). `deshacerGestion` ya depende de un `ordenRepo` (Pick con
  `findEstatusIdByValue`): ampliar el Pick con `findMensajerosBloqueados` y cablearlo en
  `buildService()` de `lib/actions/cierre-dia.ts`. Devuelve `conflict` con motivo accionable
  (belt-and-suspenders: no se apoya en el no-op natural). `DeshacerGestionServiceResult` ya tiene
  `conflict`; se reutiliza.

### 3.2 Solicitar el propio `vencido` (R6–R11) — `CierreDiaService` + `ICierreDiaRepository`

- **Repo (nuevos métodos, gemelos de `existeCierreSolicitado`):**
  - `existeCierreVencido(mensajeroId): Promise<boolean>` — `count WHERE mensajero_id=X AND
    estado='vencido'`.
  - `transicionarVencidoASolicitado(mensajeroId): Promise<boolean>` — escritura guardada:
    ```
    const { count } = await prisma.cierreDia.updateMany({
      where: { mensajeroId, estado: "vencido" },
      data: { estado: "solicitado" },     // SOLO estado (R8)
    });
    return count === 1;                    // 0 = raced/resuelto → conflict (R7)
    ```
    No toca totales, `pago`, `ingreso`, `cierre_id`, `resuelto_por/at`, ni `solicitado_at`
    (P1: se preserva).
- **Service (`solicitarCierre`):** rama nueva ANTES del flujo de creación:
  ```
  if (await this.repo.existeCierreVencido(actor.usuarioId)) {
    const ok = await this.repo.transicionarVencidoASolicitado(actor.usuarioId);   // R6/R7
    if (!ok) return { status: "conflict", motivo: MSG_DUPLICADO_O_RESUELTO };
    return { status: "ok", ... , via: "vencido_solicitado" };   // R8: sin snapshot nuevo
  }
  // ...flujo de creación 37 SIN CAMBIOS (R11): R10 pendientes, R12 duplicado, R11 vacío, crearCierre
  ```
  La rama del `vencido` NO llama a `contarOrdenesPendientesGestion` (R9: evita el deadlock).
  El resultado `ok` puede llevar `via: "creado" | "vencido_solicitado"` (P2) para que el toast
  sea preciso; es opcional y no altera contratos existentes si se marca opcional.
- **Invariante (R10):** por construcción — la rama del `vencido` no inserta; la rama de creación
  solo corre cuando NO hay `vencido`; el corte no crea `vencido` con `solicitado` presente
  (41 R10). No hace falta un check adicional.

### 3.3 `listarCierreDia` expone `tieneVencido` (R13) — `CierreDiaService`

- `ListarCierreDiaServiceResult` (rama `ok`) gana `tieneVencido: boolean`, derivado en el
  service (reutiliza `cierresPasados` ya cargado: `tieneVencido = cierresPasados.some(c =>
  c.estado === "vencido")`, sin query extra). Viaja por props a la UI.
- No cambia `puedesSolicitar`/`motivoBloqueo` (siguen siendo el gate del flujo de creación).

### 3.4 Resolución Q1-B + válvula de escape (R15–R18) — `CierresAdminService` + repo

- **Q1-B (R15):** RETIRAR `vencido` de `ESTADOS_RESOLUBLES` en `CierresAdminService`/
  `CierresAdminRepository.resolverCierre` — el `updateMany` guardado del approve/reject normal
  queda `WHERE id=X AND estado='solicitado' AND <alcance>`. Un `vencido` deja de ser resoluble
  por la vía normal (revierte parcialmente la 41 R19; ajustar su test). El flujo normal:
  mensajero solicita (R6) → `solicitado` → admin aprueba/rechaza.
- **Válvula de escape (R16, EMERGENCIA):** acción admin nueva, explícita y DIFERENCIADA del
  approve normal:
  - Repo: `forzarSolicitudVencido(cierreId, alcance): Promise<ResolverCierreResult>` — guardada
    por estado + alcance: `updateMany WHERE id=cierreId AND estado='vencido' AND <alcanceWhere>`
    `SET estado='solicitado'`; `count===0` → `conflict`/`fuera_de_alcance` (patrón `resolverCierre`).
    SOLO cambia `estado` (no toca snapshot ni `resuelto_por/at`).
  - Service: `CierresAdminService.forzarSolicitudVencido(cierreId, actor)` — resuelve alcance
    (`resolveAlcance`, reuso), llama al repo, mapea a `ok`/`conflict`/`no_encontrada`. `forbidden`
    si el rol no es maestro/adminSatelite.
  - Acción/UI: Server Action `forzarSolicitudVencido` en `lib/actions/cierres-admin.ts`; en
    `/cierres-admin` los `vencido` de la cola muestran un botón DIFERENCIADO ("Destrabar cierre
    vencido abandonado", con `Modal` de confirmación y copy de excepción), separado de
    Aprobar/Rechazar. Tras destrabar, el cierre queda `solicitado` y se resuelve por el approve
    normal.
- **Auditoría (R17):** la resolución final (aprobar/rechazar el `solicitado` resultante) ya
  registra `resuelto_por`/`resuelto_at` = admin actor vía `resolverCierre` (feature 38 R14). El
  `resuelto_por` que queda es el del admin que aprobó — el rastro money/audit pedido. Sin migración
  (columnas ya existen).
- **Desbloqueo (R18):** responsabilidad de la 41 (derivado): `vencido → solicitado` (mensajero o
  válvula) mantiene el bloqueo; la aprobación (`→ aprobado`) lo levanta. Sin cambios en la 41.

---

## 4. Frontend — cambios (R12/R13/R14 mensajero; R16 admin)

- **`/cierre-dia` (`CierreDiaModule` + `page.tsx`):**
  - Actualizar el texto del aviso de bloqueo (`BLOQUEO_AVISO`) para reflejar el **bloqueo
    total**: *"No podés gestionar ni recibir nuevas asignaciones hasta resolver tu cierre
    pendiente."* (hoy dice solo "recibir"). El `bloqueado` ya llega por props desde
    `estadoBloqueoMensajero()` (feature 41).
  - Añadir un CTA diferenciado **"Solicitar aprobación del cierre vencido"** cuando
    `tieneVencido` (nueva prop), habilitado con INDEPENDENCIA de `puedesSolicitar` (R13). Al
    confirmarlo llama a la MISMA Server Action `solicitarCierre()` (el backend enruta a la
    transición). Ubicación recomendada: banner junto al aviso de bloqueo (más descubrible que la
    fila del histórico), con un `Modal` de confirmación (patrón del "Solicitar cierre" actual).
  - El toast de éxito distingue el caso vencido si el resultado trae `via` (P2).
- **`/mis-asignaciones` (`page.tsx` + `MisAsignacionesModule`):**
  - `page.tsx`: pre-fetch de `estadoBloqueoMensajero()` (igual que `/cierre-dia`) y pasar
    `bloqueado` por props al módulo (dato sensible, el Server Component valida).
  - `MisAsignacionesModule`: renderizar el aviso de bloqueo total (R12) y DESHABILITAR/guardar
    los controles de gestionar (`GestionarOrdenPanel`) y de recoger/escoger cuando `bloqueado`
    (R14). Defensa suave: el backend (R1/R4) es la defensa real.
- **`/cierres-admin` (admin — válvula de escape, R16):** en la cola de pendientes, cada fila
  `vencido` muestra el botón DIFERENCIADO "Destrabar cierre vencido abandonado" (copy de
  excepción, `Modal` de confirmación), separado de Aprobar/Rechazar (que solo aplican a
  `solicitado`). Llama a la Server Action `forzarSolicitudVencido(cierreId)`.
- **Componentes:** reusar `Card`/`Button`/`Modal`/`DataTable` existentes (shadcn/ui). Sin
  componentes nuevos.

---

## 5. Contratos I/O (deltas)

| Símbolo | Cambio |
| --- | --- |
| `IOrdenRepository` | ya expone `findMensajerosBloqueados`; los `Pick` de `MisAsignacionesService` y `CierreDiaService` lo incluyen |
| `MisAsignacionesService.gestionar`/`recoger`/`escoger` | + guarda de bloqueo → `{status:"conflict", motivo}` (tipo ya existente) |
| `CierreDiaService.deshacerGestion` | + guarda de bloqueo explícita (R5); Pick `ordenRepo` + `findMensajerosBloqueados` |
| `CierreDiaService.solicitarCierre` | + rama `vencido → solicitado`; result `ok` opcional `via` |
| `ICierreDiaRepository` | + `existeCierreVencido`, + `transicionarVencidoASolicitado` |
| `ListarCierreDiaServiceResult` (ok) | + `tieneVencido: boolean` |
| `CierreDiaModuleProps` | + `tieneVencido`; texto de `BLOQUEO_AVISO` actualizado |
| `/mis-asignaciones` module/page | + `bloqueado` por props |
| `CierresAdminService`/`CierresAdminRepository` | quitar `vencido` de `ESTADOS_RESOLUBLES` (Q1-B, R15); + `forzarSolicitudVencido(cierreId, actor)` (válvula, R16/R17) |
| `lib/actions/cierres-admin.ts` | + Server Action `forzarSolicitudVencido` |

Money: los totales cruzan la frontera como STRING (sin cambios); esta feature no serializa
montos nuevos.

---

## 6. Concurrencia y anti-TOCTOU

- **Transición del `vencido` (R7) y válvula (R16):** guardadas por estado en `updateMany`
  (0 filas → `conflict`). Dos solicitudes simultáneas, la válvula y el mensajero, o un admin en
  paralelo → solo una gana; la otra ve `conflict` sin efectos.
- **Bloqueo de `gestionar`/`deshacer` (R1/R5):** guarda de LECTURA al inicio del service. Ventana
  TOCTOU acotada y ACEPTADA: si un `vencido` aparece (corte a las 00:00) justo entre la lectura y
  la escritura, la gestión se registra y se captura en el corte del día siguiente; `gestionar` NO
  mueve dinero de cierre (solo registra la gestión), así que no hay fuga money-critical. Se
  documenta (a diferencia de la asignación, feature 41 R23, que sí usa `NOT EXISTS` dentro del
  `updateMany` por tocar la ruta de dinero/asignación).
- **Invariante (R10):** sostenido por las dos guardas de estado (corte 41 R10 + transición R6),
  no por locks.

---

## 7. Seguridad y errores

- Motivos de bloqueo = textos fijos i18n-ready, sin PII ni datos del cierre (R20).
- `withErrorHandler` en los bordes ya normaliza excepciones; `conflict`/`forbidden` viajan como
  resultado de dominio (patrón 36/37).
- RLS de `cierre_dia` intacta; toda escritura pasa por service-role (Server Action).

---

## 8. Alternativas consideradas y descartadas

### 8.1 Flag persistido de bloqueo en `usuario` (vs. predicado derivado) — DESCARTADA
Añadir `usuario.bloqueado_por_cierre boolean` y setearlo/limpiarlo en cada transición de cierre.
_Por qué se descarta:_ (1) introduce DRIFT (dos fuentes de verdad: el flag y los cierres reales)
y una migración innecesaria; (2) la feature 41 ya estableció el bloqueo DERIVADO como decisión
aprobada (F1.4-Q3) con el índice `(mensajero_id, estado)` que hace la consulta barata; (3)
`gestionar` reusaría exactamente `findMensajerosBloqueados`, sin sincronización extra. El derivado
es la opción coherente y sin migración.

### 8.2 Nueva Server Action/servicio `solicitarVencido` dedicado (vs. extender `solicitarCierre`) — DESCARTADA
Crear una acción separada para el camino del mensajero.
_Por qué se descarta:_ duplica el cableado (borde + service + result types) y parte en dos un
flujo que el usuario percibe como una sola acción ("solicitar mi cierre"). La descripción pide
EXTENDER `solicitarCierre`; una rama interna (detecta `vencido` → transiciona; si no, crea)
mantiene un único punto de entrada, un único botón reutilizable en la UI y un único result type.

### 8.3 Q1-A: dejar que el admin apruebe el `vencido` DIRECTO (un click) — DESCARTADA por el humano
Mantener `vencido` en `ESTADOS_RESOLUBLES` (aprobar el `vencido` sin que el mensajero lo solicite).
_Por qué se descarta (decisión Q1-B del humano):_ un approve directo de un click sobre un cierre
de caja no revisado por el mensajero es riesgoso; se prefiere que el `vencido` pase por
`solicitado` (R6/R15). El riesgo del `vencido` "trabado" (mensajero ausente) NO se cubre abriendo
el approve directo sino con la **válvula de escape** (R16): una acción admin EXPLÍCITA y
diferenciada, auditable al resolver (R17), reservada como excepción de emergencia — deja rastro y
no se confunde con el flujo normal.

---

## 9. Plan de pruebas (resumen; detalle en tasks.md)

- **Unit backend:** guardas de `gestionar` (R1/R2/R3), `recoger`/`escoger` (R4), `deshacer`
  (R5); rama del `vencido` (R6/R8/R9/R11), `tieneVencido` (R13-datos), motivo sin PII (R20).
- **Integración repo/DB:** transición guardada `vencido → solicitado` y su carrera (R7),
  snapshot/gestiones intactos (R8/R21), invariante (R10), Q1-B: normal solo `solicitado` (R15),
  válvula de escape (R16) y su auditoría al aprobar (R17), desbloqueo (R18).
- **Componente/E2E:** avisos de bloqueo total en ambas vistas (R12), CTA del `vencido` (R13),
  controles deshabilitados en `/mis-asignaciones` (R14), acción "destrabar" en `/cierres-admin`
  (R16). E2E del ciclo money (bloqueo → solicitar vencido → aprobación → desbloqueo, y la variante
  válvula de escape) por ser flujo de dinero (CHECKPOINTS.md).
