// Um item por módulo. `mounts` são os prefixos em que o módulo é montado em app.ts (relativos a /api/v1):
// o teste de test/openapi.test.ts usa isso para casar cada router do Express com o spec.
export interface TagDoc {
  name: string
  description: string
  mounts: string[]
}

export const TAGS: TagDoc[] = [
  { name: 'Saúde', description: 'Verificação de que a API e o banco estão de pé.', mounts: [] },
  { name: 'Autenticação', description: 'Cadastro, login (próprio ou Firebase), perfil e upgrade para lojista.', mounts: ['/auth'] },
  { name: 'Categorias', description: 'Departamentos da vitrine.', mounts: ['/categories'] },
  { name: 'Produtos', description: 'Vitrine pública (Salva-Estoque) e gestão de produtos e estoque do lojista.', mounts: ['/products'] },
  { name: 'Pedidos', description: 'Checkout do cliente e Kanban de pedidos do lojista.', mounts: ['/orders'] },
  { name: 'PDV', description: 'Modo PDV: venda de balcão do lojista.', mounts: ['/pos'] },
  { name: 'Rede B2B', description: 'Rede Anti-Ruptura: excedentes de lojas vizinhas (só lojista).', mounts: ['/b2b'] },
  { name: 'Lojas', description: 'Configurações e página pública da loja (horários, entrega, pagamentos).', mounts: ['/stores'] },
  { name: 'Endereços', description: 'Endereços de entrega do usuário logado.', mounts: ['/me/addresses'] },
  { name: 'Relatórios', description: 'Resumo de vendas da loja por período (só lojista).', mounts: ['/reports'] },
  { name: 'Analytics', description: 'Dashboard analítico do lojista.', mounts: ['/analytics'] },
  { name: 'Operação', description: 'Telemetria da vitrine, fila de impressão do caixa e notificações push (PWA).', mounts: ['/events', '/print-jobs', '/push'] },
  { name: 'Ofertas do Bairro', description: 'Ofertas dos supermercados do bairro, encartes e cupons.', mounts: ['/deals', '/coupons'] },
  { name: 'Tá Quentinho', description: 'Ofertas relâmpago geolocalizadas e alertas "perto de casa".', mounts: ['/flash', '/me/alerts'] },
  { name: 'Clube VIP', description: 'Assinatura Selo Vizinho VIP: planos, cobrança, adesão das lojas e webhooks do provedor.', mounts: ['/vip'] },
  { name: 'Logística', description: 'Entrega: configuração da loja, chamado de entregador, rastreamento e área do entregador.', mounts: ['/delivery'] },
  { name: 'Caderneta', description: 'Caderneta (fiado): contas, pagamentos, ajustes e extrato.', mounts: ['/credit'] },
  { name: 'Agendamento', description: 'Encomendas, faixas de retirada e agenda.', mounts: ['/scheduling'] },
  { name: 'Prato do dia', description: 'Cardápio do dia e combos.', mounts: ['/daily-menu', '/combos'] },
  { name: 'Carrinho Inteligente', description: 'Itens canônicos, receitas, listas de compras e otimizador de lojas.', mounts: ['/smart-cart'] },
]

export const tagNames = TAGS.map((t) => t.name)
