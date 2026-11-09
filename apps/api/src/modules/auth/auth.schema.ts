import { z } from 'zod'

const email = z.string().trim().toLowerCase().max(254).pipe(z.email('E-mail inválido.'))

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome.').max(120),
  email,
  password: z.string().min(8, 'A senha precisa ter pelo menos 8 caracteres.').max(128),
})
export type RegisterInput = z.infer<typeof registerSchema>

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Informe a senha.').max(128),
})
export type LoginInput = z.infer<typeof loginSchema>

export const firebaseLoginSchema = z.object({
  idToken: z.string().min(20),
  // Nome do formulário de cadastro (o ID token do Firebase só traz o nome depois do updateProfile).
  name: z.string().trim().min(2).max(120).optional(),
})
export type FirebaseLoginInput = z.infer<typeof firebaseLoginSchema>

export const updateMeSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(8).max(30).nullable(),
    // Dados da loja: só comerciantes podem enviar (o service recusa para clientes).
    store: z
      .object({
        name: z.string().trim().min(2).max(120),
        neighborhood: z.string().trim().min(2).max(80),
        city: z.string().trim().min(2).max(80),
        state: z.string().trim().length(2).toUpperCase(),
        latitude: z.number().min(-90).max(90).nullable(),
        longitude: z.number().min(-180).max(180).nullable(),
      })
      .partial(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Envie ao menos um campo.')
export type UpdateMeInput = z.infer<typeof updateMeSchema>

// Cliente logado que abre uma loja: vira MERCHANT (cadastro aberto, pensado para o piloto do bairro).
export const becomeMerchantSchema = z.object({
  store: z.object({
    name: z.string().trim().min(2).max(120),
    neighborhood: z.string().trim().min(2).max(80),
    city: z.string().trim().min(2).max(80),
    state: z.string().trim().length(2).toUpperCase().default('CE'),
  }),
})
export type BecomeMerchantInput = z.infer<typeof becomeMerchantSchema>
