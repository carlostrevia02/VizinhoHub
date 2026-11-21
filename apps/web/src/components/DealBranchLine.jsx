import { branchLine } from '../lib/deals'
import { BranchPinIcon } from './Icons'

// Linha "filial mais próxima" de uma oferta: pin + '<filial> · 1,2 km · ~6 min de moto'.
// `located` = já temos a localização do cliente: o espaço da linha fica reservado (mesmo carregando
// ou sem filial) para o cartão não mudar de altura quando a rota chegar. Sem localização, não renderiza nada.
// `branch` null/undefined = ainda sem rota ou oferta sem filial: nada é mostrado (nem erro).
function DealBranchLine({ branch, located, pending = false, compact = false }) {
  if (!located) return null
  const line = branchLine(branch)
  const cls = `deal-branch${compact ? ' deal-branch--compact' : ''}`
  if (!line) return <p className={cls} data-pending={pending ? 'true' : undefined} aria-hidden="true" />
  return (
    <p className={`${cls}${line.atBranch ? ' here' : ''}`} title={line.title}>
      <BranchPinIcon />
      <span className="deal-branch-text">{line.text}</span>
      {line.atBranch && <span className="deal-branch-badge">Você está aqui</span>}
    </p>
  )
}

export default DealBranchLine
