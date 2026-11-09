import type { Role } from '../../shared/auth.js'

export interface UserDTO {
  id: string
  name: string
  email: string
  role: Role
  phone: string | null
  // Só comerciantes têm loja.
  store: {
    name: string
    neighborhood: string
    city: string
    state: string | null
    latitude: number | null
    longitude: number | null
  } | null
}

export interface AuthResultDTO {
  token: string
  user: UserDTO
}
