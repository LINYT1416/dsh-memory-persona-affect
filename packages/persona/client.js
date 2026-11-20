window.__ModuleLoader__.load({
  id: 'dsh-persona',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // 设置页里的一页：嵌 /persona（那一页自己轮询 /persona/state）
    function PersonaPanel() {
      return h('div', {
        style: { width: '100%', height: '100%', minHeight: '620px', display: 'flex', flexDirection: 'column' },
      }, h('iframe', {
        src: '/persona',
        title: '她的人格',
        style: {
          flex: '1 1 auto', width: '100%', minHeight: '620px', border: '0',
          borderRadius: '12px', background: '#14161a',
        },
      }))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'persona',
          order: 27,
          label: '她的人格',
        }, PersonaPanel))
      },
    }
  },
})
