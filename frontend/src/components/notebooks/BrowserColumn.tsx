'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useNotebookColumnsStore } from '@/lib/stores/notebook-columns-store'
import { createCollapseButton } from '@/components/notebooks/CollapsibleColumn'
import apiClient from '@/lib/api/client'
import {
  Globe,
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  Search,
  Loader2,
  Plus,
  X,
  FilePlus,
  AlertCircle,
  Pencil,
  Square,
  Circle,
  Type,
  Eraser,
  Undo2,
  Trash2,
  Send,
  MoveUpRight,
  Highlighter,
  Minus,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  ChevronUp,
  ChevronDown,
  ChevronsUp,
  ChevronsDown,
  Layers,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

type DrawTool = 'pen' | 'highlight' | 'arrow' | 'line' | 'rect' | 'circle' | 'text' | 'eraser'

interface TextPlacement {
  x: number
  y: number
  text: string
  fontSize: number
  rotation: number
  color: string
}

interface DrawAction {
  id: string
  tool: DrawTool
  points?: { x: number; y: number }[]
  color: string
  size: number
  opacity?: number
  start?: { x: number; y: number }
  end?: { x: number; y: number }
  text?: string
  fontSize?: number
  rotation?: number
}

interface Layer {
  id: string
  name: string
  visible: boolean
  opacity: number
  locked: boolean
  actions: DrawAction[]
}

interface BrowserTab {
  id: string
  url: string
  title: string
  screenshot: string | null
  content: string
  links: Array<{ text: string; href: string }>
  error: string | null
  loading: boolean
}

interface BrowserColumnProps {
  notebookId: string
}

const MAX_TABS = 3

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#ffffff', '#000000']
const SIZES = [2, 4, 6, 8, 12]
const FONT_SIZES = [12, 16, 20, 24, 32, 48]
const ROTATION_PRESETS = [
  { label: '0°', value: 0 },
  { label: '90°', value: 90 },
  { label: '180°', value: 180 },
  { label: '270°', value: 270 },
  { label: '↔', value: 0 },
  { label: '↕', value: 90 },
]

let layerCounter = 0
const genLayerId = () => `layer-${++layerCounter}-${Date.now()}`
const genActionId = () => `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

export function BrowserColumn({ notebookId }: BrowserColumnProps) {
  const { t } = useTranslation()
  const { toggleBrowser } = useNotebookColumnsStore()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const collapseButton = createCollapseButton(toggleBrowser, t('common.browser') || 'Browser')

  const [tabs, setTabs] = useState<BrowserTab[]>([{
    id: 'tab-1',
    url: 'about:blank',
    title: '',
    screenshot: null,
    content: '',
    links: [],
    error: null,
    loading: false,
  }])
  const [activeTabId, setActiveTabId] = useState('tab-1')
  const [urlInput, setUrlInput] = useState('')
  const [showAddSource, setShowAddSource] = useState(false)
  const [showLayers, setShowLayers] = useState(true)

  // Layer state
  const [layers, setLayers] = useState<Layer[]>([
    { id: genLayerId(), name: 'Background', visible: true, opacity: 1, locked: false, actions: [] },
  ])
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null)

  // Drawing state
  const [currentTool, setCurrentTool] = useState<DrawTool>('pen')
  const [drawColor, setDrawColor] = useState('#ef4444')
  const [drawSize, setDrawSize] = useState(4)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })

  // Text placement state
  const [textPlacement, setTextPlacement] = useState<TextPlacement | null>(null)
  const [textFontSize, setTextFontSize] = useState(20)
  const [textRotation, setTextRotation] = useState(0)

  // Refs for live drawing (avoid React state lag)
  const drawingRef = useRef(false)
  const currentPathRef = useRef<{ x: number; y: number }[]>([])
  const shapeStartRef = useRef<{ x: number; y: number } | null>(null)
  const currentToolRef = useRef(currentTool)
  const drawColorRef = useRef(drawColor)
  const drawSizeRef = useRef(drawSize)
  const layersRef = useRef(layers)
  const activeLayerIdRef = useRef(activeLayerId)

  useEffect(() => { currentToolRef.current = currentTool }, [currentTool])
  useEffect(() => { drawColorRef.current = drawColor }, [drawColor])
  useEffect(() => { drawSizeRef.current = drawSize }, [drawSize])
  useEffect(() => { layersRef.current = layers }, [layers])
  useEffect(() => { activeLayerIdRef.current = activeLayerId }, [activeLayerId])

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0]

  // Ensure activeLayerId is set
  useEffect(() => {
    if (layers.length > 0 && (!activeLayerId || !layers.find(l => l.id === activeLayerId))) {
      setActiveLayerId(layers[layers.length - 1].id)
    }
  }, [layers, activeLayerId])

  const getActiveLayer = useCallback(() => {
    return layers.find(l => l.id === activeLayerIdRef.current) || layers[layers.length - 1]
  }, [layers])

  // Inject scrollbar styles
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = `
      .browser-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
      .browser-scroll::-webkit-scrollbar-track { background: hsl(var(--muted)); border-radius: 5px; }
      .browser-scroll::-webkit-scrollbar-thumb { background: hsl(var(--muted-foreground) / 0.3); border-radius: 5px; border: 2px solid hsl(var(--muted)); }
      .browser-scroll::-webkit-scrollbar-thumb:hover { background: hsl(var(--muted-foreground) / 0.5); }
      .browser-scroll { scrollbar-width: thin; scrollbar-color: hsl(var(--muted-foreground) / 0.3) hsl(var(--muted)); }
      .layer-item { transition: background-color 0.1s; }
    `
    document.head.appendChild(style)
    return () => { document.head.removeChild(style) }
  }, [])

  // Draw a single action onto a context
  const drawAction = useCallback((ctx: CanvasRenderingContext2D, action: DrawAction) => {
    ctx.save()
    ctx.strokeStyle = action.color
    ctx.fillStyle = action.color
    ctx.lineWidth = action.size
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (action.opacity !== undefined) ctx.globalAlpha = action.opacity

    switch (action.tool) {
      case 'pen':
      case 'eraser': {
        if (action.tool === 'eraser') {
          ctx.globalCompositeOperation = 'destination-out'
          ctx.lineWidth = action.size * 3
        }
        if (action.points && action.points.length > 1) {
          ctx.beginPath()
          ctx.moveTo(action.points[0].x, action.points[0].y)
          for (let i = 1; i < action.points.length; i++) {
            const p0 = action.points[i - 1]
            const p1 = action.points[i]
            const mx = (p0.x + p1.x) / 2
            const my = (p0.y + p1.y) / 2
            ctx.quadraticCurveTo(p0.x, p0.y, mx, my)
          }
          ctx.stroke()
        }
        break
      }
      case 'highlight': {
        ctx.globalAlpha = 0.35
        ctx.lineWidth = action.size * 4
        if (action.points && action.points.length > 1) {
          ctx.beginPath()
          ctx.moveTo(action.points[0].x, action.points[0].y)
          for (let i = 1; i < action.points.length; i++) {
            ctx.lineTo(action.points[i].x, action.points[i].y)
          }
          ctx.stroke()
        }
        break
      }
      case 'arrow': {
        if (action.start && action.end) {
          const headLen = Math.max(15, action.size * 3)
          const dx = action.end.x - action.start.x
          const dy = action.end.y - action.start.y
          const angle = Math.atan2(dy, dx)
          ctx.beginPath()
          ctx.moveTo(action.start.x, action.start.y)
          ctx.lineTo(action.end.x, action.end.y)
          ctx.stroke()
          ctx.beginPath()
          ctx.moveTo(action.end.x, action.end.y)
          ctx.lineTo(action.end.x - headLen * Math.cos(angle - Math.PI / 6), action.end.y - headLen * Math.sin(angle - Math.PI / 6))
          ctx.moveTo(action.end.x, action.end.y)
          ctx.lineTo(action.end.x - headLen * Math.cos(angle + Math.PI / 6), action.end.y - headLen * Math.sin(angle + Math.PI / 6))
          ctx.stroke()
        }
        break
      }
      case 'line': {
        if (action.start && action.end) {
          ctx.beginPath()
          ctx.moveTo(action.start.x, action.start.y)
          ctx.lineTo(action.end.x, action.end.y)
          ctx.stroke()
        }
        break
      }
      case 'rect': {
        if (action.start && action.end) {
          ctx.strokeRect(action.start.x, action.start.y, action.end.x - action.start.x, action.end.y - action.start.y)
        }
        break
      }
      case 'circle': {
        if (action.start && action.end) {
          const rx = Math.abs(action.end.x - action.start.x) / 2
          const ry = Math.abs(action.end.y - action.start.y) / 2
          const cx = action.start.x + (action.end.x - action.start.x) / 2
          const cy = action.start.y + (action.end.y - action.start.y) / 2
          ctx.beginPath()
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
          ctx.stroke()
        }
        break
      }
      case 'text': {
        if (action.text && action.start) {
          const fontSize = action.fontSize || 20
          const rotation = (action.rotation || 0) * Math.PI / 180
          ctx.font = `bold ${fontSize}px sans-serif`
          ctx.translate(action.start.x, action.start.y)
          ctx.rotate(rotation)
          const lines = action.text.split('\n')
          lines.forEach((line, i) => {
            ctx.fillText(line, 0, i * fontSize * 1.2)
          })
        }
        break
      }
    }
    ctx.restore()
  }, [])

  // Redraw entire canvas from all visible layers (bottom to top)
  const redrawCanvas = useCallback((allLayers: Layer[]) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    // Draw bottom to top
    for (const layer of allLayers) {
      if (!layer.visible || layer.actions.length === 0) continue
      ctx.save()
      ctx.globalAlpha = layer.opacity
      layer.actions.forEach(a => drawAction(ctx, a))
      ctx.restore()
    }
  }, [drawAction])

  // Live drawing: draw current stroke on canvas directly
  const drawLiveStroke = useCallback((ctx: CanvasRenderingContext2D, points: { x: number; y: number }[], tool: DrawTool, color: string, size: number) => {
    if (points.length < 2) return
    ctx.save()
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = size
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.lineWidth = size * 3
    } else if (tool === 'highlight') {
      ctx.globalAlpha = 0.35
      ctx.lineWidth = size * 4
    }

    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) {
      if (tool === 'pen' || tool === 'eraser') {
        const p0 = points[i - 1]
        const p1 = points[i]
        const mx = (p0.x + p1.x) / 2
        const my = (p0.y + p1.y) / 2
        ctx.quadraticCurveTo(p0.x, p0.y, mx, my)
      } else {
        ctx.lineTo(points[i].x, points[i].y)
      }
    }
    ctx.stroke()
    ctx.restore()
  }, [])

  // Live drawing: draw current shape preview
  const drawLiveShape = useCallback((ctx: CanvasRenderingContext2D, start: { x: number; y: number }, end: { x: number; y: number }, tool: DrawTool, color: string, size: number) => {
    ctx.save()
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = size
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.setLineDash([5, 5])

    switch (tool) {
      case 'arrow': {
        const headLen = Math.max(15, size * 3)
        const dx = end.x - start.x
        const dy = end.y - start.y
        const angle = Math.atan2(dy, dx)
        ctx.beginPath()
        ctx.moveTo(start.x, start.y)
        ctx.lineTo(end.x, end.y)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.moveTo(end.x, end.y)
        ctx.lineTo(end.x - headLen * Math.cos(angle - Math.PI / 6), end.y - headLen * Math.sin(angle - Math.PI / 6))
        ctx.moveTo(end.x, end.y)
        ctx.lineTo(end.x - headLen * Math.cos(angle + Math.PI / 6), end.y - headLen * Math.sin(angle + Math.PI / 6))
        ctx.stroke()
        break
      }
      case 'line': {
        ctx.beginPath()
        ctx.moveTo(start.x, start.y)
        ctx.lineTo(end.x, end.y)
        ctx.stroke()
        break
      }
      case 'rect': {
        ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y)
        break
      }
      case 'circle': {
        const rx = Math.abs(end.x - start.x) / 2
        const ry = Math.abs(end.y - start.y) / 2
        const cx = start.x + (end.x - start.x) / 2
        const cy = start.y + (end.y - start.y) / 2
        ctx.beginPath()
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
        ctx.stroke()
        break
      }
    }
    ctx.restore()
  }, [])

  // Refs for live drawing coords
  const shapeStartPosRef = useRef<{ x: number; y: number } | null>(null)
  const shapeEndPosRef = useRef<{ x: number; y: number } | null>(null)

  const getCanvasPos = useCallback((e: React.MouseEvent<HTMLCanvasElement> | React.MouseEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }, [])

  // Redraw helper using ref data for mouse events
  const redrawWithLive = useCallback((liveDraw?: (ctx: CanvasRenderingContext2D) => void) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const currentLayers = layersRef.current
    for (const layer of currentLayers) {
      if (!layer.visible || layer.actions.length === 0) continue
      ctx.save()
      ctx.globalAlpha = layer.opacity
      layer.actions.forEach(a => drawAction(ctx, a))
      ctx.restore()
    }
    if (liveDraw) liveDraw(ctx)
  }, [drawAction])

  // Mouse handlers for LIVE drawing
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getCanvasPos(e)
    const tool = currentToolRef.current
    const layer = layersRef.current.find(l => l.id === activeLayerIdRef.current) || layersRef.current[layersRef.current.length - 1]
    if (layer.locked) return

    if (tool === 'text') {
      setTextPlacement({ x: pos.x, y: pos.y, text: '', fontSize: textFontSize, rotation: textRotation, color: drawColorRef.current })
      return
    }

    drawingRef.current = true
    currentPathRef.current = [pos]
    shapeStartPosRef.current = pos
    shapeEndPosRef.current = pos
  }, [getCanvasPos, textFontSize, textRotation])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    const pos = getCanvasPos(e)
    const tool = currentToolRef.current
    const color = drawColorRef.current
    const size = drawSizeRef.current

    if (tool === 'pen' || tool === 'eraser' || tool === 'highlight') {
      currentPathRef.current.push(pos)
      redrawWithLive((ctx) => {
        drawLiveStroke(ctx, currentPathRef.current, tool, color, size)
      })
    } else {
      shapeEndPosRef.current = pos
      redrawWithLive((ctx) => {
        if (shapeStartPosRef.current) {
          drawLiveShape(ctx, shapeStartPosRef.current, pos, tool, color, size)
        }
      })
    }
  }, [getCanvasPos, redrawWithLive, drawLiveStroke, drawLiveShape])

  const handleMouseUp = useCallback(() => {
    if (!drawingRef.current) return
    drawingRef.current = false

    const tool = currentToolRef.current
    const color = drawColorRef.current
    const size = drawSizeRef.current
    const actionId = genActionId()

    const action: DrawAction = { id: actionId, tool, color, size }

    if (tool === 'pen' || tool === 'eraser' || tool === 'highlight') {
      action.points = [...currentPathRef.current]
      currentPathRef.current = []
    } else {
      action.start = shapeStartPosRef.current || undefined
      action.end = shapeEndPosRef.current || undefined
      shapeStartPosRef.current = null
      shapeEndPosRef.current = null
    }

    setLayers(prev => {
      const next = prev.map(l => {
        if (l.id === (activeLayerIdRef.current || prev[prev.length - 1].id)) {
          return { ...l, actions: [...l.actions, action] }
        }
        return l
      })
      requestAnimationFrame(() => redrawCanvas(next))
      return next
    })
  }, [redrawCanvas])

  // Text submission
  const submitText = useCallback(() => {
    if (!textPlacement || !textPlacement.text.trim()) {
      setTextPlacement(null)
      return
    }
    const action: DrawAction = {
      id: genActionId(),
      tool: 'text',
      color: textPlacement.color,
      size: 1,
      text: textPlacement.text,
      fontSize: textPlacement.fontSize,
      rotation: textPlacement.rotation,
      start: { x: textPlacement.x, y: textPlacement.y },
    }
    setLayers(prev => {
      const next = prev.map(l => {
        if (l.id === (activeLayerIdRef.current || prev[prev.length - 1].id)) {
          return { ...l, actions: [...l.actions, action] }
        }
        return l
      })
      requestAnimationFrame(() => redrawCanvas(next))
      return next
    })
    setTextPlacement(null)
  }, [textPlacement, redrawCanvas])

  const undo = useCallback(() => {
    setLayers(prev => {
      const activeId = activeLayerIdRef.current || prev[prev.length - 1]?.id
      const next = prev.map(l => {
        if (l.id === activeId && l.actions.length > 0) {
          return { ...l, actions: l.actions.slice(0, -1) }
        }
        return l
      })
      requestAnimationFrame(() => redrawCanvas(next))
      return next
    })
  }, [redrawCanvas])

  const clearCanvas = useCallback(() => {
    setLayers(prev => {
      const next = prev.map(l => ({ ...l, actions: [] }))
      requestAnimationFrame(() => redrawCanvas(next))
      return next
    })
  }, [redrawCanvas])

  const sendToAI = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas || !activeTab.screenshot) return
    const mergedCanvas = document.createElement('canvas')
    mergedCanvas.width = canvas.width
    mergedCanvas.height = canvas.height
    const ctx = mergedCanvas.getContext('2d')
    if (!ctx) return

    const img = new Image()
    img.onload = async () => {
      ctx.drawImage(img, 0, 0, mergedCanvas.width, mergedCanvas.height)
      // Draw all visible layers
      for (const layer of layers) {
        if (!layer.visible || layer.actions.length === 0) continue
        ctx.save()
        ctx.globalAlpha = layer.opacity
        layer.actions.forEach(a => drawAction(ctx, a))
        ctx.restore()
      }
      const base64 = mergedCanvas.toDataURL('image/png')
      try {
        await apiClient.post('/chat/send', {
          notebook_id: notebookId,
          message: 'Please implement the design changes shown in this annotated screenshot.',
          image: base64,
        })
        clearCanvas()
      } catch (error) {
        console.error('Failed to send to AI:', error)
      }
    }
    img.src = activeTab.screenshot
  }, [activeTab.screenshot, notebookId, clearCanvas, layers, drawAction])

  // Layer operations
  const addLayer = useCallback(() => {
    const newLayer: Layer = {
      id: genLayerId(),
      name: `Layer ${layers.length + 1}`,
      visible: true,
      opacity: 1,
      locked: false,
      actions: [],
    }
    setLayers(prev => {
      const next = [...prev, newLayer]
      requestAnimationFrame(() => redrawCanvas(next))
      return next
    })
    setActiveLayerId(newLayer.id)
  }, [layers.length, redrawCanvas])

  const deleteLayer = useCallback((layerId: string) => {
    setLayers(prev => {
      if (prev.length <= 1) return prev
      const next = prev.filter(l => l.id !== layerId)
      requestAnimationFrame(() => redrawCanvas(next))
      return next
    })
  }, [redrawCanvas])

  const toggleLayerVisibility = useCallback((layerId: string) => {
    setLayers(prev => {
      const next = prev.map(l => l.id === layerId ? { ...l, visible: !l.visible } : l)
      requestAnimationFrame(() => redrawCanvas(next))
      return next
    })
  }, [redrawCanvas])

  const toggleLayerLock = useCallback((layerId: string) => {
    setLayers(prev => prev.map(l => l.id === layerId ? { ...l, locked: !l.locked } : l))
  }, [])

  const setLayerOpacity = useCallback((layerId: string, opacity: number) => {
    setLayers(prev => {
      const next = prev.map(l => l.id === layerId ? { ...l, opacity } : l)
      requestAnimationFrame(() => redrawCanvas(next))
      return next
    })
  }, [redrawCanvas])

  const renameLayer = useCallback((layerId: string, name: string) => {
    setLayers(prev => prev.map(l => l.id === layerId ? { ...l, name } : l))
  }, [])

  const moveLayer = useCallback((layerId: string, direction: 'up' | 'down') => {
    setLayers(prev => {
      const idx = prev.findIndex(l => l.id === layerId)
      if (idx === -1) return prev
      const newIdx = direction === 'up' ? idx + 1 : idx - 1
      if (newIdx < 0 || newIdx >= prev.length) return prev
      const next = [...prev]
      const [removed] = next.splice(idx, 1)
      next.splice(newIdx, 0, removed)
      requestAnimationFrame(() => redrawCanvas(next))
      return next
    })
  }, [redrawCanvas])

  const bringToFront = useCallback((layerId: string) => {
    setLayers(prev => {
      const idx = prev.findIndex(l => l.id === layerId)
      if (idx === -1 || idx === prev.length - 1) return prev
      const next = [...prev]
      const [removed] = next.splice(idx, 1)
      next.push(removed)
      requestAnimationFrame(() => redrawCanvas(next))
      return next
    })
  }, [redrawCanvas])

  const sendToBack = useCallback((layerId: string) => {
    setLayers(prev => {
      const idx = prev.findIndex(l => l.id === layerId)
      if (idx <= 0) return prev
      const next = [...prev]
      const [removed] = next.splice(idx, 1)
      next.unshift(removed)
      requestAnimationFrame(() => redrawCanvas(next))
      return next
    })
  }, [redrawCanvas])

  const duplicateLayer = useCallback((layerId: string) => {
    setLayers(prev => {
      const layer = prev.find(l => l.id === layerId)
      if (!layer) return prev
      const newLayer: Layer = {
        id: genLayerId(),
        name: `${layer.name} copy`,
        visible: true,
        opacity: layer.opacity,
        locked: false,
        actions: layer.actions.map(a => ({ ...a, id: genActionId() })),
      }
      const idx = prev.findIndex(l => l.id === layerId)
      const next = [...prev]
      next.splice(idx + 1, 0, newLayer)
      requestAnimationFrame(() => redrawCanvas(next))
      return next
    })
    setActiveLayerId(layers.find(l => l.id === layerId)?.id || null)
  }, [redrawCanvas])

  // Navigation helpers
  const updateTab = useCallback((tabId: string, updates: Partial<BrowserTab>) => {
    setTabs(prev => prev.map(tab => tab.id === tabId ? { ...tab, ...updates } : tab))
  }, [])

  const apiCall = useCallback(async (endpoint: string, body: Record<string, unknown>) => {
    const response = await apiClient.post(`/browser/${endpoint}`, {
      session_id: `${notebookId}-${activeTabId}`,
      ...body,
    })
    return response.data
  }, [notebookId, activeTabId])

  const toDataUri = useCallback((b64: string | null) => {
    if (!b64) return null
    if (b64.startsWith('data:')) return b64
    return `data:image/png;base64,${b64}`
  }, [])

  const clearLayersOnNav = useCallback(() => {
    setLayers([{ id: genLayerId(), name: 'Background', visible: true, opacity: 1, locked: false, actions: [] }])
  }, [])

  const navigate = useCallback(async (url: string) => {
    if (!url) return
    updateTab(activeTabId, { loading: true, error: null })
    try {
      const result = await apiCall('navigate', { url })
      updateTab(activeTabId, {
        url: result.url, title: result.title, screenshot: toDataUri(result.screenshot),
        content: result.content || '', links: result.links || [], error: null, loading: false,
      })
      setUrlInput(result.url)
      clearLayersOnNav()
    } catch (error) {
      updateTab(activeTabId, { loading: false, error: error instanceof Error ? error.message : 'Failed to navigate' })
    }
  }, [activeTabId, apiCall, updateTab, toDataUri, clearLayersOnNav])

  const handleNavigate = useCallback(() => { navigate(urlInput) }, [urlInput, navigate])
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => { if (e.key === 'Enter') handleNavigate() }, [handleNavigate])

  const goBack = useCallback(async () => {
    updateTab(activeTabId, { loading: true })
    try {
      const result = await apiCall('back', {})
      updateTab(activeTabId, {
        url: result.url, title: result.title, screenshot: toDataUri(result.screenshot),
        content: result.content || '', links: result.links || [], error: null, loading: false,
      })
      setUrlInput(result.url)
      clearLayersOnNav()
    } catch { updateTab(activeTabId, { loading: false }) }
  }, [activeTabId, apiCall, updateTab, toDataUri, clearLayersOnNav])

  const goForward = useCallback(async () => {
    updateTab(activeTabId, { loading: true })
    try {
      const result = await apiCall('forward', {})
      updateTab(activeTabId, {
        url: result.url, title: result.title, screenshot: toDataUri(result.screenshot),
        content: result.content || '', links: result.links || [], error: null, loading: false,
      })
      setUrlInput(result.url)
      clearLayersOnNav()
    } catch { updateTab(activeTabId, { loading: false }) }
  }, [activeTabId, apiCall, updateTab, toDataUri, clearLayersOnNav])

  const refresh = useCallback(async () => {
    if (activeTab.url && activeTab.url !== 'about:blank') await navigate(activeTab.url)
  }, [activeTab.url, navigate])

  const openLink = useCallback((href: string) => { setUrlInput(href); navigate(href) }, [navigate])

  const addTab = useCallback(() => {
    if (tabs.length >= MAX_TABS) return
    const newTabId = `tab-${Date.now()}`
    setTabs(prev => [...prev, { id: newTabId, url: 'about:blank', title: '', screenshot: null, content: '', links: [], error: null, loading: false }])
    setActiveTabId(newTabId)
    setUrlInput('')
  }, [tabs.length])

  const closeTab = useCallback((tabId: string) => {
    if (tabs.length <= 1) return
    setTabs(prev => prev.filter(t => t.id !== tabId))
    if (activeTabId === tabId) setActiveTabId(tabs.find(t => t.id !== tabId)?.id || tabs[0].id)
  }, [tabs, activeTabId])

  const ToolButton = ({ tool, icon: Icon, label }: { tool: DrawTool; icon: any; label: string }) => {
    const activeLayer = layers.find(l => l.id === activeLayerId)
    const isDisabled = activeLayer?.locked
    return (
      <Button
        variant={currentTool === tool ? 'default' : 'ghost'}
        size="icon"
        className="h-6 w-6"
        onClick={() => setCurrentTool(tool)}
        title={label}
        disabled={isDisabled}
      >
        <Icon className="h-3 w-3" />
      </Button>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Tab Bar */}
      <div className="flex items-center gap-1 p-1 border-b flex-shrink-0">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded cursor-pointer max-w-[100px] ${
              tab.id === activeTabId ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
            }`}
            onClick={() => { setActiveTabId(tab.id); setUrlInput(tab.url === 'about:blank' ? '' : tab.url) }}
          >
            <Globe className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{tab.title || 'New Tab'}</span>
            {tabs.length > 1 && (
              <X className="h-3 w-3 flex-shrink-0 opacity-50 hover:opacity-100" onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }} />
            )}
          </div>
        ))}
        {tabs.length < MAX_TABS && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={addTab}><Plus className="h-3 w-3" /></Button>
        )}
        <div className="flex-1" />
        {collapseButton}
      </div>

      {/* URL Bar */}
      <div className="flex items-center gap-1 p-1 border-b flex-shrink-0">
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={goBack} disabled={activeTab.loading}><ArrowLeft className="h-3 w-3" /></Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={goForward} disabled={activeTab.loading}><ArrowRight className="h-3 w-3" /></Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={refresh} disabled={activeTab.loading}><RotateCcw className="h-3 w-3" /></Button>
        </div>
        <div className="flex-1 relative">
          <Input value={urlInput} onChange={(e) => setUrlInput(e.target.value)} onKeyDown={handleKeyDown} placeholder="Enter URL..." className="h-6 text-xs pr-24" disabled={activeTab.loading} />
          <div className="absolute right-0 top-0 flex items-center gap-0.5">
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowAddSource(true)} disabled={activeTab.loading || !activeTab.screenshot} title="Add as source">
              <FilePlus className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleNavigate} disabled={activeTab.loading}>
              {activeTab.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Drawing Toolbar - Row 1: Tools */}
      {activeTab.screenshot && (
        <>
          <div className="flex items-center gap-0.5 p-1 border-b flex-shrink-0 bg-muted/30 overflow-x-auto">
            <ToolButton tool="pen" icon={Pencil} label="Pen" />
            <ToolButton tool="highlight" icon={Highlighter} label="Highlight" />
            <ToolButton tool="arrow" icon={MoveUpRight} label="Arrow" />
            <ToolButton tool="line" icon={Minus} label="Line" />
            <ToolButton tool="rect" icon={Square} label="Rectangle" />
            <ToolButton tool="circle" icon={Circle} label="Circle" />
            <ToolButton tool="text" icon={Type} label="Text" />
            <ToolButton tool="eraser" icon={Eraser} label="Eraser" />
            <div className="w-px h-4 bg-border mx-0.5" />
            {COLORS.map((color) => (
              <button key={color} className={cn('w-4 h-4 rounded-full border-2 flex-shrink-0', drawColor === color ? 'border-primary scale-125' : 'border-muted')} style={{ backgroundColor: color }} onClick={() => setDrawColor(color)} />
            ))}
            <div className="w-px h-4 bg-border mx-0.5" />
            {SIZES.map((size) => (
              <button key={size} className={cn('flex items-center justify-center w-5 h-5 rounded flex-shrink-0', drawSize === size ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')} onClick={() => setDrawSize(size)}>
                <div className="rounded-full bg-current" style={{ width: Math.min(size, 12), height: Math.min(size, 12) }} />
              </button>
            ))}
            <div className="w-px h-4 bg-border mx-0.5" />
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={undo} title="Undo"><Undo2 className="h-3 w-3" /></Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={clearCanvas} title="Clear All"><Trash2 className="h-3 w-3" /></Button>
            <Button variant="default" size="icon" className="h-6 w-6 bg-green-600 hover:bg-green-700" onClick={sendToAI} title="Send annotations to AI chat"><Send className="h-3 w-3" /></Button>
            <div className="w-px h-4 bg-border mx-0.5" />
            <Button variant={showLayers ? 'default' : 'ghost'} size="icon" className="h-6 w-6" onClick={() => setShowLayers(!showLayers)} title="Toggle Layers Panel"><Layers className="h-3 w-3" /></Button>
          </div>

          {/* Text options bar (shown when text tool is active) */}
          {currentTool === 'text' && (
            <div className="flex items-center gap-1 p-1 border-b flex-shrink-0 bg-muted/20">
              <span className="text-[10px] text-muted-foreground">Size:</span>
              {FONT_SIZES.map((fs) => (
                <button key={fs} className={cn('text-[10px] px-1.5 py-0.5 rounded', textFontSize === fs ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')} onClick={() => setTextFontSize(fs)}>{fs}</button>
              ))}
              <div className="w-px h-4 bg-border mx-0.5" />
              <span className="text-[10px] text-muted-foreground">Rotate:</span>
              {ROTATION_PRESETS.map((r, i) => (
                <button key={i} className={cn('text-[10px] px-1.5 py-0.5 rounded', textRotation === r.value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')} onClick={() => setTextRotation(r.value)}>{r.label}</button>
              ))}
              <input type="number" value={textRotation} onChange={(e) => setTextRotation(Number(e.target.value))} className="w-12 h-5 text-[10px] px-1 rounded border bg-background" min={0} max={360} />
              <span className="text-[10px] text-muted-foreground">°</span>
            </div>
          )}
        </>
      )}

      {/* Browser Viewport + Layers Panel (side by side) */}
      <div className="flex-1 flex min-h-0">
        {/* Browser Viewport */}
        <div className={cn("flex-1 relative overflow-auto browser-scroll flex items-start justify-center", showLayers && activeTab.screenshot ? "border-r" : "")} ref={containerRef}>
          {activeTab.loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}
          {activeTab.error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center text-muted-foreground p-4">
                <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">{activeTab.error}</p>
              </div>
            </div>
          )}
          {activeTab.screenshot ? (
            <div className="relative inline-block">
              <img
                src={activeTab.screenshot}
                alt={activeTab.title}
                className="block max-w-full h-auto"
                draggable={false}
                onLoad={(e) => {
                  const img = e.currentTarget
                  setCanvasSize({ width: img.naturalWidth, height: img.naturalHeight })
                }}
              />
              <canvas
                ref={canvasRef}
                width={canvasSize.width || 1280}
                height={canvasSize.height || 720}
                className="absolute top-0 left-0 block"
                style={{
                  width: canvasSize.width || 1280,
                  height: canvasSize.height || 720,
                  maxWidth: '100%',
                  cursor: currentTool === 'text' ? 'text' : 'crosshair',
                  imageRendering: 'auto',
                }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              />

              {/* Text input overlay */}
              {textPlacement && (
                <div
                  className="absolute z-20"
                  style={{
                    left: `${textPlacement.x}px`,
                    top: `${textPlacement.y}px`,
                  }}
                >
                  <div className="bg-background border rounded shadow-lg p-1">
                    <textarea
                      autoFocus
                      value={textPlacement.text}
                      onChange={(e) => setTextPlacement(prev => prev ? { ...prev, text: e.target.value } : null)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitText() }
                        if (e.key === 'Escape') setTextPlacement(null)
                      }}
                      className="w-48 h-16 text-sm p-1 border rounded resize-none bg-transparent"
                      style={{
                        color: textPlacement.color,
                        fontSize: `${textPlacement.fontSize}px`,
                        transform: `rotate(${textPlacement.rotation}deg)`,
                        transformOrigin: 'top left',
                      }}
                      placeholder="Type text, Enter=ok, Esc=cancel"
                    />
                    <div className="flex gap-1 mt-1">
                      <Button size="sm" className="h-5 text-[10px]" onClick={submitText}>OK</Button>
                      <Button size="sm" variant="outline" className="h-5 text-[10px]" onClick={() => setTextPlacement(null)}>Cancel</Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            !activeTab.loading && !activeTab.error && (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <Globe className="h-10 w-10 mx-auto mb-3 opacity-40" />
                  <p className="text-sm">Enter a URL to browse</p>
                </div>
              </div>
            )
          )}

          {/* Links Panel */}
          {activeTab.links.length > 0 && !activeTab.loading && (
            <div className="border-t p-2 bg-muted/30">
              <div className="text-xs font-medium text-muted-foreground mb-1">Links on page:</div>
              <div className="flex flex-wrap gap-1 max-h-20 overflow-auto">
                {activeTab.links.map((link, i) => (
                  <button key={i} className="text-xs text-primary hover:underline truncate max-w-[150px] bg-muted px-1.5 py-0.5 rounded" onClick={() => openLink(link.href)} title={link.href}>
                    {link.text || link.href}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Layers Panel */}
        {showLayers && activeTab.screenshot && (
          <div className="w-48 flex-shrink-0 flex flex-col bg-muted/20 border-l overflow-hidden">
            {/* Layers header */}
            <div className="flex items-center justify-between p-1 border-b flex-shrink-0">
              <span className="text-[10px] font-medium text-muted-foreground px-1">Layers</span>
              <div className="flex items-center gap-0.5">
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={addLayer} title="Add Layer"><Plus className="h-3 w-3" /></Button>
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => { if (activeLayerId) duplicateLayer(activeLayerId) }} title="Duplicate Layer"><FilePlus className="h-3 w-3" /></Button>
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => { if (activeLayerId && layers.length > 1) deleteLayer(activeLayerId) }} title="Delete Layer"><Trash2 className="h-3 w-3" /></Button>
              </div>
            </div>

            {/* Layer list (top = front, bottom = back — reversed display) */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {[...layers].reverse().map((layer) => (
                <div
                  key={layer.id}
                  className={cn(
                    "layer-item flex flex-col gap-0.5 p-1 border-b cursor-pointer",
                    layer.id === activeLayerId ? "bg-primary/10" : "hover:bg-muted/50"
                  )}
                  onClick={() => setActiveLayerId(layer.id)}
                >
                  {/* Layer row */}
                  <div className="flex items-center gap-1">
                    {/* Visibility */}
                    <button
                      className="flex-shrink-0 p-0.5 hover:bg-muted rounded"
                      onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(layer.id) }}
                      title={layer.visible ? 'Hide' : 'Show'}
                    >
                      {layer.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3 opacity-40" />}
                    </button>
                    {/* Lock */}
                    <button
                      className="flex-shrink-0 p-0.5 hover:bg-muted rounded"
                      onClick={(e) => { e.stopPropagation(); toggleLayerLock(layer.id) }}
                      title={layer.locked ? 'Unlock' : 'Lock'}
                    >
                      {layer.locked ? <Lock className="h-3 w-3 text-orange-500" /> : <Unlock className="h-3 w-3 opacity-40" />}
                    </button>
                    {/* Name */}
                    <input
                      className="flex-1 text-[10px] bg-transparent border-none outline-none px-0.5 min-w-0 truncate"
                      value={layer.name}
                      onChange={(e) => renameLayer(layer.id, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    {/* Action count */}
                    <span className="text-[8px] text-muted-foreground flex-shrink-0">{layer.actions.length}</span>
                  </div>
                  {/* Opacity slider */}
                  <div className="flex items-center gap-1 pl-5">
                    <span className="text-[8px] text-muted-foreground">Op:</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={layer.opacity}
                      onChange={(e) => setLayerOpacity(layer.id, parseFloat(e.target.value))}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 h-1 accent-primary"
                    />
                    <span className="text-[8px] text-muted-foreground w-6 text-right">{Math.round(layer.opacity * 100)}%</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Layer reorder buttons */}
            {activeLayerId && (
              <div className="flex items-center gap-0.5 p-1 border-t flex-shrink-0">
                <Button variant="ghost" size="icon" className="h-5 w-5 flex-1" onClick={() => sendToBack(activeLayerId)} title="Send to Back">
                  <ChevronsDown className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-5 w-5 flex-1" onClick={() => moveLayer(activeLayerId, 'down')} title="Move Down">
                  <ChevronDown className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-5 w-5 flex-1" onClick={() => moveLayer(activeLayerId, 'up')} title="Move Up">
                  <ChevronUp className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="icon" className="h-5 w-5 flex-1" onClick={() => bringToFront(activeLayerId)} title="Bring to Front">
                  <ChevronsUp className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add as Source Dialog */}
      <Dialog open={showAddSource} onOpenChange={setShowAddSource}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t('sources.addFromBrowser') || 'Add as Source'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {activeTab.screenshot ? (
              <div className="space-y-3">
                <div className="rounded-lg border bg-muted/50 p-3">
                  <div className="text-sm font-medium">{activeTab.title || 'Untitled'}</div>
                  <div className="text-xs text-muted-foreground truncate">{activeTab.url}</div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <AlertCircle className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p>{t('sources.noPageLoaded') || 'No page loaded to add as source'}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddSource(false)}>{t('common.cancel')}</Button>
            <Button onClick={async () => {
              if (activeTab.url && activeTab.url !== 'about:blank') {
                try { await apiClient.post('/sources', { type: 'link', url: activeTab.url, notebooks: [notebookId] }); setShowAddSource(false) } catch (e) { console.error('Failed to add source:', e) }
              }
            }} disabled={!activeTab.screenshot || activeTab.url === 'about:blank'}>{t('common.add')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
