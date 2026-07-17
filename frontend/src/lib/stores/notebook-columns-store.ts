import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface NotebookColumnsState {
  sourcesCollapsed: boolean
  notesCollapsed: boolean
  chatCollapsed: boolean
  browserCollapsed: boolean
  toggleSources: () => void
  toggleNotes: () => void
  toggleChat: () => void
  toggleBrowser: () => void
  setSources: (collapsed: boolean) => void
  setNotes: (collapsed: boolean) => void
  setChat: (collapsed: boolean) => void
  setBrowser: (collapsed: boolean) => void
}

export const useNotebookColumnsStore = create<NotebookColumnsState>()(
  persist(
    (set) => ({
      sourcesCollapsed: false,
      notesCollapsed: false,
      chatCollapsed: false,
      browserCollapsed: true, // Browser starts collapsed by default
      toggleSources: () => set((state) => ({ sourcesCollapsed: !state.sourcesCollapsed })),
      toggleNotes: () => set((state) => ({ notesCollapsed: !state.notesCollapsed })),
      toggleChat: () => set((state) => ({ chatCollapsed: !state.chatCollapsed })),
      toggleBrowser: () => set((state) => ({ browserCollapsed: !state.browserCollapsed })),
      setSources: (collapsed) => set({ sourcesCollapsed: collapsed }),
      setNotes: (collapsed) => set({ notesCollapsed: collapsed }),
      setChat: (collapsed) => set({ chatCollapsed: collapsed }),
      setBrowser: (collapsed) => set({ browserCollapsed: collapsed }),
    }),
    {
      name: 'notebook-columns-storage',
    }
  )
)
