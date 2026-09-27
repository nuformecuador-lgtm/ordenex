# SF-001 · Punto 1 — Cierres de satélite autónomos + conciliación

**Estado: diseño acordado con el humano el 2026-09-15. No implementado, sin ficha registrada.**
Documento origen: `R:\job\singularis\admin\SF-001 - Ordenex.pdf` (firmado). Estimado del documento:
6 a 9 días hábiles.

---

## Lo que se verificó contra el código (no contra el documento)

El documento describe «cómo funciona hoy». Se comprobó afirmación por afirmación:

| # | Afirmación del documento | Veredicto |
| --- | --- | --- |
| A1 | Dos niveles: el mensajero solicita, el admin satélite aprueba solo | **Cierta** |
| A2 | Al aprobar se acredita a la tienda y el dinero entra a la caja central | **Cierta** — misma transacción, `CierresAdminRepository.resolverCierre` |
| A3 | La central ya ve cuánto y cuándo recaudó cada satélite | **Cierta** — no hay que construirlo |
| A4 | Nivel 2: la satélite consolida y la central aprueba | **Cierta** |
| A5 | **«Esa aprobación no dispara ningún proceso… un visto bueno y nada más»** | **PARCIAL — el documento se equivoca aquí** |

### El error del documento (A5)

Es cierto que la aprobación de nivel 2 no mueve dinero ni notifica: `resolverCierreBodega` solo hace
`UPDATE cierre_bodega SET estado` + una línea de bitácora. No toca `WalletMovimiento`,
`WalletTiendaMovimiento` ni `PagoMensajeroMovimiento`.

**Pero NO es «nada más».** Mientras el `cierre_bodega` está en `solicitado`, la satélite **no puede
asignar órdenes nuevas a sus mensajeros**:

- `OrdenRepository.existeBodegaSateliteBloqueada` devuelve `bloqueada: porCierreBodega`
- `AsignacionSateliteService.asignar` aborta **el lote completo antes de cualquier escritura**
- Test que lo fija: «R18 (ii): bodega bloqueada por su propio CierreBodega pendiente»

O sea: la aprobación de la central es lo que **desatasca** a la satélite. El desbloqueo ocurre al
*resolver* — aprobar y rechazar lo levantan igual.

### Medido en producción (2026-09-15)

- **32** cierres de bodega, **todos aprobados**, 5 satélites, ₡4.196.897. **Cero pendientes** ahora
  mismo, así que la migración no tiene nada que resolver.
- Aprobación: **mediana 34 minutos**, máximo **14,15 h**. **3 de 32** pasaron de 12 h — esos son los
  casos en que una satélite amaneció sin poder asignar.
- **Cero rechazados y cero vencidos** en dos semanas de operación.

---

## El diseño acordado

### La aprobación no se elimina: se transforma

La consolidación de bodega **se queda** —es el bulto de efectivo que viaja, y es lo único sobre lo que
tiene sentido colgar «esto llegó»—. Lo que cambia es qué significa el botón y que deja de frenar.

| Estado en la base | Dice hoy | Dirá |
| --- | --- | --- |
| `solicitado` | «Esperando aprobación» *(y frena)* | **«Pendiente de conciliar»** — sin frenar |
| `aprobado` | «Aprobado» | **«Recibido»** |
| `rechazado` | «Rechazado» | se **retira de la pantalla**, se deja en la base |

**El enum `cierre_estado` NO se toca**, y es una restricción dura: lo comparten `cierre_dia` y
`cierre_bodega`. Inventarle un estado «conciliado» a la bodega se lo inventa también a los cierres de
mensajero.

### El bloqueo se quita en un solo sitio

`existeBodegaSateliteBloqueada` pasa a devolver `bloqueada: false` por esta causa. La bandera
`porCierreBodega` **se conserva como aviso**, exactamente como ya se hace con `porMensajeros`, que hoy
viaja al borde como aviso y no como veto. El patrón ya existe; no se inventa nada.

### Submódulo nuevo: `/wallet/satelites`

Decisión del humano: reusar el módulo de wallet, que ya resuelve esta misma pregunta para tiendas y
mensajeros. El patrón es idéntico en los dos existentes:

| | Tabla de saldos | Detalle | Acciones |
| --- | --- | --- | --- |
| Tiendas | `SaldosTiendasTable` | `DesgloseMovimientosTienda` | `PagoTiendaAcciones` |
| Mensajeros | `CuentasPorPagarTable` | `DesglosePagosMensajero` | `PagoMensajeroAcciones` |
| **Satélites** | `SaldosSatelitesTable` | desglose de consolidaciones | marcar / desmarcar recibido |

Responde lo mismo que los otros dos: **¿cuánta plata hay allá afuera que todavía no ha llegado?** Solo
que en vez de deberle a una tienda, una bodega te debe a ti.

### El saldo es DERIVADO, no un ledger nuevo

**Decisión del humano (2026-09-15): derivado, no ledger propio.**

Saldo pendiente de una satélite = Σ `total_general` de sus consolidaciones sin conciliar. La marca vive
en `cierre_bodega` con el **monto recibido**; si llegan ₡485.000 de ₡500.000, la diferencia queda
visible como saldo de esa satélite.

**Por qué derivado y no un ledger como el de tiendas:** 2 consolidaciones al día entre 5 satélites, y
cero rechazos en dos semanas — las diferencias no parecen el pan de cada día. Si resultan serlo, el
ledger propio se añade después **sin rehacer las pantallas**, porque la vista ya estaría hecha.

### La marca es reversible

**Decisión del humano.** Hoy aprobar es definitivo. Como la marca no toca el ledger, revertirla es
seguro, y sin eso un «recibido» por error no tiene vuelta atrás. Deja rastro de quién marcó y quién
deshizo.

---

## Alcance añadido sobre el documento firmado

**Dicho en voz alta:** el submódulo `/wallet/satelites` **no está en el documento**. Ahí el punto 1 era
la marca de conciliación más ajustar lo existente. No debería romper el estimado de 6–9 días porque
reusa tres componentes que ya existen, pero queda registrado que se añadió en la conversación de
diseño y no estaba firmado.

## Superficie a tocar

Siete pantallas de `/cierres-admin` leen el estado del cierre de bodega:
`CierresBodegaAdminModule`, `CierresBodegaSolicitadosLista`, `CierresBodegaResueltosLista`,
`CascadaDinero`, `cierre-factura`, `ConsolidacionBodegaModule`, `cierres-bodega-descarga-columnas`.
Cuatro de ellas **solo cambian de vocabulario**, no de lógica.

Analítica: solo `ConciliacionCierresAnaliticaRepository` (`contarCierresPorEstado`) depende del nivel 2.
**`CuentasPorPagarAnaliticaRepository` y `RecaudoAnaliticaRepository` NO lo referencian** — la superficie
es menor de lo que sugiere «pantallas, reportes, analítica e historial» del documento.

Hay una guardia de vocabulario viva (`tests/unit/guards/cierre-bodega-vocabulario.guardia.test.ts`) que
habrá que actualizar con los términos nuevos.

## Abierto

- **No se ha leído el PDF firmado.** No hay visor de PDF en la máquina y la conversión por Word no
  terminó. Se desconoce cuáles de las cuatro funcionalidades se aprobaron y en qué orden.
- El documento dice «el maestro aprueba»; en el código aprueba `esAccesoTotal` = maestro **o** admin.
  Conviene que el texto y el código digan lo mismo.
