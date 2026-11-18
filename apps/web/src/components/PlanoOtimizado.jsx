import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useCart } from '../context/CartContext'
import { useCatalog } from '../context/CatalogContext'
import { formatDistance } from '../lib/flash'
import { formatBRL } from '../lib/format'
import '../styles/smart-cart.css'

const sameStores = (a, b) => a.stores.length === b.stores.length && a.stores.every((s, i) => s.merchantId === b.stores[i].merchantId)

function PlanCard({ title, hint, plan, best, onApplyAll, onApplyStore }) {
  const items = plan.stores.reduce((n, s) => n + s.lines.length, 0)
  return (
    <article className={`panel sc-plan${best ? ' best' : ''}`}>
      <div>
        <h3>{title} {best && <span className="tag ok">Menor custo</span>}</h3>
        <span className="muted">{hint}</span>
      </div>
      <div className="sc-total">{formatBRL(plan.total)}</div>
      <dl className="sc-sums">
        <dt>Itens ({items})</dt>
        <dd>{formatBRL(plan.itemsTotal)}</dd>
        <dt>Entrega</dt>
        <dd>{plan.feesTotal > 0 ? formatBRL(plan.feesTotal) : 'Grátis / retirada'}</dd>
        {plan.vipSavings > 0 && (
          <>
            <dt><span className="tag ok">VIP</span> Você economiza</dt>
            <dd>{formatBRL(plan.vipSavings)}</dd>
          </>
        )}
      </dl>
      {plan.missing.length > 0 && <span className="tag low">Não cobre {plan.missing.length} {plan.missing.length === 1 ? 'item' : 'itens'}</span>}

      {plan.stores.map((s) => (
        <section className="sc-store" key={s.merchantId} aria-label={s.storeName}>
          <header>
            <strong>{s.storeName}</strong>
            <span className="muted">
              {s.neighborhood ? `${s.neighborhood} · ` : ''}a {formatDistance(s.distanceM ?? 0)} · {s.deliveryEnabled ? (s.vipFreeDelivery ? 'entrega grátis (VIP)' : `entrega ${s.deliveryFee > 0 ? formatBRL(s.deliveryFee) : 'grátis'}`) : 'retirada'}
            </span>
          </header>
          <ul className="sc-lines">
            {s.lines.map((l) => (
              <li key={l.canonicalId}>
                <span>
                  {l.quantity}× {l.productName}
                  {l.flash && <> <span className="tag new">Tá Quentinho</span></>}
                </span>
                <span>{formatBRL(l.originalUnitPrice ? Math.round(l.originalUnitPrice * l.quantity * 100) / 100 : l.subtotal)}</span>
              </li>
            ))}
            {s.vipSavings > 0 && (
              <li>
                <span><span className="tag ok">VIP</span> Selo Vizinho VIP ({s.vipDiscountPct}%)</span>
                <span>− {formatBRL(s.vipSavings)}</span>
              </li>
            )}
            {s.vipFreeDelivery && (
              <li>
                <span><span className="tag ok">VIP</span> Entrega grátis (VIP)</span>
                <span>Grátis <s className="muted">{formatBRL(s.originalDeliveryFee)}</s></span>
              </li>
            )}
          </ul>
          {plan.stores.length > 1 && (
            <button className="btn ghost sm" type="button" onClick={() => onApplyStore(s)}>
              Montar só o carrinho desta loja ({formatBRL(s.subtotal)})
            </button>
          )}
        </section>
      ))}

      <button className="btn" type="button" onClick={() => onApplyAll(plan)}>
        {plan.stores.length > 1 ? `Colocar no carrinho (${plan.stores.length} pedidos)` : 'Colocar no carrinho'}
      </button>
    </article>
  )
}

/**
 * Resultado do otimizador: "uma loja só" x "dividindo". Como um pedido aceita uma loja só, aplicar um plano de
 * várias lojas deixa um carrinho por loja (a tela do carrinho envia um pedido de cada vez).
 */
function PlanoOtimizado({ result }) {
  const { clear, add, addOffer, count } = useCart()
  const { getProduct } = useCatalog()
  const [notice, setNotice] = useState(null)

  const { single, split, missing, unclassified, savings } = result

  const putLines = (stores) => {
    let put = 0
    let skipped = 0
    for (const s of stores) {
      for (const l of s.lines) {
        if (l.flash) {
          addOffer(
            {
              id: l.flash.id,
              productId: l.productId,
              productName: l.productName,
              image: l.flash.image,
              unit: l.flash.unit,
              storeName: s.storeName,
              merchantId: s.merchantId,
              originalPrice: l.flash.originalPrice,
              offerPrice: l.unitPrice,
              maxPerCustomer: l.flash.maxPerCustomer,
              qtyAvailable: l.flash.qtyAvailable,
              endsAt: l.flash.endsAt,
            },
            l.quantity,
          )
          put++
        } else if (getProduct(l.productId)) {
          add(l.productId, l.quantity)
          put++
        } else skipped++
      }
    }
    return { put, skipped }
  }
  const finish = ({ put, skipped }, stores) =>
    setNotice({
      put,
      skipped,
      stores: stores.length,
      text: `${put} ${put === 1 ? 'item foi' : 'itens foram'} para o carrinho${skipped ? ` (${skipped} não estão mais na vitrine)` : ''}.`,
    })

  // "Aplicar" troca o carrinho pelo plano; "só esta loja" também (um carrinho por loja, um pedido por vez).
  const applyAll = (plan) => {
    clear()
    finish(putLines(plan.stores), plan.stores)
  }
  const applyStore = (store) => {
    clear()
    finish(putLines([store]), [store])
  }

  if (!single && !split) {
    return (
      <div className="sc-missing" role="status">
        Nenhuma loja perto de você tem esses itens agora.
        {missing.length > 0 && (
          <ul>{missing.map((m) => <li key={m.canonicalId}>{m.name}</li>)}</ul>
        )}
      </div>
    )
  }

  const identical = single && split && sameStores(single, split)
  // Quem cobre mais itens vence; com a mesma cobertura, vence o menor custo.
  const moreComplete = split && single && split.missing.length < single.missing.length
  const splitBest = split && single && !identical && (moreComplete || (split.missing.length === single.missing.length && split.total < single.total))

  return (
    <section aria-label="Resultado da comparação">
      {notice && (
        <p className="deal-notice ok" role="status">
          {notice.text} <Link to="/carrinho">Ir para o carrinho</Link>
          {notice.stores > 1 && <> — um pedido por loja: envie um e volte para o próximo.</>}
        </p>
      )}
      {count > 0 && !notice && <p className="muted">Ao aplicar um plano, o carrinho atual é substituído.</p>}

      {splitBest && !moreComplete && savings > 0 && (
        <p className="deal-notice ok" role="status">Dividindo entre {split.stores.length} lojas você economiza {formatBRL(savings)}.</p>
      )}

      <div className="sc-split">
        {single && (
          <PlanCard
            title="Numa loja só"
            hint="Um único pedido, mais prático."
            plan={single}
            best={!splitBest}
            onApplyAll={applyAll}
            onApplyStore={applyStore}
          />
        )}
        {split && !identical && (
          <PlanCard
            title={`Dividindo em ${split.stores.length} ${split.stores.length === 1 ? 'loja' : 'lojas'}`}
            hint="Cada loja vira um pedido; a taxa de entrega de cada uma já está na conta."
            plan={split}
            best={splitBest}
            onApplyAll={applyAll}
            onApplyStore={applyStore}
          />
        )}
      </div>
      {moreComplete && !identical && <p className="muted">Nenhuma loja sozinha tem tudo: dividir é o único jeito de levar todos os itens.</p>}
      {identical && <p className="muted">Dividir em mais lojas não compensa: a melhor opção é uma loja só.</p>}

      {missing.length > 0 && (
        <div className="sc-missing" role="status">
          <strong>Sem oferta perto de você:</strong>
          <ul>{missing.map((m) => <li key={m.canonicalId}>{m.name}</li>)}</ul>
        </div>
      )}
      {unclassified?.length > 0 && (
        <div className="sc-missing" role="status">
          <strong>Itens em texto livre não entram na comparação:</strong>
          <ul>{unclassified.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </div>
      )}
    </section>
  )
}

export default PlanoOtimizado
