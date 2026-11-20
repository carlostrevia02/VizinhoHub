// Filial de uma rede (como a API entrega ao site e ao MCP).
export interface BranchDTO {
  id: number
  name: string
  address: string | null
  neighborhood: string | null
  latitude: number
  longitude: number
}

// Filial mais próxima do cliente, por rota (tempo), com a distância e o tempo de deslocamento.
export interface NearestBranchDTO extends BranchDTO {
  /** Distância da rota em metros (ou da linha reta, quando `atBranch`). */
  distanceM: number
  /** Tempo de deslocamento em segundos; 0 quando `atBranch`. */
  durationS: number
  /** true quando distância e tempo vieram da estimativa local (OSRM indisponível), não de uma rota real. */
  estimated: boolean
  /** O cliente já está na loja (a menos de AT_BRANCH_RADIUS_M da filial). */
  atBranch: boolean
}
