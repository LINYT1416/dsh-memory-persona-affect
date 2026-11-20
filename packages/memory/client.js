window.__ModuleLoader__.load({
  id: 'dsh-all',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    function MemoryPanel() {
      return h('div', { style: { width: '100%', height: '100%', minHeight: '620px', display: 'flex', flexDirection: 'column' } },
        h('iframe', { src: '/memory', title: '她的记忆', style: { flex: '1 1 auto', width: '100%', minHeight: '620px', border: '0', borderRadius: '12px', background: '#14161a' } }))
    }
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'memory', order: 28, label: '她的记忆' }, MemoryPanel))
      },
    }
  },
})
