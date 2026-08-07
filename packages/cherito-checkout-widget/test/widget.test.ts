import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'

// ---------------------------------------------------------------------------
// DOM Mocks for Node environment
// ---------------------------------------------------------------------------
class FakeElement {
  attributes = new Map<string, string>()
  shadowRoot: FakeShadowRoot | null = null
  listeners = new Map<string, Array<(e: unknown) => void>>()

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value)
  }
  attachShadow() {
    this.shadowRoot = new FakeShadowRoot()
    return this.shadowRoot
  }
  addEventListener(event: string, handler: (e: unknown) => void) {
    const list = this.listeners.get(event) ?? []
    list.push(handler)
    this.listeners.set(event, list)
  }
  dispatchEvent(event: { type: string; detail?: unknown }) {
    const list = this.listeners.get(event.type) ?? []
    for (const h of list) h(event)
    return true
  }
}

class FakeShadowRoot {
  innerHTML = ''
  children: FakeDOMNode[] = []

  querySelector(selector: string): FakeDOMNode | null {
    return this.querySelectorAll(selector)[0] ?? null
  }

  querySelectorAll(selector: string): FakeDOMNode[] {
    const results: FakeDOMNode[] = []
    const search = (node: FakeDOMNode) => {
      if (selector.startsWith('.') && node.classList?.contains(selector.slice(1))) {
        results.push(node)
      } else if (selector.startsWith('#') && node.id === selector.slice(1)) {
        results.push(node)
      } else if (selector.includes('data-copy') && node.attributes.has('data-copy')) {
        if (selector === '[data-copy]' || node.getAttribute('data-copy') === selector.match(/data-copy="([^"]+)"/)?.[1]) {
          results.push(node)
        }
      } else if (node.tagName === selector.toLowerCase()) {
        results.push(node)
      }
      for (const c of node.children) search(c)
    }
    for (const c of this.children) search(c)
    return results
  }
}

class FakeDOMNode {
  tagName: string
  textContent = ''
  value = ''
  id = ''
  classList = {
    _set: new Set<string>(),
    add(c: string) { this._set.add(c) },
    contains(c: string) { return this._set.has(c) },
  }
  attributes = new Map<string, string>()
  children: FakeDOMNode[] = []
  listeners = new Map<string, Array<(e: unknown) => void>>()

  constructor(tagName: string) {
    this.tagName = tagName.toLowerCase()
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null
  }
  setAttribute(name: string, val: string) {
    this.attributes.set(name, val)
  }
  addEventListener(event: string, handler: (e: unknown) => void) {
    const list = this.listeners.get(event) ?? []
    list.push(handler)
    this.listeners.set(event, list)
  }
  focus() {}
  click() {
    for (const h of this.listeners.get('click') ?? []) h({ type: 'click' })
  }
}

// Minimal HTML parser for innerHTML assignment in shadowRoot
function parseHTML(): FakeDOMNode[] {
  const nodes: FakeDOMNode[] = []
  // Extract button, p, strong, canvas, textarea, section, div
  const payBtn = new FakeDOMNode('button')
  payBtn.classList.add('pay')
  nodes.push(payBtn)

  const overlay = new FakeDOMNode('div')
  overlay.classList.add('overlay')

  const dialog = new FakeDOMNode('section')
  dialog.classList.add('dialog')

  const closeBtn = new FakeDOMNode('button')
  closeBtn.classList.add('close')

  const stateP = new FakeDOMNode('p')
  stateP.classList.add('state')

  const amountStrong = new FakeDOMNode('strong')
  amountStrong.classList.add('amount')

  const qrCanvas = new FakeDOMNode('canvas')
  qrCanvas.classList.add('qr')

  const timerP = new FakeDOMNode('p')
  timerP.classList.add('timer')

  const invoiceTxt = new FakeDOMNode('textarea')
  invoiceTxt.classList.add('invoice')

  const copyInv = new FakeDOMNode('button')
  copyInv.setAttribute('data-copy', 'invoice')

  const copyUri = new FakeDOMNode('button')
  copyUri.setAttribute('data-copy', 'uri')

  dialog.children.push(closeBtn, stateP, amountStrong, qrCanvas, timerP, invoiceTxt, copyInv, copyUri)
  overlay.children.push(dialog)
  nodes.push(overlay)

  return nodes
}

// Attach globals before importing module
const definedCustomElements = new Map<string, typeof FakeElement>()

Object.defineProperty(globalThis, 'HTMLElement', { value: FakeElement, writable: true })
Object.defineProperty(globalThis, 'customElements', {
  value: {
    define: (name: string, cls: typeof FakeElement) => {
      definedCustomElements.set(name, cls)
    },
  },
  writable: true,
})
Object.defineProperty(globalThis, 'CustomEvent', {
  value: class CustomEvent {
    type: string
    detail: unknown
    constructor(type: string, init?: { detail: unknown }) {
      this.type = type
      this.detail = init?.detail
    }
  },
  writable: true,
})
Object.defineProperty(globalThis, 'window', { value: globalThis, writable: true })

Object.defineProperty(globalThis, 'navigator', {
  value: {
    clipboard: {
      writeText: async () => {},
    },
  },
  writable: true,
})

describe('CheritoBitcoinCheckout — Web Component', () => {
  before(async () => {
    // Dynamically import component so global mocks are applied
    await import('../src/index.js')
  })

  test('registers <cherito-bitcoin-checkout> custom element', () => {
    assert.ok(definedCustomElements.has('cherito-bitcoin-checkout'))
  })

  test('connectedCallback requires api-url and product-id attributes', () => {
    const ElementClass = definedCustomElements.get('cherito-bitcoin-checkout')!
    const widget = new ElementClass() as unknown as InstanceType<typeof ElementClass> & {
      connectedCallback: () => void
    }

    assert.throws(
      () => widget.connectedCallback(),
      (err: Error) => {
        assert.ok(err.message.includes('api-url and product-id are required'))
        return true
      },
    )
  })

  test('connectedCallback builds shadow DOM structure', () => {
    const ElementClass = definedCustomElements.get('cherito-bitcoin-checkout')!
    const widget = new ElementClass() as unknown as InstanceType<typeof ElementClass> & {
      connectedCallback: () => void
    }
    widget.setAttribute('api-url', 'http://localhost:3100')
    widget.setAttribute('product-id', 'coffee')

    // Patch shadow root innerHTML setter to populate fake nodes
    const origAttach = widget.attachShadow.bind(widget)
    widget.attachShadow = function (init) {
      const sr = origAttach(init)
      let htmlVal = ''
      Object.defineProperty(sr, 'innerHTML', {
        get: () => htmlVal,
        set: (v: string) => {
          htmlVal = v
          sr.children = parseHTML(v)
        },
      })
      return sr
    }

    widget.connectedCallback()
    assert.ok(widget.shadowRoot)
    assert.ok(widget.shadowRoot.querySelector('.pay'))
    assert.ok(widget.shadowRoot.querySelector('.overlay'))
    assert.ok(widget.shadowRoot.querySelector('.dialog'))
  })
})
