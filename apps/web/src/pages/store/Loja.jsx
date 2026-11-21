import { Link } from 'react-router-dom'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

const prevent = (e) => e.preventDefault()

function Loja() {
  useDocumentTitle("Mercadinho do Zé — VizinhoHub")
  return (
    <main>
      <section className="store-hero">
        <span className="logo-lg">
          <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#0f3d2e" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="9" cy="20" r="1.6" />
            <circle cx="18" cy="20" r="1.6" />
            <path d="M2 3h3l2.5 12h11L21 7H6" />
          </svg>
        </span>
        <div>
          <h1>
            Mercadinho do Zé
          </h1>
          <p style={{ margin: "0", opacity: ".9" }}>
            Fortaleza · Aberto agora até 21h · Entrega em todos os bairros
          </p>
        </div>
      </section>
      <div className="two">
        <div className="panel">
          <h3>
            Horário de funcionamento
          </h3>
          <table className="spec">
            <tbody>
              <tr>
                <th>
                  Segunda a sexta
                </th>
                <td>
                  07:00 – 21:00
                </td>
              </tr>
              <tr>
                <th>
                  Sábado
                </th>
                <td>
                  07:00 – 20:00
                </td>
              </tr>
              <tr>
                <th>
                  Domingo e feriados
                </th>
                <td>
                  08:00 – 13:00
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h3>
            Contato e pagamento
          </h3>
          <dl className="kv">
            <dt>
              Endereço
            </dt>
            <dd>
              Rua das Flores, 120 — Aldeota
            </dd>
            <dt>
              WhatsApp
            </dt>
            <dd>
              (85) 99999-0000
            </dd>
            <dt>
              Entrega
            </dt>
            <dd>
              Grátis acima de R$ 60,00
            </dd>
            <dt>
              Pagamento
            </dt>
            <dd>
              Pix, cartão e dinheiro na retirada
            </dd>
          </dl>
          <p style={{ marginBottom: "0" }}>
            <a className="btn orange" href="#" onClick={prevent}>
              Chamar no WhatsApp
            </a>
            {' '}
            <Link className="btn ghost" to="/produtos">
              Ver produtos
            </Link>
          </p>
        </div>
      </div>
    </main>
  )
}

export default Loja
