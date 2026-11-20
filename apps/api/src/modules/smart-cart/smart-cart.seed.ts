// Dados de referência do Carrinho Inteligente: itens canônicos, receitas curadas e o vínculo heurístico do catálogo.
// O vínculo é CONSERVADOR de propósito (o roadmap aponta a qualidade dele como o gargalo): cada item canônico tem uma
// regra com tamanho/gramatura e exclusões, e o produto só é vinculado se casar com EXATAMENTE uma regra.
// Código de barras vence a heurística de nome. O que não casa fica sem vínculo (fora da comparação).
import { type Db, withTransaction } from '../../shared/db.js'

/** "Açúcar União 1 Kg" → "acucar uniao 1kg": sem acento, minúsculo, "1 kg"/"1,5 L" colados, vírgula decimal → ponto. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/(\d)\s+(kg|g|ml|l)\b/g, '$1$2')
    .replace(/[^a-z0-9.()]+/g, ' ')
    .trim()
}

export interface CanonicalRule {
  name: string
  unitKind: 'UN' | 'KG' | 'L'
  aliases: string[]
  /** Casa com o nome normalizado do produto. */
  include: RegExp
  /** Se casar, o produto NÃO é este item (variações que mudam o produto: integral, light, sem sal...). */
  exclude?: RegExp
}

export const CANONICAL_RULES: CanonicalRule[] = [
  { name: 'Arroz integral 1 kg', unitKind: 'UN', aliases: ['arroz integral'], include: /^arroz .*integral.*\b1kg\b/ },
  {
    name: 'Arroz branco 1 kg',
    unitKind: 'UN',
    aliases: ['arroz', 'arroz tipo 1'],
    include: /^arroz\b.*\b1kg\b/,
    exclude: /integral|arborio|grao|parboiliz|risoto|cateto|japones|negro|vermelho|pronto|farinha|doce|espaguete|macarrao|sache/,
  },
  { name: 'Feijão carioca 1 kg', unitKind: 'UN', aliases: ['feijao', 'feijao carioca'], include: /^feijao carioca\b.*\b1kg\b/ },
  { name: 'Feijão preto 1 kg', unitKind: 'UN', aliases: ['feijao preto'], include: /^feijao preto\b.*\b1kg\b/ },
  { name: 'Óleo de soja 900 ml', unitKind: 'UN', aliases: ['oleo', 'oleo de soja'], include: /^oleo de soja\b.*\b900ml\b/ },
  { name: 'Sal refinado 1 kg', unitKind: 'UN', aliases: ['sal'], include: /^sal refinado\b.*\b1kg\b/, exclude: /light|grosso|marinho|rosa/ },
  {
    name: 'Açúcar cristal 1 kg',
    unitKind: 'UN',
    aliases: ['acucar', 'acucar refinado'],
    include: /^acucar\b.*\b1kg\b/,
    exclude: /mascavo|demerara|glacu|confeiteiro|impalpavel|organico|light|diet|coco|baunilha/,
  },
  { name: 'Farinha de trigo 1 kg', unitKind: 'UN', aliases: ['farinha', 'farinha de trigo'], include: /^farinha de trigo\b.*\b1kg\b/, exclude: /integral|fermento|especial|semola|sem gluten/ },
  { name: 'Leite integral 1 L', unitKind: 'UN', aliases: ['leite', 'leite uht', 'leite caixinha'], include: /^leite\b(?!.*(condensado|fermentado|coco|\bpo\b|desnatado|semi|zero|achocolatado)).*\bintegral\b.*\b1l\b/ },
  { name: 'Creme de leite 200 g', unitKind: 'UN', aliases: ['creme de leite'], include: /^creme de leite\b.*\b200g\b/ },
  { name: 'Leite condensado 395 g', unitKind: 'UN', aliases: ['leite condensado'], include: /^leite condensado\b.*\b395g\b/ },
  { name: 'Macarrão espaguete 500 g', unitKind: 'UN', aliases: ['macarrao', 'espaguete'], include: /^macarrao espaguete\b.*\b500g\b/, exclude: /arroz|instantaneo|integral/ },
  { name: 'Molho de tomate tradicional 300-400 g', unitKind: 'UN', aliases: ['molho de tomate', 'molho'], include: /^molho de tomate\b.*\b(300|330|340|400)g\b/, exclude: /pimenta|picante/ },
  { name: 'Queijo parmesão ralado 100 g', unitKind: 'UN', aliases: ['parmesao ralado'], include: /^queijo parmesao ralado\b.*\b100g\b/ },
  { name: 'Manteiga com sal 500 g', unitKind: 'UN', aliases: ['manteiga'], include: /^manteiga\b.*\bcom sal\b.*\b500g\b/ },
  { name: 'Margarina 500 g', unitKind: 'UN', aliases: ['margarina'], include: /^margarina\b.*\b500g\b/, exclude: /sem sal|light|vegetal zero/ },
  { name: 'Café torrado e moído 250 g', unitKind: 'UN', aliases: ['cafe', 'po de cafe'], include: /^cafe\b.*\b250g\b/, exclude: /capsula|graos|soluvel|descafeinado/ },
  { name: 'Fermento químico em pó 100 g', unitKind: 'UN', aliases: ['fermento', 'fermento royal'], include: /^fermento (royal|em po|quimico)\b.*\b100g\b/ },
  { name: 'Aveia em flocos 170 g', unitKind: 'UN', aliases: ['aveia'], include: /^aveia em flocos\b.*\b170g\b/ },
  { name: 'Mistura para bolo de cenoura 450 g', unitKind: 'UN', aliases: ['bolo de cenoura'], include: /^mistura para bolo de cenoura\b.*\b450g\b/ },
  { name: 'Alho 200 g', unitKind: 'UN', aliases: ['alho'], include: /^alho\b.*\b200g\b/, exclude: /frito|pasta|triturado|pao/ },
  { name: 'Ovos de galinha (dúzia)', unitKind: 'UN', aliases: ['ovo', 'ovos'], include: /^ovos? (brancos?|vermelhos?|de galinha|extra|grandes?|tipo)/, exclude: /codorna|pascoa|chocolate/ },
  { name: 'Filé de peito de frango 1 kg', unitKind: 'UN', aliases: ['peito de frango', 'file de frango'], include: /^file de peito de frango\b.*\b1kg\b/ },
  // Hortifrúti e carnes vendidos por quilo no catálogo: "(kg)" no nome; o item vale por 1 kg.
  { name: 'Cebola (kg)', unitKind: 'KG', aliases: ['cebola'], include: /^cebola \(kg\)$/ },
  { name: 'Tomate (kg)', unitKind: 'KG', aliases: ['tomate'], include: /^tomate \(kg\)$/ },
  { name: 'Batata inglesa (kg)', unitKind: 'KG', aliases: ['batata'], include: /^batata inglesa \(kg\)$/ },
  { name: 'Cenoura (kg)', unitKind: 'KG', aliases: ['cenoura'], include: /^cenoura \(kg\)$/ },
  { name: 'Banana prata (kg)', unitKind: 'KG', aliases: ['banana'], include: /^banana prata\b.*\(kg\)$/ },
  { name: 'Carne moída de primeira (kg)', unitKind: 'KG', aliases: ['carne moida', 'carne moida de primeira'], include: /^carne moida de primeira\b.*\(kg\)$/ },

  // ---- Massas, farinhas e despensa
  { name: 'Macarrão penne 500 g', unitKind: 'UN', aliases: ['penne'], include: /^macarrao\b.*\bpenne\b.*\b500g\b/ },
  { name: 'Macarrão parafuso 500 g', unitKind: 'UN', aliases: ['parafuso', 'fusilli'], include: /^macarrao parafuso\b.*\b500g\b/ },
  { name: 'Massa para lasanha 500 g', unitKind: 'UN', aliases: ['massa de lasanha', 'lasanha'], include: /^(massa para lasanha|lasanha massa)\b.*\b500g\b/ },
  { name: 'Extrato de tomate 300 g', unitKind: 'UN', aliases: ['extrato de tomate', 'massa de tomate'], include: /^extrato de tomate\b.*\b300g\b/ },
  { name: 'Farinha de mandioca 500 g', unitKind: 'UN', aliases: ['farinha de mandioca'], include: /^farinha de mandioca\b.*\b500g\b/ },
  { name: 'Fubá de milho 500 g', unitKind: 'UN', aliases: ['fuba'], include: /^fuba de milho\b.*\b500g\b/ },
  { name: 'Amido de milho 200 g', unitKind: 'UN', aliases: ['maizena', 'amido de milho'], include: /^amido de milho\b.*\b200g\b/ },
  { name: 'Polvilho doce 500 g', unitKind: 'UN', aliases: ['polvilho'], include: /^polvilho doce\b.*\b500g\b/ },
  { name: 'Tapioca (goma) 500 g', unitKind: 'UN', aliases: ['tapioca', 'goma de tapioca'], include: /^tapioca\b.*\b500g\b/ },
  { name: 'Pão de forma 500 g', unitKind: 'UN', aliases: ['pao de forma'], include: /^pao de forma\b(?!.*integral).*\b500g\b/ },
  { name: 'Biscoito maisena 350 g', unitKind: 'UN', aliases: ['bolacha maisena', 'biscoito maizena'], include: /^biscoito maisena\b.*\b350g\b/ },
  { name: 'Lentilha 400 g', unitKind: 'UN', aliases: ['lentilha'], include: /^lentilha\b.*\b400g\b/, exclude: /lata|conserva/ },
  { name: 'Grão-de-bico 400 g', unitKind: 'UN', aliases: ['grao de bico'], include: /^grao de bico\b.*\b400g\b/, exclude: /lata|conserva|salada/ },

  // ---- Laticínios, doces e temperos
  { name: 'Leite de coco 200 ml', unitKind: 'UN', aliases: ['leite de coco'], include: /^leite de coco\b.*\b200ml\b/ },
  { name: 'Coco ralado 100 g', unitKind: 'UN', aliases: ['coco ralado'], include: /^coco ralado\b.*\b100g\b/ },
  { name: 'Requeijão cremoso 200 g', unitKind: 'UN', aliases: ['requeijao'], include: /^requeijao cremoso\b.*\b200g\b/, exclude: /light/ },
  { name: 'Achocolatado em pó 700 g', unitKind: 'UN', aliases: ['achocolatado', 'chocolate em po', 'nescau', 'toddy'], include: /^achocolatado\b(?!.*(light|cacau|lata)).*\b(700|750)g\b/ },
  { name: 'Mel 300 g', unitKind: 'UN', aliases: ['mel'], include: /^mel\b.*\b300g\b/ },
  { name: 'Maionese tradicional 335 g', unitKind: 'UN', aliases: ['maionese'], include: /^maionese\b.*\btradicional\b.*\b335g\b/ },
  { name: 'Azeite de oliva extra virgem 500 ml', unitKind: 'UN', aliases: ['azeite', 'azeite de oliva'], include: /^azeite\b.*\bextra virgem\b.*\b500ml\b/, exclude: /trufa/ },
  { name: 'Vinagre de álcool 750 ml', unitKind: 'UN', aliases: ['vinagre'], include: /^vinagre de alcool\b.*\b750ml\b/ },
  { name: 'Caldo de carne em tablete 57 g', unitKind: 'UN', aliases: ['caldo de carne', 'caldo knorr', 'caldo maggi'], include: /^caldo\b.*\bcarne\b.*\b57g\b/ },

  // ---- Enlatados, carnes, peixes e frios
  { name: 'Atum em lata 170 g', unitKind: 'UN', aliases: ['atum'], include: /^atum\b.*\b170g\b/, exclude: /vegetal|hibrido/ },
  { name: 'Sardinha em lata 125 g', unitKind: 'UN', aliases: ['sardinha'], include: /^sardinha\b.*\b125g\b/, exclude: /defumada|picante|anchov/ },
  { name: 'Milho verde em lata 170 g', unitKind: 'UN', aliases: ['milho verde', 'milho'], include: /^milho verde\b.*\b170g\b/ },
  { name: 'Sobrecoxa de frango 700 g', unitKind: 'UN', aliases: ['sobrecoxa', 'sobrecoxa de frango'], include: /^sobrecoxa de frango\b.*\b700g\b/ },
  { name: 'Filé de tilápia 500 g', unitKind: 'UN', aliases: ['tilapia', 'file de tilapia'], include: /^file de tilapia\b.*\b500g\b/, exclude: /empanado/ },
  { name: 'Linguiça calabresa 400 g', unitKind: 'UN', aliases: ['calabresa', 'linguica'], include: /^linguica calabresa\b.*\b400g\b/ },
  { name: 'Bacon fatiado 250 g', unitKind: 'UN', aliases: ['bacon'], include: /^bacon\b.*\b250g\b/ },
  { name: 'Presunto cozido 200 g', unitKind: 'UN', aliases: ['presunto'], include: /^presunto cozido\b.*\b200g\b/ },
  { name: 'Orégano 5-10 g', unitKind: 'UN', aliases: ['oregano'], include: /^oregano\b.*\b(5|10)g\b/ },

  // ---- Por quilo: queijos, carnes, frutas e legumes
  { name: 'Queijo mussarela fatiado (kg)', unitKind: 'KG', aliases: ['mussarela', 'queijo mussarela'], include: /^queijo mussarela\b.*\(kg\)$/ },
  { name: 'Queijo coalho (kg)', unitKind: 'KG', aliases: ['coalho', 'queijo coalho'], include: /^queijo coalho\b.*\(kg\)$/ },
  { name: 'Acém bovino com osso (kg)', unitKind: 'KG', aliases: ['acem', 'carne de panela'], include: /^acem bovino\b.*\(kg\)$/ },
  { name: 'Camarão fresco (kg)', unitKind: 'KG', aliases: ['camarao'], include: /^camarao fresco \(kg\)$/ },
  { name: 'Abobrinha italiana (kg)', unitKind: 'KG', aliases: ['abobrinha'], include: /^abobrinha italiana \(kg\)$/ },
  { name: 'Pimentão verde (kg)', unitKind: 'KG', aliases: ['pimentao'], include: /^pimentao verde \(kg\)$/ },
  { name: 'Batata doce (kg)', unitKind: 'KG', aliases: ['batata doce'], include: /^batata doce \(kg\)$/ },
  { name: 'Mamão formosa (kg)', unitKind: 'KG', aliases: ['mamao'], include: /^mamao formosa \(kg\)$/ },
  { name: 'Maçã (kg)', unitKind: 'KG', aliases: ['maca'], include: /^maca (importada|verde) \(kg\)$/ },
  { name: 'Laranja pera (kg)', unitKind: 'KG', aliases: ['laranja'], include: /^laranja pera \(kg\)$/ },
  { name: 'Limão taiti (kg)', unitKind: 'KG', aliases: ['limao'], include: /^limao taiti \(kg\)$/ },
]

export interface RecipeSeed {
  slug: string
  title: string
  servings: number
  ingredients: { canonical: string; quantity: number; optional?: boolean }[]
}

export const RECIPES: RecipeSeed[] = [
  {
    slug: 'arroz-integral-com-feijao',
    title: 'Arroz integral com feijão',
    servings: 4,
    ingredients: [
      { canonical: 'Arroz integral 1 kg', quantity: 1 },
      { canonical: 'Feijão carioca 1 kg', quantity: 1 },
      { canonical: 'Cebola (kg)', quantity: 0.3 },
      { canonical: 'Alho 200 g', quantity: 1 },
      { canonical: 'Óleo de soja 900 ml', quantity: 1 },
      { canonical: 'Sal refinado 1 kg', quantity: 1, optional: true },
    ],
  },
  {
    slug: 'macarrao-ao-molho-de-tomate',
    title: 'Macarrão ao molho de tomate',
    servings: 4,
    ingredients: [
      { canonical: 'Macarrão espaguete 500 g', quantity: 1 },
      { canonical: 'Molho de tomate tradicional 300-400 g', quantity: 2 },
      { canonical: 'Cebola (kg)', quantity: 0.2 },
      { canonical: 'Queijo parmesão ralado 100 g', quantity: 1 },
      { canonical: 'Sal refinado 1 kg', quantity: 1, optional: true },
    ],
  },
  {
    slug: 'bolo-de-cenoura',
    title: 'Bolo de cenoura',
    servings: 8,
    ingredients: [
      { canonical: 'Mistura para bolo de cenoura 450 g', quantity: 1 },
      { canonical: 'Ovos de galinha (dúzia)', quantity: 1 },
      { canonical: 'Óleo de soja 900 ml', quantity: 1 },
      { canonical: 'Leite integral 1 L', quantity: 1 },
    ],
  },
  {
    slug: 'strogonoff-de-frango',
    title: 'Strogonoff de frango',
    servings: 4,
    ingredients: [
      { canonical: 'Filé de peito de frango 1 kg', quantity: 1 },
      { canonical: 'Creme de leite 200 g', quantity: 2 },
      { canonical: 'Molho de tomate tradicional 300-400 g', quantity: 1 },
      { canonical: 'Cebola (kg)', quantity: 0.2 },
      { canonical: 'Sal refinado 1 kg', quantity: 1, optional: true },
    ],
  },
  {
    slug: 'picadinho-com-batata',
    title: 'Carne moída com batata',
    servings: 4,
    ingredients: [
      { canonical: 'Carne moída de primeira (kg)', quantity: 1 },
      { canonical: 'Batata inglesa (kg)', quantity: 1 },
      { canonical: 'Tomate (kg)', quantity: 0.5 },
      { canonical: 'Cebola (kg)', quantity: 0.3 },
      { canonical: 'Óleo de soja 900 ml', quantity: 1 },
    ],
  },
  {
    slug: 'vitamina-de-banana-com-aveia',
    title: 'Vitamina de banana com aveia',
    servings: 4,
    ingredients: [
      { canonical: 'Banana prata (kg)', quantity: 1 },
      { canonical: 'Leite integral 1 L', quantity: 1 },
      { canonical: 'Aveia em flocos 170 g', quantity: 1 },
    ],
  },

  // ---- Massas
  {
    slug: 'lasanha-a-bolonhesa',
    title: 'Lasanha à bolonhesa',
    servings: 6,
    ingredients: [
      { canonical: 'Massa para lasanha 500 g', quantity: 1 },
      { canonical: 'Carne moída de primeira (kg)', quantity: 0.5 },
      { canonical: 'Molho de tomate tradicional 300-400 g', quantity: 2 },
      { canonical: 'Queijo mussarela fatiado (kg)', quantity: 0.3 },
      { canonical: 'Presunto cozido 200 g', quantity: 1 },
      { canonical: 'Queijo parmesão ralado 100 g', quantity: 1 },
      { canonical: 'Cebola (kg)', quantity: 0.2 },
    ],
  },
  {
    slug: 'espaguete-a-bolonhesa',
    title: 'Espaguete à bolonhesa',
    servings: 4,
    ingredients: [
      { canonical: 'Macarrão espaguete 500 g', quantity: 1 },
      { canonical: 'Carne moída de primeira (kg)', quantity: 0.5 },
      { canonical: 'Molho de tomate tradicional 300-400 g', quantity: 2 },
      { canonical: 'Cebola (kg)', quantity: 0.2 },
      { canonical: 'Alho 200 g', quantity: 1 },
      { canonical: 'Queijo parmesão ralado 100 g', quantity: 1 },
    ],
  },
  {
    slug: 'penne-com-atum',
    title: 'Penne com atum',
    servings: 4,
    ingredients: [
      { canonical: 'Macarrão penne 500 g', quantity: 1 },
      { canonical: 'Atum em lata 170 g', quantity: 2 },
      { canonical: 'Molho de tomate tradicional 300-400 g', quantity: 1 },
      { canonical: 'Cebola (kg)', quantity: 0.2 },
      { canonical: 'Azeite de oliva extra virgem 500 ml', quantity: 1, optional: true },
    ],
  },
  {
    slug: 'parafuso-com-calabresa',
    title: 'Parafuso com calabresa',
    servings: 4,
    ingredients: [
      { canonical: 'Macarrão parafuso 500 g', quantity: 1 },
      { canonical: 'Linguiça calabresa 400 g', quantity: 1 },
      { canonical: 'Extrato de tomate 300 g', quantity: 1 },
      { canonical: 'Cebola (kg)', quantity: 0.2 },
      { canonical: 'Pimentão verde (kg)', quantity: 0.2 },
    ],
  },
  {
    slug: 'espaguete-alho-e-oleo',
    title: 'Espaguete alho e óleo',
    servings: 4,
    ingredients: [
      { canonical: 'Macarrão espaguete 500 g', quantity: 1 },
      { canonical: 'Alho 200 g', quantity: 1 },
      { canonical: 'Azeite de oliva extra virgem 500 ml', quantity: 1 },
      { canonical: 'Queijo parmesão ralado 100 g', quantity: 1 },
      { canonical: 'Sal refinado 1 kg', quantity: 1, optional: true },
    ],
  },
  {
    slug: 'penne-de-forno-com-presunto-e-queijo',
    title: 'Penne de forno com presunto e queijo',
    servings: 6,
    ingredients: [
      { canonical: 'Macarrão penne 500 g', quantity: 1 },
      { canonical: 'Presunto cozido 200 g', quantity: 1 },
      { canonical: 'Queijo mussarela fatiado (kg)', quantity: 0.3 },
      { canonical: 'Molho de tomate tradicional 300-400 g', quantity: 2 },
      { canonical: 'Creme de leite 200 g', quantity: 1 },
      { canonical: 'Queijo parmesão ralado 100 g', quantity: 1 },
    ],
  },

  // ---- Feijão, arroz e pratos do dia a dia
  {
    slug: 'feijao-tropeiro',
    title: 'Feijão tropeiro',
    servings: 6,
    ingredients: [
      { canonical: 'Feijão carioca 1 kg', quantity: 1 },
      { canonical: 'Bacon fatiado 250 g', quantity: 1 },
      { canonical: 'Linguiça calabresa 400 g', quantity: 1 },
      { canonical: 'Farinha de mandioca 500 g', quantity: 1 },
      { canonical: 'Ovos de galinha (dúzia)', quantity: 1 },
      { canonical: 'Cebola (kg)', quantity: 0.2 },
      { canonical: 'Alho 200 g', quantity: 1 },
    ],
  },
  {
    slug: 'feijao-preto-com-linguica',
    title: 'Feijão preto com linguiça',
    servings: 6,
    ingredients: [
      { canonical: 'Feijão preto 1 kg', quantity: 1 },
      { canonical: 'Linguiça calabresa 400 g', quantity: 1 },
      { canonical: 'Bacon fatiado 250 g', quantity: 1 },
      { canonical: 'Cebola (kg)', quantity: 0.2 },
      { canonical: 'Alho 200 g', quantity: 1 },
    ],
  },
  {
    slug: 'caldo-de-feijao',
    title: 'Caldo de feijão',
    servings: 6,
    ingredients: [
      { canonical: 'Feijão carioca 1 kg', quantity: 1 },
      { canonical: 'Bacon fatiado 250 g', quantity: 1 },
      { canonical: 'Cebola (kg)', quantity: 0.2 },
      { canonical: 'Alho 200 g', quantity: 1 },
      { canonical: 'Caldo de carne em tablete 57 g', quantity: 1, optional: true },
    ],
  },
  {
    slug: 'baiao-de-dois',
    title: 'Baião de dois',
    servings: 6,
    ingredients: [
      { canonical: 'Arroz branco 1 kg', quantity: 1 },
      { canonical: 'Feijão carioca 1 kg', quantity: 1 },
      { canonical: 'Queijo coalho (kg)', quantity: 0.3 },
      { canonical: 'Linguiça calabresa 400 g', quantity: 1 },
      { canonical: 'Cebola (kg)', quantity: 0.2 },
    ],
  },
  {
    slug: 'arroz-de-forno',
    title: 'Arroz de forno',
    servings: 6,
    ingredients: [
      { canonical: 'Arroz branco 1 kg', quantity: 1 },
      { canonical: 'Presunto cozido 200 g', quantity: 1 },
      { canonical: 'Queijo mussarela fatiado (kg)', quantity: 0.3 },
      { canonical: 'Creme de leite 200 g', quantity: 1 },
      { canonical: 'Milho verde em lata 170 g', quantity: 1 },
      { canonical: 'Cebola (kg)', quantity: 0.2 },
    ],
  },
  {
    slug: 'arroz-com-frango',
    title: 'Arroz com frango',
    servings: 5,
    ingredients: [
      { canonical: 'Arroz branco 1 kg', quantity: 1 },
      { canonical: 'Sobrecoxa de frango 700 g', quantity: 2 },
      { canonical: 'Cebola (kg)', quantity: 0.3 },
      { canonical: 'Tomate (kg)', quantity: 0.3 },
      { canonical: 'Pimentão verde (kg)', quantity: 0.2 },
      { canonical: 'Alho 200 g', quantity: 1 },
      { canonical: 'Óleo de soja 900 ml', quantity: 1 },
    ],
  },
  {
    slug: 'farofa-de-bacon-com-ovos',
    title: 'Farofa de bacon com ovos',
    servings: 6,
    ingredients: [
      { canonical: 'Farinha de mandioca 500 g', quantity: 1 },
      { canonical: 'Bacon fatiado 250 g', quantity: 1 },
      { canonical: 'Ovos de galinha (dúzia)', quantity: 1 },
      { canonical: 'Cebola (kg)', quantity: 0.2 },
    ],
  },

  // ---- Frango, carne e peixe
  {
    slug: 'frango-ao-molho-com-batata',
    title: 'Frango ao molho com batata',
    servings: 5,
    ingredients: [
      { canonical: 'Sobrecoxa de frango 700 g', quantity: 2 },
      { canonical: 'Batata inglesa (kg)', quantity: 1 },
      { canonical: 'Molho de tomate tradicional 300-400 g', quantity: 1 },
      { canonical: 'Cebola (kg)', quantity: 0.3 },
      { canonical: 'Óleo de soja 900 ml', quantity: 1 },
    ],
  },
  {
    slug: 'frango-grelhado-com-legumes',
    title: 'Frango grelhado com legumes',
    servings: 4,
    ingredients: [
      { canonical: 'Filé de peito de frango 1 kg', quantity: 1 },
      { canonical: 'Abobrinha italiana (kg)', quantity: 0.5 },
      { canonical: 'Cenoura (kg)', quantity: 0.4 },
      { canonical: 'Pimentão verde (kg)', quantity: 0.2 },
      { canonical: 'Azeite de oliva extra virgem 500 ml', quantity: 1 },
    ],
  },
  {
    slug: 'frango-com-requeijao',
    title: 'Frango com requeijão',
    servings: 4,
    ingredients: [
      { canonical: 'Filé de peito de frango 1 kg', quantity: 1 },
      { canonical: 'Requeijão cremoso 200 g', quantity: 2 },
      { canonical: 'Arroz branco 1 kg', quantity: 1 },
      { canonical: 'Cebola (kg)', quantity: 0.2 },
    ],
  },
  {
    slug: 'batata-doce-assada-com-frango',
    title: 'Batata-doce assada com frango',
    servings: 4,
    ingredients: [
      { canonical: 'Batata doce (kg)', quantity: 1 },
      { canonical: 'Filé de peito de frango 1 kg', quantity: 1 },
      { canonical: 'Azeite de oliva extra virgem 500 ml', quantity: 1 },
      { canonical: 'Alho 200 g', quantity: 1 },
    ],
  },
  {
    slug: 'carne-de-panela-com-legumes',
    title: 'Carne de panela com legumes',
    servings: 6,
    ingredients: [
      { canonical: 'Acém bovino com osso (kg)', quantity: 0.8 },
      { canonical: 'Batata inglesa (kg)', quantity: 0.6 },
      { canonical: 'Cenoura (kg)', quantity: 0.4 },
      { canonical: 'Cebola (kg)', quantity: 0.3 },
      { canonical: 'Extrato de tomate 300 g', quantity: 1 },
      { canonical: 'Alho 200 g', quantity: 1 },
    ],
  },
  {
    slug: 'escondidinho-de-carne-moida',
    title: 'Escondidinho de carne moída',
    servings: 6,
    ingredients: [
      { canonical: 'Carne moída de primeira (kg)', quantity: 0.5 },
      { canonical: 'Batata inglesa (kg)', quantity: 1 },
      { canonical: 'Leite integral 1 L', quantity: 1 },
      { canonical: 'Manteiga com sal 500 g', quantity: 1 },
      { canonical: 'Queijo mussarela fatiado (kg)', quantity: 0.2 },
      { canonical: 'Molho de tomate tradicional 300-400 g', quantity: 1 },
      { canonical: 'Cebola (kg)', quantity: 0.2 },
    ],
  },
  {
    slug: 'hamburguer-caseiro',
    title: 'Hambúrguer caseiro',
    servings: 4,
    ingredients: [
      { canonical: 'Carne moída de primeira (kg)', quantity: 0.5 },
      { canonical: 'Pão de forma 500 g', quantity: 1 },
      { canonical: 'Queijo mussarela fatiado (kg)', quantity: 0.2 },
      { canonical: 'Tomate (kg)', quantity: 0.2 },
      { canonical: 'Maionese tradicional 335 g', quantity: 1 },
    ],
  },
  {
    slug: 'panqueca-de-carne',
    title: 'Panqueca de carne',
    servings: 5,
    ingredients: [
      { canonical: 'Farinha de trigo 1 kg', quantity: 1 },
      { canonical: 'Leite integral 1 L', quantity: 1 },
      { canonical: 'Ovos de galinha (dúzia)', quantity: 1 },
      { canonical: 'Carne moída de primeira (kg)', quantity: 0.5 },
      { canonical: 'Molho de tomate tradicional 300-400 g', quantity: 1 },
      { canonical: 'Queijo mussarela fatiado (kg)', quantity: 0.2 },
    ],
  },
  {
    slug: 'tilapia-ao-molho-de-tomate',
    title: 'Tilápia ao molho de tomate',
    servings: 4,
    ingredients: [
      { canonical: 'Filé de tilápia 500 g', quantity: 1 },
      { canonical: 'Tomate (kg)', quantity: 0.4 },
      { canonical: 'Cebola (kg)', quantity: 0.3 },
      { canonical: 'Pimentão verde (kg)', quantity: 0.2 },
      { canonical: 'Óleo de soja 900 ml', quantity: 1 },
    ],
  },
  {
    slug: 'moqueca-de-tilapia',
    title: 'Moqueca de tilápia',
    servings: 4,
    ingredients: [
      { canonical: 'Filé de tilápia 500 g', quantity: 1 },
      { canonical: 'Leite de coco 200 ml', quantity: 2 },
      { canonical: 'Tomate (kg)', quantity: 0.4 },
      { canonical: 'Cebola (kg)', quantity: 0.3 },
      { canonical: 'Pimentão verde (kg)', quantity: 0.2 },
      { canonical: 'Azeite de oliva extra virgem 500 ml', quantity: 1, optional: true },
    ],
  },
  {
    slug: 'camarao-ao-alho-e-oleo',
    title: 'Camarão ao alho e óleo',
    servings: 4,
    ingredients: [
      { canonical: 'Camarão fresco (kg)', quantity: 0.5 },
      { canonical: 'Alho 200 g', quantity: 1 },
      { canonical: 'Azeite de oliva extra virgem 500 ml', quantity: 1 },
      { canonical: 'Arroz branco 1 kg', quantity: 1 },
    ],
  },

  // ---- Sopas, saladas e lanches
  {
    slug: 'sopa-de-legumes-com-carne',
    title: 'Sopa de legumes com carne',
    servings: 6,
    ingredients: [
      { canonical: 'Acém bovino com osso (kg)', quantity: 0.5 },
      { canonical: 'Batata inglesa (kg)', quantity: 0.5 },
      { canonical: 'Cenoura (kg)', quantity: 0.4 },
      { canonical: 'Abobrinha italiana (kg)', quantity: 0.3 },
      { canonical: 'Cebola (kg)', quantity: 0.2 },
      { canonical: 'Caldo de carne em tablete 57 g', quantity: 1, optional: true },
    ],
  },
  {
    slug: 'sopa-de-lentilha',
    title: 'Sopa de lentilha',
    servings: 5,
    ingredients: [
      { canonical: 'Lentilha 400 g', quantity: 1 },
      { canonical: 'Cenoura (kg)', quantity: 0.3 },
      { canonical: 'Batata inglesa (kg)', quantity: 0.3 },
      { canonical: 'Cebola (kg)', quantity: 0.2 },
      { canonical: 'Bacon fatiado 250 g', quantity: 1 },
    ],
  },
  {
    slug: 'salada-de-grao-de-bico',
    title: 'Salada de grão-de-bico',
    servings: 4,
    ingredients: [
      { canonical: 'Grão-de-bico 400 g', quantity: 1 },
      { canonical: 'Tomate (kg)', quantity: 0.3 },
      { canonical: 'Cebola (kg)', quantity: 0.2 },
      { canonical: 'Azeite de oliva extra virgem 500 ml', quantity: 1 },
      { canonical: 'Vinagre de álcool 750 ml', quantity: 1 },
    ],
  },
  {
    slug: 'salada-de-maionese',
    title: 'Salada de maionese',
    servings: 8,
    ingredients: [
      { canonical: 'Batata inglesa (kg)', quantity: 0.8 },
      { canonical: 'Cenoura (kg)', quantity: 0.4 },
      { canonical: 'Maionese tradicional 335 g', quantity: 1 },
      { canonical: 'Ovos de galinha (dúzia)', quantity: 1 },
      { canonical: 'Milho verde em lata 170 g', quantity: 1 },
    ],
  },
  {
    slug: 'salada-de-atum-com-batata',
    title: 'Salada de atum com batata',
    servings: 4,
    ingredients: [
      { canonical: 'Batata inglesa (kg)', quantity: 0.6 },
      { canonical: 'Atum em lata 170 g', quantity: 2 },
      { canonical: 'Tomate (kg)', quantity: 0.3 },
      { canonical: 'Cebola (kg)', quantity: 0.2 },
      { canonical: 'Azeite de oliva extra virgem 500 ml', quantity: 1 },
      { canonical: 'Vinagre de álcool 750 ml', quantity: 1, optional: true },
    ],
  },
  {
    slug: 'salada-de-frutas',
    title: 'Salada de frutas',
    servings: 6,
    ingredients: [
      { canonical: 'Mamão formosa (kg)', quantity: 0.5 },
      { canonical: 'Banana prata (kg)', quantity: 0.5 },
      { canonical: 'Maçã (kg)', quantity: 0.5 },
      { canonical: 'Laranja pera (kg)', quantity: 0.5 },
      { canonical: 'Mel 300 g', quantity: 1, optional: true },
    ],
  },
  {
    slug: 'sanduiche-de-frango-desfiado',
    title: 'Sanduíche de frango desfiado',
    servings: 4,
    ingredients: [
      { canonical: 'Filé de peito de frango 1 kg', quantity: 1 },
      { canonical: 'Pão de forma 500 g', quantity: 1 },
      { canonical: 'Maionese tradicional 335 g', quantity: 1 },
      { canonical: 'Cenoura (kg)', quantity: 0.2 },
    ],
  },
  {
    slug: 'pizza-de-frigideira',
    title: 'Pizza de frigideira',
    servings: 4,
    ingredients: [
      { canonical: 'Farinha de trigo 1 kg', quantity: 1 },
      { canonical: 'Fermento químico em pó 100 g', quantity: 1 },
      { canonical: 'Molho de tomate tradicional 300-400 g', quantity: 1 },
      { canonical: 'Queijo mussarela fatiado (kg)', quantity: 0.3 },
      { canonical: 'Presunto cozido 200 g', quantity: 1 },
      { canonical: 'Orégano 5-10 g', quantity: 1, optional: true },
    ],
  },
  {
    slug: 'tapioca-com-queijo-coalho',
    title: 'Tapioca com queijo coalho',
    servings: 4,
    ingredients: [
      { canonical: 'Tapioca (goma) 500 g', quantity: 1 },
      { canonical: 'Queijo coalho (kg)', quantity: 0.3 },
      { canonical: 'Manteiga com sal 500 g', quantity: 1, optional: true },
    ],
  },

  // ---- Bolos, doces e bebidas
  {
    slug: 'bolo-de-fuba',
    title: 'Bolo de fubá',
    servings: 10,
    ingredients: [
      { canonical: 'Fubá de milho 500 g', quantity: 1 },
      { canonical: 'Farinha de trigo 1 kg', quantity: 1 },
      { canonical: 'Açúcar cristal 1 kg', quantity: 1 },
      { canonical: 'Ovos de galinha (dúzia)', quantity: 1 },
      { canonical: 'Leite integral 1 L', quantity: 1 },
      { canonical: 'Óleo de soja 900 ml', quantity: 1 },
      { canonical: 'Fermento químico em pó 100 g', quantity: 1 },
    ],
  },
  {
    slug: 'bolo-de-laranja',
    title: 'Bolo de laranja',
    servings: 10,
    ingredients: [
      { canonical: 'Laranja pera (kg)', quantity: 1 },
      { canonical: 'Farinha de trigo 1 kg', quantity: 1 },
      { canonical: 'Açúcar cristal 1 kg', quantity: 1 },
      { canonical: 'Ovos de galinha (dúzia)', quantity: 1 },
      { canonical: 'Óleo de soja 900 ml', quantity: 1 },
      { canonical: 'Fermento químico em pó 100 g', quantity: 1 },
    ],
  },
  {
    slug: 'pao-de-queijo-de-polvilho',
    title: 'Pão de queijo de polvilho',
    servings: 12,
    ingredients: [
      { canonical: 'Polvilho doce 500 g', quantity: 1 },
      { canonical: 'Queijo parmesão ralado 100 g', quantity: 2 },
      { canonical: 'Leite integral 1 L', quantity: 1 },
      { canonical: 'Óleo de soja 900 ml', quantity: 1 },
      { canonical: 'Ovos de galinha (dúzia)', quantity: 1 },
    ],
  },
  {
    slug: 'bolinho-de-chuva',
    title: 'Bolinho de chuva',
    servings: 8,
    ingredients: [
      { canonical: 'Farinha de trigo 1 kg', quantity: 1 },
      { canonical: 'Ovos de galinha (dúzia)', quantity: 1 },
      { canonical: 'Açúcar cristal 1 kg', quantity: 1 },
      { canonical: 'Leite integral 1 L', quantity: 1 },
      { canonical: 'Fermento químico em pó 100 g', quantity: 1 },
      { canonical: 'Óleo de soja 900 ml', quantity: 1 },
    ],
  },
  {
    slug: 'brigadeiro',
    title: 'Brigadeiro',
    servings: 25,
    ingredients: [
      { canonical: 'Leite condensado 395 g', quantity: 2 },
      { canonical: 'Achocolatado em pó 700 g', quantity: 1 },
      { canonical: 'Manteiga com sal 500 g', quantity: 1 },
    ],
  },
  {
    slug: 'pudim-de-leite-condensado',
    title: 'Pudim de leite condensado',
    servings: 8,
    ingredients: [
      { canonical: 'Leite condensado 395 g', quantity: 1 },
      { canonical: 'Leite integral 1 L', quantity: 1 },
      { canonical: 'Ovos de galinha (dúzia)', quantity: 1 },
      { canonical: 'Açúcar cristal 1 kg', quantity: 1 },
    ],
  },
  {
    slug: 'mousse-de-limao',
    title: 'Mousse de limão',
    servings: 6,
    ingredients: [
      { canonical: 'Leite condensado 395 g', quantity: 1 },
      { canonical: 'Creme de leite 200 g', quantity: 1 },
      { canonical: 'Limão taiti (kg)', quantity: 0.2 },
    ],
  },
  {
    slug: 'pave-de-bolacha-com-chocolate',
    title: 'Pavê de bolacha com chocolate',
    servings: 10,
    ingredients: [
      { canonical: 'Biscoito maisena 350 g', quantity: 2 },
      { canonical: 'Leite condensado 395 g', quantity: 1 },
      { canonical: 'Creme de leite 200 g', quantity: 1 },
      { canonical: 'Leite integral 1 L', quantity: 1 },
      { canonical: 'Achocolatado em pó 700 g', quantity: 1 },
    ],
  },
  {
    slug: 'arroz-doce',
    title: 'Arroz doce',
    servings: 8,
    ingredients: [
      { canonical: 'Arroz branco 1 kg', quantity: 1 },
      { canonical: 'Leite integral 1 L', quantity: 2 },
      { canonical: 'Leite condensado 395 g', quantity: 1 },
      { canonical: 'Açúcar cristal 1 kg', quantity: 1 },
    ],
  },
  {
    slug: 'vitamina-de-mamao-com-aveia',
    title: 'Vitamina de mamão com aveia',
    servings: 4,
    ingredients: [
      { canonical: 'Mamão formosa (kg)', quantity: 0.5 },
      { canonical: 'Leite integral 1 L', quantity: 1 },
      { canonical: 'Aveia em flocos 170 g', quantity: 1 },
      { canonical: 'Mel 300 g', quantity: 1, optional: true },
    ],
  },
  {
    slug: 'limonada-suica',
    title: 'Limonada suíça',
    servings: 6,
    ingredients: [
      { canonical: 'Limão taiti (kg)', quantity: 0.4 },
      { canonical: 'Leite condensado 395 g', quantity: 1 },
      { canonical: 'Açúcar cristal 1 kg', quantity: 1, optional: true },
    ],
  },
]

/** Cria (idempotente) os itens canônicos e as receitas curadas. Devolve quantos foram inseridos agora. */
export async function seedReferenceData(db: Db): Promise<{ canonicals: number; recipes: number }> {
  return withTransaction(db, async (tx) => {
    let canonicals = 0
    for (const r of CANONICAL_RULES) {
      const res = await tx.query(
        `INSERT INTO canonical_products (name, unit_kind, aliases) VALUES ($1, $2, $3)
         ON CONFLICT (name) DO NOTHING`,
        [r.name, r.unitKind, r.aliases],
      )
      canonicals += res.rowCount ?? 0
    }
    let recipes = 0
    for (const r of RECIPES) {
      const ins = await tx.query<{ id: string }>(
        `INSERT INTO recipes (slug, title, servings, author_id, is_public) VALUES ($1, $2, $3, NULL, TRUE) ON CONFLICT (slug) DO NOTHING RETURNING id`,
        [r.slug, r.title, r.servings],
      )
      const id = ins.rows[0]?.id
      if (!id) continue // já existe: não mexe (o time pode ter ajustado)
      recipes++
      for (const i of r.ingredients) {
        await tx.query(
          `INSERT INTO recipe_ingredients (recipe_id, canonical_id, quantity, optional)
           SELECT $1, id, $3, $4 FROM canonical_products WHERE name = $2`,
          [id, i.canonical, i.quantity, i.optional ?? false],
        )
      }
    }
    return { canonicals, recipes }
  })
}

export interface LinkReport {
  total: number
  linked: number
  byBarcode: number
  byName: number
  ambiguous: number
  unlinked: number
  rate: number
  perCanonical: Record<string, number>
}

/** Qual regra casa com o nome? `null` = nenhuma; `'ambiguous'` = mais de uma (não vincula). */
export function matchCanonical(productName: string): CanonicalRule | null | 'ambiguous' {
  const n = normalizeName(productName)
  const hits = CANONICAL_RULES.filter((r) => r.include.test(n) && !(r.exclude?.test(n) ?? false))
  if (hits.length === 0) return null
  return hits.length === 1 ? hits[0]! : 'ambiguous'
}

/**
 * Vincula produtos ativos ainda sem canônico (de um lojista ou de todos). Não sobrescreve vínculo existente
 * (curadoria manual vence). Pressupõe os canônicos já criados (`seedReferenceData`).
 */
export async function linkCatalog(db: Db, opts: { merchantId?: string; dryRun?: boolean } = {}): Promise<LinkReport> {
  const { rows: canon } = await db.query<{ id: number; name: string }>(`SELECT id, name FROM canonical_products`)
  const canonId = new Map(canon.map((c) => [c.name, c.id]))
  const { rows: products } = await db.query<{ id: string; name: string; canonical_id: number | null }>(
    `SELECT id, name, canonical_id FROM products WHERE active AND ($1::uuid IS NULL OR user_id = $1::uuid)`,
    [opts.merchantId ?? null],
  )

  const report: LinkReport = { total: products.length, linked: 0, byBarcode: 0, byName: 0, ambiguous: 0, unlinked: 0, rate: 0, perCanonical: {} }
  const updates: [string, number][] = []
  for (const p of products) {
    if (p.canonical_id !== null) {
      report.linked++ // já vinculado (curadoria ou execução anterior)
      continue
    }
    const m = matchCanonical(p.name)
    if (m === 'ambiguous') report.ambiguous++
    else if (m && canonId.has(m.name)) {
      updates.push([p.id, canonId.get(m.name)!])
      report.byName++
      report.linked++
      report.perCanonical[m.name] = (report.perCanonical[m.name] ?? 0) + 1
    }
  }
  if (!opts.dryRun) {
    await withTransaction(db, async (tx) => {
      // Barcode primeiro: item canônico com EAN ganha dos produtos com o mesmo código.
      const bc = await tx.query(
        `UPDATE products p SET canonical_id = c.id FROM canonical_products c
          WHERE p.canonical_id IS NULL AND p.active AND p.barcode IS NOT NULL AND p.barcode = c.barcode
            AND ($1::uuid IS NULL OR p.user_id = $1::uuid)`,
        [opts.merchantId ?? null],
      )
      report.byBarcode = bc.rowCount ?? 0
      report.linked += report.byBarcode
      let byName = 0
      for (const [productId, canonicalId] of updates) {
        const r = await tx.query(`UPDATE products SET canonical_id = $2 WHERE id = $1 AND canonical_id IS NULL`, [productId, canonicalId])
        byName += r.rowCount ?? 0
      }
      report.linked -= report.byName - byName // quem o código de barras já vinculou não conta duas vezes
      report.byName = byName
    })
  }
  report.unlinked = report.total - report.linked - report.ambiguous
  report.rate = report.total === 0 ? 0 : report.linked / report.total
  return report
}
