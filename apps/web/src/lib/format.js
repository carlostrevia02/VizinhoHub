const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

// "R$ 4,29" — o Intl usa NBSP entre o símbolo e o valor; trocamos por espaço comum.
export const formatBRL = (value) => brl.format(value).replace(/\u00a0/g, ' ')
