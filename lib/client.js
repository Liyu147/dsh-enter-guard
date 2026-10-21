// dsh-enter-guard browser bundle. 回车二次确认，防误发。
//
// 规则：
//   1) 第一次 Enter（无修饰键、非输入法组字、非长按）→ 拦截，不发送；
//      输入框描边高亮，浮出「再按一次 Enter 发送」。
//   2) 已上膛时再按 Enter → 放行，交回 DSH 原生发送。
//   3) 上膛后按任何其他键（含 Shift/Ctrl/Alt/Win/CapsLock）、内容变化、
//      输入法开始组字、失焦、点击输入框外部 → 立即撤销。
//   4) Ctrl/Cmd+Enter 与点发送按钮 → 直接发送，不走二次确认（逃生口）。
//   5) 斜杠 / 或 @ 菜单打开中 → 完全放行（Enter 是选候选项）。
//   6) 按住 Enter 的键盘重复 → 忽略，不会因长按而发出。
//   7) 空草稿（无文字无附件）→ 不拦。
//   8) 2 秒窗口只控制提示的视觉强度，状态保持，随时再按 Enter 仍可发送。
//
// 设计要点：不清空草稿、不调 setDraft、不碰附件管线。
// 草稿始终留在输入框，只是"晚一点发"，因此只依赖 DOM 锚点：
//   [data-composer-card]  输入框卡片
//   [data-composer-input] 编辑区
//   [data-trigger-menu]   命令/文件候选菜单
//   [data-composer-chip]  附件/引用胶囊
// DSH 升级若改掉这些锚点，本插件表现为"静默失效"（退回原生回车即发），
// 不会乱发、不会吞消息。启动时会自检并在控制台告警。
//
// 安全边界：只读 DOM、只拦键盘事件；无 fetch / 无 localStorage / 无网络请求。
window.__ModuleLoader__.load({
  id: 'dsh-enter-guard',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var VERSION = '0.1.0'

    var CARD_SELECTOR = '[data-composer-card]'
    var INPUT_SELECTOR = '[data-composer-input]'
    var MENU_SELECTOR = '[data-trigger-menu]'
    var CHIP_SELECTOR = '[data-composer-chip]'

    var ATTR = 'data-dsh-enter-guard'
    var HINT_CLASS = 'dsh-enter-guard-hint'
    var STYLE_ID = 'dsh-enter-guard-style'

    var DEFAULTS = {
      enabled: true,
      windowMs: 2000,
      hintText: '再按一次 Enter 发送',
    }

    var CSS = [
      '[' + ATTR + ']{transition:box-shadow .12s ease,border-color .12s ease}',
      '[' + ATTR + '="armed"]{box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary,#2f7dff),var(--dsw-elevation-soft,0 2px 8px rgba(0,0,0,.12))!important}',
      '[' + ATTR + '="armed-dim"]{box-shadow:0 0 0 1px var(--dsw-alias-state-business-primary,#2f7dff),var(--dsw-elevation-soft,0 2px 8px rgba(0,0,0,.12))!important}',
      '.' + HINT_CLASS + '{position:fixed;z-index:9999;pointer-events:none;display:none;',
      'padding:4px 10px;border-radius:999px;white-space:nowrap;',
      'font:500 12px/18px Inter,system-ui,-apple-system,"Segoe UI",sans-serif;',
      'color:var(--dsw-alias-label-primary,#e8eaed);',
      'background:var(--dsw-alias-bg-overlay,#1f2937);',
      'box-shadow:0 2px 10px rgba(0,0,0,.28);',
      'opacity:1;transition:opacity .2s ease}',
      '.' + HINT_CLASS + '.is-dim{opacity:.45}',
    ].join('')

    function createGuard(options) {
      var opts = {}
      var k
      for (k in DEFAULTS) {
        if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) opts[k] = DEFAULTS[k]
      }
      if (options) {
        for (k in options) {
          if (options[k] !== undefined) opts[k] = options[k]
        }
      }

      var doc = opts.document || window.document
      var win = opts.window || window

      var armed = false
      var timer = null
      var hintEl = null
      var styleEl = null
      var mounted = false
      var boundHandlers = []
      // 是否真的拦下过一次回车。这是唯一能证明"按键链路通了"的字段：
      // 挂载时输入框可能还没渲染，不能拿那一刻的 card() 当结论。
      var everBlocked = false

      // ---- DOM 查询（全部惰性，卡片被换掉也不需要重新绑定） ----

      function card() {
        if (!doc || typeof doc.querySelector !== 'function') return null
        return doc.querySelector(CARD_SELECTOR)
      }

      function menuOpen() {
        if (!doc || typeof doc.querySelector !== 'function') return false
        return doc.querySelector(MENU_SELECTOR) !== null
      }

      function composerInput() {
        var el = card()
        if (!el || typeof el.querySelector !== 'function') return null
        return el.querySelector(INPUT_SELECTOR)
      }

      function inComposer(target) {
        var el = card()
        if (!el || !target) return false
        if (el === target) return true
        if (typeof el.contains === 'function') return el.contains(target)
        return false
      }

      function hasContent() {
        var input = composerInput()
        var text = ''
        if (input && typeof input.textContent === 'string') text = input.textContent
        text = text.replace(/\u200b/g, '').trim()
        if (text !== '') return true
        var el = card()
        if (el && typeof el.querySelectorAll === 'function') {
          var chips = el.querySelectorAll(CHIP_SELECTOR)
          if (chips && chips.length > 0) return true
        }
        return false
      }

      // ---- 事件判定 ----

      function isComposing(ev) {
        if (!ev) return false
        return ev.isComposing === true || ev.keyCode === 229
      }

      function isBareEnter(ev) {
        if (!ev || ev.key !== 'Enter') return false
        return !ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey
      }

      function decide(ev) {
        if (!opts.enabled) return 'pass'
        if (!inComposer(ev && ev.target)) return 'pass'
        if (menuOpen()) return 'pass'
        if (ev && ev.repeat) return 'pass'
        if (isComposing(ev)) {
          disarm()
          return 'pass'
        }
        if (isBareEnter(ev)) {
          if (!hasContent()) {
            disarm()
            return 'pass'
          }
          if (armed) {
            disarm()
            return 'pass'
          }
          arm()
          return 'block'
        }
        disarm()
        return 'pass'
      }

      // ---- 状态副作用 ----

      function positionHint() {
        if (!hintEl) return
        var el = card()
        if (!el || typeof el.getBoundingClientRect !== 'function') return
        var r = el.getBoundingClientRect()
        if (!r) return
        hintEl.style.left = Math.round(r.left + r.width / 2) + 'px'
        hintEl.style.top = Math.round(r.top - 8) + 'px'
        hintEl.style.transform = 'translate(-50%,-100%)'
      }

      function showHint() {
        if (!hintEl) {
          if (!doc || typeof doc.createElement !== 'function' || !doc.body) return
          hintEl = doc.createElement('div')
          hintEl.className = HINT_CLASS
          hintEl.textContent = opts.hintText
          doc.body.appendChild(hintEl)
        }
        hintEl.classList.remove('is-dim')
        hintEl.style.display = 'block'
        positionHint()
      }

      function hideHint() {
        if (!hintEl) return
        hintEl.style.display = 'none'
        hintEl.classList.remove('is-dim')
      }

      function onViewportChange() {
        positionHint()
      }

      function bindViewport() {
        if (!win || typeof win.addEventListener !== 'function') return
        win.addEventListener('scroll', onViewportChange, true)
        win.addEventListener('resize', onViewportChange, true)
      }

      function unbindViewport() {
        if (!win || typeof win.removeEventListener !== 'function') return
        win.removeEventListener('scroll', onViewportChange, true)
        win.removeEventListener('resize', onViewportChange, true)
      }

      function arm() {
        var el = card()
        if (!el) return
        armed = true
        everBlocked = true
        el.setAttribute(ATTR, 'armed')
        showHint()
        bindViewport()
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(function () {
          timer = null
          dim()
        }, opts.windowMs)
      }

      function dim() {
        if (!armed) return
        var el = card()
        if (el) el.setAttribute(ATTR, 'armed-dim')
        if (hintEl) hintEl.classList.add('is-dim')
      }

      function disarm() {
        if (!armed && !hintEl) {
          var stale = card()
          if (stale && typeof stale.removeAttribute === 'function') stale.removeAttribute(ATTR)
          return
        }
        armed = false
        if (timer !== null) clearTimeout(timer)
        timer = null
        var el = card()
        if (el) el.removeAttribute(ATTR)
        hideHint()
        unbindViewport()
      }

      // ---- 事件入口 ----

      function onKeyDown(ev) {
        var action
        try {
          action = decide(ev)
        } catch (_) {
          disarm()
          return // fail-open：出问题就退回原生行为
        }
        if (action !== 'block') return
        if (typeof ev.preventDefault === 'function') ev.preventDefault()
        if (typeof ev.stopPropagation === 'function') ev.stopPropagation()
      }

      function onInput() {
        disarm()
      }

      function onCompositionStart() {
        disarm()
      }

      function onFocusOut(ev) {
        var next = ev && ev.relatedTarget
        if (next && inComposer(next)) return
        disarm()
      }

      function onClickOutside(ev) {
        if (inComposer(ev && ev.target)) return
        disarm()
      }

      // ---- 挂载 / 卸载 ----

      function listen(target, type, fn) {
        if (!target || typeof target.addEventListener !== 'function') return
        target.addEventListener(type, fn, true)
        boundHandlers.push([target, type, fn])
      }

      function injectStyle() {
        if (!doc) return
        if (typeof doc.getElementById === 'function' && doc.getElementById(STYLE_ID)) return
        if (typeof doc.createElement !== 'function' || !doc.head) return
        styleEl = doc.createElement('style')
        styleEl.id = STYLE_ID
        styleEl.textContent = CSS
        doc.head.appendChild(styleEl)
      }

      function mount() {
        if (mounted || !doc) return inspect()
        mounted = true
        injectStyle()
        listen(doc, 'keydown', onKeyDown)
        listen(doc, 'input', onInput)
        listen(doc, 'compositionstart', onCompositionStart)
        listen(doc, 'focusout', onFocusOut)
        listen(doc, 'click', onClickOutside)
        return inspect()
      }

      function unmount() {
        var i
        for (i = 0; i < boundHandlers.length; i++) {
          var entry = boundHandlers[i]
          if (entry[0] && typeof entry[0].removeEventListener === 'function') {
            entry[0].removeEventListener(entry[1], entry[2], true)
          }
        }
        boundHandlers = []
        disarm()
        armed = false
        if (timer !== null) clearTimeout(timer)
        timer = null
        if (hintEl && hintEl.parentNode && typeof hintEl.parentNode.removeChild === 'function') {
          hintEl.parentNode.removeChild(hintEl)
        }
        hintEl = null
        if (styleEl && styleEl.parentNode && typeof styleEl.parentNode.removeChild === 'function') {
          styleEl.parentNode.removeChild(styleEl)
        }
        styleEl = null
        mounted = false
        return inspect()
      }

      function inspect() {
        return {
          version: VERSION,
          mounted: mounted,
          armed: armed,
          enabled: opts.enabled,
          windowMs: opts.windowMs,
          hasCard: card() !== null,
          everBlocked: everBlocked,
          menuOpen: menuOpen(),
        }
      }

      return {
        mount: mount,
        unmount: unmount,
        inspect: inspect,
        arm: arm,
        disarm: disarm,
        isArmed: function () {
          return armed
        },
      }
    }

    // ---- Cordis 插件体 ----

    function apply(ctx, config) {
      // 热重载/重复加载去重：先拆掉上一份，避免两套监听同时拦截
      if (window.__dshEnterGuard && window.__dshEnterGuard.instance) {
        try {
          window.__dshEnterGuard.instance.unmount()
        } catch (_) {}
      }

      var guard = createGuard({
        enabled: config && config.enabled !== undefined ? config.enabled : DEFAULTS.enabled,
        windowMs: config && config.windowMs !== undefined ? config.windowMs : DEFAULTS.windowMs,
        hintText: config && config.hintText !== undefined ? config.hintText : DEFAULTS.hintText,
      })

      guard.mount()
      window.__dshEnterGuard = { version: VERSION, instance: guard }

      // 锚点自检：卡片迟迟不出现，说明 DSH 结构变了，插件已静默失效 → 告警
      setTimeout(function () {
        if (guard.inspect().hasCard) return
        if (typeof console !== 'undefined' && console.warn) {
          console.warn(
            '[dsh-enter-guard] 未找到输入框锚点 ' + CARD_SELECTOR +
              '，回车二次确认暂不生效（DSH 可能已升级并改了 DOM 结构）。目前保持原生回车行为。'
          )
        }
      }, 5000)

      if (ctx && typeof ctx.effect === 'function') {
        ctx.effect(function () {
          return function () {
            guard.unmount()
            if (window.__dshEnterGuard && window.__dshEnterGuard.instance === guard) {
              window.__dshEnterGuard = null
            }
          }
        }, 'dsh-enter-guard: composer key guard')
      }
    }

    // 不依赖任何其它服务：无 slots / locale / sessions
    var inject = []

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
