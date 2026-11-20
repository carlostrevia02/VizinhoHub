import { useEffect, useRef, useState } from 'react'

// Sem IntersectionObserver (navegadores muito antigos), o chamador renderiza tudo.
export const hasObserver = typeof IntersectionObserver !== 'undefined'

// Fica true quando o elemento chega perto da viewport (estado "sticky": nunca volta a false).
export function useInView(rootMargin = '2500px 0px') {
  const ref = useRef(null)
  const [seen, setSeen] = useState(!hasObserver)

  useEffect(() => {
    const el = ref.current
    if (seen || !el) return undefined
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true)
          io.disconnect()
        }
      },
      { rootMargin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [seen, rootMargin])

  return [ref, seen]
}

// Chama onNear() cada vez que o sentinela fica visível. O observador é recriado
// sempre que `key` muda (ex.: nº de itens), então, se o sentinela continuar visível
// após um lote, o próximo lote vem logo em seguida.
export function useSentinel(onNear, key, rootMargin = '1500px 0px') {
  const ref = useRef(null)
  const cb = useRef(onNear)
  cb.current = onNear

  useEffect(() => {
    const el = ref.current
    if (!el || !hasObserver) return undefined
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) cb.current()
      },
      { rootMargin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [key, rootMargin])

  return ref
}

export default useInView
