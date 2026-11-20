import { useMemo, useState } from 'react'
import { useDocumentTitle } from '../../../lib/useDocumentTitle'
import AbcChart from './components/AbcChart'
import ChannelsCard from './components/ChannelsCard'
import HourlySalesChart from './components/HourlySalesChart'
import KpiCard, { deltaFromPct, deltaFromPoints } from './components/KpiCard'
import PaymentDonut from './components/PaymentDonut'
import PeriodFilter from './components/PeriodFilter'
import TopCustomersCard from './components/TopCustomersCard'
import TopOffersCard from './components/TopOffersCard'
import { describeRange, formatBRL, formatInt, formatPercent, todayISO } from './format'
import { presetRange, validateCustom, type Preset } from './range'
import type { DateRange } from './types'
import { useAnalytics } from './useAnalytics'
import './analytics.css'

const STATUS_OPTIONS = [
  { value: 'valid', label: 'Vendas (sem cancelados)' },
  { value: 'COMPLETED', label: 'Só concluídos' },
  { value: 'CANCELLED', label: 'Só cancelados' },
  { value: 'all', label: 'Todos os pedidos' },
]

type Theme = 'light' | 'dark'
const THEME_KEY = 'vh-analytics-theme'

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    /* armazenamento bloqueado: segue o sistema */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const pctText = (n: number) => `${n.toFixed(1).replace('.', ',')}%`

function AnalyticsPage() {
  useDocumentTitle('Análises — VizinhoHub Manager')
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [preset, setPreset] = useState<Preset>('7d')
  const [custom, setCustom] = useState<DateRange>(() => presetRange('30d'))
  const [status, setStatus] = useState('valid')

  const customError = preset === 'custom' ? validateCustom(custom) : null
  const range = useMemo<DateRange | null>(() => {
    if (preset === 'custom') return customError ? null : custom
    return presetRange(preset)
  }, [preset, custom, customError])

  const { data, error, loading, reload } = useAnalytics(range, status)

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      /* sem persistência, tudo bem */
    }
  }

  const k = data?.kpis
  const noSales = data && data.kpis.orders.value === 0 && data.kpis.orders.previous === 0 && !loading

  return (
    <div className="an" data-theme={theme} aria-busy={loading}>
      <header className="an-header">
        <div>
          <h1>Análises da loja</h1>
          <p className="an-sub">
            {data ? (
              <>
                {describeRange(data.range)} · comparado com {describeRange({ startDate: data.range.previousStartDate, endDate: data.range.previousEndDate })}
              </>
            ) : (
              'Só compras confirmadas: pedidos online e cupons de ofertas.'
            )}
          </p>
        </div>
        <div className="an-controls">
          <PeriodFilter preset={preset} onPreset={setPreset} custom={custom} onCustom={setCustom} customError={customError} max={todayISO()} />
          <label className="an-select">
            <span className="an-sr">Pedidos considerados</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="an-theme" onClick={toggleTheme} aria-pressed={theme === 'dark'}>
            {theme === 'dark' ? '☀ Tema claro' : '☾ Tema escuro'}
          </button>
        </div>
      </header>

      {error && (
        <div className="an-alert" role="alert">
          <span>{error}</span>
          <button type="button" className="an-btn" onClick={reload}>
            Tentar de novo
          </button>
        </div>
      )}

      {!data && !error && customError === null && <Skeleton />}
      {!data && customError && <p className="an-empty">Ajuste o período para ver os números.</p>}

      {data && k && (
        <div className={loading ? 'an-body loading' : 'an-body'}>
          {noSales && <p className="an-empty">Nenhuma venda neste período. Experimente um período maior.</p>}

          <section className="an-kpis" aria-label="Indicadores principais">
            <KpiCard
              label="Faturamento"
              value={formatBRL(k.revenue.value)}
              hint="Soma dos pedidos online e dos cupons de oferta confirmados pelo cliente"
              delta={deltaFromPct(k.revenue.changePct, pctText)}
              footnote={<>Antes: {formatBRL(k.revenue.previous)}</>}
            />
            <KpiCard
              label="Pedidos"
              value={formatInt(k.orders.value)}
              hint="Pedidos online somados aos cupons de oferta confirmados pelo cliente"
              delta={deltaFromPct(k.orders.changePct, pctText)}
              footnote={<>Antes: {formatInt(k.orders.previous)}</>}
            />
            <KpiCard
              label="Ticket médio"
              value={formatBRL(k.averageTicket.value)}
              hint="Faturamento dividido pelo número de pedidos"
              delta={deltaFromPct(k.averageTicket.changePct, pctText)}
              footnote={<>Antes: {formatBRL(k.averageTicket.previous)}</>}
            />
            <KpiCard
              label="Lucro"
              value={formatBRL(k.profit.value)}
              hint="Desconto das ofertas que os clientes compraram pelo VizinhoHub; o supermercado repassa essa diferença"
              delta={deltaFromPct(k.profit.changePct, pctText)}
              footnote={<>Antes: {formatBRL(k.profit.previous)}</>}
            />
            <KpiCard
              label="Conversão da vitrine"
              value={formatPercent(k.conversion.value)}
              hint="Compras (pedidos online e cupons confirmados) divididas pelas visitas à vitrine"
              delta={deltaFromPoints(k.conversion.value, k.conversion.previous, k.conversion.previous > 0)}
              footnote={
                k.conversion.sessions === 0
                  ? 'Nenhuma visita registrada no período'
                  : `${formatInt(k.conversion.funnel.orders)} compras de ${formatInt(k.conversion.sessions)} visitas · ${formatInt(k.conversion.funnel.addToCart)} colocaram no carrinho`
              }
            />
            <KpiCard
              label="Conversão dos encartes"
              value={formatPercent(k.flyerConversion.value)}
              hint="Das ofertas lidas dos seus encartes, quantas tiveram compra confirmada"
              delta={deltaFromPoints(k.flyerConversion.value, k.flyerConversion.previous, k.flyerConversion.previous > 0)}
              footnote={
                k.flyerConversion.offersExtracted === 0
                  ? 'Nenhum encarte lido no período'
                  : `${formatInt(k.flyerConversion.offersWithPurchase)} de ${formatInt(k.flyerConversion.offersExtracted)} ofertas com compra confirmada · ${formatInt(k.flyerConversion.couponsConfirmed)} ${k.flyerConversion.couponsConfirmed === 1 ? 'compra' : 'compras'}`
              }
            />
          </section>

          <div className="an-grid">
            <HourlySalesChart hourly={data.hourly} peak={data.peak} />
            <PaymentDonut payments={data.payments} />
            <ChannelsCard channels={data.channels} />
            <TopOffersCard offers={data.topOffers} />
            <TopCustomersCard customers={data.topCustomers} />
            <AbcChart items={data.abc.items} classes={data.abc.classes} totalProducts={data.abc.totalProducts} totalRevenue={data.abc.totalRevenue} />
          </div>
        </div>
      )}
    </div>
  )
}

function Skeleton() {
  return (
    <div className="an-body" role="status" aria-label="Carregando análises">
      <div className="an-kpis">
        {[0, 1, 2].map((i) => (
          <div key={i} className="an-skel" style={{ height: 132 }} />
        ))}
      </div>
      <div className="an-grid">
        <div className="an-skel an-span-2" style={{ height: 380 }} />
        <div className="an-skel" style={{ height: 380 }} />
      </div>
    </div>
  )
}

export default AnalyticsPage
